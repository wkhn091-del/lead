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

/** Only active when the frontend lives on another domain (CORS_ORIGINS). */
export const corsForFrontend: RequestHandler = crossOrigin
  ? cors({
      origin: [...allowedOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      maxAge: 600,
    })
  : (_req, _res, next) => next();

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection: a browser request that changes data must come from this site
 * or from an allowed frontend origin. Works together with SameSite cookies.
 */
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  // Browsers send Origin on every write; requests without one are not from a web page.
  if (!origin) return next();
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    // An unparseable origin ("null" from sandboxed frames) is never trusted.
  }
  if ((host !== null && host === req.get('host')) || allowedOrigins.has(origin)) return next();
  next(new HttpError(403, 'בקשות מהאתר הזה לא מורשות.'));
};

/** A generous ceiling per IP; the sign-in route has its own stricter limit. */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.')),
});
