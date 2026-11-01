import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Stand-in business websites for the Prospector tests, each on its own local port (so each is its own domain). */

const year = new Date().getFullYear();

/** A 2012 site: windows-1255, no viewport, nested layout tables, <font>, old WordPress and jQuery */
export const OLD_SITE = `<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=windows-1255">
<meta name="generator" content="WordPress 3.9.2">
<title>מוסך הגליל - תיקוני רכב</title>
<script src="/wp-includes/js/jquery/jquery-1.8.3.min.js"></script>
<link rel="stylesheet" href="/wp-content/themes/old/style.css">
</head><body bgcolor="#ffffff">
<table width="800" cellpadding="0" cellspacing="0" align="center"><tr><td>
<table width="780" cellpadding="4"><tr><td background="/img/bg.gif"><font size="5" color="navy">מוסך הגליל</font></td></tr>
<tr><td><font face="Arial">תיקוני רכב, טסטים ופחחות מאז 1985. שירות מהיר ואמין לכל סוגי הרכבים.</font></td></tr>
<tr><td><font face="Arial">צרו קשר בטלפון 04-6000000 בשעות הפעילות. אנחנו כאן בשבילכם כל השבוע.</font></td></tr></table>
</td></tr></table>
<p align="center">© 2012 כל הזכויות שמורות למוסך הגליל</p>
</body></html>`;

/** A current Next.js site with everything in place */
export const MODERN_SITE = `<!doctype html><html lang="he" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>סטודיו כוח | אימון פונקציונלי</title>
<meta name="description" content="סטודיו לאימון פונקציונלי בקבוצות קטנות.">
<meta property="og:title" content="סטודיו כוח"><link rel="icon" href="/favicon.ico">
<script type="application/ld+json">{"@type":"HealthClub"}</script>
<script src="/_next/static/chunks/main-abc.js" defer></script>
</head><body><div id="__next"><header><nav><a href="/">בית</a><a href="/classes">שיעורים</a></nav></header>
<main><h1>אימונים שמתאימים לחיים שלך</h1><p>אימון פונקציונלי בקבוצות של עד שמונה מתאמנים, עם מאמן צמוד ותוכנית אישית.</p>
<picture><source srcset="/hero.avif" type="image/avif"><img src="/hero.webp" alt=""></picture>
<a href="tel:+972500000000">חייגו</a> <a href="https://wa.me/972500000000">וואטסאפ</a>
<form><input type="tel" name="phone"><button>השאירו פרטים</button></form></main>
<footer><a href="/accessibility">הצהרת נגישות</a> <a href="/privacy">מדיניות פרטיות</a> © ${year} סטודיו כוח</footer></div>
<script id="__NEXT_DATA__" type="application/json">{"page":"/"}</script></body></html>`;

/** A do-it-yourself Wix site: made for phones, but missing the basics */
export const WIX_SITE = `<!doctype html><html lang="he"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="Wix.com Website Builder">
<title>הגינה של רותם</title></head><body>
<img src="https://static.wixstatic.com/media/abc.jpg"><h1>גינון ועיצוב גינות</h1>
<p>אנחנו מתכננים ומקימים גינות פרטיות בצפון כבר עשר שנים, כולל השקיה, דשא וצמחייה עונתית.</p>
<footer>© ${year - 1}</footer></body></html>`;

export const PARKED_PAGE = `<html><head><title>galil-garage.co.il</title></head><body>
<h1>This domain is for sale!</h1><p>Buy this domain today.</p></body></html>`;

export const CHALLENGE_PAGE = `<html><head><title>Just a moment...</title></head><body>
<div id="cf-browser-verification">Checking your browser</div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>`;

/** A page made for phones whose layout still spills past the screen */
export const OVERFLOWING_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>רחב מדי</title></head>
<body style="margin:0"><div style="width:1100px;height:300px;background:#ccd">טבלת מחירים רחבה מדי לטלפון, עם הרבה טקסט שממשיך ומשתרע הרבה מעבר לרוחב המסך של טלפון רגיל</div></body></html>`;

export interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export interface TestSite {
  url: string;
  port: number;
  /** Requests that reached the site, as "METHOD /path" */
  hits: string[];
  close(): Promise<void>;
}

/** One site on its own port. `routes` maps paths to responses; "/" is the homepage. */
export async function startSite(routes: Record<string, Route | ((req: http.IncomingMessage) => Route)>): Promise<TestSite> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const path = (req.url ?? '/').split('?')[0];
    const entry = routes[path];
    const route = typeof entry === 'function' ? entry(req) : entry;
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(route.status ?? 200, { 'content-type': 'text/html; charset=utf-8', ...route.headers });
    res.end(route.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Encodes Hebrew as windows-1255, the way old Israeli sites were saved */
export function windows1255(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0x05d0 && code <= 0x05ea) bytes.push(0xe0 + (code - 0x05d0));
    else if (code < 0x80) bytes.push(code);
    else if (char === '©') bytes.push(0xa9);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

/** A port nothing listens on */
export async function closedPort(): Promise<number> {
  const site = await startSite({});
  await site.close();
  return site.port;
}
