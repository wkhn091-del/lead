import { ConflictError } from '../stores/types.js';

/** The sales funnel, in order */
export const STAGES = ['cold_call', 'zoom', 'closed'] as const;
export type Stage = (typeof STAGES)[number];

/** advance and archive move the lead; no_answer and answered log a call (or meeting) at the current stage */
export const ACTION_TYPES = ['advance', 'no_answer', 'answered', 'archive'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

const NEXT_STAGE: Record<Stage, Stage | null> = { cold_call: 'zoom', zoom: 'closed', closed: null };
/** The stage names on the seller's screen (src/lib/stages.ts in the frontend) */
const STAGE_LABEL: Record<Stage, string> = { cold_call: 'שיחה קרה', zoom: 'פגישת זום', closed: 'עסקה סגורה' };

/** How long a step can be undone. After that the funnel only moves forward. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;
/** How late a step can arrive and still keep the time it happened (logged offline, sent when the phone reconnected) */
export const LATE_STEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The time to record a step at: when it happened, if the app says so, within the last week and never before the
 * lead's latest step (so the history stays in order) or after now. Otherwise now.
 */
export function stepTime(requested: string | undefined, lead: Pick<WorkflowState, 'activity'>, now: Date): Date {
  const at = requested ? Date.parse(requested) : Number.NaN;
  if (Number.isNaN(at)) return now;
  const earliest = Math.max(now.getTime() - LATE_STEP_MS, lead.activity[0]?.at.getTime() ?? Number.NEGATIVE_INFINITY);
  return new Date(Math.min(now.getTime(), Math.max(at, earliest)));
}
const ACTIVITY_LIMIT = 200;

export interface ActivityRecord {
  id: string;
  type: 'advanced' | 'no_answer' | 'answered' | 'archived';
  at: Date;
  from: Stage;
  to: Stage | null;
  before: { stageChangedAt: Date; lastAttemptAt: Date | null; attemptCount: number };
}

/**
 * What a closed deal brings in, in whole units of the lead's currency: the build, the monthly retainer for
 * maintenance and management, and the yearly domain and hosting renewal.
 */
export interface DealTerms {
  setupFee: number;
  monthlyRetainer: number;
  hostingYearly: number;
}

export const NO_DEAL: DealTerms = Object.freeze({ setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 });

/** The fields of a lead that only workflow actions change (and the deal's amounts, which only a closed deal has) */
export interface WorkflowState {
  stage: Stage;
  stageChangedAt: Date;
  archivedAt: Date | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  deal: DealTerms;
  /** Newest first */
  activity: ActivityRecord[];
}

export interface LeadAction {
  /** Client-generated, so a retried request is applied once */
  id: string;
  type: ActionType;
  /** The stage the client saw. A mismatch means the lead moved elsewhere. */
  from: Stage;
}

/** The lead's next state, or null when this action was already applied. */
export function applyAction(lead: WorkflowState, action: LeadAction, now: Date): WorkflowState | null {
  if (lead.activity.some((entry) => entry.id === action.id)) return null;
  if (lead.archivedAt) throw new ConflictError('הליד הזה סומן כלא רלוונטי, אז אי אפשר לשנות אותו יותר.');
  if (lead.stage !== action.from) throw new ConflictError(`הליד הזה כבר בשלב ${STAGE_LABEL[lead.stage]}.`);

  const log = (type: ActivityRecord['type'], to: Stage | null): ActivityRecord[] =>
    [
      {
        id: action.id,
        type,
        at: now,
        from: lead.stage,
        to,
        before: { stageChangedAt: lead.stageChangedAt, lastAttemptAt: lead.lastAttemptAt, attemptCount: lead.attemptCount },
      },
      ...lead.activity,
    ].slice(0, ACTIVITY_LIMIT);

  switch (action.type) {
    case 'advance': {
      const next = NEXT_STAGE[lead.stage];
      if (!next) throw new ConflictError('העסקה הזו כבר סגורה.');
      return { ...lead, stage: next, stageChangedAt: now, activity: log('advanced', next) };
    }
    case 'no_answer':
      if (lead.stage === 'closed') throw new ConflictError('העסקה הזו כבר סגורה.');
      return { ...lead, attemptCount: lead.attemptCount + 1, lastAttemptAt: now, activity: log('no_answer', null) };
    case 'answered':
      // A call that connected without moving the deal ("call me next month"): it counts as today's contact.
      if (lead.stage === 'closed') throw new ConflictError('העסקה הזו כבר סגורה.');
      return { ...lead, lastAttemptAt: now, activity: log('answered', null) };
    case 'archive':
      if (lead.stage === 'closed') throw new ConflictError('אי אפשר לסמן עסקה סגורה כלא רלוונטית.');
      return { ...lead, archivedAt: now, activity: log('archived', null) };
  }
}

/** Reverses the lead's most recent step, within the undo window. */
export function undoAction(lead: WorkflowState, actionId: string, now: Date): WorkflowState {
  const [latest] = lead.activity;
  if (!latest || latest.id !== actionId) throw new ConflictError('אפשר לבטל רק את הצעד האחרון.');
  if (now.getTime() - latest.at.getTime() > UNDO_WINDOW_MS) {
    throw new ConflictError('אפשר לבטל צעד רק עד 10 דקות אחריו.');
  }
  return {
    ...lead,
    stage: latest.from,
    stageChangedAt: latest.before.stageChangedAt,
    archivedAt: latest.type === 'archived' ? null : lead.archivedAt,
    attemptCount: latest.before.attemptCount,
    lastAttemptAt: latest.before.lastAttemptAt,
    // The amounts belong to the closed deal, so reopening it clears them.
    deal: latest.to === 'closed' ? { ...NO_DEAL } : lead.deal,
    activity: lead.activity.slice(1),
  };
}

export type InteractionOutcome = 'no_answer' | 'answered' | 'held' | 'no_show';

/**
 * The timeline entry a workflow step creates, with the step's id. Unless `channel` says otherwise, it is
 * a phone call while the lead is at Cold Call and a Zoom meeting once it is at Zoom Meeting.
 */
export function timelineEntryFor(entry: ActivityRecord, channel?: 'call' | 'zoom') {
  const meeting = (channel ?? (entry.from === 'zoom' ? 'zoom' : 'call')) === 'zoom';
  const outcome: Record<ActivityRecord['type'], InteractionOutcome | null> = {
    advanced: meeting ? 'held' : 'answered',
    answered: meeting ? 'held' : 'answered',
    no_answer: meeting ? 'no_show' : 'no_answer',
    archived: null,
  };
  return {
    id: entry.id,
    kind: meeting ? ('zoom' as const) : ('call' as const),
    outcome: outcome[entry.type],
    step: entry.type,
    stage: entry.from,
    stageTo: entry.to,
    at: entry.at,
  };
}
