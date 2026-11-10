import './style.css';
import { lang, setLang } from './i18n';
import { registerServiceWorker } from './offline';
import { listView } from './views/list';
import { trailView } from './views/trail';

const root = document.getElementById('app')!;
let cleanup: () => void = () => {};
/** Guards against a slow page finishing after the user has moved on. */
let visit = 0;

async function render(): Promise<void> {
  const mine = ++visit;
  cleanup();
  cleanup = () => {};
  const match = location.pathname.match(/^\/t\/([^/]+)\/?$/);
  const done = match
    ? await trailView(root, decodeURIComponent(match[1]), render)
    : await listView(root, render);
  if (mine === visit) cleanup = done;
  else done();
}

// Links inside the site switch pages without a full reload.
document.addEventListener('click', (event) => {
  const link = (event.target as Element).closest('a');
  if (!link || link.target || link.origin !== location.origin || event.metaKey || event.ctrlKey) return;
  if (link.protocol !== 'http:' && link.protocol !== 'https:') return;
  event.preventDefault();
  // Keep ?sim and ?demo while testing.
  history.pushState(null, '', link.pathname + location.search);
  void render();
});
window.addEventListener('popstate', () => void render());

setLang(lang);
registerServiceWorker();
void render();
