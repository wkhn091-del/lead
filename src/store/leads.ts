import { create } from 'zustand';
import { appConfig } from '../config';
import { repository } from '../data/repository';
import { createSampleLeads, isSampleLead } from '../data/sampleLeads';
import { NO_DEAL } from '../lib/deal';
import { createId } from '../lib/id';
import { patchLead, patchRevert } from '../lib/leads';
import { overlayLeads, type OutboxOp } from '../lib/outbox';
import { applyAction, timelineEntryFor, undoAction } from '../lib/workflow';
import type { ActionType, DailyQueue, Lead, LeadPatch, NewLead, NewLeadInput, StepDetails } from '../types';
import { handleOutbox, useSync } from './sync';
import { useTimeline } from './timeline';
import { toast } from './toasts';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Leads per bulk request. The API accepts up to 500; smaller batches keep each request quick. */
const BATCH_SIZE = 100;

export interface ImportOutcome {
  /** Leads now stored, in the order they were sent */
  saved: Lead[];
  /** Why the rest weren't saved, or null when everything was */
  error: string | null;
}

interface LeadsState {
  leads: Lead[];
  loadState: LoadState;
  loadError: string | null;
  /** Today's queue, once loaded */
  daily: DailyQueue | null;
  dailyState: LoadState;
  dailyError: string | null;
  /** Imports still in flight; drives the save indicator (other changes wait in the outbox, store/sync.ts) */
  pending: number;
  /** When the list last came from the server (ms), or null while it's only the copy kept on this device */
  syncedAt: number | null;
  /** Loads the list. With leads already on screen it's quiet: they stay while the server answers, or if it doesn't. */
  load: () => Promise<void>;
  /** Shows the copy kept on this device (store/offline.ts) until the server answers */
  hydrate: (leads: Lead[], daily: DailyQueue | null) => void;
  /** Loads today's queue (drawing it on the first visit of the day) */
  loadDaily: () => Promise<void>;
  addLead: (input: NewLeadInput) => Lead;
  /**
   * Takes a step (advance, a call that was or wasn't answered, not relevant) and logs it on the timeline
   * with what was said: shown at once, then saved. Returns the step's id (also its timeline entry's id,
   * for Undo and for attaching a recording) and a promise that settles once it is stored.
   * Null when the step isn't allowed.
   */
  act: (leadId: string, type: ActionType, details?: StepDetails) => { id: string; saved: Promise<boolean> } | null;
  /** Reverses the lead's most recent step, within 10 minutes. What was written about it stays as a note. */
  undo: (leadId: string, actionId: string) => void;
  /** Saves imported leads in batches and shows each batch as soon as it is stored */
  importLeads: (leads: NewLead[], onProgress?: (saved: number) => void) => Promise<ImportOutcome>;
  updateLead: (id: string, patch: LeadPatch) => void;
  /** Hides the lead now and deletes it once the undo window has passed */
  removeLead: (id: string) => void;
  /** Deletes several leads right away, for example to undo an import */
  removeLeads: (ids: readonly string[]) => void;
  addSampleLeads: () => void;
  removeSampleLeads: () => void;
  /** Sends deletes still waiting out their undo window. Called when the page is hidden. */
  flushPendingRemovals: () => void;
  /** Forgets every lead in memory, for example after signing out */
  reset: () => void;
}

interface PendingRemoval {
  lead: Lead;
  index: number;
  timer: ReturnType<typeof setTimeout>;
}

const pendingRemovals = new Map<string, PendingRemoval>();

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'שגיאה לא ידועה');

function inBatches<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * Every single-lead write is optimistic: the UI changes first, then the change goes to the outbox (store/sync.ts),
 * which sends it, and keeps it until the server has it, through lost connections and reloads. Only a change the
 * server refuses is rolled back, with a toast that explains it. Imports are the exception: leads appear only once
 * their batch is stored.
 */
