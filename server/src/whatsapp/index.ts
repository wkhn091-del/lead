import type { MediaStorage } from '../media/storage.js';
import type { Stores } from '../stores/types.js';
import type { TranscriptionQueue } from '../transcription/queue.js';
import type { GuardLogSink } from './guard.js';
import { blockedInHebrew } from './labels.js';
import { WhatsAppLink } from './link.js';
import type { WhatsAppService, WhatsAppStatus } from './service.js';
import { WhatsAppSync } from './sync.js';

export interface WhatsAppSettings {
  authKey: Buffer;
  history: 'full' | 'recent';
  countryCode: string;
  voiceNoteDays: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

export interface WhatsAppDependencies {
  stores: Stores;
  storage: MediaStorage;
  transcription: TranscriptionQueue | null;
  timeZone: string;
  settings: WhatsAppSettings;
  log?: GuardLogSink;
}

const consoleLog = (level: WhatsAppSettings['logLevel']): GuardLogSink => ({
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  debug: level === 'debug' || level === 'info' ? (message) => console.log(message) : undefined,
});

/**
 * Starts the read-only WhatsApp sync. Loaded with a dynamic import only when WHATSAPP=on, so the rest of
 * the server never loads Baileys. Connects right away when an account is already linked.
 */
export async function startWhatsApp(deps: WhatsAppDependencies): Promise<WhatsAppService> {
  const { settings } = deps;
  const log = deps.log ?? consoleLog(settings.logLevel);
  const sync = new WhatsAppSync({
    stores: deps.stores,
    storage: deps.storage,
    transcription: deps.transcription,
    timeZone: deps.timeZone,
    countryCode: settings.countryCode,
    voiceNoteDays: settings.voiceNoteDays,
    log,
  });
  deps.transcription?.interceptDelivery((media, text) => sync.deliverTranscript(media, text));

  const link = new WhatsAppLink({
    store: deps.stores.whatsapp,
    authKey: settings.authKey,
    history: settings.history,
    log,
    baileysLogLevel: settings.logLevel,
    handlers: {
      connected: (account) => sync.connected(account),
      disconnected: () => sync.disconnected(),
      history: (batch) => sync.history(batch),
      messages: (batch) => sync.upsert(batch),
      updates: (updates) => sync.updates(updates),
      lidMappings: (pairs) => sync.lidMappings(pairs),
    },
  });
  await link.start();

  const status = (): WhatsAppStatus => {
    const guard = link.guardReport();
    return {
      enabled: true,
      link: link.status(),
      guard: { ...guard, recent: guard.recent.map((event) => ({ ...event, what: blockedInHebrew(event.what), at: event.at.toISOString() })) },
      sync: sync.stats(),
      settings: { history: settings.history, voiceNoteDays: settings.voiceNoteDays, transcribes: Boolean(deps.transcription) },
    };
  };

  return {
    status,
    async link(phone) {
      await link.link(phone);
      return status();
    },
    async reconnect() {
      await link.reconnect();
      return status();
    },
    async unlink() {
      const { removedFromPhone } = await link.unlink();
      return { ...status(), removedFromPhone };
    },
    fetchHistory: (leadId) => sync.fetchHistory(leadId),
    fetchVoiceNote: (leadId, messageId) => sync.fetchVoiceNote(leadId, messageId),
    leadsChanged: (created) => sync.leadsChanged(created),
    stop: () => link.stop(),
  };
}
