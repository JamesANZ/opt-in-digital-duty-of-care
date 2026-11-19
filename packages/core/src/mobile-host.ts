/**
 * Engine host for Android and iOS. Loaded into a hidden "engine" WebView by the native app.
 * Native code relays page-agent and dashboard messages here and persists state with the
 * platform keystore (Android Keystore / iOS Keychain). JEV HTTP goes through native code so
 * the API key never enters a page context and CORS does not apply.
 */
import { defaultState, Engine, EngineState } from './engine';
import { FetchLike, JevClient } from './jev';
import { handle } from './rpc';

declare const DDocNative: { save(json: string): void; fetch(id: number, url: string, init: string): void } | undefined;

const w = globalThis as any;
let engine: Engine;
let fetchSeq = 0;
const fetches = new Map<number, (r: { ok: boolean; status: number; body: string }) => void>();

function toNative(msg: any) {
  if (typeof DDocNative !== 'undefined') {
    if (msg.type === 'save') DDocNative.save(msg.json);
    else DDocNative.fetch(msg.id, msg.url, JSON.stringify(msg.init));
  } else w.webkit?.messageHandlers?.native?.postMessage(msg);
}

const nativeFetch: FetchLike = (url, init) => new Promise((resolve) => {
  const id = ++fetchSeq;
  fetches.set(id, (r) => resolve({ ok: r.ok, status: r.status, json: async () => JSON.parse(r.body), text: async () => r.body }));
  toNative({ type: 'fetch', id, url, init: { method: init.method, headers: init.headers, body: init.body } });
});

function rebuild() {
  const s = engine.state.settings;
  engine.classifier = s.jevApiKey ? new JevClient({ apiKey: s.jevApiKey, baseURL: s.jevBaseURL, model: s.jevModel, fetch: nativeFetch }) : undefined;
}

let saveTimer: any;
let unlockedUntil = 0;

w.DDoCHost = {
  init(stateJson: string | null) {
    let state: EngineState = defaultState();
    try { if (stateJson) state = JSON.parse(stateJson); } catch { /* corrupt: start fresh */ }
    engine = new Engine(state);
    engine.onChange = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => toNative({ type: 'save', json: JSON.stringify(engine.state) }), 600);
    };
    rebuild();
    return true;
  },
  /** Returns a JSON string: { ok, result } or { ok:false, error }. */
  async handle(msgJson: string, trusted: boolean): Promise<string> {
    try {
      const msg = JSON.parse(msgJson);
      if (trusted && msg.method === 'unlock') {
        const ok = await handle(engine, { method: 'verifyPin', params: msg.params }, { trusted: true });
        if (ok) unlockedUntil = Date.now() + 10 * 60_000;
        return JSON.stringify({ ok: true, result: ok });
      }
      if (trusted && msg.method === 'lockState') {
        return JSON.stringify({ ok: true, result: { locked: engine.profile.locked, unlocked: Date.now() < unlockedUntil, hasPin: !!engine.state.settings.parentPinHash } });
      }
      const result = await handle(engine, msg, { trusted, unlocked: Date.now() < unlockedUntil });
      if (msg.method === 'setSettings' || msg.method === 'wipe') rebuild();
      return JSON.stringify({ ok: true, result: result ?? null });
    } catch (e) {
      return JSON.stringify({ ok: false, error: (e as Error).message });
    }
  },
  fetchResult(id: number, ok: boolean, status: number, body: string) {
    fetches.get(id)?.({ ok, status, body });
    fetches.delete(id);
  },
  hostPolicy(host: string) { return JSON.stringify(engine.hostPolicy(host)); },
  activeProfile() { const p = engine.profile; return JSON.stringify({ kind: p.kind, allowPrivateWindows: p.allowPrivateWindows, name: p.name }); },
};
