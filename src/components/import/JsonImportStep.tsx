import * as Dialog from '@radix-ui/react-dialog';
import { CircleAlert, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { appConfig } from '../../config';
import type { JsonSkip, JsonSkipReason } from '../../data/repository/types';
import { cn } from '../../lib/cn';
import { count, NOUNS } from '../../lib/hebrew';
import { JSON_EXAMPLE, parseJsonLeads, unreadFields } from '../../lib/import/json';
import { toneStyle } from '../../lib/stages';
import { useLeadStore, type JsonImportOutcome } from '../../store/leads';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Button } from '../ui/Button';
import { DialogBody, DialogFooter, DialogHeading } from '../ui/ResponsiveDialog';
import { inputBase } from '../ui/styles';
import { announceImport } from './announce';

type Phase =
  | { kind: 'editing' }
  | { kind: 'saving'; done: number; total: number }
  /** The connection dropped or the server failed partway: what was saved stays, the rest can be sent again */
  | { kind: 'stopped'; outcome: JsonImportOutcome; items: unknown[] }
  /** Done, with leads skipped or fields not read: shown before closing */
  | { kind: 'report'; outcome: JsonImportOutcome };

const PLACEHOLDER = `[
  {
    "name": "יוסי שיפוצים",
    "phone": "054-1234567",
    "source": "קמפיין פייסבוק",
    "niche": "קבלני שיפוצים",
    "notes": "ביקש לחזור אליו אחרי החגים"
  }
]`;

/** Skipped items listed in the report; the counts above it include the rest */
const REPORT_LIMIT = 200;

const REASONS: Record<JsonSkipReason, { chip: string; tone: string; summary: (n: number) => string }> = {
  exists: { chip: 'כבר ב-CRM', tone: 'var(--st-no-answer)', summary: (n) => (n === 1 ? 'ליד אחד כבר שמור ב-CRM' : `${n} כבר שמורים ב-CRM`) },
  repeated: { chip: 'כפול ברשימה', tone: 'var(--st-no-answer)', summary: (n) => (n === 1 ? 'מספר אחד חוזר ברשימה' : `${n} מספרים חוזרים ברשימה`) },
  'no-phone': { chip: 'בלי טלפון', tone: 'var(--danger)', summary: (n) => (n === 1 ? 'ליד אחד בלי טלפון תקין' : `${n} בלי טלפון תקין`) },
  invalid: { chip: 'לא תקין', tone: 'var(--danger)', summary: (n) => (n === 1 ? 'פריט אחד לא תקין' : `${n} פריטים לא תקינים`) },
};
const REASON_ORDER: JsonSkipReason[] = ['exists', 'repeated', 'no-phone', 'invalid'];

/** Field names inside a Hebrew sentence, kept left to right as one run */
const fieldList = (fields: readonly string[]) => `⁦${fields.join(', ')}⁩`;
const READ_FIELDS = `נקראים רק השדות ${fieldList(['name', 'phone', 'niche', 'source', 'notes'])}.`;

interface JsonImportStepProps {
  text: string;
  onChange: (text: string) => void;
  /** Switches between pasting a table and pasting JSON */
  switcher: ReactNode;
  onLockChange: (locked: boolean) => void;
  /** Closes the dialog; `imported` once the paste was imported, so its draft goes */
  onClose: (imported: boolean) => void;
}

/**
 * Leads pasted as a JSON array, sent to the server as they are: it keeps only phone numbers no lead has yet
 * (server/src/leads/json-import.ts), and the report says what was skipped and why.
 */
