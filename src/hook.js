// MAIN world で document_start に実行。console のエラーと失敗した通信を直近分だけ記録する。
// 隔離環境の overlay.js からは DOM イベント (ghfb:request / ghfb:response) 経由で読み出す。
(() => {
  if (window.__ghfbHook) return;
  window.__ghfbHook = true;

  const MAX = 30;
  const logs = [];
  const net = [];
  const push = (arr, item) => {
    arr.push({ t: Date.now(), ...item });
    if (arr.length > MAX) arr.shift();
  };
  const fmt = (a) => {
    try {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object' && a !== null) return JSON.stringify(a);
      return String(a);
    } catch {
      return String(a);
    }
  };

  for (const level of ['error', 'warn']) {
    const orig = console[level];
    console[level] = function (...args) {
      push(logs, { level, msg: args.map(fmt).join(' ').slice(0, 500) });
      return orig.apply(this, args);
    };
  }

  window.addEventListener(
    'error',
    (e) => {
      const el = e.target;
      if (el && el !== window && (el.src || el.href)) {
        push(net, { method: 'GET', url: el.src || el.href, status: 'load error' });
      } else {
        const msg = e.error?.stack || `${e.message} (${e.filename}:${e.lineno}:${e.colno})`;
        push(logs, { level: 'uncaught', msg: String(msg).slice(0, 500) });
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', (e) => {
    push(logs, { level: 'unhandledrejection', msg: fmt(e.reason).slice(0, 500) });
  });

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const method = (init?.method || input?.method || 'GET').toUpperCase();
    try {
      const res = await origFetch.apply(this, arguments);
      if (!res.ok) push(net, { method, url, status: res.status });
      return res;
    } catch (err) {
      push(net, { method, url, status: 'network error' });
      throw err;
    }
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ghfb = { method: String(method).toUpperCase(), url: String(url) };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const info = this.__ghfb;
    if (info) {
      this.addEventListener('loadend', () => {
        if (this.status === 0) push(net, { ...info, status: 'network error' });
        else if (this.status >= 400) push(net, { ...info, status: this.status });
      });
    }
    return origSend.apply(this, arguments);
  };

  document.addEventListener('ghfb:request', () => {
    document.dispatchEvent(new CustomEvent('ghfb:response', { detail: JSON.stringify({ logs, net }) }));
  });
})();
