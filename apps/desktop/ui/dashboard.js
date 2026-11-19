/* DDoC Safety Dashboard. Shared UI logic; on mobile the same file runs against the native bridge. */
const A = window.ddocAdmin;
const main = document.getElementById('main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(ts).toLocaleDateString(); };
const ACTIONS = { allow: 'Allow', label: 'Label only', blur: 'Blur', hide: 'Hide', interstitial: 'Support screen', block_page: 'Block page' };
const STAGE = { learned: 'Your examples', rule: 'On-device rule', jev: 'JEV', host: 'Site rule' };
let S = null;

async function call(method, params) {
  try { return await A.call(method, params); }
  catch (e) {
    if (/PIN/.test(e.message)) { if (await askPin()) return A.call(method, params); return null; }
    alertBox(e.message); return null;
  }
}
function alertBox(msg) { const p = document.createElement('div'); p.className = 'panel err'; p.textContent = msg; main.prepend(p); setTimeout(() => p.remove(), 5000); }

function askPin() {
  return new Promise((resolve) => {
    const m = document.getElementById('pin'); m.hidden = false;
    const inp = document.getElementById('pin-input'); inp.value = ''; inp.focus();
    document.getElementById('pin-err').textContent = '';
    document.getElementById('pin-cancel').onclick = () => { m.hidden = true; resolve(false); };
    document.getElementById('pin-form').onsubmit = async (e) => {
      e.preventDefault();
      const ok = await A.call('unlock', { pin: inp.value });
      if (ok) { m.hidden = true; resolve(true); } else document.getElementById('pin-err').textContent = 'Incorrect PIN';
    };
  });
}

async function load() { S = await A.call('state'); }

function bars(obj) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="empty">Nothing filtered yet.</div>';
  const max = Math.max(...entries.map((e) => e[1]));
  return '<div class="bars">' + entries.map(([k, v]) => `<div class="b"><span>${esc(STAGE[k] ?? k)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><b>${v}</b></div>`).join('') + '</div>';
}

