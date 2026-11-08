import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Row,
  type Table,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Ellipsis, Globe, MapPin, MessageCircle, PhoneCall } from 'lucide-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { appConfig } from '../../config';
import { boardColumn, cardLine } from '../../lib/board';
import { cn } from '../../lib/cn';
import { dealAmounts } from '../../lib/deal';
import { formatDate, formatRelative } from '../../lib/format';
import { callCount, compareText, dealValue, lastContactAt, statusRank } from '../../lib/leads-table';
import { mapsLink } from '../../lib/maps';
import { formatPhone } from '../../lib/phone';
import { ARCHIVED_META, STATUS_META } from '../../lib/stages';
import { websiteHref, websiteLabel } from '../../lib/website';
import { useUi } from '../../store/ui';
import type { Lead } from '../../types';
import { buttonStyles } from '../ui/Button';
import { Select } from '../ui/Select';
import { CampaignTag, ToneBadge } from '../ui/StatusBadge';
import { logWhatsApp, useWhatsAppLink } from './actions';
import { LeadCard } from './LeadCard';

const PAGE_SIZES = [25, 50, 100] as const;

const column = createColumnHelper<Lead>();

/** The lead's status as a badge: its column on the board, or "לא רלוונטי" */
function StatusBadge({ lead }: { lead: Lead }) {
  const status = boardColumn(lead);
  const meta = status === 'archived' ? ARCHIVED_META : { ...STATUS_META[status], label: STATUS_META[status].short };
  return <ToneBadge meta={meta} className="h-6 text-[12px]" />;
}

const columns = [
  column.accessor('name', {
    header: 'שם העסק',
    sortingFn: (a, b) => compareText(a.original.name, b.original.name),
    cell: ({ row }) => <NameCell lead={row.original} />,
  }),
  column.accessor(statusRank, { id: 'status', header: 'סטטוס', cell: ({ row }) => <StatusBadge lead={row.original} /> }),
  column.accessor('phone', {
    header: 'טלפון',
    enableSorting: false,
    cell: ({ getValue }) => (getValue() ? <span className="ltr inline-block tabular-nums">{formatPhone(getValue())}</span> : <Dash />),
  }),
  column.accessor('campaign', {
    header: 'נישה',
    sortingFn: (a, b) => compareText(a.original.campaign, b.original.campaign),
    cell: ({ getValue }) => (getValue() ? <CampaignTag campaign={getValue()} className="h-6 max-w-40" /> : <Dash />),
  }),
  // A lead with no city sorts after the rest, whichever way
  column.accessor((lead) => lead.city?.trim() || undefined, {
    id: 'city',
    header: 'עיר',
    sortUndefined: 'last',
    sortingFn: (a, b) => compareText(a.original.city ?? '', b.original.city ?? ''),
    cell: ({ getValue }) => {
      const city = getValue();
      return city ? (
        <span dir="auto" className="block max-w-32 truncate whitespace-nowrap">
          {city}
        </span>
      ) : (
        <Dash />
      );
    },
  }),
  column.accessor(callCount, { id: 'calls', header: 'שיחות', sortDescFirst: true, cell: ({ getValue }) => <span className="tabular-nums">{getValue() || <Dash />}</span> }),
  column.accessor((lead) => lastContactAt(lead) ?? undefined, {
    id: 'lastContact',
    header: 'קשר אחרון',
    sortDescFirst: true,
    sortUndefined: 'last',
    cell: ({ row }) => <span className="text-fg-muted">{row.original.activity.length ? cardLine(row.original) : <Dash />}</span>,
  }),
  column.accessor((lead) => Date.parse(lead.createdAt), {
    id: 'created',
    header: 'נוסף',
    sortDescFirst: true,
    cell: ({ row }) => (
      <time dateTime={row.original.createdAt} title={formatDate(row.original.createdAt)} className="whitespace-nowrap text-fg-muted">
        {formatRelative(row.original.createdAt)}
      </time>
    ),
  }),
  column.accessor(dealValue, {
    id: 'deal',
    header: 'עסקה',
    sortDescFirst: true,
    cell: ({ row }) => {
      const [first, second] = row.original.stage === 'closed' ? dealAmounts(row.original.deal, row.original.currency) : [];
      return first ? (
        <span className="whitespace-nowrap tabular-nums">
          <span className="font-semibold">{first}</span>
          {second && <span className="block text-[12px] text-fg-muted">{second}</span>}
        </span>
      ) : (
        <Dash />
      );
    },
  }),
  column.display({ id: 'actions', header: () => <span className="sr-only">פעולות</span>, cell: ({ row }) => <RowActions lead={row.original} /> }),
];

