import { create } from 'zustand';
import { repository } from '../data/repository';
import { ApiError } from '../data/repository/http';
import { createId } from '../lib/id';
import { kept } from '../lib/kept';
import { recordingProblem } from '../lib/media';
import { overlayTimeline, type OutboxOp } from '../lib/outbox';
import { isTranscribing } from '../lib/timeline';
import { entryAfterUndo } from '../lib/workflow';
import type { CoachingReport, CoachLanguage, Features, Interaction, Lead, LeadTimeline, MediaFile, MessageKind } from '../types';
import { handleOutbox, useSync } from './sync';
import { toast } from './toasts';

export interface LeadProfile {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** Newest first */
  interactions: Interaction[];
  /** Newest first */
  media: MediaFile[];
  coaching: CoachingReport | null;
}

export interface Upload {
  id: string;
  leadId: string;
  interactionId: string | null;
  fileName: string;
  /** 0–1; null while waiting for its timeline entry to be saved */
  progress: number | null;
  error: string | null;
  controller: AbortController;
}

export interface CoachRun {
  status: 'running' | 'error';
  error: string | null;
}

interface TimelineState {
  /** Loaded timelines, by lead id */
  profiles: Record<string, LeadProfile>;
  uploads: Upload[];
  /** Analyses in progress or failed, by lead id */
  coachRuns: Record<string, CoachRun>;
  features: Features | null;
  /** Writes still in flight; drives the save indicator */
  pending: number;
  loadFeatures: () => Promise<void>;
  /** Loads a lead's timeline. Quiet reloads keep showing the current one meanwhile. */
  load: (leadId: string, quiet?: boolean) => Promise<void>;
  /** Shows timelines and features kept on this device (store/offline.ts) until the server answers */
  hydrate: (profiles: Record<string, LeadTimeline>, features: Features | null) => void;
  /** Shows a step's entry at once (the leads store calls this when a step is taken) */
  showStep: (entry: Interaction) => void;
  /** Takes back a step's entry whose save failed */
  dropStep: (leadId: string, entryId: string) => void;
  /** What undoing a step does to its entry: a note when something was written, otherwise gone */
  undoStep: (leadId: string, entryId: string) => void;
  /** Saves a note, WhatsApp message or email. `saved` settles once it is stored. */
  addMessage: (lead: Pick<Lead, 'id' | 'stage'>, kind: MessageKind, body: string) => { id: string; saved: Promise<boolean> } | null;
  /**
   * Saves new text for an entry. `base` is the entry as it was when editing began: if a transcript was
   * added since, the edit is kept and the transcript stays after it. Resolves to whether the edit was taken
   * (it's on screen and on its way to the server; the outbox makes sure it gets there).
   */
  editEntry: (leadId: string, entryId: string, body: string, base?: Pick<Interaction, 'body' | 'updatedAt'>) => Promise<boolean>;
  removeEntry: (leadId: string, entryId: string) => void;
  /** Uploads a recording, after `after` settles (the entry it belongs to must be saved first) */
  upload: (leadId: string, file: File, interactionId: string | null, after?: Promise<boolean>) => void;
  cancelUpload: (uploadId: string) => void;
  dismissUpload: (uploadId: string) => void;
  removeMedia: (leadId: string, media: MediaFile) => void;
  /** Transcribes a recording again (after a failure, or one from before transcripts were on) */
  retranscribe: (leadId: string, media: MediaFile) => void;
  /** Checks on the lead's transcripts every few seconds until none is pending */
  watchTranscripts: (leadId: string) => void;
  runCoach: (leadId: string, language: CoachLanguage) => Promise<void>;
  /** Drops cached timelines, for example of deleted leads */
  forget: (leadIds: readonly string[]) => void;
  reset: () => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'שגיאה לא ידועה');
const isConflict = (error: unknown) => error instanceof ApiError && error.status === 409;

