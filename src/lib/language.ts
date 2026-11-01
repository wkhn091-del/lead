import type { CoachLanguage } from '../types';
import { safeStorage } from './storage';

/** The language the AI writes in, shared by the coach and objection training */
const LANGUAGE_KEY = 'omek-crm:coach-language';

export const LANGUAGES = [
  { value: 'he', label: 'עברית' },
  { value: 'en', label: 'English' },
  { value: 'auto', label: 'לפי ההערות' },
] as const satisfies readonly { value: CoachLanguage; label: string }[];

/** Hebrew unless another choice was saved: the app is in Hebrew, so the coach writes in Hebrew too */
export function readLanguage(): CoachLanguage {
  const stored = safeStorage.get(LANGUAGE_KEY);
  return stored === 'en' || stored === 'auto' ? stored : 'he';
}

export const saveLanguage = (language: CoachLanguage) => safeStorage.set(LANGUAGE_KEY, language);
