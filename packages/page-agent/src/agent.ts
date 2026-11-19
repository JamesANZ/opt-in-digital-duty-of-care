/**
 * @title Page agent
 * @notice Injected at document start into every frame. Finds blocks, asks the engine, and applies the decision.
 * @dev Also enforces feed controls and opens the teach dialog when the user selects text.
 */
import { checkUrl } from '../../core/src/rules';
import { AGENT_CSS } from './styles';
import { adapterFor, GENERIC_SELECTORS } from './sites';

/**
 * @notice The decision fields the agent needs in order to render a block.
 */
type Decision = {
  id: string; action: string; categoryId?: string; categoryLabel?: string; confidence: number; stage: string;
  reason: string; resources?: { name: string; phone?: string; url: string }[]; noReveal?: boolean; context?: string;
};
/**
 * @notice Profile, design controls, and categories returned by `pageConfig`.
 */
type PageConfig = {
  profileKind: 'adult' | 'teen' | 'child'; profileName: string;
  design: { hideRecommendations: boolean; stopInfiniteScroll: boolean; scrollLimit: number; hideEngagementCounts: boolean; hideEphemeral: boolean; disableAutoplay: boolean; preferFollowingFeed: boolean };
  categories: { id: string; label: string; custom: boolean }[];
  allCategories: { id: string; label: string; custom: boolean }[];
  blocked: { blocked: boolean; reason?: string };
};

/* ------------------------------------------------------------------ */
/* Transport: Electron preload, Android JS interface, or iOS handler   */
/* ------------------------------------------------------------------ */

const w = window as any;
let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
w.__ddocResolve = (id: number, ok: boolean, payload: string) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  const v = payload ? JSON.parse(payload) : null;
  ok ? p.res(v) : p.rej(new Error(v?.error ?? 'bridge error'));
};

/**
 * @notice Call the engine through whichever bridge this platform injected.
 * @param method RPC method.
 * @param params Method parameters.
 * @return The method result. Rejects when no bridge is present.
 */
function call(method: string, params: any = {}): Promise<any> {
  // Desktop: Electron preload isolated world.
  if (w.ddocBridge?.call) return w.ddocBridge.call(method, params);
  const id = ++seq;
  const msg = JSON.stringify({ id, method, params });
  // iOS: WKScriptMessageHandlerWithReply in the "ddoc" content world returns a Promise.
  if (w.webkit?.messageHandlers?.ddoc) {
    return w.webkit.messageHandlers.ddoc.postMessage(msg).then((r: string) => {
      const m = JSON.parse(r);
      if (!m.ok) throw new Error(m.error);
      return m.result;
    });
  }
  // Android: androidx.webkit WebMessageListener ("DDocAndroid"), origin-checked natively.
  if (w.DDocAndroid?.postMessage) {
    if (!w.DDocAndroid.__wired) {
      w.DDocAndroid.__wired = true;
      w.DDocAndroid.onmessage = (ev: { data: string }) => {
        const m = JSON.parse(ev.data);
        w.__ddocResolve(m.id, m.ok, JSON.stringify(m.ok ? m.result : { error: m.error }));
      };
    }
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      w.DDocAndroid.postMessage(msg);
    });
  }
  return Promise.reject(new Error('No DDoC bridge'));
}

/* ------------------------------------------------------------------ */

const host = location.hostname;
const processed = new WeakMap<Element, string>(); // element -> text hash
const decisions = new Map<string, Decision>();
let config: PageConfig | null = null;
let queue: { el: Element; text: string; kind: string }[] = [];
let flushTimer: any = null;

/**
 * @notice Visible text of an element, collapsed to single spaces.
 * @param el Element to read.
 * @return Trimmed text.
 */
