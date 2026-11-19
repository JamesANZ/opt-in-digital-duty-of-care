/**
 * @title Safety dashboard
 * @notice Shared dashboard UI. On mobile the same file runs against the native bridge.
 */
import type { Action, CategorySetting, DesignRestrictions, JevMode, Profile, ProfileKind, Settings } from '../../../packages/core/src/profiles.ts';
import type { Decision } from '../../../packages/core/src/engine.ts';
import type { HarmCategory, HarmGroup } from '../../../packages/core/src/taxonomy.ts';
import type { Example } from '../../../packages/core/src/learner.ts';

const admin = window.ddocAdmin;
if (!admin) throw new Error('Dashboard bridge missing');
const A = admin;

const mainEl = document.getElementById('main');
if (!mainEl) throw new Error('#main missing');
const main: HTMLElement = mainEl;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/**
 * @notice Escape text before it is placed in HTML.
 * @param s Any value. Null and undefined become an empty string.
 * @return Escaped text.
 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
/**
 * @notice A short relative time for the decision log.
 * @param ts Unix time in milliseconds.
 * @return "just now", minutes, hours, or a date.
 */
const ago = (ts: number) => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(ts).toLocaleDateString(); };
const ACTIONS: Record<string, string> = { allow: 'Allow', label: 'Label only', blur: 'Blur', hide: 'Hide', interstitial: 'Support screen', block_page: 'Block page' };
const STAGE: Record<string, string> = { learned: 'Your examples', rule: 'On-device rule', jev: 'JEV', host: 'Site rule' };

/**
 * @notice The transparency report fields the overview page draws.
 */
interface DashReport {
  byCategory: Record<string, number>;
  byStage: Record<string, number>;
  overrides: number;
  counters: { filtered: number; localDecided: number; jevSent: number };
  learning: Record<string, { harmful: number; fine: number }>;
}
/**
 * @notice A bookmark shown in the dashboard.
 */
interface Bookmark { title?: string; url: string }
/**
 * @notice One history entry.
 */
interface HistoryItem { ts: number; title?: string; url: string }
/**
 * @notice One download from this session.
 */
interface DownloadItem { name: string; path?: string; state: string; received: number }
/**
 * @notice Browser data the dashboard can list. The API key is not included.
 */
interface BrowserData { bookmarks: Bookmark[]; history: HistoryItem[]; downloads: DownloadItem[] }
/**
 * @notice Whether the active profile is PIN-locked and whether a PIN exists.
 */
interface LockState { locked: boolean; hasPin: boolean }
/**
 * @notice The `state` RPC payload, with the API key already masked.
 */
interface DashState {
  profiles: Profile[];
  settings: Settings;
  categories: HarmCategory[];
  examples: Example[];
  decisions: Decision[];
  report: DashReport;
  jevActive: boolean;
}

let S: DashState | null = null;
/**
 * @notice The state loaded for the current page.
 * @return The dashboard state. Throws before the first successful load.
 */
function state(): DashState {
  if (!S) throw new Error('Dashboard state is not loaded');
  return S;
}

/**
 * @notice Call the engine, asking for the parent PIN when a locked profile refuses the change.
 * @param method Dashboard method.
 * @param params Method parameters.
 * @return The result, or null when the user cancels the PIN prompt or the call fails.
 */
async function call(method: string, params?: unknown): Promise<unknown> {
  try { return await A.call(method, params); }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/PIN/.test(message)) { if (await askPin()) return A.call(method, params); return null; }
    alertBox(message); return null;
  }
}
/**
 * @notice Show an error at the top of the page for a few seconds.
 * @param msg Error text.
 */
function alertBox(msg: string) {
  const p = document.createElement('div');
  p.className = 'panel err';
  p.textContent = msg;
  main.prepend(p);
  setTimeout(() => p.remove(), 5000);
}

/**
 * @notice Ask for the parent PIN.
 * @return True when the PIN unlocks the session.
 */
