/**
 * DDoC Browser desktop shell (Windows, macOS, Linux).
 * Chromium content layer via Electron. The safety engine runs in this main process; pages get
 * the agent through a sandboxed preload in an isolated world, so sites cannot see or tamper with it.
 */
import { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, safeStorage, protocol, net, shell, dialog, clipboard, Session } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Engine, EngineState, defaultState, EncryptedStore, handle, JevClient, randomKey, checkUrl, b64e, b64d } from '../../../packages/core/src';
import { loadEnv } from '../../../scripts/load-env.ts';

// dist/main.js -> apps/desktop/.env, then the repo-root .env. Shell wins; desktop file wins over root.
loadEnv([
  path.join(__dirname, '..', '..', '..', '.env'),
  path.join(__dirname, '..', '.env'),
]);

const UI = path.join(__dirname, '..', 'ui');
const ICON = path.join(UI, 'icon.png');
const DIST = __dirname;
const DATA = app.getPath('userData');
const HEADLESS_DEMO = process.env.DDOC_DEMO === '1';

protocol.registerSchemesAsPrivileged([{ scheme: 'ddoc', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/* ---------------------------- persistence ---------------------------- */

function fileBackend(name: string) {
  const f = path.join(DATA, name);
  return {
    read: async () => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null),
    write: async (d: string) => { fs.writeFileSync(f + '.tmp', d); fs.renameSync(f + '.tmp', f); },
  };
}

function storeKey(): Uint8Array {
  const f = path.join(DATA, 'key.bin');
  if (fs.existsSync(f)) {
    const blob = fs.readFileSync(f);
    const b64 = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(blob) : blob.toString('utf8');
    return b64d(b64);
  }
  const k = randomKey();
  const b64 = b64e(k);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(f, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(b64) : Buffer.from(b64), { mode: 0o600 });
  return k;
}

interface BrowserData {
  bookmarks: { title: string; url: string }[];
  history: { title: string; url: string; ts: number }[];
}

let engine: Engine;
let engineStore: EncryptedStore<EngineState>;
let dataStore: EncryptedStore<BrowserData>;
let browserData: BrowserData = { bookmarks: [], history: [] };
let saveTimer: NodeJS.Timeout | null = null;
let unlockedUntil = 0;
const downloads: { id: number; name: string; path: string; state: string; received: number; total: number }[] = [];

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await engineStore.save(engine.state);
    await dataStore.save(browserData);
  }, 800);
}

function rebuildClassifier() {
  const s = engine.state.settings;
  const apiKey = s.jevApiKey || process.env.TYPESAFE_API_KEY;
  engine.classifier = apiKey ? new JevClient({ apiKey, baseURL: s.jevBaseURL || process.env.TYPESAFE_BASE_URL, model: s.jevModel || undefined }) : undefined;
}

/* ------------------------------ windows ------------------------------ */

interface Tab { id: number; view: WebContentsView; title: string; url: string; loading: boolean; }
interface Win { win: BrowserWindow; tabs: Tab[]; active: number; isPrivate: boolean; ses: Session; }
const wins = new Map<number, Win>();
let tabSeq = 0;
const CHROME_H = 84;

function ddocHandler(req: Request): Promise<Response> | Response {
  const u = new URL(req.url);
  const rel = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
  const base = u.hostname === 'ui' ? UI : DIST;
  const file = path.join(base, rel);
  if (!file.startsWith(base)) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

function attachSession(ses: Session) {
  // Every session (persistent and private) serves the internal ddoc:// pages.
  if (!ses.protocol.isProtocolHandled('ddoc')) ses.protocol.handle('ddoc', ddocHandler);
    ses.on('will-download', (_e, item) => {
    const d = { id: downloads.length + 1, name: item.getFilename(), path: '', state: 'progressing', received: 0, total: item.getTotalBytes() };
    downloads.unshift(d);
    item.on('updated', () => { d.received = item.getReceivedBytes(); d.state = item.getState(); broadcast(); });
    item.once('done', (_e2, state) => { d.state = state; d.path = item.getSavePath(); broadcast(); });
  });
}

function createWindow(isPrivate = false) {
  if (isPrivate && !engine.profile.allowPrivateWindows) {
    dialog.showMessageBox({ message: 'Private windows are turned off for this profile.' });
    return;
  }
  const win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 720, minHeight: 480,
    title: isPrivate ? 'DDoC Browser (Private)' : 'DDoC Browser',
    icon: ICON,
    backgroundColor: isPrivate ? '#1b1530' : '#f6f7fb',
    webPreferences: { preload: path.join(DIST, 'chrome-preload.js'), contextIsolation: true, sandbox: true },
  });
  const ses = isPrivate ? session.fromPartition('ddoc-private-' + Date.now()) : session.fromPartition('persist:ddoc');
  if (isPrivate) attachSession(ses);
  const w: Win = { win, tabs: [], active: -1, isPrivate, ses };
  wins.set(win.id, w);
  win.loadURL(`ddoc://ui/browser.html${isPrivate ? '?private=1' : ''}`);
  win.on('resize', () => layout(w));
  win.on('closed', () => wins.delete(win.id));
  win.webContents.once('did-finish-load', () => newTab(w, HEADLESS_DEMO ? 'http://127.0.0.1:4777/forum.html' : 'ddoc://ui/newtab.html'));
  return w;
}

