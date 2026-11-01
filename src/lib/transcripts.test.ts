import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Interaction } from '../types';
import { splitTranscripts, transcriptionProgress } from './timeline';

// A server-backed repository whose entry gets a transcript added while it is being edited
const state = vi.hoisted(() => ({
  body: 'Talked about the menu.',
  updatedAt: '2026-10-22T10:00:00.000Z',
  calls: [] as { body: string; expectedUpdatedAt?: string }[],
  notes: [] as { body: string }[],
}));

vi.mock('../data/repository', async () => {
  const { ApiError } = await import('../data/repository/http');
  const entry = (): Interaction => ({
    id: 'e1', leadId: 'l1', kind: 'call', outcome: 'answered', body: state.body, step: 'answered',
    stage: 'cold_call', stageTo: null, at: '2026-10-22T09:00:00.000Z', updatedAt: state.updatedAt,
  });
  return {
    repository: {
      kind: 'remote',
      async timeline() {
        return { interactions: [entry()], media: [], coaching: null };
      },
      async addInteraction(_lead: string, message: { id: string; body: string }) {
        state.notes.push({ body: message.body });
        return { ...entry(), id: message.id, kind: 'note', step: null, outcome: null, body: message.body };
      },
      async updateInteraction(_lead: string, _id: string, body: string, expectedUpdatedAt?: string) {
        state.calls.push({ body, expectedUpdatedAt });
        if (expectedUpdatedAt && expectedUpdatedAt !== state.updatedAt) throw new ApiError(409, 'This entry changed while you were editing it.');
        state.body = body;
        state.updatedAt = new Date(Date.parse(state.updatedAt) + 1000).toISOString();
        return entry();
      },
    },
  };
});

const { useTimeline } = await import('../store/timeline');
const { useSync } = await import('../store/sync');
/** The edit goes through the outbox: wait until it's sent */
const sent = () => vi.waitFor(() => expect(useSync.getState().items).toEqual([]));

describe('transcripts on the timeline', () => {
  it('shows the notes and each transcript apart', () => {
    expect(splitTranscripts('Notes first.\n\n[Auto-Transcript]\nHello there.\n\n[Auto-Transcript]\nSecond file.')).toEqual({
      notes: 'Notes first.',
      transcripts: ['Hello there.', 'Second file.'],
    });
    expect(splitTranscripts('[Auto-Transcript]\nOnly a transcript.')).toEqual({ notes: '', transcripts: ['Only a transcript.'] });
    expect(splitTranscripts('Just notes.')).toEqual({ notes: 'Just notes.', transcripts: [] });
  });

  it('describes a transcript in progress', () => {
    const job = (status: 'queued' | 'running', partsDone: number, partsTotal: number) => ({
      transcription: { status, partsDone, partsTotal, error: null, words: 0, updatedAt: '' },
    });
    expect(transcriptionProgress(job('queued', 0, 0))).toBe('ממתין בתור');
    expect(transcriptionProgress(job('running', 0, 0))).toBe('מכין את האודיו');
    expect(transcriptionProgress(job('running', 1, 4))).toBe('חלק 2 מתוך 4');
    expect(transcriptionProgress(job('running', 0, 1))).toBe('מקשיב להקלטה');
  });
});

describe('editing while a transcript lands', () => {
  beforeEach(async () => {
    state.body = 'Talked about the menu.';
    state.updatedAt = '2026-10-22T10:00:00.000Z';
    state.calls.length = 0;
    state.notes.length = 0;
    await useTimeline.getState().load('l1');
  });

  it('keeps the edit and puts the transcript that arrived after it', async () => {
    const base = { body: state.body, updatedAt: state.updatedAt };
    // The server adds the transcript while the editor is open.
    state.body = `${state.body}\n\n[Auto-Transcript]\nHello, is this the fish house?`;
    state.updatedAt = '2026-10-22T10:05:00.000Z';

    const saved = await useTimeline.getState().editEntry('l1', 'e1', 'Talked about the menu. Wants a QR menu.', base);
    expect(saved).toBe(true);
    await sent();
    expect(state.calls.map((call) => call.expectedUpdatedAt)).toEqual(['2026-10-22T10:00:00.000Z', '2026-10-22T10:05:00.000Z']);
    expect(state.body).toBe('Talked about the menu. Wants a QR menu.\n\n[Auto-Transcript]\nHello, is this the fish house?');
    expect(useTimeline.getState().profiles.l1.interactions[0].body).toBe(state.body);
  });

  it("doesn't overwrite an entry that was rewritten somewhere else, and keeps the edit as a note beside it", async () => {
    const base = { body: state.body, updatedAt: state.updatedAt };
    state.body = 'Rewritten on the phone.';
    state.updatedAt = '2026-10-22T10:06:00.000Z';
    await useTimeline.getState().editEntry('l1', 'e1', 'My edit', base);
    await sent();
    expect(state.body).toBe('Rewritten on the phone.');
    expect(state.notes).toEqual([{ body: 'My edit' }]);
    await vi.waitFor(() => expect(useTimeline.getState().profiles.l1.interactions[0].body).toBe('Rewritten on the phone.'));
  });
});
