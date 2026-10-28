import { appConfig } from '../config';
import { ApiError, readErrorMessage } from './repository/http';

const root = (appConfig.apiUrl ?? '').replace(/\/+$/, '');

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });
  if (init.body) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(`${root}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'אין חיבור לשרת. בדקו את החיבור ונסו שוב.');
  }
}

async function emailFrom(response: Response): Promise<string> {
  if (!response.ok) throw new ApiError(response.status, await readErrorMessage(response));
  return ((await response.json()) as { email: string }).email;
}

/** Sign-in calls for the Express API. The session lives in an httpOnly cookie this page can't read. */
export const authApi = {
  /** The signed-in email, or null when there is no valid session */
  async session(): Promise<string | null> {
    const response = await send('/auth/session');
    return response.status === 401 ? null : emailFrom(response);
  },
  async login(email: string, password: string): Promise<string> {
    return emailFrom(await send('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
  },
  async logout(): Promise<void> {
    await send('/auth/logout', { method: 'POST' });
  },
};
