/**
 * @title Mobile host tests
 * @notice Runs the bundle Android and iOS load, with a stubbed native layer, so that path is tested without the mobile toolchains.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const bundle = path.resolve(__dirname, '../../../dist/shared/ddoc-engine.js');

/**
 * @notice Load the engine bundle in a VM with a fake native bridge.
 * @return The host object plus the saves and fetches it recorded.
 */
function boot() {
  const saved: string[] = [];
  const fetches: { id: number; url: string; init: string }[] = [];
  const ctx: any = {
    crypto: globalThis.crypto, atob, btoa, TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortController, console,
    DDocNative: { save: (j: string) => saved.push(j), fetch: (id: number, url: string, init: string) => fetches.push({ id, url, init }) },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(bundle, 'utf8'), ctx);
  return { host: ctx.DDoCHost, saved, fetches };
}

describe.runIf(fs.existsSync(bundle))('mobile engine bundle', () => {
  it('classifies on-device and refuses dashboard methods from pages', async () => {
    const { host } = boot();
    host.init(null);
    const r = JSON.parse(await host.handle(JSON.stringify({ method: 'classify', params: { host: 'x.com', blocks: [{ text: 'honestly just kill yourself, nobody would miss you', kind: 'comment' }] } }), false));
    expect(r.ok).toBe(true);
    expect(r.result[0].action).toBe('interstitial');
    const denied = JSON.parse(await host.handle(JSON.stringify({ method: 'setSettings', params: { jevMode: 'off' } }), false));
    expect(denied.ok).toBe(false);
  });

  it('routes JEV calls through native fetch and persists via native save', async () => {
    const { host, fetches, saved } = boot();
    host.init(null);
    await host.handle(JSON.stringify({ method: 'setSettings', params: { jevApiKey: 'k', jevMode: 'all' } }), true);
    const p = host.handle(JSON.stringify({ method: 'classify', params: { blocks: [{ text: 'Everyone go pile on her, she is worthless', kind: 'comment' }] } }), false);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(JSON.parse(fetches[0].init).headers.Authorization).toBe('Bearer k');
    host.fetchResult(fetches[0].id, true, 200, JSON.stringify({ answers: { harm: { choice: 'harassment', probabilities: { harassment: 0.9 } }, context: { choice: 'direct_harm', probabilities: { direct_harm: 0.9 } }, severity: { score: 3 } } }));
    const r = JSON.parse(await p);
    expect(r.result[0].action).toBe('blur');
    await new Promise((r2) => setTimeout(r2, 700));
    expect(saved.length).toBeGreaterThan(0);
    expect(JSON.parse(saved.at(-1)!).settings.jevApiKey).toBe('k');
  });

  it('protected profiles require the parent PIN', async () => {
    const { host } = boot();
    host.init(null);
    await host.handle(JSON.stringify({ method: 'setPin', params: { pin: '2468' } }), true);
    const id = JSON.parse(await host.handle(JSON.stringify({ method: 'addProfile', params: { name: 'Kid', kind: 'child' } }), true)).result;
    await host.handle(JSON.stringify({ method: 'switchProfile', params: { profileId: id } }), true);
    const blocked = JSON.parse(await host.handle(JSON.stringify({ method: 'switchProfile', params: { profileId: 'me', pin: '0000' } }), true));
    expect(blocked.ok).toBe(false);
    const ok = JSON.parse(await host.handle(JSON.stringify({ method: 'switchProfile', params: { profileId: 'me', pin: '2468' } }), true));
    expect(ok.ok).toBe(true);
  });
});