export function JsonImportStep({ text, onChange, switcher, onLockChange, onClose }: JsonImportStepProps) {
  const deferred = useDeferredValue(text);
  const pasted = useMemo(() => parseJsonLeads(deferred), [deferred]);
  const unread = useMemo(() => (pasted.kind === 'ok' ? unreadFields(pasted.items) : []), [pasted]);
  const importJson = useLeadStore((s) => s.importJson);
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });

  const ready = pasted.kind === 'ok' && phase.kind === 'editing';
  const busy = phase.kind === 'saving';

  function finish(outcome: JsonImportOutcome) {
    onClose(true);
    announceImport(outcome.created);
  }

  async function send(items: unknown[], from?: JsonImportOutcome) {
    onLockChange(true);
    setPhase({ kind: 'saving', done: from?.done ?? 0, total: items.length });
    const outcome = await importJson(items, { from, onProgress: (done) => setPhase({ kind: 'saving', done, total: items.length }) });
    onLockChange(false);
    if (outcome.error) setPhase({ kind: 'stopped', outcome, items });
    else if (outcome.skipped.length || outcome.ignoredFields.length) setPhase({ kind: 'report', outcome });
    else finish(outcome);
  }

  const start = () => {
    if (pasted.kind === 'ok' && phase.kind === 'editing') void send(pasted.items);
  };

  if (phase.kind === 'report') {
    const { outcome } = phase;
    const again = () => {
      // The leads just added still get their Undo
      announceImport(outcome.created);
      onChange('');
      setPhase({ kind: 'editing' });
    };
    return <Report outcome={outcome} onAgain={again} onDone={() => finish(outcome)} />;
  }

  const total = pasted.kind === 'ok' ? pasted.items.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeading
        title="ייבוא לידים"
        description="מדביקים מערך JSON של לידים. ליד נשמר רק אם מספר הטלפון שלו חדש: מספר שכבר יש ב-CRM, או שחוזר ברשימה, מדולג."
        closable={!busy}
      />
      <DialogBody className="flex flex-col gap-3">
        {switcher}
        <label htmlFor="import-text" className="sr-only">
          מערך JSON של לידים
        </label>
        <textarea
          id="import-text"
          autoFocus
          value={text}
          readOnly={phase.kind !== 'editing'}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              start();
            }
          }}
          wrap="off"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          dir="ltr"
          placeholder={PLACEHOLDER}
          className={cn(
            inputBase,
            // The app's own fonts: a monospaced one spreads Hebrew letters apart
            'min-h-[36dvh] flex-1 resize-none px-4 py-3.5 text-left text-base leading-[1.75] whitespace-pre [tab-size:2] sm:min-h-[320px] sm:text-[14px]',
          )}
        />
        <div className="flex min-h-9 flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div role="status" className="min-w-0 flex-1 basis-60 text-[13.5px] text-pretty">
            {pasted.kind === 'ok' ? (
              <>
                <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px]">
                  <Sparkles className="size-4 text-focus" aria-hidden />
                  <span className="font-semibold">
                    {total === 1 ? (
                      'נמצא ליד אחד'
                    ) : (
                      <>
                        נמצאו <AnimatedNumber value={total} className="tabular-nums" />
                        <span className="sr-only">{total}</span> לידים
                      </>
                    )}
                  </span>
                  {pasted.fixed && <span className="text-fg-muted">(תוקנו מירכאות או פסיקים)</span>}
                </p>
                {unread.length > 0 && (
                  <p className="mt-1 text-fg-muted">
                    לא ייקלטו: {fieldList(unread)}. {READ_FIELDS}
                  </p>
                )}
              </>
            ) : pasted.kind === 'error' ? (
              <p className="flex items-start gap-2 text-danger">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{pasted.message}</span>
              </p>
            ) : (
              <p className="text-fg-muted">
                בכל ליד: <bdi dir="ltr">name</bdi> ו-<bdi dir="ltr">phone</bdi>, ואפשר גם <bdi dir="ltr">niche</bdi> (נשמר כנישה),{' '}
                <bdi dir="ltr">source</bdi> ו-<bdi dir="ltr">notes</bdi> (נשמרים כהערה בציר הזמן).
              </p>
            )}
          </div>
          {phase.kind === 'editing' &&
            (text ? (
              <Button size="sm" variant="ghost" onClick={() => onChange('')}>
                ניקוי
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onChange(JSON_EXAMPLE)}>
                דוגמה
              </Button>
            ))}
        </div>
      </DialogBody>

      <DialogFooter className="relative flex-wrap">
        {busy && (
          <span
            aria-hidden
            className="absolute inset-x-0 -top-px h-0.5 origin-left bg-focus transition-transform duration-300 rtl:origin-right"
            style={{ transform: `scaleX(${phase.total ? phase.done / phase.total : 0})` }}
          />
        )}
        {phase.kind === 'stopped' && (
          <p
            role="alert"
            className="w-full rounded-xl bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-3.5 py-2.5 text-[13.5px] text-danger"
          >
            {phase.outcome.created.length > 0 ? `נוספו ${count(phase.outcome.created.length, NOUNS.lead)} לפני שהייבוא נעצר. ` : ''}
            השאר עוד לא נשלחו: {phase.outcome.error}
          </p>
        )}
        {phase.kind === 'stopped' ? (
          <>
            <Button variant="ghost" onClick={() => (phase.outcome.created.length ? finish(phase.outcome) : onClose(false))}>
              סגירה
            </Button>
            <Button variant="primary" className="max-sm:flex-1" onClick={() => void send(phase.items, phase.outcome)}>
              <RotateCcw className="size-4" aria-hidden />
              להמשיך
            </Button>
          </>
        ) : (
          <>
            <Dialog.Close asChild>
              <Button variant="ghost" className="max-sm:hidden" disabled={busy}>
                ביטול
              </Button>
            </Dialog.Close>
            <Button variant="primary" className="max-sm:flex-1" disabled={!ready} onClick={start}>
              {busy ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {phase.total > 1 ? `מייבא ${phase.done.toLocaleString(appConfig.locale)} מתוך ${count(phase.total, NOUNS.lead)}…` : 'מייבא…'}
                </>
              ) : total === 1 ? (
                'ייבוא ליד אחד'
              ) : total > 1 ? (
                `ייבוא ${total.toLocaleString(appConfig.locale)} לידים`
              ) : (
                'ייבוא'
              )}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  );
}

