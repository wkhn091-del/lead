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
  /** Longest wait for one answer */
  timeoutMs?: number;
  /**
   * Longest the whole call may take, waiting for a free slot, waits between tries and fallbacks included. Requests
   * from the app pass through Vercel, which cuts them at 2 minutes, so the default leaves room under that.
   */
  deadlineMs?: number;
  /** Tries again after a rate limit, an overloaded or failing service or a dropped connection, this many times */
  retries?: number;
  /** The first wait before trying again, when the provider doesn't say how long; it triples each time */
  retryDelayMs?: number;
  /** Another model of the same provider, for when this one is overloaded, out of quota or unknown (AI_FALLBACK_MODEL) */
  fallbackModel?: string;
  /** Requests to one AI account at a time, from every part of the server together (AI_MAX_CONCURRENT) */
  maxConcurrent?: number;
}

type Settings = Required<Omit<ProviderOptions, 'fallbackModel'>> & { fallbackModel: string | null };

/** The provider's own error: its status and text stay on the server (logged); the message is for the app */
export class ProviderError extends HttpError {
  constructor(
    readonly providerStatus: number,
    readonly detail: string,
    message: string,
  ) {
    super(502, message);
    this.name = 'ProviderError';
  }
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

/** Rate limits, an overloaded service and passing server errors usually clear in seconds */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
/** Worth another model when this one stays busy, has no quota left, or doesn't exist */
const FALLBACK_ON = new Set([404, 429, 500, 503, 529]);
/** Longer than this means a quota that won't come back soon (a daily limit), so it isn't worth waiting */
const LONGEST_WAIT_MS = 30_000;
/** No new try starts with less than this left before the deadline */
const LAST_START_MS = 3_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A little randomness, so requests that failed together don't all come back at the same moment */
const jitter = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));

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

/**
 * Requests in flight to one AI account. A burst (a Prospector search scoring dozens of websites while you analyze a
 * deal) waits its turn here instead of running into the provider's rate limits; a request that can't get a turn
 * before its deadline says the service is busy.
 */
class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  enter(deadline: number): Promise<() => void> {
    const release = () => {
      this.active -= 1;
      this.waiting.shift()?.();
    };
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const go = () => {
        clearTimeout(timer);
        this.active += 1;
        resolve(release);
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(go);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new HttpError(503, 'שירות ה-AI עסוק כרגע בבקשות אחרות. נסו שוב בעוד דקה.'));
      }, Math.max(0, deadline - Date.now() - LAST_START_MS));
      this.waiting.push(go);
    });
  }
}

const gates = new Map<string, Gate>();
const gateFor = (settings: Settings) => {
  const key = `${settings.provider}:${settings.baseUrl}:${settings.apiKey}`;
  let gate = gates.get(key);
  if (!gate) gates.set(key, (gate = new Gate(settings.maxConcurrent)));
  return gate;
};

async function postJson(url: string, headers: Record<string, string>, body: unknown, settings: Settings, deadline: number): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const left = deadline - Date.now();
    if (left < LAST_START_MS) throw new HttpError(504, 'ה-AI לא ענה בזמן. נסו שוב בעוד רגע.');
    /** Whether another try fits after waiting `wait` */
    const canRetry = (wait: number) => attempt < settings.retries && wait <= LONGEST_WAIT_MS && Date.now() + wait + LAST_START_MS < deadline;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(settings.timeoutMs, left)),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new HttpError(504, 'ה-AI לקח יותר מדי זמן לענות. נסו שוב.');
      }
      // A dropped or refused connection usually works a moment later
      const wait = jitter(settings.retryDelayMs * 3 ** attempt);
      if (canRetry(wait)) {
        console.warn(`AI request failed to connect (${error instanceof Error ? error.message : String(error)}); trying again in ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      console.error('AI request failed:', error);
      throw new HttpError(502, 'השרת לא הצליח להגיע לשירות ה-AI.');
    }

    // Logged for the owner; the provider's error text can be long and is never sent to the browser.
    const detail = await response.text().catch(() => '');
    if (response.ok) {
      try {
        return JSON.parse(detail) as unknown;
      } catch {
        throw new HttpError(502, 'התשובה של ה-AI הגיעה משובשת. נסו שוב.');
      }
    }
    if (RETRYABLE.has(response.status)) {
      const wait = jitter(suggestedWait(response.headers.get('retry-after'), detail) ?? settings.retryDelayMs * 3 ** attempt);
      if (canRetry(wait)) {
        console.warn(`AI request got ${response.status}; trying again in ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
    }
    console.error(`AI request failed with ${response.status}: ${detail.slice(0, 1000)}`);
    throw new ProviderError(response.status, detail, failureMessage(response.status, detail, settings.provider));
  }
}

/** An answer that didn't come back whole: worth asking once more */
class MalformedAnswer extends HttpError {}

function parseAnswer(text: string | null | undefined): unknown {
  if (!text) throw new MalformedAnswer(502, 'ה-AI שלח תשובה ריקה. נסו שוב.');
  try {
    // Structured output is plain JSON, but a model can still wrap it in a ```json fence, or add a word around it
    const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    return JSON.parse(start > 0 && end > start ? trimmed.slice(start, end + 1) : trimmed);
  } catch {
    throw new MalformedAnswer(502, 'התשובה של ה-AI נקטעה או הגיעה משובשת. נסו שוב.');
  }
}

/** A provider that rejected the JSON schema itself (some don't take every schema keyword) */
const refusedSchema = (error: unknown) =>
  error instanceof ProviderError &&
  (error.providerStatus === 400 || error.providerStatus === 422) &&
  !/API key not valid|API_KEY_INVALID/i.test(error.detail) &&
  /response_format|json_schema|output_config|schema|Invalid JSON payload|Unknown name|not supported/i.test(error.detail);

