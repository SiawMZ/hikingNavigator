import { loadIndex } from '../data';
import { h } from '../dom';
import { formatDistance, formatMinutes, lang, setLang, t, tr } from '../i18n';
import type { TrailSummary } from '../types';

export function statusChip(status: TrailSummary['status']): HTMLElement {
  return h('span', { class: `chip chip-${status}` }, t(status));
}

export function langToggle(onChange: () => void): HTMLElement {
  const button = (code: 'en' | 'ms', label: string) =>
    h(
      'button',
      {
        class: 'lang-btn',
        'aria-pressed': lang === code,
        onclick: () => {
          setLang(code);
          onChange();
        },
      },
      label,
    );
  return h('div', { class: 'lang', role: 'group', 'aria-label': 'Language' }, button('en', 'EN'), button('ms', 'BM'));
}

export async function listView(root: HTMLElement, rerender: () => void): Promise<() => void> {
  const list = h('div', { class: 'hills' });
  root.replaceChildren(
    h(
      'main',
      { class: 'page' },
      h('header', { class: 'masthead' }, h('h1', {}, 'KK Trails'), langToggle(rerender)),
      h('p', { class: 'lede' }, t('intro')),
      list,
      h('p', { class: 'fine' }, t('disclaimer')),
    ),
  );

  let trails: TrailSummary[];
  try {
    trails = await loadIndex();
  } catch {
    list.append(h('p', { class: 'notice' }, t('loadFailed')));
    return () => {};
  }
  if (!trails.length) {
    list.append(h('p', { class: 'notice' }, t('noTrails')));
    return () => {};
  }

  const byHill = new Map<string, TrailSummary[]>();
  for (const trail of trails) byHill.set(trail.hill, [...(byHill.get(trail.hill) ?? []), trail]);

  for (const [hill, items] of byHill) {
    list.append(
      h(
        'section',
        { class: 'hill' },
        h('h2', {}, hill),
        h(
          'ul',
          { class: 'trail-list' },
          ...items.map((trail) =>
            h(
              'li',
              {},
              h(
                'a',
                { class: 'trail-row', href: `/t/${trail.id}` },
                h('span', { class: 'trail-name' }, tr(trail.name), trail.demo ? h('span', { class: 'chip chip-demo' }, 'Demo') : null),
                statusChip(trail.status),
                h(
                  'span',
                  { class: 'trail-meta' },
                  `${formatDistance(trail.distanceM)} · ↑ ${Math.round(trail.ascentM)} m · ${formatMinutes(trail.minutes)}`,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
  return () => {};
}
