import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Interaction, Lead, LeadAction, LeadPatch, NewLead, StepDetails } from '../types';

// This device's storage, so changes can outlive a "page reload" (a fresh import of the stores)
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

// A server that can be out of reach (status 0), asleep behind Vercel (502), or signed out (401)
const server = vi.hoisted(() => ({
  leads: new Map<string, Lead>(),
  entries: new Map<string, Interaction>(),
  calls: [] as string[],
  /** Writes fail with this status; null when the server answers */
  down: null as number | null,
  /** The list fails too */
  listDown: false,
}));

vi.mock('../data/repository', async () => {
  const { ApiError } = await import('../data/repository/http');
  const { applyAction, undoAction } = await import('../lib/workflow');
  const { patchLead } = await import('../lib/leads');
  const write = (call: string) => {
    if (server.down !== null) throw new ApiError(server.down, server.down === 0 ? 'אין חיבור לשרת.' : 'השרת לא זמין.');
    server.calls.push(call);
  };
  const find = (id: string) => {
    const lead = server.leads.get(id);
    if (!lead) throw new ApiError(404, 'הליד הזה כבר לא קיים.');
    return lead;
  };
  return {
    repository: {
      kind: 'remote',
      async list() {
        if (server.listDown) throw new ApiError(0, 'אין חיבור לשרת.');
        return structuredClone([...server.leads.values()]);
      },
      async daily() {
        return { date: '2026-10-27', leadIds: [], quota: 10, startsAt: '2026-10-26T21:00:00.000Z', endsAt: '2026-10-27T21:00:00.000Z' };
      },
      async create(lead: NewLead) {
        write(`create:${lead.id}`);
        if (server.leads.has(lead.id)) throw new ApiError(409, 'כבר קיים ליד עם המזהה הזה.');
        const { notes: _notes, ...stored } = lead;
        server.leads.set(lead.id, stored);
        return structuredClone(stored);
      },
      async update(id: string, patch: LeadPatch) {
        write(`update:${id}`);
        const saved = patchLead(find(id), patch);
        server.leads.set(id, saved);
        return structuredClone(saved);
      },
      async act(id: string, action: LeadAction, details: StepDetails & { at?: string } = {}) {
        write(`act:${action.id}:${action.type}`);
        const saved = applyAction(find(id), action, details.at ? new Date(details.at) : new Date());
        server.leads.set(id, saved);
        return structuredClone(saved);
      },
      async undo(id: string, actionId: string) {
        write(`undo:${actionId}`);
        const saved = undoAction(find(id), actionId, new Date());
        server.leads.set(id, saved);
        return structuredClone(saved);
      },
      async remove(id: string) {
        write(`remove:${id}`);
        find(id);
        server.leads.delete(id);
      },
      async timeline() {
        return { interactions: [], media: [], coaching: null };
      },
      async addInteraction(leadId: string, message: { id: string; kind: Interaction['kind']; body: string; at?: string }) {
        write(`note:${message.id}`);
        const lead = find(leadId);
        const at = message.at ?? new Date().toISOString();
        const entry: Interaction = { id: message.id, leadId, kind: message.kind, outcome: null, body: message.body, step: null, stage: lead.stage, stageTo: null, at, updatedAt: at };
        server.entries.set(entry.id, entry);
        return structuredClone(entry);
      },
    },
  };
});

const lead = (id: string): Lead => ({
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
  deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
  currency: 'ILS',
  activity: [],
  createdAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '2026-10-20T08:00:00.000Z',
});

/** The app as it starts: stores read what this device kept */
async function openApp() {
  const { useSync } = await import('./sync');
  const { useLeadStore } = await import('./leads');
  const { useTimeline } = await import('./timeline');
  const { useToasts } = await import('./toasts');
  return { useSync, useLeadStore, useTimeline, useToasts };
}

