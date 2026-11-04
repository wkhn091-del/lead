import { AnimatePresence } from 'motion/react';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { BOARD_COLUMNS, boardColumns, type BoardColumn } from '../../lib/board';
import { cn } from '../../lib/cn';
import { ARCHIVED_META, STATUS_META, toneStyle, type ToneMeta } from '../../lib/stages';
import { useUi } from '../../store/ui';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { LeadCard } from './LeadCard';

/** Cards a column shows before "show more", so a column of hundreds stays quick */
const PAGE = 40;

const metaOf = (column: BoardColumn): ToneMeta & { short: string } =>
  column === 'archived' ? { ...ARCHIVED_META, short: ARCHIVED_META.label } : STATUS_META[column];

/**
 * Every lead by where it stands: חדש, נוצר קשר (שיחה), נשלח וואטסאפ, הצעת מחיר and נסגר / לקוח, side by side on
 * wide screens and one at a time, in tabs, on phones. Leads marked not relevant are kept apart, shown on request.
 * `leads` are the ones the search and filters above it (LeadsView) let through, of every status.
 */
export function PipelineBoard({ leads, filterKey }: { leads: readonly Lead[]; filterKey: string }) {
  const { boardTab, showArchived, setBoardTab } = useUi(useShallow((s) => ({ boardTab: s.boardTab, showArchived: s.showArchived, setBoardTab: s.setBoardTab })));
  // One layout at a time, so each lead has one card on the page (and one #lead-… to scroll to)
  const wide = useMediaQuery('(min-width: 1024px)');
  const columns = useMemo(() => boardColumns(leads), [leads]);
  const shownColumns = BOARD_COLUMNS.filter((column) => column !== 'archived' || showArchived);

  return wide ? (
    // Wide screens: every status side by side, each column scrolling on its own
    <div className="board-columns" style={{ gridTemplateColumns: `repeat(${shownColumns.length}, minmax(232px, 1fr))` }}>
      {shownColumns.map((column) => (
        <Column key={column} column={column} leads={columns[column]} filterKey={filterKey} />
      ))}
    </div>
  ) : (
    // Phones and tablets: one status at a time
    <div>
      <div role="tablist" aria-label="סטטוס" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {BOARD_COLUMNS.map((column) => {
          const meta = metaOf(column);
          const active = column === boardTab;
          return (
            <button
              key={column}
              type="button"
              role="tab"
              id={`board-tab-${column}`}
              aria-selected={active}
              aria-controls="board-tab-panel"
              onClick={() => setBoardTab(column)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium ring-1 ring-inset transition-colors',
                active ? 'bg-raised text-fg shadow-[0_1px_2px_var(--shadow-soft)] ring-line-strong' : 'text-fg-muted ring-line hover:text-fg',
                column === 'archived' && !active && 'opacity-70',
              )}
            >
              <meta.icon className="size-4 shrink-0" style={{ color: meta.tone }} aria-hidden />
              {meta.short}
              <span className="text-[12.5px] text-fg-faint tabular-nums">{columns[column].length}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="board-tab-panel" aria-labelledby={`board-tab-${boardTab}`} className="mt-3">
        <CardList key={`${boardTab}:${filterKey}`} column={boardTab} leads={columns[boardTab]} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" />
      </div>
    </div>
  );
}

function Column({ column, leads, filterKey }: { column: BoardColumn; leads: Lead[]; filterKey: string }) {
  const meta = metaOf(column);
  return (
    <section aria-labelledby={`column-${column}`} className={cn('glass flex min-h-0 flex-col rounded-[22px]', column === 'archived' && 'opacity-85')}>
      <header className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
        <span style={toneStyle(meta.tone)} className="tone-chip flex size-7 shrink-0 items-center justify-center rounded-full">
          <meta.icon className="size-3.5" strokeWidth={2.25} aria-hidden />
        </span>
        <h3 id={`column-${column}`} className="min-w-0 truncate text-[14px] font-semibold">
          {meta.label}
        </h3>
        <span className="ms-auto text-[12.5px] text-fg-faint tabular-nums" aria-label={`${leads.length} לידים`}>
          {leads.length}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pt-0.5 pb-2.5">
        <CardList key={filterKey} column={column} leads={leads} className="flex flex-col gap-2" />
      </div>
    </section>
  );
}

/** A column's cards, the first PAGE of them, then "show more" */
function CardList({ column, leads, className }: { column: BoardColumn; leads: Lead[]; className?: string }) {
  const [limit, setLimit] = useState(PAGE);
  if (leads.length === 0) {
    return <p className="rounded-2xl px-3 py-8 text-center text-[13px] text-pretty text-fg-faint">{EMPTY[column]}</p>;
  }
  const rest = leads.length - limit;
  return (
    <>
      <ul className={className}>
        <AnimatePresence initial={false} mode="popLayout">
          {leads.slice(0, limit).map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </AnimatePresence>
      </ul>
      {rest > 0 && (
        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setLimit((shown) => shown + PAGE)}>
          עוד {Math.min(rest, PAGE)} מתוך {rest}
        </Button>
      )}
    </>
  );
}

const EMPTY: Record<BoardColumn, string> = {
  new: 'אין לידים חדשים. ייבוא רשימה או ליד חדש יופיעו כאן.',
  contacted: 'כאן יופיעו לידים אחרי ״תעד שיחה״.',
  whatsapp: 'כאן יופיעו לידים אחרי ששולחים להם וואטסאפ.',
  quote: 'כאן יופיעו לידים שביקשו הצעת מחיר.',
  client: 'כאן יופיעו העסקאות שנסגרו.',
  archived: 'אין לידים שסומנו כלא רלוונטיים.',
};
