import { safeStorage } from './storage';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Also read by the inline script in index.html, which applies the theme before first paint. */
const STORAGE_KEY = 'omek-crm:theme';
const BROWSER_BAR = { light: '#EDF2F8', dark: '#07111F' } as const;

export function readThemePreference(): ThemePreference {
  const saved = safeStorage.get(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

export function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === 'system') {
    root.removeAttribute('data-theme');
    safeStorage.remove(STORAGE_KEY);
  } else {
    root.setAttribute('data-theme', preference);
    safeStorage.set(STORAGE_KEY, preference);
  }
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = BROWSER_BAR[preference === 'system' ? scheme : preference];
  });
}
