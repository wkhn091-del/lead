import { create } from 'zustand';
import { authApi } from '../data/auth';
import { repository } from '../data/repository';
import { setUnauthorizedHandler } from '../data/repository/http';
import { kept } from '../lib/kept';
import { useSync } from './sync';
import { toast } from './toasts';

export type AuthStatus = 'checking' | 'signed-out' | 'signed-in' | 'unreachable';

/**
 * Signing in, the way apps on a phone do it: you stay signed in (the session lasts a year and renews with use),
 * and the leads stay on this device whatever happens to the session. Only signing out on purpose removes them
 * from the device; on the server nothing is ever removed by it.
 */
interface AuthState {
  /** False when leads are stored in this browser, where there is nothing to sign in to */
  required: boolean;
  status: AuthStatus;
  email: string | null;
  /**
   * In on the copy kept on this device, before the server confirmed the session: there's no connection, or the
   * server is still waking up. Checked again when the connection comes back.
   */
  offline: boolean;
  /**
   * The session ended by itself (a year without use, or signed out everywhere) while this device has the leads:
   * the app stays open on them and what's written is kept; signing in again sends it.
   */
  expired: boolean;
  /** The sign-in form over the app, to sign in again without leaving it */
  prompt: boolean;
  check: () => Promise<void>;
  /** Opens the app on the kept copy while the session can't be checked yet (store/offline.ts) */
  resumeOffline: (email: string | null) => void;
  /** The server says the session ended, but this device has the leads: stay on them (store/offline.ts) */
  keepOnDevice: (email: string | null) => void;
  setPrompt: (open: boolean) => void;
  /** Resolves to an error message, or null when signed in */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** Signing out on purpose: ends the session and removes the leads kept on this device */
  signOut: () => Promise<void>;
}

const required = repository.kind === 'remote';

export const useAuth = create<AuthState>()((set, get) => ({
  required,
  status: required ? 'checking' : 'signed-in',
  email: null,
  offline: false,
  expired: false,
  prompt: false,

  async check() {
    if (!get().required) return;
    // In the app already (on the kept copy): checked quietly, without leaving it
    if (get().status !== 'signed-in') set({ status: 'checking' });
    try {
      const email = await authApi.session();
      if (email) {
        set({ status: 'signed-in', email, offline: false, expired: false });
        // Changes made meanwhile go out now
        useSync.getState().setHeld(false);
        return;
      }
      useSync.getState().setHeld(true);
      if (get().status === 'signed-in') set({ expired: true, offline: false });
      else set({ status: 'signed-out', email: null, offline: false });
    } catch {
      // In on the kept copy: stay, and check again when the connection is back
      if (get().status === 'signed-in') return;
      set({ status: 'unreachable' });
    }
  },

  resumeOffline(email) {
    const { status } = get();
    if (status === 'checking' || status === 'unreachable') set({ status: 'signed-in', email, offline: true });
  },

  keepOnDevice(email) {
    useSync.getState().setHeld(true);
    set({ status: 'signed-in', email, offline: false, expired: true });
  },

  setPrompt(prompt) {
    set({ prompt });
  },

  async signIn(email, password) {
    try {
      const signedInAs = await authApi.login(email, password);
      set({ status: 'signed-in', email: signedInAs, offline: false, expired: false, prompt: false });
      useSync.getState().setHeld(false);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'משהו השתבש. נסו שוב.';
    }
  },

  async signOut() {
    await authApi.logout().catch(() => undefined);
    useSync.getState().setHeld(true);
    set({ status: 'signed-out', email: null, offline: false, expired: false, prompt: false });
    // The copy kept on this device goes with it. Changes not sent yet stay, for the next sign-in.
    void kept.clear();
  },
}));

// Any API call that comes back 401 means the session expired or was revoked. The app stays open on what it has,
// and what's written waits until signing in again.
setUnauthorizedHandler(() => {
  useSync.getState().setHeld(true);
  const { status, expired } = useAuth.getState();
  if (status !== 'signed-in' || expired) return;
  useAuth.setState({ expired: true, offline: false });
  toast.show({
    message: 'צריך להיכנס שוב',
    description: 'כל המידע נשאר כאן, ומה שתכתבו נשמר. אחרי הכניסה הוא יישלח לשרת.',
    duration: 9000,
    action: { label: 'כניסה', onClick: () => useAuth.getState().setPrompt(true) },
  });
});
