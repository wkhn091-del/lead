import { Check, ClipboardPaste, GraduationCap, Play, Plus, Radar, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { appConfig } from '../../config';
import { repository } from '../../data/repository';
import { cn } from '../../lib/cn';
import { formatNumber } from '../../lib/format';
import { nicheCounts } from '../../lib/niche';
import { dueCards, WARM_UP_SIZE } from '../../lib/practice';
import { OUTCOME_META, toneStyle } from '../../lib/stages';
import { callsThisMonth, outcomeBetween } from '../../lib/workflow';
import { useLeadStore } from '../../store/leads';
import { useTraining } from '../../store/training';
import { useUi } from '../../store/ui';
import type { Activity, Lead } from '../../types';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Button } from '../ui/Button';
import { DailyCard } from './DailyCard';

export interface QueueItem {
  lead: Lead;
  /** Position in today's call order, from 1 */
  position: number;
  /** Today's step on this lead, or null while it's still to do */
  outcome: Activity | null;
}

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat(appConfig.locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** "העשירייה היומית": today's randomly drawn calls, worked through with quick actions. */
export function TodayView() {
  const leads = useLeadStore((s) => s.leads);
  const daily = useLeadStore((s) => s.daily);
  const dailyState = useLeadStore((s) => s.dailyState);
  const dailyError = useLeadStore((s) => s.dailyError);
  const loadDaily = useLeadStore((s) => s.loadDaily);

  const items = useMemo<QueueItem[]>(() => {
    if (!daily) return [];
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    return daily.leadIds.flatMap((id, index) => {
      const lead = byId.get(id);
      return lead ? [{ lead, position: index + 1, outcome: outcomeBetween(lead, daily.startsAt, daily.endsAt) }] : [];
    });
  }, [daily, leads]);
  const calls = useMemo(() => callsThisMonth(leads), [leads]);

  if (!daily) {
    return dailyState === 'error' ? (
      <Notice title="לא הצלחנו לטעון את השיחות של היום" body={dailyError ?? 'בדקו את החיבור ונסו שוב.'}>
        <Button onClick={() => void loadDaily()}>
          <RotateCcw className="size-4" aria-hidden />
          לנסות שוב
        </Button>
      </Notice>
    ) : (
      <div aria-busy="true" aria-label="מגרילים את השיחות של היום" className="glass h-56 animate-pulse rounded-[28px]" />
    );
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <TodayHero items={items} quota={daily.quota} date={daily.date} poolSize={daily.poolSize} calls={calls} />
      {items.some((item) => !item.outcome) && <WarmUp items={items} />}
      {items.length === 0 ? <EmptyPool /> : (
        <ol className="flex flex-col gap-3 sm:gap-4" aria-label="השיחות של היום">
          {items.map((item) => (
            <DailyCard key={item.lead.id} item={item} />
          ))}
        </ol>
      )}
    </div>
  );
}

interface HeroProps {
  items: QueueItem[];
  quota: number;
  date: string;
  poolSize: number;
  calls: number;
}

function TodayHero({ items, quota, date, poolSize, calls }: HeroProps) {
  const done = items.filter((item) => item.outcome).length;
  const finished = items.length > 0 && done === items.length;
  const tally = (type: Activity['type']) => items.filter((item) => item.outcome?.type === type).length;
  const target = appConfig.monthlyCallTarget;
  const month = new Intl.DateTimeFormat(appConfig.locale, { month: 'long' }).format(new Date());
  const slots = Array.from({ length: Math.max(quota, items.length) }, (_, i) => items[i] ?? null);

  return (
    <section aria-label="ההתקדמות של היום" className="glass rounded-[28px] px-5 py-6 sm:px-8 sm:py-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-0">
        <div className="min-w-0 lg:pe-10">
          <p className="text-[13px] font-medium text-fg-muted">{dayLabel(date)}</p>
          <p className="mt-3 flex items-baseline gap-3">
            <span className="text-[48px] leading-[0.92] tracking-[-0.04em] tabular-nums [font-weight:540] [font-stretch:86%] sm:text-[60px]">
              <AnimatedNumber value={done} />
              <span className="sr-only">{done}</span>
            </span>
            <span className="text-[17px] text-fg-muted">
              {finished
                ? `מתוך ${items.length}. סיימת את השיחות של היום.`
                : `מתוך ${items.length === 1 ? 'שיחה אחת' : `${items.length} שיחות`} בוצעו`}
            </span>
          </p>

          <div className="mt-6 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
            {slots.map((item, index) => (
              <QuotaSlot key={item?.lead.id ?? `empty-${index}`} item={item} index={index} />
            ))}
          </div>

          <p className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-muted">
            {finished && <Check className="size-4 text-[var(--st-won)]" aria-hidden />}
            <span><b className="font-semibold text-fg tabular-nums">{tally('advanced')}</b> התקדמו</span>
            <span><b className="font-semibold text-fg tabular-nums">{tally('answered')}</b> ענו</span>
            <span><b className="font-semibold text-fg tabular-nums">{tally('no_answer')}</b> ללא מענה</span>
            <span><b className="font-semibold text-fg tabular-nums">{tally('archived')}</b> לא רלוונטיים</span>
          </p>
        </div>

        <div className="min-w-0 lg:border-s lg:border-line lg:ps-10">
          <p className="text-[13px] font-medium text-fg-muted">שיחות ב{month}</p>
          <p className="mt-3 text-[32px] leading-none tracking-[-0.035em] tabular-nums [font-weight:560] [font-stretch:88%] sm:text-[40px]">
            {formatNumber(calls)}
            <span className="text-[17px] tracking-normal text-fg-muted [font-stretch:100%] [font-weight:400]"> מתוך {formatNumber(target)}</span>
          </p>
          <div className="bar-reveal mt-4 h-2 overflow-hidden rounded-full bg-field">
            <span
              className="bar-segment block h-full rounded-full bg-[var(--st-cold)]"
              style={{ width: `${Math.min(100, (calls / target) * 100)}%` }}
            />
          </div>
          <p className="mt-3 text-[13.5px] text-fg-muted">
            {poolSize === 1 ? (
              'ליד אחד שעוד לא דיברנו איתו ממתין במאגר'
            ) : (
              <>
                <span className="font-medium text-fg tabular-nums">{formatNumber(poolSize)}</span> לידים שעוד לא דיברנו איתם ממתינים במאגר
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Before the calls: a few objections to practise, if any are due. When most of the calls left are to one niche,
 * the answers are tailored to it.
 */
function WarmUp({ items }: { items: QueueItem[] }) {
  const deck = useTraining((s) => s.deck);
  const start = useTraining((s) => s.start);
  const practiceNiche = useTraining((s) => s.practiceNiche);
  const setView = useUi((s) => s.setView);
  const due = deck ? dueCards(deck.cards) : [];
  if (!due.length) return null;
  const count = Math.min(due.length, WARM_UP_SIZE);
  const todo = items.filter((item) => !item.outcome);
  const top = nicheCounts(todo.map((item) => item.lead))[0];
  const focus = top && top.count >= 2 && top.count / todo.length >= 0.4 ? top : null;
  return (
    <section aria-label="חימום" className="glass flex flex-col gap-3 rounded-[22px] px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
      <span style={{ color: 'var(--st-zoom)' }} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--st-zoom)_12%,transparent)] max-sm:hidden">
        <GraduationCap className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold">חימום לפני השיחות</p>
        <p className="truncate text-[13px] text-fg-muted">
          {focus ? (
            <>
              {focus.count === todo.length ? 'כל השיחות שנשארו היום הן ל' : `${focus.count} מהשיחות שנשארו היום הן ל`}
              <bdi>{focus.niche}</bdi>, אז התשובות יותאמו להן.
            </>
          ) : (
            <>
              {count === 1 ? 'התנגדות אחת לתרגול: ' : `${count} התנגדויות לתרגול, החל מ: `}
              <span dir="auto">"{due[0].objection}"</span>
            </>
          )}
        </p>
      </div>
      <Button
        onClick={() => {
          setView('training');
          if (focus) void practiceNiche(focus.niche);
          else start('warm-up');
        }}
      >
        <Play className="flip-rtl size-4" aria-hidden />
        תרגול · כ-{Math.max(1, Math.round(count * 0.6))} דק׳
      </Button>
    </section>
  );
}

function QuotaSlot({ item, index }: { item: QueueItem | null; index: number }) {
  if (!item) {
    return <span aria-hidden className="h-11 rounded-xl border border-dashed border-line sm:h-12" />;
  }
  const meta = item.outcome ? OUTCOME_META[item.outcome.type] : null;
  const Icon = meta?.icon;
  return (
    <button
      type="button"
      onClick={() =>
        document.getElementById(`daily-${item.lead.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      aria-label={`${index + 1}. ${item.lead.name}: ${meta?.label ?? 'עוד לא'}`}
      title={`${item.lead.name}: ${meta?.label ?? 'עוד לא'}`}
      style={meta ? toneStyle(meta.tone) : undefined}
      className={cn(
        'flex h-11 items-center justify-center rounded-xl text-[13px] font-semibold tabular-nums transition-[background-color,box-shadow,transform] duration-300 active:scale-95 sm:h-12',
        meta ? 'tone-chip' : 'bg-field text-fg-muted ring-1 ring-line ring-inset hover:bg-field-hover',
      )}
    >
      {Icon ? <Icon className="size-4" strokeWidth={2.25} aria-hidden /> : index + 1}
    </button>
  );
}

function EmptyPool() {
  const setImportOpen = useUi((s) => s.setImportOpen);
  const setAddOpen = useUi((s) => s.setAddOpen);
  const addSampleLeads = useLeadStore((s) => s.addSampleLeads);
  const hasLeads = useLeadStore((s) => s.leads.length > 0);
  const setView = useUi((s) => s.setView);
  return (
    <Notice
      title="אין במאגר לידים שעוד לא דיברנו איתם"
      body="כל הלידים כבר עברו את השיחה הקרה, נסגרו או סומנו כלא רלוונטיים. מצאו עסקים חדשים במאתר הלידים או ייבאו את המקבץ הבא, והשיחות של היום יוגרלו מהם."
    >
      <Button variant="primary" onClick={() => setView('prospector')}>
        <Radar className="size-4" aria-hidden />
        איתור לידים חדשים
      </Button>
      <Button onClick={() => setImportOpen(true)}>
        <ClipboardPaste className="size-4" aria-hidden />
        ייבוא רשימה
      </Button>
      <Button onClick={() => setAddOpen(true)}>
        <Plus className="size-4" aria-hidden />
        ליד חדש
      </Button>
      {repository.kind === 'local' && !hasLeads && (
        <Button variant="ghost" onClick={addSampleLeads}>
          טעינת לידים לדוגמה
        </Button>
      )}
    </Notice>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="glass flex flex-col items-center rounded-[22px] px-6 py-14 text-center">
      <h2 className="text-[17px] font-semibold text-balance">{title}</h2>
      <p className="mt-1.5 max-w-md text-[14px] text-pretty text-fg-muted">{body}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  );
}
