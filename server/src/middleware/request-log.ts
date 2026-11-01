import type { RequestHandler } from 'express';

/** One line per request: method, path, status, duration. Bodies are never logged. */
export const requestLog: RequestHandler = (req, res, next) => {
  const started = performance.now();
  res.on('finish', () => {
    const duration = Math.round(performance.now() - started);
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
};
