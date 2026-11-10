// Creates a pretend trail so you can try the app before recording a real one.
// It is marked "demo", so the live site hides it. Open it locally, or on the
// live site with ?demo=1 in the address.

import { buildTrail, saveTrail } from './import-gpx.mjs';

const centre = [116.1154, 5.9467];
const M_LAT = 1 / 111195;
const M_LNG = M_LAT / Math.cos((centre[1] * Math.PI) / 180);

// A rough loop about 900 m long with a climb, walked in 10 m steps.
const pts = [];
const N = 90;
for (let i = 0; i <= N; i++) {
  const a = (i / N) * Math.PI * 2;
  const r = 140 + 40 * Math.sin(a * 3);
  pts.push({
    lat: centre[1] + Math.sin(a) * r * 0.8 * M_LAT,
    lng: centre[0] + (Math.cos(a) - 1) * r * M_LNG,
    ele: 60 + 55 * Math.sin(a / 2) ** 2 + 4 * Math.sin(a * 5),
  });
}
const at = (i) => pts[i];
const wpt = (i, name, desc) => `<wpt lat="${at(i).lat}" lon="${at(i).lng}"><name>${name}</name><desc>${desc}</desc></wpt>`;
const gpx = `<gpx version="1.1">
${wpt(22, 'J1', 'Keep left at the fork | Ikut kiri di simpang')}
${wpt(50, 'J2', 'Turn right, away from the wide path | Belok kanan, jauhi laluan lebar')}
${wpt(72, 'J3', 'Go straight on at the crossing | Terus di persilangan')}
<trk><trkseg>${pts.map((p) => `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele></trkpt>`).join('')}</trkseg></trk>
</gpx>`;

const trail = buildTrail(gpx, {
  id: 'demo-loop',
  hill: 'Demo',
  name: 'Demo loop',
  nameMs: 'Laluan demo',
  demo: true,
  checked: new Date().toISOString().slice(0, 10),
  hours: '06:00–19:00',
});
saveTrail(trail);
console.log(`Saved demo-loop: ${trail.distanceM} m, +${trail.ascentM} m, ${trail.junctions.length} junctions.`);
