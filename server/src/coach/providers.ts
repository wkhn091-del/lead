import { HttpError } from '../lib/http-error.js';

export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

/** Used when AI_MODEL is empty */
export const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-6-astra',
  // Google's Flash model, which the Gemini API's free tier includes
  gemini: 'gemini-3.8-flash',
};

const DEFAULT_BASE_URLS: Record<AiProviderName, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  // The Gemini API's OpenAI-compatible endpoint
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

/** A picture sent with the prompt, such as a screenshot of a website */
export interface CoachImage {
  mediaType: 'image/jpeg' | 'image/png';
  /** Base64 */
  data: string;
}

export interface CoachRequest {
  system: string;
  prompt: string;
  /** JSON Schema the answer must follow (structured outputs) */
  schema: Record<string, unknown>;
  maxTokens: number;
  /** Shown to the model before the prompt */
  images?: CoachImage[];
}

/** A model that answers in JSON matching the request's schema. Swap providers without touching the routes. */
export interface CoachProvider {
  readonly name: string;
  readonly model: string;
  /** The parsed JSON answer, not yet checked against the schema */
  complete(request: CoachRequest): Promise<unknown>;
}

export interface ProviderOptions {
  provider: AiProviderName;
  apiKey: string;
  model: string;
  /** Another endpoint for the same API, such as a gateway or proxy */
  baseUrl?: string;
  timeoutMs?: number;
  /** Tries again after a rate limit or an overloaded service (429, 503, 529), this many times */
  retries?: number;
  /** The first wait before trying again, when the provider doesn't say how long; it triples each time */
  retryDelayMs?: number;
}

interface CallSettings {
  provider: AiProviderName;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
}

/** Messages that tell the owner what to fix, without echoing anything from the provider. */
function failureMessage(status: number, detail: string, provider: AiProviderName): string {
  // Gemini answers a wrong key with 400 rather than 401
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(detail)) {
    return 'שירות ה-AI דחה את מפתח ה-API. בדקו את AI_API_KEY בשרת.';
  }
  if (status === 404) return 'שירות ה-AI לא מכיר את המודל הזה. בדקו את AI_MODEL בשרת.';
  if (status === 400 || status === 422) return 'שירות ה-AI דחה את הבקשה. בדקו את AI_MODEL, או נסו ליד עם הערות קצרות יותר.';
  if (status === 413) return 'ההיסטוריה של הליד הזה ארוכה מדי לשירות ה-AI.';
  if (status === 429 && provider === 'gemini') {
    return 'הגעתם למגבלה של המכסה החינמית של Gemini. נסו שוב בעוד דקה, ואם נגמרה המכסה היומית, מחר.';
  }
  if (status === 429) return 'הגעתם למגבלת הקצב או למכסה של שירות ה-AI. נסו שוב בעוד דקה.';
  return 'לשירות ה-AI יש תקלה כרגע. נסו שוב בעוד רגע.';
}

