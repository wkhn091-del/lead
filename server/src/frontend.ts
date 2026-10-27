import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';

/**
 * Serves the built Vite app from the same origin as the API, so the session cookie
 * stays first-party (this is what makes sign-in work on iPhone Safari).
 * Returns false when there is no build to serve.
 */
export function serveFrontend(app: Express, distDir: string): boolean {
  const indexHtml = join(distDir, 'index.html');
  if (!existsSync(indexHtml)) return false;

  // Hashed file names never change content, so they can be cached for a year.
  app.use('/assets', express.static(join(distDir, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: '1h',
      // The offline worker and the install manifest are checked on every visit, so a new version shows at once
      setHeaders: (res, path) => {
        if (/(?:^|[\\/])(?:sw\.js|manifest\.webmanifest)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // Any other page request gets the app shell; the API keeps its own 404s.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
  return true;
}
