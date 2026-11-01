import cors from 'cors';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { config } from '../config.js';
import { HttpError } from '../lib/http-error.js';

const allowedOrigins = new Set(config.corsOrigins);
const crossOrigin = allowedOrigins.size > 0;

/**
 * Security headers (CSP, HSTS, no sniffing, frame blocking) for the API and the frontend files.
 * `mediaOrigins` are the storage hosts recordings play and screenshots load from (an S3 bucket); blob: is for
 * local previews.
 */
export function securityHeaders(mediaOrigins: readonly string[]) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        upgradeInsecureRequests: config.isProduction ? [] : null,
        mediaSrc: ["'self'", 'blob:', ...mediaOrigins],
        // Prospector screenshots are served like recordings: from this server or a signed storage link
        imgSrc: ["'self'", 'data:', ...mediaOrigins],
      },
    },
    crossOriginResourcePolicy: { policy: crossOrigin ? 'cross-origin' : 'same-origin' },
  });
}

/**
 * Only active when the frontend calls this server on another domain (CORS_ORIGINS), so the browser lets it read the
 * answers. Not needed on Vercel, which forwards /api to this server: to the browser that's one site.
 */
export const corsForFrontend: RequestHandler = crossOrigin
  ? cors({
      origin: [...allowedOrigins],
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      maxAge: 600,
    })
  : (_req, _res, next) => next();

/** A generous ceiling per IP */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.')),
});
