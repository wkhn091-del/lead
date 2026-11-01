/**
 * The read-only guard for the WhatsApp link.
 *
 * The server links to WhatsApp as a companion device (the way WhatsApp Web does) only to READ chats with
 * leads. It must never send anything a lead could receive or see: no message, reaction, read tick, "online"
 * or "typing…" status, call, group invite or block. Four independent layers enforce that, and any one of
 * them alone stops a message:
 *
 * 1. Config: the socket starts invisible (no "online" presence on connect) and keeps no copy of messages,
 *    so it has nothing it could resend.
 * 2. Method lock: every send-capable method on the socket is replaced with one that throws, and the rest of
 *    the server never gets the socket: only the narrow read-only facade in client.ts.
 * 3. Message lock: Baileys hands every outgoing message to `patchMessageBeforeSending` before encrypting it.
 *    Ours throws for anything but a history request addressed to your own phone.
 * 4. Wire lock: Baileys shows every frame to its logger, at trace level, just before writing it. Ours reads
 *    each one and, unless it is on the allow list below, makes the socket report itself closed to that one
 *    write, so the frame is never encrypted or sent. A self-test proves this on the real socket before it
 *    connects; if the proof fails, the link refuses to start.
 *
 * What still goes out is what any linked device must send to stay connected and decrypt: the handshake,
 * keep-alive pings, encryption keys, acknowledgements, delivery receipts and history requests to your own
 * phone. Delivery receipts are the grey ticks WhatsApp Web sends too; they don't say a message was read.
 *
 * This file has no runtime dependency on Baileys, so the policy can be read and tested on its own.
 */

/** Something tried to make the WhatsApp link send. Nothing was sent. */
export class ReadOnlyViolation extends Error {
  constructor(readonly action: string) {
    super(`Blocked: the WhatsApp link is read-only and never ${action}.`);
    this.name = 'ReadOnlyViolation';
  }
}

/**
 * quiet: harmless protocol chatter a read-only device doesn't need (Baileys sends some on its own).
 * critical: an attempt to reach a lead or change the account. The link stops until you reconnect it.
 */
export type Severity = 'quiet' | 'critical';

export type FrameVerdict = { allow: true } | { allow: false; severity: Severity; what: string };

export interface GuardEvent {
  at: Date;
  severity: Severity;
  /** In words, for the WhatsApp settings screen: "a read receipt", "sendMessage()" */
  what: string;
  layer: 'method' | 'message' | 'wire';
}

export interface GuardReport {
  selfTest: 'pending' | 'passed' | 'failed';
  blocked: number;
  critical: number;
  /** Newest first, at most 20 */
  recent: GuardEvent[];
}

/** The account's own user ids (phone number and LID), from the linked device's credentials */
export type OwnUsers = () => ReadonlySet<string>;

// ---------------------------------------------------------------------------------------------------------
// Frames: the allow list
// ---------------------------------------------------------------------------------------------------------

/** "972541234567:12@s.whatsapp.net" → "972541234567" (device and agent dropped) */
export function jidUser(jid: string | undefined): string {
  if (!jid) return '';
  const at = jid.indexOf('@');
  return (at >= 0 ? jid.slice(0, at) : jid).split(':')[0].split('_')[0];
}

interface ParsedFrame {
  tag: string;
  /** Null when the attributes couldn't be read with certainty (then only harmless tags may pass) */
  attrs: Record<string, string> | null;
  /** Tags of the direct children */
  children: string[];
}

