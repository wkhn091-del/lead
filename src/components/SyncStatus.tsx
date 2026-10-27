import {
  Cloud,
  CloudAlert,
  CloudOff,
  CloudUpload,
  Copy,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { repository } from '../data/repository';
import { cn } from '../lib/cn';
import { formatRelative } from '../lib/format';
import { count, NOUNS } from '../lib/hebrew';
import { leadOf, writtenText, type OutboxOp } from '../lib/outbox';
import { useAuth } from '../store/auth';
import { useLeadStore } from '../store/leads';
import { useOffline } from '../store/offline';
import { copyWritten, useSync } from '../store/sync';
import { useTimeline } from '../store/timeline';
import type { Lead } from '../types';
import { Button } from './ui/Button';
import { DialogBody, DialogFooter, DialogHeading, ResponsiveDialog } from './ui/ResponsiveDialog';

type Phase = 'local' | 'saved' | 'sending' | 'waiting' | 'offline' | 'asleep' | 'held';

interface PhaseMeta {
  icon: LucideIcon;
  label: string;
  tone?: string;
}

const PHASES: Record<Phase, PhaseMeta> = {
  local: { icon: HardDrive, label: 'נשמר במכשיר הזה' },
  saved: { icon: Cloud, label: 'כל השינויים נשמרו בשרת' },
  sending: { icon: LoaderCircle, label: 'שולח לשרת…' },
  waiting: { icon: CloudUpload, label: 'שינויים מחכים לשליחה', tone: 'var(--st-no-answer)' },
  offline: { icon: CloudOff, label: 'אין חיבור לשרת. מה שכותבים נשמר, ויישלח כשהחיבור יחזור.', tone: 'var(--st-no-answer)' },
  asleep: { icon: CloudOff, label: 'השרת לא עונה כרגע. מה שכותבים נשמר, ויישלח כשהוא יענה.', tone: 'var(--st-no-answer)' },
  held: { icon: CloudAlert, label: 'צריך להיכנס שוב כדי לסנכרן עם השרת', tone: 'var(--danger)' },
};

/** Where things stand: saved, sending, or waiting for the connection, at a glance in the header */
function usePhase(): { phase: Phase; waiting: number; dropped: number } {
  const local = repository.kind === 'local';
  const waiting = useSync((s) => s.items.length);
  const dropped = useSync((s) => s.dropped.length);
  const sending = useSync((s) => Boolean(s.sending));
  const offline = useSync((s) => s.offline);
  const held = useSync((s) => s.held);
  const keptCopy = useAuth((s) => s.offline);
  const expired = useAuth((s) => s.expired);
  const importing = useLeadStore((s) => s.pending > 0);
  const uploading = useTimeline((s) => s.pending > 0);
  // Quick saves finish in a moment; "sending" shows only when one takes a while
  const busy = sending || importing || uploading;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), 300);
    return () => clearTimeout(timer);
  }, [busy]);

  const phase: Phase = local
    ? 'local'
    : (held && waiting) || expired
      ? 'held'
      : offline || keptCopy
        ? // The phone has a connection, so it's the server that isn't answering (Render waking up, say)
          typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'offline'
          : 'asleep'
        : slow
          ? 'sending'
          : waiting
            ? 'waiting'
            : 'saved';
  return { phase, waiting, dropped };
}

