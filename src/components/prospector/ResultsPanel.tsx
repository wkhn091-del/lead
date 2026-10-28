import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight, CircleAlert, ListChecks, LoaderCircle, SearchX, Square, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { count, NOUNS } from '../../lib/hebrew';
import { EASE_OUT } from '../../lib/motion';
import {
  canImport,
  isChecking,
  isRunning,
  isTarget,
  SCORE_META,
  SCORES,
  SEARCH_STATUS_LABEL,
  searchLabel,
  visibleProspects,
  type ProspectFilter,
  type ProspectSort,
} from '../../lib/prospects';
import { toneStyle } from '../../lib/stages';
import { useProspector } from '../../store/prospector';
import type { ProspectSearch } from '../../types';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { ProspectRow } from './ProspectRow';

/** The search on screen: how far it got, its scores, and the businesses to pick from */
export function ResultsPanel() {
  const { current, opening, filter, sort, selected, setFilter, setSort, setSelected, cancel } = useProspector(
    useShallow((s) => ({
      current: s.current,
      opening: s.opening,
      filter: s.filter,
      sort: s.sort,
      selected: s.selected,
      setFilter: s.setFilter,
      setSort: s.setSort,
      setSelected: s.setSelected,
      cancel: s.cancel,
    })),
  );
  const prospects = useMemo(() => current?.prospects ?? [], [current]);
  const rows = useMemo(() => visibleProspects(prospects, filter, sort), [prospects, filter, sort]);
  const lastPicked = useRef<string | null>(null);

  if (!current) return null;
  const { search } = current;
  const running = isRunning(search);
  const targets = prospects.filter(isTarget);
  const pickable = rows.filter(canImport);
  const pickedHere = pickable.filter((item) => selected.has(item.id)).length;
  const targetsToPick = targets.filter(canImport);
  const stillChecking = prospects.filter(isChecking).length;
  const hiddenWhileRunning = filter === 'targets' && running ? stillChecking : 0;

  /** A click picks one row; shift-click picks every row between it and the last one picked */
  const onSelect = (id: string, event: MouseEvent<HTMLInputElement>) => {
    const on = !selected.has(id);
    const from = lastPicked.current ? rows.findIndex((item) => item.id === lastPicked.current) : -1;
    const to = rows.findIndex((item) => item.id === id);
    if (event.shiftKey && from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      setSelected(rows.slice(a, b + 1).filter(canImport).map((item) => item.id), on);
    } else {
      setSelected([id], on);
    }
    lastPicked.current = id;
  };

  return (
    <section aria-label="תוצאות החיפוש" className="glass overflow-hidden rounded-[22px]">
      <header className="px-4 pt-4 pb-3.5 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-[18px] font-semibold tracking-[-0.01em]">
              <span dir="auto">{searchLabel(search)}</span>
              {search.demo && <DemoTag />}
            </h2>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              <StatusLine search={search} />
            </p>
            {/* When another provider took over, or the search stopped early: said quietly, the results are what matter */}
            {search.notice && (
              <p className="mt-1.5 flex gap-1.5 text-[12.5px] text-pretty text-fg-faint">
                <ArrowLeftRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">{search.notice}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {running && (
              <Button size="sm" onClick={() => void cancel()}>
                <Square className="size-3.5" aria-hidden />
                עצירה
              </Button>
            )}
            {!running && !search.demo && <RemoveSearch search={search} />}
          </div>
        </div>

        {running && <Progress search={search} />}
        {search.total > 0 && <ScoreStrip search={search} bar={!running} />}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Segmented<ProspectFilter>
            label="אילו עסקים להציג"
            value={filter}
            options={[
              { value: 'targets', label: `ציון 4-5 · ${targets.length}` },
              { value: 'all', label: `הכול · ${prospects.length}` },
            ]}
            onChange={setFilter}
            className="h-10"
          />
          <Segmented<ProspectSort>
            label="סדר"
            value={sort}
            options={[
              { value: 'score', label: 'לפי ציון' },
              { value: 'google', label: 'לפי גוגל' },
            ]}
            onChange={setSort}
            className="h-10"
          />
          {targetsToPick.length > 0 && (
            <Button size="sm" className="h-10" onClick={() => setSelected(targetsToPick.map((item) => item.id), true)}>
              <ListChecks className="size-4" aria-hidden />
              בחירת כל ה-4-5 ({targetsToPick.length})
            </Button>
          )}
        </div>
      </header>

      {opening && prospects.length === 0 ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <Empty search={search} filter={filter} stillChecking={stillChecking} onShowAll={() => setFilter('all')} />
      ) : (
        <>
          <div className="hidden items-center border-y border-line text-[12.5px] font-medium text-fg-faint lg:flex">
            <label className="flex shrink-0 cursor-pointer items-center ps-5 pe-1">
              <SelectAll
                checked={pickable.length > 0 && pickedHere === pickable.length}
                mixed={pickedHere > 0 && pickedHere < pickable.length}
                disabled={!pickable.length}
                onChange={(on) => setSelected(pickable.map((item) => item.id), on)}
              />
            </label>
            <div aria-hidden className="prospect-grid flex-1 py-3 ps-3 pe-5">
              <span className="gp-score">ציון צורך</span>
              <span className="gp-name">עסק</span>
              <span className="gp-phone">טלפון</span>
              <span className="gp-site">אתר</span>
              <span className="gp-verdict">מה מצאנו</span>
              <span className="gp-chevron" />
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[13px] text-fg-muted sm:px-5 lg:hidden">
            <label className="flex cursor-pointer items-center gap-2">
              <SelectAll
                checked={pickable.length > 0 && pickedHere === pickable.length}
                mixed={pickedHere > 0 && pickedHere < pickable.length}
                disabled={!pickable.length}
                onChange={(on) => setSelected(pickable.map((item) => item.id), on)}
              />
              בחירת כל מה שמוצג
            </label>
          </div>
          <ul aria-label="עסקים" className="relative border-t border-line lg:border-t-0">
            <AnimatePresence initial={false} mode="popLayout">
              {rows.map((prospect) => (
                <ProspectRow key={prospect.id} prospect={prospect} demo={Boolean(search.demo)} selected={selected.has(prospect.id)} onSelect={onSelect} />
              ))}
            </AnimatePresence>
          </ul>
          {hiddenWhileRunning > 0 && (
            <p className="flex items-center justify-center gap-2 border-t border-line px-5 py-3.5 text-[13px] text-fg-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              עוד {count(hiddenWhileRunning, NOUNS.site)} בבדיקה. עסקים עם ציון 4-5 יופיעו כאן.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function DemoTag() {
  return (
    <span className="rounded-md bg-[color-mix(in_oklab,var(--st-zoom)_14%,transparent)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--st-zoom)]">
      דוגמה
    </span>
  );
}

function StatusLine({ search }: { search: ProspectSearch }) {
  if (search.demo) return <>חיפוש לדוגמה עם עסקים בדויים, כדי לראות איך זה עובד. שום דבר כאן לא אמיתי.</>;
  switch (search.status) {
    case 'discovering':
      return <>{SEARCH_STATUS_LABEL.discovering}</>;
    case 'analyzing':
      return (
        <>
          {count(search.total, NOUNS.business)} · נבדקו {search.checked} מתוך {search.total}
        </>
      );
    case 'failed':
      return <span className="text-danger">{search.error ?? 'החיפוש נכשל.'}</span>;
    case 'cancelled':
      return (
        <>
          החיפוש נעצר · נבדקו {search.checked} מתוך {search.total}
        </>
      );
    case 'done':
      return (
        <>
          {count(search.total, NOUNS.business)} · החיפוש הסתיים {formatRelative(search.finishedAt ?? search.updatedAt)}
          {search.imported > 0 && ` · ${search.imported} יובאו`}
        </>
      );
  }
}

function Progress({ search }: { search: ProspectSearch }) {
  const discovering = search.status === 'discovering';
  const ratio = search.total ? search.checked / search.total : 0;
  return (
    <div
      role="progressbar"
      aria-label={discovering ? 'מחפש עסקים' : 'בדיקת האתרים'}
      aria-valuemin={0}
      aria-valuemax={search.total || undefined}
      aria-valuenow={discovering ? undefined : search.checked}
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-field-hover"
    >
      {discovering ? (
        <div className="progress-indeterminate h-full w-full" />
      ) : (
        <motion.div
          className="h-full rounded-full bg-[var(--st-cold)]"
          initial={false}
          animate={{ width: `${Math.max(4, ratio * 100)}%` }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        />
      )}
    </div>
  );
}

/** How many businesses got each score, as one bar (once the search is done; the progress bar shows until then) */
function ScoreStrip({ search, bar }: { search: ProspectSearch; bar: boolean }) {
  const scored = SCORES.reduce((sum, score) => sum + search.scores[String(score) as keyof typeof search.scores], 0);
  return (
    <div className="mt-3.5">
      <div className={cn('flex h-2 gap-0.5 overflow-hidden rounded-full bg-field-hover', !bar && 'hidden')} aria-hidden>
        {SCORES.map((score) => {
          const n = search.scores[String(score) as keyof typeof search.scores];
          return n ? (
            <motion.span
              key={score}
              className="h-full"
              style={{ background: SCORE_META[score].tone }}
              initial={false}
              animate={{ flexGrow: n }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
            />
          ) : null;
        })}
        {search.total > scored && <span className="h-full" style={{ flexGrow: search.total - scored }} />}
      </div>
      <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-muted', bar && 'mt-2')}>
        {SCORES.map((score) => (
          <li key={score} className="flex items-center gap-1.5" style={toneStyle(SCORE_META[score].tone)} title={`ציון ${score}`}>
            <span className="size-2 rounded-full bg-[var(--tone)]" aria-hidden />
            {SCORE_META[score].label}:
            <span className="font-semibold tabular-nums text-fg">{search.scores[String(score) as keyof typeof search.scores]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SelectAll({ checked, mixed, disabled, onChange }: { checked: boolean; mixed: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      aria-label="בחירת כל העסקים שמוצגים"
      className="size-[18px] cursor-pointer accent-[var(--focus)] disabled:cursor-default"
    />
  );
}

/** Deleting a search can't be undone, so it asks once more. Imported leads stay. */
function RemoveSearch({ search }: { search: ProspectSearch }) {
  const remove = useProspector((s) => s.remove);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(timer);
  }, [asking]);

  return asking ? (
    <Button size="sm" variant="danger" onClick={() => void remove(search.id)}>
      <Trash2 className="size-4" aria-hidden />
      למחוק את החיפוש
    </Button>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setAsking(true)} aria-label={`מחיקת החיפוש ${searchLabel(search)}`}>
      <Trash2 className="size-4" aria-hidden />
      מחיקה
    </Button>
  );
}

function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="טוען את העסקים" className="divide-y divide-line border-t border-line">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-4 px-5 py-4">
          <div className="h-6 w-28 animate-pulse rounded-full bg-field-hover" />
          <div className="h-4 w-44 animate-pulse rounded-full bg-field-hover" />
          <div className="ms-auto h-4 w-20 animate-pulse rounded-full bg-field-hover" />
        </div>
      ))}
    </div>
  );
}

function Empty({
  search,
  filter,
  stillChecking,
  onShowAll,
}: {
  search: ProspectSearch;
  filter: ProspectFilter;
  stillChecking: number;
  onShowAll: () => void;
}) {
  if (search.status === 'discovering') {
    return <EmptyState icon={LoaderCircle} spin title="מחפש עסקים בגוגל…" body="העסקים יופיעו כאן, וכל אתר ייבדק ויקבל ציון." />;
  }
  if (search.status === 'failed' && search.total === 0) {
    return <EmptyState icon={CircleAlert} title="החיפוש נכשל" body={search.error ?? 'נסו שוב בעוד רגע.'} />;
  }
  if (search.total === 0) {
    return <EmptyState icon={SearchX} title="לא נמצאו עסקים" body="נסו תחום כללי יותר, או אזור גדול יותר." />;
  }
  if (filter === 'targets' && stillChecking > 0) {
    return (
      <EmptyState
        icon={LoaderCircle}
        spin
        title="בודק את האתרים…"
        body={`עוד ${count(stillChecking, NOUNS.site)} בבדיקה. עסקים עם ציון 4-5 יופיעו כאן ברגע שייבדקו.`}
        actions={<Button onClick={onShowAll}>הצגת כל העסקים</Button>}
      />
    );
  }
  return (
    <EmptyState
      icon={SearchX}
      title="אין בחיפוש הזה עסקים עם ציון 4-5"
      body="לכל העסקים כאן יש אתר סביר או טוב. אפשר לראות את כולם, או לנסות תחום או אזור אחר."
      actions={<Button onClick={onShowAll}>הצגת כל העסקים</Button>}
    />
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  actions,
  spin,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  actions?: ReactNode;
  spin?: boolean;
}) {
  return (
    <div className="flex flex-col items-center border-t border-line px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-field text-fg-muted ring-1 ring-line ring-inset">
        <Icon className={cn('size-5', spin && 'animate-spin')} aria-hidden />
      </span>
      <h3 className="mt-4 text-[16px] font-semibold text-balance">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[14px] text-pretty text-fg-muted">{body}</p>
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