describe('writing without a connection', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    server.leads = new Map([
      ['l1', lead('l1')],
      ['l2', lead('l2')],
    ]);
    server.entries.clear();
    server.calls.length = 0;
    server.down = null;
    server.listDown = false;
  });

  it('keeps a call logged with no signal, with its time, and sends it once the server answers', async () => {
    const { useSync, useLeadStore } = await openApp();
    await useLeadStore.getState().load();
    server.down = 0;

    const step = useLeadStore.getState().act('l1', 'no_answer', { body: 'No answer, tried from the car.' })!;
    const takenAt = useLeadStore.getState().leads.find((item) => item.id === 'l1')!.activity[0].at;
    // On screen at once, and waiting on this device
    expect(useLeadStore.getState().leads.find((item) => item.id === 'l1')).toMatchObject({ attemptCount: 1 });
    await vi.waitFor(() => expect(useSync.getState().items[0]?.attempts).toBe(1));
    expect(useSync.getState()).toMatchObject({ offline: true });
    expect([...storage.keys()].filter((key) => key.startsWith('omek-crm:outbox:v1:'))).toHaveLength(1);

    // The list comes back from the server without it: it stays on screen on top
    await useLeadStore.getState().load();
    expect(useLeadStore.getState().leads.find((item) => item.id === 'l1')).toMatchObject({ attemptCount: 1, lastAttemptAt: takenAt });

    server.down = null;
    await useSync.getState().flush();
    expect(await step.saved).toBe(true);
    expect(useSync.getState()).toMatchObject({ items: [], offline: false });
    expect(server.leads.get('l1')).toMatchObject({ attemptCount: 1, lastAttemptAt: takenAt });
    expect([...storage.keys()].filter((key) => key.startsWith('omek-crm:outbox:v1:'))).toEqual([]);
  });

  it('sends what was written before the page closed when the app opens again', async () => {
    let app = await openApp();
    await app.useLeadStore.getState().load();
    server.down = 502; // Render asleep behind Vercel
    app.useLeadStore.getState().updateLead('l2', { phone: '050-000-0002' });
    app.useLeadStore.getState().act('l2', 'answered', { body: 'Call back on Sunday.' });
    await vi.waitFor(() => expect(app.useSync.getState().items[0]?.attempts).toBe(1));

    // The page closes; the server wakes up; the app opens again
    vi.resetModules();
    server.down = null;
    app = await openApp();
    expect(app.useSync.getState().items.map((item) => item.op.kind)).toEqual(['update-lead', 'act']);
    await app.useSync.getState().flush();
    expect(server.calls.filter((call) => !call.startsWith('list'))).toEqual(['update:l2', expect.stringMatching(/^act:.+:answered$/)]);
    expect(server.leads.get('l2')).toMatchObject({ phone: '050-000-0002', lastAttemptAt: expect.any(String) });
  });

  it('takes back a step that wasn’t sent yet when it’s undone, keeping what was written as a note', async () => {
    const { useSync, useLeadStore } = await openApp();
    await useLeadStore.getState().load();
    server.down = 0;
    const step = useLeadStore.getState().act('l1', 'answered', { body: 'He asked for prices.' })!;
    await vi.waitFor(() => expect(useSync.getState().items).toHaveLength(1));
    useLeadStore.getState().undo('l1', step.id);
    expect(useLeadStore.getState().leads.find((item) => item.id === 'l1')!.activity).toEqual([]);
    expect(useSync.getState().items.map((item) => item.op.kind)).toEqual(['add-entry']);

    server.down = null;
    await useSync.getState().flush();
    expect(server.calls).toEqual([`note:${step.id}`]);
    expect(server.entries.get(step.id)).toMatchObject({ kind: 'note', body: 'He asked for prices.' });
    expect(server.leads.get('l1')!.activity).toEqual([]);
  });

  it('holds everything while signed out, and sends it after signing in', async () => {
    const { useSync, useLeadStore } = await openApp();
    await useLeadStore.getState().load();
    server.down = 401;
    useLeadStore.getState().updateLead('l1', { contactName: 'Avi' });
    await vi.waitFor(() => expect(useSync.getState().held).toBe(true));
    expect(useSync.getState().items).toHaveLength(1);

    server.down = null;
    useSync.getState().setHeld(false);
    await vi.waitFor(() => expect(useSync.getState().items).toEqual([]));
    expect(server.leads.get('l1')).toMatchObject({ contactName: 'Avi' });
  });

  it('takes a refused note off the screen, and keeps it to copy', async () => {
    const { useSync, useLeadStore, useTimeline, useToasts } = await openApp();
    await useLeadStore.getState().load();
    await useTimeline.getState().load('l2');
    // Deleted on another device meanwhile
    server.leads.delete('l2');
    const note = useTimeline.getState().addMessage({ id: 'l2', stage: 'cold_call' }, 'note', 'Wants the menu online.')!;
    expect(useTimeline.getState().profiles.l2.interactions.map((entry) => entry.body)).toEqual(['Wants the menu online.']);
    expect(await note.saved).toBe(false);
    expect(useTimeline.getState().profiles.l2.interactions).toEqual([]);
    expect(useSync.getState().dropped[0]).toMatchObject({ op: { kind: 'add-entry', entry: { body: 'Wants the menu online.' } }, reason: 'הליד הזה כבר לא קיים.' });
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ message: 'הרשומה לא נשמרה.', action: { label: 'העתקת מה שכתבת' } });
  });

  it('treats a delete or a new lead that already reached the server as done', async () => {
    const { useSync, useLeadStore } = await openApp();
    await useLeadStore.getState().load();
    // An earlier try got through, but its answer was lost
    server.leads.delete('l1');
    useSync.getState().enqueue({ kind: 'remove-lead', leadId: 'l1' });
    const created = useLeadStore.getState().addLead({ name: 'Carmel Garage', contactName: '', phone: '', email: '', website: '', campaign: '', approach: '', method: 'call', note: '' });
    server.leads.set(created.id, created);
    await vi.waitFor(() => expect(useSync.getState().items).toEqual([]));
    expect(useSync.getState().dropped).toEqual([]);
  });
});
