import { appConfig } from '../config';
import type { ChatLine, ChatLineType, Interaction } from '../types';

// Mirrored WhatsApp conversations (server/src/whatsapp/chat.ts writes them; this shows them).

export const isMirroredChat = (entry: Pick<Interaction, 'source'>) => entry.source === 'whatsapp';

/** What a message that isn't text is, as the app shows it */
export const LINE_LABEL: Partial<Record<ChatLineType, string>> = {
  image: 'תמונה',
  video: 'סרטון',
  audio: 'קובץ שמע',
  document: 'מסמך',
  sticker: 'מדבקה',
  location: 'מיקום',
  contact: 'איש קשר',
  poll: 'סקר',
  other: 'הודעה מסוג שלא נתמך',
};

/** Missed calls are stored the way the server names them (server/src/whatsapp/chat.ts); this is how the app shows them */
const CALL_LABEL: Record<string, string> = {
  'Missed voice call': 'שיחה קולית שלא נענתה',
  'Missed video call': 'שיחת וידאו שלא נענתה',
};
export const callLabel = (text: string) => CALL_LABEL[text] ?? text;

/** The same, as the server writes it into the entry's text for the AI coach (server/src/whatsapp/chat.ts) */
const AI_LABEL: Partial<Record<ChatLineType, string>> = {
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

/** One message as text, without its time and sender: what the AI coach reads */
export function describeLine(line: ChatLine): string {
  if (line.deleted) return '[Deleted message]';
  const edited = line.edited ? ' (edited)' : '';
  switch (line.type) {
    case 'text':
      return line.text + edited;
    case 'voice': {
      const length = line.seconds !== null ? ` ${formatSeconds(line.seconds)}` : '';
      return line.transcript ? `[Voice note${length}] «${line.transcript}»` : `[Voice note${length}, not transcribed]`;
    }
    case 'reaction':
      return `[Reacted ${line.text}]`;
    case 'call':
      return `[${line.text}]`;
    default:
      return `[${AI_LABEL[line.type] ?? 'Message'}]${line.text ? ` ${line.text}` : ''}${edited}`;
  }
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The conversation as text, "14:02 Amir: …", like the server stores it in the entry's body */
export function renderConversation(lines: readonly ChatLine[], contactName: string): string {
  const them = contactName.trim().split(/\s+/)[0] || 'Lead';
  return lines.map((line) => `${clock.format(new Date(line.at))} ${line.fromMe ? 'Me' : them}: ${describeLine(line).replace(/\n/g, '\n  ')}`).join('\n');
}

const displayClock = new Intl.DateTimeFormat(appConfig.locale, { hour: 'numeric', minute: '2-digit' });

/** "09:12–16:40": the span of a day's conversation, in the app's clock */
export function chatSpan(lines: readonly ChatLine[]): string {
  if (!lines.length) return '';
  const first = displayClock.format(new Date(lines[0].at));
  const last = displayClock.format(new Date(lines[lines.length - 1].at));
  return first === last ? first : `${first}–${last}`;
}
