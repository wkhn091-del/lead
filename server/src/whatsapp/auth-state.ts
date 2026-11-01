import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from 'baileys';
import type { WhatsAppStore } from '../stores/types.js';
import { createSealer } from './auth-key.js';

/**
 * The linked device's credentials and Signal keys, kept in the database and sealed with WHATSAPP_AUTH_KEY
 * (see auth-key.ts). Read through Baileys' own cache, so a busy chat doesn't hit the database per message.
 */

export class AuthKeyMismatchError extends Error {
  constructor() {
    super(
      'אי אפשר לפתוח את הקישור השמור לוואטסאפ עם WHATSAPP_AUTH_KEY (המפתח השתנה?). נתקו וקשרו מחדש, או החזירו את המפתח הישן.',
    );
    this.name = 'AuthKeyMismatchError';
  }
}

export interface StoredAuthState {
  state: AuthenticationState;
  /** Writes the credentials; call on every creds.update */
  saveCreds(): Promise<void>;
}

const CREDS_ID = 'creds';
const keyId = (type: string, id: string) => `${type}-${id}`;

/** Loads (or starts) the linked device's auth state. Throws AuthKeyMismatchError when the key is wrong. */
export async function openAuthState(store: Pick<WhatsAppStore, 'readAuth' | 'writeAuth'>, authKey: Buffer): Promise<StoredAuthState> {
  const sealer = createSealer(authKey);
  const decode = (id: string, sealed: string): unknown => {
    try {
      return JSON.parse(sealer.open(id, sealed), BufferJSON.reviver) as unknown;
    } catch {
      throw new AuthKeyMismatchError();
    }
  };
  const encode = (id: string, value: unknown) => sealer.seal(id, JSON.stringify(value, BufferJSON.replacer));

  const saved = (await store.readAuth([CREDS_ID])).get(CREDS_ID);
  const creds = (saved ? decode(CREDS_ID, saved) : initAuthCreds()) as AuthenticationCreds;

  // Writes go one after another, so an older copy of the credentials never overwrites a newer one.
  let writing: Promise<void> = Promise.resolve();
  const queued = (work: () => Promise<void>) => {
    const next = writing.then(work);
    writing = next.catch(() => {});
    return next;
  };

  return {
    state: {
      creds,
      keys: {
        async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
          const values = await store.readAuth(ids.map((id) => keyId(type, id)));
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            const sealed = values.get(keyId(type, id));
            if (sealed === undefined) continue;
            let value = decode(keyId(type, id), sealed);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
            result[id] = value as SignalDataTypeMap[T];
          }
          return result;
        },
        async set(data: SignalDataSet) {
          const entries: { id: string; value: string | null }[] = [];
          for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            for (const [id, value] of Object.entries(data[type] ?? {})) {
              const fullId = keyId(type, id);
              entries.push({ id: fullId, value: value ? encode(fullId, value) : null });
            }
          }
          if (entries.length) await queued(() => store.writeAuth(entries));
        },
      },
    },
    saveCreds: () => queued(() => store.writeAuth([{ id: CREDS_ID, value: encode(CREDS_ID, creds) }])),
  };
}

/** True once a phone has accepted this device (a pairing that was only started doesn't count) */
export function isLinked(creds: AuthenticationCreds): boolean {
  return Boolean(creds.me?.id && creds.account);
}
