import type { LngLat } from './geo';

/** Text in English and Bahasa Malaysia. */
export interface L {
  en: string;
  ms: string;
}

export type Status = 'open' | 'caution' | 'closed';

export interface Junction {
  id: string;
  at: LngLat;
  /** What to do here, e.g. "Keep left at the big rock". */
  cue: L;
  /** Path under /photos, e.g. "padang-t5/j1.jpg". */
  photo?: string;
}

export interface TrailSummary {
  id: string;
  hill: string;
  name: L;
  /** Demo lines are hidden on the live site. */
  demo?: boolean;
  status: Status;
  distanceM: number;
  ascentM: number;
  /** Estimated walking time in minutes. */
  minutes: number;
  start: LngLat;
}

export interface Trail extends TrailSummary {
  statusNote?: L;
  /** Date the founder last walked it, YYYY-MM-DD. */
  lastChecked: string;
  /** Opening hours, e.g. "06:00–19:00". */
  hours?: string;
  /** Longitude, latitude, elevation in metres. */
  line: [number, number, number][];
  junctions: Junction[];
}
