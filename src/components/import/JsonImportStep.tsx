import * as Dialog from '@radix-ui/react-dialog';
import { CircleAlert, FileUp, LoaderCircle, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { appConfig } from '../../config';
import type { JsonSkip, JsonSkipReason } from '../../data/repository/types';
import { cn } from '../../lib/cn';
import { count, ltr, NOUNS } from '../../lib/hebrew';
import { foundFields, JSON_EXAMPLE, jsonKeysOf, MAPPABLE_FIELDS, parseJsonLeads, unreadFields, type JsonMapping, type MappableField } from '../../lib/import/json';
import { toneStyle } from '../../lib/stages';
import { useLeadStore, type JsonImportOutcome } from '../../store/leads';
import { toast } from '../../store/toasts';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Button } from '../ui/Button';
import { DialogBody, DialogFooter, DialogHeading } from '../ui/ResponsiveDialog';
import { Select } from '../ui/Select';
import { inputBase } from '../ui/styles';
import { announceImport } from './announce';

type Phase =
  | { kind: 'editing' }
  | { kind: 'saving'; done: number; total: number }
  /** The connection dropped or the server failed partway: what was saved stays, the rest can be sent again */
  | { kind: 'stopped'; outcome: JsonImportOutcome; items: unknown[]; mapping: JsonMapping }
  /** Done, with leads skipped or completed, or fields not read: shown before closing */
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
  deleted: { chip: 'נמחק בעבר', tone: 'var(--st-lost)', summary: (n) => (n === 1 ? 'עסק אחד כבר היה ב-CRM ונמחק' : `${n} כבר היו ב-CRM ונמחקו`) },
  repeated: { chip: 'כפול ברשימה', tone: 'var(--st-no-answer)', summary: (n) => (n === 1 ? 'עסק אחד חוזר ברשימה' : `${n} עסקים חוזרים ברשימה`) },
  'no-phone': { chip: 'בלי טלפון', tone: 'var(--danger)', summary: (n) => (n === 1 ? 'ליד אחד בלי טלפון תקין' : `${n} בלי טלפון תקין`) },
  invalid: { chip: 'לא תקין', tone: 'var(--danger)', summary: (n) => (n === 1 ? 'פריט אחד לא תקין' : `${n} פריטים לא תקינים`) },
};
const REASON_ORDER: JsonSkipReason[] = ['exists', 'deleted', 'repeated', 'no-phone', 'invalid'];

/** Field names inside a Hebrew sentence, kept left to right as one run */
const fieldList = (fields: readonly string[]) => `⁦${fields.join(', ')}⁩`;
const SAVED_ELSEWHERE = 'כל השאר נשמר בליד, או בהערה הראשונה שלו בציר הזמן.';
/** Bigger files than this are more than one import should take */
const FILE_LIMIT = 20 * 1024 * 1024;

/** The fields that can be told which key to come from, by the label the preview gives them */
const MAPPED: Record<MappableField, string> = { name: 'שם העסק', phone: 'טלפון', niche: 'נישה' };

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
 * Leads pasted as a JSON array, sent to the server as they are: it finds each field by its usual names, or by
 * what's in the key, and keeps only phone numbers no lead has yet (server/src/leads/json-import.ts). Where a file
 * names its fields oddly, the business name, phone and niche can be told which key to come from. The report says
 * what was skipped and why.
 */
