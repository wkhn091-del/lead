import type { RequestHandler } from 'express';
import { HttpError } from '../lib/http-error.js';
import type { Sessions } from './sessions.js';

/** Lets the request through only with a valid session cookie. */
export function requireAuth(sessions: Sessions): RequestHandler {
  return async (req, res, next) => {
    if (!(await sessions.read(req, res))) throw new HttpError(401, 'צריך להתחבר כדי להמשיך.');
    next();
  };
}