/** For the plain JSON mode: the schema goes into the instructions instead */
const schemaInstructions = (system: string, schema: Record<string, unknown>) =>
  `${system}\n\nAnswer with a single JSON object, and nothing else, that follows this JSON Schema exactly:\n${JSON.stringify(schema)}`;

/** One request to one model; `structured`: with the API's structured-output feature, or in plain JSON mode */
type Call = (request: CoachRequest, model: string, structured: boolean, deadline: number) => Promise<unknown>;

interface AnthropicMessage {
  stop_reason?: string | null;
  content?: { type: string; text?: string }[];
}

/** Claude, through the Messages API with structured outputs (output_config.format). */
const anthropic =
  (settings: Settings): Call =>
  async ({ system, prompt, schema, maxTokens, images }, model, structured, deadline) => {
    const content = images?.length
      ? [
          ...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })),
          { type: 'text', text: prompt },
        ]
      : prompt;
    const message = (await postJson(
      `${settings.baseUrl}/v1/messages`,
      { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model,
        max_tokens: maxTokens,
        system: structured ? system : schemaInstructions(system, schema),
        messages: [{ role: 'user', content }],
        ...(structured ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
      },
      settings,
      deadline,
    )) as AnthropicMessage;
    if (message.stop_reason === 'refusal') throw new HttpError(502, 'ה-AI סירב לנתח את הליד הזה.');
    if (message.stop_reason === 'max_tokens') throw new HttpError(502, 'הניתוח יצא ארוך מדי ונקטע. נסו שוב.');
    return parseAnswer(message.content?.find((block) => block.type === 'text')?.text);
  };

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
const chatCompletions =
  (settings: Settings, dialect: ChatDialect): Call =>
  async ({ system, prompt, schema, maxTokens, images }, model, structured, deadline) => {
    const content = images?.length
      ? [
          { type: 'text', text: prompt },
          ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } })),
        ]
      : prompt;
    const completion = (await postJson(
      `${settings.baseUrl}${dialect.path}`,
      { authorization: `Bearer ${settings.apiKey}` },
      {
        model,
        ...dialect.tokenLimit(maxTokens),
        messages: [
          { role: 'system', content: structured ? system : schemaInstructions(system, schema) },
          { role: 'user', content },
        ],
        response_format: structured
          ? { type: 'json_schema', json_schema: { name: 'sales_coaching', strict: true, schema } }
          : { type: 'json_object' },
        ...dialect.extra,
      },
      settings,
      deadline,
    )) as ChatCompletion;
    const choice = completion.choices?.[0];
    if (choice?.message?.refusal) throw new HttpError(502, 'ה-AI סירב לנתח את הליד הזה.');
    if (choice?.finish_reason === 'length') throw new HttpError(502, 'הניתוח יצא ארוך מדי ונקטע. נסו שוב.');
    // Anything but a normal stop (a content filter, say) can leave the answer incomplete.
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new HttpError(502, 'ה-AI עצר לפני שסיים. נסו שוב.');
    return parseAnswer(choice?.message?.content);
  };

/**
 * A provider whose every answer gets the same care: it waits its turn among the server's other AI requests, tries
 * again after passing errors, switches to plain JSON mode if the schema itself is refused, asks once more for an
 * answer that came back broken, and moves to the fallback model when the main one stays busy. Whatever happens,
 * the caller gets an answer or one clear message, within the deadline.
 */
export function createCoachProvider(options: ProviderOptions): CoachProvider {
  const settings: Settings = {
    ...options,
    baseUrl: (options.baseUrl ?? DEFAULT_BASE_URLS[options.provider]).replace(/\/+$/, ''),
    timeoutMs: options.timeoutMs ?? 100_000,
    deadlineMs: options.deadlineMs ?? 110_000,
    retries: options.retries ?? 3,
    retryDelayMs: options.retryDelayMs ?? 2_000,
    fallbackModel: options.fallbackModel?.trim() && options.fallbackModel.trim() !== options.model ? options.fallbackModel.trim() : null,
    maxConcurrent: Math.max(1, options.maxConcurrent ?? 2),
  };
  const call = options.provider === 'anthropic' ? anthropic(settings) : chatCompletions(settings, DIALECTS[options.provider]);
  const models = [settings.model, ...(settings.fallbackModel ? [settings.fallbackModel] : [])];

  return {
    name: options.provider,
    model: options.model,
    async complete(request) {
      const deadline = Date.now() + settings.deadlineMs;
      const release = await gateFor(settings).enter(deadline);
      try {
        for (const [index, model] of models.entries()) {
          let structured = true;
          let malformed = 0;
          for (;;) {
            try {
              return await call(request, model, structured, deadline);
            } catch (error) {
              if (structured && refusedSchema(error)) {
                console.warn(`The AI provider refused the JSON schema for ${model}; asking in plain JSON mode instead.`);
                structured = false;
                continue;
              }
              if (error instanceof MalformedAnswer && malformed === 0 && deadline - Date.now() > 10_000) {
                malformed += 1;
                continue;
              }
              const last = index === models.length - 1;
              if (!last && error instanceof ProviderError && FALLBACK_ON.has(error.providerStatus) && deadline - Date.now() > 10_000) {
                console.warn(`${model} failed with ${error.providerStatus}; trying the fallback model ${models[index + 1]}.`);
                break;
              }
              throw error;
            }
          }
        }
        // Not reached: the last model either answers or throws
        throw new HttpError(502, 'לשירות ה-AI יש תקלה כרגע. נסו שוב בעוד רגע.');
      } finally {
        release();
      }
    },
  };
}
