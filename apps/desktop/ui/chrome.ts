/**
 * @title Toolbar
 * @notice Renders tabs and sends toolbar commands through `ddocChrome`.
 */

/**
 * @notice Find a required toolbar element.
 * @param id Element id.
 * @return The element. Throws when it is missing.
 */
const $ = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
};
const chrome = window.ddocChrome;
if (!chrome) throw new Error('Chrome bridge missing');
const C = chrome;
let state: ChromeState | null = null;

if (location.search.includes('private=1')) {
  document.body.classList.add('private');
  $<HTMLElement>('private-badge').hidden = false;
}

/**
 * @notice Draw the tab strip and toolbar from a snapshot.
 * @param s Tabs, active index, profile, and bookmark flag.
 */
function render(s: ChromeState) {
  state = s;
  const tabs = $<HTMLElement>('tabs');
  tabs.innerHTML = '';
  s.tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === s.active ? ' active' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(i === s.active));
    el.title = t.title;
    if (t.loading) {
      const sp = document.createElement('span');
      sp.className = 'spin';
      el.appendChild(sp);
    }
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = t.title || t.url;
    el.appendChild(title);
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Close tab');
    x.onclick = (e) => { e.stopPropagation(); C.send('closeTab', i); };
    el.appendChild(x);
    el.onclick = () => C.send('activate', i);
    el.onauxclick = (e) => { if (e.button === 1) C.send('closeTab', i); };
    tabs.appendChild(el);
  });
  const t = s.tabs[s.active];
  const omni = $<HTMLInputElement>('omni');
  if (t && document.activeElement !== omni) omni.value = t.url.startsWith('ddoc://ui/newtab') ? '' : t.url;
  $<HTMLButtonElement>('back').disabled = !t?.canBack;
  $<HTMLButtonElement>('fwd').disabled = !t?.canFwd;
  $<HTMLButtonElement>('reload').innerHTML = t?.loading ? '&#10005;' : '&#8635;';
  $<HTMLButtonElement>('star').innerHTML = s.bookmarked ? '&#9733;' : '&#9734;';
  $<HTMLElement>('filtered').textContent = String(s.filtered);
  const p = $<HTMLButtonElement>('profile');
  p.textContent = s.profile.name;
  p.className = 'profile ' + s.profile.kind;
}

C.onTabs(render);
$<HTMLButtonElement>('newtab').onclick = () => C.send('newTab');
$<HTMLButtonElement>('back').onclick = () => C.send('back');
$<HTMLButtonElement>('fwd').onclick = () => C.send('forward');
$<HTMLButtonElement>('reload').onclick = () => C.send(state?.tabs[state.active]?.loading ? 'stop' : 'reload');
$<HTMLButtonElement>('star').onclick = () => C.send('bookmark');
$<HTMLButtonElement>('shield').onclick = () => C.send('dashboard', 'overview');
$<HTMLButtonElement>('profile').onclick = () => C.send('dashboard', 'profiles');
$<HTMLFormElement>('omni-form').onsubmit = (e) => { e.preventDefault(); C.send('navigate', $<HTMLInputElement>('omni').value); $<HTMLInputElement>('omni').blur(); };
$<HTMLInputElement>('omni').onfocus = () => $<HTMLInputElement>('omni').select();
$<HTMLButtonElement>('menu').onclick = (e) => { e.stopPropagation(); $<HTMLElement>('menu-pop').hidden = !$<HTMLElement>('menu-pop').hidden; };
document.onclick = () => { $<HTMLElement>('menu-pop').hidden = true; };
document.querySelectorAll<HTMLButtonElement>('#menu-pop [data-cmd]').forEach((b) => { b.onclick = () => C.send(b.dataset.cmd ?? ''); });
document.querySelectorAll<HTMLButtonElement>('#menu-pop [data-dash]').forEach((b) => { b.onclick = () => C.send('dashboard', b.dataset.dash); });
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'l') { $<HTMLInputElement>('omni').focus(); e.preventDefault(); }
  if (mod && e.key === 't') { C.send('newTab'); e.preventDefault(); }
});
