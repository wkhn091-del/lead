import { Download, LoaderCircle, Lock, MessageCircle, Mic, PhoneMissed, RotateCcw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { appConfig } from '../../config';
import { callLabel, chatSpan, formatSeconds, LINE_LABEL } from '../../lib/chat';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { count, NOUNS } from '../../lib/hebrew';
import { toneStyle } from '../../lib/stages';
import { isTranscribing, type TimelineItem } from '../../lib/timeline';
import { useTimeline } from '../../store/timeline';
import { useWhatsApp } from '../../store/whatsapp';
import type { ChatLine, Lead, MediaFile } from '../../types';
import { Button } from '../ui/Button';
import { MediaPlayer } from './MediaPlayer';

const fullDate = new Intl.DateTimeFormat(appConfig.locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const clock = new Intl.DateTimeFormat(appConfig.locale, { hour: 'numeric', minute: '2-digit' });

/** Long days start folded: the last messages show, the rest on request */
const FOLDED = 8;

/**
 * A day of WhatsApp messages with the lead, mirrored from the linked phone. It can't be edited or deleted
 * here, and nothing can be sent from it: replies go from your phone.
 */
export function ChatEntry({ item, lead }: { item: TimelineItem; lead: Lead }) {
  const { entry, media } = item;
  const lines = entry.chat ?? [];
  const [all, setAll] = useState(false);
  const shown = all || lines.length <= FOLDED ? lines : lines.slice(-FOLDED);
  const hidden = lines.length - shown.length;
  const files = new Map(media.map((file) => [file.id, file]));
  const them = lead.contactName.trim().split(/\s+/)[0] || 'הליד';

  return (
    <div className="relative flex gap-3 pb-5">
      <span style={toneStyle('var(--whatsapp)')} className="tone-chip relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--glass-strong)]">
        <MessageCircle className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h5 className="text-[14px] font-medium">{item.title}</h5>
          <time dateTime={entry.at} title={fullDate.format(new Date(entry.at))} className="text-[12px] text-fg-faint">
            {formatRelative(entry.at)}
          </time>
          <span className="text-[12px] text-fg-faint">
            {count(lines.length, NOUNS.message)} · <bdi dir="ltr">{chatSpan(lines)}</bdi>
          </span>
          <span title="משוקף מהוואטסאפ. עונים מהטלפון." className="ms-auto inline-flex items-center gap-1 self-center text-[11.5px] text-fg-faint">
            <Lock className="size-3" aria-hidden />
            קריאה בלבד
          </span>
        </div>

        <div className="mt-2 flex flex-col gap-1.5 rounded-2xl bg-[color-mix(in_oklab,var(--whatsapp)_4%,transparent)] px-2.5 py-2.5 ring-1 ring-line ring-inset sm:px-3">
          {hidden > 0 && (
            <button type="button" onClick={() => setAll(true)} className="self-center rounded-full px-3 py-1 text-[12px] font-medium text-fg-muted hover:bg-field hover:text-fg">
              {hidden === 1 ? 'הצגת הודעה קודמת אחת' : `הצגת ${hidden} הודעות קודמות`}
            </button>
          )}
          {shown.map((line) => (
            <Bubble key={line.id} line={line} lead={lead} them={them} media={line.mediaId ? files.get(line.mediaId) : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Bubble({ line, lead, them, media }: { line: ChatLine; lead: Lead; them: string; media: MediaFile | undefined }) {
  const time = clock.format(new Date(line.at));
  if (line.type === 'call') {
    return (
      <p className="flex items-center justify-center gap-1.5 py-1 text-[12px] text-fg-muted">
        <PhoneMissed className="size-3.5 text-[var(--st-no-answer)]" aria-hidden />
        {callLabel(line.text)} · {time}
      </p>
    );
  }
  if (line.type === 'reaction') {
    return (
      <p className={cn('px-1 text-[12px] text-fg-faint', line.fromMe ? 'self-end' : 'self-start')}>
        {line.fromMe ? 'התגובה שלך' : `התגובה של ${them}`}: <span className="text-[14px]">{line.text}</span> · {time}
      </p>
    );
  }
  return (
    <div className={cn('flex max-w-[88%] flex-col gap-1 rounded-2xl px-3 py-2 sm:max-w-[78%]', line.fromMe ? 'self-end rounded-ee-md bg-[color-mix(in_oklab,var(--whatsapp)_15%,var(--raised))]' : 'self-start rounded-es-md bg-raised ring-1 ring-line')}>
      {!line.fromMe && <span className="text-[11.5px] font-semibold text-[var(--whatsapp)]">{them}</span>}
      <Content line={line} lead={lead} media={media} />
      <span className="self-end text-[11px] text-fg-faint tabular-nums">
        {line.edited && !line.deleted ? 'נערכה · ' : ''}
        {time}
      </span>
    </div>
  );
}

function Content({ line, lead, media }: { line: ChatLine; lead: Lead; media: MediaFile | undefined }) {
  const retranscribe = useTimeline((s) => s.retranscribe);
  const fetchVoiceNote = useWhatsApp((s) => s.fetchVoiceNote);
  const [asked, setAsked] = useState(false);

  if (line.deleted) return <p className="text-[13.5px] text-fg-faint italic">ההודעה נמחקה</p>;
  if (line.type === 'text') return <p dir="auto" className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">{line.text}</p>;
  if (line.type !== 'voice') {
    return (
      <p dir="auto" className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">
        <span className="font-medium text-fg-muted">{LINE_LABEL[line.type] ?? 'הודעה'}</span>
        {line.text ? ` · ${line.text}` : ''}
      </p>
    );
  }

  const transcribing = media && isTranscribing(media);
  const failed = media?.transcription?.status === 'failed';
  return (
    <div className="flex min-w-[220px] flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-muted">
        <Mic className="size-3.5 text-[var(--whatsapp)]" aria-hidden />
        הודעה קולית{line.seconds !== null ? ` · ${formatSeconds(line.seconds)}` : ''}
      </p>
      {media && <MediaPlayer media={media} className="bg-transparent ring-0 [&_figcaption]:hidden" />}
      {line.transcript ? (
        <p dir="auto" className="text-[14px] leading-relaxed text-pretty">
          «{line.transcript}»
        </p>
      ) : transcribing ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
          <LoaderCircle className="size-3.5 animate-spin text-[var(--st-answered)]" aria-hidden />
          מתמלל…
        </p>
      ) : failed && media ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-muted">
          <TriangleAlert className="size-3.5 text-danger" aria-hidden />
          {media.transcription?.error}
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => retranscribe(lead.id, media)}>
            <RotateCcw className="size-3.5" aria-hidden />
            לנסות שוב
          </Button>
        </p>
      ) : line.canFetch ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 self-start px-2"
          disabled={asked}
          onClick={() => {
            setAsked(true);
            void fetchVoiceNote(lead.id, line.id);
          }}
        >
          {asked ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
          {asked ? 'מוריד מהוואטסאפ…' : 'הורדה ותמלול'}
        </Button>
      ) : line.mediaError ? (
        <p className="text-[12.5px] text-fg-faint">{line.mediaError}</p>
      ) : !media && !line.mediaId ? (
        <p className="text-[12.5px] text-fg-faint">ההודעה הקולית לא הורדה.</p>
      ) : null}
    </div>
  );
}
