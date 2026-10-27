import type {
  CoachingReport,
  DailyQueue,
  Features,
  Interaction,
  Lead,
  LeadPatch,
  LeadPulse,
  LeadTimeline,
  MediaFile,
  NicheVariants,
  ObjectionCard,
  Prospect,
  ProspectImport,
  ProspectorStatus,
  ProspectSearch,
  ProspectSearchResults,
  TrainingDeck,
  TrainingNiche,
  WhatsAppStatus,
} from '../../types';
import type { BulkCreateResult, LeadRepository } from './types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let onUnauthorized: (() => void) | undefined;
let onReachable: ((reachable: boolean) => void) | undefined;

/** Lets the auth store react when the server says the session has ended. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/** Lets the app know whether the server answers: false with no connection, or while it's down or waking up */
export function setReachabilityHandler(handler: (reachable: boolean) => void) {
  onReachable = handler;
}

/** Long enough for a sleeping Render server to wake up (about a minute), short of Vercel's two-minute limit */
const REQUEST_TIMEOUT_MS = 90_000;
/** What Vercel (or another proxy) answers when the server behind it doesn't */
const GATEWAY_ERRORS = new Set([502, 503, 504]);

function messageFromBody(text: string, status: number): string {
  try {
    // { error: { message } }, or an answer that carries its own message (like a WhatsApp history request)
    const body = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const message = body.error?.message ?? body.message;
    if (typeof message === 'string' && message) return message;
  } catch {
    // Not JSON; use the text below.
  }
  return text.trim().slice(0, 200) || `השרת החזיר שגיאה (${status}).`;
}

/** Reads the server's { error: { message } } body, falling back to plain text. */
export async function readErrorMessage(response: Response): Promise<string> {
  return messageFromBody(await response.text().catch(() => ''), response.status);
}

/**
 * REST implementation for the Express API in server/. Endpoints (JSON in and out):
 *
 *   GET    /leads                       → Lead[]
 *   POST   /leads                       NewLead → Lead   (its notes become timeline notes)
 *   POST   /leads/bulk                  { leads: NewLead[] } → { created: Lead[], skippedIds: string[] }  (max 500)
 *   POST   /leads/bulk-delete           { ids: string[] } → 204   (max 500, with timelines and recordings)
 *   PATCH  /leads/:id                   LeadPatch → Lead   (deal amounts and currency only on a closed deal; amounts merge)
 *   POST   /leads/:id/actions           LeadAction & { body?, channel?, at? } → Lead   (also logs a timeline entry; `at` for a step sent late)
 *   POST   /leads/:id/actions/:actionId/undo → Lead   (latest action, within 10 minutes)
 *   DELETE /leads/:id                   → 204
 *   GET    /leads/:id/timeline          → { interactions, media, coaching }
 *   POST   /leads/:id/interactions      { id, kind: note|whatsapp|email, body, at? } → Interaction
 *   PATCH  /leads/:id/interactions/:iid { body, expectedUpdatedAt? } → Interaction   (409 if it changed since)
 *   DELETE /leads/:id/interactions/:iid → 204   (notes and messages only)
 *   POST   /leads/:id/media             multipart: file, interactionId? → MediaFile (queued for its transcript)
 *   GET    /leads/:id/media             → MediaFile[] with transcript progress
 *   POST   /media/:id/transcribe        → MediaFile (queued again)
 *   GET    /media/:id/file              → the recording (supports Range, so players can seek)
 *   DELETE /media/:id                   → 204
 *   POST   /leads/:id/coaching          { language } → CoachingReport   (503 when no AI is set up)
 *   GET    /features                    → Features
 *   GET    /daily                       → DailyQueue
 *   GET    /dashboard                   → { pulses }   (last touch and deal-analysis gist per lead in play)
 *   GET    /whatsapp                    → WhatsAppStatus   (the read-only link and its guard)
 *   POST   /whatsapp/link               { phone? } → WhatsAppStatus   (QR code, or a pairing code for phone)
 *   POST   /whatsapp/reconnect          → WhatsAppStatus
 *   POST   /whatsapp/unlink             → WhatsAppStatus & { removedFromPhone }
 *   POST   /leads/:id/whatsapp/history  → 202 { requested, message }   (409 with the reason when it can't)
 *   POST   /leads/:id/whatsapp/voice/:messageId → 202
 *   GET    /training                    → { run, cards }
 *   POST   /training/generate           { language } → { run, cards }   (503 when no AI is set up)
 *   POST   /training/cards/:id/review   { grade: 1-4, at? } → ObjectionCard   (the same answer and time count once)
 *   PATCH  /training/cards/:id          { myResponse } → ObjectionCard
 *   GET    /training/niches             → { niches, tailoring }   (your leads' niches, and which are tailored)
 *   GET    /training/variants?niche=    → NicheVariants   (polled while new answers are written)
 *   POST   /training/variants           { niche, language } → 202 NicheVariants   (tailors in the background; 503 without AI)
 *   GET    /prospector                  → ProspectorStatus   (whether it's on, and the recent searches)
 *   POST   /prospector/searches         { niche, location, limit, language } → 202 ProspectSearch
 *   GET    /prospector/searches/:id     → { search, prospects }   (polled while the websites are checked)
 *   POST   /prospector/searches/:id/cancel → ProspectSearch
 *   DELETE /prospector/searches/:id     → 204   (imported leads stay)
 *   POST   /prospector/prospects/:id/recheck → 202 Prospect
 *   GET    /prospector/prospects/:id/screenshot → the homepage as a phone shows it (JPEG)
 *   POST   /prospector/import           { ids } → 201 { created: Lead[], skipped }   (Cold Call, into the Daily 10 pool)
 *
 * Every request carries the httpOnly session cookie (credentials: 'include'), so the API can sit
 * on this origin (VITE_API_URL=/api) or on another origin listed in the server's CORS_ORIGINS.
 */
