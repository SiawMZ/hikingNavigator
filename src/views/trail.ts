import { loadTrail } from '../data';
import { fill, h } from '../dom';
import { requestCompass, watchCompass } from '../compass';
import { bearing, haversine, type LngLat } from '../geo';
import { downloadGpx } from '../gpx';
import { formatDistance, formatMinutes, t, tr, type StringKey } from '../i18n';
import { simulate, watchGps, type LocationSource, type SimMode } from '../location';
import { TrailMap } from '../mapview';
import { DEFAULT_CONFIG, Navigator, type Fix } from '../nav';
import { isSaved, offlineSupported, saveTrailOffline } from '../offline';
import { track } from '../track';
import type { Junction, Trail } from '../types';
import { langToggle, statusChip } from './list';

const SNOOZE_MS = 10 * 60 * 1000;

interface Session {
  nav: Navigator;
  source: LocationSource;
  startedAt: number;
  /** True when walking the trail backwards to the start. */
  reverse: boolean;
  /** Junctions in walking order, with their number on the map. */
  junctions: { junction: Junction; mapIndex: number }[];
  lastFix: Fix | null;
  snoozeTimer: number | null;
  wakeLock: WakeLockSentinel | null;
  stopCompass: () => void;
}

function elevationProfile(trail: Trail): HTMLElement {
  const eles = trail.line.map((p) => p[2]);
  const min = Math.min(...eles);
  const max = Math.max(...eles);
  const W = 300;
  const H = 56;
  const span = Math.max(1, max - min);
  const points = eles
    .map((e, i) => `${((i / (eles.length - 1)) * W).toFixed(1)},${(H - 4 - ((e - min) / span) * (H - 8)).toFixed(1)}`)
    .join(' ');
  const wrap = h('div', { class: 'profile' });
  // The numbers come from the trail file, so building the SVG as text is safe.
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,${H} ${points} ${W},${H}" class="profile-fill" />
    <polyline points="${points}" class="profile-line" />
  </svg>`;
  wrap.append(h('div', { class: 'profile-range' }, h('span', {}, `${Math.round(min)} m`), h('span', {}, `${Math.round(max)} m`)));
  return wrap;
}

export async function trailView(root: HTMLElement, id: string, rerender: () => void): Promise<() => void> {
  let trail: Trail | null;
  try {
    trail = await loadTrail(id);
  } catch {
    trail = null;
    root.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'notice' }, t('loadFailed')), h('a', { href: '/' }, t('allTrails'))));
    return () => {};
  }
  if (!trail) {
    root.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'notice' }, t('notFound')), h('a', { href: '/' }, t('allTrails'))));
    return () => {};
  }
  const tl = trail;
  const line: LngLat[] = tl.line.map(([lng, lat]) => [lng, lat]);
  const simMode = new URLSearchParams(location.search).get('sim') as SimMode | null;

  const mapEl = h('div', { class: 'map' });
  const banner = h('div', { class: 'banner', role: 'status', hidden: true });
  const sheet = h('section', { class: 'sheet' });
  const recentre = h('button', { class: 'map-btn recentre', hidden: true, onclick: () => map.setFollowing(true) }, t('recentre'));
  const helpDialog = h('dialog', { class: 'help' });
  root.replaceChildren(
    h(
      'div',
      { class: 'trail-page' },
      h('div', { class: 'map-wrap' }, mapEl, h('a', { class: 'map-btn back', href: '/' }, `← ${t('allTrails')}`), recentre, banner),
      sheet,
      helpDialog,
    ),
  );

  const map = new TrailMap(mapEl, tl);
  map.onFollowChange = (following) => {
    recentre.hidden = following || !session;
  };
  track('open', tl.id);

  let session: Session | null = null;
  let audio: AudioContext | null = null;

  function setBanner(kind: 'danger' | 'warn' | 'info' | null, text = ''): void {
    banner.hidden = kind === null;
    banner.className = `banner banner-${kind}`;
    banner.textContent = text;
  }

  function beep(frequency: number, times: number): void {
    if (!audio) return;
    for (let i = 0; i < times; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = frequency;
      gain.gain.value = 0.25;
      osc.connect(gain).connect(audio.destination);
      const at = audio.currentTime + i * 0.3;
      osc.start(at);
      osc.stop(at + 0.18);
    }
  }

  // ---------- Before starting: trail details ----------

  function renderInfo(): void {
    map.setFollowing(false);
    recentre.hidden = true;
    setBanner(tl.demo ? 'info' : null, tl.demo ? t('demoWarning') : '');

    const saveBtn = h(
      'button',
      {
        class: 'btn',
        onclick: async () => {
          saveBtn.disabled = true;
          saveBtn.textContent = t('saving');
          try {
            await saveTrailOffline(tl);
            saveBtn.textContent = `✓ ${t('saved')}`;
            track('offline', tl.id);
          } catch {
            saveBtn.disabled = false;
            saveBtn.textContent = t('saveFailed');
          }
        },
      },
      isSaved(tl.id) ? `✓ ${t('saved')}` : t('saveOffline'),
    );

    const stat = (label: StringKey, value: string) =>
      h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'label' }, t(label)));

    sheet.className = 'sheet sheet-info';
    fill(
      sheet,
      h('div', { class: 'sheet-head' }, h('span', { class: 'label' }, tl.hill), langToggle(rerender)),
      h('h1', {}, tr(tl.name)),
      h('p', { class: 'status-line' }, statusChip(tl.status), tl.statusNote ? h('span', {}, tr(tl.statusNote)) : null),
      h(
        'div',
        { class: 'stats' },
        stat('distance', formatDistance(tl.distanceM)),
        stat('climb', `${Math.round(tl.ascentM)} m`),
        stat('time', formatMinutes(tl.minutes)),
      ),
      elevationProfile(tl),
      h(
        'button',
        { class: 'btn btn-primary', disabled: tl.status === 'closed', onclick: () => start(false) },
        tl.status === 'closed' ? t('closed') : t('start'),
      ),
      h(
        'div',
        { class: 'actions' },
        offlineSupported() ? saveBtn : null,
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              downloadGpx(tl);
              track('gpx', tl.id);
            },
          },
          t('gpx'),
        ),
        h(
          'a',
          {
            class: 'btn',
            target: '_blank',
            rel: 'noopener',
            href: `https://www.google.com/maps/dir/?api=1&destination=${tl.start[1]},${tl.start[0]}`,
          },
          t('directions'),
        ),
      ),
      h(
        'dl',
        { class: 'facts' },
        h('dt', {}, t('lastChecked')),
        h('dd', {}, tl.lastChecked),
        tl.hours ? h('dt', {}, t('hours')) : null,
        tl.hours ? h('dd', {}, tl.hours) : null,
      ),
      tl.junctions.length
        ? h(
            'section',
            { class: 'junction-list' },
            h('h2', { class: 'label' }, `${t('junctions')} (${tl.junctions.length})`),
            h(
              'ol',
              {},
              ...tl.junctions.map((j, i) =>
                h(
                  'li',
                  {},
                  h('span', { class: 'pin pin-junction' }, String(i + 1)),
                  h('span', { class: 'junction-cue' }, tr(j.cue)),
                  j.photo ? h('img', { src: `/photos/${j.photo}`, alt: '', loading: 'lazy' }) : null,
                ),
              ),
            ),
          )
        : null,
      h('p', { class: 'fine' }, t('disclaimer')),
    );
  }

  // ---------- While walking ----------

  const navEls = {
    headline: h('p', { class: 'nav-headline' }),
    sub: h('p', { class: 'nav-sub' }),
    cue: h('div', { class: 'cue' }),
    detour: h('button', { class: 'btn' }),
  };
  /** Which junction the cue card shows, so the photo is not rebuilt on every fix. */
  let shownCue = -2;

  function renderNav(): void {
    const s = session!;
    shownCue = -2;
    navEls.cue.replaceChildren();
    navEls.detour.textContent = t('detour');
    navEls.detour.onclick = toggleSnooze;
    sheet.className = 'sheet sheet-nav';
    sheet.replaceChildren(
      h('div', { class: 'nav-top' }, h('div', {}, navEls.headline, navEls.sub)),
      navEls.cue,
      h(
        'div',
        { class: 'actions' },
        s.reverse ? null : h('button', { class: 'btn', onclick: () => start(true) }, t('takeMeBack')),
        navEls.detour,
        h('button', { class: 'btn', onclick: openHelp }, t('help')),
        h('button', { class: 'btn btn-stop', onclick: stop }, t('stop')),
      ),
      h('p', { class: 'fine' }, t('keepOpen')),
    );
    updateNav();
  }

  function updateNav(): void {
    const s = session;
    if (!s) return;
    const st = s.nav.state;
    const me: LngLat | null = s.lastFix ? [s.lastFix.lng, s.lastFix.lat] : null;

    if (!s.lastFix) {
      navEls.headline.textContent = t('waitingGps');
      navEls.sub.textContent = '';
    } else if (st.phase === 'approach') {
      navEls.headline.textContent = t('fromStart', { m: formatDistance(st.distToLine) });
      navEls.sub.textContent = st.weakGps ? t('weakGps') : '';
    } else {
      navEls.headline.textContent = `${formatDistance(st.remaining)} · ${formatMinutes((tl.minutes * st.remaining) / s.nav.total)}`;
      navEls.sub.textContent = s.reverse ? t('goingBack') : t('remaining');
    }

    if (st.offRoute) {
      setBanner('danger', `${t('offRoute')}. ${t('offRouteHelp', { m: Math.round(st.distToLine) })}`);
    } else if (st.weakGps) {
      setBanner('warn', t('weakGps'));
    } else {
      setBanner(tl.demo ? 'info' : null, tl.demo ? t('demoWarning') : '');
    }
    void map.setRejoin(st.offRoute ? me : null, st.offRoute ? st.nearest : null);
    map.setPosition(me, st.offRoute);
    void map.setProgress(0, s.reverse ? 0 : st.along);

    const next = st.phase === 'on' ? st.nextJunction : -1;
    map.setNextJunction(next >= 0 ? s.junctions[next].mapIndex : -1);
    if (st.phase !== 'on') {
      navEls.cue.hidden = true;
      return;
    }
    navEls.cue.hidden = false;
    if (next !== shownCue) {
      shownCue = next;
      if (next < 0) {
        navEls.cue.replaceChildren(h('p', { class: 'cue-text' }, t('noMoreJunctions')));
      } else {
        const { junction, mapIndex } = s.junctions[next];
        fill(
          navEls.cue,
          h(
            'div',
            { class: 'cue-head' },
            h('span', { class: 'pin pin-junction is-next' }, String(mapIndex + 1)),
            h('span', { class: 'label' }, t('nextJunction')),
            h('span', { class: 'cue-dist' }),
          ),
          h('p', { class: 'cue-text' }, s.reverse ? t('checkJunction') : tr(junction.cue)),
          junction.photo ? h('img', { class: 'cue-photo', src: `/photos/${junction.photo}`, alt: '' }) : null,
        );
      }
    }
    const dist = navEls.cue.querySelector('.cue-dist');
    if (dist) dist.textContent = t('inMetres', { m: Math.round(st.distToNextJunction / 5) * 5 });
    navEls.cue.classList.toggle('is-near', next >= 0 && st.distToNextJunction <= DEFAULT_CONFIG.cueAheadM);
  }

  function onFix(fix: Fix): void {
    const s = session;
    if (!s) return;
    // A pretend walk has no compass: point the beam the way it is moving.
    if (simMode && s.lastFix && haversine([s.lastFix.lng, s.lastFix.lat], [fix.lng, fix.lat]) > 2) {
      map.setHeading(bearing([s.lastFix.lng, s.lastFix.lat], [fix.lng, fix.lat]));
    }
    s.lastFix = fix;
    for (const event of s.nav.update(fix)) {
      if (event.type === 'cue') {
        navigator.vibrate?.([200, 100, 200]);
        beep(880, 2);
      } else if (event.type === 'passed') {
        if (event.index === 0 && !s.reverse) track('junction1', tl.id);
      } else if (event.type === 'offroute') {
        navigator.vibrate?.([600, 150, 600, 150, 600]);
        beep(330, 3);
        track('offroute', tl.id);
      } else if (event.type === 'backon') {
        navigator.vibrate?.(150);
        beep(1100, 1);
      } else if (event.type === 'finish') {
        finish();
        return;
      }
    }
    updateNav();
  }

  async function keepScreenOn(): Promise<void> {
    if (!session || !('wakeLock' in navigator)) return;
    try {
      session.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Refused (e.g. low battery). The hint on the page asks the user to keep it on.
    }
  }

  // The browser drops the screen lock whenever the page is hidden.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void keepScreenOn();
  };
  document.addEventListener('visibilitychange', onVisible);

  function endSession(): void {
    const s = session;
    if (!s) return;
    s.source.stop();
    s.stopCompass();
    map.setHeading(null);
    if (s.snoozeTimer) clearTimeout(s.snoozeTimer);
    void s.wakeLock?.release();
    session = null;
  }

  function start(reverse: boolean): void {
    endSession();
    audio ??= new AudioContext();
    const route = reverse ? [...line].reverse() : line;
    const ordered = tl.junctions.map((junction, mapIndex) => ({ junction, mapIndex }));
    if (reverse) ordered.reverse();

    const nav = new Navigator(route, ordered.map(({ junction }) => junction));
    const source = simMode
      ? simulate(route, simMode, nav.junctionAlong[0] ?? nav.total / 3, onFix)
      : watchGps(onFix, () => {
          stop();
          setBanner('danger', t('noPermission'));
        });
    session = { nav, source, startedAt: Date.now(), reverse, junctions: ordered, lastFix: null, snoozeTimer: null, wakeLock: null, stopCompass: () => {} };
    void keepScreenOn();
    if (!simMode) {
      const mine = session;
      // Asked here, straight after the tap, because an iPhone only asks then.
      // Listen whatever the answer: if it was no, no readings arrive and the
      // beam stays hidden. Skip if the walk was stopped while it was asking.
      void requestCompass().then(() => {
        if (session === mine) mine.stopCompass = watchCompass((degrees) => map.setHeading(degrees));
      });
    }
    if (!reverse) track('start', tl.id);
    // Save in the background while there is still signal, so the page can
    // reopen on the trail even if the browser closes it with no signal.
    if (offlineSupported() && navigator.onLine && !isSaved(tl.id)) {
      saveTrailOffline(tl).then(
        () => track('offline', tl.id),
        () => {},
      );
    }
    map.setFollowing(true);
    renderNav();
  }

  function stop(): void {
    endSession();
    map.setPosition(null);
    map.setNextJunction(-1);
    void map.setRejoin(null, null);
    void map.setProgress(0, 0);
    map.showAll();
    renderInfo();
  }

  function finish(): void {
    const s = session!;
    const minutes = (Date.now() - s.startedAt) / 60000;
    const wasReverse = s.reverse;
    endSession();
    if (!wasReverse) track('finish', tl.id);
    navigator.vibrate?.([150, 80, 150, 80, 400]);
    beep(1100, 3);
    setBanner(null);
    map.setNextJunction(-1);
    map.setFollowing(false);
    map.showAll();
    sheet.className = 'sheet sheet-nav';
    fill(
      sheet,
      h('span', { class: 'label' }, tr(tl.name)),
      h('h1', {}, t('finished')),
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, formatMinutes(minutes)), h('span', { class: 'label' }, t('yourTime'))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, formatDistance(tl.distanceM)), h('span', { class: 'label' }, t('distance'))),
      ),
      // At the top of a one-way trail the next thing a hiker needs is the way down.
      wasReverse ? null : h('button', { class: 'btn btn-primary', onclick: () => start(true) }, t('takeMeBack')),
      h('button', { class: wasReverse ? 'btn btn-primary' : 'btn', onclick: stop }, t('done')),
    );
  }

  function toggleSnooze(): void {
    const s = session;
    if (!s) return;
    const on = s.snoozeTimer === null;
    if (s.snoozeTimer) clearTimeout(s.snoozeTimer);
    s.snoozeTimer = on ? window.setTimeout(toggleSnooze, SNOOZE_MS) : null;
    s.nav.setSnoozed(on);
    navEls.detour.textContent = on ? `✓ ${t('detourOn')}` : t('detour');
    navEls.detour.setAttribute('aria-pressed', String(on));
  }

  function openHelp(): void {
    const fix = session?.lastFix;
    const coords = fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : '';
    const copyBtn = h(
      'button',
      {
        class: 'btn',
        disabled: !fix,
        onclick: async () => {
          // A map link is the easiest thing for someone else to open from an SMS.
          await navigator.clipboard.writeText(`${coords} https://maps.google.com/?q=${fix!.lat.toFixed(5)},${fix!.lng.toFixed(5)}`);
          copyBtn.textContent = `✓ ${t('copied')}`;
        },
      },
      t('copyLocation'),
    );
    helpDialog.replaceChildren(
      h('h2', {}, t('help')),
      h('p', { class: 'coords' }, fix ? `${coords} (±${Math.round(fix.accuracy)} m)` : t('noLocationYet')),
      h('a', { class: 'btn btn-danger', href: 'tel:999' }, t('call999')),
      copyBtn,
      h('button', { class: 'btn', onclick: () => helpDialog.close() }, t('close')),
    );
    helpDialog.showModal();
  }

  renderInfo();

  return () => {
    endSession();
    document.removeEventListener('visibilitychange', onVisible);
    void audio?.close();
    map.destroy();
  };
}