function layout(w: Win) {
  const [width, height] = w.win.getContentSize();
  w.tabs.forEach((t, i) => {
    t.view.setVisible(i === w.active);
    if (i === w.active) t.view.setBounds({ x: 0, y: CHROME_H, width, height: height - CHROME_H });
  });
}

function isInternal(url: string) { return url.startsWith('ddoc://'); }

function newTab(w: Win, url = 'ddoc://ui/newtab.html') {
  const view = new WebContentsView({
    webPreferences: {
      session: w.ses,
      preload: path.join(DIST, 'page-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegrationInSubFrames: true,
      webSecurity: true,
    },
  });
  const tab: Tab = { id: ++tabSeq, view, title: 'New tab', url, loading: false };
  w.tabs.push(tab);
  w.win.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: u }) => { newTab(w, u); return { action: 'deny' }; });
  wc.on('page-title-updated', (_e, t) => { tab.title = t; broadcast(); });
  wc.on('did-start-loading', () => { tab.loading = true; broadcast(); });
  wc.on('did-stop-loading', () => { tab.loading = false; broadcast(); });
  wc.on('did-navigate', (_e, u) => {
    tab.url = u;
    if (!w.isPrivate && !isInternal(u)) {
      browserData.history.unshift({ title: tab.title, url: u, ts: Date.now() });
      browserData.history.length = Math.min(browserData.history.length, 5000);
      scheduleSave();
    }
    broadcast();
  });
  wc.on('did-navigate-in-page', (_e, u) => { tab.url = u; broadcast(); });
  wc.on('will-navigate', (e, u) => guardNavigation(e, u, wc));
  wc.on('context-menu', (_e, p) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (p.selectionText) {
      items.push({ label: 'Teach DDoC about this selection…', click: () => wc.send('ddoc:teach', p.selectionText) });
      items.push({ label: 'Copy', role: 'copy' }, { type: 'separator' });
    }
    if (p.linkURL) items.push({ label: 'Open link in new tab', click: () => newTab(w, p.linkURL) }, { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: 'Reload', click: () => wc.reload() }, { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup();
  });
  wc.loadURL(url);
  w.active = w.tabs.length - 1;
  layout(w);
  broadcast();
  return tab;
}

function guardNavigation(e: Electron.Event, url: string, wc: Electron.WebContents) {
  try {
    const host = new URL(url).hostname;
    const pol = engine.hostPolicy(host);
    if (pol.blocked) { e.preventDefault(); wc.loadURL(`ddoc://ui/blocked.html?host=${encodeURIComponent(host)}`); }
  } catch { /* ignore */ }
}

function closeTab(w: Win, idx: number) {
  const t = w.tabs[idx];
  if (!t) return;
  w.win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  w.tabs.splice(idx, 1);
  if (w.tabs.length === 0) { w.win.close(); return; }
  w.active = Math.min(w.active, w.tabs.length - 1);
  layout(w);
  broadcast();
}

function broadcast() {
  for (const w of wins.values()) {
    if (w.win.isDestroyed()) continue;
    w.win.webContents.send('ddoc:tabs', {
      tabs: w.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, loading: t.loading,
        canBack: t.view.webContents.navigationHistory.canGoBack(), canFwd: t.view.webContents.navigationHistory.canGoForward() })),
      active: w.active,
      isPrivate: w.isPrivate,
      profile: { name: engine.profile.name, kind: engine.profile.kind },
      bookmarked: browserData.bookmarks.some((b) => b.url === w.tabs[w.active]?.url),
      filtered: engine.state.counters.filtered,
      downloads: downloads.slice(0, 20),
    });
  }
}

