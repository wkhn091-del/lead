import { ArrowLeft, Globe, LoaderCircle, Mail, RotateCcw, UserRound } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { appConfig } from '../../config';
import { cn } from '../../lib/cn';
import { count, NOUNS } from '../../lib/hebrew';
import { COLUMN_TARGETS, TARGET_LABELS, type ColumnTarget } from '../../lib/import/fields';
import { parseImport, rowsFromTable, type ImportColumn } from '../../lib/import/parse';
import { buildLeads, reviewRows, type ReviewedRow } from '../../lib/import/review';
import { prefersReducedMotion } from '../../lib/motion';
import { CHANNEL_META, CHANNEL_OPTIONS, toneStyle } from '../../lib/stages';
import { websiteLabel } from '../../lib/website';
import { useLeadStore } from '../../store/leads';
import { toast } from '../../store/toasts';
import { useUi } from '../../store/ui';
import type { ContactMethod, Lead, NewLead } from '../../types';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { DialogBody, DialogFooter, DialogHeading } from '../ui/ResponsiveDialog';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { CampaignTag } from '../ui/StatusBadge';
import { inputBase } from '../ui/styles';

type Phase =
  | { kind: 'ready' }
  | { kind: 'saving'; saved: number; total: number }
  | { kind: 'failed'; saved: number; total: number; message: string; remaining: NewLead[] };

/** Rows listed for review. Selected rows past this point are still imported. */
const PREVIEW_LIMIT = 300;

const leadCount = (n: number) => count(n, NOUNS.lead);
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

interface ReviewStepProps {
  text: string;
  onBack: () => void;
  onLockChange: (locked: boolean) => void;
  onClose: (imported: boolean) => void;
}