function textOf(el: Element): string {
  return ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @notice Insert the agent stylesheet once per document.
 */
function injectStyles() {
  if (document.getElementById('ddoc-style')) return;
  const s = document.createElement('style');
  s.id = 'ddoc-style';
  s.textContent = AGENT_CSS;
  (document.head ?? document.documentElement).appendChild(s);
}

/* ------------------------- block discovery ------------------------- */

/**
 * @notice Find content blocks under a root, using the site adapter and then the generic selectors.
 * @param root Document or a newly added subtree.
 * @return Elements and their kinds. Nested blocks are skipped so a post is not classified twice.
 */
function candidates(root: ParentNode): { el: Element; kind: string }[] {
  const adapter = adapterFor(host);
  const out: { el: Element; kind: string }[] = [];
  const take = (el: Element, kind: string) => {
    if (el.closest('.ddoc-ui')) return;
    if (!el.hasAttribute('data-ddoc')) {
      // keep blocks non-overlapping: smallest meaningful unit wins
      if (el.parentElement?.closest('[data-ddoc]') || el.querySelector('[data-ddoc]')) return;
      el.setAttribute('data-ddoc', kind);
    }
    out.push({ el, kind });
  };
  const sels = [...(adapter?.blocks ?? []), ...GENERIC_SELECTORS];
  for (const [sel, kind] of sels) {
    if (root instanceof Element && root.matches(sel)) take(root, kind);
    root.querySelectorAll(sel).forEach((el) => take(el, kind));
  }
  // images: classify alt text
  root.querySelectorAll('img[alt]').forEach((img) => {
    const alt = (img as HTMLImageElement).alt;
    if (alt && alt.length > 12) out.push({ el: img, kind: 'alt' });
  });
  return out;
}

/**
 * @notice Queue new or changed blocks for classification.
 * @param root Subtree to scan. Defaults to the document.
 */
function scan(root: ParentNode = document) {
  if (!config) return;
  for (const { el, kind } of candidates(root)) {
    const text = kind === 'alt' ? (el as HTMLImageElement).alt : textOf(el);
    if (text.length < 15 || text.length > 6000) continue;
    if (processed.get(el) === text) continue;
    processed.set(el, text);
    if (config.profileKind === 'child') el.classList.add('ddoc-pending');
    queue.push({ el, text, kind });
  }
  if (queue.length && !flushTimer) flushTimer = setTimeout(flush, 120);
}

/**
 * @notice Send up to 40 queued blocks to the engine and apply the decisions.
 */
async function flush() {
  flushTimer = null;
  const batch = queue.splice(0, 40);
  if (!batch.length) return;
  try {
    const res: Decision[] = await call('classify', { host, blocks: batch.map((b) => ({ text: b.text, kind: b.kind })) });
    res.forEach((d, i) => apply(batch[i].el, d));
  } catch (e) {
    batch.forEach((b) => b.el.classList.remove('ddoc-pending'));
    console.debug('[ddoc] classify failed', e);
  }
  if (queue.length) flushTimer = setTimeout(flush, 50);
}

/* --------------------------- applying ------------------------------ */

/**
 * @notice Create an agent UI element. The `ddoc-ui` class keeps it out of later scans.
 * @param tag HTML tag name.
 * @param cls Class string.
 * @param text Optional text content.
 * @return The element.
 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * @notice The explanation panel for a decision.
 * @param d Decision to explain.
 * @return The panel element.
 */
function why(d: Decision) {
  const box = el('div', 'ddoc-ui ddoc-why');
  box.appendChild(el('div', 'ddoc-why-title', `Why: ${d.categoryLabel ?? 'Filtered'}`));
  box.appendChild(el('div', '', d.reason));
  box.appendChild(el('div', 'ddoc-meta', `Decided by: ${d.stage === 'learned' ? 'your own examples (on device)' : d.stage === 'rule' ? 'on-device safety rule' : 'JEV classifier'} · confidence ${Math.round(d.confidence * 100)}%`));
  return box;
}

/**
 * @notice The bar with Why, Show, and Not harmful.
 * @param target Block the bar belongs to.
 * @param d Decision being shown.
 * @param onReveal Called when the user asks to see the block.
 * @return The bar. Child profiles do not get Show or Not harmful except on a label.
 */
function controls(target: Element, d: Decision, onReveal: () => void) {
  const bar = el('div', 'ddoc-ui ddoc-bar ddoc-' + d.action);
  bar.dataset.ddocFor = d.id;
  bar.appendChild(el('span', 'ddoc-shield', '🛡'));
  bar.appendChild(el('span', 'ddoc-label', d.action === 'label' ? `${d.categoryLabel}` : `Hidden: ${d.categoryLabel}`));
  const whyBtn = el('button', 'ddoc-btn', 'Why?');
  whyBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const ex = bar.querySelector('.ddoc-why'); ex ? ex.remove() : bar.appendChild(why(d)); };
  bar.appendChild(whyBtn);
  if (!d.noReveal && !(config?.profileKind === 'child' && d.action !== 'label')) {
    if (d.action !== 'label') {
      const show = el('button', 'ddoc-btn', 'Show');
      show.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onReveal(); call('override', { id: d.id, kind: 'revealed' }); show.remove(); };
      bar.appendChild(show);
    }
    const fine = el('button', 'ddoc-btn', 'Not harmful');
    fine.title = 'Teach DDoC this is fine and appeal the decision';
    fine.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onReveal(); call('override', { id: d.id, kind: 'not_harmful' }); bar.remove(); };
    bar.appendChild(fine);
  }
  if (d.resources?.length) bar.appendChild(resources(d));
  return bar;
}

