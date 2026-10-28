import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { config } from '../config.js';
import type { SessionStore } from '../stores/types.js';

/** Only this hash is stored, so a leaked database can't be used to sign in. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const cookieOptions = (maxAge?: number): CookieOptions => ({
  httpOnly: true,
  secure: config.session.secure,
  sameSite: config.session.sameSite,
  path: '/',
  ...(maxAge ? { maxAge } : {}),
});

function readToken(req: Request): string | null {
  const token: unknown = req.cookies?.[config.session.cookieName];
  return typeof token === 'string' && token.length >= 32 && token.length <= 128 ? token : null;
}

/** Cookie sessions kept in a SessionStore. */
export function createSessions(store: SessionStore) {
  return {
    async start(req: Request, res: Response) {
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      // Sweep expired sessions, and replace the one this browser already had.
      await store.deleteExpired(now);
      const previous = readToken(req);
      if (previous) await store.deleteByTokenHash(hashToken(previous));

      await store.create({
        tokenHash: hashToken(token),
        userAgent: (req.get('user-agent') ?? '').slice(0, 255),
        expiresAt: new Date(now.getTime() + config.session.ttlMs),
      });
      res.cookie(config.session.cookieName, token, cookieOptions(config.session.ttlMs));
    },

    /** The session behind the request's cookie, or null. Sessions past half their lifetime are renewed. */
    async read(req: Request, res: Response) {
      const token = readToken(req);
      if (!token) return null;
      const session = await store.findByTokenHash(hashToken(token));
      const now = Date.now();
      if (!session || session.expiresAt.getTime() <= now) return null;

      if (session.expiresAt.getTime() - now < config.session.ttlMs / 2) {
        await store.extend(session.id, new Date(now + config.session.ttlMs));
        res.cookie(config.session.cookieName, token, cookieOptions(config.session.ttlMs));
      }
      return session;
    },

    async end(req: Request, res: Response) {
      const token = readToken(req);
      if (token) await store.deleteByTokenHash(hashToken(token));
      res.clearCookie(config.session.cookieName, cookieOptions());
    },
  };
}

export type Sessions = ReturnType<typeof createSessions>;
