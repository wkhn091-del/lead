import { appConfig } from '../config';
import type { Currency } from '../types';

const moneyFormats = new Map<Currency, Intl.NumberFormat>();

function moneyFormat(currency: Currency) {
  let format = moneyFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat(appConfig.locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    moneyFormats.set(currency, format);
  }
  return format;
}

/** "‏14,000 ₪": the shekel after the amount, as Hebrew writes it */
export const formatMoney = (amount: number, currency: Currency) => moneyFormat(currency).format(amount);

export const currencySymbol = (currency: Currency) =>
  moneyFormat(currency)
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value ?? currency;

const numberFormat = new Intl.NumberFormat(appConfig.locale, { maximumFractionDigits: 0 });
export const formatNumber = (value: number) => numberFormat.format(value);

/** Reads typed input such as "14,000" as a whole number, up to 8 digits (what the server takes). Empty input is 0. */
export function parseAmount(input: string): number {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  return digits ? Number(digits) : 0;
}

export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const shortDate = new Intl.DateTimeFormat(appConfig.locale, { month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat(appConfig.locale, { month: 'short', day: 'numeric', year: 'numeric' });
const relative = new Intl.RelativeTimeFormat(appConfig.locale, { numeric: 'auto', style: 'short' });

/** "עכשיו", "לפני 12 דק׳", "לפני שעתיים", "אתמול", "לפני 4 ימים", then a date ("26 באוק׳"). */
export function formatRelative(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) return 'עכשיו';
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) {
    // Calendar days, so last night at 23:00 reads "אתמול" in the morning
    const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY);
    return relative.format(-Math.max(1, days), 'day');
  }
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? shortDate : longDate).format(time);
}

function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "26 באוק׳ 2026" */
export const formatDate = (iso: string) => longDate.format(Date.parse(iso));
