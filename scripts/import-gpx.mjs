// Turns a GPX file from your Suunto into a trail page.
//
//   npm run import-gpx -- padang-t5.gpx --id padang-t5 --hill "Bukit Padang" \
//     --name "Trail 5" --name-ms "Denai 5" --checked 2026-11-15
//
// Waypoints in the GPX become junctions. Put the instruction in the waypoint
// description as "English text | Teks Bahasa Malaysia", and a photo name as
// "[photo:padang-t5/j1.jpg]" at the end if you have one.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trailsDir = join(root, 'public', 'trails');

const R = 6371008.8;
const rad = Math.PI / 180;

function haversine(a, b) {
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function parseGpx(xml) {
  // A recorded workout has <trkpt> points; a planned or exported route has <rtept>.
  const points = [...xml.matchAll(/<(trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(([, , attrs, body]) => ({
    lat: Number(/lat="([^"]+)"/.exec(attrs)?.[1]),
    lng: Number(/lon="([^"]+)"/.exec(attrs)?.[1]),
    ele: Number(/<ele>([^<]+)<\/ele>/.exec(body)?.[1] ?? NaN),
  }));
  const waypoints = [...xml.matchAll(/<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/g)].map(([, attrs, body]) => ({
    lat: Number(/lat="([^"]+)"/.exec(attrs)?.[1]),
    lng: Number(/lon="([^"]+)"/.exec(attrs)?.[1]),
    name: decode(/<name>([\s\S]*?)<\/name>/.exec(body)?.[1] ?? ''),
    desc: decode(/<desc>([\s\S]*?)<\/desc>/.exec(body)?.[1] ?? ''),
  }));
  if (points.length < 2) throw new Error('No track points found in the GPX file.');
  if (points.some((p) => Number.isNaN(p.lat) || Number.isNaN(p.lng))) throw new Error('A track point has no coordinates.');
  return { points, waypoints };
}

/** Drops points closer than 3 m (a standing-still watch) and smooths height over 5 points. */
export function clean(points) {
  const kept = [points[0]];
  for (const p of points.slice(1)) {
    if (haversine(kept[kept.length - 1], p) >= 3) kept.push(p);
  }
  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  const withEle = kept.map((p) => (Number.isNaN(p.ele) ? null : p.ele));
  return kept.map((p, i) => {
    const window = withEle.slice(Math.max(0, i - 2), i + 3).filter((e) => e !== null);
    return { ...p, ele: window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0 };
  });
}

/**
 * Total climb in metres. A rise counts only once the height has gone up more
 * than 2 m from the last low point, so sensor noise is ignored but slow,
 * steady climbs (a fraction of a metre per point) are still counted.
 */
export function totalAscent(heights, threshold = 2) {
  let ascent = 0;
  let low = heights[0];
  let high = heights[0];
  for (const e of heights) {
    if (e > high) high = e;
    if (e < low) {
      // Gone down far enough to start a new climb from here.
      if (high - low >= threshold) ascent += high - low;
      low = e;
      high = e;
    } else if (high - e >= threshold) {
      // Came down from the high point: bank that climb and restart.
      ascent += high - low;
      low = e;
      high = e;
    }
  }
  if (high - low >= threshold) ascent += high - low;
  return ascent;
}

/** Keeps the part of the route between two distances (in metres) along it. */
export function sliceByDistance(line, fromM, toM) {
  let d = 0;
  return line.filter((p, i) => {
    if (i > 0) d += haversine(line[i - 1], p);
    return d >= fromM && d <= toM;
  });
}

