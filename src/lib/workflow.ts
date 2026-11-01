import type { Activity, Channel, Interaction, InteractionOutcome, Lead, LeadAction, Stage } from '../types';
import { NO_DEAL } from './deal';
import { STAGE_META } from './stages';

// The same rules as server/src/leads/workflow.ts, so actions show instantly and match what the server stores.

const NEXT_STAGE: Record<Stage, Stage | null> = { cold_call: 'zoom', zoom: 'closed', closed: null };

/** How long a step can be undone. After that the funnel only moves forward. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;
const ACTIVITY_LIMIT = 200;

export class WorkflowError extends Error {}

export const nextStage = (stage: Stage) => NEXT_STAGE[stage];

/** Still being worked: not closed and not marked not relevant */
export const isOpen = (lead: Pick<Lead, 'stage' | 'archivedAt'>) => !lead.archivedAt && lead.stage !== 'closed';

/** The lead after the action. Returns the lead unchanged when the action was already applied. */
export function applyAction(lead: Lead, action: LeadAction, now: Date): Lead {
  if (lead.activity.some((entry) => entry.id === action.id)) return lead;
  if (lead.archivedAt) throw new WorkflowError('הליד הזה סומן כלא רלוונטי, אז אי אפשר לשנות אותו יותר.');
  if (lead.stage !== action.from) throw new WorkflowError(`הליד הזה כבר בשלב ${STAGE_META[lead.stage].label}.`);

  const at = now.toISOString();
  const log = (type: Activity['type'], to: Stage | null): Activity[] =>
    [
      {
        id: action.id,
        type,
        at,
        from: lead.stage,
        to,
        before: { stageChangedAt: lead.stageChangedAt, lastAttemptAt: lead.lastAttemptAt, attemptCount: lead.attemptCount },
      },
      ...lead.activity,
    ].slice(0, ACTIVITY_LIMIT);

  switch (action.type) {
    case 'advance': {
      const next = NEXT_STAGE[lead.stage];
      if (!next) throw new WorkflowError('העסקה הזו כבר סגורה.');
      return { ...lead, stage: next, stageChangedAt: at, activity: log('advanced', next), updatedAt: at };
    }
    case 'no_answer':
      if (lead.stage === 'closed') throw new WorkflowError('העסקה הזו כבר סגורה.');
      return {
        ...lead,
        attemptCount: lead.attemptCount + 1,
        lastAttemptAt: at,
        activity: log('no_answer', null),
        updatedAt: at,
      };
    case 'answered':
      // A conversation that didn't move the deal. It counts as today's contact.
      if (lead.stage === 'closed') throw new WorkflowError('העסקה הזו כבר סגורה.');
      return { ...lead, lastAttemptAt: at, activity: log('answered', null), updatedAt: at };
    case 'archive':
      if (lead.stage === 'closed') throw new WorkflowError('אי אפשר לסמן עסקה סגורה כלא רלוונטית.');
      return { ...lead, archivedAt: at, activity: log('archived', null), updatedAt: at };
  }
}

/** Whether the lead's most recent step is this one and still inside the undo window. */
export function canUndo(lead: Lead, actionId: string, now = Date.now()): boolean {
  const latest = lead.activity[0];
  return Boolean(latest && latest.id === actionId && now - Date.parse(latest.at) <= UNDO_WINDOW_MS);
}

export function undoAction(lead: Lead, actionId: string, now: Date): Lead {
  if (!canUndo(lead, actionId, now.getTime())) {
    throw new WorkflowError('אפשר לבטל רק את הצעד האחרון, ורק עד 10 דקות אחריו.');
  }
  const [latest, ...rest] = lead.activity;
  return {
    ...lead,
    stage: latest.from,
    stageChangedAt: latest.before.stageChangedAt,
    archivedAt: latest.type === 'archived' ? null : lead.archivedAt,
    attemptCount: latest.before.attemptCount,
    lastAttemptAt: latest.before.lastAttemptAt,
    // The amounts belong to the closed deal, so reopening it clears them.
    deal: latest.to === 'closed' ? { ...NO_DEAL } : lead.deal,
    activity: rest,
    updatedAt: now.toISOString(),
  };
}

/** A step that counts as a call: every outcome of a cold call, and follow-ups that were tried or picked up. */
export const isCall = (entry: Activity) => entry.type === 'no_answer' || entry.type === 'answered' || entry.from === 'cold_call';

/** Picked up at least once: contacted, so it no longer comes up in the random daily draw. */
export const wasAnswered = (lead: Pick<Lead, 'activity'>) => lead.activity.some((entry) => entry.type === 'answered');

/**
 * The timeline entry a step creates (server/src/leads/workflow.ts does the same): a phone call while
 * the lead is at Cold Call and a Zoom meeting once it is at Zoom Meeting, unless `channel` says otherwise.
 */
export function timelineEntryFor(entry: Activity, leadId: string, body = '', channel?: Channel): Interaction {
  const meeting = (channel ?? (entry.from === 'zoom' ? 'zoom' : 'call')) === 'zoom';
  const outcome: Record<Activity['type'], InteractionOutcome | null> = {
    advanced: meeting ? 'held' : 'answered',
    answered: meeting ? 'held' : 'answered',
    no_answer: meeting ? 'no_show' : 'no_answer',
    archived: null,
  };
  return {
    id: entry.id,
    leadId,
    kind: meeting ? 'zoom' : 'call',
    outcome: outcome[entry.type],
    body: body.trim(),
    step: entry.type,
    stage: entry.from,
    stageTo: entry.to,
    at: entry.at,
    updatedAt: entry.at,
  };
}

/**
 * What undoing a step does to its timeline entry: what was written stays, as a plain note.
 * An entry with no notes and no recordings goes away (null).
 */
export function entryAfterUndo(entry: Interaction, hasRecordings: boolean): Interaction | null {
  if (!entry.body && !hasRecordings) return null;
  return { ...entry, kind: 'note', outcome: null, step: null, stageTo: null };
}

/** Calls logged in the calendar month of `now`, in this browser's time zone. */
export function callsThisMonth(leads: readonly Lead[], now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  let calls = 0;
  for (const lead of leads) {
    for (const entry of lead.activity) {
      const at = Date.parse(entry.at);
      if (at >= start && at < end && isCall(entry)) calls += 1;
    }
  }
  return calls;
}

/** The lead's latest step inside the day, which is its outcome in that day's queue. */
export function outcomeBetween(lead: Lead, startsAt: string, endsAt: string): Activity | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return lead.activity.find((entry) => Date.parse(entry.at) >= start && Date.parse(entry.at) < end) ?? null;
}
