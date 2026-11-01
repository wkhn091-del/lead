import { randomBytes } from 'node:crypto';
import { createCoachProvider, type CoachProvider } from './coach/providers.js';
import { config } from './config.js';
import { createLocalStorage, createS3Storage, type MediaStorage } from './media/storage.js';
import type { Stores } from './stores/types.js';
import { findFfmpeg } from './transcription/ffmpeg.js';
import { createOpenAITranscriber } from './transcription/openai.js';
import { createTranscriptionQueue, type TranscriptionQueue } from './transcription/queue.js';
import type { WhatsAppService } from './whatsapp/service.js';
import type { ProspectorEngine } from './prospector/engine.js';

/** Recording storage from MEDIA_STORAGE: a local folder, or an S3 bucket. */
export function openMediaStorage(): MediaStorage {
  const { media } = config;
  if (media.storage === 's3') return createS3Storage(media.s3);
  if (config.isProduction) {
    console.warn(
      `MEDIA_STORAGE=local keeps recordings in ${media.directory}. On hosts that wipe the disk on every deploy ` +
        '(Render, Railway or Fly without a volume) they will disappear; use MEDIA_STORAGE=s3 there.',
    );
  }
  return createLocalStorage(media.directory);
}

/** The AI coach from AI_PROVIDER, or null when it is off. */
export function openCoach(): CoachProvider | null {
  return config.ai ? createCoachProvider(config.ai) : null;
}

/**
 * The background transcription queue, or the reason it is off: no API key, TRANSCRIBE=off, or no ffmpeg
 * (needed to pull the audio out of videos and cut long recordings into parts).
 */
export async function openTranscription(stores: Stores, storage: MediaStorage): Promise<{ queue: TranscriptionQueue | null; off: string | null }> {
  const settings = config.transcription;
  if (settings.off) return { queue: null, off: 'התמלול כבוי בשרת (TRANSCRIBE=off).' };
  if (!settings.apiKey) {
    return { queue: null, off: 'לתמלול צריך מפתח של OpenAI: הגדירו TRANSCRIBE_API_KEY בשרת.' };
  }
  const ffmpeg = await findFfmpeg(settings.ffmpegPath);
  if (!ffmpeg) {
    console.warn('Transcripts are off: ffmpeg was not found. Install it, or set FFMPEG_PATH to it.');
    return { queue: null, off: 'לתמלול צריך ffmpeg בשרת: התקינו אותו, או הגדירו FFMPEG_PATH.' };
  }
  const transcriber = createOpenAITranscriber({
    apiKey: settings.apiKey,
    model: settings.model,
    baseUrl: settings.baseUrl,
    language: settings.language,
  });
  const queue = createTranscriptionQueue({
    stores,
    storage,
    transcriber,
    ffmpeg,
    partSeconds: settings.partSeconds,
    keywords: settings.keywords,
  });
  return { queue, off: null };
}

/**
 * The read-only WhatsApp sync, or why it's off. Baileys is only loaded when it's on. It connects right away
 * when an account is already linked; otherwise it waits to be linked from the app.
 */
export async function openWhatsApp(
  stores: Stores,
  storage: MediaStorage,
  transcription: TranscriptionQueue | null,
): Promise<{ service: WhatsAppService | null; off: string | null }> {
  const settings = config.whatsapp;
  if (!settings.enabled) return { service: null, off: 'הסנכרון עם וואטסאפ כבוי בשרת. הגדירו WHATSAPP=on כדי להפעיל אותו.' };
  try {
    const { startWhatsApp } = await import('./whatsapp/index.js');
    const service = await startWhatsApp({
      stores,
      storage,
      transcription,
      timeZone: config.timeZone,
      settings: {
        // In-memory storage forgets the link on restart anyway, so a throwaway key is fine there.
        authKey: settings.authKey ?? randomBytes(32),
        history: settings.history,
        countryCode: settings.countryCode,
        voiceNoteDays: settings.voiceNoteDays,
        logLevel: settings.logLevel,
      },
    });
    return { service, off: null };
  } catch (error) {
    console.error('WhatsApp sync could not start:', error);
    return { service: null, off: 'הסנכרון עם וואטסאפ לא הצליח לעלות בשרת. הסיבה כתובה בלוג של השרת.' };
  }
}

/**
 * The Prospector, or why it's off. On when a search provider key is set (with both, one backs up the other);
 * websites are scored by the AI coach (or PROSPECTOR_AI_MODEL) unless PROSPECTOR_AI=off, and screenshotted
 * when PROSPECTOR_CHROME_PATH is set.
 */
export async function openProspector(
  stores: Stores,
  storage: MediaStorage,
  coach: CoachProvider | null,
): Promise<{ engine: ProspectorEngine | null; off: string | null }> {
  const settings = config.prospector;
  if (!settings) {
    return { engine: null, off: 'מאתר הלידים כבוי בשרת: הגדירו GOOGLE_PLACES_API_KEY (או SERPAPI_KEY) כדי להפעיל אותו.' };
  }
  const { createProspector } = await import('./prospector/index.js');
  const scorer =
    settings.ai && config.ai
      ? settings.aiModel
        ? createCoachProvider({ ...config.ai, model: settings.aiModel, timeoutMs: 90_000 })
        : createCoachProvider({ ...config.ai, timeoutMs: 90_000 })
      : null;
  const engine = createProspector(
    { stores, storage },
    {
      providers: settings.providers,
      chromePath: settings.chromePath,
      coach: scorer ?? (settings.ai ? coach : null),
      businessContext: config.ai?.businessContext ?? '',
      retentionDays: settings.retentionDays,
      language: settings.language,
      region: settings.region,
      countryCode: config.whatsapp.countryCode,
      allowPrivateNetwork: settings.allowPrivateNetwork,
    },
  );
  return { engine, off: null };
}
