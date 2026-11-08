import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletedLead, Lead, NewLead } from '../types';

// This device's storage, as in sync.test.ts (the outbox keeps what's waiting there)
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, String(value)),
  removeItem: (key: string) => void storage.delete(key),
  key: (index: number) => [...storage.keys()][index] ?? null,
  clear: () => storage.clear(),
  get length() {
    return storage.size;
  },
} as Storage;

// The server: its leads, the deleted ones it keeps, and what it was asked
const server = vi.hoisted(() => ({
  leads: [] as Lead[],
  deleted: [] as DeletedLead[],
  calls: [] as string[],
  /** The deleted list answers only when this resolves */
  hold: null as Promise<void> | null,
}));

vi.mock('../data/repository', () => ({
  repository: {
    kind: 'remote',
    async list() {
      return structuredClone(server.leads);
    },
    async deletedLeads() {
      if (server.hold) await server.hold;
      return structuredClone(server.deleted);
    },
    async daily() {
      return { date: '2026-11-08', leadIds: [], quota: 10, startsAt: '2026-11-07T22:00:00.000Z', endsAt: '2026-11-08T22:00:00.000Z' };
    },
    async remove(id: string) {
      server.calls.push(`remove:${id}`);
      server.leads = server.leads.filter((lead) => lead.id !== id);
    },
    async removeMany(ids: string[]) {
      server.calls.push(`removeMany:${ids.join(',')}`);
      server.leads = server.leads.filter((lead) => !ids.includes(lead.id));
    },
    async create(lead: NewLead) {
      server.calls.push(`create:${lead.id}`);
      const { notes: _notes, ...stored } = lead;
      server.leads.push(stored as Lead);
      return structuredClone(stored);
    },
  },
}));

const lead = (id: string, details: Partial<Lead> = {}): Lead => ({
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
  stageChangedAt: '2026-11-01T08:00:00.000Z',
  archivedAt: null,
  attemptCount: 0,
  lastAttemptAt: null,
  deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
  currency: 'ILS',
  activity: [],
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
  ...details,
});

const kept = (id: string, deletedAt: string): DeletedLead => ({ id, name: `Business ${id}`, phone: '', email: '', website: '', city: '', mapsUrl: '', deletedAt });

async function openApp() {
  const { useLeadStore } = await import('./leads');
  const { useSync } = await import('./sync');
  const { useToasts } = await import('./toasts');
  return { useLeadStore, useSync, useToasts };
}

describe('the deleted leads', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    server.leads = [lead('a', { phone: '052-521-0652', city: 'טבריה' }), lead('b'), lead('sample-1-demo')];
    server.deleted = [kept('old', '2026-10-01T08:00:00.000Z')];
    server.calls = [];
    server.hold = null;
  });

  it('come with the leads', async () => {
    const { useLeadStore } = await openApp();
    await useLeadStore.getState().load();
    await vi.waitFor(() => expect(useLeadStore.getState().deleted.map((item) => item.id)).toEqual(['old']));
  });

  it('count a lead as soon as it is deleted, the examples aside, and forget it if the server refuses', async () => {
    const { useLeadStore, useSync } = await openApp();
    await useLeadStore.getState().load();
    await vi.waitFor(() => expect(useLeadStore.getState().deleted).toHaveLength(1));

    useLeadStore.getState().removeLeads(['a', 'sample-1-demo']);
    expect(useLeadStore.getState().deleted.map((item) => item.id)).toEqual(['a', 'old']);
    expect(useLeadStore.getState().deleted[0]).toMatchObject({ name: 'Business a', phone: '052-521-0652', city: 'טבריה', mapsUrl: '' });
    await useSync.getState().flush();
    expect(server.calls).toEqual(['removeMany:a,sample-1-demo']);
  });

  it('keep a deletion made while the list was on its way', async () => {
    const { useLeadStore } = await openApp();
    await useLeadStore.getState().load();
    await vi.waitFor(() => expect(useLeadStore.getState().deleted).toHaveLength(1));

    let answer = () => {};
    server.hold = new Promise((resolve) => (answer = resolve));
    const loading = useLeadStore.getState().loadDeleted();
    useLeadStore.getState().removeLeads(['b']);
    answer();
    await loading;
    expect(useLeadStore.getState().deleted.map((item) => item.id)).toEqual(['b', 'old']);
  });

  it('forget a lead whose deletion is undone', async () => {
    const { useLeadStore, useSync, useToasts } = await openApp();
    await useLeadStore.getState().load();
    await vi.waitFor(() => expect(useLeadStore.getState().deleted).toHaveLength(1));

    useLeadStore.getState().removeLead('a');
    // Within the undo window nothing is deleted yet
    expect(useLeadStore.getState().deleted.map((item) => item.id)).toEqual(['old']);
    useLeadStore.getState().flushPendingRemovals();
    expect(useLeadStore.getState().deleted.map((item) => item.id)).toEqual(['a', 'old']);
    await useSync.getState().flush();

    const undo = useToasts.getState().toasts.find((item) => item.action?.label === 'ביטול');
    undo?.action?.onClick();
    expect(useLeadStore.getState().deleted.map((item) => item.id)).toEqual(['old']);
    expect(useLeadStore.getState().leads.map((item) => item.id)).toContain('a');
    await useSync.getState().flush();
    expect(server.calls).toEqual(['remove:a', 'create:a']);
  });
});
