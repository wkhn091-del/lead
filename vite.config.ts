/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';
import { defineConfig } from 'vite';

// On Vercel the app always talks to the server through /api, which vercel.json forwards to Render. Without this,
// a deployment whose project settings miss VITE_API_URL would come out as the browser-only preview: no AI coach,
// no Prospector, and leads kept in one browser only.
// (Node's own process.env; this config is type-checked without Node's types)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
if (env.VERCEL && !env.VITE_API_URL?.trim()) env.VITE_API_URL = '/api';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // With VITE_API_URL=/api, `npm run dev` forwards API calls to the Express server in server/,
    // so the browser sees one origin and needs no CORS.
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: {
    // React, Motion, Radix, cmdk, TanStack Table and the app ship as one ~300 kB (gzipped) bundle, which is fine for
    // a CRM used on one desk and cached after the first visit. One file also means no chunk can go missing after a
    // deploy while the app is open.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    // server/ has its own tests and config.
    exclude: [...configDefaults.exclude, 'server/**'],
  },
});
