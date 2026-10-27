import { Router } from 'express';
import { HttpError } from '../lib/http-error.js';
import type { MediaStorage } from '../media/storage.js';
import type { TranscriptionQueue } from '../transcription/queue.js';
import { ConflictError, type LeadRecord, type LeadUpdate, type Stores } from '../stores/types.js';
import { ActionInput, ActionParams, BulkCreateBody, BulkDeleteBody, LeadInput, LeadParams, LeadPatch } from './leads.schemas.js';
import { applyAction, stepTime, timelineEntryFor, undoAction, type WorkflowState } from './workflow.js';

const leadNotFound = () => new HttpError(404, 'הליד הזה כבר לא קיים.');

export interface LeadHooks {
  /** Leads were added, deleted, or had their number changed (the WhatsApp sync matches chats by number) */
  leadsChanged?(created?: string[]): void;
}

/** Mounted at /api/leads behind requireAuth. Matches src/data/repository/http.ts in the frontend. */
export function createLeadsRouter(
  stores: Stores,
  storage: MediaStorage,
  clock: () => Date,
  transcription: TranscriptionQueue | null = null,
  hooks: LeadHooks = {},
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

  /** Deletes leads with their timelines, coaching reports and recording files. */
  async function removeLeads(ids: string[]) {
    // Recordings first, while their storage keys are still known. Their transcripts stop too.
    const files = await stores.media.removeForLeads(ids);
    for (const file of files) transcription?.cancel(file.id);
    await Promise.all([
      stores.interactions.removeForLeads(ids),
      stores.coaching.removeForLeads(ids),
      stores.training.removeLeadSources(ids),
    ]);
    await store.removeMany(ids);
    hooks.leadsChanged?.();
    if (files.length) {
      await storage.remove(files.map((file) => file.storageKey)).catch((error: unknown) => {
        console.error("Some recording files couldn't be deleted:", error);
      });
    }
  }

  router.get('/', async (_req, res) => {
    res.json(await store.list());
  });

  router.post('/', async (req, res) => {
    const lead = await store.create(LeadInput.parse(req.body));
    hooks.leadsChanged?.([lead.id]);
    res.status(201).json(lead);
  });

  /** Bulk import: up to 500 leads in one write. Ids that already exist come back in skippedIds. */
  router.post('/bulk', async (req, res) => {
    const { leads } = BulkCreateBody.parse(req.body);
    const result = await store.createMany(leads);
    if (result.created.length) hooks.leadsChanged?.(result.created.map((lead) => lead.id));
    res.status(201).json(result);
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
    if (patch.phone !== undefined || patch.contactName !== undefined) hooks.leadsChanged?.(patch.phone !== undefined ? [id] : []);
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

  /** Undoing a step keeps what was written about it: the entry becomes a plain note. Empty entries go away. */
  router.post('/:id/actions/:actionId/undo', async (req, res) => {
    const { id, actionId } = ActionParams.parse(req.params);
    const lead = await changeWorkflow(id, (current) => undoAction(current, actionId, clock()));
    const entry = await stores.interactions.get(id, actionId);
    if (entry?.step) {
      const hasRecordings = (await stores.media.list(id)).some((file) => file.interactionId === actionId);
      if (entry.body || hasRecordings) {
        await stores.interactions.update(id, actionId, { kind: 'note', outcome: null, step: null, stageTo: null });
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
