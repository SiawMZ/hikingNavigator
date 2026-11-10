// Which way the phone is facing, from its compass. Android Chrome gives it
// without asking; an iPhone asks once, and only straight after a tap.

interface IOSOrientationEvent extends DeviceOrientationEvent {
  /** Degrees clockwise from north, iPhone only. */
  webkitCompassHeading?: number;
}

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Call straight from a tap. Resolves false when the user said no. */
export function requestCompass(): Promise<boolean> {
  const request = (DeviceOrientationEvent as unknown as PermissionApi).requestPermission;
  if (typeof request !== 'function') return Promise.resolve(true);
  return request().then(
    (answer) => answer === 'granted',
    () => false,
  );
}

/** Difference from a to b in degrees, -180 to 180, the short way round. */
function turn(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/**
 * Reports the heading in degrees (0 = north) when it changes by 2° or more.
 * Readings are smoothed, because a phone compass jitters by several degrees.
 * Returns a function that stops listening.
 */
export function watchCompass(onHeading: (degrees: number) => void): () => void {
  let smooth: number | null = null;
  let sent: number | null = null;

  const take = (raw: number) => {
    if (Number.isNaN(raw)) return;
    // The compass measures from the top of the phone; turn it for landscape.
    const heading = (raw + (screen.orientation?.angle ?? 0) + 360) % 360;
    smooth = smooth === null ? heading : (smooth + turn(smooth, heading) * 0.25 + 360) % 360;
    if (sent === null || Math.abs(turn(sent, smooth)) >= 2) {
      sent = smooth;
      onHeading(Math.round(smooth));
    }
  };

  const onAbsolute = (e: DeviceOrientationEvent) => {
    if (e.alpha !== null) take(360 - e.alpha);
  };
  const onRelative = (e: DeviceOrientationEvent) => {
    const ios = (e as IOSOrientationEvent).webkitCompassHeading;
    if (typeof ios === 'number') take(ios);
    else if (e.absolute && e.alpha !== null) take(360 - e.alpha);
  };

  // Android Chrome: the "absolute" event is measured from north. Others
  // (iPhone) give a compass heading on the ordinary event.
  const absolute = 'ondeviceorientationabsolute' in window;
  if (absolute) window.addEventListener('deviceorientationabsolute', onAbsolute);
  else window.addEventListener('deviceorientation', onRelative);

  return () => {
    window.removeEventListener('deviceorientationabsolute', onAbsolute);
    window.removeEventListener('deviceorientation', onRelative);
  };
}
