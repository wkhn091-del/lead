import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { CoachLanguage } from '../coach/prompt.js';
import type { CoachProvider } from '../coach/providers.js';
import { HttpError } from '../lib/http-error.js';
import { COACH_LANGUAGES, Id } from '../leads/leads.schemas.js';
import { ConflictError, type ObjectionCardDraft, type ObjectionCardRecord, type ObjectionVariantRecord, type Stores } from '../stores/types.js';
import { nicheKey, nicheOf } from './niche.js';
import { GRADES, review } from './practice.js';
import { buildTrainingPrompt, toDrafts } from './prompt.js';
import { Deck, DECK_JSON_SCHEMA } from './schema.js';
import { STARTER_CARDS, STARTER_KEYS, type StarterCard } from './starter.js';
import { buildTailorPrompt, nicheFrom, TAILOR_JSON_SCHEMA, Tailored, toVariantDrafts } from './tailor.js';

export interface TrainingSettings {
  timeZone: string;
  businessContext: string;
}

const GenerateInput = z.strictObject({ language: z.enum(COACH_LANGUAGES).default('auto') });
const ReviewInput = z.strictObject({
  grade: z.literal([...GRADES], 'דרגו את התשובה מ-1 (לא ידעתי) עד 4 (קל).'),
  /** When you answered, for practice done without a connection and sent later (within the last week) */
  at: z.iso.datetime({ offset: true }).optional(),
});
const CardPatch = z.strictObject({ myResponse: z.string().trim().max(2000) });
const CardParams = z.object({ id: Id });
const NicheName = z.string().trim().min(2, 'כתבו תחום, למשל "מסעדות".').max(60, 'תחום עד 60 תווים.');
const NicheQuery = z.object({ niche: NicheName });
const TailorInput = z.strictObject({ niche: NicheName, language: z.enum(COACH_LANGUAGES).default('auto') });

const NEEDS_COACH =
  'צריך את מאמן ה-AI: הגדירו AI_PROVIDER ו-AI_API_KEY בשרת (בחינם: ⁦AI_PROVIDER=gemini⁩ עם מפתח מ-⁦Google AI Studio⁩).';

/** A niche's tailored answers as the app reads them, and whether new ones are being written right now */
function variantsView(niche: { key: string; label: string }, variants: ObjectionVariantRecord[], job: { tailoring: boolean; error: string | null }) {
  const newest = variants.reduce<ObjectionVariantRecord | null>((latest, item) => (!latest || item.updatedAt > latest.updatedAt ? item : latest), null);
  return {
    niche: { key: niche.key, label: newest?.label ?? niche.label },
    variants: variants.map(({ cardKey, objection, insight, response, alternatives, followUp }) => ({ cardKey, objection, insight, response, alternatives, followUp })),
    provider: newest?.provider ?? null,
    model: newest?.model ?? null,
    updatedAt: newest?.updatedAt ?? null,
    ...job,
  };
}

/** A starter card as a deck entry: a common objection no lead of yours has raised yet */
const starterDraft = (card: StarterCard): ObjectionCardDraft => ({ ...card, alternatives: [...card.alternatives], leadCount: 0, mentions: 0, sources: [] });

const starterRank = (key: string) => {
  const index = STARTER_KEYS.indexOf(key);
  return index < 0 ? STARTER_KEYS.length : index;
};

/** What your prospects raised most comes first; the common objections follow, most common first. */
const inDeckOrder = (cards: ObjectionCardRecord[]) =>
  cards.sort((a, b) => b.leadCount - a.leadCount || b.mentions - a.mentions || starterRank(a.key) - starterRank(b.key));

/** Building a deck reads every timeline and costs an AI call, so it's limited like the coach. */
const generateRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'הגעתם ל-10 עדכוני חפיסה בשעה. נסו שוב מאוחר יותר.')),
});

/** Tailoring rewrites the whole deck in one AI call, so it's limited too */
const tailorRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'הגעתם ל-20 התאמות בשעה. נסו שוב מאוחר יותר.')),
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** When a practice answer was given: the time the app sends, within the last week and not after now */
function answerTime(requested: string | undefined, now: Date): Date {
  const at = requested ? Date.parse(requested) : Number.NaN;
  if (Number.isNaN(at)) return now;
  return new Date(Math.min(now.getTime(), Math.max(at, now.getTime() - WEEK_MS)));
}

/**
 * Mounted at /api/training behind requireAuth. The objection deck: GET it, POST /generate to build or
 * refresh it from past calls, POST /cards/:id/review to record a practice answer, PATCH /cards/:id to save
 * your own version of an answer.
 *
 * Answers tailored to a niche: GET /niches lists your leads' niches and which are tailored, GET
 * /variants?niche= reads one, POST /variants { niche, language } starts tailoring it (202). Tailoring runs in
 * the background, since one AI call for a whole deck can outlast a proxy's time limit; GET /variants says
 * when it's done.
 */
