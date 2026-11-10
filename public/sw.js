// Service worker: keeps copies of the site and map tiles so a saved trail
// opens with no signal. Bump VERSION to drop old copies after a big change.

const VERSION = 'v2';
const SITE = `site-${VERSION}`;
const MAP = `map-${VERSION}`;
const MAP_HOST = 'tiles.openfreemap.org';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== SITE && name !== MAP) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'claim') self.clients.claim();
});

/** Network first, falling back to the saved copy. */
async function fresh(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(fallbackKey ?? request, res.clone());
    return res;
  } catch (err) {
    const saved = await cache.match(fallbackKey ?? request, { ignoreSearch: true, ignoreVary: true });
    if (saved) return saved;
    throw err;
  }
}

/** Saved copy first, falling back to the network. */
async function saved(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.host === MAP_HOST) {
    // The style is small and may change; tiles, fonts and icons rarely do.
    event.respondWith(url.pathname.startsWith('/styles/') ? fresh(request, MAP) : saved(request, MAP));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Every page is the same file; the script inside reads the address.
    event.respondWith(fresh(request, SITE, '/'));
    return;
  }
  // Built files have a hash in their name, so a saved copy never goes stale.
  event.respondWith(url.pathname.startsWith('/assets/') ? saved(request, SITE) : fresh(request, SITE));
});
