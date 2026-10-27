import type { KeyboardEvent } from 'react';

/** The page reads right to left (Hebrew) */
export const isRtl = (element?: Element | null) =>
  typeof document !== 'undefined' && getComputedStyle(element ?? document.documentElement).direction === 'rtl';

/**
 * Arrow-key navigation for role="radiogroup" with a roving tabindex.
 * Each option needs a matching data-value attribute. In Hebrew the next option is to the left.
 */
export function handleRadioKeys<T extends string>(
  event: KeyboardEvent<HTMLElement>,
  values: readonly T[],
  current: T,
  onChange: (value: T) => void,
) {
  const rtl = isRtl(event.currentTarget);
  const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') || event.key === 'ArrowDown';
  const back = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') || event.key === 'ArrowUp';
  if ((!forward && !back) || values.length === 0) return;
  event.preventDefault();
  const index = Math.max(0, values.indexOf(current));
  const next = values[(index + (forward ? 1 : -1) + values.length) % values.length];
  onChange(next);
  const group = event.currentTarget;
  requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus());
}

export const modKeyLabel =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