/** What was imported, and each skipped item with the reason */
function Report({ outcome, onAgain, onDone }: { outcome: JsonImportOutcome; onAgain: () => void; onDone: () => void }) {
  const created = outcome.created.length;
  const byReason = REASON_ORDER.map((reason) => ({ reason, n: outcome.skipped.filter((item) => item.reason === reason).length })).filter(
    ({ n }) => n > 0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeading
        title={created === 0 ? 'לא נוסף אף ליד' : created === 1 ? 'נוסף ליד אחד' : `נוספו ${created.toLocaleString(appConfig.locale)} לידים`}
        description={
          outcome.skipped.length === 0
            ? 'כל הלידים נוספו.'
            : outcome.skipped.length === 1
              ? 'ליד אחד דולג, והסיבה כתובה לידו.'
              : `${outcome.skipped.length.toLocaleString(appConfig.locale)} דולגו, והסיבה כתובה ליד כל אחד.`
        }
      />
      <DialogBody className="flex flex-col gap-4">
        {byReason.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {byReason.map(({ reason, n }) => (
              <Chip key={reason} tone={REASONS[reason].tone}>
                {REASONS[reason].summary(n)}
              </Chip>
            ))}
          </div>
        )}
        {outcome.ignoredFields.length > 0 && (
          <p className="rounded-xl bg-field px-3.5 py-2.5 text-[13px] text-pretty text-fg-muted ring-1 ring-line ring-inset">
            לא נשמרו: {fieldList(outcome.ignoredFields)}. {READ_FIELDS}
          </p>
        )}
        {outcome.skipped.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl ring-1 ring-line ring-inset">
            {outcome.skipped.slice(0, REPORT_LIMIT).map((item) => (
              <SkippedItem key={item.index} item={item} />
            ))}
          </ul>
        )}
        {outcome.skipped.length > REPORT_LIMIT && (
          <p className="text-[12.5px] text-fg-faint">מוצגים {REPORT_LIMIT} הראשונים מתוך {outcome.skipped.length.toLocaleString(appConfig.locale)}.</p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onAgain}>
          ייבוא נוסף
        </Button>
        <Button variant="primary" className="max-sm:flex-1" onClick={onDone}>
          סיום
        </Button>
      </DialogFooter>
    </div>
  );
}

function SkippedItem({ item }: { item: JsonSkip }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 w-8 shrink-0 text-[12.5px] text-fg-faint tabular-nums">#{item.index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[14px]">
          <span className="font-medium">
            <bdi>{item.name || 'בלי שם'}</bdi>
          </span>
          {item.phone && <span className="ltr text-[13px] text-fg-muted">{item.phone}</span>}
        </p>
        <p className="mt-0.5 text-[12.5px] text-pretty text-fg-muted">
          {item.message}
          {item.firstIndex !== undefined && <span className="text-fg-faint"> · כמו #{item.firstIndex + 1}</span>}
        </p>
      </div>
      <Chip tone={REASONS[item.reason].tone}>{REASONS[item.reason].chip}</Chip>
    </li>
  );
}

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span style={toneStyle(tone)} className="tone-chip inline-block h-6 max-w-full shrink-0 truncate rounded-full px-2.5 text-[12px] leading-6 font-medium">
      {children}
    </span>
  );
}
