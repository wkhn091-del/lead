/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // With VITE_API_URL=/api, `npm run dev` forwards API calls to the Express server in server/,
    // so the browser sees one origin and the session cookie stays first-party.
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: {
    // React, Motion, Radix, cmdk and the app ship as one ~250 kB (gzipped) bundle, which is fine for a dashboard
    // used on one desk. One file also keeps the single-page preview build simple.
    chunkSizeWarningLimit: 900,
  },
  test: {
    // server/ has its own tests and config.
    exclude: [...configDefaults.exclude, 'server/**'],
  },
});
