import {
  BellOff,
  BellRing,
  CalendarCheck,
  CalendarClock,
  Check,
  CornerDownLeft,
  GraduationCap,
  Hourglass,
  LoaderCircle,
  PhoneIncoming,
  PhoneMissed,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  TrendingUp,
  VideoOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { FEW_DECIDED, HEALTH_ODDS, dueLabel, type Forecast, type OpenDeal, type Reminder, type ReminderKind } from '../../lib/dashboard';
import { firstYearValue } from '../../lib/deal';
import { currencySymbol, formatMoney, formatPercent, formatRelative } from '../../lib/format';
import { HEALTH } from '../../lib/health';
import { count, fromCount, NOUNS } from '../../lib/hebrew';
import { readLanguage } from '../../lib/language';
import { toneStyle } from '../../lib/stages';
import { useDashboard } from '../../store/dashboard';
import { useTimeline } from '../../store/timeline';
import { useTraining } from '../../store/training';
import { useUi, type ProfileTab } from '../../store/ui';
import type { Currency } from '../../types';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Button } from '../ui/Button';
import { useDashboardData } from './useDashboardData';

/**
 * The dashboard: the money expected in the next 30 days, what needs doing (reminders worked out from the
 * timelines, the deal analyses and the Daily 10), and the open deals in the order to work them.
 */
export function DashboardView() {
  const load = useDashboard((s) => s.load);
  const status = useDashboard((s) => s.status);
  const error = useDashboard((s) => s.error);
  const { now, loaded, deals, forecast, reminders } = useDashboardData();

  // Fresh on every visit, and when coming back to the tab
  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <MoneyPanel forecast={forecast} />
      <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:items-start">
        <RemindersPanel reminders={reminders} now={now} state={loaded ? 'ready' : status === 'error' ? 'error' : 'loading'} error={error} onRetry={() => void load()} />
        <OpenDealsPanel deals={deals} now={now} />
      </div>
    </div>
  );
}

// ---- The money -------------------------------------------------------------------------------------------

interface Segment {
  key: string;
  label: string;
  value: number;
  /** A chart token: --chart-retainers, --chart-renewals, --chart-pipeline (validated for colour-blind separation) */
  color: string;
  caption: string;
}

const CURRENCY_DEALS: Record<Currency, string> = { ILS: 'בעסקאות בשקלים', USD: 'בעסקאות בדולרים' };

/** "דמי הקמה מ-2 עסקאות סגורות, לאחת חסרים סכומים" */
function closedCaption({ deals, unpriced }: Forecast['closedThisMonth']): string {
  if (!deals) return 'עוד לא נסגרו עסקאות החודש';
  if (unpriced === deals) return `${count(deals, NOUNS.deal)}, עוד בלי סכומים`;
  return `דמי הקמה ${fromCount(deals, NOUNS.deal)}${unpriced ? `, ${unpriced === 1 ? 'לאחת' : `ל-${unpriced}`} חסרים סכומים` : ''}`;
}

