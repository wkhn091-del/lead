import type { Activity, Grade, Interaction, Lead, LeadAction, LeadPatch, MessageKind, NewLead, ObjectionCard, Stage, StepDetails } from '../types';
import { patchLead } from './leads';
import { review } from './practice';
import { applyAction, entryAfterUndo, nextStage, timelineEntryFor, undoAction } from './workflow';

/**
 * The outbox: every change to the server's data is written here first and sent from here (src/store/sync.ts), so
 * nothing written is lost when the phone has no signal, the server is still waking up, or the page is closed
 * before a request finished. A change that can't be sent yet waits and is sent again later; the server applies
 * each one once however many times it arrives (ids made here, and the times things happened).
 *
 * This file is the part without side effects: what a change is, whether a failure is worth another try, and how
 * the changes still waiting look on top of what the server last sent.
 */

export type OutboxOp =
  | { kind: 'create-lead'; lead: NewLead }
  /** `stamp`: the lead's updatedAt shown after the edit, so the server's copy replaces it only if nothing changed since */
  | { kind: 'update-lead'; leadId: string; patch: LeadPatch; stamp: string }
  /** `at`: when the step was taken, kept by the server for a step sent late */
  | { kind: 'act'; leadId: string; action: LeadAction; details: StepDetails; at: string }
  | { kind: 'undo'; leadId: string; actionId: string }
  | { kind: 'remove-lead'; leadId: string }
  | { kind: 'remove-leads'; leadIds: string[] }
  | { kind: 'add-entry'; leadId: string; entry: { id: string; kind: MessageKind; body: string; at: string; stage: Stage } }
  /** `base`: the entry as it was when editing began, to spot a transcript that arrived meanwhile */
  | { kind: 'edit-entry'; leadId: string; entryId: string; body: string; base: { body: string; updatedAt: string } | null }
  | { kind: 'remove-entry'; leadId: string; entryId: string }
  | { kind: 'card-review'; cardId: string; grade: Grade; at: string }
  | { kind: 'card-response'; cardId: string; myResponse: string };

export type OutboxKind = OutboxOp['kind'];

export interface OutboxItem {
  id: string;
  op: OutboxOp;
  createdAt: string;
  /** Tries that failed and will be tried again */
  attempts: number;
  /** Why the last try failed, in words for the app */
  error: string | null;
}

/** A change the server refused, kept so what was written can still be copied */
export interface DroppedItem {
  id: string;
  op: OutboxOp;
  reason: string;
  at: string;
}

/**
 * What to do after a failed try:
 * - retry: no connection, the server didn't answer or is busy; send it again later
 * - signed-out: the session ended; hold everything until signing in again
 * - done: it had already happened (a lost reply to an earlier try, or the same change from elsewhere)
 * - reject: the server won't take it (the lead is gone, the step no longer fits); drop it and explain
 */
export type Verdict = 'retry' | 'signed-out' | 'done' | 'reject';

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};

