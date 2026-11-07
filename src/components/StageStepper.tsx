import { Check } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatDate } from '../lib/format';
import { ARCHIVED_META, PIPELINE, pipelineStatus, STATUS_META, toneStyle, type PipelineStatus } from '../lib/stages';
import type { Activity, Lead } from '../types';

const isCallStep = (step: Activity) => step.type === 'answered' || step.type === 'no_answer' || (step.type === 'advanced' && step.from === 'cold_call');

/**
 * The lead's statuses on the board, from חדש to נסגר / לקוח: where it is now, which ones it went through and
 * when it first got to each. A WhatsApp it was never sent stays unmarked, even once the lead is further on.
 */
export function StageStepper({ lead }: { lead: Lead }) {
  const current = pipelineStatus(lead);
  // The activity is newest first, so the last match is the first time
  const first = (match: (step: Activity) => boolean) => lead.activity.findLast(match)?.at;
  const reached: Record<PipelineStatus, string | null | undefined> = {
    new: lead.createdAt,
    contacted: first(isCallStep) ?? (lead.stage !== 'cold_call' ? null : undefined),
    whatsapp: first((step) => step.type === 'whatsapp'),
    quote: lead.stage === 'cold_call' ? undefined : (first((step) => step.type === 'advanced' && step.to === 'zoom') ?? null),
    client: lead.stage === 'closed' ? (first((step) => step.type === 'advanced' && step.to === 'closed') ?? lead.stageChangedAt) : undefined,
  };
  const position = PIPELINE.indexOf(current);

  return (
    <div>
      <ol className="flex items-start" aria-label="הסטטוס של הליד">
        {PIPELINE.map((status, index) => {
          const meta = STATUS_META[status];
          // A date, or null for a status passed without a date to show; undefined for one not reached
          const when = reached[status];
          const done = when !== undefined;
          const isCurrent = status === current && !lead.archivedAt;
          const next = PIPELINE[index + 1];
          return (
            <li key={status} className="flex flex-1 items-start last:flex-none" aria-current={isCurrent ? 'step' : undefined}>
              <div className="flex w-[3.9rem] shrink-0 flex-col items-center text-center sm:w-[5.25rem]">
                <span
                  style={toneStyle(meta.tone)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full text-[13px] font-semibold transition-colors sm:size-9',
                    done || isCurrent ? 'tone-chip' : 'bg-field text-fg-faint ring-1 ring-line ring-inset',
                    isCurrent && 'ring-2 ring-[var(--tone)] ring-offset-2 ring-offset-[var(--glass-strong)]',
                  )}
                >
                  {done && !isCurrent && index < position ? (
                    <Check className="size-4" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <meta.icon className="size-4" aria-hidden />
                  )}
                </span>
                <span className={cn('mt-2 text-[12px] leading-tight font-medium sm:text-[12.5px]', done || isCurrent ? 'text-fg' : 'text-fg-faint')}>
                  {meta.short}
                </span>
                {when && <span className="mt-0.5 text-[11px] text-fg-faint sm:text-[11.5px]">{formatDate(when)}</span>}
              </div>
              {next && (
                <span
                  aria-hidden
                  className="mt-4 h-0.5 min-w-1 flex-1 rounded-full bg-line-strong sm:mt-[18px]"
                  style={reached[next] !== undefined ? { background: STATUS_META[next].tone, opacity: 0.55 } : undefined}
                />
              )}
            </li>
          );
        })}
      </ol>
      {lead.archivedAt && (
        <p style={toneStyle(ARCHIVED_META.tone)} className="tone-chip mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium">
          <ARCHIVED_META.icon className="size-4 shrink-0" aria-hidden />
          סומן כלא רלוונטי ב-{formatDate(lead.archivedAt)}, בסטטוס {STATUS_META[current].label}. הוא לא יחזור למאגר השיחות היומי.
        </p>
      )}
    </div>
  );
}
