import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * WHATSAPP_AUTH_KEY seals the linked device's keys in the database. Whoever holds those keys can read and
 * send as the linked device, so they are never stored in the clear. No Baileys here: config.ts reads it.
 */

const VERSION = 'v1';

/** 32 random bytes, written as 64 hex characters or base64. Null when it isn't one. */
export function parseAuthKey(text: string): Buffer | null {
  const value = text.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

/** AES-256-GCM, with each value bound to its own id: a sealed value moved to another id won't open. */
export function createSealer(key: Buffer) {
  if (key.length !== 32) throw new Error('The WhatsApp key must be 32 bytes.');
  return {
    seal(id: string, plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(id));
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
    },
    /** Throws when the value was sealed with another key, was changed, or belongs to another id */
    open(id: string, sealed: string): string {
      const [version, iv, tag, data] = sealed.split('.');
      if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('Unreadable WhatsApp key.');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
