import { cumulative, pointAt, toXY, type LngLat } from './geo';
import type { Fix } from './nav';

export interface LocationSource {
  stop(): void;
}

export function watchGps(onFix: (fix: Fix) => void, onDenied: () => void): LocationSource {
  const id = navigator.geolocation.watchPosition(
    (pos) =>
      onFix({
        lng: pos.coords.longitude,
        lat: pos.coords.latitude,
        accuracy: pos.coords.accuracy,
      }),
    (err) => {
      // Timeouts and "position unavailable" clear up without help; a refusal does not.
      if (err.code === err.PERMISSION_DENIED) onDenied();
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
  );
  return { stop: () => navigator.geolocation.clearWatch(id) };
}

export type SimMode = 'on' | 'off';

/**
 * A pretend walk along the line, for testing and demos without going outside.
 * Add ?sim=on to a trail address to walk the trail, or ?sim=off to take a
 * wrong turn after the first junction and then come back.
 */
export function simulate(
  line: LngLat[],
  mode: SimMode,
  strayAt: number,
  onFix: (fix: Fix) => void,
): LocationSource {
  const cum = cumulative(line);
  const total = cum[cum.length - 1];
  const STEP_M = 7;
  let along = 0;
  let stray = 0;
  let strayTicks = 0;

  const timer = setInterval(() => {
    const straying = mode === 'off' && along > strayAt + 20 && strayTicks < 26;
    if (straying) {
      strayTicks++;
      // Walk away for 10 ticks, stand for 6, walk back for 10.
      if (strayTicks <= 10) stray += STEP_M;
      else if (strayTicks > 16) stray -= STEP_M;
    } else {
      along = Math.min(total, along + STEP_M);
    }

    const here = pointAt(line, cum, along);
    const ahead = pointAt(line, cum, Math.min(total, along + 5));
    const [dx, dy] = toXY(here, ahead);
    const len = Math.hypot(dx, dy) || 1;
    // Offset to the side of the trail, plus a little GPS-like wobble.
    const side = stray + (Math.random() - 0.5) * 6;
    const metresPerDegLat = 111195;
    const metresPerDegLng = metresPerDegLat * Math.cos((here[1] * Math.PI) / 180);
    onFix({
      lng: here[0] + ((dy / len) * side) / metresPerDegLng,
      lat: here[1] + ((-dx / len) * side) / metresPerDegLat,
      accuracy: 8,
    });
    if (along >= total && !straying) clearInterval(timer);
  }, 350);

  return { stop: () => clearInterval(timer) };
}
