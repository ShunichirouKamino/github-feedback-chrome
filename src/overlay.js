// コメントモード本体。拡張アイコン / ショートカットで lib.js の後に注入され、再実行でトグルする。
// ページと DOM を共有するため、UI は closed な Shadow DOM に閉じ込め、値は検証のうえ background に送る。
(() => {
  const G = self.GHFB;
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  if (window.__ghfb) {
    if (window.__ghfb.alive()) return window.__ghfb.toggle();
    // 拡張の更新などで古いコンテキストが残っている場合は作り直す
    try {
      window.__ghfb.dispose();
    } catch {}
  }

  let config = G.normalizeConfig({});
  let active = false;
  let formOpen = false;
  let submitting = false;
  let drag = null; // { x, y, dragging }
  let sel = null; // { rect, target, byElement, scrollX, scrollY }
  let diag = null; // 収集済みの診断データ（収集していないホストでは null）
  let escArmedUntil = 0;

  // ---------- UI ----------
  // 別コンテキスト（拡張の更新前など）が残した UI は取り除く
  document.querySelectorAll('[data-github-feedback]').forEach((el) => el.remove());
  const host = document.createElement('div');
  host.setAttribute('data-github-feedback', '');
  host.setAttribute('popover', 'manual'); // トップレイヤーに出して、ページのモーダルより手前に表示する
  host.style.cssText =
    'position:fixed;inset:0;width:0;height:0;margin:0;padding:0;border:0;overflow:visible;background:transparent;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", Meiryo, sans-serif; }
      .layer { position: fixed; inset: 0; cursor: crosshair; background: rgba(0, 0, 0, 0.03); touch-action: none; }
      .hover { position: fixed; pointer-events: none; outline: 2px dashed #2f81f7; background: rgba(47, 129, 247, 0.08); display: none; }
      .sel { position: fixed; pointer-events: none; border: 2px solid #e5484d; background: rgba(229, 72, 77, 0.08); display: none; }
      .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: center;
             padding: 6px 8px 6px 14px; border-radius: 999px; background: #1f2328; color: #fff; font-size: 12px;
             box-shadow: 0 4px 16px rgba(0,0,0,.25); white-space: nowrap; }
      .bar button { all: unset; cursor: pointer; padding: 3px 9px; border-radius: 999px; color: #fff; }
      .bar button:hover { background: rgba(255,255,255,.15); }
      .form { position: fixed; width: 380px; max-width: calc(100vw - 24px); display: none; flex-direction: column; gap: 8px; padding: 12px;
              border-radius: 10px; background: #fff; color: #1f2328; font-size: 13px; border: 1px solid #d0d7de;
              box-shadow: 0 8px 28px rgba(0,0,0,.25); }
      .repoRow { display: flex; gap: 8px; align-items: center; color: #59636e; font-size: 12px; }
      select, input[type=text], textarea { width: 100%; padding: 6px 8px; border: 1px solid #d0d7de; border-radius: 6px;
              font-size: 13px; color: inherit; background: #fff; }
      select { flex: 1; width: auto; min-width: 0; }
      textarea { resize: vertical; min-height: 96px; }
      .chk { display: flex; gap: 6px; align-items: flex-start; color: #59636e; font-size: 12px; }
      .note { font-size: 12px; display: none; }
      .warn { color: #9a6700; }
      .err { color: #cf222e; }
      .note button { all: unset; cursor: pointer; text-decoration: underline; color: #0969da; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; }
      .actions button { padding: 6px 12px; border-radius: 6px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 13px; color: inherit; }
      .actions button.primary { background: #1f883d; border-color: #1f883d; color: #fff; }
      .actions button:disabled { opacity: .5; cursor: default; }
      .kbd { color: #8c959f; font-size: 11px; margin-right: auto; align-self: center; }
      @media (prefers-color-scheme: dark) {
        .form { background: #161b22; color: #e6edf3; border-color: #30363d; }
        select, input[type=text], textarea { background: #0d1117; border-color: #30363d; }
        .actions button { background: #21262d; border-color: #30363d; }
        .warn { color: #d29922; }
        .err { color: #f85149; }
        .note button { color: #4493f8; }
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
    <div class="form" role="dialog" aria-label="Issue を作成">
      <div class="repoRow">起票先 <select class="repoSel"></select></div>
      <div class="note warn hostNote"></div>
      <div class="note warn publicNote">⚠ 公開リポジトリです。内容とスクリーンショットは誰でも閲覧できます。</div>
      <div class="note warn noRepo">起票先が設定されていません。<button class="goOpt">設定を開く</button></div>
      <input type="text" class="title" maxlength="250" placeholder="タイトル（空ならコメントの1行目）">
      <textarea class="comment" placeholder="気になった点、期待する動作など"></textarea>
      <label class="chk diagRow"><input type="checkbox" class="diag" checked>
        <span>コンソール / 通信エラーと HTML の抜粋を含める<br>（秘密情報らしき値はマスクされます）</span></label>
      <div class="note err errNote"></div>
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

  const show = (el, on) => (el.style.display = on ? 'block' : 'none');
  const placeBox = (box, r) => {
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const showPopover = () => {
    try {
      if (!host.matches(':popover-open')) host.showPopover();
    } catch {}
  };
  const hidePopover = () => {
    try {
      if (host.matches(':popover-open')) host.hidePopover();
    } catch {}
  };

  // ---------- 状態遷移 ----------
  async function activate() {
    config = G.normalizeConfig(await chrome.storage.sync.get(null));
    if (!host.isConnected) document.documentElement.appendChild(host);
    showPopover();
    active = true;
    window.addEventListener('keydown', onKey, true);
  }

  function deactivate() {
    active = false;
    drag = null;
    closeForm(true);
    show(hoverBox, false);
    hidePopover();
    window.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return; // IME の変換取り消しは無視
    e.stopPropagation();
    e.preventDefault();
    if (!formOpen) return deactivate();
    // 書きかけのコメントは 1 回の Esc では消さない
    if (commentIn.value.trim() && Date.now() > escArmedUntil) {
      escArmedUntil = Date.now() + 2000;
      return showError('もう一度 Esc を押すと、書きかけのコメントを破棄します。');
    }
    closeForm(true);
  }

  // ---------- 選択 ----------
  function elementAt(x, y) {
    layer.style.pointerEvents = 'none';
    const el = document.elementFromPoint(x, y);
    layer.style.pointerEvents = '';
    return el && el !== host ? el : null;
  }

  layer.addEventListener('pointermove', (e) => {
    if (formOpen) return;
    if (drag) {
      if (!drag.dragging && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.dragging = true;
      if (drag.dragging) {
        show(hoverBox, false);
        placeBox(selBox, rectFromPoints(drag, { x: e.clientX, y: e.clientY }));
      }
      return;
    }
    const el = elementAt(e.clientX, e.clientY);
    if (el) placeBox(hoverBox, el.getBoundingClientRect());
    else show(hoverBox, false);
  });

  layer.addEventListener('pointerdown', (e) => {
    if (formOpen || e.button !== 0) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, dragging: false };
  });

  layer.addEventListener('pointerup', (e) => {
    if (formOpen || !drag) return;
    const d = drag;
    drag = null;
    if (d.dragging) {
      const rect = rectFromPoints(d, { x: e.clientX, y: e.clientY });
      sel = { rect, target: elementAt(rect.left + rect.width / 2, rect.top + rect.height / 2), byElement: false };
    } else {
      const target = elementAt(e.clientX, e.clientY);
      if (!target) return;
      const r = target.getBoundingClientRect();
      sel = { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, target, byElement: true };
    }
    sel.scrollX = window.scrollX;
    sel.scrollY = window.scrollY;
    show(hoverBox, false);
    placeBox(selBox, sel.rect);
    openForm();
  });

  layer.addEventListener('pointercancel', () => {
    drag = null;
    show(selBox, false);
  });

  // フォーム表示中はレイヤー上のホイールでスクロールさせない（撮影直前にも位置を取り直す）
  layer.addEventListener('wheel', (e) => formOpen && e.preventDefault(), { passive: false });

  function rectFromPoints(a, b) {
    return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  }

  /** 撮影直前の選択範囲（要素ならその時点の位置、範囲ならスクロール量を補正） */
  function currentRect() {
    if (sel.byElement && sel.target?.isConnected) {
      const r = sel.target.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return {
      ...sel.rect,
      left: sel.rect.left - (window.scrollX - sel.scrollX),
      top: sel.rect.top - (window.scrollY - sel.scrollY),
    };
  }

  // ---------- フォーム ----------
  function openForm() {
    formOpen = true;
    showError('');
    const repos = G.configuredRepos(config);
    const matched = G.matchRule(config.rules, location.hostname, location.port);

    repoSel.textContent = '';
    if (!matched) repoSel.add(new Option('— 起票先を選択 —', ''));
    for (const repo of repos) repoSel.add(new Option(repo, repo, false, repo === matched?.repo));

    const hostNote = $('.hostNote');
    hostNote.textContent = `このホスト（${location.host}）は設定に登録されていません。起票先を確認してください。`;
    show(hostNote, !matched && repos.length > 0);
    show($('.noRepo'), repos.length === 0);
    submitBtn.disabled = repos.length === 0;

    diag = readDiagnostics();
    $('.diagRow').style.display = diag ? 'flex' : 'none';
    diagIn.checked = true;
    updateVisibility();

    form.style.display = 'flex';
    positionForm();
    commentIn.focus();
  }

  function positionForm() {
    const W = form.offsetWidth;
    const H = form.offsetHeight;
    const M = 12;
    const r = sel.rect;
    // 右 → 左 → 下 の順に置ける場所を探す
    let left = r.left + r.width + M;
    let top = r.top;
    if (left + W > innerWidth - M) left = r.left - W - M;
    if (left < M) {
      left = Math.max(M, Math.min(r.left, innerWidth - W - M));
      top = r.top + r.height + M;
    }
    top = Math.max(M, Math.min(top, innerHeight - H - M));
    Object.assign(form.style, { left: left + 'px', top: top + 'px' });
  }

  function closeForm(clear) {
    formOpen = false;
    form.style.display = 'none';
    show(selBox, false);
    if (clear) {
      titleIn.value = '';
      commentIn.value = '';
    }
  }

  function showError(message) {
    const el = $('.errNote');
    el.textContent = message;
    show(el, !!message);
  }

  async function updateVisibility() {
    const repo = repoSel.value;
    show($('.publicNote'), false);
    if (!repo) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ghfb:visibility', repo });
      if (repoSel.value !== repo) return;
      const isPublic = res?.visibility === 'public';
      show($('.publicNote'), isPublic);
      // 公開リポジトリには診断情報を既定で含めない
      if (isPublic) diagIn.checked = false;
    } catch {}
  }

  // フォーム内のキー入力をページ側のショートカットに渡さない
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key !== 'Escape') e.stopPropagation();
  });

  repoSel.addEventListener('change', () => {
    showError('');
    updateVisibility();
  });
  $('.cancel').addEventListener('click', () => closeForm(true));
  $('.close').addEventListener('click', deactivate);
  const openOptions = () => chrome.runtime.sendMessage({ type: 'ghfb:openOptions' });
  $('.opt').addEventListener('click', openOptions);
  $('.goOpt').addEventListener('click', openOptions);
  submitBtn.addEventListener('click', submit);

  // ---------- 起票 ----------
  async function submit() {
    if (submitting) return;
    const comment = commentIn.value.trim();
    if (!comment) return commentIn.focus();
    const repo = repoSel.value;
    if (!repo) return showError('起票先を選択してください。');

    submitting = true;
    submitBtn.disabled = true;
    showError('');
    try {
      const ctx = collectContext(diag && diagIn.checked);
      const rect = currentRect();
      // 自分の UI を消してから撮影する
      hidePopover();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const res = await chrome.runtime.sendMessage({
        type: 'ghfb:submit',
        repo,
        title: titleIn.value.trim(),
        comment,
        ctx,
        rect,
        viewportWidth: window.innerWidth,
      });
      if (!res?.ok) throw new Error(res?.error || '起票に失敗しました。');
      deactivate();
    } catch (e) {
      showPopover();
      showError(alive() ? String(e?.message || e) : '拡張機能が更新されました。ページを再読み込みしてください。');
    } finally {
      submitting = false;
      submitBtn.disabled = false;
    }
  }

  // ---------- コンテキスト ----------
  function readDiagnostics() {
    const nonce = crypto.randomUUID();
    let data = null;
    const onRes = (e) => {
      try {
        const d = JSON.parse(e.detail);
        if (d?.nonce === nonce) data = d;
      } catch {}
    };
    document.addEventListener('ghfb:response', onRes);
    document.dispatchEvent(new CustomEvent('ghfb:request', { detail: nonce }));
    document.removeEventListener('ghfb:response', onRes);
    return data ? G.validateDiag(data) : null; // null ならこのホストでは収集していない
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

  /** 入力値・hidden / password・script を除いた HTML の抜粋 */
  function htmlSnippet(el) {
    const deep = el.getElementsByTagName('*').length <= 200;
    const clone = el.cloneNode(deep);
    const all = [clone, ...clone.querySelectorAll('*')];
    for (const n of all) {
      const tag = n.tagName?.toLowerCase();
      if (tag === 'script' || tag === 'style' || (tag === 'input' && /^(hidden|password)$/i.test(n.getAttribute('type') || ''))) {
        if (n !== clone) n.remove();
        continue;
      }
      for (const a of [...(n.attributes || [])]) {
        if (a.name === 'value' || a.name.startsWith('on') || /token|secret|password/i.test(a.name)) n.removeAttribute(a.name);
      }
    }
    if (clone.tagName?.toLowerCase() === 'textarea') clone.textContent = '';
    return G.truncate(clone.outerHTML, 1500);
  }

  function collectContext(includeDiag) {
    const el = sel?.target && sel.target !== document.body && sel.target !== document.documentElement ? sel.target : null;
    const chromeVer = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '?';
    const meta = [...document.querySelectorAll('meta[name="version"],meta[name="app-version"],meta[name="build"],meta[name="commit"]')]
      .map((m) => `${m.name}=${m.content}`)
      .join(', ');
    return {
      pageTitle: document.title,
      appVersion: meta,
      viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
      browser: `Chrome ${chromeVer} / ${navigator.userAgentData?.platform || navigator.platform}`,
      time: new Date().toLocaleString('ja-JP', { timeZoneName: 'short' }),
      target: el && {
        selector: cssPath(el),
        text: G.truncate((el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '), 200),
        html: includeDiag ? htmlSnippet(el) : '',
      },
      diag: includeDiag ? diag : null,
    };
  }

  window.__ghfb = {
    alive,
    toggle: () => (active ? deactivate() : activate()),
    dispose: () => {
      deactivate();
      host.remove();
    },
  };
  activate();
})();