function MoneyPanel({ forecast: f }: { forecast: Forecast }) {
  const segments: Segment[] = [
    {
      key: 'retainers',
      label: 'ריטיינרים',
      value: f.retainers,
      color: 'var(--chart-retainers)',
      caption: f.retainerClients ? `חודש אחד, ${fromCount(f.retainerClients, NOUNS.client)}` : 'אין עדיין לקוחות בריטיינר',
    },
    {
      key: 'renewals',
      label: 'חידושי דומיין ואחסון',
      value: f.renewalTotal,
      color: 'var(--chart-renewals)',
      caption: f.renewals.length ? `${count(f.renewals.length, NOUNS.renewal)} בחודש הקרוב` : 'אין חידושים בחודש הקרוב',
    },
    {
      key: 'pipeline',
      label: 'עסקאות פתוחות, משוקלל',
      value: f.pipeline,
      color: 'var(--chart-pipeline)',
      caption: f.pipelineDeals
        ? `דמי הקמה ${fromCount(f.pipelineDeals, NOUNS.openDeal)}${f.unpriced ? `, בלי ${f.unpriced === 1 ? 'אחת' : f.unpriced} שעוד אין לה הערכה` : ''}`
        : f.unpriced
          ? `${count(f.unpriced, NOUNS.openDeal)} בלי הערכת שווי עדיין`
          : 'אין עסקאות בשלב פגישת זום',
    },
  ];
  const others = (Object.entries(f.others) as [Currency, number][]).filter(([, value]) => value > 0);
  const oddsLine =
    f.oddsBasis === 'history'
      ? `ואחרת לפי שיעור הסגירה שלך אחרי זום, ${formatPercent(f.baseOdds)}${f.decided < FEW_DECIDED ? ' (בזהירות, כל עוד הוכרעו מעט עסקאות)' : ''}`
      : `ואחרת ${formatPercent(f.baseOdds)}, עד שתוכרע עסקה ראשונה אחרי זום`;

  return (
    <section aria-labelledby="money-heading" className="glass rounded-[28px] px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="money-heading" className="text-[13px] font-medium text-fg-muted">
          צפי הכנסות ל-{f.days} הימים הקרובים
        </h2>
        <p className="text-[12.5px] text-fg-faint">ריטיינרים, חידושים ועסקאות פתוחות</p>
      </div>

      <p className="mt-3">
        {/* The one big number on the page: proportional figures, the currency sign after it as Hebrew writes money */}
        <span aria-hidden className="inline-flex items-start text-[52px] leading-[0.92] tracking-[-0.045em] [font-weight:540] [font-stretch:86%] sm:text-[64px]">
          <AnimatedNumber value={f.total} />
          <span className="ms-[0.08em] mt-[0.12em] text-[0.44em] text-fg-muted [font-weight:500] [font-stretch:100%]">{currencySymbol(f.currency)}</span>
        </span>
        <span className="sr-only">{formatMoney(f.total, f.currency)}</span>
      </p>
      {others.map(([code, value]) => (
        <p key={code} className="mt-1.5 text-[13px] text-fg-muted">
          ועוד <span className="font-medium text-fg tabular-nums">{formatMoney(value, code)}</span> {CURRENCY_DEALS[code]}
        </p>
      ))}

      <MoneyBar segments={segments} total={f.total} currency={f.currency} />

      {/* The legend is also the chart's table: every value is here in text */}
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        {segments.map((segment) => (
          <div key={segment.key} className="flex min-w-0 gap-2.5">
            <span aria-hidden className="mt-[5px] size-2.5 shrink-0 rounded-[3px]" style={{ background: segment.color }} />
            <div className="min-w-0">
              <dt className="text-[13px] text-fg-muted">{segment.label}</dt>
              <dd className="mt-0.5">
                <span className="block text-[17px] leading-tight font-semibold">{formatMoney(segment.value, f.currency)}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-pretty text-fg-faint">{segment.caption}</span>
              </dd>
            </div>
          </div>
        ))}
      </dl>

      <dl className="mt-6 grid grid-cols-2 gap-y-5 border-t border-line pt-5 sm:mt-7 sm:pt-6 md:grid-cols-3">
        <Stat
          label="ריטיינרים פעילים (MRR)"
          value={formatMoney(f.retainers, f.currency)}
          per="לחודש"
          caption={f.retainers ? `${formatMoney(f.retainers * 12, f.currency)} בשנה` : 'עוד אין הכנסה חודשית קבועה'}
          className="pe-4"
        />
        <Stat
          label="נסגר החודש"
          value={formatMoney(f.closedThisMonth.setup, f.currency)}
          caption={closedCaption(f.closedThisMonth)}
          className="border-s border-line ps-4 md:px-6"
        />
        <Stat
          label="שווי העסקאות הפתוחות"
          value={formatMoney(f.pipelineValue, f.currency)}
          caption={f.pipelineDeals ? 'בשנה הראשונה, אם כולן ייסגרו' : 'אין עסקאות פתוחות עם הערכת שווי'}
          className="col-span-2 max-md:border-t max-md:border-line max-md:pt-5 md:col-span-1 md:border-s md:border-line md:ps-6"
        />
      </dl>

      <p className="mt-5 text-[12px] leading-relaxed text-pretty text-fg-faint">
        זה צפי, לא מספר סגור. עסקה פתוחה נספרת לפי הסיכוי שתיסגר: כשיש ניתוח עסקה, לפי אחוז קבוע שהוא הערכה גסה (חמה{' '}
        {formatPercent(HEALTH_ODDS.hot)}, פושרת {formatPercent(HEALTH_ODDS.warm)}, קרה {formatPercent(HEALTH_ODDS.cold)}), {oddsLine}. השווי שלה הוא דמי ההקמה שהמאמן המליץ עליהם, ואם אין המלצה, דמי ההקמה הטיפוסיים בעסקאות שסגרת.
      </p>
    </section>
  );
}

