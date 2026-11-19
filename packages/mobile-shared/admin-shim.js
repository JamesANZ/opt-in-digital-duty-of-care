/* Mobile: gives the shared dashboard the same window.ddocAdmin API the desktop preload exposes. */
(function () {
  if (window.ddocAdmin) return;
  var seq = 0, pending = {};
  function send(kind, method, params) {
    var id = ++seq, msg = JSON.stringify({ id: id, kind: kind, method: method, params: params || {} });
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ddocAdmin) {
      return window.webkit.messageHandlers.ddocAdmin.postMessage(msg).then(function (r) {
        var m = JSON.parse(r); if (!m.ok) throw new Error(m.error); return m.result;
      });
    }
    return new Promise(function (res, rej) {
      pending[id] = { res: res, rej: rej };
      window.DDocAdminAndroid.postMessage(msg);
    });
  }
  if (window.DDocAdminAndroid) {
    window.DDocAdminAndroid.onmessage = function (ev) {
      var m = JSON.parse(ev.data), p = pending[m.id]; if (!p) return; delete pending[m.id];
      m.ok ? p.res(m.result) : p.rej(new Error(m.error));
    };
  }
  window.ddocAdmin = {
    call: function (method, params) { return send('admin', method, params); },
    chrome: function (cmd, arg) { send('chrome', cmd, { arg: arg }); },
  };
  window.confirm = window.confirm || function () { return true; };
})();
