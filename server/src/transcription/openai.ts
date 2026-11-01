import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { TranscriptionError } from './errors.js';

/** OpenAI's upload limit for the transcription endpoint */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-transcribe';

export interface TranscribeOptions {
  /** Context for recognition: the end of the previous part, so a cut sentence carries on */
  prompt?: string;
  /** Names and terms to spell right: the business, the contact, your studio */
  keywords?: string[];
  signal?: AbortSignal;
}

/** Turns one audio file (under 25 MB) into text. */
export interface Transcriber {
  /** Shown in the app: "OpenAI", or the host of another compatible service */
  readonly service: string;
  readonly model: string;
  transcribe(file: string, options?: TranscribeOptions): Promise<string>;
}

export interface OpenAITranscriberOptions {
  apiKey: string;
  model?: string;
  /** An OpenAI-compatible service instead (the part before /v1), such as Groq or a self-hosted Whisper server */
  baseUrl?: string;
  /** A language hint like "he". Dropped automatically if the service refuses it. */
  language?: string;
  timeoutMs?: number;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const BACKOFF_MS = [2_000, 6_000, 15_000];

function failureMessage(status: number): string {
  if (status === 401 || status === 403) return 'שירות התמלול דחה את מפתח ה-API. בדקו את TRANSCRIBE_API_KEY בשרת.';
  if (status === 404) return 'שירות התמלול לא מכיר את המודל הזה. בדקו את TRANSCRIBE_MODEL בשרת.';
  if (status === 413) return 'חלק מההקלטה היה גדול מדי לשירות התמלול.';
  if (status === 429) return 'הגעתם למגבלת הקצב או למכסה של שירות התמלול. נסו שוב מאוחר יותר.';
  if (status === 400 || status === 415 || status === 422) return 'שירות התמלול דחה את האודיו.';
  return 'לשירות התמלול יש תקלה כרגע. נסו שוב מאוחר יותר.';
}

/** Keywords can't hold line breaks or angle brackets (the API rejects the whole request), so they are cleaned. */
export function cleanKeywords(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const keyword = value.replace(/[<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const key = keyword.toLocaleLowerCase();
    if (keyword && !seen.has(key)) {
      seen.add(key);
      result.push(keyword);
    }
  }
  return result.slice(0, 20);
}

/**
 * OpenAI's transcription endpoint (POST /v1/audio/transcriptions). gpt-transcribe takes `languages[]` and
 * `keywords[]`; older models (gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1) and compatible
 * services take one `language` and get the keywords inside the prompt. Rate limits and server errors are
 * retried with backoff.
 */
export function createOpenAITranscriber(options: OpenAITranscriberOptions): Transcriber {
  const model = options.model || DEFAULT_TRANSCRIBE_MODEL;
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
  const service = options.baseUrl ? new URL(baseUrl).host : 'OpenAI';
  const current = /^gpt-transcribe/.test(model);
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let language = options.language?.trim() || undefined;

  async function send(file: string, { prompt, keywords = [], signal }: TranscribeOptions) {
    const form = new FormData();
    form.append('model', model);
    form.append('file', await openAsBlob(file, { type: 'audio/mpeg' }), basename(file));
    if (current) {
      if (language) form.append('languages[]', language);
      for (const keyword of cleanKeywords(keywords)) form.append('keywords[]', keyword);
      if (prompt) form.append('prompt', prompt.slice(-800));
    } else {
      if (language) form.append('language', language);
      // Older models read only the end of the prompt (whisper-1: 224 tokens), so the names go first and stay short.
      const names = cleanKeywords(keywords).join(', ');
      const text = [names && `${names}.`, prompt?.slice(-300)].filter(Boolean).join(' ');
      if (text) form.append('prompt', text);
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  }

  return {
    service,
    model,
    async transcribe(file, request = {}) {
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await send(file, request);
        } catch (error) {
          if (request.signal?.aborted) throw error;
          if (attempt < BACKOFF_MS.length) {
            await sleep(BACKOFF_MS[attempt], undefined, { signal: request.signal });
            continue;
          }
          console.error('Transcription request failed:', error);
          throw new TranscriptionError('השרת לא הצליח להגיע לשירות התמלול.');
        }

        if (response.ok) {
          const body = await response.text();
          try {
            const parsed = JSON.parse(body) as { text?: unknown };
            if (typeof parsed.text === 'string') return parsed.text.trim();
          } catch {
            // Some compatible services answer in plain text.
            if (!/^\s*[{[]/.test(body)) return body.trim();
          }
          throw new TranscriptionError('שירות התמלול שלח תשובה שאי אפשר לקרוא.');
        }

        const detail = await response.text().catch(() => '');
        if (response.status === 400 && language && /language/i.test(detail)) {
          console.warn(`The transcription service refused the language "${language}"; continuing without it.`);
          language = undefined;
          continue;
        }
        if (RETRYABLE.has(response.status) && attempt < BACKOFF_MS.length) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : BACKOFF_MS[attempt];
          await sleep(wait, undefined, { signal: request.signal });
          continue;
        }
        // The provider's own words stay in the server log; the timeline gets a message about what to fix.
        console.error(`Transcription failed with ${response.status}: ${detail.slice(0, 1000)}`);
        throw new TranscriptionError(failureMessage(response.status));
      }
    },
  };
}
