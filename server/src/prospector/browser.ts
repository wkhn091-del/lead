import type { Browser, HTTPRequest } from 'puppeteer-core';
import { startFilteringProxy, type FilteringProxy } from './proxy.js';

/**
 * The optional headless browser (PROSPECTOR_CHROME_PATH): opens each homepage as a phone would and takes a
 * screenshot for the AI to judge the design, measures load time, and checks whether the page fits a phone's
 * width. It only loads the page: it never clicks, types or submits, every request other than GET/HEAD is
 * stopped, analytics and ad pixels are blocked (the visit doesn't count in their stats), and all traffic goes
 * through a local proxy that refuses private addresses.
 */

export interface RenderResult {
  screenshot: Buffer | null;
  finalUrl: string;
  /** The homepage's HTTP status, when the browser saw one */
  status: number | null;
  /** The layout is wider than the phone: it scrolls sideways or shows the desktop site shrunk */
  mobileOverflow: boolean;
  renderMs: number | null;
  lcpMs: number | null;
  consoleErrors: number;
  title: string;
  text: string;
  /** The page as the browser built it, for the signals when the plain download was blocked or empty */
  html: string;
}

export interface SiteRenderer {
  render(url: string, signal: AbortSignal): Promise<RenderResult>;
  close(): Promise<void>;
}

export interface RendererOptions {
  executablePath: string;
  allowPrivateNetwork: boolean;
  userAgent: string;
  timeoutMs?: number;
  /** The browser closes after this long without work, and starts again when needed */
  idleMs?: number;
}

/** Analytics, ad and session-recording hosts: blocked, so the check leaves no trace in their stats */
const TRACKERS =
  /(^|\.)(google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com|adservice\.google\.\w+|facebook\.net|connect\.facebook\.net|hotjar\.(com|io)|clarity\.ms|analytics\.tiktok\.com|snap\.licdn\.com|taboola\.com|outbrain\.com|criteo\.(com|net)|mc\.yandex\.ru|cdn\.segment\.com|mixpanel\.com|amplitude\.com|bat\.bing\.com|ads\.linkedin\.com|stats\.wp\.com|pixel\.wp\.com)$/i;

/** The phone the page is opened on: an iPhone-sized screen at 1.5x, a small screenshot that's still sharp */
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true };

/** Run in the page after it loads (as a string: the server's TypeScript has no DOM types) */
const MEASURE = `(async () => {
  const nav = performance.getEntriesByType('navigation')[0];
  const lcp = await new Promise((resolve) => {
    let value = null;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) value = entries[entries.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
    setTimeout(() => resolve(value), 120);
  });
  const root = document.documentElement;
  const width = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0);
  return {
    overflow: window.innerWidth > 500 || width > window.innerWidth + 8,
    loadMs: nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd || 0) || null : null,
    lcpMs: typeof lcp === 'number' ? Math.round(lcp) : null,
    title: document.title || '',
    text: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 3000),
  };
})()`;

interface Measured {
  overflow: boolean;
  loadMs: number | null;
  lcpMs: number | null;
  title: string;
  text: string;
}

export function createRenderer(options: RendererOptions): SiteRenderer {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const idleMs = options.idleMs ?? 180_000;
  let starting: Promise<{ browser: Browser; proxy: FilteringProxy }> | null = null;
  let active = 0;
  let idleTimer: NodeJS.Timeout | null = null;

  async function launch() {
    const { default: puppeteer } = await import('puppeteer-core');
    const proxy = await startFilteringProxy(options.allowPrivateNetwork);
    const args = [
      `--proxy-server=http://127.0.0.1:${proxy.port}`,
      // Loopback goes through the proxy too, where it's refused
      '--proxy-bypass-list=<-loopback>',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-features=Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--lang=he-IL',
    ];
    // Chrome won't start its sandbox as root (most containers); everywhere else it keeps it.
    if (process.getuid?.() === 0) args.push('--no-sandbox');
    try {
      const browser = await puppeteer.launch({
        executablePath: options.executablePath,
        headless: true,
        args,
        protocolTimeout: timeoutMs + 10_000,
        // The server shuts the browser down itself (ProspectorEngine.stop); Puppeteer's own signal handlers
        // would keep the process alive after a SIGTERM where nothing else handles it
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      });
      browser.on('disconnected', () => {
        starting = null;
        void proxy.close();
      });
      return { browser, proxy };
    } catch (error) {
      await proxy.close();
      throw error;
    }
  }

  const stopIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  async function shutdown() {
    stopIdleTimer();
    const current = starting;
    starting = null;
    if (!current) return;
    const { browser, proxy } = await current.catch(() => ({ browser: null, proxy: null }));
    await browser?.close().catch(() => {});
    await proxy?.close().catch(() => {});
  }

  function handleRequest(request: HTTPRequest) {
    if (request.isInterceptResolutionHandled()) return;
    const url = request.url();
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // data: and blob: URLs
    }
    const method = request.method();
    const type = request.resourceType();
    const allowedScheme = /^(https?|data|blob):/i.test(url);
    if (!allowedScheme || (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') || type === 'media' || type === 'eventsource' || type === 'ping' || type === 'cspviolationreport' || (host && TRACKERS.test(host))) {
      void request.abort('blockedbyclient').catch(() => {});
      return;
    }
    void request.continue().catch(() => {});
  }

  return {
    async render(url, signal) {
      stopIdleTimer();
      active += 1;
      try {
        starting ??= launch();
        const { browser } = await starting;
        const context = await browser.createBrowserContext();
        const close = () => context.close().catch(() => {});
        signal.addEventListener('abort', close, { once: true });
        const timer = setTimeout(close, timeoutMs + 5000);
        try {
          const page = await context.newPage();
          let consoleErrors = 0;
          page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors += 1;
          });
          page.on('pageerror', () => {
            consoleErrors += 1;
          });
          page.on('dialog', (dialog) => void dialog.dismiss().catch(() => {}));
          page.on('popup', (popup) => void popup?.close().catch(() => {}));
          await page.setBypassServiceWorker(true);
          await page.setViewport(PHONE);
          await page.setUserAgent({ userAgent: options.userAgent });
          await page.setExtraHTTPHeaders({ 'accept-language': 'he-IL,he;q=0.9,en;q=0.6' });
          await page.setRequestInterception(true);
          page.on('request', handleRequest);

          const started = Date.now();
          const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
          // Late images and fonts, so the screenshot shows what a visitor sees
          await page.waitForNetworkIdle({ idleTime: 600, timeout: 3000 }).catch(() => {});
          const measured = (await page.evaluate(MEASURE)) as Measured;
          const screenshot = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 60 }));
          const html = (await page.content().catch(() => '')).slice(0, 1_500_000);
          const result: RenderResult = {
            screenshot,
            finalUrl: page.url(),
            mobileOverflow: measured.overflow,
            renderMs: measured.loadMs ?? Date.now() - started,
            lcpMs: measured.lcpMs,
            consoleErrors,
            title: measured.title,
            text: measured.text,
            html,
            status: response?.status() ?? null,
          };
          return result;
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', close);
          await close();
        }
      } catch (error) {
        // A crashed browser starts fresh next time
        if (error instanceof Error && /Target closed|Session closed|Protocol error|browser has disconnected|Connection closed/i.test(error.message)) {
          await shutdown();
        }
        throw error;
      } finally {
        active -= 1;
        if (active === 0) {
          stopIdleTimer();
          idleTimer = setTimeout(() => void shutdown(), idleMs);
          idleTimer.unref();
        }
      }
    },
    close: shutdown,
  };
}
