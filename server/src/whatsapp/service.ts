/**
 * What the routes see of the WhatsApp sync. Types only: importing this never loads Baileys, which is
 * loaded on demand when WHATSAPP=on (see index.ts).
 */

export type WhatsAppLinkState =
  /** No account linked. `reason` explains why, when the link just ended. */
  | { state: 'unlinked'; reason?: string }
  /** Waiting for your phone: a QR code to scan (renewed every 20 seconds), or a code to type */
  | { state: 'linking'; method: 'qr'; qr: string; expiresAt: string }
  | { state: 'linking'; method: 'code'; code: string | null; phone: string }
  | { state: 'connecting' }
  | { state: 'connected'; since: string; phone: string; name: string | null }
  | { state: 'reconnecting'; attempt: number; retryAt: string; reason: string }
  /** Needs you: the guard tripped, WhatsApp refused the device, or the saved link can't be opened */
  | { state: 'stopped'; reason: string };

export interface WhatsAppGuardStatus {
  /** The guard proved on the live socket that it stops outgoing messages */
  selfTest: 'pending' | 'passed' | 'failed';
  /** Frames and calls it stopped since the server started */
  blocked: number;
  /** Of those, attempts to reach a lead or change the account (the link stops on the first one) */
  critical: number;
  recent: { at: string; severity: 'quiet' | 'critical'; what: string; layer: 'method' | 'message' | 'wire' }[];
}

export interface WhatsAppStatus {
  enabled: true;
  link: WhatsAppLinkState;
  guard: WhatsAppGuardStatus;
  sync: {
    /** Messages mirrored onto lead timelines since the server started */
    messages: number;
    lastMessageAt: string | null;
    /** History from your phone, while it's arriving (0–100) */
    historyProgress: number | null;
    /** Voice notes waiting to be downloaded */
    voiceNotesWaiting: number;
  };
  settings: { history: 'full' | 'recent'; voiceNoteDays: number; transcribes: boolean };
}

export interface WhatsAppOff {
  enabled: false;
  reason: string;
}

export type FetchHistoryResult =
  | { requested: true; message: string }
  | { requested: false; message: string };

export interface WhatsAppService {
  status(): WhatsAppStatus;
  /** Starts linking: a QR code, or a pairing code for `phone` (international digits) */
  link(phone: string | null): Promise<WhatsAppStatus>;
  /** Connects again after the guard or WhatsApp stopped the link */
  reconnect(): Promise<WhatsAppStatus>;
  /** Removes this server from your linked devices and forgets its keys. Mirrored conversations stay. */
  unlink(): Promise<WhatsAppStatus & { removedFromPhone: boolean }>;
  /** Asks your phone for older messages with this lead */
  fetchHistory(leadId: string): Promise<FetchHistoryResult>;
  /** Downloads (and transcribes) a voice note that was too old to fetch on its own */
  fetchVoiceNote(leadId: string, messageId: string): Promise<void>;
  /** Leads were added, changed or deleted: their numbers are matched again */
  leadsChanged(created?: string[]): void;
  stop(): void;
}