export function verdictFor(op: OutboxOp, error: unknown): Verdict {
  const status = statusOf(error);
  // No answer at all, a timeout, too many requests, or a server error (Render waking up answers 502 through Vercel)
  if (status === null || status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';
  if (status === 401) return 'signed-out';
  if (status === 404 && (op.kind === 'remove-lead' || op.kind === 'remove-leads' || op.kind === 'remove-entry')) return 'done';
  if (status === 409 && op.kind === 'create-lead') return 'done';
  return 'reject';
}

/** Seconds to wait before trying again, after this many failures in a row */
export function retryDelay(failures: number): number {
  const steps = [2, 5, 10, 20, 30, 60];
  return steps[Math.min(Math.max(failures, 1), steps.length) - 1] * 1000;
}

/** The lead a change is about, if it's about one */
export function leadOf(op: OutboxOp): string | null {
  switch (op.kind) {
    case 'create-lead':
      return op.lead.id;
    case 'remove-leads':
    case 'card-review':
    case 'card-response':
      return null;
    default:
      return op.leadId;
  }
}

/** Text that was written in the change, to copy when the server refused it */
export function writtenText(op: OutboxOp): string {
  switch (op.kind) {
    case 'add-entry':
      return op.entry.body;
    case 'edit-entry':
      return op.body;
    case 'act':
      return op.details.body?.trim() ?? '';
    case 'card-response':
      return op.myResponse;
    case 'create-lead':
      return [op.lead.name, op.lead.phone, ...op.lead.notes.map((note) => note.body)].filter(Boolean).join('\n');
    case 'update-lead':
      return Object.values(op.patch).filter((value): value is string => typeof value === 'string').join('\n');
    default:
      return '';
  }
}

const ACTIVITY_TYPE: Record<LeadAction['type'], Activity['type']> = {
  advance: 'advanced',
  no_answer: 'no_answer',
  answered: 'answered',
  archive: 'archived',
};

/**
 * The leads as the server sent them, with the changes still waiting applied on top, in the order they were made.
 * A change that no longer fits (the lead moved on elsewhere) is skipped here; the server will say so when it's sent.
 */
export function overlayLeads(leads: readonly Lead[], ops: readonly OutboxOp[]): Lead[] {
  let result = [...leads];
  const mapLead = (id: string, change: (lead: Lead) => Lead) => {
    result = result.map((lead) => (lead.id === id ? change(lead) : lead));
  };
  for (const op of ops) {
    switch (op.kind) {
      case 'create-lead':
        if (!result.some((lead) => lead.id === op.lead.id)) {
          const { notes: _notes, ...lead } = op.lead;
          result = [lead, ...result];
        }
        break;
      case 'update-lead':
        mapLead(op.leadId, (lead) => patchLead(lead, op.patch));
        break;
      case 'act':
        mapLead(op.leadId, (lead) => {
          try {
            return applyAction(lead, op.action, new Date(op.at));
          } catch {
            return lead;
          }
        });
        break;
      case 'undo':
        mapLead(op.leadId, (lead) => {
          const latest = lead.activity[0];
          if (latest?.id !== op.actionId) return lead;
          // Undone when it was still allowed; what matters now is that it was
          return undoAction(lead, op.actionId, new Date(latest.at));
        });
        break;
      case 'remove-lead':
        result = result.filter((lead) => lead.id !== op.leadId);
        break;
      case 'remove-leads': {
        const doomed = new Set(op.leadIds);
        result = result.filter((lead) => !doomed.has(lead.id));
        break;
      }
      default:
        break;
    }
  }
  return result;
}

const newestFirst = (a: Interaction, b: Interaction) => Date.parse(b.at) - Date.parse(a.at);

/** A lead's timeline as the server sent it, with the changes to it still waiting applied on top */
export function overlayTimeline(
  leadId: string,
  interactions: readonly Interaction[],
  ops: readonly OutboxOp[],
  hasRecordings: (entryId: string) => boolean = () => false,
): Interaction[] {
  let entries = [...interactions];
  for (const op of ops) {
    if (leadOf(op) !== leadId) continue;
    switch (op.kind) {
      case 'act': {
        if (entries.some((entry) => entry.id === op.action.id)) break;
        const to = op.action.type === 'advance' ? nextStage(op.action.from) : null;
        const step: Activity = {
          id: op.action.id,
          type: ACTIVITY_TYPE[op.action.type],
          at: op.at,
          from: op.action.from,
          to,
          before: { stageChangedAt: op.at, lastAttemptAt: null, attemptCount: 0 },
        };
        entries.push(timelineEntryFor(step, leadId, op.details.body, op.details.channel));
        break;
      }
      case 'undo':
        entries = entries.flatMap((entry) => {
          if (entry.id !== op.actionId || !entry.step) return [entry];
          const after = entryAfterUndo(entry, hasRecordings(entry.id));
          return after ? [after] : [];
        });
        break;
      case 'add-entry':
        if (!entries.some((entry) => entry.id === op.entry.id)) {
          const { id, kind, body, at, stage } = op.entry;
          entries.push({ id, leadId, kind, outcome: null, body, step: null, stage, stageTo: null, at, updatedAt: at });
        }
        break;
      case 'edit-entry':
        entries = entries.map((entry) => (entry.id === op.entryId ? { ...entry, body: op.body } : entry));
        break;
      case 'remove-entry':
        entries = entries.filter((entry) => entry.id !== op.entryId);
        break;
      default:
        break;
    }
  }
  return entries.sort(newestFirst);
}

/** The practice cards as the server sent them, with answers and reviews still waiting applied on top */
export function overlayCards(cards: readonly ObjectionCard[], ops: readonly OutboxOp[]): ObjectionCard[] {
  let result = [...cards];
  for (const op of ops) {
    if (op.kind === 'card-response') {
      result = result.map((card) => (card.id === op.cardId ? { ...card, myResponse: op.myResponse } : card));
    } else if (op.kind === 'card-review') {
      result = result.map((card) =>
        card.id === op.cardId && card.practice.lastReviewedAt !== op.at ? { ...card, practice: review(card.practice, op.grade, new Date(op.at)) } : card,
      );
    }
  }
  return result;
}
