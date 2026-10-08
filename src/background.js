// Service worker:
//   - コメントモード（overlay.js）の注入
//   - 起票の検証、撮影＋注釈、Issue 画面への本文・スクショの投入
//   - エラー収集（hook.js）を設定済みホストにだけ登録する
importScripts('lib.js');
const G = self.GHFB;

const JOB_KEY = (tabId) => `job:${tabId}`;
const JOB_TTL_MS = 10 * 60 * 1000;
const HOOK_ID = 'ghfb-hook';
const MAX_SHOT_WIDTH = 2560;
const MAX_PNG_BYTES = 4 * 1024 * 1024;

async function getConfig() {
  return G.normalizeConfig(await chrome.storage.sync.get(null));
}

// ---------- コメントモードの起動 ----------

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/lib.js', 'src/overlay.js'] });
  } catch (e) {
    // chrome:// や Web ストアなど、拡張機能が動かないページ
    console.warn('[github-feedback] inject failed:', e);
    flashBadge(tab.id, 'このページではコメントモードを使えません');
  }
});

function flashBadge(tabId, title) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#cf222e' });
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: '' }).catch(() => {});
  }, 4000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // コンテンツスクリプト以外（他の拡張やページ）からのメッセージは受け付けない
  if (sender.id !== chrome.runtime.id) return false;
  switch (msg?.type) {
    case 'ghfb:submit':
      if (!sender.tab) return false;
      handleSubmit(msg, sender.tab).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true;
    case 'ghfb:visibility':
      repoVisibility(String(msg.repo || '')).then((visibility) => sendResponse({ visibility }));
      return true;
    case 'ghfb:openOptions':
      chrome.runtime.openOptionsPage();
      return false;
  }
  return false;
});

// ---------- 起票 ----------

class UserError extends Error {}

async function handleSubmit(msg, tab) {
  const cfg = await getConfig();
  const repo = String(msg.repo || '');
  if (!G.REPO_RE.test(repo) || !G.configuredRepos(cfg).includes(repo)) {
    throw new UserError('起票先が設定に登録されていません。設定を確認してください。');
  }

  // 環境名とラベルは、ページから渡された値ではなく送信元タブの URL から決め直す
  let host = { hostname: '', port: '' };
  try {
    const u = new URL(tab.url);
    host = { hostname: u.hostname, port: u.port };
  } catch {}
  const { env, labels } = G.resolveTarget(cfg, host.hostname, host.port, repo);
  const comment = G.truncate(String(msg.comment || '').trim(), 20000);
  if (!comment) throw new UserError('コメントを入力してください。');
  const title = G.oneLine(msg.title) || G.defaultTitle(comment, env);

  let dataUrl = null;
  let shotError = null;
  try {
    dataUrl = await captureAnnotated(tab, msg.rect, Number(msg.viewportWidth), cfg.shotMode);
  } catch (e) {
    if (e instanceof UserError) throw e;
    shotError = String(e?.message || e);
  }

  const c = msg.ctx && typeof msg.ctx === 'object' ? msg.ctx : {};
  const body = G.buildBody({
    comment,
    url: tab.url,
    pageTitle: typeof c.pageTitle === 'string' ? c.pageTitle : '',
    env,
    appVersion: typeof c.appVersion === 'string' ? c.appVersion : '',
    viewport: typeof c.viewport === 'string' ? G.truncate(c.viewport, 40) : '',
    browser: typeof c.browser === 'string' ? G.truncate(c.browser, 80) : '',
    time: typeof c.time === 'string' ? G.truncate(c.time, 60) : '',
    target:
      c.target && typeof c.target === 'object'
        ? { selector: String(c.target.selector ?? ''), text: String(c.target.text ?? ''), html: String(c.target.html ?? '') }
        : null,
    diag: c.diag ? G.validateDiag(c.diag) : null,
  });
  const url = G.buildIssueUrl(cfg.githubBase, repo, { title, labels });

  await openIssue(tab, url, { origin: cfg.githubBase, repo, body, dataUrl, shotError });
  return { ok: true, shotError };
}

