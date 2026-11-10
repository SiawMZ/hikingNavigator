// Saves a trail for use with no signal. The service worker (public/sw.js)
// keeps a copy of everything fetched here: the page, the trail, its photos
// and the map tiles around it.

import { STYLE_URL } from './mapview';
import type { Trail } from './types';

const MIN_ZOOM = 9;
/** The map source stops at zoom 14; closer zooms are drawn from those tiles. */
const MAX_ZOOM = 14;
const SAVED = 'offline-trails';

export function registerServiceWorker(): void {
  // Only on the built site: in development it would serve stale files.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

export function offlineSupported(): boolean {
  return import.meta.env.PROD && 'serviceWorker' in navigator;
}

export function isSaved(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SAVED) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
}

function markSaved(id: string): void {
  try {
    const ids = new Set<string>(JSON.parse(localStorage.getItem(SAVED) ?? '[]'));
    ids.add(id);
    localStorage.setItem(SAVED, JSON.stringify([...ids]));
  } catch {
    // The files are saved anyway; only the "saved" label is lost.
  }
}

function tileXY(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [
    Math.floor(((lng + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  ];
}

interface Style {
  sprite?: string;
  glyphs?: string;
  sources: Record<string, { type: string; url?: string; tiles?: string[]; maxzoom?: number }>;
  layers: { layout?: { 'text-font'?: unknown } }[];
}

/** Every map file needed to draw the area around the trail. */
async function mapUrls(trail: Trail): Promise<string[]> {
  const urls = [STYLE_URL];
  const style: Style = await (await fetch(STYLE_URL)).json();

  if (style.sprite) {
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) urls.push(style.sprite + suffix);
  }

  if (style.glyphs) {
    const fonts = new Set<string>();
    for (const layer of style.layers) {
      const font = layer.layout?.['text-font'];
      // Fonts set by an expression are skipped; plain lists cover this style.
      if (Array.isArray(font) && font.every((f) => typeof f === 'string')) fonts.add(font.join(','));
    }
    for (const font of fonts) {
      urls.push(style.glyphs.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', '0-255'));
    }
  }

  const lngs = trail.line.map((p) => p[0]);
  const lats = trail.line.map((p) => p[1]);
  // About 500 m of margin around the trail.
  const pad = 0.005;
  const west = Math.min(...lngs) - pad;
  const east = Math.max(...lngs) + pad;
  const south = Math.min(...lats) - pad;
  const north = Math.max(...lats) + pad;

  for (const source of Object.values(style.sources)) {
    let templates = source.tiles;
    if (!templates && source.url) {
      urls.push(source.url);
      templates = ((await (await fetch(source.url)).json()) as { tiles: string[] }).tiles;
    }
    if (!templates?.length) continue;
    const top = Math.min(MAX_ZOOM, source.maxzoom ?? MAX_ZOOM);
    for (let z = Math.min(MIN_ZOOM, top); z <= top; z++) {
      const [x0, y0] = tileXY(west, north, z);
      const [x1, y1] = tileXY(east, south, z);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          urls.push(templates[0].replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
        }
      }
    }
  }
  return urls;
}

export async function saveTrailOffline(trail: Trail): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  // On a first visit the worker is running but not yet in charge of this page.
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      registration.active?.postMessage('claim');
    });
  }

  // Files this page has already loaded (scripts, styles) were fetched before
  // the worker could keep them, so fetch them again.
  const loaded = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((url) => url.startsWith(location.origin));

  const urls = [
    '/',
    '/trails/index.json',
    `/trails/${trail.id}.json`,
    ...loaded,
    ...trail.junctions.filter((j) => j.photo).map((j) => `/photos/${j.photo}`),
    ...(await mapUrls(trail)),
  ];

  const results = await Promise.all(
    [...new Set(urls)].map((url) =>
      fetch(url, { cache: 'reload' }).then(
        (res) => res.ok,
        () => false,
      ),
    ),
  );
  const failed = results.filter((ok) => !ok).length;
  // A few missing map tiles (sea, empty areas) are normal; many means no connection.
  if (failed > results.length / 4) throw new Error(`${failed} of ${results.length} files failed`);
  markSaved(trail.id);
}
