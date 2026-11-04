import { Archive, CircleAlert, ClipboardPaste, Columns3, FileSpreadsheet, Inbox, Plus, RotateCcw, Search, SearchX, Table2, X, type LucideIcon } from 'lucide-react';
import { useDeferredValue, useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { appConfig } from '../../config';
import { repository } from '../../data/repository';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { BOARD_COLUMNS, type BoardColumn } from '../../lib/board';
import { cn } from '../../lib/cn';
import { exportLeads } from '../../lib/export';
import { count, NOUNS } from '../../lib/hebrew';
import { campaignCounts } from '../../lib/leads';
import { ADDED_OPTIONS, byLatestTouch, filterLeadsBy, statusCounts, statusRank, type AddedFilter } from '../../lib/leads-table';
import { ARCHIVED_META, PIPELINE, STATUS_META, type ToneMeta } from '../../lib/stages';
import { useLeadStore } from '../../store/leads';
import { toast } from '../../store/toasts';
import { useUi, type LeadsLayout } from '../../store/ui';
import type { Lead } from '../../types';
import { Button, Kbd } from '../ui/Button';
import { Segmented, type SegmentedOption } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { inputBase } from '../ui/styles';
import { LeadsTable, useLeadsTable } from './LeadsTable';
import { PipelineBoard } from './PipelineBoard';

const LAYOUTS: readonly SegmentedOption<LeadsLayout>[] = [
  { value: 'table', label: 'טבלה', icon: Table2 },
  { value: 'board', label: 'עמודות', icon: Columns3 },
];

const STATUS_CHIPS: readonly { value: BoardColumn; meta: ToneMeta }[] = [
  ...PIPELINE.map((status) => ({ value: status, meta: { ...STATUS_META[status], label: STATUS_META[status].short } })),
  { value: 'archived', meta: ARCHIVED_META },
];

const numbers = new Intl.NumberFormat(appConfig.locale);

/** Writes the leads to a file on this device, in the order given: in the browser, so it works offline too */
function exportRows(rows: readonly Lead[], format: 'xlsx' | 'csv') {
  try {
    exportLeads(rows, format);
    toast.success(format === 'xlsx' ? 'קובץ האקסל ירד' : 'קובץ ה-CSV ירד', `${count(rows.length, NOUNS.lead)}, לפי הסינון והמיון שעל המסך.`);
  } catch (error) {
    toast.error('הייצוא לא הצליח', error instanceof Error ? error.message : 'נסו שוב.');
  }
}

/**
 * The leads: one search and set of filters over two layouts, a table (sort by any column, page through, export) and
 * the board, a column per status. The export writes exactly what is shown, every page of it, in the order shown.
 */
export function LeadsView() {
  const { leads, loadState, loadError, load, addSampleLeads } = useLeadStore(
    useShallow((s) => ({ leads: s.leads, loadState: s.loadState, loadError: s.loadError, load: s.load, addSampleLeads: s.addSampleLeads })),
  );
  const ui = useUi(
    useShallow((s) => ({
      query: s.query,
      campaign: s.campaignFilter,
      statuses: s.statusFilter,
      added: s.addedFilter,
      layout: s.leadsLayout,
      showArchived: s.showArchived,
      setQuery: s.setQuery,
      setCampaign: s.setCampaignFilter,
      toggleStatus: s.toggleStatus,
      setStatuses: s.setStatusFilter,
      setAdded: s.setAddedFilter,
      setLayout: s.setLeadsLayout,
      setShowArchived: s.setShowArchived,
      resetFilters: s.resetFilters,
      setAddOpen: s.setAddOpen,
      setImportOpen: s.setImportOpen,
    })),
  );
  const wide = useMediaQuery('(min-width: 1024px)');
  const search = useDeferredValue(ui.query);
  const campaigns = useMemo(() => campaignCounts(leads), [leads]);

  // The table: the statuses chosen (none: all but "not relevant"); the board: every status, in its columns
  const tableRows = useMemo(
    () => filterLeadsBy(leads, { query: search, campaign: ui.campaign, statuses: ui.statuses, added: ui.added }).sort(byLatestTouch),
    [leads, search, ui.campaign, ui.statuses, ui.added],
  );
  const boardRows = useMemo(
    () => filterLeadsBy(leads, { query: search, campaign: ui.campaign, statuses: BOARD_COLUMNS, added: ui.added }),
    [leads, search, ui.campaign, ui.added],
  );
  const counts = useMemo(() => statusCounts(leads, { query: search, campaign: ui.campaign, added: ui.added }), [leads, search, ui.campaign, ui.added]);
  const filterKey = `${search}|${ui.campaign}|${ui.statuses.join()}|${ui.added}`;
  const table = useLeadsTable(tableRows, filterKey);

  if (loadState === 'idle' || (loadState === 'loading' && leads.length === 0)) return <LoadingLeads layout={ui.layout} />;

  if (loadState === 'error' && leads.length === 0) {
    return (
      <EmptyState
        icon={CircleAlert}
        title="לא הצלחנו לטעון את הלידים"
        body={loadError ?? 'בדקו את החיבור ונסו שוב.'}
        actions={
          <Button onClick={() => void load()}>
            <RotateCcw className="size-4" aria-hidden />
            לנסות שוב
          </Button>
        }
      />
    );
  }

  if (leads.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="עדיין אין לידים"
        body="מוסיפים עסק אחד, או מייבאים רשימה שלמה: טבלה מאקסל או קובץ JSON מדפי זהב או מגוגל מפות. כל ליד נכנס בסטטוס ״חדש״."
        actions={
          <>
            <Button variant="primary" onClick={() => ui.setImportOpen(true)}>
              <ClipboardPaste className="size-4" aria-hidden />
              ייבוא לידים
            </Button>
            <Button onClick={() => ui.setAddOpen(true)}>
              <Plus className="size-4" strokeWidth={2.5} aria-hidden />
              ליד חדש
            </Button>
            {repository.kind === 'local' && (
              <Button variant="ghost" onClick={addSampleLeads}>
                טעינת לידים לדוגמה
              </Button>
            )}
          </>
        }
      />
    );
  }

  const isTable = ui.layout === 'table';
  // What the export writes: the table's rows in its sort, every page; or the board's columns, one after another
  const shown: readonly Lead[] = isTable
    ? table.getPrePaginationRowModel().rows.map((row) => row.original)
    : boardRows.filter((lead) => ui.showArchived || !lead.archivedAt).sort((a, b) => statusRank(a) - statusRank(b) || byLatestTouch(a, b));
  const filtering = Boolean(search.trim() || ui.campaign || ui.added !== 'all' || (isTable && ui.statuses.length));
  const nothingFound = isTable ? tableRows.length === 0 : boardRows.length === 0;

  return (
    <section aria-labelledby="leads-heading" className="flex flex-col gap-3">
      <h2 id="leads-heading" className="sr-only">
        לידים
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-full sm:basis-64">
          <span className="sr-only">חיפוש לידים</span>
          <Search className="pointer-events-none absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
          <input
            id="lead-search"
            type="search"
            value={ui.query}
            onChange={(event) => ui.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && ui.query) {
                event.preventDefault();
                ui.setQuery('');
              }
            }}
            placeholder="חיפוש לפי שם, איש קשר, טלפון או נישה"
            autoComplete="off"
            className={cn(inputBase, 'h-11 ps-10 pe-12 text-base sm:text-[14.5px]')}
          />
          <Kbd className="pointer-events-none absolute top-1/2 end-3 -translate-y-1/2 max-lg:hidden">/</Kbd>
        </label>
        {campaigns.length > 0 && (
          <Select aria-label="נישה" value={ui.campaign} onChange={(event) => ui.setCampaign(event.target.value)} className="w-48 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-[40%]">
            <option value="">כל הנישות</option>
            {campaigns.map((campaign) => (
              <option key={campaign.name} value={campaign.name}>
                {campaign.name} ({campaign.count})
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="מתי נוספו" value={ui.added} onChange={(event) => ui.setAdded(event.target.value as AddedFilter)} className="w-44 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-[40%]">
          {ADDED_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Segmented label="תצוגת הלידים" value={ui.layout} options={LAYOUTS} onChange={ui.setLayout} />
        <ExportButtons rows={shown} />
      </div>

      {isTable ? (
        <div role="group" aria-label="סינון לפי סטטוס" className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip active={ui.statuses.length === 0} onClick={() => ui.setStatuses([])} count={BOARD_COLUMNS.reduce((sum, column) => (column === 'archived' ? sum : sum + counts[column]), 0)}>
            כל הפעילים
          </Chip>
          {STATUS_CHIPS.map(({ value, meta }) => (
            <Chip key={value} active={ui.statuses.includes(value)} onClick={() => ui.toggleStatus(value)} count={counts[value]} meta={meta} faded={value === 'archived'} />
          ))}
          {filtering && (
            <Button variant="ghost" size="sm" className="ms-auto shrink-0" onClick={ui.resetFilters}>
              <X className="size-4" aria-hidden />
              ניקוי הסינון
            </Button>
          )}
        </div>
      ) : (
        wide && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" aria-pressed={ui.showArchived} onClick={() => ui.setShowArchived(!ui.showArchived)}>
              <Archive className="size-4" aria-hidden />
              {ui.showArchived ? 'הסתרת לא רלוונטיים' : 'הצגת לא רלוונטיים'}
              <span className="text-[12.5px] text-fg-faint tabular-nums">{counts.archived}</span>
            </Button>
            {filtering && (
              <Button variant="ghost" size="sm" className="ms-auto" onClick={ui.resetFilters}>
                <X className="size-4" aria-hidden />
                ניקוי הסינון
              </Button>
            )}
          </div>
        )
      )}

      {nothingFound ? (
        filtering ? (
          <EmptyState
            icon={SearchX}
            title={search.trim() ? `אין לידים שמתאימים לחיפוש "${search.trim()}"` : 'אין לידים שמתאימים לסינון'}
            body="נסו חיפוש אחר, או נקו את הסינון."
            actions={<Button onClick={ui.resetFilters}>ניקוי הסינון</Button>}
          />
        ) : (
          <EmptyState
            icon={Archive}
            title="אין לידים פעילים"
            body="כל הלידים סומנו כלא רלוונטיים."
            actions={<Button onClick={() => ui.setStatuses(['archived'])}>הצגת הלא רלוונטיים</Button>}
          />
        )
      ) : isTable ? (
        <LeadsTable table={table} />
      ) : (
        <PipelineBoard leads={boardRows} filterKey={filterKey} />
      )}
    </section>
  );
}

function Chip({
  active,
  onClick,
  count: amount,
  meta,
  faded,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  meta?: ToneMeta;
  faded?: boolean;
  children?: ReactNode;
}) {
  const Icon = meta?.icon;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium ring-1 ring-inset transition-colors',
        active ? 'bg-raised text-fg shadow-[0_1px_2px_var(--shadow-soft)] ring-line-strong' : 'text-fg-muted ring-line hover:text-fg',
        faded && !active && 'opacity-70',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" style={{ color: meta.tone }} aria-hidden />}
      {children ?? meta?.label}
      <span className="text-[12.5px] text-fg-faint tabular-nums">{numbers.format(amount)}</span>
    </button>
  );
}

/** "ייצוא לאקסל", the main way out; CSV beside it for anything else */
function ExportButtons({ rows }: { rows: readonly Lead[] }) {
  const none = rows.length === 0;
  const run = (format: 'xlsx' | 'csv') => exportRows(rows, format);
  return (
    <div className="flex items-center gap-1 max-sm:min-w-0 max-sm:flex-1 sm:ms-auto">
      <Button
        variant="primary"
        className="max-sm:flex-1"
        disabled={none}
        aria-label={`ייצוא ${count(rows.length, NOUNS.lead)} לאקסל`}
        title="מוריד קובץ אקסל עם כל הלידים שמוצגים, לפי הסינון והמיון"
        onClick={() => run('xlsx')}
      >
        <FileSpreadsheet className="size-4" aria-hidden />
        ייצוא לאקסל
        <span className="rounded-md bg-[color-mix(in_oklab,currentColor_16%,transparent)] px-1.5 text-[12.5px] tabular-nums">{numbers.format(rows.length)}</span>
      </Button>
      {/* On a phone the Excel file is the one to open; CSV is for a computer */}
      <Button variant="ghost" className="max-sm:hidden" disabled={none} title="אותם לידים בקובץ CSV" aria-label={`ייצוא ${count(rows.length, NOUNS.lead)} לקובץ CSV`} onClick={() => run('csv')}>
        CSV
      </Button>
    </div>
  );
}

function LoadingLeads({ layout }: { layout: LeadsLayout }) {
  return (
    <div aria-busy="true" aria-label="טוען לידים" className="flex flex-col gap-3">
      <div className="h-11 animate-pulse rounded-xl bg-field" />
      {layout === 'table' ? (
        <div className="glass flex flex-col gap-3 rounded-[22px] p-4">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="h-9 animate-pulse rounded-xl bg-field" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((column) => (
            <div key={column} className={cn('glass flex flex-col gap-2 rounded-[22px] p-3', column > 0 && 'max-lg:hidden')}>
              <div className="h-5 w-24 animate-pulse rounded-full bg-field-hover" />
              {[0, 1, 2].map((card) => (
                <div key={card} className="h-24 animate-pulse rounded-2xl bg-field" />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  actions?: ReactNode;
}

function EmptyState({ icon: Icon, title, body, actions }: EmptyStateProps) {
  return (
    <div className="glass flex flex-col items-center rounded-[22px] px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-field text-fg-muted ring-1 ring-line ring-inset">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 dir="auto" className="mt-4 text-[16px] font-semibold text-balance">
        {title}
      </h3>
      <p className="mt-1.5 max-w-md text-[14px] text-pretty text-fg-muted">{body}</p>
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
