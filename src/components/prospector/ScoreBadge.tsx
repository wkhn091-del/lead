import { CircleSlash, LoaderCircle, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/cn';
import { CHECK_LABEL, isChecking, SCORE_META } from '../../lib/prospects';
import { toneStyle } from '../../lib/stages';
import type { Prospect } from '../../types';

/** The need score as a chip: the number and what it means, or where the check stands */
export function ScoreBadge({ prospect, className }: { prospect: Pick<Prospect, 'analysis'>; className?: string }) {
  const { analysis } = prospect;
  const base = 'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full ps-1 pe-2.5 text-[12.5px] font-medium';

  if (analysis.score !== null) {
    const meta = SCORE_META[analysis.score];
    return (
      <span style={toneStyle(meta.tone)} className={cn('tone-chip', base, className)} title={`ציון צורך ${analysis.score} מתוך 5`}>
        <span className="flex size-5 items-center justify-center rounded-full bg-[var(--tone)] text-[12px] font-semibold text-[var(--canvas)] tabular-nums">
          {analysis.score}
        </span>
        {meta.label}
      </span>
    );
  }
  if (isChecking(prospect)) {
    return (
      <span className={cn(base, 'ps-2 text-fg-muted ring-1 ring-line ring-inset', className)}>
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        {analysis.status === 'pending' ? 'ממתין' : 'בבדיקה'}
      </span>
    );
  }
  const failed = analysis.status === 'failed';
  const Icon = failed ? TriangleAlert : CircleSlash;
  return (
    <span
      className={cn(base, 'ps-2 text-fg-faint ring-1 ring-line ring-inset', className)}
      title={analysis.error ?? analysis.verdict ?? undefined}
    >
      <Icon className="size-3.5" aria-hidden />
      {failed ? CHECK_LABEL.failed : 'בלי ציון'}
    </span>
  );
}