/**
 * @notice Links to the support services attached to a decision.
 * @param d Decision whose resources to render.
 * @return The link row.
 */
function resources(d: Decision) {
  const r = el('div', 'ddoc-resources');
  for (const x of d.resources ?? []) {
    const a = el('a', 'ddoc-res', x.phone ? `${x.name} ${x.phone}` : x.name);
    a.href = x.url; a.target = '_blank'; a.rel = 'noopener';
    r.appendChild(a);
  }
  return r;
}

/**
 * @notice Apply one decision to its element: label, blur, hide, support screen, or block the page.
 * @param target Element that was classified.
 * @param d Decision for that element.
 */
function apply(target: Element, d: Decision) {
  target.classList.remove('ddoc-pending');
  if (d.action === 'allow') return;
  decisions.set(d.id, d);
  const t = target as HTMLElement;
  // clean previous UI for this element
  if (t.previousElementSibling?.classList.contains('ddoc-bar')) t.previousElementSibling.remove();

  const insertBar = (bar: HTMLElement) => {
    if (target.tagName === 'IMG' || target.parentElement == null) { target.parentElement?.insertBefore(bar, target); return; }
    target.parentElement.insertBefore(bar, target);
  };

  switch (d.action) {
    case 'label':
      t.classList.add('ddoc-labelled');
      insertBar(controls(target, d, () => {}));
      break;
    case 'blur':
      t.classList.add('ddoc-blurred');
      insertBar(controls(target, d, () => t.classList.remove('ddoc-blurred')));
      blurNearbyMedia(t);
      break;
    case 'hide':
      t.classList.add('ddoc-hidden');
      insertBar(controls(target, d, () => t.classList.remove('ddoc-hidden')));
      break;
    case 'interstitial': {
      t.classList.add('ddoc-hidden');
      const card = controls(target, d, () => t.classList.remove('ddoc-hidden'));
      card.classList.add('ddoc-support');
      card.insertBefore(el('div', 'ddoc-support-msg', 'This may contain content about self-harm or disordered eating. If you are going through something, support is available any time.'), card.children[2]);
      insertBar(card);
      break;
    }
    case 'block_page':
      blockPage(d.categoryLabel ?? 'Blocked content', d.reason, d.resources);
      break;
  }
}

/**
 * @notice Blur images and video in the same post when the surrounding text is filtered.
 * @param t Filtered element.
 */
function blurNearbyMedia(t: HTMLElement) {
  const post = t.closest('article, [role=article], li, .post, .comment') ?? t.parentElement;
  post?.querySelectorAll('img, video').forEach((m) => (m as HTMLElement).classList.add('ddoc-blurred'));
}

/**
 * @notice Cover the page. Used for CSEA decisions and parent block-list hits.
 * @param title Heading.
 * @param reason Why the page is blocked.
 * @param res Optional support links.
 */
function blockPage(title: string, reason: string, res?: Decision['resources']) {
  if (document.getElementById('ddoc-block')) return;
  const o = el('div', 'ddoc-ui ddoc-block');
  o.id = 'ddoc-block';
  o.appendChild(el('div', 'ddoc-block-icon', '🛡'));
  o.appendChild(el('h1', '', title));
  o.appendChild(el('p', '', reason));
  if (res?.length) o.appendChild(resources({ resources: res } as Decision));
  const back = el('button', 'ddoc-btn ddoc-primary', 'Go back');
  back.onclick = () => history.back();
  o.appendChild(back);
  document.documentElement.appendChild(o);
  document.querySelectorAll('video, audio').forEach((m) => (m as HTMLMediaElement).pause());
}

/* ------------------------- design controls ------------------------- */

/**
 * @notice Apply this profile's feed controls on the current site.
 */