export function createTrainingRouter(stores: Stores, coach: CoachProvider | null, settings: TrainingSettings, clock: () => Date) {
  const router = Router();
  let generating = false;
  let seeding: Promise<unknown> | null = null;
  /** Niches being tailored now, and why the last attempt failed (told once, then forgotten) */
  const tailoring = new Set<string>();
  const tailorErrors = new Map<string, string>();

  const load = () => Promise.all([stores.training.cards(), stores.training.latestRun()]);
  // Once per start, before the deck is first read: an update may have reworded the common objections
  let rewording: Promise<void> | null = null;
  const rewordCommon = () =>
    (rewording ??= stores.training.rewordCommon(STARTER_CARDS).then(
      (keys) => {
        if (keys.length) console.log(`Reworded ${keys.length} common objection${keys.length > 1 ? 's' : ''} in the deck: ${keys.join(', ')}`);
      },
      (error: unknown) => {
        rewording = null;
        console.error('Rewording the common objections failed; trying again on the next read:', error);
      },
    ));
  const deck = async () => {
    await rewordCommon();
    let [cards, run] = await load();
    if (cards.length === 0 && !run) {
      // A new deck starts with the common objections, so there is something to practise from the first day
      seeding ??= stores.training
        .saveRun(
          STARTER_CARDS.map(starterDraft),
          { provider: 'starter', model: 'starter', language: 'he', leadsAnalyzed: 0, entriesAnalyzed: 0, conversations: 0, cards: STARTER_CARDS.length },
          clock(),
        )
        .finally(() => {
          seeding = null;
        });
      await seeding;
      [cards, run] = await load();
    }
    return { run, cards: inDeckOrder(cards) };
  };

  /** Writes a niche's answers for every active card and saves them over the old ones */
  const tailor = async (niche: { key: string; label: string }, cards: ObjectionCardRecord[], language: CoachLanguage, ai: CoachProvider) => {
    const { system, prompt } = buildTailorPrompt({
      niche: niche.label,
      cards,
      leads: await stores.leads.list(),
      language,
      businessContext: settings.businessContext,
    });
    const answer = await ai.complete({ system, prompt, schema: TAILOR_JSON_SCHEMA, maxTokens: 16_000 });
    const parsed = Tailored.safeParse(answer);
    if (!parsed.success) {
      console.error('The AI answer did not match the tailoring schema:', parsed.error.issues.slice(0, 5));
      throw new HttpError(502, 'ה-AI ענה בפורמט לא צפוי. נסו שוב.');
    }
    const drafts = toVariantDrafts(parsed.data, cards);
    if (!drafts.length) throw new HttpError(502, 'ה-AI לא החזיר תשובות מותאמות. נסו שוב.');
    await stores.training.saveVariants(niche, drafts, { provider: ai.name, model: ai.model });
  };

  const readVariants = async (niche: { key: string; label: string }) => {
    const error = tailorErrors.get(niche.key) ?? null;
    if (error) tailorErrors.delete(niche.key);
    return variantsView(niche, await stores.training.variants(niche.key), { tailoring: tailoring.has(niche.key), error });
  };

  router.get('/', async (_req, res) => {
    res.json(await deck());
  });

  router.get('/niches', async (_req, res) => {
    await rewordCommon();
    const [leads, tailored] = await Promise.all([stores.leads.list(), stores.training.tailoredNiches()]);
    const niches = new Map<string, { key: string; label: string; leads: number; tailored: { cards: number; updatedAt: Date } | null }>();
    for (const lead of leads) {
      const label = nicheOf(lead.campaign);
      if (!label) continue;
      const key = nicheKey(label);
      const known = niches.get(key);
      if (known) known.leads += 1;
      else niches.set(key, { key, label, leads: 1, tailored: null });
    }
    for (const item of tailored) {
      const known = niches.get(item.niche) ?? { key: item.niche, label: item.label, leads: 0, tailored: null };
      niches.set(item.niche, { ...known, tailored: { cards: item.cards, updatedAt: item.updatedAt } });
    }
    res.json({
      niches: [...niches.values()].sort(
        (a, b) => b.leads - a.leads || Number(Boolean(b.tailored)) - Number(Boolean(a.tailored)) || a.label.localeCompare(b.label, 'he'),
      ),
      tailoring: [...tailoring],
    });
  });

  router.get('/variants', async (req, res) => {
    const { niche } = NicheQuery.parse(req.query);
    await rewordCommon();
    res.json(await readVariants(nicheFrom(niche)));
  });

  router.post('/variants', tailorRateLimit, async (req, res) => {
    const ai = coach;
    if (!ai) throw new HttpError(503, `התאמת התשובות לנישה ${NEEDS_COACH}`);
    const input = TailorInput.parse(req.body ?? {});
    const niche = nicheFrom(input.niche);
    if (!niche.key) throw new HttpError(400, 'כתבו תחום, למשל "מסעדות".');
    if (!tailoring.has(niche.key)) {
      const cards = (await deck()).cards.filter((card) => !card.retired);
      if (!cards.length) throw new ConflictError('אין עדיין כרטיסיות בחפיסה להתאים.');
      tailoring.add(niche.key);
      tailorErrors.delete(niche.key);
      void tailor(niche, cards, input.language, ai)
        .catch((error: unknown) => {
          if (!(error instanceof HttpError)) console.error(`Tailoring the deck for ${niche.label} failed:`, error);
          tailorErrors.set(niche.key, error instanceof HttpError ? error.message : 'ההתאמה נכשלה בשרת. נסו שוב.');
        })
        .finally(() => tailoring.delete(niche.key));
    }
    res.status(202).json(await readVariants(niche));
  });

  router.post('/generate', generateRateLimit, async (req, res) => {
    if (!coach) throw new HttpError(503, `עדכון החפיסה מהשיחות שלך ${NEEDS_COACH}`);
    const { language } = GenerateInput.parse(req.body ?? {});
    if (generating) throw new ConflictError('החפיסה כבר מתעדכנת.');
    generating = true;
    try {
      const leads = await stores.leads.list();
      const timelines = new Map(await Promise.all(leads.map(async (lead) => [lead.id, await stores.interactions.list(lead.id)] as const)));
      const existing = (await stores.training.cards()).filter((card) => !card.retired);
      const { system, prompt, refs, stats } = buildTrainingPrompt({
        leads,
        timelines,
        existing,
        language,
        businessContext: settings.businessContext,
        timeZone: settings.timeZone,
      });
      if (stats.entriesAnalyzed === 0) {
        throw new ConflictError('עדיין אין ממה ללמוד. תעדו כמה שיחות עם הערות, או חכו שהקלטות יתומללו, ונסו שוב.');
      }
      const answer = await coach.complete({ system, prompt, schema: DECK_JSON_SCHEMA, maxTokens: 12_000 });
      const parsed = Deck.safeParse(answer);
      if (!parsed.success) {
        console.error('The AI answer did not match the deck schema:', parsed.error.issues.slice(0, 5));
        throw new HttpError(502, 'ה-AI ענה בפורמט לא צפוי. נסו שוב.');
      }
      const drafts = toDrafts(parsed.data, refs);
      if (drafts.length === 0 && parsed.data.cards.length > 0) {
        throw new HttpError(502, 'הכרטיסיות של ה-AI לא ציטטו את השיחות שלך במדויק, אז אף אחת לא נשמרה. נסו שוב.');
      }
      // The common objections stay in the deck; the ones your prospects raised come with their own words
      const found = new Set(drafts.map((draft) => draft.key));
      const common = STARTER_CARDS.filter((card) => !found.has(card.key)).map(starterDraft);
      const run = await stores.training.saveRun(
        [...drafts, ...common],
        { provider: coach.name, model: coach.model, language, ...stats, cards: drafts.length },
        clock(),
      );
      res.status(201).json({ run, cards: inDeckOrder(await stores.training.cards()) });
    } finally {
      generating = false;
    }
  });

  router.post('/cards/:id/review', async (req, res) => {
    const { id } = CardParams.parse(req.params);
    const { grade, at } = ReviewInput.parse(req.body);
    const card = await stores.training.card(id);
    if (!card) throw new HttpError(404, 'הכרטיסייה הזו כבר לא בחפיסה.');
    const answeredAt = answerTime(at, clock());
    // The same answer sent again (its first try arrived, but the reply was lost on the way) counts once
    if (at && card.practice.lastReviewedAt?.getTime() === answeredAt.getTime()) {
      res.json(card);
      return;
    }
    const updated = await stores.training.updateCard(id, { practice: review(card.practice, grade, answeredAt, settings.timeZone) });
    if (!updated) throw new HttpError(404, 'הכרטיסייה הזו כבר לא בחפיסה.');
    res.json(updated);
  });

  router.patch('/cards/:id', async (req, res) => {
    const { id } = CardParams.parse(req.params);
    const { myResponse } = CardPatch.parse(req.body);
    const updated = await stores.training.updateCard(id, { myResponse });
    if (!updated) throw new HttpError(404, 'הכרטיסייה הזו כבר לא בחפיסה.');
    res.json(updated);
  });

  return router;
}
