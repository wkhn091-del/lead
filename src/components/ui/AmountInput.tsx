import { useEffect, useRef, useState } from 'react';
import { useFieldDraft, useSaveOnLeave } from '../../hooks/useSaveOnLeave';
import { cn } from '../../lib/cn';
import { currencySymbol, formatNumber, parseAmount } from '../../lib/format';
import type { Currency } from '../../types';

interface AmountInputProps {
  id: string;
  /** The saved amount, in whole units */
  value: number;
  currency: Currency;
  /** Shown after the currency: "לחודש", "לשנה" */
  per?: string | null;
  autoFocus?: boolean;
  /** Id of the text that says what the amount is for */
  hintId?: string;
  onCommit: (value: number) => void;
  className?: string;
}

/**
 * A whole-number amount that saves on blur or Enter and goes back on Escape, like the other inline fields.
 * Digits are grouped as you type; the currency and how often it is paid sit at the end of the field.
 */
export function AmountInput({ id, value, currency, per, autoFocus, hintId, onCommit, className }: AmountInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const unitId = `${id}-unit`;
  const ref = useRef<HTMLInputElement>(null);
  // Saved when the page is left too, and kept while typed (see InlineInput)
  useSaveOnLeave(ref);
  const kept = useFieldDraft(id, value, (amount) => {
    setDraft(amount);
    if (amount !== value) onCommit(amount);
  });

  return (
    <div
      className={cn(
        'flex h-11 items-center rounded-xl bg-field ring-1 ring-inset ring-line transition-shadow focus-within:ring-2 focus-within:ring-focus hover:ring-line-strong',
        className,
      )}
    >
      <input
        ref={ref}
        id={id}
        autoFocus={autoFocus}
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        placeholder="0"
        value={draft ? formatNumber(draft) : ''}
        aria-describedby={[hintId, unitId].filter(Boolean).join(' ')}
        onChange={(event) => {
          const amount = parseAmount(event.target.value);
          setDraft(amount);
          kept.keep(amount);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          kept.forget();
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          else if (event.key === 'Escape') {
            setDraft(value);
            kept.forget();
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent ps-3.5 text-base font-semibold tabular-nums text-fg outline-none placeholder:font-normal placeholder:text-fg-faint focus-visible:outline-none sm:text-[15px]"
      />
      <span id={unitId} className="shrink-0 pe-3.5 ps-2 text-[13px] whitespace-nowrap text-fg-muted">
        {currencySymbol(currency)}
        {per && <span className="ms-1">{per}</span>}
      </span>
    </div>
  );
}
