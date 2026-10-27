import { describe, expect, it } from 'vitest';
import { ApiError } from '../data/repository/http';
import type { Interaction, Lead, ObjectionCard } from '../types';
import { NO_DEAL } from './deal';
import { leadOf, overlayCards, overlayLeads, overlayTimeline, retryDelay, verdictFor, writtenText, type OutboxOp } from './outbox';

const lead = (id: string, overrides: Partial<Lead> = {}): Lead => ({
  id,
  name: `Business ${id}`,
  contactName: '',
  phone: '',
  email: '',
  website: '',
  campaign: '',
  approach: '',
  method: 'call',
  stage: 'cold_call',
  stageChangedAt: '2026-10-20T08:00:00.000Z',
  archivedAt: null,
  attemptCount: 0,
  lastAttemptAt: null,
  deal: { ...NO_DEAL },
  currency: 'ILS',
  activity: [],
  createdAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '2026-10-20T08:00:00.000Z',
  ...overrides,
});

const act = (leadId: string, id: string, type: 'advance' | 'no_answer' | 'answered' | 'archive', at: string, body = ''): OutboxOp => ({
  kind: 'act',
  leadId,
  action: { id, type, from: 'cold_call' },
  details: { body },
  at,
});

describe('the outbox', () => {
  it('tries again when the server can’t be reached, and drops only what it refuses', () => {
    const note: OutboxOp = { kind: 'add-entry', leadId: 'l1', entry: { id: 'n1', kind: 'note', body: 'Hi', at: '2026-10-27T08:00:00.000Z', stage: 'cold_call' } };
    // No connection, a timeout, Render waking up behind Vercel, too many requests
    expect([0, 408, 429, 500, 502, 503, 504].map((status) => verdictFor(note, new ApiError(status, '')))).toEqual(Array(7).fill('retry'));
    expect(verdictFor(note, new TypeError('Failed to fetch'))).toBe('retry');
    expect(verdictFor(note, new ApiError(401, ''))).toBe('signed-out');
    // The lead was deleted elsewhere: the note can't go in
    expect(verdictFor(note, new ApiError(404, ''))).toBe('reject');
    expect(verdictFor(note, new ApiError(400, ''))).toBe('reject');
    // Already done by an earlier try whose answer was lost
    expect(verdictFor({ kind: 'remove-lead', leadId: 'l1' }, new ApiError(404, ''))).toBe('done');
    expect(verdictFor({ kind: 'remove-entry', leadId: 'l1', entryId: 'n1' }, new ApiError(404, ''))).toBe('done');
    expect(verdictFor({ kind: 'create-lead', lead: { ...lead('l2'), notes: [] } }, new ApiError(409, ''))).toBe('done');
    // A step that no longer fits (the lead moved on elsewhere)
    expect(verdictFor(act('l1', 's1', 'no_answer', ''), new ApiError(409, ''))).toBe('reject');

    expect([1, 2, 3, 6, 20].map(retryDelay)).toEqual([2000, 5000, 10_000, 60_000, 60_000]);
    expect(leadOf(note)).toBe('l1');
    expect(writtenText(note)).toBe('Hi');
    expect(writtenText(act('l1', 's1', 'answered', '', 'He asked for a quote.'))).toBe('He asked for a quote.');
  });

  it('shows the changes still waiting on top of the leads the server sent', () => {
    const server = [lead('l1'), lead('l2'), lead('l3')];
    const pending: OutboxOp[] = [
      { kind: 'create-lead', lead: { ...lead('new', { name: 'Galilee Garage' }), notes: [{ id: 'x', body: 'Met at the fair', createdAt: '' }] } },
      { kind: 'update-lead', leadId: 'l1', patch: { phone: '050-000-0001' }, stamp: '2026-10-27T08:00:00.000Z' },
      act('l2', 's1', 'no_answer', '2026-10-27T08:10:00.000Z'),
      act('l2', 's2', 'advance', '2026-10-27T08:20:00.000Z'),
      { kind: 'undo', leadId: 'l2', actionId: 's2' },
      { kind: 'remove-lead', leadId: 'l3' },
    ];
    const shown = overlayLeads(server, pending);
    expect(shown.map((item) => item.id)).toEqual(['new', 'l1', 'l2']);
    expect(shown[0]).not.toHaveProperty('notes');
    expect(shown[1].phone).toBe('050-000-0001');
    // The call kept its time; the Zoom booked after it was undone
    expect(shown[2]).toMatchObject({ stage: 'cold_call', attemptCount: 1, lastAttemptAt: '2026-10-27T08:10:00.000Z' });
    expect(shown[2].activity.map((step) => step.id)).toEqual(['s1']);

    // Once the server has a change, showing it again changes nothing
    const again = overlayLeads(shown, pending);
    expect(again[2].attemptCount).toBe(1);
    // A step that no longer fits is left for the server to refuse
    expect(overlayLeads([lead('l2', { stage: 'closed' })], [act('l2', 's3', 'no_answer', '2026-10-27T09:00:00.000Z')])[0].activity).toEqual([]);
  });

  it('shows the timeline changes still waiting, in time order', () => {
    const server: Interaction[] = [
      { id: 'old', leadId: 'l1', kind: 'note', outcome: null, body: 'First note', step: null, stage: 'cold_call', stageTo: null, at: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z' },
    ];
    const pending: OutboxOp[] = [
      act('l1', 'call', 'answered', '2026-10-27T08:00:00.000Z', 'Wants a menu page.'),
      { kind: 'add-entry', leadId: 'l1', entry: { id: 'wa', kind: 'whatsapp', body: 'Sent the mockup', at: '2026-10-27T08:05:00.000Z', stage: 'cold_call' } },
      { kind: 'edit-entry', leadId: 'l1', entryId: 'old', body: 'First note, edited', base: null },
      act('l1', 'empty', 'no_answer', '2026-10-27T08:30:00.000Z'),
      { kind: 'undo', leadId: 'l1', actionId: 'empty' },
      { kind: 'add-entry', leadId: 'other', entry: { id: 'x', kind: 'note', body: 'Not this lead', at: '2026-10-27T09:00:00.000Z', stage: 'cold_call' } },
    ];
    const shown = overlayTimeline('l1', server, pending);
    expect(shown.map((entry) => [entry.id, entry.kind, entry.outcome, entry.body])).toEqual([
      ['wa', 'whatsapp', null, 'Sent the mockup'],
      ['call', 'call', 'answered', 'Wants a menu page.'],
      ['old', 'note', null, 'First note, edited'],
    ]);
    // Removed while waiting, and undone with something written: kept as a note
    const removed = overlayTimeline('l1', shown, [{ kind: 'remove-entry', leadId: 'l1', entryId: 'wa' }, { kind: 'undo', leadId: 'l1', actionId: 'call' }]);
    expect(removed.map((entry) => [entry.id, entry.kind, entry.step])).toEqual([
      ['call', 'note', null],
      ['old', 'note', null],
    ]);
  });

  it('shows practice answers still waiting, once each', () => {
    const card = {
      id: 'c1',
      myResponse: '',
      practice: { box: 1, dueAt: '2026-10-20T00:00:00.000Z', reviews: 0, lapses: 0, lastGrade: null, lastReviewedAt: null },
    } as unknown as ObjectionCard;
    const pending: OutboxOp[] = [
      { kind: 'card-review', cardId: 'c1', grade: 3, at: '2026-10-27T08:00:00.000Z' },
      { kind: 'card-response', cardId: 'c1', myResponse: 'What would one more order a week mean to you?' },
    ];
    const [shown] = overlayCards([card], pending);
    expect(shown).toMatchObject({ myResponse: 'What would one more order a week mean to you?', practice: { box: 2, reviews: 1, lastReviewedAt: '2026-10-27T08:00:00.000Z' } });
    // The server already has that answer: not counted twice
    expect(overlayCards([shown], pending)[0].practice.reviews).toBe(1);
  });
});
