import type { L } from './types';

export type Lang = 'en' | 'ms';

const KEY = 'lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'ms') return saved;
  } catch {
    // Storage can be blocked; fall through to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('ms') ? 'ms' : 'en';
}

export let lang: Lang = initial();

export function setLang(next: Lang): void {
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not saved; the choice still applies to this visit.
  }
}

const strings = {
  trails: { en: 'Trails', ms: 'Denai' },
  intro: {
    en: 'Pick a trail. The map shows where you are and warns you at each junction.',
    ms: 'Pilih denai. Peta menunjukkan lokasi anda dan memberi amaran di setiap simpang.',
  },
  noTrails: { en: 'No trails yet.', ms: 'Belum ada denai.' },
  distance: { en: 'Distance', ms: 'Jarak' },
  climb: { en: 'Climb', ms: 'Pendakian' },
  time: { en: 'Time', ms: 'Masa' },
  open: { en: 'Open', ms: 'Dibuka' },
  caution: { en: 'Take care', ms: 'Berhati-hati' },
  closed: { en: 'Closed', ms: 'Ditutup' },
  lastChecked: { en: 'Last checked', ms: 'Disemak pada' },
  hours: { en: 'Hours', ms: 'Waktu' },
  junctions: { en: 'Junctions', ms: 'Simpang' },
  start: { en: 'Start trail', ms: 'Mula denai' },
  saveOffline: { en: 'Save for offline', ms: 'Simpan untuk luar talian' },
  saving: { en: 'Saving…', ms: 'Menyimpan…' },
  saved: { en: 'Saved for offline', ms: 'Disimpan untuk luar talian' },
  saveFailed: { en: 'Could not save. Check your connection.', ms: 'Tidak dapat simpan. Semak sambungan anda.' },
  gpx: { en: 'Download GPX', ms: 'Muat turun GPX' },
  directions: { en: 'Directions to the start', ms: 'Arah ke permulaan' },
  allTrails: { en: 'All trails', ms: 'Semua denai' },
  junction: { en: 'Junction', ms: 'Simpang' },
  inMetres: { en: 'in {m} m', ms: 'dalam {m} m' },
  nextJunction: { en: 'Next junction', ms: 'Simpang seterusnya' },
  noMoreJunctions: { en: 'No more junctions. Follow the trail to the end.', ms: 'Tiada lagi simpang. Ikut denai hingga tamat.' },
  checkJunction: { en: 'Junction ahead. Check the map before you go on.', ms: 'Simpang di hadapan. Semak peta sebelum teruskan.' },
  offRoute: { en: 'You are off the trail', ms: 'Anda terkeluar dari denai' },
  offRouteHelp: { en: 'Go back {m} m, following the red line.', ms: 'Patah balik {m} m, ikut garisan merah.' },
  backOn: { en: 'Back on the trail', ms: 'Kembali ke denai' },
  weakGps: { en: 'Weak GPS signal', ms: 'Isyarat GPS lemah' },
  waitingGps: { en: 'Waiting for GPS…', ms: 'Menunggu GPS…' },
  noPermission: {
    en: 'Location is blocked. Allow location for this site, then start again.',
    ms: 'Lokasi disekat. Benarkan lokasi untuk laman ini, kemudian mula semula.',
  },
  fromStart: { en: '{m} from the trail', ms: '{m} dari denai' },
  remaining: { en: 'To go', ms: 'Baki' },
  stop: { en: 'Stop', ms: 'Berhenti' },
  takeMeBack: { en: 'Take me back', ms: 'Bawa saya balik' },
  goingBack: { en: 'Going back to the start', ms: 'Balik ke permulaan' },
  detour: { en: 'Pause alerts', ms: 'Jeda amaran' },
  detourOn: { en: 'Alerts paused 10 min', ms: 'Amaran dijeda 10 min' },
  help: { en: 'Help', ms: 'Bantuan' },
  call999: { en: 'Call 999', ms: 'Hubungi 999' },
  copyLocation: { en: 'Copy my location', ms: 'Salin lokasi saya' },
  copied: { en: 'Copied', ms: 'Disalin' },
  noLocationYet: { en: 'No location yet', ms: 'Lokasi belum ada' },
  close: { en: 'Close', ms: 'Tutup' },
  recentre: { en: 'Centre on me', ms: 'Pusatkan pada saya' },
  finished: { en: 'Trail finished', ms: 'Denai tamat' },
  yourTime: { en: 'Your time', ms: 'Masa anda' },
  done: { en: 'Done', ms: 'Selesai' },
  keepOpen: {
    en: 'Keep this page open and the screen on while you walk.',
    ms: 'Biarkan halaman ini terbuka dan skrin menyala semasa berjalan.',
  },
  demoWarning: {
    en: 'Demo line, not a real trail. Do not follow it.',
    ms: 'Laluan demo, bukan denai sebenar. Jangan ikut.',
  },
  disclaimer: {
    en: 'This map is a guide, not a guarantee. Check conditions and hike within your limits. Emergency: 999.',
    ms: 'Peta ini panduan sahaja, bukan jaminan. Semak keadaan dan mendaki mengikut kemampuan anda. Kecemasan: 999.',
  },
  notFound: { en: 'Trail not found.', ms: 'Denai tidak dijumpai.' },
  loadFailed: { en: 'Could not load. Check your connection and try again.', ms: 'Tidak dapat dimuatkan. Semak sambungan anda dan cuba lagi.' },
} satisfies Record<string, L>;

export type StringKey = keyof typeof strings;

export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
  return strings[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Picks the current language from a two-language text. */
export function tr(text: L): string {
  return text[lang];
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function formatMinutes(min: number): string {
  const m = Math.max(1, Math.round(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