function applyDesign() {
  if (!config) return;
  const d = config.design;
  const a = adapterFor(host);
  const html = document.documentElement;
  html.classList.toggle('ddoc-no-counts', d.hideEngagementCounts);
  html.classList.toggle('ddoc-no-recs', d.hideRecommendations);
  html.classList.toggle('ddoc-no-ephemeral', d.hideEphemeral);
  if (a) {
    let css = '';
    if (d.hideEngagementCounts && a.counts) css += `${a.counts.join(',')}{visibility:hidden!important}`;
    if (d.hideRecommendations && a.recommendations) css += `${a.recommendations.join(',')}{display:none!important}`;
    if (d.hideEphemeral && a.ephemeral) css += `${a.ephemeral.join(',')}{display:none!important}`;
    let s = document.getElementById('ddoc-site-style');
    if (!s) { s = document.createElement('style'); s.id = 'ddoc-site-style'; (document.head ?? html).appendChild(s); }
    s.textContent = css;
    if (d.preferFollowingFeed && a.followingFeed) a.followingFeed();
  }
  if (d.disableAutoplay) {
    document.addEventListener('play', (e) => {
      const v = e.target as HTMLMediaElement;
      if (!(v as any).__ddocUserPlay) { v.pause(); v.autoplay = false; }
    }, true);
    document.addEventListener('pointerdown', (e) => {
      const v = (e.target as Element).closest?.('video') as any;
      if (v) v.__ddocUserPlay = true;
    }, true);
  }
  if (d.stopInfiniteScroll && a?.feedItem) watchScrollLimit(a.feedItem, d.scrollLimit);
}

/**
 * @notice Hide feed items past the profile's limit and offer adults a way to extend it.
 * @param itemSel Selector for one feed item.
 * @param limit How many items to leave visible.
 */
function watchScrollLimit(itemSel: string, limit: number) {
  let extended = 0;
  const check = () => {
    const items = document.querySelectorAll(itemSel);
    const max = limit + extended;
    if (items.length <= max) return;
    items.forEach((it, i) => (it as HTMLElement).classList.toggle('ddoc-hidden', i >= max));
    if (!document.getElementById('ddoc-scroll-stop')) {
      const bar = el('div', 'ddoc-ui ddoc-scroll-stop');
      bar.id = 'ddoc-scroll-stop';
      bar.appendChild(el('div', '', `You've reached your feed limit of ${max} posts. Endless scrolling is switched off for this profile.`));
      if (config?.profileKind === 'adult') {
        const more = el('button', 'ddoc-btn', `Show ${limit} more`);
        more.onclick = () => { extended += limit; bar.remove(); check(); };
        bar.appendChild(more);
      }
      items[max - 1]?.after(bar);
    }
  };
  setInterval(check, 1500);
}

/* ------------------------- teach by selection ---------------------- */

let pill: HTMLElement | null = null;

/**
 * @notice Show the Teach DDoC pill under the current text selection.
 */
function onSelection() {
  const sel = document.getSelection();
  const text = sel?.toString().trim() ?? '';
  pill?.remove(); pill = null;
  if (text.length < 4 || !sel?.rangeCount || !config) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  pill = el('button', 'ddoc-ui ddoc-pill', '🛡 Teach DDoC');
  pill.style.top = `${window.scrollY + rect.bottom + 6}px`;
  pill.style.left = `${window.scrollX + rect.left}px`;
  pill.onmousedown = (e) => e.preventDefault();
  pill.onclick = () => { openTeach(text); pill?.remove(); pill = null; };
  document.documentElement.appendChild(pill);
}

/**
 * @notice Open the teach dialog for a piece of text.
 * @param text Selected text, or text sent by the desktop Teach menu.
 */
