import type { Currency } from './types';

/** App-wide settings. Change these to rebrand or localize the CRM. */
export const appConfig = {
  brand: { name: 'עומק', product: 'לידים' },
  /** Locale for numbers and dates: Hebrew, with Israeli dates, a 24-hour clock and the shekel after the amount */
  locale: 'he-IL',
  /** Currency for the headline totals. Deals in other currencies are listed beside them. */
  baseCurrency: 'ILS' as Currency,
  /** Calling code added to local numbers for click-to-call and WhatsApp links */
  defaultCountryCode: '972',
  /** Leads drawn into each day's queue when leads are kept in this browser (the server has DAILY_QUOTA) */
  dailyQuota: 10,
  /** Calls you aim to make each month, shown on the Today view */
  monthlyCallTarget: 200,
  /** How long a deleted lead can be restored before the delete reaches storage */
  undoWindowMs: 5000,
  /** REST API base URL. Leave unset to keep leads in this browser. */
  apiUrl: import.meta.env.VITE_API_URL?.trim() || undefined,
  /** The app connected to the server, where a build without one (the preview) points to */
  liveUrl: 'https://omek-leads.vercel.app',
} as const;