export const useLeadStore = create<LeadsState>()((set, get) => {
  const mapLead = (id: string, change: (lead: Lead) => Lead) =>
    set((state) => ({ leads: state.leads.map((lead) => (lead.id === id ? change(lead) : lead)) }));

  const dropLeads = (match: (lead: Lead) => boolean) =>
    set((state) => ({ leads: state.leads.filter((lead) => !match(lead)) }));

  const insertAt = (lead: Lead, index: number) =>
    set((state) => {
      const leads = state.leads.filter((item) => item.id !== lead.id);
      leads.splice(Math.min(index, leads.length), 0, lead);
      return { leads };
    });

  /** Keeps a change in the outbox and sends it. Resolves to whether the server took it. */
  const send = (op: OutboxOp, rollback?: () => void) => useSync.getState().enqueue(op, { rollback }).saved;
  /** A lead from the server, with the changes to it that are still waiting shown on top */
  const withPending = (lead: Lead) => overlayLeads([lead], useSync.getState().pendingOps())[0] ?? lead;
  /** The server's list again, when a refused change from before a reload can't be rolled back here */
  const reloadQuietly = () => void get().load();

  /** Runs a write right away (adding the sample leads, which only live on this device). Resolves to whether it was saved. */
  async function persist(run: () => Promise<unknown>, rollback: () => void, failure: string): Promise<boolean> {
    set((state) => ({ pending: state.pending + 1 }));
    try {
      await run();
      return true;
    } catch (error) {
      rollback();
      toast.error(failure, messageOf(error));
      return false;
    } finally {
      set((state) => ({ pending: state.pending - 1 }));
    }
  }

  function commitRemoval(id: string) {
    const entry = pendingRemovals.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingRemovals.delete(id);
    void send({ kind: 'remove-lead', leadId: id }, () => insertAt(entry.lead, entry.index));
  }

  function restoreLead(lead: Lead, index: number) {
    insertAt(lead, index);
    const entry = pendingRemovals.get(lead.id);
    if (entry) {
      clearTimeout(entry.timer);
      pendingRemovals.delete(lead.id);
      return;
    }
    // The delete was already handed to the outbox (the page was hidden): take it back if it's still waiting,
    // otherwise save the lead again.
    if (useSync.getState().cancel((op) => op.kind === 'remove-lead' && op.leadId === lead.id)) return;
    void send({ kind: 'create-lead', lead: { ...lead, notes: [] } }, () => dropLeads((item) => item.id === lead.id));
  }

  const replaceWorkflow = (leadId: string, from: Lead) => mapLead(leadId, () => from);
  // A saved step only moves the lead through the funnel. Details edited while it was saving, such as the amounts
  // of a deal that just closed, stay as they are.
  const applySavedStep = (leadId: string, stored: Lead) =>
    mapLead(leadId, (lead) => ({
      ...lead,
      stage: stored.stage,
      stageChangedAt: stored.stageChangedAt,
      archivedAt: stored.archivedAt,
      attemptCount: stored.attemptCount,
      lastAttemptAt: stored.lastAttemptAt,
      activity: stored.activity,
      updatedAt: stored.updatedAt,
    }));

  // What each kind of lead change sends, and what the app does with the server's answer
  handleOutbox('create-lead', {
    send: (op) => repository.create(op.lead),
    saved: (op, stored) => {
      if (stored) mapLead(op.lead.id, (lead) => (lead.updatedAt === op.lead.updatedAt ? withPending(stored as Lead) : lead));
    },
    refused: (op, _message, rollback) => (rollback ? rollback() : dropLeads((lead) => lead.id === op.lead.id)),
  });
  handleOutbox('update-lead', {
    send: (op) => repository.update(op.leadId, op.patch),
    // Take the stored version unless a newer edit landed while this one was saving.
    saved: (op, stored) => {
      if (stored) mapLead(op.leadId, (lead) => (lead.updatedAt === op.stamp ? (stored as Lead) : lead));
    },
    refused: (_op, _message, rollback) => (rollback ? rollback() : reloadQuietly()),
  });
  handleOutbox('act', {
    send: (op) => repository.act(op.leadId, op.action, { ...op.details, at: op.at }),
    saved: (op, stored) => {
      // Take the stored step, unless a newer step landed while this one was saving.
      if (stored && get().leads.find((lead) => lead.id === op.leadId)?.activity[0]?.id === op.action.id) applySavedStep(op.leadId, stored as Lead);
    },
    refused: (op, _message, rollback) => {
      if (rollback) return rollback();
      useTimeline.getState().dropStep(op.leadId, op.action.id);
      reloadQuietly();
    },
  });
  handleOutbox('undo', {
    send: (op) => repository.undo(op.leadId, op.actionId),
    saved: (op, stored) => {
      if (stored) replaceWorkflow(op.leadId, withPending(stored as Lead));
    },
    refused: (op, _message, rollback) => {
      if (rollback) rollback();
      else reloadQuietly();
      if (useTimeline.getState().profiles[op.leadId]) void useTimeline.getState().load(op.leadId, true);
    },
  });
  handleOutbox('remove-lead', {
    send: (op) => repository.remove(op.leadId),
    saved: (op) => useTimeline.getState().forget([op.leadId]),
    refused: (_op, _message, rollback) => (rollback ? rollback() : reloadQuietly()),
  });
  handleOutbox('remove-leads', {
    send: async (op) => {
      for (const batch of inBatches(op.leadIds)) await repository.removeMany(batch);
    },
    saved: (op) => useTimeline.getState().forget(op.leadIds),
    refused: (_op, _message, rollback) => (rollback ? rollback() : reloadQuietly()),
  });

  return {
    leads: [],
    loadState: 'idle',
    loadError: null,
    daily: null,
    dailyState: 'idle',
    dailyError: null,
    pending: 0,
    syncedAt: null,

    async load() {
      const showing = get().leads.length > 0 && get().loadState === 'ready';
      set({ loadState: showing ? 'ready' : 'loading', loadError: null });
      try {
        const leads = await repository.list();
        // Changes still on their way to the server stay on screen
        set({ leads: overlayLeads(leads, useSync.getState().pendingOps()), loadState: 'ready', syncedAt: Date.now() });
      } catch (error) {
        set({ loadState: showing ? 'ready' : 'error', loadError: messageOf(error) });
      }
    },

    hydrate(leads, daily) {
      if (get().loadState === 'ready' && get().syncedAt) return;
      set((state) => ({
        leads: overlayLeads(leads, useSync.getState().pendingOps()),
        loadState: 'ready',
        daily: state.daily ?? daily,
        dailyState: state.daily || daily ? 'ready' : state.dailyState,
      }));
    },

    async loadDaily() {
      set({ dailyState: get().daily ? 'ready' : 'loading', dailyError: null });
      try {
        const daily = await repository.daily();
        // Leads added on another device since the list loaded
        const known = new Set(get().leads.map((lead) => lead.id));
        if (daily.leadIds.some((id) => !known.has(id))) await get().load();
        set({ daily, dailyState: 'ready' });
      } catch (error) {
        set({ dailyState: 'error', dailyError: messageOf(error) });
      }
    },

    addLead(input) {
      const now = new Date().toISOString();
      const firstNote = input.note.trim();
      const lead: NewLead = {
        id: createId(),
        name: input.name.trim(),
        contactName: input.contactName.trim(),
        phone: input.phone.trim(),
        email: input.email.trim(),
        website: input.website.trim(),
        campaign: input.campaign.trim(),
        approach: input.approach.trim(),
        method: input.method,
        stage: 'cold_call',
        stageChangedAt: now,
        archivedAt: null,
        attemptCount: 0,
        lastAttemptAt: null,
        deal: { ...NO_DEAL },
        currency: appConfig.baseCurrency,
        notes: firstNote ? [{ id: createId(), body: firstNote, createdAt: now }] : [],
        activity: [],
        createdAt: now,
        updatedAt: now,
      };
      const { notes: _notes, ...shown } = lead;
      set((state) => ({ leads: [shown, ...state.leads] }));
      void send({ kind: 'create-lead', lead }, () => dropLeads((item) => item.id === lead.id));
      return shown;
    },

    async importLeads(leads, onProgress) {
      const saved: Lead[] = [];
      set((state) => ({ pending: state.pending + 1 }));
      try {
        for (const batch of inBatches(leads)) {
          const { created, skippedIds } = await repository.createMany(batch);
          const stored = new Map(created.map((lead) => [lead.id, lead]));
          const alreadyStored = new Set(skippedIds);
          for (const { notes: _notes, ...lead } of batch) {
            const match = stored.get(lead.id) ?? (alreadyStored.has(lead.id) ? lead : undefined);
            if (match) saved.push(match);
          }
          const savedIds = new Set(saved.map((lead) => lead.id));
          set((state) => ({ leads: [...saved, ...state.leads.filter((lead) => !savedIds.has(lead.id))] }));
          onProgress?.(saved.length);
        }
        return { saved, error: null };
      } catch (error) {
        return { saved, error: messageOf(error) };
      } finally {
        set((state) => ({ pending: state.pending - 1 }));
        // A day that started with a short pool is topped up from the new leads.
        const { daily } = get();
        if (daily && daily.leadIds.length < daily.quota) void get().loadDaily();
      }
    },

    act(leadId, type, details = {}) {
      const before = get().leads.find((lead) => lead.id === leadId);
      if (!before) return null;
      const action = { id: createId(), type, from: before.stage };
      let next: Lead;
      try {
        next = applyAction(before, action, new Date());
      } catch (error) {
        toast.error(messageOf(error));
        return null;
      }
      replaceWorkflow(leadId, next);
      const timeline = useTimeline.getState();
      timeline.showStep(timelineEntryFor(next.activity[0], leadId, details.body, details.channel));
      // The step keeps the time it was taken, even if it reaches the server later
      const saved = send({ kind: 'act', leadId, action, details, at: next.activity[0].at }, () => {
        replaceWorkflow(leadId, before);
        timeline.dropStep(leadId, action.id);
      });
      return { id: action.id, saved };
    },

    undo(leadId, actionId) {
      const before = get().leads.find((lead) => lead.id === leadId);
      if (!before) return;
      let next: Lead;
      try {
        next = undoAction(before, actionId, new Date());
      } catch (error) {
        toast.error(messageOf(error));
        return;
      }
      replaceWorkflow(leadId, next);
      const timeline = useTimeline.getState();
      timeline.undoStep(leadId, actionId);
      // A step that hasn't reached the server yet is simply taken back. What was written with it stays, as a note,
      // the way the server keeps it when a step is undone.
      const canceled = useSync.getState().cancel((op) => op.kind === 'act' && op.action.id === actionId);
      if (canceled?.kind === 'act') {
        const body = canceled.details.body?.trim();
        if (body) void send({ kind: 'add-entry', leadId, entry: { id: actionId, kind: 'note', body, at: canceled.at, stage: canceled.action.from } });
        return;
      }
      void send({ kind: 'undo', leadId, actionId }, () => {
        replaceWorkflow(leadId, before);
        if (useTimeline.getState().profiles[leadId]) void useTimeline.getState().load(leadId, true);
      });
    },

    updateLead(id, patch) {
      const before = get().leads.find((lead) => lead.id === id);
      if (!before) return;
      const stamp = new Date().toISOString();
      const revert = patchRevert(before, patch);

      mapLead(id, (lead) => ({ ...patchLead(lead, patch), updatedAt: stamp }));
      void send({ kind: 'update-lead', leadId: id, patch, stamp }, () => mapLead(id, (lead) => patchLead(lead, revert)));
    },

    removeLead(id) {
      const { leads } = get();
      const index = leads.findIndex((lead) => lead.id === id);
      if (index < 0) return;
      const lead = leads[index];
      dropLeads((item) => item.id === id);
      pendingRemovals.set(id, {
        lead,
        index,
        timer: setTimeout(() => commitRemoval(id), appConfig.undoWindowMs),
      });
      toast.show({
        message: `${lead.name} נמחק`,
        duration: appConfig.undoWindowMs,
        action: { label: 'ביטול', onClick: () => restoreLead(lead, index) },
      });
    },

    removeLeads(ids) {
      const doomed = new Set(ids);
      const removed = get().leads.filter((lead) => doomed.has(lead.id));
      if (removed.length === 0) return;
      dropLeads((lead) => doomed.has(lead.id));
      void send({ kind: 'remove-leads', leadIds: removed.map((lead) => lead.id) }, () =>
        set((state) => ({ leads: [...removed, ...state.leads.filter((lead) => !doomed.has(lead.id))] })),
      );
    },

    addSampleLeads() {
      const { addSamples } = repository;
      if (!addSamples) return;
      const existing = new Set(get().leads.map((lead) => lead.id));
      const samples = createSampleLeads().filter((lead) => !existing.has(lead.id));
      if (samples.length === 0) return;
      const sampleIds = new Set(samples.map((lead) => lead.id));
      set((state) => ({ leads: [...samples, ...state.leads] }));
      void persist(
        () => addSamples.call(repository),
        () => dropLeads((lead) => sampleIds.has(lead.id)),
        'לא הצלחנו להוסיף את הלידים לדוגמה.',
      );
    },

    removeSampleLeads() {
      const ids = get().leads.filter(isSampleLead).map((lead) => lead.id);
      get().removeLeads(ids);
    },

    flushPendingRemovals() {
      for (const id of [...pendingRemovals.keys()]) commitRemoval(id);
    },

    reset() {
      for (const { timer } of pendingRemovals.values()) clearTimeout(timer);
      pendingRemovals.clear();
      useTimeline.getState().reset();
      set({ leads: [], loadState: 'idle', loadError: null, daily: null, dailyState: 'idle', dailyError: null, syncedAt: null });
    },
  };
});