const Dash = () => <span className="text-fg-faint">—</span>;

function NameCell({ lead }: { lead: Lead }) {
  const openProfile = useUi((s) => s.openProfile);
  return (
    <button
      id={`lead-${lead.id}`}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openProfile(lead.id);
      }}
      className="block max-w-72 min-w-0 scroll-mt-28 rounded-md text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span dir="auto" className={cn('block truncate font-semibold', lead.archivedAt && 'text-fg-muted')}>
        {lead.name}
      </span>
      {lead.contactName && (
        <span dir="auto" className="block truncate text-[12.5px] text-fg-muted">
          {lead.contactName}
        </span>
      )}
    </button>
  );
}

const iconButton = buttonStyles({ variant: 'ghost', size: 'icon', className: 'size-8 rounded-lg' });

/**
 * תעד שיחה, WhatsApp with the ready message, the business on Google Maps and its website (each in a new tab),
 * and every other action (⋯)
 */
function RowActions({ lead }: { lead: Lead }) {
  const openCallLog = useUi((s) => s.openCallLog);
  const openPalette = useUi((s) => s.openPalette);
  const whatsApp = useWhatsAppLink(lead);
  const maps = mapsLink(lead);
  const site = websiteHref(lead.website);
  const archived = Boolean(lead.archivedAt);
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
      {!archived && (
        <button type="button" className={iconButton} aria-label={`תיעוד שיחה עם ${lead.name}`} title="תעד שיחה" onClick={() => openCallLog(lead.id)}>
          <PhoneCall className="size-4" style={{ color: 'var(--st-answered)' }} aria-hidden />
        </button>
      )}
      {!archived && whatsApp && (
        <a
          href={whatsApp.href}
          target="_blank"
          rel="noreferrer"
          className={iconButton}
          aria-label={`וואטסאפ ל-${lead.name}, עם הודעה מוכנה`}
          title={whatsApp.message}
          onClick={() => logWhatsApp(lead, whatsApp.message)}
        >
          <MessageCircle className="size-4" style={{ color: 'var(--whatsapp)' }} aria-hidden />
        </a>
      )}
      {maps && (
        <a
          href={maps.href}
          target="_blank"
          rel="noopener noreferrer"
          className={iconButton}
          aria-label={maps.search ? `חיפוש ${lead.name} בגוגל מפות` : `${lead.name} בגוגל מפות`}
          title={maps.search ? `חיפוש בגוגל מפות: ${lead.name}, ${lead.city}` : 'גוגל מפות'}
        >
          <MapPin className="size-4" style={{ color: 'var(--st-lost)' }} aria-hidden />
        </a>
      )}
      {site && (
        <a href={site} target="_blank" rel="noopener noreferrer" className={iconButton} aria-label={`האתר של ${lead.name}`} title={websiteLabel(lead.website)}>
          <Globe className="size-4" style={{ color: 'var(--st-cold)' }} aria-hidden />
        </a>
      )}
      <button type="button" className={iconButton} aria-label={`עוד פעולות: ${lead.name}`} title="עוד פעולות" onClick={() => openPalette(lead.id)}>
        <Ellipsis className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Sort choices on a phone, where there are no column headers to click */
const PHONE_SORTS = [
  { value: '', label: 'קשר אחרון קודם' },
  { value: 'created:desc', label: 'נוספו לאחרונה' },
  { value: 'name:asc', label: 'שם העסק, א-ת' },
  { value: 'city:asc', label: 'לפי עיר' },
  { value: 'status:asc', label: 'לפי סטטוס' },
  { value: 'calls:desc', label: 'הכי הרבה שיחות' },
  { value: 'deal:desc', label: 'עסקה גדולה קודם' },
] as const;

/**
 * The table's state over `leads` (the ones the filters let through, the most recently touched first): its sort and
 * page. Made where the export can read it too, so a file holds exactly the rows the table has, in its order.
 */
export function useLeadsTable(leads: Lead[], filterKey: string) {
  const { sorting, setSorting } = useUi(useShallow((s) => ({ sorting: s.tableSorting, setSorting: s.setTableSorting })));
  const table = useReactTable({
    data: leads,
    columns,
    state: { sorting },
    onSortingChange: (updater) => setSorting(typeof updater === 'function' ? updater(sorting) : updater),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (lead) => lead.id,
    // Logging a call changes the data: the page stays where it is
    autoResetPageIndex: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  });

  // A new search, filter or sort starts from the first page; a page past the end (after a delete) steps back
  const sortKey = sorting.map((item) => `${item.id}:${item.desc}`).join();
  useEffect(() => table.setPageIndex(0), [filterKey, sortKey, table]);
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  useEffect(() => {
    if (pageIndex > 0 && pageIndex >= pageCount) table.setPageIndex(Math.max(0, pageCount - 1));
  }, [pageIndex, pageCount, table]);
  return table;
}

/**
 * The leads as a table: sort by any column, page through them, and act on each row (תעד שיחה, וואטסאפ, ⋯). The
 * filters and search are above it (PipelineView). On a phone the same rows are cards, with a sort menu.
 */
export function LeadsTable({ table }: { table: Table<Lead> }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const openProfile = useUi((s) => s.openProfile);
  const sorting = table.getState().sorting;
  const total = table.getPrePaginationRowModel().rows.length;
  const rows = table.getRowModel().rows;

  if (!wide) {
    const phoneSort = sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : '';
    return (
      <div className="flex flex-col gap-3">
        <Select
          aria-label="מיון"
          value={PHONE_SORTS.some((option) => option.value === phoneSort) ? phoneSort : ''}
          onChange={(event) => {
            const [id, direction] = event.target.value.split(':');
            table.setSorting(id ? [{ id, desc: direction === 'desc' }] : []);
          }}
        >
          {PHONE_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              מיון: {option.label}
            </option>
          ))}
        </Select>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {rows.map((row) => (
            <LeadCard key={row.id} lead={row.original} />
          ))}
        </ul>
        <Pager table={table} total={total} />
      </div>
    );
  }

  return (
    <div className="glass overflow-hidden rounded-[22px]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-line">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const sortable = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : sortable ? 'none' : undefined}
                      className="px-3 py-2.5 text-start text-[12.5px] font-medium whitespace-nowrap text-fg-muted first:ps-5 last:pe-4"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn('-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-field hover:text-fg', sorted && 'text-fg')}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3.5" aria-hidden />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <TableRow key={row.id} row={row} onOpen={() => openProfile(row.original.id)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-4 py-2.5">
        <Pager table={table} total={total} />
      </div>
    </div>
  );
}

