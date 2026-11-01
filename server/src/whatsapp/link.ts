import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  type BaileysEventMap,
  type WAMessage,
  type WASocket,
} from 'baileys';
import QRCode from 'qrcode';
import { ConflictError, type WhatsAppStore } from '../stores/types.js';
import { AuthKeyMismatchError, isLinked, openAuthState, type StoredAuthState } from './auth-state.js';
import { createReadOnlyGuard, jidUser, type GuardLogSink, type ReadOnlyGuard } from './guard.js';
import { blockedInHebrew } from './labels.js';
import type { WhatsAppLinkState } from './service.js';

/**
 * The connection to WhatsApp, as a linked device of your own number. Owns the socket, its read-only guard
 * and its lifecycle (link, reconnect, unlink). Everything else gets the narrow `LinkedAccount` facade:
 * read-only lookups and requests to your own phone, nothing that can reach a lead.
 */

export interface LinkedAccount {
  /** Your own user ids (phone number and privacy id) */
  ownUsers(): ReadonlySet<string>;
  /** WhatsApp's own mapping from a privacy id (…@lid) to a phone number */
  phoneForLid(lidJid: string): Promise<string | null>;
  /** Downloads a voice note. When WhatsApp no longer has the file, asks your phone to upload it again. */
  downloadVoiceNote(message: WAMessage): Promise<Buffer>;
  /** Asks your own phone for up to `count` messages older than `before` in its chat */
  requestOlderMessages(before: { chatJid: string; id: string; fromMe: boolean; at: Date }, count: number): Promise<void>;
  /** Asks your own phone to send this device a copy of one message */
  requestMessage(key: { remoteJid: string; id: string; fromMe: boolean }): Promise<void>;
}

/** What the sync layer receives from the socket, in order */
export interface LinkHandlers {
  connected(account: LinkedAccount): void;
  disconnected(): void;
  history(batch: BaileysEventMap['messaging-history.set']): Promise<void>;
  messages(batch: BaileysEventMap['messages.upsert']): Promise<void>;
  updates(updates: BaileysEventMap['messages.update']): Promise<void>;
  lidMappings(pairs: { lid: string; pn: string }[]): void;
}

export interface LinkOptions {
  store: WhatsAppStore;
  authKey: Buffer;
  /** full asks your phone for all of its history when linking; recent for the last months */
  history: 'full' | 'recent';
  log: GuardLogSink;
  baileysLogLevel?: 'error' | 'warn' | 'info' | 'debug';
  handlers: LinkHandlers;
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000];