const views = {
  async overview() {
    const r = S.report;
    const learned = Object.values(r.learning).reduce((a, b) => a + b.harmful + b.fine, 0);
    return `<h1>Safety overview</h1><p class="mute">Everything here stays on this device. Profile: <b>${esc(profile().name)}</b> (${esc(profile().kind)}).</p>
      <div class="grid">
        <div class="stat"><div class="n">${r.counters.filtered}</div><div class="l">Items filtered</div></div>
        <div class="stat"><div class="n">${r.counters.localDecided}</div><div class="l">Decided on this device</div></div>
        <div class="stat"><div class="n">${r.counters.jevSent}</div><div class="l">Snippets sent to JEV</div></div>
        <div class="stat"><div class="n">${learned}</div><div class="l">Examples you've taught</div></div>
        <div class="stat"><div class="n">${r.overrides}</div><div class="l">Overrides &amp; appeals</div></div>
      </div>
      <div class="row" style="gap:14px;align-items:stretch">
        <div class="panel" style="flex:1"><h2 style="margin-top:0">By harm category</h2>${bars(r.byCategory)}</div>
        <div class="panel" style="flex:1"><h2 style="margin-top:0">Who decided</h2>${bars(r.byStage)}</div>
      </div>
      <div class="panel row"><span>JEV status: ${S.jevActive ? '<b class="ok">connected</b>' : '<b>not configured</b> (on-device protection only)'} · mode <b>${esc(S.settings.jevMode)}</b></span><span style="flex:1"></span><button data-go="privacy">Settings</button><button id="exp">Export transparency report</button></div>`;
  },

  async decisions() {
    const rows = S.decisions.slice(0, 300).map((d) => `<tr>
      <td>${ago(d.ts)}<br><small class="mute">${esc(d.host ?? '')}</small></td>
      <td><b>${esc(d.categoryLabel)}</b><br><span class="pill ${esc(d.action)}">${esc(ACTIONS[d.action])}</span> <span class="pill ${esc(d.stage)}">${esc(STAGE[d.stage] ?? d.stage)}</span></td>
      <td class="quote">"${esc(d.preview)}"<br><small class="mute">${esc(d.reason)}</small></td>
      <td>${d.overridden ? `<span class="pill">${esc(d.overridden.replace('_', ' '))}</span>` : `<button data-ov="${esc(d.id)}" data-k="not_harmful">Not harmful</button> <button data-ov="${esc(d.id)}" data-k="appealed">Appeal</button>`}</td></tr>`).join('');
    return `<h1>Filtered content</h1><p class="mute">Every decision, why it was made and which stage made it. "Not harmful" teaches DDoC; "Appeal" also records it in your transparency report.</p>
      <div class="panel">${rows ? `<table><thead><tr><th>When</th><th>Decision</th><th>Content</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">Nothing filtered yet.</div>'}</div>
      <div class="row" style="margin-top:12px"><button class="danger" id="clear-dec">Clear log</button></div>`;
  },

  async learning() {
    const cats = S.categories;
    const label = (id) => cats.find((c) => c.id === id)?.label ?? id;
    const rows = [...S.examples].reverse().map((e) => `<tr><td><span class="pill ${e.polarity === 'harmful' ? 'block_page' : 'interstitial'}">${e.polarity === 'harmful' ? 'Unwanted' : 'Fine'}</span></td>
      <td><b>${esc(label(e.categoryId))}</b><br><small class="mute">${esc(e.host ?? '')} · ${ago(e.createdAt)} · ${esc(e.source)}</small></td>
      <td class="quote">"${esc(e.text.slice(0, 240))}"${e.note ? `<br><small class="mute">Why: ${esc(e.note)}</small>` : ''}</td>
      <td><button class="danger" data-delex="${esc(e.id)}">Delete</button></td></tr>`).join('');
    const custom = cats.filter((c) => c.custom);
    const newest = custom[custom.length - 1]?.id ?? '';
    const opt = (c) => `<option value="${esc(c.id)}" ${c.id === newest ? 'selected' : ''}>${esc(c.label)}${c.custom ? ' (yours)' : ''}</option>`;
    const opts = [
      custom.length ? `<optgroup label="Your categories">${[...custom].reverse().map(opt).join('')}</optgroup>` : '<option value="">Choose a category</option>',
      `<optgroup label="Built-in">${cats.filter((c) => !c.custom).map(opt).join('')}</optgroup>`,
    ].join('');
    const prog = Object.entries(S.report.learning).map(([k, v]) => `<tr><td>${esc(label(k))}</td><td>${v.harmful}</td><td>${v.fine}</td></tr>`).join('');
    const mine = custom.length ? `<table><tbody>${[...custom].reverse().map((c) => {
      const set = profile().categories[c.id] ?? { enabled: true, action: 'blur' };
      return `<tr><td><b>${esc(c.label)}</b> <span class="pill ${esc(set.action)}">${esc(ACTIONS[set.action] ?? set.action)}</span>${set.enabled ? '' : ' <span class="mute">off</span>'}<br><small class="mute">${esc(c.description)}</small></td><td><button class="danger" data-delcat="${esc(c.id)}">Delete</button></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No custom categories yet.</div>';
    return `<h1>Teach DDoC</h1><p class="mute">Select text on any page and choose <b>Teach DDoC</b>, or add an example here. DDoC finds similar content across every site using an on-device model. Negative examples ("this is fine") stop over-filtering.</p>
      <div class="panel"><h2 style="margin-top:0">Add an example</h2>
        <form id="ex-form">
        <textarea id="ex-text" placeholder="Paste an example of something you do or don't want to see"></textarea>
        <div class="row" style="margin-top:8px"><select id="ex-pol"><option value="harmful">I don't want to see this</option><option value="fine">This is fine</option></select>
        <select id="ex-cat">${opts}</select><input id="ex-note" placeholder="Why? (optional)" style="flex:1"><button class="primary" type="submit" id="ex-add">Add</button></div>
        </form></div>
      <div class="panel"><h2 style="margin-top:0">Create your own category</h2>
        <form id="cc-form"><div class="row"><input id="cc-label" placeholder="Name, e.g. Crypto hype" required><input id="cc-desc" placeholder="Describe what you mean" style="flex:1"><button class="primary" type="submit" id="cc-add">Create</button></div></form>
        <p class="mute">Your category appears in the list below and is selected for new examples. The description is sent to JEV. Add an example as well if you want it matched on this device without a network call.</p>
        <h2>Your categories</h2>${mine}</div>
      ${prog ? `<div class="panel"><h2 style="margin-top:0">Learning progress</h2><table><thead><tr><th>Category</th><th>Unwanted examples</th><th>Fine examples</th></tr></thead><tbody>${prog}</tbody></table></div>` : ''}
      <div class="panel"><h2 style="margin-top:0">Everything you've taught</h2>${rows ? `<table><tbody>${rows}</tbody></table>` : '<div class="empty">No examples yet.</div>'}</div>`;
  },

  async categories() {
    const p = profile();
    const groups = { seriously_harmful: 'Seriously harmful (all ages)', harmful_to_children: 'Harmful to children', other: 'Ads, other filters & your categories' };
    let html = `<h1>Categories &amp; sensitivity</h1><p class="mute">For profile <b>${esc(p.name)}</b>. Categories follow the Digital Duty of Care Bill. Higher sensitivity catches more but may over-filter.</p>`;
    for (const [g, title] of Object.entries(groups)) {
      html += `<div class="panel"><h2 style="margin-top:0">${title}</h2>`;
      for (const c of S.categories.filter((x) => x.group === g)) {
        const s = p.categories[c.id] ?? { enabled: false, sensitivity: 0.5, action: 'blur' };
        html += `<div class="cat"><input type="checkbox" data-cat="${esc(c.id)}" data-f="enabled" ${s.enabled ? 'checked' : ''} aria-label="Enable ${esc(c.label)}">
          <div><b>${esc(c.label)}</b><small>${esc(c.billRef)}</small></div>
          <label class="row"><span class="mute">Sensitivity</span><input type="range" min="0" max="1" step="0.05" value="${s.sensitivity}" data-cat="${esc(c.id)}" data-f="sensitivity"></label>
          <div class="row"><select data-cat="${esc(c.id)}" data-f="action" ${c.id === 'csea' ? 'disabled' : ''}>${Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}" ${k === s.action ? 'selected' : ''}>${v}</option>`).join('')}</select>
          ${c.custom ? `<button class="danger" data-delcat="${esc(c.id)}" title="Delete category">×</button>` : ''}</div></div>`;
      }
      html += '</div>';
    }
    return html;
  },

  async profiles() {
    const lock = await A.call('lockState');
    const rows = S.profiles.map((p) => `<tr><td><b>${esc(p.name)}</b> ${p.id === S.settings.activeProfileId ? '<span class="pill interstitial">active</span>' : ''}</td><td>${esc(p.kind)}</td><td>${esc((p.ageBand ?? '').replace('_', '–'))}</td><td>${p.locked ? '🔒 PIN' : 'open'}</td>
      <td>${p.id === S.settings.activeProfileId ? '' : `<button data-switch="${esc(p.id)}">Switch to</button>`}</td></tr>`).join('');
    const p = profile();
    return `<h1>Profiles &amp; parental controls</h1>
      <p class="mute">Child and teen profiles apply the Bill's under-16 design protections and stricter filtering. No names, birthdays or ID are collected; you choose an age band. Parents see counts, never browsing content.</p>
      <div class="panel"><table><thead><tr><th>Profile</th><th>Type</th><th>Age band</th><th>Protection</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="panel"><h2 style="margin-top:0">Add a profile</h2><div class="row"><input id="np-name" placeholder="Profile name"><select id="np-kind"><option value="child">Child (under 13)</option><option value="teen">Teen (13 to 17)</option><option value="adult">Adult</option></select><button class="primary" id="np-add">Add profile</button></div></div>
      <div class="panel"><h2 style="margin-top:0">Parent PIN</h2><p class="mute">${lock.hasPin ? 'A PIN is set.' : '<b>No PIN set yet.</b> Set one before handing over a child profile.'}</p>
        <div class="row">${lock.hasPin ? '<input id="pin-old" type="password" placeholder="Current PIN">' : ''}<input id="pin-new" type="password" placeholder="New PIN (4+ digits)"><button class="primary" id="pin-set">Save PIN</button></div></div>
      <div class="panel"><h2 style="margin-top:0">Sites for ${esc(p.name)}</h2>
        <label>Always blocked (one domain per line)<textarea id="blocked">${esc(p.blockedHosts.join('\n'))}</textarea></label>
        <label>Always allowed (overrides filters)<textarea id="allowed">${esc(p.allowedHosts.join('\n'))}</textarea></label>
        <div class="row" style="margin-top:8px"><label class="row"><input type="checkbox" id="priv" ${p.allowPrivateWindows ? 'checked' : ''}> Allow private windows</label><span style="flex:1"></span><button class="primary" id="sites-save">Save</button></div></div>`;
  },

  async feeds() {
    const d = profile().design;
    const sw = (k, t, sub) => `<label class="switch"><input type="checkbox" data-design="${k}" ${d[k] ? 'checked' : ''}><div><b>${t}</b><br><small class="mute">${sub}</small></div></label>`;
    return `<h1>Feed controls</h1><p class="mute">User-side versions of the Bill's design-feature protections and "My Feed, My Way". Works on supported sites (X, YouTube, Reddit, Instagram, Facebook, TikTok); platforms still control their own ranking.</p>
      <div class="panel">
        ${sw('preferFollowingFeed', 'Following-only feed', 'Switch to the Following or Subscriptions feed instead of the algorithmic one where the site offers it.')}
        ${sw('hideRecommendations', 'Hide recommendations', '"For you", "Who to follow", "Up next" and Shorts/Reels rails.')}
        ${sw('stopInfiniteScroll', 'Stop endless scrolling', 'Pause the feed after a set number of posts.')}
        <div class="switch"><span style="width:18px"></span><div class="row"><b>Feed limit</b><input type="number" min="10" max="500" id="limit" value="${d.scrollLimit}" style="width:90px"> posts</div></div>
        ${sw('hideEngagementCounts', 'Hide likes, views and follower counts', 'Removes engagement feedback features.')}
        ${sw('hideEphemeral', 'Hide stories and time-limited content', 'Removes disappearing-content trays.')}
        ${sw('disableAutoplay', 'Turn off autoplay', 'Videos only play when you press play.')}
      </div>`;
  },

  async privacy() {
    const s = S.settings;
    return `<h1>Privacy &amp; JEV</h1>
      <div class="panel"><h2 style="margin-top:0">How content is checked</h2>
        <label class="switch"><input type="radio" name="mode" value="off" ${s.jevMode === 'off' ? 'checked' : ''}><div><b>On-device only</b><br><small class="mute">Your examples and safety rules only. Nothing is sent anywhere.</small></div></label>
        <label class="switch"><input type="radio" name="mode" value="risky_only" ${s.jevMode === 'risky_only' ? 'checked' : ''}><div><b>Balanced (recommended)</b><br><small class="mute">Only text with a possible risk signal is sent to JEV, without the page address.</small></div></label>
        <label class="switch"><input type="radio" name="mode" value="all" ${s.jevMode === 'all' ? 'checked' : ''}><div><b>Maximum coverage</b><br><small class="mute">All undecided text blocks are checked by JEV.</small></div></label>
      </div>
      <div class="panel"><h2 style="margin-top:0">JEV connection</h2>
        <div class="row"><label>API key <input id="key" type="password" placeholder="${esc(s.jevApiKey || 'TypeSafe API key')}" style="width:280px"></label>
        <label>Gateway URL <input id="base" placeholder="https://api.typesafe.ai" value="${esc(s.jevBaseURL ?? '')}" style="width:260px"></label>
        <label>Model <input id="model" placeholder="jev-latest" value="${esc(s.jevModel ?? '')}" style="width:140px"></label></div>
        <label class="switch"><input type="checkbox" id="share" ${s.shareExamplesWithJev ? 'checked' : ''}><div><b>Send my custom-category examples to JEV</b><br><small class="mute">Improves matching of paraphrases. Off by default.</small></div></label>
        <label class="switch"><input type="checkbox" id="img" ${s.imageChecks ? 'checked' : ''}><div><b>Check images with JEV (experimental)</b><br><small class="mute">Sends image bytes. Off by default.</small></div></label>
        <div class="row"><button class="primary" id="jev-save">Save</button></div></div>
      <div class="panel"><h2 style="margin-top:0">Your data</h2><p class="mute">Stored encrypted (AES-256-GCM) with a key held in your operating system's keychain. Private windows keep nothing.</p>
        <div class="row"><button id="exp">Export transparency report</button><button id="hist-clear">Clear browsing history</button><button class="danger" id="wipe">Delete all learned data &amp; decisions</button></div></div>`;
  },

  async law() {
    const rows = [
      ['Seriously harmful material: CSEA, grooming, sexual violence, extreme violence, terrorism, suicide/self-harm, threats, harassment', 'full', 'Text classification via JEV + on-device rules; CSEA pages blocked with no reveal; support screens with help lines'],
      ['Material harmful to children: pornography, disordered eating, misogyny, crime glorification, dangerous stunts, bullying', 'full', 'Child and teen profiles with stricter defaults'],
      ['Under-16 design features: recommender systems, endless feeds, feedback features, time-limited content', 'partial', 'Feed controls on supported sites; cannot change server-side ranking'],
      ['User empowerment tools / "My Feed, My Way"', 'partial', 'Following-only feed redirects and hidden recommendation rails'],
      ['Complaints and disputes', 'partial', 'Appeals against DDoC decisions; links to eSafety reporting'],
      ['Transparency', 'partial', 'Local transparency report of every decision'],
      ['Sexually explicit deepfake apps', 'partial', 'Text signals; optional user-chosen block lists'],
      ['Risk assessments, effective measures, removal notices, local contact, penalties', 'platform', 'Duties on service providers; outside a browser\'s reach'],
      ['CSAM hash matching, E2EE native apps, age verification by ID', 'platform', 'Requires licensed providers or platform access; deliberately not collected'],
    ];
    return `<h1>Legislation coverage</h1><p class="mute">Online Safety Amendment (Digital Duty of Care) Bill 2026, introduced 15 October 2026. Full mapping with sources is in docs/LEGISLATIVE_MAPPING.md.</p>
      <div class="panel"><table class="cov"><thead><tr><th>Objective</th><th>Status</th><th>How</th></tr></thead><tbody>
      ${rows.map(([o, s, h]) => `<tr><td>${esc(o)}</td><td class="${s}">${s === 'full' ? 'Implemented' : s === 'partial' ? 'Partial' : 'Platform only'}</td><td>${esc(h)}</td></tr>`).join('')}</tbody></table></div>`;
  },

  async bookmarks() {
    const d = await A.call('browserData');
    return `<h1>Bookmarks</h1><div class="panel">${d.bookmarks.length ? `<table><tbody>${d.bookmarks.map((b) => `<tr><td><a href="#" data-open="${esc(b.url)}">${esc(b.title || b.url)}</a><br><small class="mute">${esc(b.url)}</small></td><td><button class="danger" data-unbm="${esc(b.url)}">Remove</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No bookmarks yet. Press ☆ in the toolbar.</div>'}</div>`;
  },
  async history() {
    const d = await A.call('browserData');
    return `<h1>History</h1><div class="row"><button class="danger" id="hist-clear">Clear history</button></div><div class="panel">${d.history.length ? `<table><tbody>${d.history.slice(0, 500).map((h) => `<tr><td>${ago(h.ts)}</td><td><a href="#" data-open="${esc(h.url)}">${esc(h.title || h.url)}</a><br><small class="mute">${esc(h.url)}</small></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No history.</div>'}</div>`;
  },
  async downloads() {
    const d = await A.call('browserData');
    return `<h1>Downloads</h1><div class="panel">${d.downloads.length ? `<table><tbody>${d.downloads.map((x) => `<tr><td><b>${esc(x.name)}</b><br><small class="mute">${esc(x.state)} · ${Math.round(x.received / 1024)} KB</small></td><td>${x.path ? `<button data-show="${esc(x.path)}">Show in folder</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No downloads this session.</div>'}</div>`;
  },
};

function profile() { return S.profiles.find((p) => p.id === S.settings.activeProfileId) ?? S.profiles[0]; }

async function route() {
  const v = (location.hash || '#overview').slice(1);
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + v));
  await load();
  document.getElementById('who').innerHTML = `Profile: <b>${esc(profile().name)}</b><br><small>${esc(profile().kind)}${profile().locked ? ' · protected' : ''}</small>`;
  main.innerHTML = await (views[v] ?? views.overview)();
  wire();
  main.focus();
}

function wire() {
  const $ = (id) => document.getElementById(id);
  const on = (sel, fn) => main.querySelectorAll(sel).forEach((el) => fn(el));
  on('[data-go]', (b) => b.onclick = () => { location.hash = b.dataset.go; });
  on('#exp', (b) => b.onclick = () => A.call('exportReport'));
  on('[data-ov]', (b) => b.onclick = async () => { await call('override', { id: b.dataset.ov, kind: b.dataset.k }); route(); });
  on('#clear-dec', (b) => b.onclick = async () => { await call('clearDecisions'); route(); });
  on('[data-delex]', (b) => b.onclick = async () => { await call('deleteExample', { id: b.dataset.delex }); route(); });
  on('#ex-form', (f) => f.onsubmit = async (e) => {
    e.preventDefault();
    const t = $('ex-text').value.trim();
    const categoryId = $('ex-cat').value;
    if (!t) return alertBox('Paste an example first.');
    if (!categoryId) return alertBox('Choose a category. Create one below if the built-in list does not fit.');
    if ((await call('tagExample', { text: t, categoryId, polarity: $('ex-pol').value, note: $('ex-note').value })) !== null) route();
  });
  on('#cc-form', (f) => f.onsubmit = async (e) => {
    e.preventDefault();
    const l = $('cc-label').value.trim();
    if (!l) return alertBox('Enter a name for the category.');
    if ((await call('addCustomCategory', { label: l, description: $('cc-desc').value.trim() || l })) !== null) route();
  });
  on('[data-cat]', (el) => el.onchange = async () => {
    const f = el.dataset.f; const v = f === 'enabled' ? el.checked : f === 'sensitivity' ? Number(el.value) : el.value;
    if ((await call('updateSetting', { profileId: profile().id, categoryId: el.dataset.cat, patch: { [f]: v } })) === null) route();
  });
  on('[data-delcat]', (b) => b.onclick = async () => { await call('removeCustomCategory', { id: b.dataset.delcat }); route(); });
  on('[data-switch]', (b) => b.onclick = async () => {
    const ls = await A.call('lockState');
    let pin = '';
    if (ls.locked) { if (!(await askPin())) return; pin = document.getElementById('pin-input').value; }
    await A.call('switchProfile', { profileId: b.dataset.switch, pin }).catch((x) => alertBox(x.message));
    route();
  });
  on('#np-add', (b) => b.onclick = async () => { const n = $('np-name').value.trim(); if (!n) return; await call('addProfile', { name: n, kind: $('np-kind').value }); route(); });
  on('#pin-set', (b) => b.onclick = async () => { const n = $('pin-new').value; if (n.length < 4) return alertBox('PIN must be at least 4 digits'); if (await call('setPin', { pin: n, oldPin: $('pin-old')?.value })) route(); });
  on('#sites-save', (b) => b.onclick = async () => {
    const lines = (id) => $(id).value.split('\n').map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
    await call('updateProfile', { profileId: profile().id, patch: { blockedHosts: lines('blocked'), allowedHosts: lines('allowed'), allowPrivateWindows: $('priv').checked } }); route();
  });
  on('[data-design]', (el) => el.onchange = async () => { if ((await call('updateDesign', { profileId: profile().id, patch: { [el.dataset.design]: el.checked } })) === null) route(); });
  on('#limit', (el) => el.onchange = () => call('updateDesign', { profileId: profile().id, patch: { scrollLimit: Number(el.value) } }));
  on('input[name=mode]', (el) => el.onchange = () => call('setSettings', { jevMode: el.value }));
  on('#jev-save', (b) => b.onclick = async () => {
    const p = { jevBaseURL: $('base').value.trim(), jevModel: $('model').value.trim(), shareExamplesWithJev: $('share').checked, imageChecks: $('img').checked };
    if ($('key').value.trim()) p.jevApiKey = $('key').value.trim();
    await call('setSettings', p); route();
  });
  on('#wipe', (b) => b.onclick = async () => { if (confirmBox()) { await call('wipe'); route(); } });
  on('#hist-clear', (b) => b.onclick = async () => { await A.call('clearHistory'); route(); });
  on('[data-open]', (a) => a.onclick = (e) => { e.preventDefault(); A.chrome('newTab', a.dataset.open); });
  on('[data-unbm]', (b) => b.onclick = async () => { await A.call('removeBookmark', { url: b.dataset.unbm }); route(); });
  on('[data-show]', (b) => b.onclick = () => A.chrome('openDownload', b.dataset.show));
}
function confirmBox() { return window.confirm('Delete everything DDoC has learned and its decision log? This cannot be undone.'); }

window.addEventListener('hashchange', route);
route();
