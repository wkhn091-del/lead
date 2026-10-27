import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError } from '../lib/http-error.js';
import { verifyPassword } from '../lib/password.js';
import type { Sessions } from './sessions.js';

const LoginBody = z.strictObject({
  email: z.string().trim().max(254),
  password: z.string().min(1).max(256),
});

/** Compares two strings in constant time, whatever their lengths. */
const sameText = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** 10 failed sign-ins per 15 minutes per IP. Successful ones don't count. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'יותר מדי ניסיונות התחברות. נסו שוב בעוד רבע שעה.')),
});

export function createAuthRouter(sessions: Sessions) {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = LoginBody.parse(req.body);
    const emailMatches = sameText(email.toLowerCase(), config.admin.email);
    // Always check the password, so response time doesn't reveal whether the email was right.
    const passwordMatches = await verifyPassword(password, config.admin.passwordHash);
    if (!emailMatches || !passwordMatches) throw new HttpError(401, 'האימייל או הסיסמה שגויים.');

    await sessions.start(req, res);
    res.json({ email: config.admin.email });
  });

  router.get('/session', async (req, res) => {
    if (!(await sessions.read(req, res))) throw new HttpError(401, 'לא מחוברים.');
    res.json({ email: config.admin.email });
  });

  router.post('/logout', async (req, res) => {
    await sessions.end(req, res);
    res.status(204).end();
  });

  return router;
}
