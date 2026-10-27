import {
  BufferJSON,
  getContentType,
  isLidUser,
  isPnUser,
  normalizeMessageContent,
  toNumber,
  WAMessageStubType,
  type proto,
  type WAMessage,
} from 'baileys';
import { dayKey, nextDay, startOfDay } from '../daily/time.js';
import type { ChatLine, ChatLineType } from '../stores/types.js';
import { jidUser } from './guard.js';

/**
 * Turning WhatsApp messages into timeline lines. A lead's conversation is mirrored as one read-only
 * timeline entry per day ("wa-<lead>-<day>"): `chat` holds the messages for the app to show as a chat,
 * `body` the same conversation as text for the AI coach.
 */

/** One-to-one chats only: a phone number or WhatsApp's privacy id. Groups, channels and status are skipped. */
export function isDirectChat(jid: string | null | undefined): jid is string {
  return Boolean(jid && (isPnUser(jid) || isLidUser(jid)));
}

export function phoneOfJid(jid: string | null | undefined): string | null {
  return jid && isPnUser(jid) ? jidUser(jid) || null : null;
}

export const dayEntryId = (leadId: string, day: string) => `wa-${leadId}-${day}`;

export const isDayEntryId = (id: string | null | undefined) => Boolean(id?.startsWith('wa-'));

/** The day's span in the app's time zone */
export function dayRange(day: string, timeZone: string) {
  return { from: startOfDay(day, timeZone), to: startOfDay(nextDay(day), timeZone) };
}

export function messageTime(message: WAMessage): Date | null {
  const seconds = message.messageTimestamp ? toNumber(message.messageTimestamp) : 0;
  return seconds > 0 ? new Date(seconds * 1000) : null;
}

const MISSED_CALLS: Partial<Record<number, string>> = {
  [WAMessageStubType.CALL_MISSED_VOICE]: 'Missed voice call',
  [WAMessageStubType.CALL_MISSED_VIDEO]: 'Missed video call',
};

const clean = (text: string | null | undefined) => (text ?? '').replace(/\r\n?/g, '\n').trim();

interface Parsed {
  type: ChatLineType;
  text: string;
  seconds: number | null;
}

/** What a message says, or null for things that aren't part of the conversation (receipts, key exchanges…) */
export function parseContent(message: WAMessage): Parsed | null {
  const missed = message.messageStubType ? MISSED_CALLS[message.messageStubType] : undefined;
  if (missed) return { type: 'call', text: missed, seconds: null };
  const content = normalizeMessageContent(message.message);
  return content ? parseInner(content) : null;
}

function parseInner(content: proto.IMessage): Parsed | null {
  const type = getContentType(content);
  const text = (value: string | null | undefined, as: ChatLineType = 'text', seconds: number | null = null): Parsed => ({
    type: as,
    text: clean(value),
    seconds,
  });
  switch (type) {
    case 'conversation':
      return text(content.conversation);
    case 'extendedTextMessage':
      return text(content.extendedTextMessage?.text);
    case 'imageMessage':
      return text(content.imageMessage?.caption, 'image');
    case 'videoMessage':
      return text(content.videoMessage?.caption, 'video', content.videoMessage?.seconds ?? null);
    case 'ptvMessage':
      return text(content.ptvMessage?.caption, 'video', content.ptvMessage?.seconds ?? null);
    case 'audioMessage': {
      const audio = content.audioMessage;
      return text('', audio?.ptt ? 'voice' : 'audio', audio?.seconds ?? null);
    }
    case 'documentMessage': {
      const document = content.documentMessage;
      return text([document?.fileName, document?.caption].filter(Boolean).join(' · '), 'document');
    }
    case 'stickerMessage':
      return text('', 'sticker');
    case 'locationMessage':
    case 'liveLocationMessage': {
      const place = content.locationMessage ?? content.liveLocationMessage;
      const named = content.locationMessage ? [content.locationMessage.name, content.locationMessage.address].filter(Boolean).join(', ') : '';
      const coordinates =
        place?.degreesLatitude != null && place.degreesLongitude != null
          ? `${place.degreesLatitude.toFixed(5)}, ${place.degreesLongitude.toFixed(5)}`
          : '';
      return text(named || coordinates, 'location');
    }
    case 'contactMessage':
      return text(content.contactMessage?.displayName, 'contact');
    case 'contactsArrayMessage':
      return text(content.contactsArrayMessage?.displayName ?? `${content.contactsArrayMessage?.contacts?.length ?? 0} contacts`, 'contact');
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3': {
      const poll = content.pollCreationMessage ?? content.pollCreationMessageV2 ?? content.pollCreationMessageV3;
      return text(poll?.name, 'poll');
    }
    case 'reactionMessage': {
      // An empty reaction removes one; nothing to show
      const emoji = clean(content.reactionMessage?.text);
      return emoji ? text(emoji, 'reaction') : null;
    }
    case 'buttonsResponseMessage':
      return text(content.buttonsResponseMessage?.selectedDisplayText);
    case 'templateButtonReplyMessage':
      return text(content.templateButtonReplyMessage?.selectedDisplayText);
    case 'listResponseMessage':
      return text(content.listResponseMessage?.title);
    case 'interactiveResponseMessage':
      return text(content.interactiveResponseMessage?.body?.text);
    case 'protocolMessage':
    case 'senderKeyDistributionMessage':
    case 'messageContextInfo':
    case 'keepInChatMessage':
    case 'pinInChatMessage':
    case 'pollUpdateMessage':
    case 'encReactionMessage':
    case 'encEventResponseMessage':
    case undefined:
      return null;
    default:
      return text('', 'other');
  }
}

