// 設定に登録したホストにだけ、MAIN world / document_start で動的に登録される（background.js の syncHookRegistration）。
// console のエラー・警告、未捕捉の例外、失敗した通信を直近分だけ記録し、
// 隔離ワールドの overlay.js から DOM イベント（ghfb:request / ghfb:response）で読み出す。
// ページの挙動を変えないよう、記録処理の中で起きた例外はすべて握りつぶす。
(() => {
  const FLAG = Symbol.for('github-feedback.hook');
  if (window[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true });

  const errors = [];
  const warns = [];
  const net = [];
  const push = (arr, max, item) => {
    try {
      arr.push({ t: Date.now(), ...item });
      if (arr.length > max) arr.shift();
    } catch {}
  };
  const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

  // getter を呼ばないように、自前のデータプロパティだけを深さ・件数・長さを制限して文字列化する
  const describe = (v, depth = 0) => {
    try {
      if (v === null || v === undefined) return String(v);
      const type = typeof v;
      if (type === 'string') return cut(v, 300);
      if (type === 'function') return `[Function ${v.name || 'anonymous'}]`;
      if (type !== 'object') return String(v);
      if (v instanceof Error) {
        const stack = typeof v.stack === 'string' ? '\n' + v.stack.split('\n').slice(1, 6).join('\n') : '';
        return `${v.name}: ${v.message}${stack}`;
      }
      if (typeof Node !== 'undefined' && v instanceof Node) return `<${String(v.nodeName).toLowerCase()}>`;
      const isArr = Array.isArray(v);
      if (depth >= 2) return isArr ? `[Array(${v.length})]` : '{…}';
      const keys = Object.keys(v);
      const parts = keys.slice(0, 10).map((k) => {
        const d = Object.getOwnPropertyDescriptor(v, k);
        const val = d && 'value' in d ? describe(d.value, depth + 1) : '[getter]';
        return isArr ? val : `${k}: ${val}`;
      });
      const more = keys.length > 10 ? ', …' : '';
      return isArr ? `[${parts.join(', ')}${more}]` : `{${parts.join(', ')}${more}}`;
    } catch {
      return '[unserializable]';
    }
  };

  for (const [level, arr, max] of [
    ['error', errors, 20],
    ['warn', warns, 10],
  ]) {
    const orig = console[level];
    if (typeof orig !== 'function') continue;
    console[level] = function (...args) {
      push(arr, max, { level, msg: cut(args.map((a) => describe(a)).join(' '), 500) });
      return orig.apply(this, args);
    };
  }

  window.addEventListener(
    'error',
    (e) => {
      try {
        const el = e.target;
        if (el && el !== window && el.nodeType === 1) {
          // 画像・スクリプトなどの読み込み失敗（SVG の href は SVGAnimatedString）
          const src = el.src || el.href?.baseVal || el.href || '';
          if (src) push(net, 20, { method: 'GET', url: String(src), status: 'load error' });
          return;
        }
        const stack = e.error instanceof Error ? describe(e.error) : `${e.message} (${e.filename}:${e.lineno}:${e.colno})`;
        push(errors, 20, { level: 'uncaught', msg: cut(String(stack), 500) });
      } catch {}
    },
    true,
  );
  window.addEventListener('unhandledrejection', (e) => {
    push(errors, 20, { level: 'unhandledrejection', msg: cut(describe(e.reason), 500) });
  });

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function fetch(input, init) {
      let method = 'GET';
      let url = '';
      try {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url ?? input);
        method = String(init?.method || input?.method || 'GET').toUpperCase();
      } catch {}
      const p = origFetch.apply(this, arguments);
      try {
        p.then(
          (res) => {
            // no-cors の opaque レスポンスは失敗ではない
            if (!res.ok && res.type !== 'opaque' && res.type !== 'opaqueredirect') push(net, 20, { method, url, status: res.status });
          },
          (err) => {
            if (err?.name !== 'AbortError') push(net, 20, { method, url, status: 'network error' });
          },
        );
      } catch {}
      return p;
    };
  }

  const xhrInfo = new WeakMap();
  const { open, send } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      xhrInfo.set(this, { method: String(method).toUpperCase(), url: String(url), aborted: false });
    } catch {}
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const info = xhrInfo.get(this);
    if (info) {
      try {
        this.addEventListener('abort', () => (info.aborted = true));
        this.addEventListener('loadend', () => {
          if (info.aborted) return;
          if (this.status === 0) push(net, 20, { method: info.method, url: info.url, status: 'network error' });
          else if (this.status >= 400) push(net, 20, { method: info.method, url: info.url, status: this.status });
        });
      } catch {}
    }
    return send.apply(this, arguments);
  };

  document.addEventListener('ghfb:request', (e) => {
    try {
      const nonce = typeof e.detail === 'string' ? e.detail : '';
      const logs = [...errors, ...warns].sort((a, b) => a.t - b.t);
      document.dispatchEvent(new CustomEvent('ghfb:response', { detail: JSON.stringify({ nonce, logs, net }) }));
    } catch {}
  });
})();
