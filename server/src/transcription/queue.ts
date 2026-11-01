import type { MediaStorage } from '../media/storage.js';
import type { MediaRecord, Stores, TranscriptionRecord } from '../stores/types.js';
import { TranscriptionError } from './errors.js';
import type { Transcriber } from './openai.js';
import { countWords, transcribeRecording, TRANSCRIPT_MARKER } from './pipeline.js';

export interface TranscriptionQueueOptions {
  stores: Stores;
  storage: MediaStorage;
  transcriber: Transcriber;
  ffmpeg: string;
  partSeconds: number;
  /** Always-useful terms (your studio's name, products), added to each lead's names */
  keywords?: string[];
  /** Recordings transcribed at the same time. One keeps a small server responsive. */
  concurrency?: number;
  /** Runs a job may start (counting restarts) before it is marked failed */
  maxAttempts?: number;
}

/** Background transcription of recordings. Job state lives on each recording, so it survives restarts. */
export interface TranscriptionQueue {
  readonly transcriber: Transcriber;
  /** Marks the recording queued (from scratch) and starts it when a slot is free. Null when it's gone. */
  enqueue(mediaId: string): Promise<MediaRecord | null>;
  /** Stops a recording's job, for example because it was deleted */
  cancel(mediaId: string): void;
  /** Picks up jobs that were queued or running when the server last stopped */
  resume(): Promise<void>;
  /** Stops all work for shutdown. Unfinished jobs stay queued for the next start. */
  stop(): void;
  /** Resolves once nothing is waiting or running (for tests) */
  idle(): Promise<void>;
  /**
   * Lets another part of the server place a finished transcript itself: it returns true when it did.
   * WhatsApp voice notes use this to put theirs inside the conversation.
   */
  interceptDelivery(handler: DeliveryHandler): void;
}

export type DeliveryHandler = (media: MediaRecord, text: string) => Promise<boolean>;

const UNEXPECTED = 'התמלול נכשל באופן לא צפוי. נסו שוב.';

const fresh = (): TranscriptionRecord => ({
  status: 'queued',
  partsDone: 0,
  partsTotal: 0,
  attempts: 0,
  error: null,
  text: null,
  words: 0,
  updatedAt: new Date(),
});

export function createTranscriptionQueue(options: TranscriptionQueueOptions): TranscriptionQueue {
  const { stores, storage, transcriber } = options;
  const concurrency = options.concurrency ?? 1;
  const maxAttempts = options.maxAttempts ?? 3;
  const waiting: string[] = [];
  const running = new Map<string, AbortController>();
  const interceptors: DeliveryHandler[] = [];
  let idleWaiters: (() => void)[] = [];
  let stopped = false;

  const notifyIdle = () => {
    if (waiting.length || running.size) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  };

  function pump() {
    while (!stopped && running.size < concurrency && waiting.length) {
      const id = waiting.shift()!;
      const controller = new AbortController();
      running.set(id, controller);
      void work(id, controller.signal)
        .catch((error: unknown) => console.error(`Transcription of ${id} crashed:`, error))
        .finally(() => {
          running.delete(id);
          pump();
        });
    }
    notifyIdle();
  }

  /** The transcript goes after the entry's notes; a recording on the lead itself gets a note of its own. */
  async function deliver(media: MediaRecord, text: string) {
    for (const handler of interceptors) if (await handler(media, text)) return;
    const block = `${TRANSCRIPT_MARKER}\n${text}`;
    const entry = media.interactionId ? await stores.interactions.get(media.leadId, media.interactionId) : null;
    if (entry) {
      await stores.interactions.appendBody(media.leadId, entry.id, block);
      return;
    }
    const lead = await stores.leads.get(media.leadId);
    if (!lead) return;
    const noteId = `transcript-${media.id}`;
    await stores.interactions.create({
      id: noteId,
      leadId: lead.id,
      kind: 'note',
      outcome: null,
      body: block,
      step: null,
      stage: lead.stage,
      stageTo: null,
      at: media.createdAt,
    });
    await stores.media.attach(media.id, noteId);
  }

  async function work(mediaId: string, signal: AbortSignal) {
    let media = await stores.media.get(mediaId);
    let state = media?.transcription;
    if (!media || !state || (state.status !== 'queued' && state.status !== 'running')) return;

    const save = async (change: Partial<TranscriptionRecord>) => {
      state = { ...state!, ...change, updatedAt: new Date() };
      media = (await stores.media.setTranscription(mediaId, state)) ?? null;
      return media;
    };

    try {
      let text = state.text;
      if (text === null) {
        if (state.attempts >= maxAttempts) {
          await save({ status: 'failed', error: `התמלול נעצר ${maxAttempts} פעמים לפני שהסתיים. נסו שוב.` });
          return;
        }
        if (!(await save({ status: 'running', attempts: state.attempts + 1, partsDone: 0, partsTotal: 0, error: null }))) return;
        const lead = await stores.leads.get(media.leadId);
        if (!lead) return;
        text = await storage.withLocalFile(media.storageKey, (file) =>
          transcribeRecording(file, {
            ffmpeg: options.ffmpeg,
            transcriber,
            partSeconds: options.partSeconds,
            keywords: [lead.name, lead.contactName, ...(options.keywords ?? [])],
            signal,
            onProgress: async (partsDone, partsTotal) => {
              await save({ partsDone, partsTotal });
            },
          }),
        );
        // Saved before it is added to the timeline, so a job interrupted in between never adds it twice.
        if (!(await save({ text, words: countWords(text) }))) return;
      }
      if (signal.aborted) return;
      if (text.trim()) await deliver(media!, text);
      await save({ status: 'done', error: null });
    } catch (error) {
      // Cancelled (deleted) or shutting down: a stopped job stays queued in the database for the next start.
      if (signal.aborted) return;
      if (!(error instanceof TranscriptionError)) console.error(`Transcription of ${mediaId} failed:`, error);
      const message =
        error instanceof TranscriptionError
          ? error.message
          : (error as { code?: unknown }).code === 'ENOENT'
            ? 'קובץ ההקלטה חסר באחסון.'
            : UNEXPECTED;
      await save({ status: 'failed', error: message }).catch(() => {});
    }
  }

  return {
    transcriber,
    async enqueue(mediaId) {
      const media = await stores.media.setTranscription(mediaId, fresh());
      if (!media) return null;
      if (!waiting.includes(mediaId) && !running.has(mediaId)) waiting.push(mediaId);
      pump();
      return media;
    },
    cancel(mediaId) {
      const index = waiting.indexOf(mediaId);
      if (index >= 0) waiting.splice(index, 1);
      running.get(mediaId)?.abort();
      notifyIdle();
    },
    async resume() {
      for (const media of await stores.media.pendingTranscriptions()) {
        if (!waiting.includes(media.id) && !running.has(media.id)) waiting.push(media.id);
      }
      pump();
    },
    stop() {
      stopped = true;
      waiting.length = 0;
      for (const controller of running.values()) controller.abort();
    },
    idle() {
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
        notifyIdle();
      });
    },
    interceptDelivery(handler) {
      interceptors.push(handler);
    },
  };
}
