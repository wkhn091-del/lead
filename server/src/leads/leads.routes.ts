import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { HttpError } from '../lib/http-error.js';
import type { MediaStorage } from '../media/storage.js';
import type { TranscriptionQueue } from '../transcription/queue.js';
import { ConflictError, type LeadRecord, type LeadUpdate, type Stores } from '../stores/types.js';
import { planJsonImport, withDetailsInNote, type JsonLeadDraft, type JsonSkip } from './json-import.js';
import { ActionInput, ActionParams, BulkCreateBody, BulkDeleteBody, JsonImportBody, JsonMappingQuery, LeadInput, LeadParams, LeadPatch } from './leads.schemas.js';
import { applyAction, stepTime, timelineEntryFor, undoAction, type WorkflowState } from './workflow.js';

const leadNotFound = () => new HttpError(404, 'הליד הזה כבר לא קיים.');


/**
 * Mounted at /api/leads. Matches src/data/repository/http.ts in the frontend. `countryCode` reads local numbers
 * (054…) when matching phone numbers; `timeZone` dates what the app is told (when a lead was deleted).
 */
export function createLeadsRouter(
  stores: Stores,
  storage: MediaStorage,
  clock: () => Date,
  transcription: TranscriptionQueue | null = null,
  countryCode = '972',
  timeZone = 'Asia/Jerusalem',
) {
  const router = Router();
  const store = stores.leads;

  /** Reads the lead, computes its next workflow state and saves it, retrying if it changed in between. */
  async function changeWorkflow(id: string, change: (lead: LeadRecord) => WorkflowState | null): Promise<LeadRecord> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const lead = await store.get(id);
      if (!lead) throw leadNotFound();
      const next = change(lead);
      if (!next) return lead; // already applied: a retried request
      const saved = await store.saveWorkflow(id, lead.updatedAt, next);
      if (saved) return saved;
    }
    throw new ConflictError('הליד הזה משתנה כרגע במקום אחר. נסו שוב.');
  }

  /**
   * Deletes leads with their timelines, coaching reports and recording files. What identified each business is
   * kept, so it's recognised if it comes again (a new lead, an import, the Prospector).
   */
  async function removeLeads(ids: string[]) {
    const deletedAt = clock();
    const doomed = await store.identities(ids);
    await stores.deletedLeads.record(
      doomed.map(({ id, name, phone, email, website, city, mapsUrl }) => ({ id, name, phone, email, website, city, mapsUrl, deletedAt })),
    );
    // Recordings first, while their storage keys are still known. Their transcripts stop too.
    const files = await stores.media.removeForLeads(ids);
    for (const file of files) transcription?.cancel(file.id);
    await Promise.all([
      stores.interactions.removeForLeads(ids),
      stores.coaching.removeForLeads(ids),
      stores.training.removeLeadSources(ids),
    ]);
    await store.removeMany(ids);
    if (files.length) {
      await storage.remove(files.map((file) => file.storageKey)).catch((error: unknown) => {
        console.error("Some recording files couldn't be deleted:", error);
      });
    }
  }

  router.get('/', async (_req, res) => {
    res.json(await store.list());
  });

  /**
   * The deleted leads, as what identified each business, newest first: the app tells a new lead or a pasted one
   * was in the CRM before. Before /:id routes, so "deleted" isn't read as an id.
   */
  router.get('/deleted', async (_req, res) => {
    res.json(await stores.deletedLeads.list());
  });

  router.post('/', async (req, res) => {
    const lead = await store.create(LeadInput.parse(req.body));
    // A deleted lead saved again (its deletion undone) isn't a deleted one anymore
    await stores.deletedLeads.forget([lead.id]);
    res.status(201).json(lead);
  });

  /** Bulk import: up to 500 leads in one write. Ids that already exist come back in skippedIds. */
  router.post('/bulk', async (req, res) => {
    const { leads } = BulkCreateBody.parse(req.body);
    const result = await store.createMany(leads);
    await stores.deletedLeads.forget(result.created.map((lead) => lead.id));
    res.status(201).json(result);
  });

  /**
   * Leads pasted as a JSON array: [{ name, phone, source, niche, notes }], each field found by any of its usual
   * names, or from the key chosen for it in the address (?name=title&phone=mobile&niche=category). Before the
   * insert, every business is looked up among the leads and the deleted leads (by number in any format, Google
   * Maps place, website, email, or name and city: identity.ts), and so are the ones repeated in the paste: only new
   * businesses are saved, every one as a new lead ("חדש"). One that was deleted is skipped with the date. A lead
   * that's in the paste gets what it's missing of its number, city, Maps link and website. Answers what was
   * created, what was filled in, and what was skipped and why.
   */
  router.post('/import-json', async (req, res) => {
    const items = JsonImportBody.parse(req.body);
    const mapping = JsonMappingQuery.parse(req.query);
    const [current, deleted] = await Promise.all([store.identities(), stores.deletedLeads.list()]);
    const plan = planJsonImport(items, [...current, ...deleted], countryCode, mapping, timeZone);
    const skipped: JsonSkip[] = [...plan.skipped];
    const now = clock().getTime();
    const inputs: LeadInput[] = [];
    plan.leads.forEach((draft, order) => {
      // A moment apart, so the paste keeps its order in lists sorted by when leads were added
      const createdAt = new Date(now - order).toISOString();
      const id = randomUUID();
      const input = (lead: JsonLeadDraft) =>
        LeadInput.safeParse({
          id,
          name: lead.name,
          contactName: lead.contactName,
          phone: lead.phone,
          email: lead.email,
          website: lead.website,
          city: lead.city,
          mapsUrl: lead.mapsUrl,
          campaign: lead.campaign,
          method: 'call',
          // Every imported lead starts its timeline with this note (it opens with "יובא מקובץ JSON")
          notes: [{ id: randomUUID(), body: lead.note, createdAt }],
          createdAt,
        });
      let parsed = input(draft);
      // A contact, email or website the lead can't take doesn't cost the lead: it's kept in the note instead
      if (!parsed.success && (draft.contactName || draft.email || draft.website)) parsed = input(withDetailsInNote(draft));
      if (parsed.success) inputs.push(parsed.data);
      else skipped.push({ index: draft.index, name: draft.name, phone: draft.phone, reason: 'invalid', message: parsed.error.issues[0].message });
    });
    // One insertMany for all of them (createMany), with their notes on the timeline
    const created = inputs.length ? (await store.createMany(inputs)).created : [];
    // Then what the leads already here were missing, each checked like an edit
    const updated: LeadRecord[] = [];
    for (const fill of plan.fills) {
      const patch = LeadPatch.safeParse(fill.details);
      if (!patch.success) continue;
      const { deal: _never, ...details } = patch.data;
      const lead = await store.update(fill.id, details);
      if (lead) updated.push(lead);
    }
    res.status(201).json({ created, updated, skipped: skipped.sort((a, b) => a.index - b.index), ignoredFields: plan.ignoredFields });
  });

  router.post('/bulk-delete', async (req, res) => {
    const { ids } = BulkDeleteBody.parse(req.body);
    await removeLeads(ids);
    res.status(204).end();
  });

  router.patch('/:id', async (req, res) => {
    const { id } = LeadParams.parse(req.params);
    const { deal, ...details } = LeadPatch.parse(req.body);
    let patch: LeadUpdate = details;
    if (deal !== undefined || details.currency !== undefined) {
      const current = await store.get(id);
      if (!current) throw leadNotFound();
      if (current.stage !== 'closed') throw new ConflictError('אפשר להוסיף את סכומי העסקה רק אחרי שהעסקה נסגרה.');
      // Any of the three amounts can be sent alone; the rest stay as they are.
      if (deal) patch = { ...details, deal: { ...current.deal, ...deal } };
    }
    const lead = await store.update(id, patch);
    if (!lead) throw leadNotFound();
    res.json(lead);
  });

  /**
   * Workflow steps: advance to the next stage, log a call that wasn't answered or was answered without
   * moving on, or mark not relevant. Each step also becomes a timeline entry, with the notes sent along.
   */
  router.post('/:id/actions', async (req, res) => {
    const { id } = LeadParams.parse(req.params);
    const { body, channel, at, ...action } = ActionInput.parse(req.body);
    const lead = await changeWorkflow(id, (current) => applyAction(current, action, stepTime(at, current, clock())));
    // Written on every attempt, so a retry repairs an entry whose first write failed. The same id is saved once.
    const step = lead.activity.find((entry) => entry.id === action.id);
    if (step) await stores.interactions.create({ ...timelineEntryFor(step, channel), leadId: id, body });
    res.json(lead);
  });

  /**
   * Undoing a step keeps what was written about it: the entry becomes a plain note (a WhatsApp step's, a plain
   * WhatsApp message). Empty entries go away.
   */
  router.post('/:id/actions/:actionId/undo', async (req, res) => {
    const { id, actionId } = ActionParams.parse(req.params);
    const lead = await changeWorkflow(id, (current) => undoAction(current, actionId, clock()));
    const entry = await stores.interactions.get(id, actionId);
    if (entry?.step) {
      const hasRecordings = (await stores.media.list(id)).some((file) => file.interactionId === actionId);
      if (entry.body || hasRecordings) {
        await stores.interactions.update(id, actionId, { kind: entry.kind === 'whatsapp' ? 'whatsapp' : 'note', outcome: null, step: null, stageTo: null });
      } else {
        await stores.interactions.remove(id, actionId);
      }
    }
    res.json(lead);
  });

  // Idempotent: deleting a lead that is already gone still succeeds.
  router.delete('/:id', async (req, res) => {
    const { id } = LeadParams.parse(req.params);
    await removeLeads([id]);
    res.status(204).end();
  });

  return router;
}