/** The header's save indicator; with a server it opens what's waiting to be sent */
export function SyncStatus() {
  const { phase, waiting, dropped } = usePhase();
  const [open, setOpen] = useState(false);
  const meta = PHASES[phase];
  const label = waiting && phase !== 'local' ? `${meta.label} · ${waiting === 1 ? 'שינוי אחד ממתין' : `${count(waiting, NOUNS.change)} ממתינים`}` : meta.label;

  if (phase === 'local') {
    return (
      <span role="status" title={label} className="flex h-10 items-center gap-2 px-2.5 text-[13px] text-fg-muted">
        <meta.icon className="size-4 shrink-0" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className="relative"
        style={meta.tone ? { color: meta.tone } : undefined}
      >
        <meta.icon className={cn('size-[18px]', phase === 'sending' && 'animate-spin')} aria-hidden />
        {waiting > 0 && phase !== 'sending' && (
          <span className="absolute -top-0.5 end-0 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--st-no-answer)] px-1 text-[10.5px] leading-none font-semibold text-[var(--canvas)] tabular-nums ring-2 ring-[var(--canvas)]">
            {waiting > 99 ? '99+' : waiting}
          </span>
        )}
        {waiting === 0 && dropped > 0 && <span className="absolute top-1.5 end-1.5 size-2 rounded-full bg-danger ring-2 ring-[var(--canvas)]" />}
        <span role="status" className="sr-only">
          {label}
        </span>
      </Button>
      <SyncPanel open={open} onOpenChange={setOpen} phase={phase} />
    </>
  );
}

const STEP_LABEL = (op: Extract<OutboxOp, { kind: 'act' }>): string => {
  const meeting = op.action.from === 'zoom';
  switch (op.action.type) {
    case 'advance':
      return meeting ? 'העסקה נסגרה' : 'נקבע זום';
    case 'no_answer':
      return meeting ? 'לא הגיע לזום' : 'אין מענה';
    case 'answered':
      return meeting ? 'פגישה התקיימה' : 'שיחה';
    case 'archive':
      return 'סומן כלא רלוונטי';
  }
};

/** What a change is, in a few words */
export function describeChange(op: OutboxOp, leads: readonly Lead[]): string {
  const leadId = leadOf(op);
  const name = leadId ? leads.find((lead) => lead.id === leadId)?.name : undefined;
  const about = (what: string) => (name ? `${what} · ${name}` : what);
  switch (op.kind) {
    case 'create-lead':
      return `ליד חדש · ${op.lead.name}`;
    case 'update-lead':
      return about(op.patch.deal ? 'סכומי העסקה' : 'שינוי בפרטים');
    case 'act':
      return about(STEP_LABEL(op));
    case 'undo':
      return about('ביטול צעד');
    case 'remove-lead':
      return 'מחיקת ליד';
    case 'remove-leads':
      return `מחיקת ${count(op.leadIds.length, NOUNS.lead)}`;
    case 'add-entry':
      return about(op.entry.kind === 'whatsapp' ? 'הודעת וואטסאפ' : op.entry.kind === 'email' ? 'אימייל' : 'הערה');
    case 'edit-entry':
      return about('עריכת רשומה');
    case 'remove-entry':
      return about('מחיקת רשומה');
    case 'card-review':
      return 'דירוג בתרגול';
    case 'card-response':
      return 'התשובה שלך בתרגול';
  }
}

function SyncPanel({ open, onOpenChange, phase }: { open: boolean; onOpenChange: (open: boolean) => void; phase: Phase }) {
  const items = useSync((s) => s.items);
  const dropped = useSync((s) => s.dropped);
  const sending = useSync((s) => s.sending);
  const retryAt = useSync((s) => s.retryAt);
  const flush = useSync((s) => s.flush);
  const dismissDropped = useSync((s) => s.dismissDropped);
  const leads = useLeadStore((s) => s.leads);
  const keptAt = useOffline((s) => s.keptAt);
  const now = useNow(open);

  const waitSeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : null;
  const summary =
    phase === 'held'
      ? `החיבור לחשבון הסתיים. ${items.length === 1 ? 'השינוי שמור' : `${count(items.length, NOUNS.change)} שמורים`} במכשיר הזה, ויישלחו מיד אחרי שתיכנסו שוב.`
      : items.length === 0
        ? phase === 'offline' || phase === 'asleep'
          ? `${phase === 'offline' ? 'אין חיבור לאינטרנט כרגע.' : 'השרת לא עונה כרגע.'} מה שתכתבו יישמר במכשיר הזה, ויישלח לבד כשאפשר.`
          : 'כל מה שכתבת נשמר בשרת.'
        : phase === 'offline' || phase === 'asleep'
          ? `${phase === 'offline' ? 'אין חיבור לאינטרנט כרגע.' : 'השרת לא עונה כרגע.'} ${items.length === 1 ? 'השינוי שמור' : `${count(items.length, NOUNS.change)} שמורים`} במכשיר הזה, ויישלחו לבד ${phase === 'offline' ? 'כשהחיבור יחזור' : 'כשהשרת יענה'}${waitSeconds ? ` (ניסיון הבא בעוד ${count(waitSeconds, NOUNS.second)})` : ''}.`
          : `${items.length === 1 ? 'שינוי אחד בדרך' : `${count(items.length, NOUNS.change)} בדרך`} לשרת.`;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="sm:w-[520px]">
      <DialogHeading title="השינויים שלך" description={summary} />
      <DialogBody className="flex flex-col gap-6">
        {keptAt && (
          <p className="rounded-xl bg-field px-3.5 py-2.5 text-[13px] text-pretty text-fg-muted ring-1 ring-line ring-inset">
            מוצג המידע ששמור במכשיר הזה (עודכן {formatRelative(new Date(keptAt).toISOString(), now)}). כשהשרת יענה, הוא יתעדכן לבד.
          </p>
        )}
        {items.length > 0 && (
          <section aria-label="ממתינים לשליחה">
            <h3 className="mb-2 text-[13px] font-medium text-fg-muted">ממתינים לשליחה</h3>
            <ul className="divide-y divide-line">
              {items.slice(0, 30).map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">
                      <bdi>{describeChange(item.op, leads)}</bdi>
                    </p>
                    {item.error && item.attempts > 0 && <p className="mt-0.5 text-[12.5px] text-pretty text-fg-faint">{item.error}</p>}
                  </div>
                  <span className="shrink-0 text-[12.5px] text-fg-faint">
                    {item.id === sending ? 'נשלח…' : formatRelative(item.createdAt.split('#')[0], now)}
                  </span>
                </li>
              ))}
            </ul>
            {items.length > 30 && <p className="mt-2 text-[12.5px] text-fg-faint">ועוד {count(items.length - 30, NOUNS.change)}.</p>}
          </section>
        )}
        {dropped.length > 0 && (
          <section aria-label="לא נשמרו">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-[13px] font-medium text-danger">השרת לא קיבל את אלה</h3>
              <button type="button" onClick={() => dismissDropped()} className="text-[12.5px] text-fg-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
                ניקוי הרשימה
              </button>
            </div>
            <ul className="divide-y divide-line">
              {dropped.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">
                      <bdi>{describeChange(item.op, leads)}</bdi>
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-pretty text-fg-muted">{item.reason}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {writtenText(item.op) && (
                      <Button size="sm" variant="ghost" onClick={() => copyWritten(item.op)} aria-label="העתקת מה שנכתב" title="העתקת מה שנכתב">
                        <Copy className="size-4" aria-hidden />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => dismissDropped(item.id)} aria-label="הסרה מהרשימה" title="הסרה מהרשימה">
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {items.length === 0 && dropped.length === 0 && !keptAt && (
          <p className="text-[13.5px] text-pretty text-fg-muted">
            כל שינוי נשמר קודם במכשיר הזה ורק אחר כך נשלח לשרת, כך שגם בלי קליטה, או כשהשרת מתעורר, שום דבר ממה שכותבים לא הולך לאיבוד.
          </p>
        )}
      </DialogBody>
      {phase === 'held' ? (
        <DialogFooter>
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
              useAuth.getState().setPrompt(true);
            }}
            className="max-sm:flex-1"
          >
            כניסה
          </Button>
        </DialogFooter>
      ) : (
        items.length > 0 && (
          <DialogFooter>
            <Button variant="primary" onClick={() => void flush()} disabled={Boolean(sending)} className="max-sm:flex-1">
              <RefreshCw className={cn('size-4', sending && 'animate-spin')} aria-hidden />
              {sending ? 'שולח…' : 'לשלוח עכשיו'}
            </Button>
          </DialogFooter>
        )
      )}
    </ResponsiveDialog>
  );
}

/** The time, ticking every few seconds while the panel is open */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
