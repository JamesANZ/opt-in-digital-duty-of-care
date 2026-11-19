const $ = (id) => document.getElementById(id);
const C = window.ddocChrome;
let state = null;

if (location.search.includes('private=1')) { document.body.classList.add('private'); $('private-badge').hidden = false; }

function render(s) {
  state = s;
  const tabs = $('tabs');
  tabs.innerHTML = '';
  s.tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === s.active ? ' active' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(i === s.active));
    el.title = t.title;
    if (t.loading) { const sp = document.createElement('span'); sp.className = 'spin'; el.appendChild(sp); }
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = t.title || t.url;
    el.appendChild(title);
    const x = document.createElement('button');
    x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Close tab');
    x.onclick = (e) => { e.stopPropagation(); C.send('closeTab', i); };
    el.appendChild(x);
    el.onclick = () => C.send('activate', i);
    el.onauxclick = (e) => { if (e.button === 1) C.send('closeTab', i); };
    tabs.appendChild(el);
  });
  const t = s.tabs[s.active];
  if (t && document.activeElement !== $('omni')) $('omni').value = t.url.startsWith('ddoc://ui/newtab') ? '' : t.url;
  $('back').disabled = !t?.canBack;
  $('fwd').disabled = !t?.canFwd;
  $('reload').innerHTML = t?.loading ? '&#10005;' : '&#8635;';
  $('star').innerHTML = s.bookmarked ? '&#9733;' : '&#9734;';
  $('filtered').textContent = s.filtered;
  const p = $('profile');
  p.textContent = s.profile.name;
  p.className = 'profile ' + s.profile.kind;
}

C.onTabs(render);
$('newtab').onclick = () => C.send('newTab');
$('back').onclick = () => C.send('back');
$('fwd').onclick = () => C.send('forward');
$('reload').onclick = () => C.send(state?.tabs[state.active]?.loading ? 'stop' : 'reload');
$('star').onclick = () => C.send('bookmark');
$('shield').onclick = () => C.send('dashboard', 'overview');
$('profile').onclick = () => C.send('dashboard', 'profiles');
$('omni-form').onsubmit = (e) => { e.preventDefault(); C.send('navigate', $('omni').value); $('omni').blur(); };
$('omni').onfocus = () => $('omni').select();
$('menu').onclick = (e) => { e.stopPropagation(); $('menu-pop').hidden = !$('menu-pop').hidden; };
document.onclick = () => { $('menu-pop').hidden = true; };
document.querySelectorAll('#menu-pop [data-cmd]').forEach((b) => b.onclick = () => C.send(b.dataset.cmd));
document.querySelectorAll('#menu-pop [data-dash]').forEach((b) => b.onclick = () => C.send('dashboard', b.dataset.dash));
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'l') { $('omni').focus(); e.preventDefault(); }
  if (mod && e.key === 't') { C.send('newTab'); e.preventDefault(); }
});
