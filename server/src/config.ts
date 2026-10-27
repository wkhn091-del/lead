import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { AI_PROVIDERS, DEFAULT_MODELS } from './coach/providers.js';
import { DEFAULT_TRANSCRIBE_MODEL } from './transcription/openai.js';
import { isValidTimeZone } from './daily/time.js';
import { parseAuthKey } from './whatsapp/auth-key.js';
import { PROSPECT_PROVIDERS } from './prospector/types.js';

// Fill in anything missing from .env. Real environment variables always win.
if (existsSync('.env')) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) process.env[key] ??= value;
}

const originList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );

/** An empty line in .env (AI_PROVIDER=) counts as not set. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    /** mongodb, or memory to try the app without a database (development only) */
    STORAGE: z.enum(['mongodb', 'memory']).default('mongodb'),
    DATABASE_URL: z.string().trim().optional(),
    ADMIN_EMAIL: z.email('Set ADMIN_EMAIL to the email address you sign in with.'),
    ADMIN_PASSWORD_HASH: z.string().startsWith('scrypt:', 'Create ADMIN_PASSWORD_HASH with `npm run hash-password`.'),
    // A year, renewed while the app is used: you stay signed in, like any app on a phone
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(365),
    CORS_ORIGINS: originList,
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    FRONTEND_DIST: z.string().default('../dist'),
    /** Where "today" is: the daily queue turns over at midnight in this time zone */
    APP_TIMEZONE: z.string().default('Asia/Jerusalem').refine(isValidTimeZone, 'Use an IANA time zone, like Asia/Jerusalem.'),
    DAILY_QUOTA: z.coerce.number().int().min(1).max(50).default(10),

    /** anthropic, openai or gemini (which has a free tier) turns on the AI coach */
    AI_PROVIDER: optional(z.enum(AI_PROVIDERS)),
    AI_API_KEY: optional(z.string().trim()),
    AI_MODEL: optional(z.string().trim().max(100)),
    AI_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
    /** What you sell, in a sentence or two, so the coach's advice and scripts fit your offer */
    AI_BUSINESS_CONTEXT: optional(z.string().trim().max(2000)),

    /** Where call and Zoom recordings are kept */
    MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
    MEDIA_DIR: z.string().default('./uploads'),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(5000).default(500),
    S3_BUCKET: optional(z.string().trim()),
    S3_REGION: optional(z.string().trim()),
    /** Only for S3-compatible services: Cloudflare R2, Backblaze B2, MinIO… */
    S3_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),
    S3_ACCESS_KEY_ID: optional(z.string().trim()),
    S3_SECRET_ACCESS_KEY: optional(z.string().trim()),
    S3_FORCE_PATH_STYLE: optional(z.stringbool()),

    /** Automatic transcripts of recordings. On when there is a key: this one, or AI_API_KEY with AI_PROVIDER=openai. */
    TRANSCRIBE: z.enum(['on', 'off']).default('on'),
    TRANSCRIBE_API_KEY: optional(z.string().trim()),
    TRANSCRIBE_MODEL: optional(z.string().trim().max(100)),
    /** An OpenAI-compatible service instead of OpenAI (the part before /v1) */
    TRANSCRIBE_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
    /** A language hint such as he; empty lets the service detect it */
    TRANSCRIBE_LANGUAGE: optional(z.string().trim().regex(/^[a-z]{2,3}(-[a-z]{2})?$/i, 'Use a language code like he or en.')),
    /** Names and terms to spell right in every transcript, comma separated */
    TRANSCRIBE_KEYWORDS: optional(z.string()),
    /** Length of each part sent for transcription. At 48 kbps, even 45 minutes stays under 25 MB. */
    TRANSCRIBE_PART_MINUTES: z.coerce.number().min(1).max(45).default(10),
    FFMPEG_PATH: optional(z.string().trim()),

    /** Read-only WhatsApp sync: mirrors chats with leads onto their timelines. Never sends anything. */
    WHATSAPP: z.enum(['on', 'off']).default('off'),
    /** 32 random bytes (openssl rand -base64 32) that seal the linked device's keys in the database */
    WHATSAPP_AUTH_KEY: optional(z.string().trim()),
    /** Country code for lead numbers written without one: 054… becomes 97254… */
    WHATSAPP_COUNTRY_CODE: z.string().trim().regex(/^[1-9]\d{0,3}$/, 'Use the digits of a country code, like 972.').default('972'),
    /** full: everything your phone has when you link; recent: the last few months */
    WHATSAPP_HISTORY: z.enum(['full', 'recent']).default('full'),
    /** Voice notes newer than this many days are downloaded and transcribed as they sync; older ones on request */
    WHATSAPP_VOICE_DAYS: z.coerce.number().int().min(0).max(3650).default(30),
    WHATSAPP_LOG: z.enum(['error', 'warn', 'info', 'debug']).default('warn'),

    /**
     * The Prospector finds businesses with serpapi (SERPAPI_KEY) or google (GOOGLE_PLACES_API_KEY). This picks the
     * one to use first; empty: SerpApi when its key is set. With both keys, the other takes over when the first
     * can't search (out of searches, a refused key, down), unless PROSPECTOR_FALLBACK=off.
     */
    PROSPECTOR_PROVIDER: optional(z.enum(PROSPECT_PROVIDERS)),
    PROSPECTOR_FALLBACK: z.enum(['on', 'off']).default('on'),
    GOOGLE_PLACES_API_KEY: optional(z.string().trim()),
    SERPAPI_KEY: optional(z.string().trim()),
    /** Another address for the provider's API: a gateway, or a stand-in for tests */
    GOOGLE_PLACES_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
    SERPAPI_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
    /** Chrome or Chromium, for phone screenshots and a real phone check of each site. Empty: the HTML alone. */
    PROSPECTOR_CHROME_PATH: optional(z.string().trim()),
    /** on: the AI scores working websites (needs AI_PROVIDER); off: the rules alone */
    PROSPECTOR_AI: z.enum(['on', 'off']).default('on'),
    /** A cheaper model from the same provider, for scoring websites. Empty: AI_MODEL. */
    PROSPECTOR_AI_MODEL: optional(z.string().trim().max(100)),
    /** Days a search and its results are kept (Google's terms only allow keeping place ids). Imported leads stay. */
    PROSPECTOR_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(30),
    /** The language of business names and categories in results */
    PROSPECTOR_LANGUAGE: z.enum(['he', 'en']).default('he'),
    /** The country results are for, as a two-letter code */
    PROSPECTOR_REGION: z.string().trim().regex(/^[A-Za-z]{2}$/, 'Use a two-letter country code, like IL.').default('IL'),
    /** Development and tests only: lets the site check open localhost and private-network addresses */
    PROSPECTOR_ALLOW_PRIVATE_NETWORK: z.enum(['on', 'off']).default('off'),
  })
  .superRefine((env, ctx) => {
    const problem = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.AI_PROVIDER && !env.AI_API_KEY) {
      const keyFrom = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini (from aistudio.google.com/app/apikey)' }[env.AI_PROVIDER];
      problem('AI_API_KEY', `Set AI_API_KEY to your ${keyFrom} API key, or leave AI_PROVIDER empty to turn the coach off.`);
    }
    if (env.MEDIA_STORAGE === 's3') {
      if (!env.S3_BUCKET) problem('S3_BUCKET', 'Set S3_BUCKET to the bucket that holds the recordings.');
      if (!env.S3_REGION) problem('S3_REGION', 'Set S3_REGION, like eu-central-1 (or auto for Cloudflare R2).');
      if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
        problem('S3_SECRET_ACCESS_KEY', 'Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (to use the AWS credentials of the machine).');
      }
    }
    if (env.WHATSAPP === 'on') {
      if (env.WHATSAPP_AUTH_KEY && !parseAuthKey(env.WHATSAPP_AUTH_KEY)) {
        problem('WHATSAPP_AUTH_KEY', 'Use 32 random bytes in base64: create one with `openssl rand -base64 32`.');
      } else if (!env.WHATSAPP_AUTH_KEY && env.STORAGE !== 'memory') {
        problem('WHATSAPP_AUTH_KEY', 'Set WHATSAPP_AUTH_KEY (create one with `openssl rand -base64 32`): it seals the WhatsApp link in the database.');
      }
    }
    if (env.PROSPECTOR_PROVIDER === 'google' && !env.GOOGLE_PLACES_API_KEY) {
      problem('GOOGLE_PLACES_API_KEY', 'Set GOOGLE_PLACES_API_KEY (a Google Cloud key with Places API (New) on), or choose PROSPECTOR_PROVIDER=serpapi.');
    }
    if (env.PROSPECTOR_PROVIDER === 'serpapi' && !env.SERPAPI_KEY) {
      problem('SERPAPI_KEY', 'Set SERPAPI_KEY (from serpapi.com), or choose PROSPECTOR_PROVIDER=google.');
    }
    if (env.PROSPECTOR_ALLOW_PRIVATE_NETWORK === 'on' && env.NODE_ENV === 'production') {
      problem('PROSPECTOR_ALLOW_PRIVATE_NETWORK', 'Opening private-network addresses is for development only.');
    }
    if (env.STORAGE === 'memory') {
      if (env.NODE_ENV === 'production') {
        problem('STORAGE', 'In-memory storage loses every lead on restart, so it only runs in development.');
      }
      return;
    }
    const url = env.DATABASE_URL ?? '';
    if (!/^mongodb(\+srv)?:\/\//.test(url)) {
      problem('DATABASE_URL', 'Set DATABASE_URL to your MongoDB connection string (mongodb+srv://… from Atlas).');
    } else if (!/^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(url)) {
      // Atlas leaves the name out of the string it gives you, and Prisma needs it.
      problem('DATABASE_URL', 'Add the database name before the "?", for example …mongodb.net/omek_leads?retryWrites=true');
    }
  });

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error(`The server can't start because its settings are incomplete:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

const env = parsed.data;
const isProduction = env.NODE_ENV === 'production';
// Browsers only send SameSite=None cookies when they are Secure.
const secureCookies = isProduction || env.COOKIE_SAMESITE === 'none';

export const config = {
  env: env.NODE_ENV,
  isProduction,
  port: env.PORT,
  storage: env.STORAGE,
  databaseUrl: env.DATABASE_URL,
  admin: {
    email: env.ADMIN_EMAIL.trim().toLowerCase(),
    passwordHash: env.ADMIN_PASSWORD_HASH,
  },
  session: {
    ttlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    // The __Host- prefix makes browsers reject the cookie unless it is Secure, host-only and site-wide.
    cookieName: secureCookies ? '__Host-omek_session' : 'omek_session',
    secure: secureCookies,
    sameSite: env.COOKIE_SAMESITE,
  },
  /** Frontend origins allowed to call the API from another domain. Empty means same-origin only. */
  corsOrigins: env.CORS_ORIGINS,
  /** Proxy hops in front of the app (1 on Render, Railway, Fly or Heroku) */
  trustProxy: env.TRUST_PROXY,
  frontendDist: resolve(env.FRONTEND_DIST),
  timeZone: env.APP_TIMEZONE,
  /** Leads drawn into each day's queue */
  dailyQuota: env.DAILY_QUOTA,
  /** Null when the AI coach is off */
  ai: env.AI_PROVIDER
    ? {
        provider: env.AI_PROVIDER,
        apiKey: env.AI_API_KEY ?? '',
        model: env.AI_MODEL ?? DEFAULT_MODELS[env.AI_PROVIDER],
        baseUrl: env.AI_BASE_URL,
        businessContext: env.AI_BUSINESS_CONTEXT ?? '',
      }
    : null,
  transcription: {
    /** Null when there is no key, or TRANSCRIBE=off */
    apiKey: env.TRANSCRIBE === 'off' ? null : (env.TRANSCRIBE_API_KEY ?? (env.AI_PROVIDER === 'openai' ? (env.AI_API_KEY ?? null) : null)),
    model: env.TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL,
    baseUrl: env.TRANSCRIBE_BASE_URL,
    language: env.TRANSCRIBE_LANGUAGE?.toLowerCase(),
    keywords: (env.TRANSCRIBE_KEYWORDS ?? '').split(',').map((word) => word.trim()).filter(Boolean),
    partSeconds: Math.round(env.TRANSCRIBE_PART_MINUTES * 60),
    ffmpegPath: env.FFMPEG_PATH,
    off: env.TRANSCRIBE === 'off',
  },
  whatsapp: {
    enabled: env.WHATSAPP === 'on',
    /** Null only with in-memory storage, where the link lasts until the server stops */
    authKey: env.WHATSAPP_AUTH_KEY ? parseAuthKey(env.WHATSAPP_AUTH_KEY) : null,
    countryCode: env.WHATSAPP_COUNTRY_CODE,
    history: env.WHATSAPP_HISTORY,
    voiceNoteDays: env.WHATSAPP_VOICE_DAYS,
    logLevel: env.WHATSAPP_LOG,
  },
  /** Null when no search provider key is set */
  prospector: (() => {
    const keys = { serpapi: env.SERPAPI_KEY, google: env.GOOGLE_PLACES_API_KEY };
    const first = env.PROSPECTOR_PROVIDER ?? (keys.serpapi ? 'serpapi' : keys.google ? 'google' : null);
    if (!first) return null;
    // The first choice, then the other one if its key is set: it takes over when the first can't search
    const order = [first, ...(env.PROSPECTOR_FALLBACK === 'on' ? PROSPECT_PROVIDERS.filter((name) => name !== first && keys[name]) : [])];
    return {
      providers: order.map((name) => ({
        name,
        apiKey: keys[name] ?? '',
        baseUrl: name === 'google' ? env.GOOGLE_PLACES_BASE_URL : env.SERPAPI_BASE_URL,
      })),
      chromePath: env.PROSPECTOR_CHROME_PATH ?? null,
      ai: env.PROSPECTOR_AI === 'on',
      aiModel: env.PROSPECTOR_AI_MODEL ?? null,
      retentionDays: env.PROSPECTOR_RETENTION_DAYS,
      language: env.PROSPECTOR_LANGUAGE,
      region: env.PROSPECTOR_REGION.toUpperCase(),
      allowPrivateNetwork: env.PROSPECTOR_ALLOW_PRIVATE_NETWORK === 'on',
    };
  })(),
  media: {
    storage: env.MEDIA_STORAGE,
    directory: resolve(env.MEDIA_DIR),
    maxUploadMb: env.MAX_UPLOAD_MB,
    s3: {
      bucket: env.S3_BUCKET ?? '',
      region: env.S3_REGION ?? '',
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  },
} as const;