function askPin(): Promise<boolean> {
  return new Promise((resolve) => {
    const m = document.getElementById('pin');
    const inp = document.getElementById('pin-input');
    const err = document.getElementById('pin-err');
    const cancel = document.getElementById('pin-cancel');
    const form = document.getElementById('pin-form');
    if (!(m instanceof HTMLElement) || !(inp instanceof HTMLInputElement) || !err || !cancel || !(form instanceof HTMLFormElement)) {
      resolve(false);
      return;
    }
    m.hidden = false;
    inp.value = '';
    inp.focus();
    err.textContent = '';
    cancel.onclick = () => { m.hidden = true; resolve(false); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const ok = await A.call('unlock', { pin: inp.value });
      if (ok) { m.hidden = true; resolve(true); } else err.textContent = 'Incorrect PIN';
    };
  });
}

/**
 * @notice Reload dashboard state from the engine.
 */
async function load() { S = await A.call('state') as DashState; }

/**
 * @notice Render a bar chart for category or stage counts.
 * @param obj Counts keyed by label.
 * @return HTML, or an empty-state message.
 */
function bars(obj: Record<string, number>) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="empty">Nothing filtered yet.</div>';
  const max = Math.max(...entries.map((e) => e[1]));
  return '<div class="bars">' + entries.map(([k, v]) => `<div class="b"><span>${esc(STAGE[k] ?? k)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><b>${v}</b></div>`).join('') + '</div>';
}

/**
 * @notice One renderer per dashboard page. Each returns the HTML for `#main`.
 */
