import { beforeEach, describe, expect, it, vi } from 'vitest';

// A server whose session can end at any time; the leads it serves don't matter here
const server = vi.hoisted(() => ({ session: 'rozen@example.com' as string | null, cleared: 0 }));

vi.mock('../data/repository', () => ({ repository: { kind: 'remote' } }));
vi.mock('../data/auth', () => ({
  authApi: {
    session: async () => server.session,
    login: async (email: string) => {
      server.session = email;
      return email;
    },
    logout: async () => {
      server.session = null;
    },
  },
}));
vi.mock('../lib/kept', () => ({
  kept: {
    clear: async () => {
      server.cleared += 1;
    },
  },
}));

const { useAuth } = await import('./auth');
const { useSync } = await import('./sync');

describe('staying signed in, like an app on a phone', () => {
  beforeEach(() => {
    server.session = 'rozen@example.com';
    server.cleared = 0;
    useAuth.setState({ status: 'checking', email: null, offline: false, expired: false, prompt: false });
    useSync.setState({ held: false });
  });

  it('keeps the app open on the leads when the session ends by itself, and holds what’s written until signing in again', async () => {
    await useAuth.getState().check();
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', expired: false });

    // A year without use, or every session deleted on the server
    server.session = null;
    await useAuth.getState().check();
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', expired: true });
    expect(useSync.getState().held).toBe(true);
    expect(server.cleared).toBe(0);

    useAuth.getState().setPrompt(true);
    expect(await useAuth.getState().signIn('rozen@example.com', 'secret')).toBeNull();
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', expired: false, prompt: false });
    expect(useSync.getState().held).toBe(false);
  });

  it('opens on the copy kept on the phone when the server says the session ended', () => {
    useAuth.setState({ status: 'signed-out' });
    useAuth.getState().keepOnDevice('rozen@example.com');
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', expired: true, email: 'rozen@example.com' });
  });

  it('opens on the copy while the session can’t be checked, and stays when the check fails again', async () => {
    useAuth.getState().resumeOffline('rozen@example.com');
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', offline: true });
    const session = vi.spyOn((await import('../data/auth')).authApi, 'session').mockRejectedValueOnce(new Error('offline'));
    await useAuth.getState().check();
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', offline: true });
    session.mockRestore();
    await useAuth.getState().check();
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', offline: false, expired: false });
  });

  it('deletes this device’s copy only when signing out on purpose', async () => {
    await useAuth.getState().check();
    await useAuth.getState().signOut();
    expect(useAuth.getState()).toMatchObject({ status: 'signed-out', expired: false });
    expect(server.cleared).toBe(1);
    expect(useSync.getState().held).toBe(true);
  });
});
