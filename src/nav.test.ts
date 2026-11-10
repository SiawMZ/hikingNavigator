import { describe, expect, it } from 'vitest';
import { cumulative, haversine, naismithMinutes, pointAt, projectOnLine, type LngLat } from './geo';
import { Navigator, type Fix, type NavEvent } from './nav';

// 1 degree of latitude is about 111.2 km, so 0.0001 is about 11 m.
const M = 1 / 111195;
const at = (east: number, north: number): LngLat => [116 + (east * M) / Math.cos(6 * (Math.PI / 180)), 6 + north * M];
const fix = (east: number, north: number, accuracy = 8): Fix => {
  const [lng, lat] = at(east, north);
  return { lng, lat, accuracy };
};

// A 400 m line going north, with junctions at 100 m and 250 m.
const line = [at(0, 0), at(0, 200), at(0, 400)];
const junctions = [
  { id: 'j1', at: at(0, 100) },
  { id: 'j2', at: at(0, 250) },
];

function walk(nav: Navigator, fixes: Fix[]): NavEvent[] {
  return fixes.flatMap((f) => nav.update(f));
}

describe('geo', () => {
  it('measures distance and projects onto a segment', () => {
    expect(haversine(at(0, 0), at(0, 400))).toBeCloseTo(400, 0);
    const cum = cumulative(line);
    const p = projectOnLine(line, cum, at(12, 150))!;
    expect(p.dist).toBeCloseTo(12, 0);
    expect(p.along).toBeCloseTo(150, 0);
    expect(haversine(pointAt(line, cum, 150), at(0, 150))).toBeLessThan(0.5);
  });

  it('estimates time with Naismith', () => {
    expect(naismithMinutes(5000, 600)).toBe(120);
  });
});

describe('Navigator', () => {
  it('stays in approach until the user reaches the trail', () => {
    const nav = new Navigator(line, junctions);
    expect(nav.update(fix(300, 0))).toEqual([]);
    expect(nav.state.phase).toBe('approach');
    expect(nav.update(fix(5, 2))).toEqual([{ type: 'joined' }]);
    expect(nav.state.phase).toBe('on');
  });

  it('cues each junction before it, then marks it passed, then finishes', () => {
    const nav = new Navigator(line, junctions);
    const steps = Array.from({ length: 41 }, (_, i) => fix(0, i * 10));
    const events = walk(nav, steps).map((e) => ('index' in e ? `${e.type}${e.index}` : e.type));
    expect(events).toEqual(['joined', 'cue0', 'passed0', 'cue1', 'passed1', 'finish']);
    expect(nav.state.phase).toBe('finished');
  });

  it('alerts only after several fixes off the route, and clears when back', () => {
    const nav = new Navigator(line, junctions);
    walk(nav, [fix(0, 0), fix(0, 20)]);
    expect(walk(nav, [fix(40, 30), fix(45, 40)])).toEqual([]);
    expect(nav.update(fix(50, 50))).toEqual([{ type: 'offroute' }]);
    expect(nav.state.offRoute).toBe(true);
    expect(nav.update(fix(20, 60))).toEqual([]);
    expect(nav.update(fix(5, 60))).toEqual([{ type: 'backon' }]);
  });

  it('ignores a single GPS jump and inaccurate fixes', () => {
    const nav = new Navigator(line, junctions);
    walk(nav, [fix(0, 0), fix(0, 20)]);
    expect(walk(nav, [fix(60, 30), fix(0, 40), fix(60, 50), fix(0, 60)])).toEqual([]);
    expect(walk(nav, [fix(80, 70, 50), fix(80, 80, 50), fix(80, 90, 50)])).toEqual([]);
    expect(nav.state.weakGps).toBe(true);
    expect(nav.state.offRoute).toBe(false);
  });

  it('does not alert while snoozed', () => {
    const nav = new Navigator(line, junctions);
    walk(nav, [fix(0, 0)]);
    nav.setSnoozed(true);
    expect(walk(nav, [fix(50, 10), fix(50, 20), fix(50, 30), fix(50, 40)])).toEqual([]);
  });

  it('keeps progress on the first pass of an out-and-back trail', () => {
    // Up 200 m and back down the same path.
    const outAndBack = [at(0, 0), at(0, 200), at(0, 0)];
    const nav = new Navigator(outAndBack, []);
    walk(nav, [fix(0, 0), fix(0, 50), fix(0, 100)]);
    expect(nav.state.along).toBeCloseTo(100, 0);
    // Standing still with GPS jitter must not flip to the way back.
    walk(nav, [fix(2, 98), fix(-2, 101)]);
    expect(nav.state.along).toBeCloseTo(101, 0);
    // Stepping back a few metres (for a photo) is still the way up.
    walk(nav, [fix(0, 90)]);
    expect(nav.state.along).toBeCloseTo(90, 0);
    // Turning round 5 m short of the top: moving away again means the way back.
    walk(nav, [fix(0, 150), fix(0, 195), fix(1, 185)]);
    expect(nav.state.along).toBeCloseTo(215, 0);
    walk(nav, [fix(1, 150)]);
    expect(nav.state.along).toBeCloseTo(250, 0);
    walk(nav, [fix(-1, 100), fix(0, 60)]);
    expect(nav.state.along).toBeCloseTo(340, 0);
    expect(nav.state.phase).toBe('on');
  });
});

describe('real trail: padang-summit', () => {
  // Fixed pseudo-random wobble, so the test gives the same result every run.
  function wobble(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296 - 0.5;
    };
  }

  it.each([1, 2, 3, 4, 5])('walks from the start to the top with GPS wobble (seed %i)', async (seed) => {
    const { readFileSync } = await import('node:fs');
    const trail = JSON.parse(readFileSync('public/trails/padang-summit.json', 'utf8'));
    const route: LngLat[] = trail.line.map((p: number[]) => [p[0], p[1]]);
    const nav = new Navigator(route, trail.junctions);
    const rand = wobble(seed);
    const cum = cumulative(route);
    const events: string[] = [];

    for (let d = 0; d <= nav.total; d += 7) {
      const p = pointAt(route, cum, d);
      // Up to ±6 m of sideways and forward error, like GPS under trees.
      const f: Fix = { lng: p[0] + (rand() * 12 * M) / Math.cos(0.104), lat: p[1] + rand() * 12 * M, accuracy: 10 };
      for (const e of nav.update(f)) events.push('index' in e ? `${e.type}${e.index}` : e.type);
    }
    // One last reading exactly at the end.
    for (const e of nav.update({ lng: route.at(-1)![0], lat: route.at(-1)![1], accuracy: 8 })) events.push(e.type);

    expect(nav.state.phase).toBe('finished');
    expect(events.filter((e) => e.startsWith('cue'))).toEqual(['cue0', 'cue1', 'cue2', 'cue3', 'cue4', 'cue5']);
    expect(events).not.toContain('offroute');
    expect(events.at(-1)).toBe('finish');
  });
});