function TableRow({ row, onOpen }: { row: Row<Lead>; onOpen: () => void }) {
  const highlighted = useUi((s) => s.highlightedIds.has(row.original.id));
  return (
    <tr onClick={onOpen} className={cn('cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-field', highlighted && 'row-flash', row.original.archivedAt && 'opacity-70')}>
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="px-3 py-2.5 align-middle first:ps-5 last:pe-4">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

const numbers = new Intl.NumberFormat(appConfig.locale);

function Pager({ table, total }: { table: Table<Lead>; total: number }) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const from = total ? pageIndex * pageSize + 1 : 0;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-fg-muted">
      <span className="tabular-nums" aria-live="polite">
        {total === 0 ? 'אין לידים' : `${numbers.format(from)}–${numbers.format(to)} מתוך ${numbers.format(total)}`}
      </span>
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-1.5">
          <span>בעמוד</span>
          <select
            value={pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            className="h-8 rounded-lg bg-field px-2 text-[13px] text-fg ring-1 ring-line ring-inset"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        {/* Right to left: the previous page is to the right */}
        <button type="button" className={iconButton} aria-label="העמוד הקודם" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <span className="min-w-16 text-center tabular-nums">
          {table.getPageCount() > 1 ? `${pageIndex + 1} / ${table.getPageCount()}` : ''}
        </span>
        <button type="button" className={iconButton} aria-label="העמוד הבא" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
