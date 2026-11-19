/**
 * @title Mobile engine host
 * @notice The object Android and iOS call inside the hidden engine WebView.
 * @dev Native code relays page and dashboard messages and persists state in the platform keystore. JEV HTTP goes through native code so the API key never enters a page and CORS does not apply.
 */
import { defaultState, Engine, EngineState } from './engine';
import { FetchLike, JevClient } from './jev';
import { handle } from './rpc';

/**
 * @notice Android bridge injected into the engine WebView. iOS uses `webkit.messageHandlers.native` instead.
 */
declare const DDocNative: { save(json: string): void; fetch(id: number, url: string, init: string): void } | undefined;

const w = globalThis as any;
let engine: Engine;
let fetchSeq = 0;
const fetches = new Map<number, (r: { ok: boolean; status: number; body: string }) => void>();

/**
 * @notice Send a save or fetch request to the native shell.
 * @param msg `{ type: 'save', json }` or `{ type: 'fetch', id, url, init }`.
 */
function toNative(msg: any) {
  if (typeof DDocNative !== 'undefined') {
    if (msg.type === 'save') DDocNative.save(msg.json);
    else DDocNative.fetch(msg.id, msg.url, JSON.stringify(msg.init));
  } else w.webkit?.messageHandlers?.native?.postMessage(msg);
}

/**
 * @notice `fetch` implementation that lets the native shell perform the HTTP request.
 * @param url Request URL.
 * @param init Method, headers, and body.
 * @return A response-like object resolved by `DDoCHost.fetchResult`.
 */
const nativeFetch: FetchLike = (url, init) => new Promise((resolve) => {
  const id = ++fetchSeq;
  fetches.set(id, (r) => resolve({ ok: r.ok, status: r.status, json: async () => JSON.parse(r.body), text: async () => r.body }));
  toNative({ type: 'fetch', id, url, init: { method: init.method, headers: init.headers, body: init.body } });
});

/**
 * @notice Attach or remove the JEV client after settings change.
 * @dev No API key means on-device decisions only.
 */
function rebuild() {
  const s = engine.state.settings;
  engine.classifier = s.jevApiKey ? new JevClient({ apiKey: s.jevApiKey, baseURL: s.jevBaseURL, model: s.jevModel, fetch: nativeFetch }) : undefined;
}

let saveTimer: any;
let unlockedUntil = 0;

/**
 * @title DDoCHost
 * @notice Native entry points: init, handle, fetchResult, hostPolicy, and activeProfile.
 */
w.DDoCHost = {
  /**
   * @notice Load saved state and start the engine.
   * @param stateJson Persisted engine JSON, or null for a fresh profile.
   * @return True once the engine is ready. Corrupt JSON starts fresh.
   */
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
  /**
   * @notice Run one RPC call and return JSON.
   * @param msgJson `{ method, params }` JSON.
   * @param trusted True for the dashboard, false for a page.
   * @return `{ ok, result }` or `{ ok: false, error }`.
   */
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
  /**
   * @notice Deliver the native HTTP response for a JEV call.
   * @param id Id from the matching fetch request.
   * @param ok Whether the HTTP status was successful.
   * @param status HTTP status code.
   * @param body Response body text.
   */
  fetchResult(id: number, ok: boolean, status: number, body: string) {
    fetches.get(id)?.({ ok, status, body });
    fetches.delete(id);
  },
  /**
   * @notice Whether the active profile blocks this host.
   * @param host Hostname.
   * @return JSON `{ blocked, reason? }`.
   */
  hostPolicy(host: string) { return JSON.stringify(engine.hostPolicy(host)); },
  /**
   * @notice The active profile's kind, name, and private-window flag.
   * @return JSON `{ kind, allowPrivateWindows, name }`.
   */
  activeProfile() { const p = engine.profile; return JSON.stringify({ kind: p.kind, allowPrivateWindows: p.allowPrivateWindows, name: p.name }); },
};
