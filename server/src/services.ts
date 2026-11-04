import { createCoachProvider, type CoachProvider } from './coach/providers.js';
import { config } from './config.js';
import { createLocalStorage, createS3Storage, type MediaStorage } from './media/storage.js';
import type { Stores } from './stores/types.js';
import { findFfmpeg } from './transcription/ffmpeg.js';
import { createOpenAITranscriber } from './transcription/openai.js';
import { createTranscriptionQueue, type TranscriptionQueue } from './transcription/queue.js';
import type { ProspectorEngine } from './prospector/engine.js';

/** Recording storage from MEDIA_STORAGE: a local folder, or an S3 bucket. */
export function openMediaStorage(): MediaStorage {
  const { media } = config;
  if (media.storage === 's3') return createS3Storage(media.s3);
  if (config.isProduction && !media.persistentDisk) {
    console.warn(
      `MEDIA_STORAGE=local keeps recordings in ${media.directory}. On hosts that wipe the disk on every deploy ` +
        '(Render, Railway or Fly without a volume) they disappear with the next deploy: use MEDIA_STORAGE=s3 (S3 or ' +
        'Cloudflare R2), or put MEDIA_DIR on a persistent disk and set MEDIA_PERSISTENT_DISK=on. The app warns before an upload.',
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
        ? createCoachProvider({ ...config.ai, model: settings.aiModel, timeoutMs: 90_000, deadlineMs: 240_000 })
        : createCoachProvider({ ...config.ai, timeoutMs: 90_000, deadlineMs: 240_000 })
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
      countryCode: config.countryCode,
      allowPrivateNetwork: settings.allowPrivateNetwork,
    },
  );
  return { engine, off: null };
}