// 表示中のタブを撮影する。送信元のタブが前面にない場合は別のページを写してしまうので中止する。
async function captureAnnotated(tab, rect, viewportWidth, mode) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!active || active.id !== tab.id) {
    throw new UserError('撮影前にタブが切り替わったため中止しました。もう一度送信してください。');
  }
  const raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(raw)).blob());
  const s = viewportWidth > 0 ? bmp.width / viewportWidth : 1;

  const r = sanitizeRect(rect);
  const box = r && {
    x: r.left * s,
    y: r.top * s,
    w: r.width * s,
    h: r.height * s,
  };

  // 切り出し範囲（デバイスピクセル）
  let sx = 0;
  let sy = 0;
  let sw = bmp.width;
  let sh = bmp.height;
  if (mode === 'selection' && box) {
    const m = 24 * s;
    sx = clamp(box.x - m, 0, bmp.width);
    sy = clamp(box.y - m, 0, bmp.height);
    sw = clamp(box.x + box.w + m, 0, bmp.width) - sx;
    sh = clamp(box.y + box.h + m, 0, bmp.height) - sy;
    if (sw < 1 || sh < 1) [sx, sy, sw, sh] = [0, 0, bmp.width, bmp.height];
  }

  const scale = Math.min(1, MAX_SHOT_WIDTH / sw);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
  const g = canvas.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);

  if (box) {
    const pad = 4 * s;
    const x = box.x - sx - pad;
    const y = box.y - sy - pad;
    const w = box.w + pad * 2;
    const h = box.h + pad * 2;
    if (mode !== 'selection') {
      g.fillStyle = 'rgba(0, 0, 0, 0.35)';
      g.beginPath();
      g.rect(0, 0, sw, sh);
      g.rect(x, y, w, h);
      g.fill('evenodd');
    }
    g.lineWidth = 3 * s;
    g.strokeStyle = '#e5484d';
    g.strokeRect(x, y, w, h);
  }

  let blob = await canvas.convertToBlob({ type: 'image/png' });
  if (blob.size > MAX_PNG_BYTES) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return `data:${blob.type};base64,` + toBase64(new Uint8Array(await blob.arrayBuffer()));
}

function sanitizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const n = ['left', 'top', 'width', 'height'].map((k) => Number(rect[k]));
  if (!n.every(Number.isFinite) || n[2] < 0 || n[3] < 0) return null;
  return { left: n[0], top: n[1], width: n[2], height: n[3] };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- Issue 画面への本文・スクショの投入 ----------
// 本文と画像はタブ ID ごとに storage.session に置き、期待した Issue 画面の読み込み完了時に投入する。
// SSO のリダイレクトを挟んでも、service worker が一度止まっても拾えるようにしている。

async function openIssue(opener, url, job) {
  const tab = await chrome.tabs.create({ url: 'about:blank', index: opener.index + 1, openerTabId: opener.id });
  try {
    await saveJob(tab.id, job);
  } finally {
    await chrome.tabs.update(tab.id, { url });
  }
}

async function saveJob(tabId, job) {
  const rec = { ...job, createdAt: Date.now() };
  try {
    await chrome.storage.session.set({ [JOB_KEY(tabId)]: rec });
  } catch (e) {
    // 容量超過など。画像は諦めて本文だけ渡す
    console.warn('[github-feedback] save job:', e);
    rec.dataUrl = null;
    rec.shotError = 'スクリーンショットが大きすぎて保存できませんでした';
    await chrome.storage.session.set({ [JOB_KEY(tabId)]: rec }).catch((e2) => console.warn('[github-feedback] save job:', e2));
  }
}

const inFlight = new Set();

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') processJob(tabId, tab.url).catch((e) => console.warn('[github-feedback] job:', e));
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(JOB_KEY(tabId)));