export function JsonImportStep({ text, onChange, switcher, onLockChange, onClose }: JsonImportStepProps) {
  const deferred = useDeferredValue(text);
  const pasted = useMemo(() => parseJsonLeads(deferred), [deferred]);
  const keys = useMemo(() => (pasted.kind === 'ok' ? jsonKeysOf(pasted.items) : []), [pasted]);
  const [mapping, setMapping] = useState<JsonMapping>({});
  const [mapOpen, setMapOpen] = useState(false);
  // A key chosen for an earlier paste counts only while this one has it
  const chosen = useMemo<JsonMapping>(
    () => Object.fromEntries(MAPPABLE_FIELDS.flatMap((field) => (mapping[field] && keys.some((item) => item.key === mapping[field]) ? [[field, mapping[field]]] : []))),
    [mapping, keys],
  );
  const automatic = useMemo(() => (pasted.kind === 'ok' ? foundFields(pasted.items) : []), [pasted]);
  const unread = useMemo(() => (pasted.kind === 'ok' ? unreadFields(pasted.items, chosen) : []), [pasted, chosen]);
  const found = useMemo(() => (pasted.kind === 'ok' ? foundFields(pasted.items, chosen) : []), [pasted, chosen]);
  const importJson = useLeadStore((s) => s.importJson);
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /** A JSON file goes into the box, as if it was pasted */
  async function openFile(file: File | undefined) {
    if (!file || phase.kind !== 'editing') return;
    if (file.size > FILE_LIMIT) {
      toast.error('הקובץ גדול מדי', 'אפשר לפתוח קובץ של עד 20MB. כדאי לחלק אותו לכמה קבצים.');
      return;
    }
    try {
      onChange(await file.text());
    } catch {
      toast.error('לא הצלחנו לקרוא את הקובץ.');
    }
  }

  const dropProps = {
    onDragOver: (event: DragEvent) => {
      if (phase.kind !== 'editing' || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      setDragging(false);
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      void openFile(event.dataTransfer.files[0]);
    },
  };
  const hasName = found.some((field) => field.label === 'שם העסק');
  const hasPhone = found.some((field) => field.label === 'טלפון');

  const ready = pasted.kind === 'ok' && phase.kind === 'editing';
  const busy = phase.kind === 'saving';

  function finish(outcome: JsonImportOutcome) {
    onClose(true);
    announceImport(outcome.created);
  }

  async function send(items: unknown[], map: JsonMapping, from?: JsonImportOutcome) {
    onLockChange(true);
    setPhase({ kind: 'saving', done: from?.done ?? 0, total: items.length });
    const outcome = await importJson(items, { from, mapping: map, onProgress: (done) => setPhase({ kind: 'saving', done, total: items.length }) });
    onLockChange(false);
    if (outcome.error) setPhase({ kind: 'stopped', outcome, items, mapping: map });
    else if (outcome.skipped.length || outcome.ignoredFields.length || outcome.updated.length) setPhase({ kind: 'report', outcome });
    else finish(outcome);
  }

  const start = () => {
    if (pasted.kind === 'ok' && phase.kind === 'editing') void send(pasted.items, chosen);
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
        description="מדביקים JSON של לידים או פותחים קובץ, למשל מדפי זהב או מגוגל מפות. נשמרים רק עסקים חדשים: עסק שכבר ב-CRM, שהיה בו ונמחק, או שחוזר ברשימה (אותו טלפון, אותו מקום בגוגל מפות, אותו אתר, או אותו שם באותה עיר) מדולג."
        closable={!busy}
      />
      <DialogBody className="flex flex-col gap-3">
        {switcher}
        <label htmlFor="import-text" className="sr-only">
          מערך JSON של לידים
        </label>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.jsonl,.ndjson,.txt,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            void openFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <textarea
          id="import-text"
          {...dropProps}
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
            dragging && 'ring-2 ring-focus',
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
                {found.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-fg-muted">זוהו:</span>
                    {found.map((field) => (
                      <span key={field.label} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-field px-2.5 text-[12.5px] ring-1 ring-line ring-inset">
                        <span className="font-medium">{field.label}</span>
                        <bdi dir="ltr" className="text-fg-muted">
                          {field.keys.slice(0, 3).join(', ')}
                        </bdi>
                      </span>
                    ))}
                  </p>
                )}
                {(!hasName || !hasPhone) && (
                  <p className="mt-1.5 flex items-start gap-2 text-danger">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      {!hasName && !hasPhone ? 'לא נמצאו שם עסק וטלפון' : !hasName ? 'לא נמצא שם העסק' : 'לא נמצא מספר טלפון'}
                      {keys.length > 0 ? ': בוחרים למטה מאיזה שדה בקובץ לקחת.' : (
                        <>
                          : כדאי שהשדות ייקראו למשל <bdi dir="ltr">name</bdi>, <bdi dir="ltr">title</bdi> או <bdi dir="ltr">company</bdi>, ו-
                          <bdi dir="ltr">phone</bdi>, <bdi dir="ltr">mobile</bdi> או <bdi dir="ltr">tel</bdi>.
                        </>
                      )}
                    </span>
                  </p>
                )}
                {unread.length > 0 && <p className="mt-1 text-fg-muted">לא ייקלטו: {fieldList(unread.slice(0, 12))}{unread.length > 12 ? '…' : ''}.</p>}
              </>
            ) : pasted.kind === 'error' ? (
              <p className="flex items-start gap-2 text-danger">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{pasted.message}</span>
              </p>
            ) : (
              <p className="text-fg-muted">
                השדות מזוהים לבד, גם בשמות אחרים: שם העסק (<bdi dir="ltr">name, title, company</bdi>), טלפון (<bdi dir="ltr">phone, mobile, tel</bdi>),
                נישה (<bdi dir="ltr">category, niche, type</bdi>) וכתובת (<bdi dir="ltr">address, city</bdi>), ואפשר גם לבחור אותם ביד. כל ליד
                נכנס בסטטוס ״חדש״, עם הערה ״יובא מקובץ JSON״ בציר הזמן.
              </p>
            )}
          </div>
          {phase.kind === 'editing' && (
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
                <FileUp className="size-4" aria-hidden />
                פתיחת קובץ
              </Button>
              {text ? (
                <Button size="sm" variant="ghost" onClick={() => onChange('')}>
                  ניקוי
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onChange(JSON_EXAMPLE)}>
                  דוגמה
                </Button>
              )}
            </div>
          )}
        </div>
        {pasted.kind === 'ok' && keys.length > 0 &&
          (mapOpen || !hasName || !hasPhone || Object.keys(chosen).length > 0 ? (
            <fieldset className="mt-1 rounded-xl p-3 ring-1 ring-line ring-inset" disabled={phase.kind !== 'editing'}>
              <legend className="px-1 text-[12.5px] font-medium text-fg-muted">מאיזה שדה בקובץ לקחת</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {MAPPABLE_FIELDS.map((field) => {
                  const auto = automatic.find((item) => item.label === MAPPED[field])?.keys[0];
                  return (
                    <label key={field} className="flex min-w-0 flex-col gap-1">
                      <span className="text-[12.5px] font-medium">{MAPPED[field]}</span>
                      <Select
                        value={chosen[field] ?? ''}
                        onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}
                        selectClassName="h-10 text-base sm:text-[13.5px]"
                      >
                        <option value="">{auto ? `אוטומטי: ${ltr(auto)}` : 'אוטומטי: לא נמצא'}</option>
                        {keys.map((item) => (
                          <option key={item.key} value={item.key}>
                            {`${ltr(item.key)} · ${item.example}`}
                          </option>
                        ))}
                      </Select>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <Button size="sm" variant="ghost" className="-ms-2 -mt-1 self-start" onClick={() => setMapOpen(true)}>
              <SlidersHorizontal className="size-4" aria-hidden />
              שינוי השדות שזוהו
            </Button>
          ))}
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
            <Button variant="primary" className="max-sm:flex-1" onClick={() => void send(phase.items, phase.mapping, phase.outcome)}>
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

const amount = (n: number) => n.toLocaleString(appConfig.locale);

/** "נוספו 3 לידים, והושלמו פרטים ב-64", "הושלמו פרטים ב-66 לידים", "נוסף ליד אחד" */
function reportTitle(created: number, updated: number): string {
  const added = created === 1 ? 'נוסף ליד אחד' : `נוספו ${amount(created)} לידים`;
  if (updated === 0) return created === 0 ? 'לא נוסף אף ליד' : added;
  if (created === 0) return updated === 1 ? 'הושלמו פרטים בליד אחד' : `הושלמו פרטים ב-${amount(updated)} לידים`;
  return `${added}, והושלמו פרטים ב${updated === 1 ? 'ליד אחד' : `-${amount(updated)}`}`;
}

/** What was imported, what leads already here got, and each skipped item with the reason */
function Report({ outcome, onAgain, onDone }: { outcome: JsonImportOutcome; onAgain: () => void; onDone: () => void }) {
  const created = outcome.created.length;
  const updated = outcome.updated.length;
  const skipped = outcome.skipped.length;
  const byReason = REASON_ORDER.map((reason) => ({ reason, n: outcome.skipped.filter((item) => item.reason === reason).length })).filter(
    ({ n }) => n > 0,
  );
  const description = [
    updated > 0 && 'לידים שכבר היו קיבלו את מה שחסר להם: טלפון, עיר, קישור לגוגל מפות או אתר. שום פרט קיים לא שונה.',
    skipped === 0
      ? updated === 0 && 'כל הלידים נוספו.'
      : skipped === 1
        ? 'ליד אחד דולג, והסיבה כתובה לידו.'
        : `${amount(skipped)} דולגו, והסיבה כתובה ליד כל אחד.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeading title={reportTitle(created, updated)} description={description} />
      <DialogBody className="flex flex-col gap-4">
        {(byReason.length > 0 || updated > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {updated > 0 && <Chip tone="var(--st-won)">{updated === 1 ? 'ליד אחד הושלם' : `${amount(updated)} הושלמו`}</Chip>}
            {byReason.map(({ reason, n }) => (
              <Chip key={reason} tone={REASONS[reason].tone}>
                {REASONS[reason].summary(n)}
              </Chip>
            ))}
          </div>
        )}
        {outcome.ignoredFields.length > 0 && (
          <p className="rounded-xl bg-field px-3.5 py-2.5 text-[13px] text-pretty text-fg-muted ring-1 ring-line ring-inset">
            לא נשמרו: {fieldList(outcome.ignoredFields)}. {SAVED_ELSEWHERE}
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