export function buildTrail(gpxXml, meta) {
  const { points, waypoints } = parseGpx(gpxXml);
  let line = clean(points);
  if (meta.sliceM) line = sliceByDistance(line, meta.sliceM[0], meta.sliceM[1]);

  let distanceM = 0;
  for (let i = 1; i < line.length; i++) distanceM += haversine(line[i - 1], line[i]);
  const ascentM = totalAscent(line.map((p) => p.ele));
  // Naismith's rule: 5 km/h plus 1 hour per 600 m of climb.
  const minutes = Math.round((distanceM / 5000) * 60 + (ascentM / 600) * 60);

  const junctions = waypoints.map((w, i) => {
    const photo = /\[photo:([^\]]+)\]/.exec(w.desc)?.[1];
    const text = w.desc.replace(/\[photo:[^\]]+\]/, '').trim();
    const [en, ms] = text.split('|').map((s) => s.trim());
    return {
      id: `${meta.id}-j${i + 1}`,
      at: [Number(w.lng.toFixed(6)), Number(w.lat.toFixed(6))],
      cue: { en: en || w.name || `Junction ${i + 1}`, ms: ms || en || w.name || `Simpang ${i + 1}` },
      ...(photo ? { photo } : {}),
    };
  });

  return {
    id: meta.id,
    hill: meta.hill,
    name: { en: meta.name, ms: meta.nameMs ?? meta.name },
    ...(meta.demo ? { demo: true } : {}),
    status: meta.status ?? 'open',
    ...(meta.statusNote ? { statusNote: { en: meta.statusNote, ms: meta.statusNoteMs ?? meta.statusNote } } : {}),
    distanceM: Math.round(distanceM),
    ascentM: Math.round(ascentM),
    minutes,
    start: [Number(line[0].lng.toFixed(6)), Number(line[0].lat.toFixed(6))],
    lastChecked: meta.checked,
    ...(meta.hours ? { hours: meta.hours } : {}),
    line: line.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6)), Math.round(p.ele)]),
    junctions,
  };
}

export function saveTrail(trail) {
  writeFileSync(join(trailsDir, `${trail.id}.json`), JSON.stringify(trail));
  const indexPath = join(trailsDir, 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
  const { line, junctions, lastChecked, hours, statusNote, ...summary } = trail;
  const next = [...index.filter((t) => t.id !== trail.id), summary].sort((a, b) =>
    a.hill === b.hill ? a.name.en.localeCompare(b.name.en, 'en', { numeric: true }) : a.hill.localeCompare(b.hill),
  );
  writeFileSync(indexPath, JSON.stringify(next, null, 2));
}

function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const meta = {
    id: opt('id'),
    hill: opt('hill'),
    name: opt('name'),
    nameMs: opt('name-ms'),
    checked: opt('checked') ?? new Date().toISOString().slice(0, 10),
    status: opt('status'),
    statusNote: opt('status-note'),
    statusNoteMs: opt('status-note-ms'),
    hours: opt('hours'),
    // --slice 0-3130 keeps only that stretch of the route, in metres from its start.
    sliceM: opt('slice')?.split('-').map(Number),
  };
  if (!file || !meta.id || !meta.hill || !meta.name) {
    console.error('Usage: npm run import-gpx -- file.gpx --id padang-t5 --hill "Bukit Padang" --name "Trail 5" [--name-ms ...] [--checked YYYY-MM-DD] [--status open|caution|closed] [--hours "06:00–19:00"]');
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(meta.id)) {
    console.error('--id may only use lower-case letters, digits and dashes.');
    process.exit(1);
  }
  const trail = buildTrail(readFileSync(file, 'utf8'), meta);
  // Junctions kept in data/junctions/<id>.json win over waypoints in the GPX,
  // so re-importing a better recording does not lose them. Each entry is
  // { at: [lng, lat], cue: { en, ms }, photo?: "padang-t5/j1.jpg" }.
  const junctionFile = join(root, 'data', 'junctions', `${meta.id}.json`);
  if (existsSync(junctionFile)) {
    trail.junctions = JSON.parse(readFileSync(junctionFile, 'utf8')).map((j, i) => ({ id: `${meta.id}-j${i + 1}`, ...j }));
    console.log(`Using ${trail.junctions.length} junctions from data/junctions/${meta.id}.json`);
  }
  saveTrail(trail);
  console.log(`Saved ${trail.id}: ${(trail.distanceM / 1000).toFixed(2)} km, +${trail.ascentM} m, ~${trail.minutes} min, ${trail.junctions.length} junctions.`);
  if (!trail.junctions.length) console.log('No waypoints found, so there are no junction cues yet. Mark them on the watch or add <wpt> entries.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
