import express from 'express';
import { createCoachRouter } from './coach/coach.routes.js';
import type { CoachProvider } from './coach/providers.js';
import { config } from './config.js';
import { createDailyRouter } from './daily/daily.routes.js';
import { createDashboardRouter } from './dashboard/dashboard.routes.js';
import { serveFrontend } from './frontend.js';
import { createLeadsRouter } from './leads/leads.routes.js';
import { createMediaRouters } from './media/media.routes.js';
import type { MediaStorage } from './media/storage.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requestLog } from './middleware/request-log.js';
import { apiRateLimit, corsForFrontend, securityHeaders } from './middleware/security.js';
import type { Stores } from './stores/types.js';
import { createTimelineRouter } from './timeline/timeline.routes.js';
import { createTrainingRouter } from './training/training.routes.js';
import type { TranscriptionQueue } from './transcription/queue.js';
import type { WhatsAppService } from './whatsapp/service.js';
import type { ProspectorEngine } from './prospector/engine.js';
import { createProspectorRouter } from './prospector/prospector.routes.js';
import { createLeadWhatsAppRouter, createWhatsAppRouter } from './whatsapp/whatsapp.routes.js';

export interface AppServices {
  stores: Stores;
  /** Where recordings are kept */
  storage: MediaStorage;
  /** Null when the AI coach is off */
  coach: CoachProvider | null;
  /** Background transcription of recordings; null when it is off */
  transcription?: TranscriptionQueue | null;
  /** Why transcription is off, for the app to explain */
  transcriptionOff?: string | null;
  /** Defaults to MAX_UPLOAD_MB */
  maxUploadMb?: number;
  /** The read-only WhatsApp sync; null when it is off */
  whatsapp?: WhatsAppService | null;
  /** Why the WhatsApp sync is off */
  whatsappOff?: string | null;
  /** The Prospector; null when no search provider is set up */
  prospector?: ProspectorEngine | null;
  /** Why the Prospector is off */
  prospectorOff?: string | null;
}

/** Notes and transcripts can be long (a two-hour call is over 100,000 characters); Hebrew takes two bytes a letter. */
const LONG_TEXT_PATH = /^\/leads\/[^/]+\/(actions|interactions)(\/|$)/;
/** Imports: many leads in one request */
const BULK_PATHS = new Set(['/leads/bulk', '/leads/import-json']);

/**
 * Builds the app around its services and clock, so tests can pass in-memory stores, a stand-in AI and move time.
 * There is no sign-in: this is a personal CRM, and every /api route is open to whoever reaches the server.
 */
export function createApp(services: AppServices, clock: () => Date = () => new Date()) {
  const { stores, storage, coach } = services;
  const transcription = services.transcription ?? null;
  const whatsapp = services.whatsapp ?? null;
  const whatsappOff = services.whatsappOff ?? 'הסנכרון עם וואטסאפ כבוי בשרת. הגדירו WHATSAPP=on כדי להפעיל אותו.';
  const maxUploadMb = services.maxUploadMb ?? config.media.maxUploadMb;
  const prospector = services.prospector ?? null;
  const prospectorOff = services.prospectorOff ?? 'מאתר הלידים כבוי בשרת: הגדירו GOOGLE_PLACES_API_KEY (או SERPAPI_KEY) כדי להפעיל אותו.';
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(securityHeaders(storage.origins));
  if (config.env !== 'test') app.use(requestLog);

  const smallJson = express.json({ limit: '100kb' });
  const textJson = express.json({ limit: '2mb' });
  const bulkJson = express.json({ limit: '2mb' });

  const api = express.Router();
  api.use(corsForFrontend);
  api.use((_req, res, next) => {
    // Lead data is private: never let a browser or proxy cache it.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(apiRateLimit);
  // A bulk or JSON import can carry hundreds of leads and notes can hold a transcript; every other request stays
  // small. Uploads are multipart, which these skip; Multer reads them in the media routes.
  api.use((req, res, next) =>
    (BULK_PATHS.has(req.path) ? bulkJson : LONG_TEXT_PATH.test(req.path) ? textJson : smallJson)(req, res, next),
  );

  const { leadMedia, media } = createMediaRouters(stores, storage, maxUploadMb, transcription);
  const coachSettings = { timeZone: config.timeZone, businessContext: config.ai?.businessContext ?? '' };

  api.get('/health', async (_req, res) => {
    await stores.leads.ping();
    res.json({ status: 'ok' });
  });
  /** What this server has turned on, so the frontend can show or explain each feature. */
  api.get('/features', (_req, res) => {
    res.json({
      coach: coach ? { provider: coach.name, model: coach.model } : null,
      media: { storage: storage.kind, maxUploadMb },
      transcription: transcription
        ? { enabled: true, service: transcription.transcriber.service, model: transcription.transcriber.model }
        : { enabled: false, reason: services.transcriptionOff ?? 'התמלול כבוי בשרת.' },
      whatsapp: whatsapp ? { enabled: true } : { enabled: false, reason: whatsappOff },
      prospector: prospector
        ? { enabled: true, provider: prospector.providerName, backup: prospector.backupName, browser: prospector.browser, ai: prospector.ai }
        : { enabled: false, reason: prospectorOff },
    });
  });
  api.use(
    '/leads',
    createLeadsRouter(
      stores,
      storage,
      clock,
      transcription,
      { leadsChanged: (created) => whatsapp?.leadsChanged(created) },
      config.whatsapp.countryCode,
    ),
    createTimelineRouter(stores, clock),
    leadMedia,
    createCoachRouter(stores, coach, coachSettings, clock),
    createLeadWhatsAppRouter(whatsapp, whatsappOff),
  );
  api.use('/media', media);
  api.use('/daily', createDailyRouter(stores, clock));
  api.use('/dashboard', createDashboardRouter(stores));
  api.use('/training', createTrainingRouter(stores, coach, coachSettings, clock));
  api.use('/whatsapp', createWhatsAppRouter(whatsapp, whatsappOff, config.whatsapp.countryCode));
  api.use(
    '/prospector',
    createProspectorRouter(stores, storage, prospector, prospectorOff, config.whatsapp.countryCode, clock, {
      leadsChanged: (created) => whatsapp?.leadsChanged(created),
    }),
  );
  api.use(notFoundHandler);
  app.use('/api', api);

  serveFrontend(app, config.frontendDist);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