async function processJob(tabId, tabUrl) {
  const key = JOB_KEY(tabId);
  const { [key]: job } = await chrome.storage.session.get(key);
  if (!job) return;
  if (Date.now() - job.createdAt > JOB_TTL_MS) return chrome.storage.session.remove(key);

  let u;
  try {
    u = new URL(tabUrl);
  } catch {
    return;
  }
  // 起票先の GitHub の Issue 作成画面以外（SSO の途中、テンプレート選択画面など）には何も注入しない
  const path = `/${job.repo}/issues/new`.toLowerCase();
  if (u.origin !== job.origin || u.pathname.replace(/\/+$/, '').toLowerCase() !== path) return;

  if (inFlight.has(tabId)) return;
  inFlight.add(tabId);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/lib.js'] });
    // 注入できた時点で job は消す（以降の失敗は画面上のフォールバックで対応する）
    const run = chrome.scripting.executeScript({
      target: { tabId },
      func: fillIssue,
      args: [{ body: job.body, dataUrl: job.dataUrl, shotError: job.shotError, origin: job.origin, path }],
    });
    await chrome.storage.session.remove(key);
    await run;
  } finally {
    inFlight.delete(tabId);
  }
}

chrome.runtime.onStartup.addListener(cleanupJobs);
async function cleanupJobs() {
  const all = await chrome.storage.session.get(null);
  const expired = Object.entries(all)
    .filter(([k, v]) => k.startsWith('job:') && !(Date.now() - v?.createdAt <= JOB_TTL_MS))
    .map(([k]) => k);
  if (expired.length) await chrome.storage.session.remove(expired);
}

