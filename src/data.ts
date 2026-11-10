import type { Trail, TrailSummary } from './types';

/** Demo lines show only in development, or with ?demo=1 in the address. */
export const showDemo =
  import.meta.env.DEV || new URLSearchParams(location.search).has('demo');

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  // A missing file on a single-page host can come back as the HTML page.
  if (!res.headers.get('content-type')?.includes('json')) return null;
  return res.json();
}

export async function loadIndex(): Promise<TrailSummary[]> {
  const all = (await getJson<TrailSummary[]>('/trails/index.json')) ?? [];
  return all.filter((trail) => showDemo || !trail.demo);
}

export function loadTrail(id: string): Promise<Trail | null> {
  // Ids are lower-case letters, digits and dashes; anything else is not a trail.
  if (!/^[a-z0-9-]+$/.test(id)) return Promise.resolve(null);
  return getJson<Trail>(`/trails/${id}.json`);
}
