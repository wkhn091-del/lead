import { ArrowRight } from 'lucide-react';
import { Fragment, useMemo, type ReactNode } from 'react';
import { appConfig } from '../../config';
import { cn } from '../../lib/cn';
import { currencySymbol, formatMoney, formatNumber, formatPercent } from '../../lib/format';
import { fromCount, NOUNS } from '../../lib/hebrew';
import { funnelMetrics, type FunnelMetrics, type IncomeStream } from '../../lib/leads';
import { ARCHIVED_META, STAGE_META, toneStyle } from '../../lib/stages';
import { useLeadStore } from '../../store/leads';
import { useUi } from '../../store/ui';
import { STAGES, type Currency, type Stage } from '../../types';
import { AnimatedNumber } from '../ui/AnimatedNumber';

const BASE = appConfig.baseCurrency;

const CAPTION: Record<Stage, string> = {
  cold_call: 'ממתינים לשיחה',
  zoom: 'פגישות שנקבעו',
  closed: 'עסקאות שנחתמו',
};

const CURRENCY_DEALS: Record<Currency, string> = { ILS: 'בעסקאות בשקלים', USD: 'בעסקאות בדולרים' };

/** What the closed deals bring in, by the three ways a web studio is paid, then the funnel that got them there. */
export function FunnelSummary() {
  const leads = useLeadStore((s) => s.leads);
  const m = useMemo(() => funnelMetrics(leads), [leads]);

  return (
    <section aria-label="הכנסות ומשפך" className="glass rounded-[28px] px-5 py-6 sm:px-8 sm:py-8">
      <Income m={m} />
      <div className="mt-7 border-t border-line pt-6 sm:mt-8 sm:pt-7">
        <Funnel m={m} />
      </div>
    </section>
  );
}

interface MetricProps {
  label: string;
  stream: IncomeStream;
  /** How often the amount comes in: "לחודש", "לשנה". None for one-time income. */
  per?: string;
  /** Where the amount comes from, given how many deals pay it in the main currency */
  caption: (deals: number) => ReactNode;
  /** Before any deal pays it */
  empty: string;
  className?: string;
  numberClass: string;
}

/**
 * The setup fees, the monthly retainers (MRR) and the yearly renewals of every closed deal, each with where it
 * comes from. On phones the setup revenue leads and the two recurring totals share the row below it.
 */
function Income({ m }: { m: FunnelMetrics }) {
  const { setup, monthly, yearly } = m.income;

  return (
    <dl className="grid grid-cols-2 gap-y-6 md:grid-cols-3">
      <Metric
        label="הכנסות מהקמה"
        stream={setup}
        caption={(deals) => fromCount(deals, NOUNS.deal)}
        empty={m.counts.closed > 0 ? 'דמי ההקמה עוד לא נרשמו' : 'עדיין אין עסקאות סגורות'}
        className="col-span-2 max-md:border-b max-md:border-line max-md:pb-6 md:col-span-1 md:pe-8"
        numberClass="text-[46px] md:text-[44px] lg:text-[50px]"
      />
      <Metric
        label="ריטיינרים פעילים (MRR)"
        stream={monthly}
        per="לחודש"
        caption={(deals) => (
          <>
            {fromCount(deals, NOUNS.client)},{' '}
            <span className="whitespace-nowrap">{formatMoney((monthly.totals[BASE] ?? 0) * 12, BASE)} בשנה</span>
          </>
        )}
        empty="עדיין אין לקוחות בריטיינר"
        className="pe-4 md:border-s md:border-line md:px-8"
        numberClass="text-[32px] md:text-[44px] lg:text-[50px]"
      />
      <Metric
        label="חידושים שנתיים"
        stream={yearly}
        per="לשנה"
        caption={(deals) => `דומיין ואחסון, ${fromCount(deals, NOUNS.client)}`}
        empty="עדיין אין חידושי דומיין ואחסון"
        className="border-s border-line ps-4 md:ps-8"
        numberClass="text-[32px] md:text-[44px] lg:text-[50px]"
      />
    </dl>
  );
}

