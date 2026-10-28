import { timelineEntryFor, type ActivityRecord } from '../leads/workflow.js';
import type { NewInteraction } from './types.js';

/** A lead document as an earlier version stored it, read raw from MongoDB (dates as {$date}) */
export interface LegacyLeadDocument {
  _id: string;
  notes?: { id?: unknown; body?: unknown; createdAt?: unknown }[];
  activity?: { id?: unknown; type?: unknown; at?: unknown; from?: unknown; to?: unknown }[];
}

const STEP_TYPES = new Set(['advanced', 'no_answer', 'answered', 'archived']);
const STAGES = new Set(['cold_call', 'zoom', 'closed']);

function toDate(value: unknown): Date | null {
  const raw = typeof value === 'object' && value !== null && '$date' in value ? (value as { $date: unknown }).$date : value;
  const date = typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * Timeline entries for a lead saved before the timeline existed: one per logged step (with no notes,
 * since steps didn't carry any) and one per old note. Entries keep the old ids, so running it twice adds nothing.
 */
export function legacyTimeline(lead: LegacyLeadDocument): NewInteraction[] {
  const entries: NewInteraction[] = [];
  for (const step of lead.activity ?? []) {
    const at = toDate(step.at);
    if (typeof step.id !== 'string' || !STEP_TYPES.has(String(step.type)) || !STAGES.has(String(step.from)) || !at) continue;
    const record = {
      id: step.id,
      type: step.type as ActivityRecord['type'],
      at,
      from: step.from as ActivityRecord['from'],
      to: STAGES.has(String(step.to)) ? (step.to as ActivityRecord['from']) : null,
      before: { stageChangedAt: at, lastAttemptAt: null, attemptCount: 0 },
    };
    entries.push({ ...timelineEntryFor(record), leadId: lead._id, body: '' });
  }

  // Notes come last, and each takes the stage the lead was at when it was written.
  const steps = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const note of lead.notes ?? []) {
    const at = toDate(note.createdAt);
    const body = typeof note.body === 'string' ? note.body.trim() : '';
    if (typeof note.id !== 'string' || !body || !at) continue;
    const previous = steps.filter((step) => step.at <= at).at(-1);
    const stage = previous ? (previous.stageTo ?? previous.stage) : 'cold_call';
    entries.push({ id: note.id, leadId: lead._id, kind: 'note', outcome: null, body, step: null, stage, stageTo: null, at });
  }
  return entries;
}