const views: Record<string, () => Promise<string>> = {
  async overview() {
    const S = state();
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
    const S = state();
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
    const S = state();
    const cats = S.categories;
    const label = (id: string) => cats.find((c) => c.id === id)?.label ?? id;
    const rows = [...S.examples].reverse().map((e) => `<tr><td><span class="pill ${e.polarity === 'harmful' ? 'block_page' : 'interstitial'}">${e.polarity === 'harmful' ? 'Unwanted' : 'Fine'}</span></td>
      <td><b>${esc(label(e.categoryId))}</b><br><small class="mute">${esc(e.host ?? '')} · ${ago(e.createdAt)} · ${esc(e.source)}</small></td>
      <td class="quote">"${esc(e.text.slice(0, 240))}"${e.note ? `<br><small class="mute">Why: ${esc(e.note)}</small>` : ''}</td>
      <td><button class="danger" data-delex="${esc(e.id)}">Delete</button></td></tr>`).join('');
    const custom = cats.filter((c) => c.custom);
    const newest = custom[custom.length - 1]?.id ?? '';
    const opt = (c: HarmCategory) => `<option value="${esc(c.id)}" ${c.id === newest ? 'selected' : ''}>${esc(c.label)}${c.custom ? ' (yours)' : ''}</option>`;
    const opts = [
      custom.length ? `<optgroup label="Your categories">${[...custom].reverse().map(opt).join('')}</optgroup>` : '<option value="">Choose a category</option>',
      `<optgroup label="Built-in">${cats.filter((c) => !c.custom).map(opt).join('')}</optgroup>`,
    ].join('');
    const prog = Object.entries(S.report.learning).map(([k, v]) => `<tr><td>${esc(label(k))}</td><td>${v.harmful}</td><td>${v.fine}</td></tr>`).join('');
    const mine = custom.length ? `<table><tbody>${[...custom].reverse().map((c) => {
      const set = profile().categories[c.id] ?? { enabled: true, action: 'blur' as Action };
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
    const S = state();
    const p = profile();
    const groups: Record<HarmGroup, string> = { seriously_harmful: 'Seriously harmful (all ages)', harmful_to_children: 'Harmful to children', other: 'Ads, other filters & your categories' };
    let html = `<h1>Categories &amp; sensitivity</h1><p class="mute">For profile <b>${esc(p.name)}</b>. Categories follow the Digital Duty of Care Bill. Higher sensitivity catches more but may over-filter.</p>`;
    for (const [g, title] of Object.entries(groups) as [HarmGroup, string][]) {
      html += `<div class="panel"><h2 style="margin-top:0">${title}</h2>`;
      for (const c of S.categories.filter((x) => x.group === g)) {
        const s: CategorySetting = p.categories[c.id] ?? { enabled: false, sensitivity: 0.5, action: 'blur' };
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
    const S = state();
    const lock = await A.call('lockState') as LockState;
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
    const sw = (k: keyof DesignRestrictions, t: string, sub: string) => `<label class="switch"><input type="checkbox" data-design="${k}" ${d[k] ? 'checked' : ''}><div><b>${t}</b><br><small class="mute">${sub}</small></div></label>`;
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
    const s = state().settings;
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
    const rows: [string, string, string][] = [
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
    const d = await A.call('browserData') as BrowserData;
    return `<h1>Bookmarks</h1><div class="panel">${d.bookmarks.length ? `<table><tbody>${d.bookmarks.map((b) => `<tr><td><a href="#" data-open="${esc(b.url)}">${esc(b.title || b.url)}</a><br><small class="mute">${esc(b.url)}</small></td><td><button class="danger" data-unbm="${esc(b.url)}">Remove</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No bookmarks yet. Press ☆ in the toolbar.</div>'}</div>`;
  },
  async history() {
    const d = await A.call('browserData') as BrowserData;
    return `<h1>History</h1><div class="row"><button class="danger" id="hist-clear">Clear history</button></div><div class="panel">${d.history.length ? `<table><tbody>${d.history.slice(0, 500).map((h) => `<tr><td>${ago(h.ts)}</td><td><a href="#" data-open="${esc(h.url)}">${esc(h.title || h.url)}</a><br><small class="mute">${esc(h.url)}</small></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No history.</div>'}</div>`;
  },
  async downloads() {
    const d = await A.call('browserData') as BrowserData;
    return `<h1>Downloads</h1><div class="panel">${d.downloads.length ? `<table><tbody>${d.downloads.map((x) => `<tr><td><b>${esc(x.name)}</b><br><small class="mute">${esc(x.state)} · ${Math.round(x.received / 1024)} KB</small></td><td>${x.path ? `<button data-show="${esc(x.path)}">Show in folder</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No downloads this session.</div>'}</div>`;
  },
};

/**
 * @notice The profile the dashboard is currently showing.
 * @return The active profile, or the first profile.
 */
function profile() {
  const S = state();
  return S.profiles.find((p) => p.id === S.settings.activeProfileId) ?? S.profiles[0]!;
}

/**
 * @notice Draw the page named by the URL hash and wire its controls.
 */
async function route() {
  const v = (location.hash || '#overview').slice(1);
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + v));
  await load();
  const who = document.getElementById('who');
  if (who) who.innerHTML = `Profile: <b>${esc(profile().name)}</b><br><small>${esc(profile().kind)}${profile().locked ? ' · protected' : ''}</small>`;
  const view = views[v] ?? views.overview;
  if (!view) return;
  main.innerHTML = await view();
  wire();
  main.focus();
}

/**
 * @notice Attach the current page's buttons and forms to engine calls.
 */
function wire() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const on = (sel: string, fn: (el: HTMLElement) => void) => main.querySelectorAll<HTMLElement>(sel).forEach(fn);
  const input = (id: string) => {
    const node = document.getElementById(id);
    if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement) && !(node instanceof HTMLSelectElement)) throw new Error(`#${id} missing`);
    return node;
  };
  on('[data-go]', (b) => { b.onclick = () => { location.hash = b.dataset.go ?? ''; }; });
  on('#exp', (b) => { b.onclick = () => { void A.call('exportReport'); }; });
  on('[data-ov]', (b) => { b.onclick = async () => { await call('override', { id: b.dataset.ov, kind: b.dataset.k }); void route(); }; });
  on('#clear-dec', (b) => { b.onclick = async () => { await call('clearDecisions'); void route(); }; });
  on('[data-delex]', (b) => { b.onclick = async () => { await call('deleteExample', { id: b.dataset.delex }); void route(); }; });
  on('#ex-form', (f) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const t = input('ex-text').value.trim();
      const categoryId = input('ex-cat').value;
      if (!t) return alertBox('Paste an example first.');
      if (!categoryId) return alertBox('Choose a category. Create one below if the built-in list does not fit.');
      const polarity = input('ex-pol').value === 'fine' ? 'fine' : 'harmful';
      if ((await call('tagExample', { text: t, categoryId, polarity, note: input('ex-note').value })) !== null) void route();
    };
  });
  on('#cc-form', (f) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const l = input('cc-label').value.trim();
      if (!l) return alertBox('Enter a name for the category.');
      if ((await call('addCustomCategory', { label: l, description: input('cc-desc').value.trim() || l })) !== null) void route();
    };
  });
  on('[data-cat]', (el) => {
    el.onchange = async () => {
      const field = el.dataset.f ?? '';
      const control = el as HTMLInputElement;
      const v = field === 'enabled' ? control.checked : field === 'sensitivity' ? Number(control.value) : control.value;
      if ((await call('updateSetting', { profileId: profile().id, categoryId: el.dataset.cat, patch: { [field]: v } })) === null) void route();
    };
  });
  on('[data-delcat]', (b) => { b.onclick = async () => { await call('removeCustomCategory', { id: b.dataset.delcat }); void route(); }; });
  on('[data-switch]', (b) => {
    b.onclick = async () => {
      const ls = await A.call('lockState') as LockState;
      let pin = '';
      if (ls.locked) {
        if (!(await askPin())) return;
        pin = (document.getElementById('pin-input') as HTMLInputElement | null)?.value ?? '';
      }
      await A.call('switchProfile', { profileId: b.dataset.switch, pin }).catch((x: unknown) => alertBox(x instanceof Error ? x.message : String(x)));
      void route();
    };
  });
  on('#np-add', (b) => {
    b.onclick = async () => {
      const n = input('np-name').value.trim();
      if (!n) return;
      const kind = input('np-kind').value as ProfileKind;
      await call('addProfile', { name: n, kind });
      void route();
    };
  });
  on('#pin-set', (b) => {
    b.onclick = async () => {
      const n = input('pin-new').value;
      if (n.length < 4) return alertBox('PIN must be at least 4 digits');
      const old = $('pin-old');
      if (await call('setPin', { pin: n, oldPin: old instanceof HTMLInputElement ? old.value : undefined })) void route();
    };
  });
  on('#sites-save', (b) => {
    b.onclick = async () => {
      const lines = (id: string) => input(id).value.split('\n').map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
      const priv = document.getElementById('priv');
      await call('updateProfile', { profileId: profile().id, patch: { blockedHosts: lines('blocked'), allowedHosts: lines('allowed'), allowPrivateWindows: priv instanceof HTMLInputElement && priv.checked } });
      void route();
    };
  });
  on('[data-design]', (el) => {
    const box = el as HTMLInputElement;
    box.onchange = async () => {
      const key = box.dataset.design;
      if (!key) return;
      if ((await call('updateDesign', { profileId: profile().id, patch: { [key]: box.checked } })) === null) void route();
    };
  });
  on('#limit', (el) => { (el as HTMLInputElement).onchange = () => { void call('updateDesign', { profileId: profile().id, patch: { scrollLimit: Number((el as HTMLInputElement).value) } }); }; });
  on('input[name=mode]', (el) => {
    const radio = el as HTMLInputElement;
    radio.onchange = () => { void call('setSettings', { jevMode: radio.value as JevMode }); };
  });
  on('#jev-save', (b) => {
    b.onclick = async () => {
      const p: { jevBaseURL: string; jevModel: string; shareExamplesWithJev: boolean; imageChecks: boolean; jevApiKey?: string } = {
        jevBaseURL: input('base').value.trim(),
        jevModel: input('model').value.trim(),
        shareExamplesWithJev: (document.getElementById('share') as HTMLInputElement).checked,
        imageChecks: (document.getElementById('img') as HTMLInputElement).checked,
      };
      const key = input('key').value.trim();
      if (key) p.jevApiKey = key;
      await call('setSettings', p);
      void route();
    };
  });
  on('#wipe', (b) => { b.onclick = async () => { if (confirmBox()) { await call('wipe'); void route(); } }; });
  on('#hist-clear', (b) => { b.onclick = async () => { await A.call('clearHistory'); void route(); }; });
  on('[data-open]', (a) => { a.onclick = (e) => { e.preventDefault(); A.chrome('newTab', a.dataset.open); }; });
  on('[data-unbm]', (b) => { b.onclick = async () => { await A.call('removeBookmark', { url: b.dataset.unbm }); void route(); }; });
  on('[data-show]', (b) => { b.onclick = () => A.chrome('openDownload', b.dataset.show); });
}
/**
 * @notice Ask before wiping taught examples and the decision log.
 * @return True when the user confirms.
 */
function confirmBox() { return window.confirm('Delete everything DDoC has learned and its decision log? This cannot be undone.'); }

window.addEventListener('hashchange', () => { void route(); });
void route();
