/**
 * Keeps the app opening on a phone with no signal, or while the server is still waking up: the page and its
 * scripts, styles, fonts and icons are kept in this browser's cache.
 *
 * Only the app itself is cached. Requests to /api always go to the server and are never stored here: the leads
 * live on the server, and what is written without a connection waits in the app's own queue (src/store/sync.ts)
 * until it can be sent.
 */

const CACHE = 'omek-app-v1';
/** Files outside /assets that the app needs to open */
const STATIC = ['/', '/theme-init.js', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
/** How long the page waits for the network before opening from the cache */
const PAGE_TIMEOUT_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // One missing file shouldn't stop the rest from being kept
      await Promise.all(STATIC.map((path) => cache.add(path).catch(() => undefined)));
      const page = await cache.match('/');
      if (page) await keepBuild(cache, await page.text());
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The API is never answered from here
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') event.respondWith(openPage(event));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(fromCacheFirst(request));
  else if (STATIC.includes(url.pathname)) event.respondWith(fromCacheThenUpdate(event));
});

/**
 * The page: from the network when it answers in time, so a new version shows at once; otherwise from the cache.
 * A late answer still updates the cache for next time.
 */
async function openPage(event) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(async (response) => {
    if (response.ok && (response.headers.get('content-type') ?? '').includes('text/html')) {
      await cache.put('/', response.clone());
      event.waitUntil(response.clone().text().then((html) => keepBuild(cache, html)).catch(() => undefined));
    }
    return response;
  });
  event.waitUntil(network.catch(() => undefined));
  const cached = await cache.match('/');
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), PAGE_TIMEOUT_MS));
  try {
    return (await Promise.race([network, timeout])) ?? cached;
  } catch {
    return cached;
  }
}

/** Built files have the content's hash in their name, so a kept copy is always right */
async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** Icons and the theme script: the kept copy at once, refreshed in the background */
async function fromCacheThenUpdate(event) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(event.request);
  const update = fetch(event.request).then(async (response) => {
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  });
  if (kept) {
    event.waitUntil(update.catch(() => undefined));
    return kept;
  }
  return update;
}

/**
 * Keeps the scripts and styles of the build this page loads (fetching any not kept yet), and the fonts its styles
 * use, and lets go of earlier builds' files.
 */
async function keepBuild(cache, html) {
  const fromPage = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  if (!fromPage.length) return;
  const keep = new Set(fromPage);
  for (const path of fromPage) {
    let response = await cache.match(path);
    if (!response) {
      response = await fetch(path).catch(() => null);
      if (!response || !response.ok) continue;
      await cache.put(path, response.clone());
    }
    if (path.endsWith('.css')) {
      const css = await response.text();
      for (const match of css.matchAll(/url\((\/assets\/[^)\s"']+)\)/g)) keep.add(match[1]);
    }
  }
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/assets/') && !keep.has(pathname)) await cache.delete(request);
  }
}
