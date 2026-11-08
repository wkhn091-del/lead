/**
 * Website addresses as businesses use them, without anything but the URL parser: shared by the server and the app
 * (through leads/identity.ts), so it imports nothing.
 */

/** "https://www.Arbel.co.il/he?x=1" → "arbel.co.il" (a port other than the standard one stays: "biz.co.il:8080") */
export function domainOf(url: string): string {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).host.toLowerCase();
    return host.replace(/^www\d?\./, '').replace(/\.(?=:|$)/, '');
  } catch {
    return '';
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

/**
 * Why a link isn't a website of the business's own (a Facebook page, a directory listing, a dead "business.site"),
 * in Hebrew as the app shows it, or null when it is one
 */
export function notOwnSite(url: string): { reason: string; dead: boolean } | null {
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
  return rule ? { reason: rule.reason, dead: Boolean(rule.dead) } : null;
}