/** Rate limits and an overloaded service usually pass in seconds */
const RETRYABLE = new Set([429, 503, 529]);
/** Longer than this means a quota that won't come back soon (a daily limit), so it isn't worth waiting */
const LONGEST_WAIT_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long the provider asks to wait: the Retry-After header, or Gemini's retryDelay ("17s") in the body */
function suggestedWait(retryAfter: string | null, detail: string): number | null {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const hinted = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(detail);
  return hinted ? Number(hinted[1]) * 1000 : null;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, settings: CallSettings) {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(settings.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new HttpError(504, 'ה-AI לקח יותר מדי זמן לענות. נסו שוב.');
      }
      console.error('AI request failed:', error);
      throw new HttpError(502, 'השרת לא הצליח להגיע לשירות ה-AI.');
    }
    if (response.ok) return (await response.json()) as unknown;

    // Logged for the owner; the provider's error text can be long and is never sent to the browser.
    const detail = await response.text().catch(() => '');
    if (RETRYABLE.has(response.status) && attempt < settings.retries) {
      const wait = suggestedWait(response.headers.get('retry-after'), detail) ?? settings.retryDelayMs * 3 ** attempt;
      if (wait <= LONGEST_WAIT_MS) {
        console.warn(`AI request got ${response.status}; trying again in ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
    }
    console.error(`AI request failed with ${response.status}: ${detail.slice(0, 1000)}`);
    throw new HttpError(502, failureMessage(response.status, detail, settings.provider));
  }
}

function parseAnswer(text: string | null | undefined): unknown {
  if (!text) throw new HttpError(502, 'ה-AI שלח תשובה ריקה. נסו שוב.');
  try {
    // Structured output is plain JSON, but a model can still wrap it in a ```json fence
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new HttpError(502, 'התשובה של ה-AI נקטעה או הגיעה משובשת. נסו שוב.');
  }
}

interface AnthropicMessage {
  stop_reason?: string | null;
  content?: { type: string; text?: string }[];
}

type Settings = ProviderOptions & CallSettings & { baseUrl: string };

/** Claude, through the Messages API with structured outputs (output_config.format). */
function anthropic(options: Settings): CoachProvider {
  return {
    name: 'anthropic',
    model: options.model,
    async complete({ system, prompt, schema, maxTokens, images }) {
      const content = images?.length
        ? [
            ...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })),
            { type: 'text', text: prompt },
          ]
        : prompt;
      const message = (await postJson(
        `${options.baseUrl}/v1/messages`,
        { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: options.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content }],
          output_config: { format: { type: 'json_schema', schema } },
        },
        options,
      )) as AnthropicMessage;
      if (message.stop_reason === 'refusal') throw new HttpError(502, 'ה-AI סירב לנתח את הליד הזה.');
      if (message.stop_reason === 'max_tokens') throw new HttpError(502, 'הניתוח יצא ארוך מדי ונקטע. נסו שוב.');
      return parseAnswer(message.content?.find((block) => block.type === 'text')?.text);
    },
  };
}

interface ChatCompletion {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
}

/** How one Chat Completions API differs from OpenAI's own */
interface ChatDialect {
  /** Under the base URL */
  path: string;
  tokenLimit: (maxTokens: number) => Record<string, number>;
  extra: Record<string, unknown>;
}

const DIALECTS: Record<'openai' | 'gemini', ChatDialect> = {
  openai: { path: '/v1/chat/completions', tokenLimit: (maxTokens) => ({ max_completion_tokens: maxTokens }), extra: {} },
  gemini: {
    path: '/chat/completions',
    // Gemini thinks before it answers, and the thinking counts against the limit, so it gets room for both.
    tokenLimit: (maxTokens) => ({ max_tokens: maxTokens + 8192 }),
    // Light thinking keeps answers quick, and within the free tier's limits
    extra: { reasoning_effort: 'low' },
  },
};

/**
 * OpenAI through Chat Completions with a strict json_schema response format, and Gemini through its
 * OpenAI-compatible version of the same API.
 */
function chatCompletions(options: Settings, dialect: ChatDialect): CoachProvider {
  return {
    name: options.provider,
    model: options.model,
    async complete({ system, prompt, schema, maxTokens, images }) {
      const content = images?.length
        ? [
            { type: 'text', text: prompt },
            ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } })),
          ]
        : prompt;
      const completion = (await postJson(
        `${options.baseUrl}${dialect.path}`,
        { authorization: `Bearer ${options.apiKey}` },
        {
          model: options.model,
          ...dialect.tokenLimit(maxTokens),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'sales_coaching', strict: true, schema } },
          ...dialect.extra,
        },
        options,
      )) as ChatCompletion;
      const choice = completion.choices?.[0];
      if (choice?.message?.refusal) throw new HttpError(502, 'ה-AI סירב לנתח את הליד הזה.');
      if (choice?.finish_reason === 'length') throw new HttpError(502, 'הניתוח יצא ארוך מדי ונקטע. נסו שוב.');
      // Anything but a normal stop (a content filter, say) can leave the answer incomplete.
      if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new HttpError(502, 'ה-AI עצר לפני שסיים. נסו שוב.');
      return parseAnswer(choice?.message?.content);
    },
  };
}

export function createCoachProvider(options: ProviderOptions): CoachProvider {
  const settings: Settings = {
    ...options,
    baseUrl: (options.baseUrl ?? DEFAULT_BASE_URLS[options.provider]).replace(/\/+$/, ''),
    // Long histories take a while; hosting proxies usually allow a few minutes.
    timeoutMs: options.timeoutMs ?? 180_000,
    retries: options.retries ?? 2,
    retryDelayMs: options.retryDelayMs ?? 2_000,
  };
  return options.provider === 'anthropic' ? anthropic(settings) : chatCompletions(settings, DIALECTS[options.provider]);
}
