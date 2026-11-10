// Counts pilot events (page opens, starts, first junction passed, finishes).
// No location and no personal details are sent: only a random visitor id,
// the trail id and the event name. Without Supabase settings it does nothing.

import { lang } from './i18n';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const QUEUE = 'events-queue';

export type EventName = 'open' | 'start' | 'junction1' | 'offroute' | 'finish' | 'gpx' | 'offline';

interface Row {
  anon_id: string;
  event: EventName;
  trail_id: string | null;
  src: string;
  lang: string;
  at: string;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: events for this visit are simply not kept.
  }
}

function anonId(): string {
  let id = read('anon-id');
  if (!id) {
    id = crypto.randomUUID();
    write('anon-id', id);
  }
  return id;
}

/** "qr" when the visit began from a QR code link (?s=qr), else "direct". */
function source(): string {
  const fromUrl = new URLSearchParams(location.search).get('s');
  if (fromUrl) {
    try {
      sessionStorage.setItem('src', fromUrl);
    } catch {
      // Fine: this page view is still counted with the right source.
    }
    return fromUrl;
  }
  try {
    return sessionStorage.getItem('src') ?? 'direct';
  } catch {
    return 'direct';
  }
}

async function flush(): Promise<void> {
  if (!URL_ || !KEY) return;
  const rows: Row[] = JSON.parse(read(QUEUE) ?? '[]');
  if (!rows.length) return;
  const res = await fetch(`${URL_}/rest/v1/events`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  // Keep the rows for the next try unless the server accepted them.
  if (res.ok) write(QUEUE, '[]');
}

export function track(event: EventName, trailId: string | null = null): void {
  const row: Row = {
    anon_id: anonId(),
    event,
    trail_id: trailId,
    src: source(),
    lang,
    at: new Date().toISOString(),
  };
  if (import.meta.env.DEV) console.debug('[track]', row.event, row.trail_id, row.src);
  if (!URL_ || !KEY) return;
  // Queue first: the trail may have no signal, so events are sent when it returns.
  const rows: Row[] = JSON.parse(read(QUEUE) ?? '[]');
  rows.push(row);
  write(QUEUE, JSON.stringify(rows.slice(-200)));
  flush().catch(() => {});
}

window.addEventListener('online', () => {
  flush().catch(() => {});
});
