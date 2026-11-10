// Small geometry helpers. All distances are in metres.

export type LngLat = [number, number];

const R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Flat x/y in metres around an origin. Accurate enough over a few km. */
export function toXY(origin: LngLat, p: LngLat): [number, number] {
  return [
    (p[0] - origin[0]) * RAD * R * Math.cos(origin[1] * RAD),
    (p[1] - origin[1]) * RAD * R,
  ];
}

/** Distance from the start of the line to each point. */
export function cumulative(line: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
  }
  return cum;
}

export interface Projection {
  /** Distance from the point to the line. */
  dist: number;
  /** Distance along the line to the nearest point on it. */
  along: number;
  point: LngLat;
}

/**
 * Nearest point on the line, measured to each segment (not each vertex).
 * `from` and `to` limit the search to a stretch of the line, in metres along it.
 */
export function projectOnLine(
  line: LngLat[],
  cum: number[],
  p: LngLat,
  from = -Infinity,
  to = Infinity,
  prefer?: number,
  floor = -Infinity,
): Projection | null {
  let best: Projection | null = null;
  const all: Projection[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    if (cum[i + 1] < from || cum[i] > to) continue;
    const [ax, ay] = toXY(p, line[i]);
    const [bx, by] = toXY(p, line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    const cand: Projection = {
      dist,
      along: cum[i] + t * (cum[i + 1] - cum[i]),
      point: [
        line[i][0] + t * (line[i + 1][0] - line[i][0]),
        line[i][1] + t * (line[i + 1][1] - line[i][1]),
      ],
    };
    all.push(cand);
    // Strict "<" keeps the earliest segment on a tie, which matters for loops.
    if (!best || dist < best.dist) best = cand;
  }
  if (!best || prefer === undefined) return best;
  // Where the trail passes the same spot twice (out-and-back, crossings),
  // several segments are about equally near. Pick the one closest to `prefer`
  // (the user's last distance along the line), but not one that falls behind
  // `floor`: going that far back means they are on the later pass.
  const rank = (c: Projection) => Math.abs(c.along - prefer) + (c.along >= floor ? 0 : 1e6);
  return all
    .filter((c) => c.dist <= best.dist + TIE_M)
    .reduce((a, b) => (rank(b) < rank(a) ? b : a));
}

/** Candidates within this distance of the nearest one count as equally near. */
const TIE_M = 5;

/** The point at a given distance along the line. */
export function pointAt(line: LngLat[], cum: number[], along: number): LngLat {
  const d = Math.max(0, Math.min(cum[cum.length - 1], along));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const span = cum[i] - cum[i - 1];
  const t = span === 0 ? 0 : (d - cum[i - 1]) / span;
  return [
    line[i - 1][0] + t * (line[i][0] - line[i - 1][0]),
    line[i - 1][1] + t * (line[i][1] - line[i - 1][1]),
  ];
}

/** The part of the line between two distances along it. */
export function sliceLine(line: LngLat[], cum: number[], from: number, to: number): LngLat[] {
  const out: LngLat[] = [pointAt(line, cum, from)];
  for (let i = 0; i < line.length; i++) {
    if (cum[i] > from && cum[i] < to) out.push(line[i]);
  }
  out.push(pointAt(line, cum, to));
  return out;
}

/** Compass bearing from a to b, 0–360, 0 = north. */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x =
    Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Hiking time in minutes: 5 km/h plus 1 hour per 600 m of climb (Naismith's rule). */
export function naismithMinutes(distanceM: number, ascentM: number): number {
  return (distanceM / 5000) * 60 + (ascentM / 600) * 60;
}