export function openTeach(text: string) {
  document.getElementById('ddoc-teach')?.remove();
  const cats = config?.allCategories ?? [];
  const m = el('div', 'ddoc-ui ddoc-modal');
  m.id = 'ddoc-teach';
  m.innerHTML = `
    <div class="ddoc-card">
      <div class="ddoc-why-title">Teach DDoC</div>
      <blockquote class="ddoc-quote"></blockquote>
      <label>This is
        <select name="pol"><option value="harmful">something I don't want to see</option><option value="fine">fine, don't filter things like this</option></select>
      </label>
      <label>Category <select name="cat"></select></label>
      <label>Why? (optional, helps you review later) <input name="note" maxlength="200" placeholder="e.g. body-shaming comments"></label>
      <div class="ddoc-row"><button class="ddoc-btn" data-x>Cancel</button><button class="ddoc-btn ddoc-primary" data-ok>Save</button></div>
      <div class="ddoc-meta">Stays on this device. DDoC will look for similar content on every site.</div>
    </div>`;
  (m.querySelector('.ddoc-quote') as HTMLElement).textContent = text.slice(0, 400);
  const sel = m.querySelector('select[name=cat]') as HTMLSelectElement;
  for (const c of cats) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label + (c.custom ? ' (yours)' : ''); sel.appendChild(o); }
  (m.querySelector('[data-x]') as HTMLElement).onclick = () => m.remove();
  (m.querySelector('[data-ok]') as HTMLElement).onclick = async () => {
    const pol = (m.querySelector('select[name=pol]') as HTMLSelectElement).value;
    const note = (m.querySelector('input[name=note]') as HTMLInputElement).value;
    await call('tag', { text, categoryId: sel.value, polarity: pol, note, host });
    m.remove();
    toast(pol === 'fine' ? 'Got it. Similar content will be left alone.' : 'Got it. Similar content will be filtered across sites.');
    rescan();
  };
  document.documentElement.appendChild(m);
}

/**
 * @notice Show a short message and remove it after a few seconds.
 * @param msg Message text.
 */
function toast(msg: string) {
  const t = el('div', 'ddoc-ui ddoc-toast', msg);
  document.documentElement.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/**
 * @notice Drop applied decisions and classify the page again after the user teaches an example.
 */
function rescan() {
  // re-evaluate everything, since learned examples changed
  document.querySelectorAll('.ddoc-bar').forEach((b) => b.remove());
  document.querySelectorAll('.ddoc-blurred, .ddoc-hidden, .ddoc-labelled').forEach((e) => e.classList.remove('ddoc-blurred', 'ddoc-hidden', 'ddoc-labelled'));
  // reset processed map by replacing it
  (processedReset as any)();
  scan();
}
/**
 * @notice Forget which elements have already been classified so a rescan can see them.
 */
const processedReset = () => { document.querySelectorAll('*').forEach((e) => processed.delete(e)); };

/* ------------------------- link warnings --------------------------- */

/**
 * @notice Intercept clicks on lookalike domains and ask before opening them.
 */
function guardLinks() {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.dataset.ddocOk) return;
    const v = checkUrl(a.href);
    if (!v.suspicious) return;
    e.preventDefault(); e.stopPropagation();
    const m = el('div', 'ddoc-ui ddoc-modal');
    m.innerHTML = `<div class="ddoc-card"><div class="ddoc-why-title">⚠ Possible scam link</div><p></p><code></code>
      <div class="ddoc-row"><button class="ddoc-btn ddoc-primary" data-x>Stay safe</button><button class="ddoc-btn" data-go>Open anyway</button></div></div>`;
    (m.querySelector('p') as HTMLElement).textContent = v.reason ?? '';
    (m.querySelector('code') as HTMLElement).textContent = new URL(a.href).hostname;
    (m.querySelector('[data-x]') as HTMLElement).onclick = () => m.remove();
    (m.querySelector('[data-go]') as HTMLElement).onclick = () => { m.remove(); a.dataset.ddocOk = '1'; a.click(); };
    document.documentElement.appendChild(m);
  }, true);
}

/* ------------------------------ boot ------------------------------- */

/**
 * @notice Start the agent once per frame: load config, style, scan, and watch for new nodes.
 */
async function boot() {
  if (w.__ddocBooted) return;
  w.__ddocBooted = true;
  try { config = await call('pageConfig', { host }); } catch (e) { console.debug('[ddoc] no bridge', e); return; }
  injectStyles();
  if (config!.blocked.blocked) { blockPage('Site blocked for this profile', config!.blocked.reason ?? ''); return; }
  const top = checkUrl(location.href);
  if (top.suspicious && window === window.top) toast(`⚠ ${top.reason}`);
  applyDesign();
  guardLinks();
  scan();
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !(n as Element).closest('.ddoc-ui')) scan(n as Element); });
    if (muts.some((m) => m.type === 'characterData')) scan();
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('selectionchange', () => { clearTimeout(w.__ddocSelT); w.__ddocSelT = setTimeout(onSelection, 350); });
}

w.__ddocOpenTeach = openTeach;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
