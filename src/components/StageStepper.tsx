import { Check } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatDate } from '../lib/format';
import { ARCHIVED_META, STAGE_META, toneStyle } from '../lib/stages';
import { STAGES, type Lead } from '../types';

/** The three funnel stages, showing where the lead is and when it got to each one. */
export function StageStepper({ lead }: { lead: Lead }) {
  const current = STAGE_META[lead.stage].step;
  const reachedAt = (stage: Lead['stage']) =>
    stage === 'cold_call' ? lead.createdAt : lead.activity.find((entry) => entry.type === 'advanced' && entry.to === stage)?.at;

  return (
    <div>
      <ol className="flex items-start" aria-label="משפך המכירות">
        {STAGES.map((stage, index) => {
          const meta = STAGE_META[stage];
          const step = meta.step;
          const reached = step <= current;
          const isCurrent = step === current && !lead.archivedAt;
          const when = reached ? reachedAt(stage) : undefined;
          return (
            <li key={stage} className="flex flex-1 items-start last:flex-none" aria-current={isCurrent ? 'step' : undefined}>
              <div className="flex w-[5.5rem] shrink-0 flex-col items-center text-center sm:w-28">
                <span
                  style={toneStyle(meta.tone)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full text-[13px] font-semibold transition-colors',
                    reached ? 'tone-chip' : 'bg-field text-fg-faint ring-1 ring-line ring-inset',
                    isCurrent && 'ring-2 ring-[var(--tone)] ring-offset-2 ring-offset-[var(--glass-strong)]',
                  )}
                >
                  {step < current ? <Check className="size-4" strokeWidth={2.5} aria-hidden /> : <meta.icon className="size-4" aria-hidden />}
                </span>
                <span className={cn('mt-2 text-[12.5px] font-medium leading-tight', reached ? 'text-fg' : 'text-fg-faint')}>
                  {meta.label}
                </span>
                {when && <span className="mt-0.5 text-[11.5px] text-fg-faint">{formatDate(when)}</span>}
              </div>
              {index < STAGES.length - 1 && (
                <span
                  aria-hidden
                  className={cn('mt-[18px] h-0.5 flex-1 rounded-full', step < current ? 'bg-[var(--st-won)]/60' : 'bg-line-strong')}
                  style={step < current ? { background: STAGE_META[STAGES[index + 1]].tone, opacity: 0.55 } : undefined}
                />
              )}
            </li>
          );
        })}
      </ol>
      {lead.archivedAt && (
        <p style={toneStyle(ARCHIVED_META.tone)} className="tone-chip mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium">
          <ARCHIVED_META.icon className="size-4 shrink-0" aria-hidden />
          סומן כלא רלוונטי ב-{formatDate(lead.archivedAt)}, בשלב {STAGE_META[lead.stage].label}. הוא לא יחזור למאגר השיחות היומי.
        </p>
      )}
    </div>
  );
}
