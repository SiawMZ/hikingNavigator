type Child = Node | string | null | false | undefined;

type Props = Record<string, string | number | boolean | EventListener | null | undefined>;

/** Replaces everything inside `parent`, skipping empty values. */
export function fill(parent: Element, ...children: Child[]): void {
  parent.replaceChildren(...children.filter((c): c is Node | string => c != null && c !== false));
}

/** Creates an element. Props starting with "on" are event listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(child);
  }
  return el;
}
