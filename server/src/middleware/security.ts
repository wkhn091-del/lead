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

/** Origins already reported in the log, so a page retrying doesn't fill it */
const reported = new Set<string>();

/**
 * Why a write was refused. For a web address it names the address and the setting that allows it: the usual cause
 * is the app on Vercel, whose requests reach this server through Vercel, before CORS_ORIGINS lists it.
 */
function refusal(url: URL | null): string {
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return 'בקשות מהאתר הזה לא מורשות.';
  // Isolated left to right inside the Hebrew sentence (the app keeps these runs whole on screen)
  const origin = `\u2066${url.origin}\u2069`;
  // As Render asks for it: a key, then a value
  return `השרת לא מכיר את הכתובת ${origin}, ולכן הוא לא מקבל ממנה בקשות. אם זו האפליקציה שלך, מוסיפים בשרת ב-\u2066Render\u2069, בלשונית \u2066Environment\u2069, משתנה בשם \u2066CORS_ORIGINS\u2069 עם הערך ${origin}. אחרי שהשרת עולה מחדש, נכנסים שוב.`;
}

/**
 * CSRF protection: a browser request that changes data must come from this site
 * or from an allowed frontend origin. Works together with SameSite cookies.
 */
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  // Browsers send Origin on every write; requests without one are not from a web page.
  if (!origin) return next();
  let url: URL | null = null;
  try {
    url = new URL(origin);
  } catch {
    // An unparseable origin ("null" from sandboxed frames) is never trusted.
  }
  if (url && (url.host === req.get('host') || allowedOrigins.has(url.origin))) return next();
  if (url && !reported.has(url.origin) && reported.size < 50) {
    reported.add(url.origin);
    console.warn(`Refused a request from ${url.origin}: it isn't this server's own address, and CORS_ORIGINS doesn't list it.`);
  }
  next(new HttpError(403, refusal(url)));
};

/** A generous ceiling per IP; the sign-in route has its own stricter limit. */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.')),
});