export function createHttpRepository(baseUrl: string): LeadRepository {
  const root = baseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    if (init.body) headers.set('Content-Type', 'application/json');

    // A request with no answer (a dropped connection on a phone) gives up after a while instead of hanging
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    init.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await fetch(`${root}${path}`, { ...init, headers, credentials: 'include', signal: controller.signal });
    } catch (error) {
      onReachable?.(false);
      if (timedOut) throw new ApiError(0, 'השרת לא ענה בזמן. ננסה שוב בעוד רגע.');
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'אין חיבור לשרת. בדקו את החיבור לאינטרנט.');
    } finally {
      clearTimeout(timer);
    }
    onReachable?.(!GATEWAY_ERRORS.has(response.status));
    if (response.status === 401) {
      onUnauthorized?.();
      throw new ApiError(401, 'החיבור שלך הסתיים. צריך להיכנס שוב.');
    }
    if (!response.ok) throw new ApiError(response.status, await readErrorMessage(response));
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  const leadPath = (id: string) => `/leads/${encodeURIComponent(id)}`;
  const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

  /** fetch can't report upload progress, so recordings go up with XMLHttpRequest. */
  function upload(path: string, form: FormData, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
    return new Promise<MediaFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${root}${path}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          onUnauthorized?.();
          reject(new ApiError(401, 'החיבור שלך הסתיים. צריך להיכנס שוב.'));
        } else if (xhr.status < 200 || xhr.status >= 300) {
          reject(new ApiError(xhr.status, messageFromBody(xhr.responseText, xhr.status)));
        } else {
          try {
            resolve(JSON.parse(xhr.responseText) as MediaFile);
          } catch {
            reject(new ApiError(xhr.status, 'השרת החזיר תשובה שאי אפשר לקרוא.'));
          }
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'ההעלאה לא הגיעה לשרת. בדקו את החיבור לאינטרנט.'));
      xhr.onabort = () => reject(new DOMException('ההעלאה בוטלה.', 'AbortError'));
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(form);
    });
  }

  return {
    kind: 'remote',
    list: () => request<Lead[]>('/leads'),
    create: (lead) => request<Lead>('/leads', json('POST', lead)),
    createMany: (leads) => request<BulkCreateResult>('/leads/bulk', json('POST', { leads })),
    removeMany: (ids) => request<void>('/leads/bulk-delete', { ...json('POST', { ids }), keepalive: true }),
    update: (id, patch: LeadPatch) => request<Lead>(leadPath(id), json('PATCH', patch)),
    act: (id, action, details = {}) => request<Lead>(`${leadPath(id)}/actions`, json('POST', { ...action, ...details })),
    undo: (id, actionId) =>
      request<Lead>(`${leadPath(id)}/actions/${encodeURIComponent(actionId)}/undo`, { method: 'POST' }),
    daily: () => request<DailyQueue>('/daily'),
    dashboard: () => request<{ pulses: LeadPulse[] }>('/dashboard'),
    // keepalive lets the delete finish if the tab closes right after the undo window.
    remove: (id) => request<void>(leadPath(id), { method: 'DELETE', keepalive: true }),

    timeline: (leadId) => request<LeadTimeline>(`${leadPath(leadId)}/timeline`),
    addInteraction: (leadId, message) => request<Interaction>(`${leadPath(leadId)}/interactions`, json('POST', message)),
    updateInteraction: (leadId, interactionId, body, expectedUpdatedAt) =>
      request<Interaction>(
        `${leadPath(leadId)}/interactions/${encodeURIComponent(interactionId)}`,
        json('PATCH', expectedUpdatedAt ? { body, expectedUpdatedAt } : { body }),
      ),
    removeInteraction: (leadId, interactionId) =>
      request<void>(`${leadPath(leadId)}/interactions/${encodeURIComponent(interactionId)}`, { method: 'DELETE' }),
    uploadMedia: (leadId, file, { interactionId, onProgress, signal }) => {
      const form = new FormData();
      // Text fields first, so the server knows the entry before the file arrives.
      if (interactionId) form.append('interactionId', interactionId);
      form.append('file', file, file.name);
      return upload(`${leadPath(leadId)}/media`, form, onProgress, signal);
    },
    mediaStatus: (leadId) => request<MediaFile[]>(`${leadPath(leadId)}/media`),
    transcribe: (media) => request<MediaFile>(`/media/${encodeURIComponent(media.id)}/transcribe`, { method: 'POST' }),
    // The session cookie goes along with the audio or video element's request.
    mediaSource: async (media) => `${root}/media/${encodeURIComponent(media.id)}/file`,
    releaseMediaSource: () => {},
    removeMedia: (media) => request<void>(`/media/${encodeURIComponent(media.id)}`, { method: 'DELETE' }),
    coach: (leadId, language) => request<CoachingReport>(`${leadPath(leadId)}/coaching`, json('POST', { language })),
    features: () => request<Features>('/features'),

    whatsappStatus: () => request<WhatsAppStatus>('/whatsapp'),
    linkWhatsApp: (phone) => request<WhatsAppStatus>('/whatsapp/link', json('POST', phone ? { phone } : {})),
    reconnectWhatsApp: () => request<WhatsAppStatus>('/whatsapp/reconnect', { method: 'POST' }),
    unlinkWhatsApp: () => request<WhatsAppStatus & { removedFromPhone?: boolean }>('/whatsapp/unlink', { method: 'POST' }),
    fetchWhatsAppHistory: async (leadId) => {
      try {
        return await request<{ requested: boolean; message: string }>(`${leadPath(leadId)}/whatsapp/history`, { method: 'POST' });
      } catch (error) {
        // 409 carries the reason it couldn't ask (no chat yet, not connected…)
        if (error instanceof ApiError && error.status === 409) return { requested: false, message: error.message };
        throw error;
      }
    },
    fetchVoiceNote: (leadId, messageId) =>
      request<void>(`${leadPath(leadId)}/whatsapp/voice/${encodeURIComponent(messageId)}`, { method: 'POST' }),

    trainingDeck: () => request<TrainingDeck>('/training'),
    generateDeck: (language) => request<TrainingDeck>('/training/generate', json('POST', { language })),
    reviewCard: (cardId, grade, at) =>
      request<ObjectionCard>(`/training/cards/${encodeURIComponent(cardId)}/review`, json('POST', at ? { grade, at } : { grade })),
    saveCardResponse: (cardId, myResponse) =>
      request<ObjectionCard>(`/training/cards/${encodeURIComponent(cardId)}`, json('PATCH', { myResponse })),
    trainingNiches: () => request<{ niches: TrainingNiche[]; tailoring: string[] }>('/training/niches'),
    nicheVariants: (niche) => request<NicheVariants>(`/training/variants?${new URLSearchParams({ niche })}`),
    tailorDeck: (niche, language) => request<NicheVariants>('/training/variants', json('POST', { niche, language })),

    prospector: () => request<ProspectorStatus>('/prospector'),
    startProspectSearch: (input) => request<ProspectSearch>('/prospector/searches', json('POST', input)),
    prospectSearch: (id) => request<ProspectSearchResults>(`/prospector/searches/${encodeURIComponent(id)}`),
    cancelProspectSearch: (id) => request<ProspectSearch>(`/prospector/searches/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    removeProspectSearch: (id) => request<void>(`/prospector/searches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    recheckProspect: (id) => request<Prospect>(`/prospector/prospects/${encodeURIComponent(id)}/recheck`, { method: 'POST' }),
    // The session cookie goes along with the image request. The check's time makes a re-check load the new one.
    prospectScreenshot: (prospect) =>
      prospect.analysis.hasScreenshot
        ? `${root}/prospector/prospects/${encodeURIComponent(prospect.id)}/screenshot?v=${encodeURIComponent(prospect.analysis.analyzedAt ?? '')}`
        : null,
    importProspects: (ids) => request<ProspectImport>('/prospector/import', json('POST', { ids })),
  };
}