/** The text of an edited message's new version */
export function editedText(edit: proto.IMessage | null | undefined): Parsed | null {
  const content = normalizeMessageContent(edit ?? undefined);
  return content ? parseInner(content) : null;
}

/** The message as a timeline line, or null when there's nothing to show */
export function toChatLine(message: WAMessage, at: Date): ChatLine | null {
  const id = message.key?.id;
  const parsed = id ? parseContent(message) : null;
  if (!id || !parsed) return null;
  return {
    id,
    at,
    fromMe: Boolean(message.key.fromMe),
    type: parsed.type,
    text: parsed.text,
    seconds: parsed.seconds,
    mediaId: null,
    mediaError: null,
    transcript: null,
    edited: false,
    deleted: false,
    ref: parsed.type === 'voice' ? voiceRef(message) : null,
  };
}

/** What downloading a voice note later needs: its key and the media fields, without the rest of the message */
function voiceRef(message: WAMessage): string | null {
  const audio = normalizeMessageContent(message.message)?.audioMessage;
  if (!audio?.mediaKey || !audio.directPath) return null;
  const kept = {
    key: message.key,
    messageTimestamp: message.messageTimestamp,
    message: {
      audioMessage: {
        url: audio.url,
        directPath: audio.directPath,
        mediaKey: audio.mediaKey,
        mediaKeyTimestamp: audio.mediaKeyTimestamp,
        fileEncSha256: audio.fileEncSha256,
        fileSha256: audio.fileSha256,
        fileLength: audio.fileLength,
        mimetype: audio.mimetype,
        seconds: audio.seconds,
        ptt: audio.ptt,
      },
    },
  };
  return JSON.stringify(kept, BufferJSON.replacer);
}

/** A voice note's message again, rebuilt from its ref */
export function messageFromRef(ref: string): WAMessage {
  return JSON.parse(ref, BufferJSON.reviver) as WAMessage;
}

export function mimeTypeOfRef(ref: string | null): string {
  if (!ref) return 'audio/ogg';
  const mime = (messageFromRef(ref).message?.audioMessage?.mimetype ?? 'audio/ogg').split(';')[0].trim();
  return mime || 'audio/ogg';
}

const LABEL: Partial<Record<ChatLineType, string>> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  sticker: 'Sticker',
  location: 'Location',
  contact: 'Contact card',
  poll: 'Poll',
  other: 'Unsupported message',
};

export const formatSeconds = (seconds: number | null) =>
  seconds === null ? '' : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** One line of the conversation as text, without its time and sender */
export function describeLine(line: ChatLine): string {
  if (line.deleted) return '[Deleted message]';
  const edited = line.edited ? ' (edited)' : '';
  switch (line.type) {
    case 'text':
      return line.text + edited;
    case 'voice': {
      const length = line.seconds !== null ? ` ${formatSeconds(line.seconds)}` : '';
      if (line.transcript) return `[Voice note${length}] «${line.transcript}»`;
      return `[Voice note${length}, not transcribed]`;
    }
    case 'reaction':
      return `[Reacted ${line.text}]`;
    case 'call':
      return `[${line.text}]`;
    default:
      return `[${LABEL[line.type] ?? 'Message'}]${line.text ? ` ${line.text}` : ''}${edited}`;
  }
}

/**
 * The conversation as text, one message per line: "14:02 Amir: …" and "14:05 Me: …".
 * This is what the AI coach and the timeline search read.
 */
export function renderConversation(lines: readonly ChatLine[], contactLabel: string, timeZone: string): string {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return lines
    .map((line) => {
      const text = describeLine(line).replace(/\n/g, '\n  ');
      return `${time.format(line.at)} ${line.fromMe ? 'Me' : contactLabel}: ${text}`;
    })
    .join('\n');
}

/** "Amir" for the coach and the timeline; "Lead" when the contact's name isn't known */
export const contactLabel = (contactName: string) => contactName.trim().split(/\s+/)[0] || 'Lead';

export const dayOf = (at: Date, timeZone: string) => dayKey(at, timeZone);