function Metric({ label, stream, per, caption, empty, className, numberClass }: MetricProps) {
  const amount = stream.totals[BASE] ?? 0;
  const deals = stream.deals[BASE] ?? 0;
  // Deals in another currency get a line of their own, so no total mixes currencies
  const others = (Object.entries(stream.totals) as [Currency, number][]).filter(([code, value]) => code !== BASE && value > 0);
  const spoken = `${formatMoney(amount, BASE)}${per ? ` ${per}` : ''}`;

  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[13px] font-medium text-fg-muted">{label}</dt>
      <dd className="mt-2.5">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* Amount first, then the currency sign, the way Hebrew writes money */}
          <span
            aria-hidden
            className={cn(
              'inline-flex items-start leading-[0.95] tracking-[-0.04em] tabular-nums [font-weight:540] [font-stretch:86%]',
              numberClass,
            )}
          >
            <AnimatedNumber value={amount} />
            <span className="ms-[0.08em] mt-[0.1em] text-[0.46em] text-fg-muted [font-weight:500] [font-stretch:100%]">
              {currencySymbol(BASE)}
            </span>
          </span>
          {per && (
            <span aria-hidden className="text-[14px] font-medium whitespace-nowrap text-fg-muted">
              {per}
            </span>
          )}
          <span className="sr-only">{spoken}</span>
        </span>
        <span className="mt-2.5 block space-y-0.5 text-[13px] leading-snug text-fg-muted">
          {(deals > 0 || others.length === 0) && <span className="block">{deals > 0 ? caption(deals) : empty}</span>}
          {others.map(([code, value]) => (
            <span key={code} className="block">
              {amount > 0 && 'ועוד '}
              <span className="font-medium text-fg tabular-nums">
                {formatMoney(value, code)}
                {per && ` ${per}`}
              </span>{' '}
              {CURRENCY_DEALS[code]}
            </span>
          ))}
        </span>
      </dd>
    </div>
  );
}

/** From a cold call to a closed deal: how many leads are at each stage, and how many move on. */
function Funnel({ m }: { m: FunnelMetrics }) {
  const setStageFilter = useUi((s) => s.setStageFilter);
  const rates: (number | null)[] = [m.zoomRate, m.closeRate];
  const rateLabels = ['קבעו זום', 'נסגרו אחרי זום'];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-10">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg-muted">משפך</p>
        <ol className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
          {STAGES.map((stage, index) => {
            const meta = STAGE_META[stage];
            return (
              <Fragment key={stage}>
                <li className="min-w-0 sm:flex-1">
                  <button
                    type="button"
                    onClick={() => setStageFilter(stage)}
                    style={toneStyle(meta.tone)}
                    className="group flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-start transition-colors hover:bg-field sm:px-3"
                  >
                    <span className="tone-chip flex size-9 shrink-0 items-center justify-center rounded-full">
                      <meta.icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-fg-muted">{meta.label}</span>
                      <span className="flex items-baseline gap-2">
                        <span className="text-[30px] leading-none tracking-[-0.035em] tabular-nums [font-weight:560] [font-stretch:88%]">
                          {formatNumber(m.counts[stage])}
                        </span>
                        <span className="truncate text-[12.5px] text-fg-faint">{CAPTION[stage]}</span>
                      </span>
                    </span>
                  </button>
                </li>
                {index < STAGES.length - 1 && (
                  <li
                    aria-hidden={rates[index] === null}
                    className="flex items-center gap-2 ps-[3.25rem] text-[12.5px] text-fg-muted sm:flex-col sm:justify-center sm:gap-1 sm:px-2 sm:ps-2 sm:text-center"
                  >
                    <ArrowRight className="size-4 shrink-0 rotate-90 text-fg-faint sm:rotate-0 sm:rtl:-scale-x-100" aria-hidden />
                    <span className={cn('font-semibold tabular-nums', rates[index] === null ? 'text-fg-faint' : 'text-fg')}>
                      {rates[index] === null ? '–' : formatPercent(rates[index] ?? 0)}
                    </span>
                    <span className="sm:max-w-[6rem] sm:leading-tight">{rateLabels[index]}</span>
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
      </div>
      <button
        type="button"
        onClick={() => setStageFilter('archived')}
        className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg px-2 py-1 text-[13px] text-fg-muted hover:bg-field hover:text-fg lg:mb-2 lg:self-end"
      >
        <ARCHIVED_META.icon className="size-4" style={{ color: ARCHIVED_META.tone }} aria-hidden />
        {m.archived === 1 ? (
          'ליד אחד סומן כלא רלוונטי'
        ) : (
          <>
            <span className="font-medium tabular-nums text-fg">{m.archived}</span> סומנו כלא רלוונטיים
          </>
        )}
      </button>
    </div>
  );
}
