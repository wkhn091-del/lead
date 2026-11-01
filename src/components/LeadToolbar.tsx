import { motion } from 'motion/react';
import { ArrowUpDown, ChevronDown, Search, X } from 'lucide-react';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStuck } from '../hooks/useStuck';
import { handleRadioKeys } from '../lib/a11y';
import { cn } from '../lib/cn';
import { campaignCounts, matchesStage, SORT_OPTIONS, type SortKey, type StageFilter } from '../lib/leads';
import { SPRING } from '../lib/motion';
import { ARCHIVED_META, STAGE_META, toneStyle } from '../lib/stages';
import { STAGES } from '../types';
import { Select } from './ui/Select';
import { useLeadStore } from '../store/leads';
import { useUi } from '../store/ui';
import { Kbd } from './ui/Button';
import { inputBase, inputSize } from './ui/styles';

export function LeadToolbar() {
  const leads = useLeadStore((s) => s.leads);
  const { query, stageFilter, campaignFilter, sort, setQuery, setStageFilter, setCampaignFilter, setSort } = useUi(
    useShallow((s) => ({
      query: s.query,
      stageFilter: s.stageFilter,
      campaignFilter: s.campaignFilter,
      sort: s.sort,
      setQuery: s.setQuery,
      setStageFilter: s.setStageFilter,
      setCampaignFilter: s.setCampaignFilter,
      setSort: s.setSort,
    })),
  );
  const campaigns = useMemo(() => campaignCounts(leads), [leads]);
  const inCampaign = useMemo(
    () => (campaignFilter ? leads.filter((lead) => lead.campaign === campaignFilter) : leads),
    [leads, campaignFilter],
  );
  const { sentinelRef, stuck } = useStuck<HTMLDivElement>();

  const count = (filter: StageFilter) => inCampaign.filter((lead) => matchesStage(lead, filter)).length;
  const filters: { value: StageFilter; label: string; count: number }[] = [
    { value: 'all', label: 'כל הפתוחים', count: count('all') },
    ...STAGES.map((stage) => ({ value: stage as StageFilter, label: STAGE_META[stage].label, count: count(stage) })),
    { value: 'archived', label: ARCHIVED_META.label, count: count('archived') },
  ];
  const filterValues = filters.map((filter) => filter.value);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px" />
      <div
        className={cn(
          'toolbar z-20 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6 md:sticky lg:-mx-8 lg:px-8',
          stuck && 'toolbar-stuck',
        )}
      >
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-fg-faint"
              aria-hidden
            />
            <input
              id="lead-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  event.currentTarget.blur();
                }
              }}
              placeholder="חיפוש לפי שם, טלפון, אתר או קמפיין"
              aria-label="חיפוש לידים"
              autoComplete="off"
              dir="auto"
              className={cn(inputBase, inputSize, 'ps-10 pe-10 placeholder:text-start')}
            />
            {query ? (
              <button
                type="button"
                aria-label="ניקוי החיפוש"
                onClick={() => setQuery('')}
                className="absolute top-1/2 end-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-fg-faint hover:bg-field-hover hover:text-fg"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : (
              <Kbd className="pointer-events-none absolute top-1/2 end-3 -translate-y-1/2 text-fg-faint max-md:hidden">
                /
              </Kbd>
            )}
          </div>

          {campaigns.length > 0 && (
            <Select
              id="lead-campaign"
              aria-label="סינון לפי קמפיין"
              value={campaignFilter}
              onChange={(event) => setCampaignFilter(event.target.value)}
              className="min-w-0 max-sm:hidden sm:w-52"
            >
              <option value="">כל הקמפיינים</option>
              {campaigns.map((campaign) => (
                <option key={campaign.name} value={campaign.name}>
                  {campaign.name} ({campaign.count})
                </option>
              ))}
            </Select>
          )}
          <div className="relative shrink-0">
            <ArrowUpDown
              className="pointer-events-none absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            {/* On phones only the icon shows; the native picker lists the options. */}
            <select
              id="lead-sort"
              aria-label="מיון לידים"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className={cn(
                inputBase,
                'h-11 w-11 appearance-none ps-10 text-base text-transparent sm:w-auto sm:pe-9 sm:text-[14.5px] sm:text-fg',
              )}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="text-fg">
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 end-3 size-4 -translate-y-1/2 text-fg-faint max-sm:hidden"
              aria-hidden
            />
          </div>
        </div>

        {campaigns.length > 0 && (
          <Select
            aria-label="סינון לפי קמפיין"
            value={campaignFilter}
            onChange={(event) => setCampaignFilter(event.target.value)}
            className="mt-2 sm:hidden"
          >
            <option value="">כל הקמפיינים</option>
            {campaigns.map((campaign) => (
              <option key={campaign.name} value={campaign.name}>
                {campaign.name} ({campaign.count})
              </option>
            ))}
          </Select>
        )}

        <div
          role="radiogroup"
          aria-label="סינון לפי שלב"
          onKeyDown={(event) => handleRadioKeys(event, filterValues, stageFilter, setStageFilter)}
          className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          {filters.map((filter) => {
            const active = filter.value === stageFilter;
            const meta = filter.value === 'all' ? null : filter.value === 'archived' ? ARCHIVED_META : STAGE_META[filter.value];
            const Icon = meta?.icon;
            return (
              <button
                key={filter.value}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                data-value={filter.value}
                onClick={() => setStageFilter(filter.value)}
                style={meta ? toneStyle(meta.tone) : undefined}
                className={cn(
                  'relative flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium transition-colors',
                  active ? 'text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="status-filter-pill"
                    transition={SPRING}
                    className="absolute inset-0 rounded-full bg-raised shadow-[0_1px_2px_var(--shadow-soft)] ring-1 ring-line-strong"
                  />
                )}
                {Icon && <Icon className="tone-text relative size-3.5" strokeWidth={2.25} aria-hidden />}
                <span className="relative">{filter.label}</span>
                <span className="relative tabular-nums text-fg-faint">{filter.count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
