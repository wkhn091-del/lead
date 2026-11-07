import type { SortingState } from '@tanstack/react-table';
import { ArrowUpLeft, Handshake, Repeat, Sparkle, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { BoardColumn } from '../../lib/board';
import { cn } from '../../lib/cn';
import { homeStats, type HomeStats } from '../../lib/dashboard';
import { currencySymbol, formatMoney, formatNumber } from '../../lib/format';
import { fromCount, NOUNS } from '../../lib/hebrew';
import type { AddedFilter } from '../../lib/leads-table';
import { toneStyle } from '../../lib/stages';
import { useLeadStore } from '../../store/leads';
import { useUi } from '../../store/ui';
import type { Currency } from '../../types';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { useNow } from './useDashboardData';

const CURRENCY_NAME: Record<Currency, string> = { ILS: 'בשקלים', USD: 'בדולרים' };

/** The leads table, filtered to what a number counts. A status filter is the table's, so it opens as a table. */
function showLeads({ statuses, added, sorting = [] }: { statuses?: BoardColumn[]; added?: AddedFilter; sorting?: SortingState } = {}) {
  const ui = useUi.getState();
  ui.resetFilters();
  if (statuses) ui.setStatusFilter(statuses);
  if (added) ui.setAddedFilter(added);
  ui.setTableSorting(sorting);
  if (statuses?.length) ui.setLeadsLayout('table');
  ui.setView('pipeline');
  window.scrollTo({ top: 0 });
}

/** "ועוד 1,200 $ בדולרים", for the amounts in deals made in another currency */
function otherMoney(others: HomeStats['others'], pick: 'revenue' | 'mrr'): string {
  return (Object.entries(others) as [Currency, { revenue: number; mrr: number }][])
    .filter(([, amounts]) => amounts[pick] > 0)
    .map(([code, amounts]) => ` · ועוד ${formatMoney(amounts[pick], code)} ${CURRENCY_NAME[code]}`)
    .join('');
}

/**
 * The home screen's headline numbers: every lead, the new ones today, the closed deals, their setup fees and the
 * retainers coming in each month. Worked out from the leads in memory, so logging a call, a status change or a new
 * deal moves them at once, with no reload. Each opens the leads table on what it counts.
 */
export function HomeStatsRow() {
  const leads = useLeadStore((s) => s.leads);
  const loading = useLeadStore((s) => s.loadState !== 'ready' && s.leads.length === 0);
  const now = useNow();
  const s = useMemo(() => homeStats(leads, now), [leads, now]);

  const tiles: TileProps[] = [
    {
      label: 'סך הלידים',
      value: s.total,
      icon: Users,
      tone: 'var(--st-cold)',
      caption: s.total ? `${formatNumber(s.active)} פעילים${s.archived ? ` · ${formatNumber(s.archived)} לא רלוונטיים` : ''}` : 'עוד אין לידים: ייבוא רשימה או ליד חדש',
      open: { label: 'לכל הלידים', run: () => showLeads() },
    },
    {
      label: 'לידים חדשים היום',
      value: s.newToday,
      icon: Sparkle,
      tone: 'var(--st-cold)',
      caption: `${formatNumber(s.newYesterday)} אתמול · ${formatNumber(s.newThisWeek)} ב-7 הימים האחרונים`,
      open: { label: 'ללידים שנוספו היום', run: () => showLeads({ added: 'today' }) },
    },
    {
      label: 'עסקאות שנסגרו',
      value: s.closed,
      icon: Handshake,
      tone: 'var(--st-won)',
      caption:
        s.closed || s.quotes
          ? `${formatNumber(s.closedThisMonth)} החודש · ${formatNumber(s.quotes)} בהצעת מחיר`
          : 'עוד לא נסגרו עסקאות',
      open: { label: 'ללקוחות', run: () => showLeads({ statuses: ['client'] }) },
    },
    {
      label: 'סך ההכנסות',
      value: s.revenue,
      money: s.currency,
      icon: Wallet,
      tone: 'var(--st-won)',
      caption: (s.pricedDeals ? `דמי הקמה ${fromCount(s.pricedDeals, NOUNS.deal)}` : 'עוד אין סכומים בעסקאות שנסגרו') + otherMoney(s.others, 'revenue'),
      open: { label: 'לעסקאות, הגדולה קודם', run: () => showLeads({ statuses: ['client'], sorting: [{ id: 'deal', desc: true }] }) },
    },
    {
      label: 'ריטיינרים',
      value: s.mrr,
      money: s.currency,
      per: 'לחודש',
      icon: Repeat,
      tone: 'var(--chart-retainers)',
      caption: (s.retainerClients ? `${formatMoney(s.mrr * 12, s.currency)} בשנה, ${fromCount(s.retainerClients, NOUNS.client)}` : 'עוד אין לקוחות בריטיינר') + otherMoney(s.others, 'mrr'),
      open: { label: 'ללקוחות, העסקה הגדולה קודם', run: () => showLeads({ statuses: ['client'], sorting: [{ id: 'deal', desc: true }] }) },
    },
  ];

  return (
    <section aria-labelledby="home-stats-heading">
      <h2 id="home-stats-heading" className="sr-only">
        המספרים, מתעדכנים מיד
      </h2>
      {/* Phones: two by two, the last across. Tablets: three, then two. Wide: one row. */}
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-6 lg:grid-cols-5">
        {tiles.map((tile, index) => (
          <li key={tile.label} className={cn(index < 3 ? 'md:col-span-2' : 'md:col-span-3', index === 4 && 'max-md:col-span-2', 'lg:col-span-1')}>
            <Tile {...tile} loading={loading} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface TileProps {
  label: string;
  value: number;
  /** Money: the currency sign follows the amount, as Hebrew writes it */
  money?: Currency;
  per?: string;
  caption: string;
  icon: LucideIcon;
  tone: string;
  open: { label: string; run: () => void };
  loading?: boolean;
}

function Tile({ label, value, money, per, caption, icon: Icon, tone, open, loading }: TileProps) {
  const spoken = `${money ? formatMoney(value, money) : formatNumber(value)}${per ? ` ${per}` : ''}`;
  return (
    <button
      type="button"
      onClick={open.run}
      title={open.label}
      className="glass group flex h-full w-full min-w-0 flex-col items-start rounded-[22px] px-4 pt-4 pb-3.5 text-start transition-shadow hover:ring-1 hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:px-5 sm:pt-5 sm:pb-4"
    >
      <span className="flex w-full items-center gap-2">
        <span style={toneStyle(tone)} className="tone-chip flex size-7 shrink-0 items-center justify-center rounded-full">
          <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
        </span>
        <span className="min-w-0 text-[13px] leading-snug font-medium text-pretty text-fg-muted">{label}</span>
        <ArrowUpLeft className="ms-auto size-4 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:hidden" aria-hidden />
      </span>
      {loading ? (
        <span aria-hidden className="shimmer mt-3.5 block h-8 w-20 rounded-lg" />
      ) : (
        <span className="mt-3 flex flex-wrap items-baseline gap-x-1.5">
          {/* A big standalone figure: proportional digits, the same sans as the rest */}
          <span aria-hidden className="inline-flex items-baseline text-[30px] leading-none tracking-[-0.035em] [font-weight:600] [font-stretch:90%] sm:text-[34px]">
            <AnimatedNumber value={value} />
            {money && <span className="ms-[0.1em] text-[0.55em] text-fg-muted [font-weight:500] [font-stretch:100%]">{currencySymbol(money)}</span>}
          </span>
          {per && (
            <span aria-hidden className="text-[13px] text-fg-muted">
              {per}
            </span>
          )}
          <span className="sr-only">{spoken}</span>
        </span>
      )}
      <span className="mt-2 text-[12.5px] leading-snug text-pretty text-fg-faint">{caption}</span>
    </button>
  );
}