/** How often a pending transcript is checked on. The server does the work; this only asks how it's going. */
const POLL_MS = 4000;
const pollers = new Map<string, ReturnType<typeof setTimeout>>();
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const newestFirst = (a: Interaction, b: Interaction) => Date.parse(b.at) - Date.parse(a.at);

/** Timelines are loaded per lead when its profile opens, and written through the outbox like the leads. */
export const useTimeline = create<TimelineState>()((set, get) => {
  const patchProfile = (leadId: string, change: (profile: LeadProfile) => LeadProfile) =>
    set((state) => {
      const profile = state.profiles[leadId];
      return profile ? { profiles: { ...state.profiles, [leadId]: change(profile) } } : {};
    });
  const mapEntries = (leadId: string, change: (entries: Interaction[]) => Interaction[]) =>
    patchProfile(leadId, (profile) => ({ ...profile, interactions: change(profile.interactions) }));
  const patchUpload = (id: string, change: Partial<Upload>) =>
    set((state) => ({ uploads: state.uploads.map((upload) => (upload.id === id ? { ...upload, ...change } : upload)) }));
  const replaceEntry = (leadId: string, entry: Interaction) => mapEntries(leadId, (entries) => entries.map((item) => (item.id === entry.id ? entry : item)));

  /** Keeps a change in the outbox and sends it (store/sync.ts). Resolves to whether the server took it. */
  const send = (op: OutboxOp, rollback?: () => void) => useSync.getState().enqueue(op, { rollback }).saved;
  /** A timeline from the server, with the changes to it still on their way shown on top */
  const withPending = (leadId: string, timeline: LeadTimeline): LeadTimeline => ({
    ...timeline,
    interactions: overlayTimeline(leadId, timeline.interactions, useSync.getState().pendingOps(), (entryId) =>
      timeline.media.some((file) => file.interactionId === entryId),
    ),
  });

  /**
   * Sends an edit. If the entry changed since editing began, the only other writer is the transcript, which adds
   * text after what was there: the edit is kept with the new text after it. Anything else that changed it means
   * the edit can't go in its place, so what was written is saved next to it as a note instead.
   */
  async function sendEdit(op: Extract<OutboxOp, { kind: 'edit-entry' }>): Promise<Interaction> {
    try {
      return await repository.updateInteraction(op.leadId, op.entryId, op.body, op.base?.updatedAt);
    } catch (error) {
      if (!op.base || !isConflict(error)) throw error;
      const latest = (await repository.timeline(op.leadId)).interactions.find((entry) => entry.id === op.entryId);
      if (!latest) throw error;
      if (latest.body.trim() === op.body.trim()) return latest;
      if (!latest.body.startsWith(op.base.body.trim())) {
        await repository.addInteraction(op.leadId, { id: createId(), kind: 'note', body: op.body });
        toast.show({ message: 'העריכה נשמרה כהערה חדשה', description: 'הרשומה השתנתה במקום אחר בינתיים, אז מה שכתבת נשמר לידה.' });
        void get().load(op.leadId, true);
        return latest;
      }
      const added = latest.body.slice(op.base.body.trim().length).trim();
      const merged = [op.body, added].filter(Boolean).join('\n\n');
      const saved = await repository.updateInteraction(op.leadId, op.entryId, merged, latest.updatedAt);
      if (added) toast.show({ message: 'נשמר, יחד עם התמלול שהגיע בינתיים' });
      return saved;
    }
  }

  // What each kind of timeline change sends, and what the app does with the server's answer
  handleOutbox('add-entry', {
    send: (op) => repository.addInteraction(op.leadId, { id: op.entry.id, kind: op.entry.kind, body: op.entry.body, at: op.entry.at }),
    saved: (op, stored) => {
      if (stored) replaceEntry(op.leadId, stored as Interaction);
    },
    refused: (op, _message, rollback) => (rollback ? rollback() : mapEntries(op.leadId, (entries) => entries.filter((item) => item.id !== op.entry.id))),
  });
  handleOutbox('edit-entry', {
    send: sendEdit,
    saved: (op, stored) => {
      if (stored) replaceEntry(op.leadId, stored as Interaction);
    },
    refused: (op, _message, rollback) => (rollback ? rollback() : void get().load(op.leadId, true)),
  });
  handleOutbox('remove-entry', {
    send: (op) => repository.removeInteraction(op.leadId, op.entryId),
    refused: (op, _message, rollback) => (rollback ? rollback() : void get().load(op.leadId, true)),
  });

  async function persist<T>(run: () => Promise<T>, rollback: () => void, failure: string): Promise<T | undefined> {
    set((state) => ({ pending: state.pending + 1 }));
    try {
      return await run();
    } catch (error) {
      rollback();
      toast.error(failure, messageOf(error));
      return undefined;
    } finally {
      set((state) => ({ pending: state.pending - 1 }));
    }
  }

  return {
    profiles: {},
    uploads: [],
    coachRuns: {},
    features: null,
    pending: 0,

    async loadFeatures() {
      try {
        set({ features: await repository.features() });
      } catch {
        // Features stay unknown; each one explains itself when used.
      }
    },

    async load(leadId, quiet = false) {
      const current = get().profiles[leadId];
      if (!quiet || !current) {
        const next: LeadProfile = current
          ? { ...current, status: current.status === 'ready' ? 'ready' : 'loading', error: null }
          : { interactions: [], media: [], coaching: null, status: 'loading', error: null };
        set((state) => ({ profiles: { ...state.profiles, [leadId]: next } }));
      }
      // The copy kept on this device shows while the server's loads, or instead of it without a connection
      if (!current && repository.kind === 'remote') {
        void kept.timeline(leadId).then((copy) => {
          if (!copy || get().profiles[leadId]?.status !== 'loading') return;
          const { interactions, media, coaching } = copy;
          const shown = withPending(leadId, { interactions, media, coaching });
          set((state) => ({ profiles: { ...state.profiles, [leadId]: { ...shown, status: 'ready', error: null } } }));
        });
      }
      try {
        const timeline = withPending(leadId, await repository.timeline(leadId));
        set((state) => ({ profiles: { ...state.profiles, [leadId]: { ...timeline, status: 'ready', error: null } } }));
        get().watchTranscripts(leadId);
      } catch (error) {
        // A timeline on screen (loaded before, or the kept copy) stays; only an empty one turns into the error
        if (get().profiles[leadId]?.status !== 'ready') {
          patchProfile(leadId, (profile) => ({ ...profile, status: 'error', error: messageOf(error) }));
        }
      }
    },

    hydrate(profiles, features) {
      set((state) => ({
        features: state.features ?? features,
        profiles: {
          ...Object.fromEntries(
            Object.entries(profiles).map(([leadId, timeline]) => [leadId, { ...withPending(leadId, timeline), status: 'ready' as const, error: null }]),
          ),
          // What this session already loaded is newer than the kept copy
          ...state.profiles,
        },
      }));
    },

    showStep(entry) {
      mapEntries(entry.leadId, (entries) => [entry, ...entries.filter((item) => item.id !== entry.id)].sort(newestFirst));
    },

    dropStep(leadId, entryId) {
      mapEntries(leadId, (entries) => entries.filter((item) => item.id !== entryId));
    },

    undoStep(leadId, entryId) {
      const profile = get().profiles[leadId];
      if (!profile) return;
      const hasRecordings = profile.media.some((file) => file.interactionId === entryId);
      mapEntries(leadId, (entries) =>
        entries.flatMap((entry) => {
          if (entry.id !== entryId || !entry.step) return [entry];
          const after = entryAfterUndo(entry, hasRecordings);
          return after ? [after] : [];
        }),
      );
    },

    addMessage({ id: leadId, stage }, kind, body) {
      const text = body.trim();
      if (!text) return null;
      const id = createId();
      const at = new Date().toISOString();
      const entry: Interaction = { id, leadId, kind, outcome: null, body: text, step: null, stage, stageTo: null, at, updatedAt: at };
      mapEntries(leadId, (entries) => [entry, ...entries]);
      const saved = send({ kind: 'add-entry', leadId, entry: { id, kind, body: text, at, stage } }, () =>
        mapEntries(leadId, (entries) => entries.filter((item) => item.id !== id)),
      );
      return { id, saved };
    },

    async editEntry(leadId, entryId, body, base) {
      const before = get().profiles[leadId]?.interactions.find((entry) => entry.id === entryId);
      const text = body.trim();
      if (!before) return false;
      if (before.body === text) return true;
      replaceEntry(leadId, { ...before, body: text });
      // Still waiting to be sent itself: the new text goes along with it instead
      const queued = useSync.getState().cancel((op) => op.kind === 'add-entry' && op.entry.id === entryId);
      if (queued?.kind === 'add-entry') {
        void send({ ...queued, entry: { ...queued.entry, body: text } }, () => mapEntries(leadId, (entries) => entries.filter((item) => item.id !== entryId)));
        return true;
      }
      void send({ kind: 'edit-entry', leadId, entryId, body: text, base: base ? { body: base.body, updatedAt: base.updatedAt } : null }, () =>
        replaceEntry(leadId, before),
      );
      return true;
    },

    removeEntry(leadId, entryId) {
      const profile = get().profiles[leadId];
      const index = profile?.interactions.findIndex((entry) => entry.id === entryId) ?? -1;
      if (!profile || index < 0) return;
      const removed = profile.interactions[index];
      const media = profile.media;
      patchProfile(leadId, (current) => ({
        ...current,
        interactions: current.interactions.filter((entry) => entry.id !== entryId),
        // Its recordings stay, on the lead itself.
        media: current.media.map((file) => (file.interactionId === entryId ? { ...file, interactionId: null } : file)),
      }));
      // A note that hasn't reached the server yet is simply never sent
      if (useSync.getState().cancel((op) => op.kind === 'add-entry' && op.entry.id === entryId)) return;
      void send({ kind: 'remove-entry', leadId, entryId }, () =>
        patchProfile(leadId, (current) => {
          const interactions = [...current.interactions];
          interactions.splice(index, 0, removed);
          return { ...current, interactions, media };
        }),
      );
    },

    upload(leadId, file, interactionId, after) {
      const maxMb = get().features?.media.maxUploadMb ?? 500;
      const problem = recordingProblem(file, maxMb);
      if (problem) {
        toast.error('לא הצלחנו לצרף את ההקלטה.', problem);
        return;
      }
      const upload: Upload = {
        id: createId(),
        leadId,
        interactionId,
        fileName: file.name,
        progress: after ? null : 0,
        error: null,
        controller: new AbortController(),
      };
      set((state) => ({ uploads: [...state.uploads, upload] }));

      void (async () => {
        if (after && !(await after)) {
          patchUpload(upload.id, { error: 'הרשומה שההקלטה שייכת אליה לא נשמרה.' });
          return;
        }
        if (upload.controller.signal.aborted) return;
        patchUpload(upload.id, { progress: 0 });
        set((state) => ({ pending: state.pending + 1 }));
        try {
          const media = await repository.uploadMedia(leadId, file, {
            interactionId,
            signal: upload.controller.signal,
            onProgress: (progress) => patchUpload(upload.id, { progress }),
          });
          patchProfile(leadId, (profile) => ({ ...profile, media: [media, ...profile.media] }));
          set((state) => ({ uploads: state.uploads.filter((item) => item.id !== upload.id) }));
          // Its transcript is made on the server; keep an eye on it.
          get().watchTranscripts(leadId);
        } catch (error) {
          if (isAbort(error)) set((state) => ({ uploads: state.uploads.filter((item) => item.id !== upload.id) }));
          else patchUpload(upload.id, { error: messageOf(error) });
        } finally {
          set((state) => ({ pending: state.pending - 1 }));
        }
      })();
    },

    cancelUpload(uploadId) {
      const upload = get().uploads.find((item) => item.id === uploadId);
      upload?.controller.abort();
      set((state) => ({ uploads: state.uploads.filter((item) => item.id !== uploadId) }));
    },

    dismissUpload(uploadId) {
      set((state) => ({ uploads: state.uploads.filter((item) => item.id !== uploadId) }));
    },

    removeMedia(leadId, media) {
      const before = get().profiles[leadId]?.media;
      if (!before) return;
      patchProfile(leadId, (profile) => ({ ...profile, media: profile.media.filter((file) => file.id !== media.id) }));
      void persist(
        () => repository.removeMedia(media),
        () => patchProfile(leadId, (profile) => ({ ...profile, media: before })),
        'לא הצלחנו למחוק את ההקלטה.',
      );
    },

    retranscribe(leadId, media) {
      const before = get().profiles[leadId]?.media;
      if (!before) return;
      const queued: MediaFile = {
        ...media,
        transcription: { status: 'queued', partsDone: 0, partsTotal: 0, error: null, words: 0, updatedAt: new Date().toISOString() },
      };
      const swap = (file: MediaFile) =>
        patchProfile(leadId, (profile) => ({ ...profile, media: profile.media.map((item) => (item.id === file.id ? file : item)) }));
      swap(queued);
      void persist(
        async () => {
          swap(await repository.transcribe(media));
          get().watchTranscripts(leadId);
        },
        () => patchProfile(leadId, (profile) => ({ ...profile, media: before })),
        'לא הצלחנו להתחיל את התמלול.',
      );
    },

    watchTranscripts(leadId) {
      if (pollers.has(leadId) || !get().profiles[leadId]?.media.some(isTranscribing)) return;
      const tick = async () => {
        pollers.delete(leadId);
        const profile = get().profiles[leadId];
        if (!profile?.media.some(isTranscribing)) return;
        try {
          const media = await repository.mediaStatus(leadId);
          const was = new Map(profile.media.map((file) => [file.id, isTranscribing(file)]));
          // A transcript that just finished has changed its entry (or added a note): fetch the timeline.
          const finished = media.some((file) => was.get(file.id) && !isTranscribing(file));
          patchProfile(leadId, (current) => ({ ...current, media }));
          if (finished) await get().load(leadId, true);
        } catch {
          // Offline for a moment: ask again on the next tick.
        }
        if (get().profiles[leadId]?.media.some(isTranscribing) && !pollers.has(leadId)) {
          pollers.set(leadId, setTimeout(() => void tick(), POLL_MS));
        }
      };
      pollers.set(leadId, setTimeout(() => void tick(), POLL_MS));
    },

    async runCoach(leadId, language) {
      if (get().coachRuns[leadId]?.status === 'running') return;
      set((state) => ({ coachRuns: { ...state.coachRuns, [leadId]: { status: 'running', error: null } } }));
      try {
        const report = await repository.coach(leadId, language);
        patchProfile(leadId, (profile) => ({ ...profile, coaching: report }));
        set((state) => {
          const { [leadId]: _done, ...coachRuns } = state.coachRuns;
          return { coachRuns };
        });
      } catch (error) {
        set((state) => ({ coachRuns: { ...state.coachRuns, [leadId]: { status: 'error', error: messageOf(error) } } }));
      }
    },

    forget(leadIds) {
      const doomed = new Set(leadIds);
      for (const id of leadIds) {
        clearTimeout(pollers.get(id));
        pollers.delete(id);
      }
      set((state) => ({
        profiles: Object.fromEntries(Object.entries(state.profiles).filter(([id]) => !doomed.has(id))),
      }));
    },

    reset() {
      for (const upload of get().uploads) upload.controller.abort();
      for (const timer of pollers.values()) clearTimeout(timer);
      pollers.clear();
      set({ profiles: {}, uploads: [], coachRuns: {}, features: null });
    },
  };
});
