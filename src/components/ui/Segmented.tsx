import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { handleRadioKeys } from '../../lib/a11y';
import { cn } from '../../lib/cn';
import { SPRING } from '../../lib/motion';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** What a screen reader says, when the label is a symbol such as ₪ */
  ariaLabel?: string;
  icon?: LucideIcon;
  tone?: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/** A small radio group with a sliding selection. */
export function Segmented<T extends string>({ label, value, options, onChange, className }: SegmentedProps<T>) {
  const id = useId();
  const values = options.map((option) => option.value);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => handleRadioKeys(event, values, value, onChange)}
      className={cn('flex h-11 rounded-xl bg-field p-1 ring-1 ring-inset ring-line', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel}
            tabIndex={active ? 0 : -1}
            data-value={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[14px] font-medium transition-colors',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-pill`}
                transition={SPRING}
                className="absolute inset-0 rounded-[9px] bg-raised shadow-[0_1px_2px_var(--shadow-soft)] ring-1 ring-line"
              />
            )}
            {Icon && (
              <Icon className="relative size-4" style={option.tone ? { color: option.tone } : undefined} aria-hidden />
            )}
            <span className="relative whitespace-nowrap">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