function toUrl(input: string): string {
  const s = input.trim();
  if (/^(https?|ddoc|file):\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !s.includes(' ')) return 'https://' + s;
  return engine.state.settings.searchEngine.replace('%s', encodeURIComponent(s));
}

/* -------------------------------- IPC -------------------------------- */

function winOf(sender: Electron.WebContents): Win | undefined {
  const direct = wins.get(BrowserWindow.fromWebContents(sender)?.id ?? -1);
  if (direct) return direct;
  for (const w of wins.values()) if (w.tabs.some((t) => t.view.webContents.id === sender.id)) return w;
  return undefined;
}

function registerIpc() {
  // Page agent (untrusted pages): only page methods allowed.
  ipcMain.handle('ddoc:page', async (e, method: string, params: any) => {
    let host = '';
    try { host = new URL(e.senderFrame?.url ?? '').hostname; } catch { /* */ }
    return handle(engine, { method, params: { ...params, host } }, { trusted: false });
  });

  // Dashboard (only from ddoc:// internal pages).
  ipcMain.handle('ddoc:admin', async (e, method: string, params: any) => {
    const url = e.senderFrame?.url ?? '';
    if (!url.startsWith('ddoc://ui/')) throw new Error('Not allowed');
    if (method === 'unlock') {
      const ok = await handle(engine, { method: 'verifyPin', params }, { trusted: true });
      if (ok) unlockedUntil = Date.now() + 10 * 60_000;
      return ok;
    }
    if (method === 'lockState') return { locked: engine.profile.locked, unlocked: Date.now() < unlockedUntil, hasPin: !!engine.state.settings.parentPinHash };
    if (method === 'browserData') return { ...browserData, downloads };
    if (method === 'removeBookmark') { browserData.bookmarks = browserData.bookmarks.filter((b) => b.url !== params.url); scheduleSave(); broadcast(); return true; }
    if (method === 'clearHistory') { browserData.history = []; scheduleSave(); return true; }
    if (method === 'exportReport') {
      const r = await dialog.showSaveDialog({ defaultPath: 'ddoc-transparency-report.json' });
      if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, JSON.stringify(engine.report(), null, 2));
      return !r.canceled;
    }
    const res = await handle(engine, { method, params }, { trusted: true, unlocked: Date.now() < unlockedUntil });
    if (['setSettings', 'wipe'].includes(method)) rebuildClassifier();
    if (['switchProfile', 'updateDesign', 'updateProfile', 'updateSetting', 'addCustomCategory', 'removeCustomCategory', 'tagExample', 'deleteExample'].includes(method)) {
      for (const w of wins.values()) for (const t of w.tabs) if (!isInternal(t.url)) t.view.webContents.reload();
    }
    broadcast();
    return res;
  });

  // Browser chrome.
  ipcMain.on('ddoc:chrome', (e, cmd: string, arg: any) => {
    const w = winOf(e.sender);
    if (!w) return;
    const t = w.tabs[w.active];
    const wc = t?.view.webContents;
    switch (cmd) {
      case 'navigate': wc?.loadURL(toUrl(String(arg))); break;
      case 'back': wc?.navigationHistory.goBack(); break;
      case 'forward': wc?.navigationHistory.goForward(); break;
      case 'reload': wc?.reload(); break;
      case 'stop': wc?.stop(); break;
      case 'newTab': newTab(w, arg || undefined); break;
      case 'closeTab': closeTab(w, typeof arg === 'number' ? arg : w.active); break;
      case 'activate': w.active = arg; layout(w); broadcast(); break;
      case 'dashboard': newTab(w, 'ddoc://ui/dashboard.html' + (arg ? '#' + arg : '')); break;
      case 'privateWindow': createWindow(true); break;
      case 'newWindow': createWindow(false); break;
      case 'bookmark': {
        if (!t || w.isPrivate) break;
        const i = browserData.bookmarks.findIndex((b) => b.url === t.url);
        if (i >= 0) browserData.bookmarks.splice(i, 1); else browserData.bookmarks.unshift({ title: t.title, url: t.url });
        scheduleSave(); broadcast(); break;
      }
      case 'openDownload': shell.showItemInFolder(String(arg)); break;
      case 'teach': wc?.send('ddoc:teach', ''); break;
    }
  });
}

