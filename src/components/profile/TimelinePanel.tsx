import { AnimatePresence, motion } from 'motion/react';
import { AudioLines, History, LoaderCircle, Paperclip, Pencil, RotateCcw, Trash2, TriangleAlert, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { appConfig } from '../../config';
import { isMirroredChat } from '../../lib/chat';
import { cn } from '../../lib/cn';
import { drafts } from '../../lib/drafts';
import { formatNumber, formatRelative } from '../../lib/format';
import { EASE_OUT } from '../../lib/motion';
import { RECORDING_ACCEPT } from '../../lib/media';
import { entryMeta, toneStyle } from '../../lib/stages';
import { describeTimeline, isTranscribing, looseMedia, splitTranscripts, transcriptionProgress, type TimelineItem } from '../../lib/timeline';
import { canUndo } from '../../lib/workflow';
import { useLeadStore } from '../../store/leads';
import { useTimeline, type LeadProfile, type Upload } from '../../store/timeline';
import { useUi } from '../../store/ui';
import { useWhatsApp } from '../../store/whatsapp';
import type { Interaction, Lead, MediaFile } from '../../types';
import { Button, buttonStyles } from '../ui/Button';
import { ChatEntry } from './ChatEntry';
import { Composer } from './Composer';
import { MediaPlayer } from './MediaPlayer';

const fullDate = new Intl.DateTimeFormat(appConfig.locale, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Re-renders every 30 seconds, so relative times and Undo stay current. */
function useTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
}

/** Every call, meeting, message and note on a lead, newest first, with recordings and a composer on top. */
export function TimelinePanel({ lead, profile }: { lead: Lead; profile: LeadProfile | undefined }) {
  const load = useTimeline((s) => s.load);
  const uploads = useTimeline(useShallow((s) => s.uploads.filter((upload) => upload.leadId === lead.id)));
  const removeMedia = useTimeline((s) => s.removeMedia);
  const retranscribe = useTimeline((s) => s.retranscribe);
  const canTranscribe = useTimeline((s) => s.features?.transcription.enabled === true);
  const whatsappLinked = useWhatsApp((s) => s.status?.enabled === true && s.status.link.state === 'connected');
  const fetchHistory = useWhatsApp((s) => s.fetchHistory);
  const [asked, setAsked] = useState(false);
  useTick();

  // New WhatsApp messages arrive on the server at any time: check for them while the profile is open
  useEffect(() => {
    if (!whatsappLinked) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(lead.id, true);
    }, 20_000);
    return () => clearInterval(timer);
  }, [whatsappLinked, lead.id, load]);

  const items = useMemo(() => (profile ? describeTimeline(profile.interactions, profile.media) : []), [profile]);
  const loose = useMemo(() => (profile ? looseMedia(profile.media, profile.interactions) : []), [profile]);
  const looseUploads = uploads.filter((upload) => !upload.interactionId);

  return (
    <div className="flex flex-col gap-6">
      <Composer lead={lead} />

      {!profile || profile.status === 'loading' ? (
        <TimelineSkeleton />
      ) : profile.status === 'error' ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-4">
          <p className="text-[13.5px] text-fg-muted">
            לא הצלחנו לטעון את ציר הזמן. <span className="text-fg-faint">{profile.error}</span>
          </p>
          <Button size="sm" onClick={() => void load(lead.id)}>
            <RotateCcw className="size-4" aria-hidden />
            לנסות שוב
          </Button>
        </div>
      ) : (
        <>
          {(loose.length > 0 || looseUploads.length > 0) && (
            <section aria-label="הקלטות של הליד" className="flex flex-col gap-2">
              <h4 className="text-[13px] font-medium text-fg-muted">הקלטות</h4>
              {loose.map((media) => (
                <MediaPlayer
                  key={media.id}
                  media={media}
                  onRemove={() => removeMedia(lead.id, media)}
                  onTranscribe={canTranscribe && (!media.transcription || media.transcription.status === 'failed') ? () => retranscribe(lead.id, media) : undefined}
                  showTranscription
                />
              ))}
              {looseUploads.map((upload) => (
                <UploadRow key={upload.id} upload={upload} />
              ))}
            </section>
          )}

          <section aria-label="ציר זמן">
            <h4 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-fg-muted">
              ציר זמן
              {items.length > 0 && <span className="text-[12.5px] font-normal tabular-nums text-fg-faint">{items.length}</span>}
              {whatsappLinked && lead.phone.trim() && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="-my-1 ms-auto h-8"
                  disabled={asked}
                  title="מבקש מהטלפון שלך הודעות קודמות עם הליד. שום דבר לא נשלח לליד."
                  onClick={() => {
                    setAsked(true);
                    void fetchHistory(lead.id).finally(() => setTimeout(() => setAsked(false), 10_000));
                  }}
                >
                  <History className="size-4 text-[var(--whatsapp)]" aria-hidden />
                  {asked ? 'ביקשנו מהטלפון…' : 'הודעות וואטסאפ קודמות'}
                </Button>
              )}
            </h4>
            <ol className="timeline-rail flex flex-col">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.li
                    key={item.entry.id}
                    layout="position"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: EASE_OUT }}
                  >
                    {isMirroredChat(item.entry) ? (
                      <ChatEntry item={item} lead={lead} />
                    ) : (
                      <TimelineEntry item={item} lead={lead} uploads={uploads.filter((upload) => upload.interactionId === item.entry.id)} />
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
              <li className="relative flex items-center gap-3 py-1.5">
                <span className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--glass-strong)] ring-1 ring-line ring-inset" aria-hidden>
                  <span className="size-1.5 rounded-full bg-fg-faint" />
                </span>
                <span className="flex-1 text-[13.5px] text-fg-muted">
                  נוסף{lead.campaign ? <> בקמפיין <span dir="auto">{lead.campaign}</span></> : ''}
                  {items.length === 0 && <span className="text-fg-faint">. עדיין לא תועד כלום.</span>}
                </span>
                <time dateTime={lead.createdAt} title={fullDate.format(new Date(lead.createdAt))} className="text-[12px] text-fg-faint">
                  {formatRelative(lead.createdAt)}
                </time>
              </li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

