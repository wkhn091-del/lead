import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/instrument-sans/wdth.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-400.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-500.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-600.css';
import './index.css';
import App from './App';
import { applyThemePreference, readThemePreference } from './lib/theme';

// public/theme-init.js already did this before paint; repeat it in case that script was blocked.
document.documentElement.lang = 'he';
document.documentElement.dir = 'rtl';
applyThemePreference(readThemePreference());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Lets the installed app open without a connection (public/sw.js). Builds only: in development Vite serves
// the files, and where service workers aren't allowed (an embedded preview) the app simply works online.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    } catch {
      // A sandboxed frame refuses even to look; the app works without it
    }
  });
}
