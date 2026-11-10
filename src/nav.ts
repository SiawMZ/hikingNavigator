// Follows one preset route: progress along it, junction cues and off-route alerts.
// Pure logic with no browser APIs, so it can be tested and reused in a native app.

import { cumulative, haversine, projectOnLine, type LngLat, type Projection } from './geo';

export interface NavConfig {
  /** Further than this from the line counts towards "off route". */
  offRouteM: number;
  /** Closer than this counts as back on the route. */
  backOnM: number;
  /** How many fixes in a row must be off before the alert fires. */
  offFixes: number;
  /** Fixes less accurate than this are ignored. */
  maxAccuracyM: number;
  /** Show the junction cue this far before the junction. */
  cueAheadM: number;
  /** A junction counts as passed this far beyond it. */
  passedM: number;
  /** Within this distance of the end counts as finished. */
  finishM: number;
  /** How far back and ahead of the last position to look for the next one. */
  windowBackM: number;
  windowAheadM: number;
  /**
   * Where the trail runs over the same path twice, walking back further than
   * this from the furthest point reached counts as being on the way back.
   */
  backtrackM: number;
  /** Ignore reading-to-reading jumps larger than this when judging progress. */
  maxStepM: number;
}

// Starting values from the research (GPS under trees is about 13–15 m off).
// Tune them on the trail.
export const DEFAULT_CONFIG: NavConfig = {
  offRouteM: 25,
  backOnM: 15,
  offFixes: 3,
  maxAccuracyM: 30,
  cueAheadM: 40,
  passedM: 15,
  finishM: 20,
  windowBackM: 60,
  windowAheadM: 200,
  backtrackM: 30,
  maxStepM: 40,
};

export interface NavJunction {
  id: string;
  at: LngLat;
}

export interface Fix {
  lng: number;
  lat: number;
  accuracy: number;
}

export type NavEvent =
  | { type: 'joined' }
  | { type: 'cue'; index: number }
  | { type: 'passed'; index: number }
  | { type: 'offroute' }
  | { type: 'backon' }
  | { type: 'finish' };

export interface NavState {
  /** 'approach' until the user first reaches the trail. */
  phase: 'approach' | 'on' | 'finished';
  offRoute: boolean;
  /** True when the last fix was too inaccurate to use. */
  weakGps: boolean;
  along: number;
  remaining: number;
  distToLine: number;
  /** Nearest point on the route. */
  nearest: LngLat | null;
  /** Index of the next junction, or -1. */
  nextJunction: number;
  distToNextJunction: number;
}

export class Navigator {
  readonly total: number;
  readonly junctionAlong: number[];
  private cum: number[];
  private offCount = 0;
  /** Furthest point reached so far. */
  private maxAlong = 0;
  private lastPoint: LngLat | null = null;
  private cued = new Set<number>();
  private passed = new Set<number>();
  private snoozed = false;
  state: NavState;

  constructor(
    private line: LngLat[],
    junctions: NavJunction[],
    private cfg: NavConfig = DEFAULT_CONFIG,
  ) {
    this.cum = cumulative(line);
    this.total = this.cum[this.cum.length - 1];
    this.junctionAlong = junctions.map((j) => projectOnLine(line, this.cum, j.at)!.along);
    this.state = {
      phase: 'approach',
      offRoute: false,
      weakGps: false,
      along: 0,
      remaining: this.total,
      distToLine: Infinity,
      nearest: null,
      nextJunction: junctions.length ? 0 : -1,
      distToNextJunction: junctions.length ? this.junctionAlong[0] : Infinity,
    };
  }

  /** Pause or resume off-route alerts ("I'm detouring"). */
  setSnoozed(on: boolean): void {
    this.snoozed = on;
    if (on) this.offCount = 0;
  }

  update(fix: Fix): NavEvent[] {
    const s = this.state;
    const events: NavEvent[] = [];
    if (s.phase === 'finished') return events;

    s.weakGps = fix.accuracy > this.cfg.maxAccuracyM;
    if (s.weakGps) return events;

    const p: LngLat = [fix.lng, fix.lat];
    // How far the walker moved since the last good reading. Where the trail
    // passes within a few metres of itself, this says which pass they are on.
    const step = this.lastPoint ? Math.min(haversine(this.lastPoint, p), this.cfg.maxStepM) : 0;
    this.lastPoint = p;
    const proj = this.locate(p, step);
    s.distToLine = proj.dist;
    s.nearest = proj.point;

    if (s.phase === 'approach') {
      if (proj.dist > this.cfg.offRouteM) return events;
      s.phase = 'on';
      events.push({ type: 'joined' });
    }

    if (proj.dist <= this.cfg.backOnM) {
      this.offCount = 0;
      if (s.offRoute) {
        s.offRoute = false;
        events.push({ type: 'backon' });
      }
    } else if (proj.dist > this.cfg.offRouteM && !this.snoozed) {
      this.offCount++;
      if (!s.offRoute && this.offCount >= this.cfg.offFixes) {
        s.offRoute = true;
        events.push({ type: 'offroute' });
      }
    }

    // Progress only moves while the user is near the line.
    if (proj.dist <= this.cfg.offRouteM) {
      s.along = proj.along;
      this.maxAlong = Math.max(this.maxAlong, proj.along);
      s.remaining = this.total - proj.along;
    }

    this.junctionAlong.forEach((at, i) => {
      if (this.passed.has(i)) return;
      if (s.along > at + this.cfg.passedM) {
        this.passed.add(i);
        events.push({ type: 'passed', index: i });
      } else if (!this.cued.has(i) && s.along >= at - this.cfg.cueAheadM) {
        this.cued.add(i);
        events.push({ type: 'cue', index: i });
      }
    });

    s.nextJunction = this.junctionAlong.findIndex((_, i) => !this.passed.has(i));
    s.distToNextJunction =
      s.nextJunction < 0 ? Infinity : Math.max(0, this.junctionAlong[s.nextJunction] - s.along);

    if (!s.offRoute && s.remaining <= this.cfg.finishM) {
      s.phase = 'finished';
      events.push({ type: 'finish' });
    }
    return events;
  }

  /**
   * Looks near the last position first, so a loop or an out-and-back trail
   * does not jump to the wrong pass. Falls back to the whole line when the
   * user is not near that stretch (first fix, shortcut, or rejoining).
   */
  private locate(p: LngLat, step: number): Projection {
    const s = this.state;
    if (s.phase !== 'approach') {
      const near = projectOnLine(
        this.line,
        this.cum,
        p,
        s.along - this.cfg.windowBackM,
        s.along + this.cfg.windowAheadM,
        // Where they should be if they kept walking forward.
        s.along + step,
        this.maxAlong - this.cfg.backtrackM,
      );
      if (near && near.dist <= this.cfg.offRouteM) return near;
      const anywhere = projectOnLine(this.line, this.cum, p)!;
      // Accept a jump only when it clearly puts the user back on the route.
      if (anywhere.dist <= this.cfg.backOnM || !near) return anywhere;
      return near;
    }
    return projectOnLine(this.line, this.cum, p)!;
  }
}