function TimelineEntry({ item, lead, uploads }: { item: TimelineItem; lead: Lead; uploads: Upload[] }) {
  const { entry, title, media } = item;
  const editEntry = useTimeline((s) => s.editEntry);
  const removeEntry = useTimeline((s) => s.removeEntry);
  const removeMedia = useTimeline((s) => s.removeMedia);
  const retranscribe = useTimeline((s) => s.retranscribe);
  const upload = useTimeline((s) => s.upload);
  const transcripts = useTimeline((s) => s.features?.transcription);
  const undo = useLeadStore((s) => s.undo);
  const editEntryId = useUi((s) => s.editEntryId);
  const setEditEntryId = useUi((s) => s.setEditEntryId);
  // An edit left open when the page closed comes back open, with what was typed
  const [editing, setEditing] = useState(() => drafts.read(editDraftKey(entry.id)) !== null);
  const [expanded, setExpanded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const meta = entryMeta(entry);
  const { notes, transcripts: transcriptTexts } = splitTranscripts(entry.body);
  const long = notes.length > 420 || notes.split('\n').length > 7;
  const transcribing = media.filter(isTranscribing);
  const failed = media.filter((file) => file.transcription?.status === 'failed');
  const silent = media.filter((file) => file.transcription?.status === 'done' && file.transcription.words === 0);
  const canTranscribe = transcripts?.enabled === true;

  // Opened from a daily card's "Add notes": write about this entry right away.
  useEffect(() => {
    if (editEntryId !== entry.id) return;
    setEditing(true);
    setEditEntryId(null);
    requestAnimationFrame(() => row.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }, [editEntryId, entry.id, setEditEntryId]);

  return (
    <div ref={row} className="group relative flex gap-3 pb-5">
      <span
        style={toneStyle(meta.tone)}
        className="tone-chip relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--glass-strong)]"
      >
        <meta.icon className="size-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1 pt-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h5 className="text-[14px] font-medium">{title}</h5>
          <time dateTime={entry.at} title={fullDate.format(new Date(entry.at))} className="text-[12px] text-fg-faint">
            {formatRelative(entry.at)}
          </time>
          {transcribing.length > 0 && (
            <span style={toneStyle('var(--st-answered)')} className="tone-chip inline-flex h-6 items-center gap-1.5 self-center rounded-full px-2 text-[12px] font-medium">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              מתמלל…
            </span>
          )}
          <span className="ms-auto flex items-center gap-0.5 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
            {entry.step && canUndo(lead, entry.id) && (
              <button type="button" onClick={() => undo(lead.id, entry.id)} className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'h-8' })}>
                <Undo2 className="flip-rtl size-4" aria-hidden />
                ביטול
              </button>
            )}
            <IconAction
              label={transcribing.length ? 'אפשר יהיה לערוך כשהתמלול יגיע' : entry.body ? 'עריכת הסיכום' : 'הוספת סיכום'}
              onClick={() => setEditing(true)}
              icon={Pencil}
              disabled={transcribing.length > 0}
            />
            <IconAction label="צירוף הקלטה" onClick={() => fileInput.current?.click()} icon={Paperclip} />
            {!entry.step && <IconAction label="מחיקת הרשומה" onClick={() => removeEntry(lead.id, entry.id)} icon={Trash2} danger />}
            <input
              ref={fileInput}
              type="file"
              accept={RECORDING_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(lead.id, file, entry.id);
                event.target.value = '';
              }}
            />
          </span>
        </div>

        {editing ? (
          <EntryEditor
            entry={entry}
            required={!entry.step}
            onCancel={() => setEditing(false)}
            onSave={async (body, base) => {
              if (await editEntry(lead.id, entry.id, body, base)) setEditing(false);
            }}
          />
        ) : (
          <>
            {notes ? (
              <div className="mt-1">
                <p dir="auto" className={cn('text-[14px] leading-relaxed break-words whitespace-pre-wrap text-pretty', long && !expanded && 'line-clamp-6')}>
                  {notes}
                </p>
                {long && (
                  <button type="button" onClick={() => setExpanded((open) => !open)} className="mt-1 text-[12.5px] font-medium text-fg-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
                    {expanded ? 'הצגת פחות' : 'הצגת הכול'}
                  </button>
                )}
              </div>
            ) : entry.step && entry.outcome && entry.outcome !== 'no_answer' && entry.outcome !== 'no_show' && transcriptTexts.length === 0 && transcribing.length === 0 ? (
              <button type="button" onClick={() => setEditing(true)} className="mt-1 text-[13px] text-fg-faint underline decoration-line-strong decoration-dashed underline-offset-4 hover:text-fg">
                כתבו מה נאמר, כדי שהמאמן יוכל להיעזר בזה
              </button>
            ) : null}
            {transcriptTexts.map((text, index) => (
              <TranscriptBlock key={index} text={text} label={transcriptTexts.length > 1 ? `תמלול אוטומטי ${index + 1}` : 'תמלול אוטומטי'} />
            ))}
          </>
        )}

        {transcribing.length > 0 && <TranscribingState file={transcribing[0]} more={transcribing.length - 1} />}
        {failed.map((file) => (
          <div key={file.id} role="alert" className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl px-3.5 py-2.5 text-[13px] ring-1 ring-[color-mix(in_oklab,var(--danger)_35%,transparent)] ring-inset">
            <TriangleAlert className="size-4 shrink-0 text-danger" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                לא הצלחנו לתמלל את <span dir="auto">{file.fileName}</span>.
              </span>{' '}
              <span className="text-fg-muted">{file.transcription?.error}</span>
            </span>
            {canTranscribe && (
              <Button size="sm" variant="ghost" className="h-8" onClick={() => retranscribe(lead.id, file)}>
                <RotateCcw className="size-4" aria-hidden />
                לנסות שוב
              </Button>
            )}
          </div>
        ))}
        {silent.map((file) => (
          <p key={file.id} className="mt-2 text-[12.5px] text-fg-faint">
            לא נמצא דיבור בהקלטה <span dir="auto">{file.fileName}</span>.
          </p>
        ))}

        {(media.length > 0 || uploads.length > 0) && (
          <div className="mt-2.5 flex flex-col gap-2">
            {media.map((file) => (
              <MediaPlayer
                key={file.id}
                media={file}
                onRemove={() => removeMedia(lead.id, file)}
                onTranscribe={canTranscribe && !file.transcription ? () => retranscribe(lead.id, file) : undefined}
              />
            ))}
            {uploads.map((item) => (
              <UploadRow key={item.id} upload={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A transcript added to an entry: set apart from the notes, folded when long */
function TranscriptBlock({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 600 || text.split('\n').length > 8;
  const words = text.split(/\s+/).filter(Boolean).length;
  return (
    <div
      style={toneStyle('var(--st-answered)')}
      className="mt-2.5 rounded-xl bg-[color-mix(in_oklab,var(--st-answered)_6%,transparent)] px-3.5 py-2.5 ring-1 ring-[color-mix(in_oklab,var(--st-answered)_22%,transparent)] ring-inset"
    >
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--st-answered)]">
        <AudioLines className="size-3.5" aria-hidden />
        {label}
        <span className="font-normal text-fg-faint">· {formatNumber(words)} מילים</span>
      </p>
      <p dir="auto" className={cn('mt-1.5 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-pretty', long && !open && 'line-clamp-5')}>
        {text}
      </p>
      {long && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="mt-1.5 text-[12.5px] font-medium text-fg-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
          {open ? 'הצגת פחות' : 'לקריאת התמלול המלא'}
        </button>
      )}
    </div>
  );
}

/** Where a transcript stands while the server works on it */
function TranscribingState({ file, more }: { file: MediaFile; more: number }) {
  const job = file.transcription;
  const fraction = job && job.partsTotal > 0 ? job.partsDone / job.partsTotal : null;
  return (
    <div aria-live="polite" className="mt-2.5 rounded-xl px-3.5 py-3 ring-1 ring-line ring-inset">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
        <span className="min-w-0 truncate font-medium" dir="auto">
          {file.fileName}
          {more > 0 && ` ועוד ${more}`}
        </span>
        <span className="text-fg-faint">{transcriptionProgress(file)}</span>
      </p>
      <div className="mt-2.5 flex flex-col gap-2" aria-hidden>
        {['94%', '81%', '62%'].map((width) => (
          <span key={width} className="shimmer block h-2.5 rounded-full" style={{ width }} />
        ))}
      </div>
      {fraction !== null && (
        <div
          className="mt-3 h-1 overflow-hidden rounded-full bg-line-strong"
          role="progressbar"
          aria-label={`מתמלל את ${file.fileName}`}
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-[var(--st-answered)] transition-[width] duration-500" style={{ width: `${Math.max(4, fraction * 100)}%` }} />
        </div>
      )}
      <p className="mt-2 text-[12px] text-fg-faint">התמלול יופיע כאן כשיהיה מוכן. אפשר לסגור ולהמשיך לעבוד.</p>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  icon: Icon,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon: typeof Pencil;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'flex size-8 items-center justify-center rounded-lg text-fg-faint hover:bg-field-hover disabled:pointer-events-none disabled:opacity-40',
        danger ? 'hover:text-danger' : 'hover:text-fg',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

interface EntryEditorProps {
  entry: Interaction;
  required: boolean;
  /** Gets the text and the entry as it was when editing began, so a transcript that lands meanwhile is kept */
  onSave: (body: string, base: Pick<Interaction, 'body' | 'updatedAt'>) => Promise<void>;
  onCancel: () => void;
}

const editDraftKey = (entryId: string) => `entry-edit:${entryId}`;
interface EditDraft {
  text: string;
  base: Pick<Interaction, 'body' | 'updatedAt'>;
}

function EntryEditor({ entry, required, onSave, onCancel }: EntryEditorProps) {
  // What was typed is kept on this device until it's saved or cancelled, with the entry as it was when editing began
  const [kept] = useState(() => drafts.read<EditDraft>(editDraftKey(entry.id)));
  const [base] = useState(() => kept?.base ?? { body: entry.body, updatedAt: entry.updatedAt });
  const [text, setTextState] = useState(kept?.text ?? entry.body);
  const setText = (value: string) => {
    setTextState(value);
    if (value.trim() === base.body.trim()) drafts.clear(editDraftKey(entry.id));
    else drafts.write<EditDraft>(editDraftKey(entry.id), { text: value, base });
  };
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  const canSave = !saving && text.trim() !== base.body.trim() && (!required || text.trim().length > 0);
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    await onSave(text, base);
    drafts.clear(editDraftKey(entry.id));
    setSaving(false);
  };
  const cancel = () => {
    drafts.clear(editDraftKey(entry.id));
    onCancel();
  };

  return (
    <div className="mt-2 rounded-xl bg-field p-1.5 ring-1 ring-line ring-inset focus-within:ring-2 focus-within:ring-focus">
      <textarea
        ref={area}
        dir="auto"
        rows={Math.min(14, Math.max(3, text.split('\n').length + 1))}
        value={text}
        aria-label="סיכום"
        placeholder="מה נאמר: צרכים, התנגדויות, הצעדים הבאים"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void save();
        }}
        className="block max-h-[50vh] w-full resize-y bg-transparent px-2 py-1.5 text-base leading-relaxed outline-none placeholder:text-fg-faint focus-visible:outline-none sm:text-[14px]"
      />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={cancel}>
          ביטול
        </Button>
        <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'שומר…' : 'שמירה'}
        </Button>
      </div>
    </div>
  );
}

function UploadRow({ upload }: { upload: Upload }) {
  const cancelUpload = useTimeline((s) => s.cancelUpload);
  const dismissUpload = useTimeline((s) => s.dismissUpload);
  const percent = upload.progress === null ? 0 : Math.round(upload.progress * 100);

  return (
    <div className="rounded-2xl bg-field px-3 py-2.5 ring-1 ring-line ring-inset" aria-live="polite">
      <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <Paperclip className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        <span dir="auto" className="min-w-0 truncate">{upload.fileName}</span>
        <span className={cn('shrink-0 tabular-nums', upload.error ? 'text-danger' : 'text-fg-faint')}>
          {upload.error ? 'ההעלאה נכשלה' : upload.progress === null ? 'ממתין לשמירת הרשומה' : `${percent}%`}
        </span>
        <button
          type="button"
          onClick={() => (upload.error ? dismissUpload(upload.id) : cancelUpload(upload.id))}
          aria-label={upload.error ? 'סגירה' : `ביטול ההעלאה של ${upload.fileName}`}
          className="ms-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-faint hover:bg-field-hover hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {upload.error ? (
        <p className="mt-1 text-[12.5px] text-danger">{upload.error}</p>
      ) : (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-strong" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`מעלה את ${upload.fileName}`}>
          <div className="h-full rounded-full bg-[var(--st-answered)] transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="טוען את ציר הזמן" className="flex flex-col gap-5">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3">
          <span className="shimmer size-9 shrink-0 rounded-full" />
          <div className="flex-1 pt-1.5">
            <span className="shimmer block h-3.5 w-2/5 rounded-full" />
            <span className="shimmer mt-2.5 block h-3 w-4/5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
