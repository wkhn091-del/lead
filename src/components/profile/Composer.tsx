import {
  Archive,
  AudioLines,
  Handshake,
  Mail,
  MessageCircle,
  NotebookPen,
  Paperclip,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  Video,
  VideoOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { handleRadioKeys, modKeyLabel } from '../../lib/a11y';
import { cn } from '../../lib/cn';
import { drafts as keptDrafts } from '../../lib/drafts';
import { formatBytes, RECORDING_ACCEPT, recordingProblem } from '../../lib/media';
import { STAGE_META, toneStyle } from '../../lib/stages';
import { isOpen } from '../../lib/workflow';
import { useLeadStore } from '../../store/leads';
import { useTimeline } from '../../store/timeline';
import { toast } from '../../store/toasts';
import { useUi } from '../../store/ui';
import type { ActionType, Lead, MessageKind, Stage } from '../../types';
import { Button } from '../ui/Button';

type Kind = 'call' | 'zoom' | MessageKind;

interface KindOption {
  label: string;
  icon: LucideIcon;
  tone: string;
  placeholder: string;
  submit: string;
}

const KINDS: Record<Kind, KindOption> = {
  call: {
    label: 'שיחה',
    icon: Phone,
    tone: 'var(--st-cold)',
    placeholder: 'מה נאמר? מה הם צריכים, על מה הייתה התנגדות, מה הצעד הבא. אם יש תמלול, אפשר להדביק אותו כאן.',
    submit: 'תיעוד השיחה',
  },
  zoom: {
    label: 'זום',
    icon: Video,
    tone: 'var(--st-zoom)',
    placeholder: 'איך הייתה הפגישה? מה שאלו, על מה התנגדו ועל מה הסכימו.',
    submit: 'תיעוד הפגישה',
  },
  whatsapp: { label: 'וואטסאפ', icon: MessageCircle, tone: 'var(--whatsapp)', placeholder: 'מה שלחת, או מה ענו', submit: 'תיעוד ההודעה' },
  email: { label: 'אימייל', icon: Mail, tone: 'var(--st-cold)', placeholder: 'מה היה כתוב באימייל', submit: 'תיעוד האימייל' },
  note: { label: 'הערה', icon: NotebookPen, tone: 'var(--fg-muted)', placeholder: 'כל מה ששווה לזכור על הליד הזה', submit: 'שמירת ההערה' },
};

interface Outcome {
  type: ActionType;
  label: string;
  icon: LucideIcon;
  tone: string;
}

/** The possible results of a call or meeting, at the lead's stage */
function outcomesFor(kind: 'call' | 'zoom', stage: Stage): Outcome[] {
  const closes = stage === 'zoom';
  const advance: Outcome = closes
    ? { type: 'advance', label: 'העסקה נסגרה', icon: Handshake, tone: 'var(--st-won)' }
    : { type: 'advance', label: 'נקבע זום', icon: Video, tone: 'var(--st-zoom)' };
  const archive: Outcome = { type: 'archive', label: 'לא רלוונטי', icon: Archive, tone: 'var(--st-lost)' };
  if (kind === 'zoom') {
    return [
      { type: 'answered', label: 'התקיימה, בלי החלטה', icon: Video, tone: 'var(--st-zoom)' },
      advance,
      { type: 'no_answer', label: 'לא הגיע', icon: VideoOff, tone: 'var(--st-no-answer)' },
      archive,
    ];
  }
  return [
    { type: 'answered', label: closes ? 'דיברנו' : 'ענה', icon: PhoneIncoming, tone: 'var(--st-answered)' },
    advance,
    { type: 'no_answer', label: 'אין מענה', icon: PhoneMissed, tone: 'var(--st-no-answer)' },
    archive,
  ];
}

interface Draft {
  /** Null follows the lead's stage */
  kind: Kind | null;
  outcome: ActionType | null;
  body: string;
  file: File | null;
}

/**
 * Unsent drafts, by lead, so closing the profile by accident loses nothing. The words (and the kind and outcome
 * picked) are also kept on this device, so a page that reloads (a phone call sent the browser to the background)
 * loses nothing either. An attached recording stays in memory only.
 */
const drafts = new Map<string, Draft>();
type KeptDraft = Pick<Draft, 'kind' | 'outcome' | 'body'>;
const keptKey = (leadId: string) => `composer:${leadId}`;
const emptyDraft = (): Draft => ({ kind: null, outcome: null, body: '', file: null });

const defaultKind = (lead: Lead): Kind => (!isOpen(lead) ? 'note' : lead.stage === 'zoom' ? 'zoom' : 'call');

/** Logs a call or meeting with its outcome, or a note or message, with an optional recording. */
export function Composer({ lead }: { lead: Lead }) {
  const act = useLeadStore((s) => s.act);
  const undo = useLeadStore((s) => s.undo);
  const addMessage = useTimeline((s) => s.addMessage);
  const upload = useTimeline((s) => s.upload);
  const maxMb = useTimeline((s) => s.features?.media.maxUploadMb ?? 500);
  const transcripts = useTimeline((s) => s.features?.transcription);
  const setProfileTab = useUi((s) => s.setProfileTab);
  const [draft, setDraft] = useState<Draft>(
    () => drafts.get(lead.id) ?? { ...emptyDraft(), ...(keptDrafts.read<KeptDraft>(keptKey(lead.id)) ?? {}), file: null },
  );
  const [dragging, setDragging] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const open = isOpen(lead);
  const kinds: Kind[] = [...(open ? (['call'] as Kind[]) : []), ...(open && lead.stage === 'zoom' ? (['zoom'] as Kind[]) : []), 'whatsapp', 'email', 'note'];
  const kind = draft.kind && kinds.includes(draft.kind) ? draft.kind : defaultKind(lead);
  const isStep = kind === 'call' || kind === 'zoom';
  const outcomes = isStep ? outcomesFor(kind, lead.stage) : [];
  const outcome = outcomes.find((option) => option.type === draft.outcome) ?? null;
  const text = draft.body.trim();
  const ready = isStep ? Boolean(outcome) : Boolean(text || draft.file);
  const meta = KINDS[kind];
  const inputId = `composer-${lead.id}`;

  useEffect(() => {
    drafts.set(lead.id, draft);
    const { kind: pickedKind, outcome: pickedOutcome, body } = draft;
    if (body.trim() || pickedOutcome) keptDrafts.write<KeptDraft>(keptKey(lead.id), { kind: pickedKind, outcome: pickedOutcome, body });
    else keptDrafts.clear(keptKey(lead.id));
  }, [lead.id, draft]);

  // Grow with what's typed, up to half the screen.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [draft.body]);

  const update = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  const attach = (file: File | undefined) => {
    if (!file) return;
    const problem = recordingProblem(file, maxMb);
    if (problem) toast.error('אי אפשר לצרף את הקובץ הזה.', problem);
    else update({ file });
  };

  const clear = () => {
    drafts.delete(lead.id);
    keptDrafts.clear(keptKey(lead.id));
    setDraft(emptyDraft());
  };

  const submit = () => {
    if (!ready) return;
    if (isStep && outcome) {
      const result = act(lead.id, outcome.type, { body: text, channel: kind });
      if (!result) return;
      if (draft.file) upload(lead.id, draft.file, result.id, result.saved);
      const closing = outcome.type === 'advance' && lead.stage === 'zoom';
      const message = {
        advance: closing ? 'העסקה נסגרה' : `עבר לשלב ${STAGE_META.zoom.label}`,
        answered: kind === 'zoom' ? 'הפגישה תועדה' : 'השיחה תועדה',
        no_answer: kind === 'zoom' ? 'תועד: הליד לא הגיע' : 'תועד: אין מענה',
        archive: 'סומן כלא רלוונטי',
      }[outcome.type];
      toast.show({
        message,
        description: closing ? 'רשמו את סכומי העסקה בלשונית "פרטים" כדי שייכנסו להכנסות.' : undefined,
        duration: 8000,
        action: { label: 'ביטול', onClick: () => undo(lead.id, result.id) },
      });
      if (closing) setProfileTab('details');
    } else if (text) {
      const result = addMessage(lead, kind as MessageKind, text);
      if (result && draft.file) upload(lead.id, draft.file, result.id, result.saved);
    } else if (draft.file) {
      // Just a recording: it goes on the lead itself.
      upload(lead.id, draft.file, null);
    }
    clear();
  };

  return (
    <div
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        attach(event.dataTransfer.files[0]);
      }}
      className={cn(
        'rounded-2xl bg-field p-1.5 ring-1 ring-line ring-inset transition-shadow focus-within:ring-2 focus-within:ring-focus',
        dragging && 'ring-2 ring-focus',
      )}
    >
      <div
        role="radiogroup"
        aria-label="מה לתעד"
        onKeyDown={(event) => handleRadioKeys(event, kinds, kind, (next) => update({ kind: next, outcome: null }))}
        className="flex flex-wrap gap-1 p-0.5"
      >
        {kinds.map((option) => {
          const item = KINDS[option];
          const active = option === kind;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              data-value={option}
              onClick={() => update({ kind: option, outcome: null })}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors',
                active ? 'bg-raised text-fg shadow-[0_1px_2px_var(--shadow-soft)] ring-1 ring-line' : 'text-fg-muted hover:text-fg',
              )}
            >
              <item.icon className="size-4" style={{ color: active ? item.tone : undefined }} aria-hidden />
              {item.label}
            </button>
          );
        })}
      </div>

      <label htmlFor={inputId} className="sr-only">
        {isStep ? 'סיכום' : `תוכן: ${meta.label}`}
      </label>
      <textarea
        ref={textarea}
        id={inputId}
        dir="auto"
        rows={3}
        value={draft.body}
        placeholder={meta.placeholder}
        onChange={(event) => update({ body: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        className="mt-1 block max-h-[50vh] min-h-[84px] w-full resize-none bg-transparent px-2.5 py-2 text-base leading-relaxed outline-none placeholder:text-fg-faint focus-visible:outline-none sm:text-[14.5px]"
      />

      {isStep && (
        <div
          role="radiogroup"
          aria-label={kind === 'zoom' ? 'איך הייתה הפגישה' : 'איך הייתה השיחה'}
          onKeyDown={(event) =>
            handleRadioKeys(
              event,
              outcomes.map((option) => option.type),
              draft.outcome ?? outcomes[0].type,
              (next) => update({ outcome: next }),
            )
          }
          className="grid grid-cols-2 gap-1.5 px-1 pb-1 sm:grid-cols-4"
        >
          {outcomes.map((option, index) => {
            const active = option.type === draft.outcome;
            return (
              <button
                key={option.type}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active || (!draft.outcome && index === 0) ? 0 : -1}
                data-value={option.type}
                onClick={() => update({ outcome: active ? null : option.type })}
                style={toneStyle(option.tone)}
                className={cn(
                  'flex h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-[13px] font-medium transition-[background-color,box-shadow,color]',
                  active ? 'tone-chip' : 'text-fg-muted ring-1 ring-line ring-inset hover:bg-field-hover hover:text-fg',
                )}
              >
                <option.icon className="size-4 shrink-0" style={{ color: active ? undefined : option.tone }} aria-hidden />
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-1 pt-1 pb-0.5">
        <input
          ref={fileInput}
          type="file"
          accept={RECORDING_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            attach(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {draft.file ? (
          <span className="inline-flex h-9 max-w-full min-w-0 items-center gap-2 rounded-[10px] bg-raised ps-2.5 pe-1 text-[13px] ring-1 ring-line">
            <Paperclip className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span dir="auto" className="min-w-0 truncate">{draft.file.name}</span>
            <span className="shrink-0 text-fg-faint tabular-nums">{formatBytes(draft.file.size)}</span>
            <button
              type="button"
              onClick={() => update({ file: null })}
              aria-label={`הסרת ${draft.file.name}`}
              className="flex size-7 items-center justify-center rounded-lg text-fg-faint hover:bg-field-hover hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
            <Paperclip className="size-4" aria-hidden />
            צירוף הקלטה
          </Button>
        )}
        <span className="ms-auto flex items-center gap-3">
          <span className="ltr text-[12px] text-fg-faint max-sm:hidden">{modKeyLabel} + Enter</span>
          <Button size="sm" variant="primary" disabled={!ready} onClick={submit}>
            {!isStep && !text && draft.file ? 'העלאת ההקלטה' : meta.submit}
          </Button>
        </span>
      </div>
      {draft.file && transcripts && (
        <p className="flex items-start gap-1.5 px-2.5 pt-1 pb-1.5 text-[12px] text-fg-faint">
          <AudioLines className="mt-px size-3.5 shrink-0" aria-hidden />
          {transcripts.enabled
            ? `${transcripts.service} יתמלל אותה אחרי ההעלאה, והתמלול יתווסף ${isStep || text ? 'לרשומה הזו' : 'כהערה'} בשביל המאמן.`
            : `ההקלטה לא תתומלל. ${transcripts.reason}`}
        </p>
      )}
    </div>
  );
}
