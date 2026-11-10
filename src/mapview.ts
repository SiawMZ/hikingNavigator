import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// The map draws in a background worker. Vite cannot find it on its own, so
// it is named here and shipped with the site.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);
import { cumulative, sliceLine, type LngLat } from './geo';
import type { Trail } from './types';

/** Free vector map built from OpenStreetMap. No key needed. */
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// Extra room at the top for the back button and the alert banner.
const FIT_PADDING = { top: 110, bottom: 40, left: 40, right: 40 };
const ROUTE = '#e8590c';
const WALKED = '#1a1a1a';
const DANGER = '#c92a2a';

type GeoData = Parameters<GeoJSONSource['setData']>[0];

function lineFeature(coords: LngLat[]): GeoData {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
}

const EMPTY: GeoData = { type: 'FeatureCollection', features: [] };

export class TrailMap {
  readonly map: MapLibreMap;
  private line: LngLat[];
  private cum: number[];
  private me: Marker | null = null;
  private heading: number | null = null;
  /** The beam's current CSS angle, which may run past 360. */
  private beamAngle: number | null = null;
  private junctionEls: HTMLElement[] = [];
  private ready: Promise<void>;
  /** Stops following the user once they drag the map. */
  following = true;
  onFollowChange: (following: boolean) => void = () => {};

  constructor(container: HTMLElement, trail: Trail) {
    this.line = trail.line.map(([lng, lat]) => [lng, lat]);
    this.cum = cumulative(this.line);

    const bounds = this.line.reduce(
      (b, p) => b.extend(p),
      new LngLatBounds(this.line[0], this.line[0]),
    );
    this.map = new MapLibreMap({
      container,
      style: STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: FIT_PADDING },
      attributionControl: false,
      // Rotating and tilting confuse more than they help on a small trail map.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new AttributionControl({ compact: true }), 'top-right');

    this.ready = new Promise((resolve) => {
      this.map.on('load', () => {
        this.map.addSource('route', { type: 'geojson', data: lineFeature(this.line) });
        this.map.addSource('walked', { type: 'geojson', data: EMPTY });
        this.map.addSource('rejoin', { type: 'geojson', data: EMPTY });
        const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
        this.map.addLayer({
          id: 'route-casing',
          type: 'line',
          source: 'route',
          layout: round,
          paint: { 'line-color': '#fff', 'line-width': 8 },
        });
        this.map.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: round,
          paint: { 'line-color': ROUTE, 'line-width': 4.5 },
        });
        this.map.addLayer({
          id: 'walked',
          type: 'line',
          source: 'walked',
          layout: round,
          paint: { 'line-color': WALKED, 'line-width': 4.5 },
        });
        this.map.addLayer({
          id: 'rejoin',
          type: 'line',
          source: 'rejoin',
          paint: { 'line-color': DANGER, 'line-width': 3, 'line-dasharray': [1.5, 1.5] },
        });
        resolve();
      });
    });

    const end = (label: string, at: LngLat) => {
      const el = document.createElement('div');
      el.className = 'pin pin-end';
      el.textContent = label;
      new Marker({ element: el }).setLngLat(at).addTo(this.map);
    };
    const first = this.line[0];
    const last = this.line[this.line.length - 1];
    const isLoop = Math.abs(first[0] - last[0]) < 2e-4 && Math.abs(first[1] - last[1]) < 2e-4;
    end(isLoop ? 'A·B' : 'A', first);
    if (!isLoop) end('B', last);

    trail.junctions.forEach((j, i) => {
      const el = document.createElement('div');
      el.className = 'pin pin-junction';
      el.textContent = String(i + 1);
      this.junctionEls.push(el);
      new Marker({ element: el }).setLngLat(j.at).addTo(this.map);
    });

    this.map.on('dragstart', () => this.setFollowing(false));
  }

  setFollowing(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    this.onFollowChange(on);
  }

  /** Highlights the junction the user is coming up to. -1 clears it. */
  setNextJunction(index: number): void {
    this.junctionEls.forEach((el, i) => el.classList.toggle('is-next', i === index));
  }

  setPosition(at: LngLat | null, offRoute = false): void {
    if (!at) {
      this.me?.remove();
      this.me = null;
      return;
    }
    if (!this.me) {
      // The beam sits under the dot, so they are two children of one marker.
      const el = document.createElement('div');
      el.className = 'pin-me';
      el.innerHTML = '<div class="pin-beam"></div><div class="pin-dot"></div>';
      this.me = new Marker({ element: el }).setLngLat(at).addTo(this.map);
      this.setHeading(this.heading);
    }
    this.me.setLngLat(at);
    this.me.getElement().classList.toggle('is-off', offRoute);
    if (this.following) {
      this.map.easeTo({ center: at, zoom: Math.max(this.map.getZoom(), 16), duration: 600 });
    }
  }

  /** Points the beam on the blue dot (0 = north), or hides it with null. */
  setHeading(degrees: number | null): void {
    this.heading = degrees;
    const beam = this.me?.getElement().querySelector<HTMLElement>('.pin-beam');
    if (!beam) return;
    beam.hidden = degrees === null;
    if (degrees === null) {
      this.beamAngle = null;
      return;
    }
    // The map is kept north-up, but allow for a turned map all the same.
    const target = degrees - this.map.getBearing();
    // Keep counting past 360 so the animation turns the short way through north.
    this.beamAngle =
      this.beamAngle === null ? target : this.beamAngle + ((((target - this.beamAngle) % 360) + 540) % 360) - 180;
    beam.style.transform = `translate(-50%, -50%) rotate(${this.beamAngle}deg)`;
  }

  /** Draws the walked part of the route in black. */
  async setProgress(from: number, to: number): Promise<void> {
    await this.ready;
    const data = to - from > 1 ? lineFeature(sliceLine(this.line, this.cum, from, to)) : EMPTY;
    (this.map.getSource('walked') as GeoJSONSource).setData(data);
  }

  /** Dashed red line from the user back to the trail, or null to clear it. */
  async setRejoin(from: LngLat | null, to: LngLat | null): Promise<void> {
    await this.ready;
    const data = from && to ? lineFeature([from, to]) : EMPTY;
    (this.map.getSource('rejoin') as GeoJSONSource).setData(data);
  }

  showAll(): void {
    const bounds = this.line.reduce(
      (b, p) => b.extend(p),
      new LngLatBounds(this.line[0], this.line[0]),
    );
    this.map.fitBounds(bounds, { padding: FIT_PADDING, duration: 400 });
  }

  destroy(): void {
    this.map.remove();
  }
}
