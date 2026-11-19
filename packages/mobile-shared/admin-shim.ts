/* Mobile: gives the shared dashboard the same window.ddocAdmin API the desktop preload exposes. */
(() => {
  if (window.ddocAdmin) return;
  let seq = 0;
  const pending: Record<number, { res: (value: unknown) => void; rej: (err: Error) => void }> = {};
  function send(kind: string, method: string, params?: unknown): Promise<unknown> {
    const id = ++seq;
    const msg = JSON.stringify({ id, kind, method, params: params ?? {} });
    const ios = window.webkit?.messageHandlers?.ddocAdmin;
    if (ios) {
      return ios.postMessage(msg).then((r) => {
        const m = JSON.parse(r) as { ok: boolean; error?: string; result?: unknown };
        if (!m.ok) throw new Error(m.error);
        return m.result;
      });
    }
    return new Promise((res, rej) => {
      pending[id] = { res, rej };
      window.DDocAdminAndroid?.postMessage(msg);
    });
  }
  if (window.DDocAdminAndroid) {
    window.DDocAdminAndroid.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as { id: number; ok: boolean; error?: string; result?: unknown };
      const p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      m.ok ? p.res(m.result) : p.rej(new Error(m.error));
    };
  }
  window.ddocAdmin = {
    call: (method, params) => send('admin', method, params),
    chrome: (cmd, arg) => { void send('chrome', cmd, { arg }); },
  };
})();
