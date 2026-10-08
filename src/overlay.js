// コメントモード本体。拡張アイコン / ショートカットで注入され、再実行でトグルする。
(() => {
  if (window.__ghfb) {
    window.__ghfb.toggle();
    return;
  }

  const DEFAULTS = { githubBase: 'https://github.com', defaultRepo: '', defaultLabels: 'feedback', rules: [] };
  const MAX_URL = 7500; // GitHub は長すぎる URL を 414 で弾く

  let config = DEFAULTS;
  let active = false;
  let formOpen = false;
  let dragStart = null;
  let dragging = false;
  let selRect = null;
  let selTarget = null;

  // ---------- UI ----------
  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", Meiryo, sans-serif; }
      .layer { position: fixed; inset: 0; cursor: crosshair; background: rgba(0, 0, 0, 0.03); }
      .hover { position: fixed; pointer-events: none; outline: 2px dashed #2f81f7; background: rgba(47, 129, 247, 0.08); display: none; }
      .sel { position: fixed; pointer-events: none; border: 2px solid #e5484d; background: rgba(229, 72, 77, 0.08); display: none; }
      .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: center;
             padding: 6px 8px 6px 14px; border-radius: 999px; background: #1f2328; color: #fff; font-size: 12px;
             box-shadow: 0 4px 16px rgba(0,0,0,.25); }
      .bar button { all: unset; cursor: pointer; padding: 3px 9px; border-radius: 999px; color: #fff; }
      .bar button:hover { background: rgba(255,255,255,.15); }
      .form { position: fixed; width: 360px; display: none; flex-direction: column; gap: 8px; padding: 12px;
              border-radius: 10px; background: #fff; color: #1f2328; font-size: 13px; border: 1px solid #d0d7de;
              box-shadow: 0 8px 28px rgba(0,0,0,.25); }
      .form label.repo { display: flex; gap: 8px; align-items: center; color: #59636e; font-size: 12px; }
      select, input[type=text], textarea { width: 100%; padding: 6px 8px; border: 1px solid #d0d7de; border-radius: 6px;
              font-size: 13px; color: inherit; background: #fff; }
      select { flex: 1; width: auto; }
      textarea { resize: vertical; min-height: 96px; }
      .chk { display: flex; gap: 6px; align-items: center; color: #59636e; font-size: 12px; }
      .hint { color: #bc4c00; font-size: 12px; display: none; }
      .hint button { all: unset; cursor: pointer; text-decoration: underline; color: #0969da; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; }
      .actions button { padding: 6px 12px; border-radius: 6px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 13px; color: inherit; }
      .actions button.primary { background: #1f883d; border-color: #1f883d; color: #fff; }
      .actions button:disabled { opacity: .5; cursor: default; }
      .kbd { color: #8c959f; font-size: 11px; margin-right: auto; align-self: center; }
      @media (prefers-color-scheme: dark) {
        .form { background: #161b22; color: #e6edf3; border-color: #30363d; }
        select, input[type=text], textarea { background: #0d1117; border-color: #30363d; }
        .actions button { background: #21262d; border-color: #30363d; }
      }
    </style>
    <div class="layer"></div>
    <div class="hover"></div>
    <div class="sel"></div>
    <div class="bar">
      <span>💬 クリックで要素 / ドラッグで範囲を選択</span>
      <button class="opt" title="設定">⚙</button>
      <button class="close" title="終了 (Esc)">✕</button>
    </div>
    <div class="form">
      <label class="repo">起票先 <select class="repoSel"></select></label>
      <input type="text" class="title" placeholder="タイトル（空ならコメントの1行目）">
      <textarea class="comment" placeholder="気になった点、期待する動作など"></textarea>
      <label class="chk"><input type="checkbox" class="diag" checked> コンソール / 通信エラーを含める</label>
      <div class="hint">起票先リポジトリが未設定です。<button class="goOpt">設定を開く</button></div>
      <div class="actions">
        <span class="kbd">Ctrl+Enter</span>
        <button class="cancel">キャンセル</button>
        <button class="submit primary">Issue を開く</button>
      </div>
    </div>
  `;
  const $ = (s) => root.querySelector(s);
  const layer = $('.layer');
  const hoverBox = $('.hover');
  const selBox = $('.sel');
  const form = $('.form');
  const repoSel = $('.repoSel');
  const titleIn = $('.title');
  const commentIn = $('.comment');
  const diagIn = $('.diag');
  const submitBtn = $('.submit');

  const placeBox = (box, r) => {
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };

  // ---------- 状態遷移 ----------
  async function activate() {
    config = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    // 旧バージョンで URL のまま保存された値にも対応する
    const toRepo = (v) => (v || '').replace(/^https?:\/\/[^/]+\//i, '').split('/').filter(Boolean).slice(0, 2).join('/').replace(/\.git$/i, '');
    config.defaultRepo = toRepo(config.defaultRepo);
    config.rules = (config.rules || []).map((r) => ({ ...r, repo: toRepo(r.repo) }));
    if (!host.isConnected) document.documentElement.appendChild(host);
    host.style.display = '';
    active = true;
    window.addEventListener('keydown', onKey, true);
  }

  function deactivate() {
    active = false;
    closeForm();
    hoverBox.style.display = 'none';
    host.style.display = 'none';
    window.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    formOpen ? closeForm() : deactivate();
  }

  // ---------- 選択 ----------
  function elementAt(x, y) {
    host.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    host.style.display = '';
    return el;
  }

  layer.addEventListener('mousemove', (e) => {
    if (formOpen) return;
    if (dragStart) {
      if (!dragging && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 5) dragging = true;
      if (dragging) {
        hoverBox.style.display = 'none';
        placeBox(selBox, rectFromPoints(dragStart, { x: e.clientX, y: e.clientY }));
      }
      return;
    }
    const el = elementAt(e.clientX, e.clientY);
    if (el) placeBox(hoverBox, el.getBoundingClientRect());
  });

  layer.addEventListener('mousedown', (e) => {
    if (formOpen || e.button !== 0) return;
    e.preventDefault();
    dragStart = { x: e.clientX, y: e.clientY };
    dragging = false;
  });

  layer.addEventListener('mouseup', (e) => {
    if (formOpen || !dragStart) return;
    if (dragging) {
      selRect = rectFromPoints(dragStart, { x: e.clientX, y: e.clientY });
      selTarget = elementAt(selRect.left + selRect.width / 2, selRect.top + selRect.height / 2);
    } else {
      selTarget = elementAt(e.clientX, e.clientY);
      if (!selTarget) {
        dragStart = null;
        return;
      }
      const r = selTarget.getBoundingClientRect();
      selRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    dragStart = null;
    dragging = false;
    hoverBox.style.display = 'none';
    placeBox(selBox, selRect);
    openForm();
  });

  // フォーム表示中はスクロールさせない（選択位置とスクショがずれるため）
  layer.addEventListener('wheel', (e) => formOpen && e.preventDefault(), { passive: false });

  function rectFromPoints(a, b) {
    return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  }

  // ---------- フォーム ----------
  function openForm() {
    formOpen = true;
    const { matched, repos } = resolveRepos();
    repoSel.innerHTML = '';
    for (const repo of repos) repoSel.add(new Option(repo, repo, false, repo === matched?.repo));
    const noRepo = repos.length === 0;
    $('.hint').style.display = noRepo ? 'block' : 'none';
    submitBtn.disabled = noRepo;

    form.style.display = 'flex';
    const W = 360, H = form.offsetHeight, M = 12;
    // 右 → 左 → 下 の順に置ける場所を探す
    let left = selRect.left + selRect.width + M;
    let top = selRect.top;
    if (left + W > innerWidth - M) left = selRect.left - W - M;
    if (left < M) {
      left = Math.max(M, Math.min(selRect.left, innerWidth - W - M));
      top = selRect.top + selRect.height + M;
    }
    top = Math.max(M, Math.min(top, innerHeight - H - M));
    Object.assign(form.style, { left: left + 'px', top: top + 'px' });
    commentIn.focus();
  }

  function closeForm() {
    formOpen = false;
    form.style.display = 'none';
    selBox.style.display = 'none';
    titleIn.value = '';
    commentIn.value = '';
  }

  // フォーム内のキー入力をページ側のショートカットに渡さない
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
    if (e.key !== 'Escape') e.stopPropagation();
  });

  $('.cancel').addEventListener('click', closeForm);
  $('.close').addEventListener('click', deactivate);
  $('.opt').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'ghfb:openOptions' }));
  $('.goOpt').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'ghfb:openOptions' }));
  submitBtn.addEventListener('click', submit);

  // ---------- 起票 ----------
  async function submit() {
    const comment = commentIn.value.trim();
    if (!comment) return commentIn.focus();
    const repo = repoSel.value;
    if (!repo) return;

    const { matched } = resolveRepos();
    const rule = matched?.repo === repo ? matched : config.rules.find((r) => r.repo === repo);
    const env = rule?.env || guessEnv();
    const labels = (rule?.labels || config.defaultLabels || '').trim();
    const firstLine = comment.split('\n')[0].slice(0, 80);
    const title = titleIn.value.trim() || (env ? `[${env}] ${firstLine}` : firstLine);

    const ctx = collectContext(env, diagIn.checked);
    const rect = selRect;

    // 自分の UI を消してから撮影する。画像は Issue 画面を開いた後に background が本文へ添付する
    host.style.display = 'none';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const res = await chrome.runtime.sendMessage({ type: 'ghfb:capture', rect, viewportWidth: innerWidth });
    if (!res?.dataUrl) console.warn('[github-feedback] capture:', res?.error);

    const url = buildIssueUrl(repo, title, labels, comment, ctx);
    chrome.runtime.sendMessage({ type: 'ghfb:openIssue', url, dataUrl: res?.dataUrl || null });
    deactivate();
  }

  // ---------- 設定・コンテキスト ----------
  function globToRegExp(p) {
    return new RegExp('^' + p.trim().split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  }

  function resolveRepos() {
    const rules = (config.rules || []).filter((r) => r.pattern && r.repo);
    const matched = rules.find((r) => globToRegExp(r.pattern).test(location.host)) || null;
    const repos = [...new Set([matched?.repo, config.defaultRepo, ...rules.map((r) => r.repo)].filter(Boolean))];
    return { matched: matched || (config.defaultRepo ? { repo: config.defaultRepo } : null), repos };
  }

  function guessEnv() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? 'local' : '';
  }

  function readDiagnostics() {
    let data = null;
    const onRes = (e) => {
      try {
        data = JSON.parse(e.detail);
      } catch {}
    };
    document.addEventListener('ghfb:response', onRes, { once: true });
    document.dispatchEvent(new CustomEvent('ghfb:request'));
    document.removeEventListener('ghfb:response', onRes);
    return data; // null ならフック未導入（拡張インストール前に開いたページ）
  }

  function cssPath(el) {
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
      if (cur.id && document.querySelectorAll('#' + CSS.escape(cur.id)).length === 1) {
        parts.unshift('#' + CSS.escape(cur.id));
        break;
      }
      const testAttr = ['data-testid', 'data-test', 'data-cy'].find((a) => cur.hasAttribute(a));
      if (testAttr) {
        const s = `[${testAttr}=${JSON.stringify(cur.getAttribute(testAttr))}]`;
        parts.unshift(s);
        if (document.querySelectorAll(s).length === 1) break;
        continue;
      }
      let s = cur.tagName.toLowerCase();
      const sibs = cur.parentElement ? [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName) : [];
      if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      parts.unshift(s);
      if (parts.length >= 6) break;
    }
    return parts.join(' > ');
  }

  function collectContext(env, includeDiag) {
    const el = selTarget && selTarget !== document.body && selTarget !== document.documentElement ? selTarget : null;
    const chromeVer = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '?';
    const meta = [...document.querySelectorAll('meta[name="version"],meta[name="app-version"],meta[name="build"],meta[name="commit"]')]
      .map((m) => `${m.name}=${m.content}`)
      .join(', ');
    return {
      url: location.href,
      pageTitle: document.title,
      env,
      viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
      browser: `Chrome ${chromeVer} / ${navigator.userAgentData?.platform || navigator.platform}`,
      time: new Date().toLocaleString('ja-JP', { timeZoneName: 'short' }),
      appVersion: meta,
      target: el && {
        selector: cssPath(el),
        text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
        html: el.outerHTML.slice(0, 800),
      },
      diag: includeDiag ? readDiagnostics() : undefined,
    };
  }

  function buildIssueUrl(repo, title, labels, comment, ctx) {
    const base = (config.githubBase || DEFAULTS.githubBase).replace(/\/+$/, '');
    const make = (opts) => {
      const q = `title=${encodeURIComponent(title)}&body=${encodeURIComponent(buildBody(comment, ctx, opts))}` +
        (labels ? `&labels=${encodeURIComponent(labels)}` : '');
      return `${base}/${repo}/issues/new?${q}`;
    };
    // URL 長の上限に収まるまで情報を削っていく
    const steps = [
      { html: 800, logs: 15 },
      { html: 300, logs: 10 },
      { html: 0, logs: 5 },
      { html: 0, logs: 0 },
    ];
    for (const s of steps) {
      const url = make(s);
      if (url.length <= MAX_URL) return url;
    }
    return make({ html: 0, logs: 0, commentMax: 1500 });
  }

  function buildBody(comment, ctx, { html, logs, commentMax }) {
    const fence = (s) => s.replace(/```/g, '`​``');
    const L = [];
    L.push('## コメント', '', commentMax ? comment.slice(0, commentMax) + '…' : comment, '');
    L.push('## スクリーンショット', '<!-- github-feedback:screenshot -->', '', '');
    L.push('## 環境', '', '| | |', '|---|---|');
    L.push(`| URL | ${ctx.url} |`);
    if (ctx.env) L.push(`| 環境 | \`${ctx.env}\` |`);
    if (ctx.appVersion) L.push(`| バージョン | ${ctx.appVersion} |`);
    L.push(`| 画面サイズ | ${ctx.viewport} |`, `| ブラウザ | ${ctx.browser} |`, `| 日時 | ${ctx.time} |`, '');

    if (ctx.target) {
      L.push('## 対象要素', '', `- セレクタ: \`${ctx.target.selector}\``);
      if (ctx.target.text) L.push(`- テキスト: ${ctx.target.text}`);
      if (html > 0) {
        L.push('', '<details><summary>HTML</summary>', '', '```html', fence(ctx.target.html.slice(0, html)), '```', '</details>');
      }
      L.push('');
    }

    if (ctx.diag && logs > 0) {
      const hhmmss = (t) => new Date(t).toLocaleTimeString('ja-JP');
      const lines = [
        ...ctx.diag.logs.map((l) => ({ t: l.t, s: `[${hhmmss(l.t)}] ${l.level}: ${l.msg.slice(0, 200)}` })),
        ...ctx.diag.net.map((n) => ({ t: n.t, s: `[${hhmmss(n.t)}] ${n.method} ${n.url.slice(0, 150)} → ${n.status}` })),
      ]
        .sort((a, b) => a.t - b.t)
        .slice(-logs)
        .map((x) => x.s);
      L.push('## コンソール / 通信エラー（直近）', '');
      L.push(lines.length ? ['```', ...lines.map(fence), '```'].join('\n') : '_なし_');
      L.push('');
    }

    L.push('<sub>Filed via github-feedback</sub>');
    return L.join('\n');
  }

  window.__ghfb = { toggle: () => (active ? deactivate() : activate()) };
  activate();
})();