// Issue 作成画面に注入される関数（シリアライズして渡すため外側の変数は使えない。lib.js は先に注入済み）。
async function fillIssue({ body, dataUrl, shotError, origin, path }) {
  const G = self.GHFB;
  if (location.origin !== origin || location.pathname.replace(/\/+$/, '').toLowerCase() !== path) return 'wrong-page';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let bytes = null;
  let mime = 'image/png';
  if (dataUrl) {
    mime = dataUrl.slice(5, dataUrl.indexOf(';'));
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }

  const findTextarea = () => {
    const all = [...document.querySelectorAll('textarea')];
    return (
      all.find((t) => t.value.includes(G.MARKER)) ||
      document.querySelector('textarea[name="issue[body]"]') ||
      all.find((t) => /markdown|body|description/i.test(`${t.getAttribute('aria-label') || ''} ${t.name || ''} ${t.id || ''}`))
    );
  };

  let ta = null;
  for (let i = 0; i < 60 && !(ta = findTextarea()); i++) await sleep(250);
  if (!ta) return showFallback('本文欄が見つかりませんでした。', true), 'no-textarea';

  // 本文を入れる。URL のマーカーだけなら置き換え、テンプレートの文面があれば末尾に足す
  ta.focus();
  const onlyMarker = ta.value.trim() === G.MARKER;
  if (onlyMarker) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
  const text = (onlyMarker || !ta.value.trim() ? '' : '\n\n') + body;
  if (!document.execCommand('insertText', false, text)) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, onlyMarker ? text : ta.value + text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await sleep(150);
  if (!findTextarea()?.value.includes(G.MARKER)) return showFallback('本文を自動で入力できませんでした。', true), 'no-body';

  if (!bytes) {
    if (shotError) showFallback(`スクリーンショットを添付できませんでした（${shotError}）。`, false);
    return 'no-shot';
  }

  const file = new File([bytes], `screenshot-${Date.now()}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`, { type: mime });
  const before = findTextarea().value;
  const current = () => findTextarea()?.value ?? before;
  const dispatch = (make) => {
    const el = findTextarea();
    const pos = el ? el.value.indexOf(G.MARKER) : -1;
    if (pos < 0) return;
    el.focus();
    el.setSelectionRange(pos + G.MARKER.length, pos + G.MARKER.length);
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(make(dt));
  };
  const waitFor = async (ms, until) => {
    for (let t = 0; t < ms; t += 250) {
      const s = G.uploadState(before, current());
      if (until.includes(s)) return s;
      await sleep(250);
    }
    return G.uploadState(before, current());
  };

  dispatch((dt) => new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  let state = await waitFor(3000, ['done', 'uploading']);
  if (state === 'none') {
    // paste を拾わない画面ではドロップを試す
    dispatch((dt) => new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    state = await waitFor(3000, ['done', 'uploading']);
  }
  if (state === 'uploading') state = await waitFor(30000, ['done']);
  if (state !== 'done') showFallback('スクリーンショットを自動で添付できませんでした。', false);
  return state;

  function showFallback(message, withBody) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .box{display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:520px;padding:10px 12px;background:#fff8c5;color:#1f2328;
        border:1px solid #d4a72c;border-radius:8px;font:13px system-ui,"Segoe UI","Hiragino Sans",Meiryo,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)}
      button{padding:4px 10px;border:1px solid #d0d7de;border-radius:6px;background:#fff;color:#1f2328;cursor:pointer;font:inherit}
    </style><div class="box"><span class="msg"></span></div>`;
    const box = root.querySelector('.box');
    root.querySelector('.msg').textContent = `${message} コピーして本文に Ctrl+V で貼り付けてください。`;
    const button = (label, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = async () => {
        try {
          await onClick();
          b.textContent = '✓ コピーしました';
        } catch {
          b.textContent = 'コピーに失敗しました';
        }
      };
      box.appendChild(b);
    };
    if (withBody) button('📋 本文をコピー', () => navigator.clipboard.writeText(body));
    if (bytes) {
      // Clipboard API は PNG しか受け付けないので、JPEG の場合は PNG に変換する
      button('📋 スクショをコピー', async () => {
        let blob = new Blob([bytes], { type: mime });
        if (mime !== 'image/png') {
          const bmp = await createImageBitmap(blob);
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          c.getContext('2d').drawImage(bmp, 0, 0);
          blob = await c.convertToBlob({ type: 'image/png' });
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      });
    }
    const close = document.createElement('button');
    close.textContent = '✕';
    close.onclick = () => host.remove();
    box.appendChild(close);
    document.body.appendChild(host);
  }
}

// ---------- 公開リポジトリかどうか ----------

const visibilityCache = new Map();

async function repoVisibility(repo) {
  if (!G.REPO_RE.test(repo)) return 'unknown';
  const cfg = await getConfig();
  const key = `${cfg.githubBase}/${repo}`;
  if (visibilityCache.has(key)) return visibilityCache.get(key);
  const api = cfg.githubBase === 'https://github.com' ? 'https://api.github.com' : `${cfg.githubBase}/api/v3`;
  let v = 'unknown';
  try {
    // 認証なしで見えるなら公開リポジトリ。非公開・存在しない場合は 404 になる
    const res = await fetch(`${api}/repos/${repo}`, { credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 200) v = (await res.json())?.private === false ? 'public' : 'private';
    else if (res.status === 404) v = 'private';
  } catch {}
  if (v !== 'unknown') visibilityCache.set(key, v);
  return v;
}

// ---------- エラー収集（hook.js）の登録 ----------
// 設定済みホストのうち、アクセスを許可されたものにだけ MAIN world で登録する。

let syncing = Promise.resolve();
function syncHookRegistration() {
  syncing = syncing.then(doSync, doSync);
  return syncing;
}
async function doSync() {
  try {
    const cfg = await getConfig();
    const patterns = [...new Set(cfg.rules.flatMap((r) => G.matchPatternsFor(r.pattern)))];
    const granted = [];
    for (const p of patterns) if (await chrome.permissions.contains({ origins: [p] })) granted.push(p);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [HOOK_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [HOOK_ID] });
    if (granted.length) {
      await chrome.scripting.registerContentScripts([
        { id: HOOK_ID, js: ['src/hook.js'], matches: granted, runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
      ]);
    }
  } catch (e) {
    console.warn('[github-feedback] hook registration:', e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  syncHookRegistration();
  cleanupJobs();
});
chrome.storage.onChanged.addListener((_, area) => area === 'sync' && syncHookRegistration());
chrome.permissions.onAdded.addListener(syncHookRegistration);
chrome.permissions.onRemoved.addListener(syncHookRegistration);
