import type { FetchedPage, FetchFailure } from './net.js';
import type { SiteState } from './types.js';

/**
 * What a business's website link turns out to be before anything is scored: none, a social or directory
 * page, a dead or placeholder site, a site that turned the check away, or a working site.
 * The reasons are shown in the app and quoted in the lead's notes, so they're in Hebrew.
 */

export interface SiteVerdict {
  state: SiteState;
  reason: string;
}

/** "https://www.Arbel.co.il/he?x=1" → "arbel.co.il" (a port other than the standard one stays: "biz.co.il:8080") */
export function domainOf(url: string): string {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).host.toLowerCase();
    return host.replace(/^www\d?\./, '').replace(/\.(?=:|$)/, '');
  } catch {
    return '';
  }
}

/** The listing's link without tracking parameters (utm_source=gmb…), which Google listings often carry */
export function cleanWebsite(url: string): string {
  const text = url.trim();
  if (!text) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_\w+|fbclid|gclid|gbraid|wbraid|y_source|hl|lang|ref)$/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = '';
    const result = parsed.toString();
    return parsed.pathname === '/' && !parsed.search ? result.replace(/\/$/, '') : result;
  } catch {
    return text;
  }
}

interface HostRule {
  test: (host: string, path: string) => boolean;
  reason: string;
  /** A dead link rather than a page elsewhere */
  dead?: boolean;
}

const hostIs = (...domains: string[]) => (host: string) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

