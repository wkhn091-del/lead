import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { Id } from '../leads/leads.schemas.js';
import { HttpError } from '../lib/http-error.js';
import type { MediaStorage } from '../media/storage.js';
import { ConflictError, type LeadRecord, type Stores } from '../stores/types.js';
import type { ProspectorEngine } from './engine.js';
import { LeadMatcher, leadFor } from './importer.js';
import { RESULT_LIMITS, type ProspectRecord, type ProspectSearchRecord } from './types.js';

/**
 * Mounted at /api/prospector behind requireAuth:
 *   GET    /                            settings, the search providers' state and recent searches
 *   POST   /searches                    { niche, location, limit, language } starts a search (202)
 *   GET    /searches/:id                the search and its businesses, as far as they've been checked
 *   POST   /searches/:id/cancel
 *   DELETE /searches/:id                the search and its results (imported leads stay)
 *   POST   /prospects/:id/recheck       checks one website again
 *   GET    /prospects/:id/screenshot    the phone screenshot
 *   POST   /import                      { ids } adds businesses as leads, into the Daily 10 pool
 */

const SearchInput = z.strictObject({
  niche: z.string().trim().min(2, 'כתבו תחום, למשל "חדרי כושר".').max(60, 'תחום עד 60 תווים.'),
  location: z.string().trim().min(2, 'כתבו אזור, למשל "תל אביב".').max(60, 'אזור עד 60 תווים.'),
  limit: z.literal([...RESULT_LIMITS]).default(40),
  language: z.enum(['he', 'en']).default('he'),
});
const ImportInput = z.strictObject({ ids: z.array(Id).min(1, 'בחרו לפחות עסק אחד.').max(100, 'אפשר לייבא עד 100 עסקים בכל פעם.') });
const Params = z.object({ id: Id });

/** Searches cost money (Places requests and AI calls), so a stuck button can't run up a bill */
const searchLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'הגעתם ל-15 חיפושים בשעה. נסו שוב קצת יותר מאוחר.')),
});

/** Counts for a search, from its businesses */
function summarize(prospects: ProspectRecord[]) {
  const scores: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let checked = 0;
  let imported = 0;
  for (const prospect of prospects) {
    const { status, score } = prospect.analysis;
    if (status === 'done' || status === 'failed' || status === 'skipped') checked += 1;
    if (score !== null) scores[String(score)] += 1;
    if (prospect.importedLeadId) imported += 1;
  }
  return { total: prospects.length, checked, imported, scores };
}

function searchView(search: ProspectSearchRecord, prospects: ProspectRecord[]) {
  return { ...search, ...summarize(prospects) };
}

/** A business as the app sees it: no storage keys, and the page text the AI read stays on the server */
function prospectView(prospect: ProspectRecord) {
  const { screenshotKey, signals, ...analysis } = prospect.analysis;
  return {
    ...prospect,
    analysis: {
      ...analysis,
      hasScreenshot: Boolean(screenshotKey),
      signals: signals ? { ...signals, text: undefined } : null,
    },
  };
}

export interface ProspectorHooks {
  /** New leads were added (the WhatsApp sync looks for their chats) */
  leadsChanged?(created: string[]): void;
}