/* ------------------------------ startup ------------------------------ */

app.whenReady().then(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  const key = storeKey();
  engineStore = new EncryptedStore<EngineState>(fileBackend('engine.enc'), key);
  dataStore = new EncryptedStore<BrowserData>(fileBackend('browser.enc'), key);
  let state: EngineState;
  try { state = await engineStore.load(defaultState()); } catch { state = defaultState(); }
  try { browserData = await dataStore.load(browserData); } catch { /* fresh */ }
  if (process.env.DDOC_SEED_DEMO === '1' || HEADLESS_DEMO) seedDemo(state);
  if (HEADLESS_DEMO) {
    const http = await import('node:http');
    const demoDir = path.join(__dirname, '..', 'demo');
    http.createServer((req, res) => {
      const f = path.join(demoDir, path.basename(req.url || 'forum.html'));
      if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(f));
    }).listen(4777, '127.0.0.1');
    // Demo/test control port (only in DDOC_DEMO mode): drive the browser for screenshots and e2e tests.
    http.createServer(async (req, res) => {
      const u = new URL(req.url || '/', 'http://x');
      const w = [...wins.values()][0];
      const wc = w?.tabs[w.active]?.view.webContents;
      try {
        let out: any = 'ok';
        if (u.pathname === '/js' && wc) out = await wc.executeJavaScript(u.searchParams.get('code') || '');
        if (u.pathname === '/tab' && w) newTab(w, u.searchParams.get('url') || undefined);
        if (u.pathname === '/activate' && w) { w.active = Number(u.searchParams.get('i')); layout(w); broadcast(); }
        if (u.pathname === '/rpc') out = await handle(engine, JSON.parse(u.searchParams.get('msg') || '{}'), { trusted: true, unlocked: true });
        if (u.pathname === '/reload') for (const t of w?.tabs ?? []) t.view.webContents.reload();
        res.end(JSON.stringify(out ?? null));
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    }).listen(4779, '127.0.0.1');
  }
  engine = new Engine(state);
  let bt: NodeJS.Timeout | null = null;
  engine.onChange = () => { scheduleSave(); if (!bt) bt = setTimeout(() => { bt = null; broadcast(); }, 300); };
  rebuildClassifier();

  protocol.handle('ddoc', ddocHandler);
  attachSession(session.fromPartition('persist:ddoc'));
  if (process.platform === 'darwin') app.dock?.setIcon(ICON);
  registerIpc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'DDoC', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: (_m, bw) => { const w = bw && wins.get(bw.id); if (w) newTab(w); } },
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow(false) },
      { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow(true) },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: (_m, bw) => { const w = bw && wins.get(bw.id); if (w) closeTab(w, w.active); } },
    ] },
    { role: 'editMenu' },
    { label: 'Safety', submenu: [
      { label: 'Safety Dashboard', accelerator: 'CmdOrCtrl+Shift+D', click: (_m, bw) => { const w = bw && wins.get(bw.id); if (w) newTab(w, 'ddoc://ui/dashboard.html'); } },
    ] },
    { role: 'viewMenu' },
  ]));
  createWindow(false);
});

app.on('window-all-closed', async () => {
  if (engineStore) await engineStore.save(engine.state);
  if (dataStore) await dataStore.save(browserData);
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (wins.size === 0) createWindow(false); });

/** Demo seed so a fresh install shows the learning loop without an API key. */
function seedDemo(s: EngineState) {
  if (s.examples.length) return;
  const e = new Engine(s);
  const cat = e.addCustomCategory('Body-shaming', 'Comments mocking someone\'s weight, size or appearance');
  e.tag('you are so fat and ugly, nobody wants to see that', cat.id, 'harmful', 'Body-shaming comments upset me', 'demo');
  e.tag('omg ur so ugly lol delete this', 'cyberbullying', 'harmful', 'Mean pile-on comments', 'demo');
  e.tag('The health minister was criticised for the budget cuts', cat.id, 'fine', 'Political criticism is fine', 'demo');
}

void checkUrl; // re-exported for page agent bundle parity
