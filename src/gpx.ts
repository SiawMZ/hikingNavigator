import type { Trail } from './types';

const esc = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** A GPX file with the route and one waypoint per junction, for other apps and watches. */
export function toGpx(trail: Trail): string {
  const wpts = trail.junctions
    .map(
      (j, i) =>
        `  <wpt lat="${j.at[1]}" lon="${j.at[0]}"><name>J${i + 1}</name><desc>${esc(j.cue.en)}</desc></wpt>`,
    )
    .join('\n');
  const pts = trail.line
    .map(([lng, lat, ele]) => `      <trkpt lat="${lat}" lon="${lng}"><ele>${ele}</ele></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="KK Trails" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(trail.name.en)}</name><time>${trail.lastChecked}T00:00:00Z</time></metadata>
${wpts}
  <trk>
    <name>${esc(trail.name.en)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadGpx(trail: Trail): void {
  const url = URL.createObjectURL(new Blob([toGpx(trail)], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${trail.id}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}