function statusCodeOf(error: unknown): number | undefined {
  return (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
}

export class WhatsAppLink {
  private socket: WASocket | null = null;
  private auth: StoredAuthState | null = null;
  private guard: ReadOnlyGuard;
  private state: WhatsAppLinkState = { state: 'unlinked' };
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pairingPhone: string | null = null;
  private pairingRequested = false;
  private version: [number, number, number] | null = null;
  /** Bumped for every socket, so events from a closed one are ignored */
  private generation = 0;
  private stopping = false;
  /** Set when the guard tripped: the link stays down until you reconnect it */
  private guardReason: string | null = null;
  /** Events are handled one batch at a time, in the order they arrived */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: LinkOptions) {
    this.guard = this.newGuard();
  }

  private newGuard() {
    return createReadOnlyGuard({
      ownUsers: () => this.ownUsers(),
      log: this.options.log,
      baileysLogLevel: this.options.baileysLogLevel,
      onCritical: (event) => {
        this.guardReason = `שומר הקריאה בלבד עצר את החיבור: משהו ניסה לשלוח ${blockedInHebrew(event.what)}. שום דבר לא נשלח. התחברו מחדש כדי להמשיך.`;
        this.socket?.end(new Error('read-only guard'));
      },
    });
  }

  status(): WhatsAppLinkState {
    // The profile name can arrive after the connection opens
    if (this.state.state === 'connected') {
      const name = this.auth?.state.creds.me?.name;
      return { ...this.state, name: name && name !== '~' ? name : this.state.name };
    }
    return this.state;
  }

  guardReport() {
    return this.guard.report();
  }

  private ownUsers(): ReadonlySet<string> {
    const me = this.auth?.state.creds.me;
    return new Set([jidUser(me?.id), jidUser(me?.lid)].filter(Boolean));
  }

  /** Connects with the saved link, if there is one */
  async start(): Promise<void> {
    try {
      this.auth = await openAuthState(this.options.store, this.options.authKey);
    } catch (error) {
      this.state = { state: 'stopped', reason: error instanceof AuthKeyMismatchError ? error.message : 'לא הצלחנו לקרוא את הקישור השמור לוואטסאפ.' };
      if (!(error instanceof AuthKeyMismatchError)) this.options.log.error(`[whatsapp] ${String(error)}`);
      return;
    }
    // Connecting can take a few seconds; the server doesn't wait for it to start.
    if (isLinked(this.auth.state.creds)) void this.connect();
  }

  /** Starts linking: a QR code to scan, or a code to type on the phone when `phone` is given */
  async link(phone: string | null): Promise<void> {
    if (this.auth && isLinked(this.auth.state.creds)) {
      throw new ConflictError('וואטסאפ כבר מקושר. נתקו אותו קודם כדי לקשר חשבון אחר.');
    }
    this.clearReconnect();
    this.closeSocket();
    await this.options.store.clearAuth();
    this.auth = await openAuthState(this.options.store, this.options.authKey);
    this.pairingPhone = phone;
    this.pairingRequested = false;
    this.guardReason = null;
    this.guard = this.newGuard();
    this.attempt = 0;
    await this.connect();
  }

  /** Reconnects after the guard stopped the link, or after a refused connection */
  async reconnect(): Promise<void> {
    if (!this.auth || !isLinked(this.auth.state.creds)) throw new ConflictError('אין מה לחבר מחדש: קשרו קודם את וואטסאפ.');
    this.guardReason = null;
    this.guard = this.newGuard();
    this.attempt = 0;
    await this.connect();
  }

  /** Removes this server from your phone's linked devices and forgets its keys. Mirrored chats stay. */
  async unlink(): Promise<{ removedFromPhone: boolean }> {
    this.clearReconnect();
    const socket = this.socket;
    const wasLinked = Boolean(this.auth && isLinked(this.auth.state.creds));
    let removedFromPhone = false;
    if (socket && this.state.state === 'connected') {
      try {
        this.generation += 1;
        await socket.logout('Unlinked from Omek Leads');
        removedFromPhone = true;
      } catch (error) {
        this.options.log.warn(`[whatsapp] Couldn't tell WhatsApp to unlink: ${String(error)}`);
      }
    }
    this.closeSocket();
    await this.options.store.clearAuth();
    this.auth = null;
    this.state = {
      state: 'unlinked',
      // Offline, WhatsApp couldn't be told: the device stays on the phone's list until it's removed there
      reason: wasLinked && !removedFromPhone ? 'הסירו את השרת הזה גם מ"מכשירים מקושרים" בטלפון.' : undefined,
    };
    this.options.handlers.disconnected();
    return { removedFromPhone };
  }

  /** For shutdown: closes the connection without unlinking */
  stop() {
    this.stopping = true;
    this.clearReconnect();
    this.closeSocket();
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.generation += 1;
    try {
      socket?.end(undefined);
    } catch {
      // already closed
    }
  }

  private async latestVersion(): Promise<[number, number, number] | undefined> {
    if (this.version) return this.version;
    try {
      const result = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
      if (result?.version) this.version = result.version as [number, number, number];
    } catch {
      // Baileys' built-in version is used
    }
    return this.version ?? undefined;
  }

  private async connect(): Promise<void> {
    if (this.stopping || !this.auth) return;
    this.clearReconnect();
    this.closeSocket();
    const generation = ++this.generation;
    const auth = this.auth;
    const full = this.options.history === 'full';
    this.state = this.state.state === 'reconnecting' ? this.state : { state: 'connecting' };

    const version = await this.latestVersion();
    if (generation !== this.generation) return;
    let socket: WASocket;
    try {
      socket = makeWASocket({
        ...this.guard.socketConfig,
        patchMessageBeforeSending: this.guard.socketConfig.patchMessageBeforeSending as never,
        ...(version ? { version } : {}),
        auth: {
          creds: auth.state.creds,
          keys: makeCacheableSignalKeyStore(auth.state.keys, this.guard.socketConfig.logger),
        },
        // A desktop client gets the most history from the phone
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: full,
        shouldSyncHistoryMessage: ({ syncType }) => full || syncType !== proto.HistorySync.HistorySyncType.FULL,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30_000,
        keepAliveIntervalMs: 25_000,
      });
      // Layers 2 and 4 of the guard, and the proof that they hold. Throws when they don't.
      this.guard.arm(socket);
    } catch (error) {
      this.state = { state: 'stopped', reason: error instanceof Error ? error.message : 'וואטסאפ לא הצליח לעלות.' };
      this.options.log.error(`[whatsapp] ${this.state.reason}`);
      return;
    }
    this.socket = socket;

    socket.ev.process((events) => {
      if (generation !== this.generation) return;
      // creds first, so keys never get ahead of the credentials that use them
      if (events['creds.update']) void auth.saveCreds().catch((error: unknown) => this.options.log.error(`[whatsapp] Couldn't save the link: ${String(error)}`));
      if (events['connection.update']) this.onConnectionUpdate(events['connection.update'], socket, generation);
      const work: (() => Promise<void> | void)[] = [];
      const lid = events['lid-mapping.update'];
      if (lid) work.push(() => this.options.handlers.lidMappings([lid]));
      const history = events['messaging-history.set'];
      if (history) {
        if (history.lidPnMappings?.length) work.push(() => this.options.handlers.lidMappings(history.lidPnMappings!));
        work.push(() => this.options.handlers.history(history));
      }
      const upsert = events['messages.upsert'];
      if (upsert) work.push(() => this.options.handlers.messages(upsert));
      const updates = events['messages.update'];
      if (updates) work.push(() => this.options.handlers.updates(updates));
      for (const job of work) {
        this.queue = this.queue
          .then(job)
          .catch((error: unknown) => this.options.log.error(`[whatsapp] Sync failed for one batch: ${error instanceof Error ? error.stack : String(error)}`));
      }
    });
  }

  private onConnectionUpdate(update: BaileysEventMap['connection.update'], socket: WASocket, generation: number) {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      if (this.pairingPhone) {
        // The socket is ready to pair. Ask once for a code instead of showing the QR.
        if (!this.pairingRequested) {
          this.pairingRequested = true;
          const phone = this.pairingPhone;
          this.state = { state: 'linking', method: 'code', code: null, phone };
          socket
            .requestPairingCode(phone)
            .then((code) => {
              if (generation === this.generation) this.state = { state: 'linking', method: 'code', code: code.match(/.{1,4}/g)?.join('-') ?? code, phone };
            })
            .catch((error: unknown) => {
              this.options.log.warn(`[whatsapp] Pairing code request failed: ${String(error)}`);
              if (generation === this.generation) this.state = { state: 'stopped', reason: 'וואטסאפ לא נתן קוד צימוד. בדקו את המספר ונסו שוב, או קשרו עם קוד ה-QR.' };
              this.closeSocket();
            });
        }
      } else {
        void QRCode.toDataURL(qr, { margin: 1, width: 320, errorCorrectionLevel: 'M' }).then((image) => {
          if (generation === this.generation) {
            this.state = { state: 'linking', method: 'qr', qr: image, expiresAt: new Date(Date.now() + 20_000).toISOString() };
          }
        });
      }
    }
    if (connection === 'open') {
      this.attempt = 0;
      this.pairingPhone = null;
      const me = this.auth?.state.creds.me;
      this.state = { state: 'connected', since: new Date().toISOString(), phone: jidUser(me?.id), name: me?.name && me.name !== '~' ? me.name : null };
      this.options.handlers.connected(this.account(socket));
    }
    if (connection === 'close') {
      if (generation !== this.generation) return;
      this.socket = null;
      this.options.handlers.disconnected();
      this.afterClose(statusCodeOf(lastDisconnect?.error), lastDisconnect?.error);
    }
  }

  private afterClose(code: number | undefined, error: Error | undefined) {
    if (this.stopping) return;
    if (this.guardReason) {
      this.state = { state: 'stopped', reason: this.guardReason };
      return;
    }
    const linked = Boolean(this.auth && isLinked(this.auth.state.creds));
    switch (code) {
      case DisconnectReason.restartRequired:
        // Normal right after scanning the QR: WhatsApp asks for a fresh connection with the new keys
        void this.connect();
        return;
      case DisconnectReason.loggedOut:
        void this.options.store.clearAuth();
        this.auth = null;
        this.state = { state: 'unlinked', reason: linked ? 'וואטסאפ ניתק את השרת הזה (הוא הוסר מ"מכשירים מקושרים" בטלפון).' : undefined };
        return;
      case DisconnectReason.connectionReplaced:
        this.state = { state: 'stopped', reason: 'שרת אחר התחבר עם אותו קישור. רק עותק אחד של השרת יכול לסנכרן את וואטסאפ בכל רגע.' };
        return;
      case DisconnectReason.badSession:
        void this.options.store.clearAuth();
        this.auth = null;
        this.state = { state: 'unlinked', reason: 'הקישור השמור נפגם. קשרו את וואטסאפ מחדש.' };
        return;
      case DisconnectReason.forbidden:
      case DisconnectReason.multideviceMismatch:
        this.state = { state: 'stopped', reason: 'וואטסאפ דחה את המכשיר המקושר הזה. בדקו את החשבון בטלפון, ואז התחברו מחדש.' };
        return;
    }
    if (!linked) {
      // Linking never finished: the server couldn't reach WhatsApp, or the codes ran out before the phone confirmed
      const reached = this.state.state === 'linking';
      this.state = {
        state: 'unlinked',
        reason: reached
          ? 'הקישור נעצר לפני שהטלפון אישר אותו. התחילו מחדש כשהטלפון מוכן.'
          : `השרת לא הצליח להגיע לוואטסאפ (${error?.message ?? 'אין חיבור'}). בדקו את החיבור שלו לאינטרנט ונסו שוב.`,
      };
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.options.log.warn(`[whatsapp] Connection closed (${error?.message ?? 'no reason given'}); reconnecting in ${Math.round(delay / 1000)}s.`);
    this.state = {
      state: 'reconnecting',
      attempt: this.attempt,
      retryAt: new Date(Date.now() + delay).toISOString(),
      reason: 'החיבור לוואטסאפ נפל.',
    };
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
    this.reconnectTimer.unref();
  }

  /** The read-only facade handed to the sync layer */
  private account(socket: WASocket): LinkedAccount {
    const logger = this.guard.socketConfig.logger;
    return {
      ownUsers: () => this.ownUsers(),
      async phoneForLid(lidJid) {
        const pn = await socket.signalRepository.lidMapping.getPNForLID(lidJid).catch(() => null);
        return pn ? jidUser(pn) : null;
      },
      async downloadVoiceNote(message) {
        return downloadMediaMessage(message, 'buffer', {}, { logger: logger as never, reuploadRequest: socket.updateMediaMessage });
      },
      async requestOlderMessages(before, count) {
        await socket.fetchMessageHistory(count, { remoteJid: before.chatJid, id: before.id, fromMe: before.fromMe }, before.at.getTime());
      },
      async requestMessage(key) {
        await socket.requestPlaceholderResend(key);
      },
    };
  }
}
