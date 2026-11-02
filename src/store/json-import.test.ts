import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lead } from '../types';

// The server's import, in memory: its rules (server/src/leads/json-import.ts) over the leads it has
const server = vi.hoisted(() => ({
  leads: [] as { id: string; name: string; phone: string }[],
  requests: [] as number[],
  /** The request with this number (from 1) fails with no connection */
  failOn: null as number | null,
}));

vi.mock('../data/repository', async () => {
  const { ApiError } = await import('../data/repository/http');
  const { planJsonImport } = await import('../../server/src/leads/json-import');
  return {
    repository: {
      kind: 'remote',
      async importJson(items: unknown[]) {
        server.requests.push(items.length);
        if (server.failOn === server.requests.length) throw new ApiError(0, 'אין חיבור לשרת.');
        const plan = planJsonImport(items, server.leads, '972');
        const created = plan.leads.map((draft) => ({ id: `lead-${server.leads.length + draft.index}-${Math.random()}`, name: draft.name, phone: draft.phone }) as Lead);
        server.leads.push(...created);
        return { created, skipped: plan.skipped, ignoredFields: plan.ignoredFields };
      },
    },
  };
});

const { useLeadStore } = await import('./leads');

const lead = (i: number, phone = `050-${String(1_000_000 + i)}`) => ({ name: `עסק ${i}`, phone });

describe('importing pasted JSON', () => {
  beforeEach(() => {
    server.leads = [{ id: 'old', name: 'ליד ותיק', phone: '054-000-0000' }];
    server.requests = [];
    server.failOn = null;
    useLeadStore.setState({ leads: [], daily: null });
  });

  it('sends a long paste in parts, and reports each skip by its place in the whole paste', async () => {
    const items = Array.from({ length: 1200 }, (_, i) => lead(i));
    items[700] = lead(700, '050-100-0010'); // the number of item 10, in another part
    items[1100] = { name: 'ותיק בפורמט אחר', phone: '+972 54-000-0000' };
    items[1150] = { name: 'בלי טלפון', phone: '' };
    const outcome = await useLeadStore.getState().importJson(items);

    expect(server.requests).toEqual([500, 500, 200]);
    expect(outcome).toMatchObject({ done: 1200, error: null });
    expect(outcome.created).toHaveLength(1197);
    expect(outcome.skipped.map(({ index, reason, leadId }) => ({ index, reason, leadId }))).toEqual([
      // Added by the first part of this same paste: a repeat in the list, not an old lead
      { index: 700, reason: 'repeated', leadId: undefined },
      { index: 1100, reason: 'exists', leadId: 'old' },
      { index: 1150, reason: 'no-phone', leadId: undefined },
    ]);
    expect(useLeadStore.getState().leads).toHaveLength(1197);
  });

  it('carries on where it stopped, without adding anything twice', async () => {
    const items = Array.from({ length: 1200 }, (_, i) => lead(i));
    server.failOn = 2;
    const stopped = await useLeadStore.getState().importJson(items);
    expect(stopped).toMatchObject({ done: 500, error: 'אין חיבור לשרת.' });
    expect(stopped.created).toHaveLength(500);
    expect(useLeadStore.getState().leads).toHaveLength(500);

    server.failOn = null;
    const progress: number[] = [];
    const finished = await useLeadStore.getState().importJson(items, { from: stopped, onProgress: (done) => progress.push(done) });
    expect(finished).toMatchObject({ done: 1200, error: null, skipped: [] });
    expect(finished.created).toHaveLength(1200);
    expect(progress).toEqual([1000, 1200]);
    expect(server.leads).toHaveLength(1201);
  });
});