export function createProspectorRouter(
  stores: Stores,
  storage: MediaStorage,
  engine: ProspectorEngine | null,
  off: string,
  countryCode: string,
  clock: () => Date,
  hooks: ProspectorHooks = {},
) {
  const router = Router();
  const store = stores.prospector;
  const needEngine = () => {
    if (!engine) throw new HttpError(503, off);
    return engine;
  };
  const findSearch = async (id: string) => {
    const search = await store.getSearch(id);
    if (!search) throw new HttpError(404, 'החיפוש הזה כבר לא קיים.');
    return search;
  };

  router.get('/', async (_req, res) => {
    if (!engine) {
      res.json({ enabled: false, reason: off });
      return;
    }
    const searches = await store.listSearches(20);
    const [views, providers] = await Promise.all([
      Promise.all(searches.map(async (search) => searchView(search, await store.listProspects(search.id)))),
      engine.providerStatus(),
    ]);
    res.json({
      enabled: true,
      provider: engine.providerName,
      backup: engine.backupName,
      /** Each provider's state: SerpApi's searches left this month, out of searches, resting after a failure */
      providers,
      browser: engine.browser,
      ai: engine.ai,
      retentionDays: engine.retentionDays,
      searches: views,
    });
  });

  router.post('/searches', searchLimit, async (req, res) => {
    const running = needEngine();
    const input = SearchInput.parse(req.body ?? {});
    const search = await running.start(input);
    res.status(202).json(searchView(search, []));
  });

  router.get('/searches/:id', async (req, res) => {
    const { id } = Params.parse(req.params);
    const search = await findSearch(id);
    const prospects = await store.listProspects(id);
    res.json({ search: searchView(search, prospects), prospects: prospects.map(prospectView) });
  });

  router.post('/searches/:id/cancel', async (req, res) => {
    const { id } = Params.parse(req.params);
    await findSearch(id);
    const search = await needEngine().cancel(id);
    if (!search) throw new HttpError(404, 'החיפוש הזה כבר לא קיים.');
    res.json(searchView(search, await store.listProspects(id)));
  });

  router.delete('/searches/:id', async (req, res) => {
    const { id } = Params.parse(req.params);
    if (engine) await engine.remove(id);
    else {
      const keys = await store.removeSearch(id);
      if (keys.length) await storage.remove(keys).catch(() => {});
    }
    res.status(204).end();
  });

  router.post('/prospects/:id/recheck', async (req, res) => {
    const running = needEngine();
    const { id } = Params.parse(req.params);
    const prospect = await store.getProspect(id);
    if (!prospect) throw new HttpError(404, 'העסק הזה כבר לא ברשימה.');
    const { status } = prospect.analysis;
    if (status === 'checking' || status === 'scoring' || (status === 'pending' && running.isRunning(prospect.searchId))) {
      throw new ConflictError('האתר הזה נבדק עכשיו.');
    }
    await running.reanalyze(prospect);
    const updated = await store.getProspect(id);
    res.status(202).json(prospectView(updated ?? prospect));
  });

  router.get('/prospects/:id/screenshot', async (req, res) => {
    const { id } = Params.parse(req.params);
    const prospect = await store.getProspect(id);
    const key = prospect?.analysis.screenshotKey;
    if (!prospect || !key) throw new HttpError(404, 'אין צילום מסך לעסק הזה.');
    await storage.send(key, { mimeType: 'image/jpeg', fileName: `${prospect.domain || 'site'}.jpg` }, res);
  });

  /**
   * Adds the chosen businesses as leads, at Cold Call, so they join the Daily 10 pool. A business whose phone
   * or website is already on a lead is skipped, and so is one imported before.
   */
  router.post('/import', async (req, res) => {
    const { ids } = ImportInput.parse(req.body ?? {});
    const prospects = await store.getProspects([...new Set(ids)]);
    const matcher = new LeadMatcher(await stores.leads.list(), countryCode);
    const searches = new Map<string, ProspectSearchRecord | null>();
    const now = clock();
    const skipped: { id: string; reason: 'imported' | 'exists' | 'missing'; leadId?: string }[] = [];
    const planned: { prospect: ProspectRecord; lead: ReturnType<typeof leadFor> }[] = [];

    for (const id of new Set(ids)) {
      const prospect = prospects.find((item) => item.id === id);
      if (!prospect) {
        skipped.push({ id, reason: 'missing' });
        continue;
      }
      if (prospect.importedLeadId) {
        skipped.push({ id, reason: 'imported', leadId: prospect.importedLeadId });
        continue;
      }
      const existing = matcher.find(prospect);
      if (existing) {
        await store.setExistingLead(id, existing);
        skipped.push({ id, reason: 'exists', leadId: existing });
        continue;
      }
      if (!searches.has(prospect.searchId)) searches.set(prospect.searchId, await store.getSearch(prospect.searchId));
      const search = searches.get(prospect.searchId);
      if (!search) {
        skipped.push({ id, reason: 'missing' });
        continue;
      }
      const lead = leadFor(prospect, search, now);
      planned.push({ prospect, lead });
      // Two branches with one number in the same import become one lead
      matcher.add({ id: lead.id, phone: lead.phone, website: lead.website });
    }

    let created: LeadRecord[] = [];
    if (planned.length) {
      const result = await stores.leads.createMany(planned.map((item) => item.lead));
      created = result.created;
      const createdIds = new Set(created.map((lead) => lead.id));
      for (const { prospect, lead } of planned) {
        if (createdIds.has(lead.id)) await store.markImported(prospect.id, lead.id, now);
      }
      if (created.length) hooks.leadsChanged?.(created.map((lead) => lead.id));
    }
    res.status(201).json({ created, skipped });
  });

  return router;
}