/**
 * Part of a whole: one thin bar, a segment per kind of income, 2px of the surface between them, square where it
 * starts and rounded where it ends. Hovering a segment shows its share; a taller invisible row on top takes the
 * hover, so a 12px bar is still easy to point at, and the tooltips aren't cut off by the bar's reveal.
 */
function MoneyBar({ segments, total, currency }: { segments: Segment[]; total: number; currency: Currency }) {
  const shown = segments.filter((segment) => segment.value > 0);
  if (total <= 0 || !shown.length) {
    return <div aria-hidden className="mt-5 h-3 rounded-e-[4px] bg-field ring-1 ring-line ring-inset" />;
  }
  const grow = (segment: Segment) => ({ flexGrow: segment.value, flexBasis: 0 });
  return (
    <div aria-hidden className="relative mt-5 h-3">
      <div className="chart-reveal flex h-full gap-[2px]">
        {shown.map((segment, index) => (
          <span
            key={segment.key}
            className={cn('bar-segment h-full min-w-[6px]', index === shown.length - 1 && 'rounded-e-[4px]')}
            style={{ ...grow(segment), background: segment.color }}
          />
        ))}
      </div>
      <div className="absolute inset-x-0 -inset-y-2 flex gap-[2px]">
        {shown.map((segment) => (
          <span key={segment.key} className="bar-segment group relative min-w-[6px]" style={grow(segment)}>
            <span className="pointer-events-none absolute bottom-full start-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-lg bg-[var(--glass-strong)] px-2.5 py-1.5 text-[12px] whitespace-nowrap text-fg shadow-[0_6px_20px_-8px_var(--shadow-soft)] ring-1 ring-line group-hover:block rtl:translate-x-1/2">
              {segment.label}: <span className="font-semibold">{formatMoney(segment.value, currency)}</span> · {formatPercent(segment.value / total)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, per, caption, className }: { label: string; value: string; per?: string; caption: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[12.5px] font-medium text-fg-muted">{label}</dt>
      <dd className="mt-1.5">
        <span className="text-[22px] leading-tight tracking-[-0.02em] [font-weight:600] [font-stretch:92%] sm:text-[24px]">{value}</span>
        {per && <span className="ms-1.5 text-[13px] text-fg-muted">{per}</span>}
        <span className="mt-1 block text-[12.5px] leading-snug text-pretty text-fg-faint">{caption}</span>
      </dd>
    </div>
  );
}

// ---- Reminders -------------------------------------------------------------------------------------------

const REMINDER_META: Record<ReminderKind, { icon: LucideIcon; tone: string; tab?: ProfileTab; action: string }> = {
  'follow-up': { icon: CalendarClock, tone: 'var(--st-zoom)', tab: 'coach', action: 'לתוכנית' },
  'no-show': { icon: VideoOff, tone: 'var(--st-no-answer)', tab: 'timeline', action: 'פתיחה' },
  'stale-zoom': { icon: Hourglass, tone: 'var(--st-no-answer)', tab: 'timeline', action: 'פתיחה' },
  answered: { icon: PhoneIncoming, tone: 'var(--st-answered)', tab: 'timeline', action: 'פתיחה' },
  'no-amounts': { icon: ReceiptText, tone: 'var(--st-won)', tab: 'details', action: 'רישום סכומים' },
  renewal: { icon: RefreshCcw, tone: 'var(--st-cold)', tab: 'details', action: 'פתיחה' },
  upsell: { icon: TrendingUp, tone: 'var(--st-won)', tab: 'coach', action: 'פתיחה' },
  'no-answer': { icon: PhoneMissed, tone: 'var(--st-no-answer)', tab: 'timeline', action: 'פתיחה' },
  daily: { icon: CalendarCheck, tone: 'var(--st-cold)', action: 'לשיחות' },
  practice: { icon: GraduationCap, tone: 'var(--st-zoom)', action: 'לתרגול' },
};

/** Reminders shown before "show all" */
const FIRST_REMINDERS = 7;

interface RemindersPanelProps {
  reminders: Reminder[];
  now: number;
  state: 'loading' | 'ready' | 'error';
  error: string | null;
  onRetry: () => void;
}

function RemindersPanel({ reminders, now, state, error, onRetry }: RemindersPanelProps) {
  const [all, setAll] = useState(false);
  const urgent = reminders.filter((reminder) => reminder.urgency === 'now').length;
  const shown = all ? reminders : reminders.slice(0, FIRST_REMINDERS);

  return (
    <section aria-labelledby="reminders-heading" className="glass rounded-[24px] px-4 pt-5 pb-3 sm:px-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="reminders-heading" className="flex items-center gap-2 text-[15px] font-semibold">
          <BellRing className="size-4 self-center text-[var(--st-no-answer)]" aria-hidden />
          מה צריך לעשות
        </h2>
        {state === 'ready' && reminders.length > 0 && (
          <p className="text-[12.5px] text-fg-muted">
            {urgent === reminders.length ? `${urgent} לטיפול עכשיו` : urgent ? `${urgent} עכשיו, מתוך ${reminders.length}` : count(reminders.length, NOUNS.reminder)}
          </p>
        )}
      </div>

      {state === 'loading' ? (
        <div aria-busy="true" aria-label="טוען תזכורות" className="flex flex-col gap-3 py-4">
          {['88%', '72%', '80%'].map((width, index) => (
            <span key={index} className="shimmer block h-3 rounded-full" style={{ width, animationDelay: `${index * 0.15}s` }} />
          ))}
        </div>
      ) : state === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-3 py-4">
          <p className="text-[13.5px] text-fg-muted">
            <span className="font-medium text-danger">לא הצלחנו לטעון את התזכורות.</span> {error}
          </p>
          <Button size="sm" onClick={onRetry}>
            <RotateCcw className="size-4" aria-hidden />
            לנסות שוב
          </Button>
        </div>
      ) : reminders.length === 0 ? (
        <p className="flex items-center gap-2 py-5 text-[14px] text-fg-muted">
          <Check className="size-4 shrink-0 text-[var(--st-won)]" aria-hidden />
          אין כרגע מה להזכיר. כל העסקאות מטופלות.
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-line">
            {shown.map((reminder) => (
              <ReminderRow key={reminder.id} reminder={reminder} now={now} />
            ))}
          </ul>
          {reminders.length > FIRST_REMINDERS && (
            <Button size="sm" variant="ghost" className="-ms-2 my-1" onClick={() => setAll(!all)}>
              {all ? 'פחות' : `עוד ${reminders.length - FIRST_REMINDERS}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function ReminderRow({ reminder, now }: { reminder: Reminder; now: number }) {
  const dismiss = useDashboard((s) => s.dismiss);
  const meta = REMINDER_META[reminder.kind];
  const { lead } = reminder;
  const overdue = reminder.due !== null && reminder.due < now - 86_400_000 / 2 && reminder.kind === 'follow-up';
  const dueToday = reminder.due !== null && dueLabel(reminder.due, now) === 'היום';

  const act = () => {
    const ui = useUi.getState();
    if (lead) ui.openProfile(lead.id, meta.tab);
    else if (reminder.kind === 'daily') ui.setView('today');
    else {
      ui.setView('training');
      useTraining.getState().start('warm-up');
    }
  };

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <span style={toneStyle(meta.tone)} className="tone-chip row-span-2 mt-0.5 flex size-8 items-center justify-center self-start rounded-full sm:row-span-1 sm:self-center">
        <meta.icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-[14.5px] font-semibold">{lead ? <bdi>{lead.name}</bdi> : reminder.label}</span>
          {lead && <span className="text-[12.5px] text-fg-muted">{reminder.label}</span>}
          {reminder.due !== null && (
            <span className={cn('text-[12.5px] font-medium', overdue ? 'text-danger' : dueToday ? 'text-[var(--st-no-answer)]' : 'text-fg-faint')}>
              {dueLabel(reminder.due, now)}
            </span>
          )}
        </p>
        <p dir="auto" className="mt-0.5 text-[13.5px] leading-snug text-pretty text-fg-muted">
          {reminder.detail}
        </p>
      </div>
      <div className="col-start-2 mt-2 flex items-center gap-1 sm:col-start-3 sm:mt-0">
        <Button size="sm" onClick={act}>
          {meta.action}
          <CornerDownLeft className="flip-rtl size-3.5 opacity-60" aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => dismiss(reminder)}
          title={reminder.kind === 'renewal' ? 'החידוש טופל: התזכורת חוזרת בשנה הבאה' : 'להזכיר שוב מחר'}
        >
          <BellOff className="size-4" aria-hidden />
          <span className="max-sm:sr-only">{reminder.kind === 'renewal' ? 'טופל' : 'לא עכשיו'}</span>
        </Button>
      </div>
    </li>
  );
}

// ---- Open deals ------------------------------------------------------------------------------------------

function OpenDealsPanel({ deals, now }: { deals: OpenDeal[]; now: number }) {
  return (
    <section aria-labelledby="deals-heading" className="glass rounded-[24px] px-4 pt-5 pb-3 sm:px-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="deals-heading" className="flex items-center gap-2 text-[15px] font-semibold">
          <Sparkles className="size-4 self-center text-[var(--st-zoom)]" aria-hidden />
          עסקאות פתוחות
        </h2>
        {deals.length > 0 && <p className="text-[12.5px] text-fg-muted">{count(deals.length, NOUNS.openDeal)} בשלב פגישת זום</p>}
      </div>
      {deals.length === 0 ? (
        <p className="py-5 text-[14px] text-pretty text-fg-muted">אין עסקאות בשלב פגישת זום. כשליד קובע זום, הוא מופיע כאן, עם הערכת שווי והצעד הבא.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {deals.map((deal) => (
            <DealRow key={deal.lead.id} deal={deal} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DealRow({ deal, now }: { deal: OpenDeal; now: number }) {
  const coachOn = useTimeline((s) => Boolean(s.features?.coach));
  const analyzing = useTimeline((s) => s.coachRuns[deal.lead.id]?.status === 'running');
  const { lead, estimate, health } = deal;
  const healthMeta = health ? HEALTH[health] : null;
  const idleWarning = deal.idleDays !== null && deal.idleDays >= 5;

  const open = () => useUi.getState().openProfile(lead.id, 'timeline');
  const analyze = () => {
    useUi.getState().openProfile(lead.id, 'coach');
    if (coachOn && !analyzing && (!health || deal.analysisStale)) void useTimeline.getState().runCoach(lead.id, readLanguage());
  };

  return (
    <li className="flex flex-col gap-2 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={open} className="max-w-full truncate text-start text-[14.5px] font-semibold hover:underline hover:decoration-line-strong hover:underline-offset-4">
            <bdi>{lead.name}</bdi>
          </button>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-fg-muted">
            {healthMeta ? (
              <span style={toneStyle(healthMeta.tone)} className="tone-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold">
                <healthMeta.icon className="size-3" strokeWidth={2.25} aria-hidden />
                {healthMeta.label}
              </span>
            ) : (
              <span className="text-fg-faint">עוד לא נותחה</span>
            )}
            {lead.campaign && <bdi className="truncate">{lead.campaign}</bdi>}
            {deal.lastTouch !== null && (
              <span className={cn(idleWarning && 'font-medium text-[var(--st-no-answer)]')}>
                {idleWarning ? `${count(deal.idleDays ?? 0, NOUNS.day)} בלי מגע` : `מגע אחרון ${formatRelative(new Date(deal.lastTouch).toISOString(), now)}`}
              </span>
            )}
          </p>
        </div>
        {estimate && (
          <div className="shrink-0 text-end">
            <p className="text-[16px] leading-tight font-semibold">
              {estimate.basis === 'typical' && <span className="text-fg-muted">~</span>}
              {formatMoney(estimate.setupFee, estimate.currency)}
            </p>
            <p className="mt-0.5 text-[11.5px] text-fg-faint" title={`בשנה הראשונה: ${formatMoney(firstYearValue(estimate), estimate.currency)}`}>
              {estimate.basis === 'ai' ? 'הקמה, לפי המאמן' : 'הקמה טיפוסית'}
            </p>
          </div>
        )}
      </div>
      {deal.nextStep && (
        <p dir="auto" style={toneStyle('var(--st-zoom)')} className="script-line px-3 py-1 text-[13px] leading-snug text-pretty text-fg-muted">
          {deal.nextStep}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <Button size="sm" variant="ghost" className="-ms-2" onClick={analyze} aria-busy={analyzing || undefined}>
          {analyzing ? <LoaderCircle className="size-4 animate-spin text-[var(--st-zoom)]" aria-hidden /> : <Sparkles className="size-4 text-[var(--st-zoom)]" aria-hidden />}
          {analyzing ? 'מנתח…' : !health ? 'ניתוח עסקה' : deal.analysisStale ? 'ניתוח מחדש' : 'הניתוח'}
        </Button>
        {deal.analysisStale && !analyzing && <span className="text-[12px] text-fg-faint">נוספו רשומות מאז הניתוח</span>}
      </div>
    </li>
  );
}