export function ReviewStep({ text, onBack, onLockChange, onClose }: ReviewStepProps) {
  const parsed = useMemo(() => parseImport(text), [text]);
  // Compare against the leads as they were when the review opened, so rows don't change while saving.
  const [existing] = useState(() => useLeadStore.getState().leads);
  const importLeads = useLeadStore((s) => s.importLeads);
  const removeLeads = useLeadStore((s) => s.removeLeads);

  const [targets, setTargets] = useState<ColumnTarget[]>(() => parsed.table?.columns.map((c) => c.detected) ?? []);
  const [names, setNames] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [campaign, setCampaign] = useState('');
  const [method, setMethod] = useState<ContactMethod>('call');
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const saved = useRef<Lead[]>([]);

  const rows = useMemo(() => (parsed.table ? rowsFromTable(parsed.table, targets) : parsed.rows), [parsed, targets]);
  const unnamedKeys = useMemo(() => new Set(rows.filter((row) => !row.name.trim()).map((row) => row.key)), [rows]);
  const reviewed = useMemo(
    () => reviewRows(rows.map((row) => (row.key in names ? { ...row, name: names[row.key] } : row)), existing),
    [rows, names, existing],
  );

  const isChosen = (row: ReviewedRow) => row.name.trim() !== '' && (choices[row.key] ?? row.issue === null);
  const chosen = reviewed.filter(isChosen);
  const nameable = reviewed.filter((row) => row.name.trim() !== '');
  const allChosen = nameable.length > 0 && chosen.length === nameable.length;
  const inCrm = reviewed.filter((row) => row.issue === 'in-crm').length;
  const repeated = reviewed.filter((row) => row.issue === 'repeated').length;
  const unnamed = reviewed.filter((row) => row.issue === 'missing-name').length;
  const busy = phase.kind === 'saving';
  const unit = parsed.format === 'blocks' ? 'פסקה' : 'שורה';

  function finish(leads: Lead[]) {
    const ids = leads.map((lead) => lead.id);
    const ui = useUi.getState();
    if (ui.query || ui.stageFilter !== 'all' || ui.campaignFilter) ui.resetFilters();
    ui.highlight(ids);
    onClose(true);
    toast.show({
      message: leads.length === 1 ? 'ליד אחד יובא' : `יובאו ${leads.length.toLocaleString(appConfig.locale)} לידים`,
      tone: 'success',
      duration: 8000,
      action: {
        label: 'ביטול',
        onClick: () => {
          removeLeads(ids);
          toast.show({ message: 'הייבוא בוטל' });
        },
      },
    });
    window.setTimeout(() => {
      document
        .getElementById(`lead-${ids[0]}`)
        ?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }, 320);
  }

  async function save(leads: NewLead[], total: number) {
    onLockChange(true);
    setPhase({ kind: 'saving', saved: saved.current.length, total });
    const outcome = await importLeads(leads, (count) =>
      setPhase({ kind: 'saving', saved: saved.current.length + count, total }),
    );
    saved.current = [...saved.current, ...outcome.saved];
    onLockChange(false);
    if (!outcome.error) {
      finish(saved.current);
      return;
    }
    const done = new Set(saved.current.map((lead) => lead.id));
    setPhase({
      kind: 'failed',
      saved: saved.current.length,
      total,
      message: outcome.error,
      remaining: leads.filter((lead) => !done.has(lead.id)),
    });
  }

  const start = () => {
    saved.current = [];
    const leads = buildLeads(chosen, { campaign, method, currency: appConfig.baseCurrency });
    void save(leads, leads.length);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeading
        title={reviewed.length === 1 ? 'בדיקת ליד אחד' : `בדיקת ${reviewed.length.toLocaleString(appConfig.locale)} לידים`}
        description={
          parsed.table
            ? 'בודקים איך כל עמודה נקראה, ובוחרים את השורות לייבוא.'
            : `בודקים מה זוהה בכל ${unit}, ובוחרים את השורות לייבוא.`
        }
        closable={!busy}
      />

      <DialogBody className="flex flex-col gap-6">
        {parsed.table && (
          <ColumnMapping
            columns={parsed.table.columns}
            targets={targets}
            disabled={busy || phase.kind === 'failed'}
            onChange={(index, target) => setTargets((current) => current.map((t, i) => (i === index ? target : t)))}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="קמפיין למקבץ הזה" htmlFor="import-campaign">
            <input
              id="import-campaign"
              dir="auto"
              autoComplete="off"
              list="campaign-options"
              value={campaign}
              disabled={busy}
              maxLength={60}
              onChange={(event) => setCampaign(event.target.value)}
              placeholder="למשל: רופאי שיניים, שבוע 43"
              className={cn(inputBase, 'h-11 px-3.5 text-base sm:text-[14.5px]')}
            />
          </Field>
          <Field label="ערוץ לשורות שאין להן">
            <Segmented label="ערוץ לשורות שאין להן" value={method} options={CHANNEL_OPTIONS} onChange={setMethod} />
          </Field>
        </div>

        <section aria-labelledby="import-rows-heading">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <label className="flex items-center gap-2.5 text-[14px] font-medium">
              <input
                type="checkbox"
                checked={allChosen}
                ref={(element) => {
                  if (element) element.indeterminate = chosen.length > 0 && !allChosen;
                }}
                onChange={() => setChoices(Object.fromEntries(nameable.map((row) => [row.key, !allChosen])))}
                disabled={busy || nameable.length === 0}
                className="size-[18px] accent-[var(--focus)]"
              />
              <span id="import-rows-heading" className="tabular-nums">
                נבחרו {chosen.length.toLocaleString(appConfig.locale)} מתוך {count(reviewed.length, NOUNS.row)}
              </span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {inCrm > 0 && <IssueChip tone="var(--st-no-answer)">{inCrm} כבר אצלך בלידים</IssueChip>}
              {repeated > 0 && <IssueChip tone="var(--st-no-answer)">{repeated} מופיעים פעמיים בהדבקה</IssueChip>}
              {unnamed > 0 && <IssueChip tone="var(--danger)">{unnamed} בלי שם</IssueChip>}
            </div>
          </div>
          {inCrm + repeated > 0 && (
            <p className="mt-1.5 text-[12.5px] text-fg-faint">כפילויות לא מיובאות. אפשר לסמן אחת כדי לייבא אותה בכל זאת.</p>
          )}

          {reviewed.length === 0 ? (
            <p className="mt-3 rounded-2xl px-4 py-8 text-center text-[14px] text-fg-muted ring-1 ring-line ring-inset">
              אין שורות לייבוא עם העמודות האלה. בחרו עמודה לשם העסק.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl ring-1 ring-line ring-inset">
              {reviewed.slice(0, PREVIEW_LIMIT).map((row) => (
                <ReviewItem
                  key={row.key}
                  row={row}
                  chosen={isChosen(row)}
                  needsName={unnamedKeys.has(row.key)}
                  campaign={row.campaign || campaign}
                  method={row.method ?? method}
                  disabled={busy}
                  onToggle={() => setChoices((current) => ({ ...current, [row.key]: !isChosen(row) }))}
                  onName={(name) => setNames((current) => ({ ...current, [row.key]: name }))}
                />
              ))}
            </ul>
          )}
          {reviewed.length > PREVIEW_LIMIT && (
            <p className="mt-3 text-[12.5px] text-fg-faint">
              מוצגות {PREVIEW_LIMIT} השורות הראשונות. גם שורות מסומנות אחריהן ייובאו.
            </p>
          )}
        </section>
      </DialogBody>

      <DialogFooter className="relative flex-wrap">
        {busy && (
          <span
            aria-hidden
            className="absolute inset-x-0 -top-px h-0.5 origin-left bg-focus transition-transform duration-300 rtl:origin-right"
            style={{ transform: `scaleX(${phase.total ? phase.saved / phase.total : 0})` }}
          />
        )}
        {phase.kind === 'failed' && (
          <p
            role="alert"
            className="w-full rounded-xl bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-3.5 py-2.5 text-[13.5px] text-danger"
          >
            {phase.saved > 0 ? `יובאו ${phase.saved} מתוך ${phase.total}. ` : ''}השאר לא נשמרו: {phase.message}
          </p>
        )}

        {phase.kind === 'failed' && phase.saved > 0 ? (
          <Button variant="ghost" onClick={() => finish(saved.current)}>
            סגירה
          </Button>
        ) : (
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeft className="flip-rtl size-4" aria-hidden />
            חזרה
          </Button>
        )}

        {phase.kind === 'failed' ? (
          <Button variant="primary" className="max-sm:flex-1" onClick={() => void save(phase.remaining, phase.total)}>
            <RotateCcw className="size-4" aria-hidden />
            לנסות שוב
          </Button>
        ) : (
          <Button variant="primary" className="max-sm:flex-1" disabled={busy || chosen.length === 0} onClick={start}>
            {busy ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                מייבא {phase.saved.toLocaleString(appConfig.locale)} מתוך {leadCount(phase.total)}…
              </>
            ) : chosen.length === 1 ? (
              'ייבוא ליד אחד'
            ) : (
              `ייבוא ${chosen.length.toLocaleString(appConfig.locale)} לידים`
            )}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

function IssueChip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      style={toneStyle(tone)}
      className="tone-chip inline-block h-6 max-w-full truncate rounded-full px-2.5 text-[12px] leading-6 font-medium"
    >
      {children}
    </span>
  );
}

const columnLetter = (index: number) => String.fromCharCode(65 + (index % 26)) + (index >= 26 ? Math.floor(index / 26) : '');

interface ColumnMappingProps {
  columns: ImportColumn[];
  targets: ColumnTarget[];
  disabled: boolean;
  onChange: (index: number, target: ColumnTarget) => void;
}

function ColumnMapping({ columns, targets, disabled, onChange }: ColumnMappingProps) {
  return (
    <section aria-labelledby="import-columns-heading">
      <h3 id="import-columns-heading" className="text-[13px] font-medium text-fg-muted">
        עמודות
      </h3>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {columns.map((column, index) => {
          if (column.samples.length === 0) return null;
          const name = column.header ?? `עמודה ${columnLetter(index)}`;
          return (
            <div key={index} className="min-w-0 rounded-xl bg-field p-2.5 ring-1 ring-line ring-inset">
              <p dir="auto" className="truncate px-1 text-[13px] font-semibold">
                {name}
              </p>
              <p dir="auto" className="truncate px-1 text-[12px] text-fg-faint">
                {column.samples[0]}
              </p>
              <Select
                aria-label={`לקרוא את ${name} בתור`}
                value={targets[index]}
                disabled={disabled}
                onChange={(event) => onChange(index, event.target.value as ColumnTarget)}
                className="mt-2"
                selectClassName="h-9 rounded-lg bg-raised ps-2.5 sm:text-[13.5px]"
              >
                {COLUMN_TARGETS.map((target) => (
                  <option key={target} value={target}>
                    {TARGET_LABELS[target]}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface ReviewItemProps {
  row: ReviewedRow;
  chosen: boolean;
  /** The paste had no name for this row, so it gets a field to type one */
  needsName: boolean;
  campaign: string;
  method: ContactMethod;
  disabled: boolean;
  onToggle: () => void;
  onName: (name: string) => void;
}

function ReviewItem({ row, chosen, needsName, campaign, method, disabled, onToggle, onName }: ReviewItemProps) {
  const channel = CHANNEL_META[method];
  const ChannelIcon = channel.icon;
  const named = row.name.trim() !== '';

  return (
    <li className="flex gap-3 px-3.5 py-3 sm:px-4">
      <input
        type="checkbox"
        checked={chosen}
        disabled={disabled || !named}
        onChange={onToggle}
        aria-label={named ? `ייבוא ${row.name}` : 'ייבוא השורה הזו'}
        className="mt-[3px] size-[18px] shrink-0 accent-[var(--focus)] disabled:opacity-40"
      />
      <div className={cn('min-w-0 flex-1 transition-opacity', !chosen && 'opacity-55')}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {needsName ? (
              <input
                value={row.name}
                onChange={(event) => onName(event.target.value)}
                placeholder="הוספת שם"
                aria-label="שם העסק"
                dir="auto"
                disabled={disabled}
                className={cn(inputBase, 'h-9 w-60 max-w-full px-3 text-base sm:text-[14px]')}
              />
            ) : (
              <span dir="auto" className="min-w-0 truncate text-[14.5px] font-semibold">
                {row.name}
              </span>
            )}
            {row.issue === 'in-crm' && (
              <IssueChip tone="var(--st-no-answer)">
                {row.match && !sameName(row.match, row.name) ? `כבר אצלך בתור ${row.match}` : 'כבר אצלך בלידים'}
              </IssueChip>
            )}
            {row.issue === 'repeated' && <IssueChip tone="var(--st-no-answer)">כפול</IssueChip>}
          </div>
          <CampaignTag campaign={campaign} className="shrink-0 max-sm:hidden" />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-fg-muted">
          <CampaignTag campaign={campaign} className="sm:hidden" />
          {row.contactName && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <UserRound className="size-3.5 shrink-0" aria-hidden />
              <span dir="auto" className="truncate">
                {row.contactName}
              </span>
            </span>
          )}
          {row.phone && (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <ChannelIcon className="size-3.5 shrink-0" style={{ color: channel.tone }} aria-label={channel.label} />
              <span className="ltr">{row.phone}</span>
            </span>
          )}
          {row.email && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Mail className="size-3.5 shrink-0" aria-hidden />
              <span className="ltr truncate">{row.email}</span>
            </span>
          )}
          {row.website && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Globe className="size-3.5 shrink-0" aria-hidden />
              <span className="ltr truncate">{websiteLabel(row.website)}</span>
            </span>
          )}
          {!row.contactName && !row.phone && !row.email && <span className="text-fg-faint">אין פרטי קשר</span>}
        </div>

        {row.approach && (
          <p dir="auto" className="approach mt-2 rounded-lg px-3 py-1.5 text-[12.5px] text-fg-muted">
            {row.approach}
          </p>
        )}

        {row.notes && (
          <p dir="auto" className="mt-1.5 line-clamp-2 text-[12.5px] whitespace-pre-line text-fg-faint">
            {row.notes}
          </p>
        )}
      </div>
    </li>
  );
}