const ATTRIBUTE = /([^\s=']+)='([^']*)'/g;

/** Reads Baileys' text form of a frame: `<tag key='value' …>`, then its direct children on lines indented by two tabs. */
export function parseFrame(xml: string): ParsedFrame | null {
  const head = /^<([^\s/>]+) (.*?)(\/>|>)(?:\n|$)/.exec(xml);
  if (!head) return null;
  const [, tag, attributeText] = head;
  const attrs: Record<string, string> = {};
  const pairs: string[] = [];
  for (const match of attributeText.matchAll(ATTRIBUTE)) {
    attrs[match[1]] = match[2];
    pairs.push(match[0]);
  }
  // Every character must belong to a key='value' pair; otherwise a value held a quote and can't be trusted.
  const exact = pairs.join(' ') === attributeText.trim();
  const children = [...xml.matchAll(/^\t\t<([^\s/>]+)/gm)].map((match) => match[1]);
  return { tag, attrs: exact ? attrs : null, children };
}

/** Receipt types a linked device sends on its own. None of them says a message was read or played. */
const RECEIPTS_ALLOWED: Record<string, string> = {
  '': 'delivered (grey ticks)',
  inactive: 'delivered while in the background',
  sender: 'a copy of your own message reached this device',
  peer_msg: 'a message between your own devices',
  hist_sync: 'history chunk received from your phone',
  retry: 'asks the sender to re-encrypt a message this device could not read',
};

/** `iq type='set'` namespaces needed to stay linked. Everything else that changes something is blocked. */
const IQ_SETS_ALLOWED = new Set(['encrypt', 'passive', 'urn:xmpp:whatsapp:dirty']);

const allow: FrameVerdict = { allow: true };
const block = (severity: Severity, what: string): FrameVerdict => ({ allow: false, severity, what });

/** Decides whether one outgoing frame may be written. Anything not explicitly allowed is blocked. */
export function classifyFrame(xml: string, ownUsers: ReadonlySet<string>): FrameVerdict {
  const frame = parseFrame(xml);
  if (!frame) return block('critical', 'an unreadable frame');
  const { tag, attrs, children } = frame;
  const toSelf = attrs?.to !== undefined && ownUsers.has(jidUser(attrs.to));

  switch (tag) {
    case 'message':
      // Only history requests to your own phone. Its 'peer' category keeps it off every chat.
      if (attrs?.category === 'peer' && toSelf) return allow;
      return block('critical', 'a message');
    case 'receipt': {
      if (!attrs) return block('critical', 'a receipt');
      const type = attrs.type ?? '';
      if (type in RECEIPTS_ALLOWED) return allow;
      // Asks your own phone to upload an old voice note again
      if (type === 'server-error' && toSelf) return allow;
      return block('critical', type.startsWith('read') ? 'a read receipt (blue ticks)' : type.startsWith('played') ? 'a "played" receipt' : `a "${type}" receipt`);
    }
    case 'presence':
      if (attrs && attrs.type === 'unavailable' && attrs.to === undefined) return allow;
      // Baileys sends a bare <presence name=…/> when your profile name syncs. It would show you as online.
      if (attrs && attrs.type === undefined && attrs.to === undefined) return block('quiet', 'an "online" presence');
      return block('critical', attrs?.type ? `a "${attrs.type}" presence` : 'a presence update');
    case 'chatstate':
      return block('critical', 'a typing or recording indicator');
    case 'call':
      return block('critical', 'a call action');
    case 'ack':
      return attrs ? allow : block('quiet', 'an unreadable acknowledgement');
    case 'ib':
      return children.every((child) => child === 'offline_batch' || child === 'unified_session') ? allow : block('quiet', 'a session notice');
    case 'iq':
      return classifyIq(attrs, children, xml);
    default:
      return block('quiet', `an unknown "${tag}" frame`);
  }
}

function classifyIq(attrs: Record<string, string> | null, children: string[], xml: string): FrameVerdict {
  if (!attrs) return block('quiet', 'an unreadable request');
  const { type, xmlns = '' } = attrs;
  // Answers to the server's own requests (pings, pairing)
  if (type === 'result' || type === 'error') return allow;
  if (type === 'get') {
    // WhatsApp's GraphQL endpoint changes things (newsletters) through "get" requests too
    return xmlns === 'w:mex' ? block('quiet', 'a GraphQL request') : allow;
  }
  if (type !== 'set') return block('quiet', `a "${xmlns}" request`);
  if (IQ_SETS_ALLOWED.has(xmlns)) return allow;
  // Fetching contact names and chat settings, never pushing a change (archive, mute, mark read…)
  if (xmlns === 'w:sync:app:state') return xml.includes('<patch') ? block('critical', 'a chat settings change') : allow;
  // Where to download media from
  if (xmlns === 'w:m') return children.length === 1 && children[0] === 'media_conn' ? allow : block('critical', 'a media request');
  // Linking with a pairing code, and unlinking this server
  if (xmlns === 'md') {
    return children.every((child) => child === 'link_code_companion_reg' || child === 'remove-companion-device')
      ? allow
      : block('critical', 'a device change');
  }
  // Privacy tokens Baileys issues to contacts after sending; this device never sends
  if (xmlns === 'privacy' && children.length === 1 && children[0] === 'tokens') return block('quiet', 'a contact token');
  return block('critical', describeIq(xmlns));
}

function describeIq(xmlns: string): string {
  const names: Record<string, string> = {
    'w:g2': 'a group change',
    blocklist: 'a block or unblock',
    privacy: 'a privacy setting change',
    status: 'a profile status change',
    'w:profile:picture': 'a profile picture change',
    disappearing_mode: 'a disappearing messages change',
    newsletter: 'a channel action',
    'w:biz': 'a business profile change',
    'w:biz:catalog': 'a catalog change',
    spam: 'a spam report',
  };
  return names[xmlns] ?? `a "${xmlns}" change`;
}

// ---------------------------------------------------------------------------------------------------------
// Messages: the only content this device may encrypt
// ---------------------------------------------------------------------------------------------------------

/** proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE (checked against Baileys in the tests) */
export const PEER_DATA_OPERATION_REQUEST_MESSAGE = 16;
/** proto.Message.PeerDataOperationRequestType: HISTORY_SYNC_ON_DEMAND and PLACEHOLDER_MESSAGE_RESEND */
export const OWN_PHONE_REQUESTS: ReadonlySet<number> = new Set([3, 4]);

type LooseMessage = Record<string, unknown> & {
  protocolMessage?: { type?: number | null; peerDataOperationRequestMessage?: { peerDataOperationRequestType?: number | null } | null } | null;
  deviceSentMessage?: { destinationJid?: string | null; message?: LooseMessage | null } | null;
};

const IGNORED_KEYS = new Set(['messageContextInfo']);

/**
 * True only for "send me older messages" or "send me the message I couldn't decrypt" requests to your own
 * phone, which carry no content and never reach a chat.
 */
export function isOwnPhoneRequest(message: unknown, recipients: readonly string[] | undefined, ownUsers: ReadonlySet<string>): boolean {
  if (!message || typeof message !== 'object') return false;
  const outer = message as LooseMessage;
  const wrapped = outer.deviceSentMessage;
  if (wrapped && !ownUsers.has(jidUser(wrapped.destinationJid ?? undefined))) return false;
  const inner = (wrapped ? wrapped.message : outer) as LooseMessage | null | undefined;
  if (!inner) return false;
  const contentKeys = Object.keys(inner).filter((key) => inner[key] != null && !IGNORED_KEYS.has(key));
  if (contentKeys.length !== 1 || contentKeys[0] !== 'protocolMessage') return false;
  const protocol = inner.protocolMessage;
  if (protocol?.type !== PEER_DATA_OPERATION_REQUEST_MESSAGE) return false;
  const requestType = protocol.peerDataOperationRequestMessage?.peerDataOperationRequestType;
  if (typeof requestType !== 'number' || !OWN_PHONE_REQUESTS.has(requestType)) return false;
  return Boolean(recipients?.length) && recipients!.every((jid) => ownUsers.has(jidUser(jid)));
}

// ---------------------------------------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------------------------------------

/** Where the guard's own log lines go (the server's console, by default) */
export interface GuardLogSink {
  warn(message: string): void;
  error(message: string): void;
  debug?(message: string): void;
}

/** Baileys' logger interface (pino-compatible) */
export interface BaileysLogger {
  level: string;
  child(bindings: Record<string, unknown>): BaileysLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** The parts of a Baileys socket the guard touches */
export interface GuardableSocket {
  ws: object;
  sendNode: (frame: { tag: string; attrs: Record<string, string> }) => Promise<void>;
  [method: string]: unknown;
}

/**
 * Socket methods the rest of the server may call. Each is either harmless or checked by layers 3 and 4.
 * Every other function on the socket (sendMessage, readMessages, sendPresenceUpdate, chatModify,
 * groupParticipantsUpdate, updateBlockStatus, rejectCall, sendNode, relayMessage, query…) is replaced.
 */
export const SOCKET_METHODS_ALLOWED: ReadonlySet<string> = new Set([
  'end', // closes the connection
  'logout', // unlinks this server from your phone
  'requestPairingCode', // links with a code instead of a QR
  'fetchMessageHistory', // asks your own phone for older messages in a chat
  'requestPlaceholderResend', // asks your own phone for a copy of one message
  'updateMediaMessage', // asks your own phone to upload an old voice note again
  'waitForConnectionUpdate',
  'waitForSocketOpen',
]);

const SELF_TEST_FRAME = { tag: 'message', attrs: { id: 'OMEK-READ-ONLY-SELF-TEST', to: '0@s.whatsapp.net', type: 'text' } };
/** The self-test frame exactly as Baileys shows it to the logger */
const SELF_TEST_XML = `<message id='${SELF_TEST_FRAME.attrs.id}' to='${SELF_TEST_FRAME.attrs.to}' type='${SELF_TEST_FRAME.attrs.type}'/>`;

export interface GuardOptions {
  ownUsers: OwnUsers;
  log: GuardLogSink;
  /** Baileys' own log lines at or above this level are printed */
  baileysLogLevel?: 'error' | 'warn' | 'info' | 'debug';
  /** Called after a critical block, once per socket. The link closes the connection. */
  onCritical?: (event: GuardEvent) => void;
}

export interface ReadOnlyGuard {
  /** Socket settings that must be part of every makeWASocket call */
  readonly socketConfig: {
    logger: BaileysLogger;
    /** Typed loosely here; link.ts hands it to Baileys */
    patchMessageBeforeSending: (message: unknown, recipientJids?: string[]) => unknown;
    markOnlineOnConnect: false;
    emitOwnEvents: false;
    getMessage: () => Promise<undefined>;
  };
  /**
   * Wires layers 2 and 4 into a socket that was created with `socketConfig` and hasn't connected yet, then
   * proves on it that a message frame can't be written. Throws (and closes the socket) if the proof fails.
   */
  arm<T extends GuardableSocket>(socket: T): T;
  report(): GuardReport;
}

export function createReadOnlyGuard(options: GuardOptions): ReadOnlyGuard {
  const { ownUsers, log } = options;
  const levels = ['error', 'warn', 'info', 'debug'] as const;
  const printUpTo = levels.indexOf(options.baileysLogLevel ?? 'warn');

  let selfTest: GuardReport['selfTest'] = 'pending';
  let blocked = 0;
  let critical = 0;
  const recent: GuardEvent[] = [];
  let criticalReported = false;

  /** Set for the one write that follows a blocked frame; read by the socket's isOpen check. */
  let stopNextWrite = false;
  let writesStopped = 0;
  let selfTestFramesSeen = 0;

  function record(event: Omit<GuardEvent, 'at'>) {
    const full = { ...event, at: new Date() };
    blocked += 1;
    if (full.severity === 'critical') critical += 1;
    recent.unshift(full);
    recent.length = Math.min(recent.length, 20);
    if (full.severity === 'critical') {
      log.error(`[whatsapp] Read-only guard blocked ${full.what} (${full.layer} lock). Nothing was sent.`);
      if (!criticalReported) {
        criticalReported = true;
        // After the current write has unwound
        setImmediate(() => options.onCritical?.(full));
      }
    } else {
      log.debug?.(`[whatsapp] Read-only guard held back ${full.what}.`);
    }
    return full;
  }

  /** Layer 4: every outgoing frame passes through here before it is encoded and written. */
  function inspectFrame(xml: string) {
    if (xml === SELF_TEST_XML) {
      selfTestFramesSeen += 1;
      stopNextWrite = true;
      queueMicrotask(() => (stopNextWrite = false));
      return;
    }
    const verdict = classifyFrame(xml, ownUsers());
    if (verdict.allow) return;
    // Never throw here: some of Baileys' callers don't expect a synchronous error. The write that follows
    // finds the socket "closed" and fails before anything is encrypted or sent.
    stopNextWrite = true;
    queueMicrotask(() => (stopNextWrite = false));
    record({ severity: verdict.severity, what: verdict.what, layer: 'wire' });
  }

  function makeLogger(bindings: Record<string, unknown>): BaileysLogger {
    const print = (level: (typeof levels)[number], obj: unknown, msg?: string) => {
      if (levels.indexOf(level) > printUpTo) return;
      const text = typeof obj === 'string' ? obj : (msg ?? (obj as { msg?: string })?.msg ?? '');
      const detail = obj && typeof obj === 'object' && 'err' in obj ? ` ${String((obj as { err: unknown }).err)}` : '';
      const line = `[whatsapp] ${text}${detail}`;
      if (level === 'error' || level === 'warn') log.warn(line);
      else log.debug?.(line);
    };
    const logger: BaileysLogger = {
      // Fixed at trace: Baileys only shows outgoing frames to the logger at this level.
      get level() {
        return 'trace';
      },
      set level(_ignored: string) {},
      child: (more) => makeLogger({ ...bindings, ...more }),
      trace(obj) {
        if (obj && typeof obj === 'object' && (obj as { msg?: unknown }).msg === 'xml send') {
          const xml = (obj as { xml?: unknown }).xml;
          inspectFrame(typeof xml === 'string' ? xml : '');
        }
      },
      debug: (obj, msg) => print('debug', obj, msg),
      info: (obj, msg) => print('info', obj, msg),
      warn: (obj, msg) => print('warn', obj, msg),
      error: (obj, msg) => print('error', obj, msg),
    };
    return logger;
  }

  const socketConfig: ReadOnlyGuard['socketConfig'] = {
    logger: makeLogger({}),
    // Layer 3
    patchMessageBeforeSending(message, recipientJids) {
      if (isOwnPhoneRequest(message, recipientJids, ownUsers())) return message;
      record({ severity: 'critical', what: 'a message', layer: 'message' });
      throw new ReadOnlyViolation('sends WhatsApp messages');
    },
    // Layer 1: never shown as online (your phone keeps its notifications), and no store to resend from
    markOnlineOnConnect: false,
    emitOwnEvents: false,
    getMessage: async () => undefined,
  };

  /** Makes `ws.isOpen` false for exactly one read after a blocked frame: the check at the start of every write. */
  function interceptOpenCheck(ws: object) {
    let owner: object | null = Object.getPrototypeOf(ws);
    let descriptor: PropertyDescriptor | undefined;
    while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, 'isOpen'))) owner = Object.getPrototypeOf(owner);
    const original = descriptor?.get;
    if (!original) throw new Error('לחיבור של וואטסאפ אין בדיקת isOpen, אז אי אפשר להתקין את שומר הקריאה בלבד.');
    Object.defineProperty(ws, 'isOpen', {
      configurable: false,
      enumerable: false,
      get(this: object) {
        if (stopNextWrite) {
          stopNextWrite = false;
          writesStopped += 1;
          return false;
        }
        return original.call(this);
      },
    });
  }

  /** Layer 2 */
  function lockMethods(socket: GuardableSocket) {
    for (const key of Object.keys(socket)) {
      if (typeof socket[key] !== 'function' || SOCKET_METHODS_ALLOWED.has(key)) continue;
      socket[key] = () => {
        record({ severity: 'critical', what: `${key}()`, layer: 'method' });
        throw new ReadOnlyViolation(`runs ${key}()`);
      };
    }
  }

  /** Sends a message frame through the real write path and checks that the guard saw it and stopped the write. */
  function proveWireLock(sendNode: GuardableSocket['sendNode']): boolean {
    const seen = selfTestFramesSeen;
    const stopped = writesStopped;
    try {
      // The socket hasn't connected yet, so this could never leave even without the guard.
      const sent = sendNode(structuredClone(SELF_TEST_FRAME));
      void Promise.resolve(sent).catch(() => {});
    } catch {
      return false;
    }
    return selfTestFramesSeen === seen + 1 && writesStopped === stopped + 1;
  }

  return {
    socketConfig,
    arm(socket) {
      criticalReported = false;
      selfTest = 'pending';
      try {
        interceptOpenCheck(socket.ws);
        const ok = proveWireLock(socket.sendNode.bind(socket));
        selfTest = ok ? 'passed' : 'failed';
        if (!ok) {
          throw new Error(
            'שומר הקריאה בלבד לא הצליח לוודא שהוא חוסם הודעות יוצאות בגרסה הזו של Baileys, ולכן וואטסאפ נשאר כבוי. ' +
              'קבעו את גרסת Baileys שב-package.json, או עדכנו את src/whatsapp/guard.ts לגרסה החדשה.',
          );
        }
        lockMethods(socket);
        return socket;
      } catch (error) {
        selfTest = 'failed';
        try {
          (socket.end as ((error?: Error) => void) | undefined)?.(error as Error);
        } catch {
          // already closed
        }
        throw error;
      }
    },
    report() {
      return { selfTest, blocked, critical, recent: recent.map((event) => ({ ...event })) };
    },
  };
}
