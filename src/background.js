// Service worker: コメントモードの注入、スクショ撮影＋注釈、タブ操作を担当する。

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/overlay.js'],
    });
  } catch (e) {
    // chrome:// や Web Store などスクリプトを注入できないページ
    console.warn('[github-feedback] inject failed:', e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'ghfb:capture':
      captureAnnotated(sender.tab.windowId, msg.rect, msg.viewportWidth)
        .then((dataUrl) => sendResponse({ dataUrl }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;

    case 'ghfb:openIssue':
      openIssue(msg.url, msg.dataUrl, sender.tab);
      return false;

    case 'ghfb:openOptions':
      chrome.runtime.openOptionsPage();
      return false;
  }
  return false;
});

// ---------- スクショの自動添付 ----------
// 画像はタブ ID ごとに storage.session に置き、Issue 作成画面の読み込み完了時に本文へ添付する。
// SSO のリダイレクトを挟んでも、service worker が一度止まっても拾えるようにしている。
const SHOT_KEY = (tabId) => `shot:${tabId}`;
const MARKER = '<!-- github-feedback:screenshot -->';

async function openIssue(url, dataUrl, opener) {
  const tab = await chrome.tabs.create({ url: 'about:blank', index: opener.index + 1, openerTabId: opener.id });
  if (dataUrl) await chrome.storage.session.set({ [SHOT_KEY(tab.id)]: dataUrl });
  await chrome.tabs.update(tab.id, { url });
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !/\/issues\/new(\?|$)/.test(tab.url || '')) return;
  const key = SHOT_KEY(tabId);
  const { [key]: dataUrl } = await chrome.storage.session.get(key);
  if (!dataUrl) return;
  await chrome.storage.session.remove(key);
  await chrome.scripting.executeScript({ target: { tabId }, func: attachScreenshot, args: [dataUrl, MARKER] });
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(SHOT_KEY(tabId)));

// Issue 作成画面に注入される関数（シリアライズして渡すので外部の変数は参照できない）。
// 本文欄に画像の paste イベントを送り、GitHub 自身のアップロード処理に添付させる。
async function attachScreenshot(dataUrl, marker) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], `screenshot-${Date.now()}.png`, { type: 'image/png' });

  const findTextarea = () => [...document.querySelectorAll('textarea')].find((t) => t.value.includes(marker));
  const linkCount = (v) => (v.match(/\]\(https?:\/\//g) || []).length;
  // 'done' | 'uploading' | 'none'
  const state = (base) => {
    const v = findTextarea()?.value || '';
    if (linkCount(v) > base) return 'done';
    return /!\[Uploading /i.test(v) ? 'uploading' : 'none';
  };
  const waitFor = async (base, ms, until) => {
    for (let t = 0; t < ms; t += 250) {
      const s = state(base);
      if (until.includes(s)) return s;
      await sleep(250);
    }
    return state(base);
  };

  let ta = null;
  for (let i = 0; i < 60 && !(ta = findTextarea()); i++) await sleep(250);
  if (!ta) return showFallback('本文欄が見つかりませんでした。');

  const base = linkCount(ta.value);
  const dispatch = (make) => {
    const el = findTextarea();
    const pos = el.value.indexOf(marker) + marker.length;
    el.focus();
    el.setSelectionRange(pos, pos);
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(make(dt));
  };

  dispatch((dt) => new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  let s = await waitFor(base, 3000, ['done', 'uploading']);
  if (s === 'none') {
    // paste を拾わない場合はドロップを試す
    dispatch((dt) => new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    s = await waitFor(base, 3000, ['done', 'uploading']);
  }
  if (s === 'uploading') s = await waitFor(base, 30000, ['done']);
  if (s !== 'done') showFallback('スクリーンショットを自動で添付できませんでした。');

  function showFallback(message) {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;gap:8px;align-items:center;padding:10px 12px;' +
      'background:#fff8c5;color:#1f2328;border:1px solid #d4a72c;border-radius:8px;font:13px system-ui,sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.2)';
    const text = document.createElement('span');
    text.textContent = `${message} コピーして本文に Ctrl+V してください。`;
    const copy = document.createElement('button');
    copy.textContent = '📋 スクショをコピー';
    const close = document.createElement('button');
    close.textContent = '✕';
    for (const b of [copy, close]) b.style.cssText = 'padding:4px 10px;border:1px solid #d0d7de;border-radius:6px;background:#fff;cursor:pointer;font:inherit';
    copy.onclick = async () => {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
      copy.textContent = '✓ コピーしました';
    };
    close.onclick = () => box.remove();
    box.append(text, copy, close);
    document.body.appendChild(box);
  }
}

// 表示中のタブを撮影し、選択範囲以外を暗くして赤枠を描く。
async function captureAnnotated(windowId, rect, viewportWidth) {
  const raw = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(raw)).blob());
  const s = bmp.width / viewportWidth;

  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const g = canvas.getContext('2d');
  g.drawImage(bmp, 0, 0);

  if (rect) {
    const pad = 4 * s;
    const x = rect.left * s - pad;
    const y = rect.top * s - pad;
    const w = rect.width * s + pad * 2;
    const h = rect.height * s + pad * 2;

    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.rect(0, 0, canvas.width, canvas.height);
    g.rect(x, y, w, h);
    g.fill('evenodd');

    g.lineWidth = 3 * s;
    g.strokeStyle = '#e5484d';
    g.strokeRect(x, y, w, h);
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return 'data:image/png;base64,' + toBase64(new Uint8Array(await blob.arrayBuffer()));
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