/** Links that aren't a website of the business's own */
const NOT_A_WEBSITE: HostRule[] = [
  { test: hostIs('facebook.com', 'fb.com', 'fb.me'), reason: 'האתר הרשום בגוגל הוא רק עמוד פייסבוק' },
  { test: hostIs('instagram.com'), reason: 'האתר הרשום בגוגל הוא רק עמוד אינסטגרם' },
  { test: hostIs('linktr.ee', 'linkin.bio', 'beacons.ai', 'taplink.cc', 'bio.link', 'lnk.bio'), reason: 'האתר הרשום בגוגל הוא רק דף קישורים (Linktree וכדומה)' },
  { test: (host) => host === 'wa.me' || hostIs('whatsapp.com')(host), reason: 'האתר הרשום בגוגל הוא רק קישור לוואטסאפ' },
  { test: hostIs('tiktok.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'twitter.com', 'x.com', 't.me'), reason: 'האתר הרשום בגוגל הוא רק עמוד ברשת חברתית' },
  {
    test: (host, path) => host === 'g.page' || host === 'maps.app.goo.gl' || (host === 'goo.gl' && path.startsWith('/maps')) || (hostIs('google.com', 'google.co.il')(host) && path.startsWith('/maps')),
    reason: 'האתר הרשום בגוגל מפנה רק לפרופיל העסק בגוגל',
  },
  { test: hostIs('business.site'), reason: 'האתר הרשום הוא אתר "גוגל לעסקים", שגוגל סגרה ב-2024', dead: true },
  { test: hostIs('b144.co.il', 'd.co.il', 'easy.co.il', '144.co.il', 'zap.co.il', 'yelp.com', 'tripadvisor.com', 'tripadvisor.co.il'), reason: 'האתר הרשום בגוגל הוא רק דף בספריית עסקים (B144, דפי זהב, איזי וכדומה)' },
  { test: hostIs('wolt.com', '10bis.co.il', 'tenbis.co.il', 'mishloha.co.il'), reason: 'האתר הרשום בגוגל הוא רק דף במערכת הזמנות משלוחים' },
  { test: hostIs('booking.com', 'airbnb.com', 'airbnb.co.il', 'zimmer.co.il', 'zimmeril.com'), reason: 'האתר הרשום בגוגל הוא רק דף באתר הזמנות' },
];

/** A listing link that isn't a site of their own, or null */
export function notAWebsite(url: string): SiteVerdict | null {
  let host = '';
  let path = '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `http://${url.trim()}`);
    host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    path = parsed.pathname.toLowerCase();
  } catch {
    return null;
  }
  const rule = NOT_A_WEBSITE.find((candidate) => candidate.test(host, path));
  return rule ? { state: rule.dead ? 'broken' : 'social', reason: rule.reason } : null;
}

/**
 * A connection that failed, as a verdict, or null when it says nothing about the site (a passing network
 * hiccup, or the check was stopped): those get a retry rather than a score.
 */
export function failureVerdict(failure: FetchFailure): SiteVerdict | null {
  switch (failure.kind) {
    case 'dns':
      return { state: 'broken', reason: 'הדומיין של האתר לא קיים יותר (כנראה פג תוקפו)' };
    case 'refused':
      return { state: 'broken', reason: 'השרת של האתר לא עונה' };
    case 'timeout':
      return { state: 'broken', reason: 'האתר לא נטען גם אחרי 20 שניות' };
    case 'tls':
      return {
        state: 'broken',
        reason:
          failure.code === 'CERT_HAS_EXPIRED'
            ? 'תעודת האבטחה (SSL) של האתר פגה, והדפדפן מציג למבקרים אזהרה במקום האתר'
            : 'תעודת האבטחה (SSL) של האתר לא תקינה, והדפדפן מציג למבקרים אזהרה במקום האתר',
      };
    case 'redirects':
      return { state: 'broken', reason: 'האתר מפנה את עצמו בלולאה ולא נפתח' };
    case 'bad-url':
      return { state: 'broken', reason: 'כתובת האתר שרשומה בגוגל לא תקינה' };
    case 'blocked-address':
      return { state: 'broken', reason: 'כתובת האתר שרשומה בגוגל מפנה לרשת פנימית ולא לאתר ציבורי' };
    default:
      return null;
  }
}

const CHALLENGE =
  /cf-browser-verification|\/cdn-cgi\/challenge-platform|<title>\s*(just a moment|attention required|one moment, please|access denied|ddos-guard)|incapsula incident|sucuri website firewall|_incapsula_resource|captcha-delivery|perimeterx|px-captcha/i;

const PARKED =
  /domain (is|may be) for sale|buy this domain|this domain (name )?(is parked|has been registered)|parked (free|domain)|sedoparking|domain parking|hugedomains|afternic|dan\.com\/|the domain .{0,40} is for sale|הדומיין (הזה )?(למכירה|חונה)|דומיין זה (למכירה|חונה)/i;

const SUSPENDED = /account (has been )?suspended|this account has been suspended|site (has been )?suspended|bandwidth limit exceeded|website (is )?expired|this website is (currently )?unavailable|החשבון הושעה|האתר הושעה/i;

const DEFAULT_PAGE =
  /<title>\s*(welcome to nginx!?|apache2 (ubuntu|debian) default page|test page for the (apache|nginx)|iis windows server|default web site page|index of \/|it works!|plesk|cpanel|web server's default page|site not found)\s*<\/title>/i;

const PLACEHOLDER = /under construction|coming soon|website coming soon|site is being built|האתר (נמצא )?(בבנייה|בהקמה|בשיפוצים)|אתר בבנייה|בקרוב אתר|האתר יעלה בקרוב/i;

const BUILDER_EXPIRED =
  /looks like this domain isn.t connected to a website yet|this site (is|was) (currently )?(unavailable|not published)|this site has expired|website expired|squarespace.{0,40}expired|this page isn.t available|domain (is )?not (yet )?connected/i;

/**
 * A response that shows the site is down, a placeholder, or turned the check away; null for a working page.
 * `text` is the page's visible text.
 */
export function responseVerdict(page: FetchedPage, html: string, text: string): SiteVerdict | null {
  const status = page.status;
  const moved = notAWebsite(page.finalUrl);
  if (moved) return { state: moved.state, reason: page.redirects.length ? `${moved.reason} (האתר מפנה לשם)` : moved.reason };
  const head = html.slice(0, 20_000);
  const challenged =
    String(page.headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge' || CHALLENGE.test(head) || (status === 429 && text.length < 2000);

  if (status === 401) return { state: 'broken', reason: 'האתר נעול בסיסמה, אז מבקרים לא רואים אותו' };
  if (status === 403 || status === 429 || status === 503) {
    if (challenged) return { state: 'blocked', reason: 'האתר חוסם בדיקות אוטומטיות (הגנה מבוטים), אז אי אפשר לבדוק אותו מכאן' };
    if (SUSPENDED.test(head)) return { state: 'broken', reason: 'חשבון האחסון של האתר הושעה' };
    if (status === 503) return { state: 'broken', reason: 'דף הבית מחזיר שגיאת שרת (503)' };
    return { state: 'blocked', reason: `האתר דחה את הבדיקה (שגיאה ${status}), אז אי אפשר לשפוט אותו מכאן` };
  }
  if (status === 404 || status === 410) return { state: 'broken', reason: `דף הבית של האתר לא נמצא (שגיאה ${status})` };
  if (status >= 500) return { state: 'broken', reason: `דף הבית מחזיר שגיאת שרת (${status})` };
  if (status >= 400) return { state: 'broken', reason: `דף הבית מחזיר שגיאה (${status})` };
  if (status < 200 || status >= 300) return { state: 'broken', reason: `האתר עונה בצורה לא תקינה (${status})` };

  if (challenged && text.length < 400) return { state: 'blocked', reason: 'האתר חוסם בדיקות אוטומטיות (הגנה מבוטים), אז אי אפשר לבדוק אותו מכאן' };
  if (DEFAULT_PAGE.test(head)) return { state: 'broken', reason: 'בכתובת יש רק דף ברירת מחדל של השרת, והאתר עצמו לא הוקם' };
  if (BUILDER_EXPIRED.test(head)) return { state: 'broken', reason: 'בונה האתרים מציג שהאתר לא מחובר לדומיין או שפג תוקפו' };
  if (SUSPENDED.test(head) && text.length < 1500) return { state: 'broken', reason: 'חשבון האחסון של האתר הושעה' };
  if (PARKED.test(head) && text.length < 3000) return { state: 'broken', reason: 'הדומיין חונה או מוצע למכירה, ואין בו אתר אמיתי' };
  if (PLACEHOLDER.test(text.slice(0, 600)) && text.length < 1200) return { state: 'broken', reason: 'בכתובת יש רק דף "האתר בבנייה", בלי אתר פעיל' };
  if (text.length < 40 && !/<img|<script|<iframe|<video/i.test(html)) return { state: 'broken', reason: 'דף הבית של האתר ריק' };
  return null;
}
