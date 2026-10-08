// github-feedback の E2E。テスト用アプリ（http://localhost:4567）と偽 GitHub（https://localhost:8443）を立て、
// テスト用に権限を足した拡張機能のコピーを Chrome for Testing に読み込んで、起票の流れを最後まで通す。
// 実行: npm run e2e（初回の npm install で Chrome for Testing がダウンロードされる）
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const puppeteer = require('puppeteer');
const selfsigned = require('selfsigned');

const SRC = path.join(__dirname, '..', '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'github-feedback-e2e-'));
const EXT = path.join(OUT, 'ext');
const CERT = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 2, keySize: 2048 });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 拡張機能のテスト用コピー（権限ダイアログを押せないため host_permissions を足す） ----------
fs.rmSync(EXT, { recursive: true, force: true });
fs.cpSync(SRC, EXT, { recursive: true, filter: (p) => !/[\\/](\.git|node_modules|dist|test|scripts)([\\/]|$)/.test(p) });
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('<all_urls>');
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ---------- テスト用アプリ ----------
const APP = `<!doctype html><html><head><meta charset="utf-8"><meta name="version" content="1.2.3">
<title>Test App</title></head><body style="font:16px sans-serif">
<h1>Test App</h1>
<div style="margin:120px"><button data-testid="buy" style="padding:16px 32px;font-size:18px">購入する @everyone</button></div>
<form><input type="hidden" name="csrf" value="CSRF_SECRET_VALUE"><input name="q" value="typed-value"></form>
<script>
  console.error('API failed', { password: 'hunter22', user: 'taro.yamada@example.com', nested: { deep: { deeper: 1 } } });
  console.warn('deprecated thing');
  fetch('/api/fail?token=abc123&page=1');
  const x = new XMLHttpRequest(); x.open('GET', '/api/xhr-fail?session=s3cr3t'); x.send();
  const a = new XMLHttpRequest(); a.open('GET', '/api/slow'); a.send(); a.abort();
  setTimeout(() => { throw new Error('boom from page'); }, 10);
</script></body></html>`;

// ページから拡張機能の UI を覗いたり、診断データを偽装したりする敵対的なページ
const HOSTILE = `<!doctype html><html><head><meta charset="utf-8"><title>Hostile</title></head><body>
<div style="margin:120px"><button style="padding:16px 32px">target</button></div>
<script>
  window.__hostile = { shadow: 'not-seen', spoofed: 0 };
  new MutationObserver(() => {
    const h = document.querySelector('[data-github-feedback]');
    if (h && window.__hostile.shadow === 'not-seen') window.__hostile.shadow = String(h.shadowRoot);
  }).observe(document.documentElement, { childList: true, subtree: true });
  // 先回りして壊れた応答を返す
  window.addEventListener('ghfb:request', (e) => {
    window.__hostile.spoofed++;
    document.dispatchEvent(new CustomEvent('ghfb:response', { detail: '{}' }));
    document.dispatchEvent(new CustomEvent('ghfb:response', { detail: JSON.stringify({ nonce: e.detail, logs: [null, { msg: 1 }], net: 'x' }) }));
  }, true);
</script></body></html>`;

const app = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.writeHead(req.url.startsWith('/api/slow') ? 200 : 500);
    return req.url.startsWith('/api/slow') ? setTimeout(() => res.end('ok'), 2000) : res.end('error');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(req.url.startsWith('/hostile') ? HOSTILE : APP);
});

// ---------- 偽 GitHub ----------
let repoPrivate = true;
const FAKE_ISSUE = `<!doctype html><html><head><meta charset="utf-8"><title>New Issue</title></head><body style="font:14px sans-serif">
<h2>New issue (fake)</h2><input id="t" style="width:600px"><br><br>
<textarea name="issue[body]" id="b" style="width:900px;height:600px"></textarea>
<script>
  const p = new URLSearchParams(location.search);
  t.value = p.get('title') || '';
  b.value = p.get('body') || '';
  window.__uploads = [];
  b.addEventListener('paste', (e) => {
    const f = e.clipboardData && e.clipboardData.files[0];
    if (!f) return;
    e.preventDefault();
    const ph = '![Uploading ' + f.name + '…]()';
    const pos = b.selectionStart;
    b.value = b.value.slice(0, pos) + '\\n' + ph + '\\n' + b.value.slice(pos);
    window.__uploads.push({ name: f.name, size: f.size, type: f.type });
    setTimeout(() => {
      b.value = b.value.replace(ph, '<img width="800" alt="Image" src="https://localhost:8443/user-attachments/assets/abc" />');
    }, 800);
  });
</script></body></html>`;
const gh = https.createServer({ key: CERT.private, cert: CERT.cert }, (req, res) => {
  if (req.url.startsWith('/api/v3/repos/o/r')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ private: repoPrivate }));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(req.url.startsWith('/o/r/issues/new') ? FAKE_ISSUE : '<h1>other page</h1>');
});

async function main() {
  await new Promise((r) => app.listen(4567, r));
  await new Promise((r) => gh.listen(8443, r));

  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [EXT],
    args: ['--ignore-certificate-errors', '--window-size=1400,1000', ...(process.env.CI ? ['--no-sandbox'] : [])],
    defaultViewport: null,
  });
  try {
    const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('src/background.js'));
    const sw = await swTarget.worker();

    await sw.evaluate(() =>
      chrome.storage.sync.set({
        githubBase: 'https://localhost:8443',
        defaultRepo: '',
        defaultLabels: 'feedback',
        shotMode: 'viewport',
        rules: [{ pattern: 'localhost:4567', repo: 'o/r', env: 'local', labels: 'feedback,env:local' }],
      }),
    );
    let registered = [];
    for (let i = 0; i < 20 && !registered.length; i++) {
      await sleep(200);
      registered = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    }
    check('hook.js が設定済みホストにだけ動的登録される', registered.length === 1 && registered[0].world === 'MAIN', JSON.stringify(registered.map((r) => r.matches)));

    // ---------- シナリオ 1: 通常の起票 ----------
    const page = (await browser.pages())[0];
    await page.goto('http://localhost:4567/app?token=abc123&tab=2#access_token=xyz789', { waitUntil: 'networkidle0' });
    await sleep(300);
    const shot1 = await fileIssue(browser, sw, page, 'button[data-testid="buy"]', '購入ボタンが反応しない😀\n2行目 @someone', 'form-normal.png');
    await verifyIssue(shot1, { expectDiag: true });

    // ---------- シナリオ 2: 敵対的ページ ----------
    await page.bringToFront();
    await page.goto('http://localhost:4567/hostile', { waitUntil: 'networkidle0' });
    const shot2 = await fileIssue(browser, sw, page, 'button', 'hostile page test', 'form-hostile.png');
    const hostile = await page.evaluate(() => window.__hostile);
    check('敵対的ページから Shadow DOM が見えない', hostile.shadow === 'null', JSON.stringify(hostile));
    check('偽の診断データでも起票が完走する', !!shot2.body, '');
    if (shot2.body) check('偽の診断データは不正な値を無視して取り込まれる', !shot2.body.includes('[object Object]'), '');

    // ---------- シナリオ 3: 公開リポジトリの警告 ----------
    repoPrivate = false;
    await sw.evaluate(() => chrome.runtime.reload && null);
    await page.bringToFront();
    await page.goto('http://localhost:4567/app', { waitUntil: 'networkidle0' });
    // visibility はキャッシュされるので、別の SW 起動を待たずに別リポジトリ名で確認する代わりにキャッシュを消す
    await sw.evaluate(() => typeof visibilityCache !== 'undefined' && visibilityCache.clear());
    await openForm(sw, page, 'button[data-testid="buy"]');
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, 'form-public.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // ---------- シナリオ 4: タブ切り替え中の撮影は中止される ----------
    repoPrivate = true;
    await sw.evaluate(() => visibilityCache.clear());
    await page.bringToFront();
    await openForm(sw, page, 'button[data-testid="buy"]');
    await page.keyboard.type('tab switch test');
    const other = await browser.newPage();
    await other.goto('https://localhost:8443/other');
    const before = (await browser.pages()).length;
    // フォームのあるタブは裏に回ったまま、送信だけ行う
    await page.evaluate(() => document.activeElement && null);
    const res = await sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return new Promise((resolve) => {
        // overlay からの送信を模して、background の handleSubmit を直接呼ぶ
        handleSubmit({ repo: 'o/r', title: '', comment: 'x', ctx: {}, rect: null, viewportWidth: 1400 }, tab).then(resolve, (e) => resolve({ error: e.message }));
      });
    }, 'http://localhost:4567/app');
    check('送信元タブが前面にないと撮影を中止する', res.error && res.error.includes('タブが切り替わった'), JSON.stringify(res));
    check('中止時は Issue タブを開かない', (await browser.pages()).length === before, '');
    await other.close();

    // ---------- シナリオ 5: job のライフサイクル ----------
    const jobPage = await browser.newPage();
    await jobPage.goto('http://localhost:4567/app?job=1');
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:4567/app?job=1' })).pop().id);
    const jobOf = () => sw.evaluate((id) => chrome.storage.session.get(`job:${id}`).then((o) => o[`job:${id}`] || null), tabId);
    const setJob = () =>
      sw.evaluate((id) => saveJob(id, { origin: 'https://localhost:8443', repo: 'o/r', body: 'B', dataUrl: null, shotError: null }), tabId);

    await setJob();
    await jobPage.goto('http://localhost:4567/app'); // 外部 origin（SSO の IdP 相当）は待つ
    await sleep(300);
    check('別 origin（SSO 相当）を経由しても job を保持する', !!(await jobOf()));
    await jobPage.goto('https://localhost:8443/other'); // 起票先 origin の無関係な画面
    await sleep(300);
    check('起票先 origin の無関係な画面に移ったら job を破棄する', !(await jobOf()));

    await setJob();
    await jobPage.goto('https://localhost:8443/o/r/issues/new?body=' + encodeURIComponent('<!-- github-feedback:screenshot -->'));
    for (let i = 0; i < 20 && (await jobOf()); i++) await sleep(250);
    check('Issue 画面で本文を入れたら job を消す', !(await jobOf()));
    const filled = await jobPage.evaluate(() => document.getElementById('b').value);
    check('job の本文が入力される', filled === 'B', JSON.stringify(filled));
    await jobPage.close();
  } finally {
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    app.close();
    gh.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed  (screenshots: ${OUT})`);
  process.exitCode = failed.length ? 1 : 0;
}

async function openForm(sw, page, selector) {
  await page.bringToFront();
  const url = page.url();
  await sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u.split('#')[0] + '*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/lib.js', 'src/overlay.js'] });
  }, url);
  await sleep(300);
  const box = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(300);
}

async function fileIssue(browser, sw, page, selector, comment, shotName) {
  await openForm(sw, page, selector);
  await page.keyboard.type(comment.split('\n')[0]);
  for (const line of comment.split('\n').slice(1)) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    await page.keyboard.type(line);
  }
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, shotName) });
  const newTarget = browser.waitForTarget((t) => t.url().startsWith('https://localhost:8443/o/r/issues/new'), { timeout: 15000 });
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  let issuePage;
  try {
    issuePage = await (await newTarget).page();
  } catch (e) {
    check(`Issue タブが開く (${shotName})`, false, e.message);
    return {};
  }
  check(`Issue タブが開く (${shotName})`, true);
  const url = new URL(issuePage.url());
  let body = '';
  let uploads = [];
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    ({ body, uploads } = await issuePage.evaluate(() => ({ body: document.getElementById('b')?.value || '', uploads: window.__uploads || [] })));
    if (body.includes('<img') || i === 39) break;
  }
  const banner = await issuePage.evaluate(() => [...document.body.children].some((el) => el.shadowRoot === null && el.style.position === 'fixed'));
  await issuePage.screenshot({ path: path.join(OUT, 'issue-' + shotName) });
  return { url, body, uploads, banner, issuePage };
}

async function verifyIssue({ url, body, uploads, banner }, { expectDiag }) {
  if (!url) return;
  const G = require(path.join(SRC, 'src/lib.js'));
  check('URL に本文を載せていない（マーカーのみ）', url.searchParams.get('body') === G.MARKER, url.searchParams.get('body'));
  check('タイトルに環境名とコメント 1 行目が入る', url.searchParams.get('title') === '[local] 購入ボタンが反応しない😀', url.searchParams.get('title'));
  check('ラベルが設定どおり', url.searchParams.get('labels') === 'feedback,env:local', url.searchParams.get('labels'));
  check('本文が入力欄に入る', body.includes('## コメント') && body.includes('2行目 @someone'), body.slice(0, 80));
  check('スクショが 1 回だけ貼られ、<img> に置き換わる', uploads.length === 1 && body.includes('<img') && !body.includes('Uploading'), JSON.stringify(uploads));
  check('スクショは PNG / JPEG で中身がある', uploads[0] && /image\/(png|jpeg)/.test(uploads[0].type) && uploads[0].size > 10000, JSON.stringify(uploads[0]));
  check('添付成功時はフォールバックのバナーを出さない', !banner, '');
  for (const secret of ['abc123', 'xyz789', 'hunter22', 's3cr3t', 'CSRF_SECRET_VALUE', 'typed-value', 'taro.yamada']) {
    check(`秘密情報が本文に残らない: ${secret}`, !body.includes(secret));
  }
  const outside = body.replace(/(`{3,})[^\n]*\n[\s\S]*?\n\1/g, '');
  check('ページ由来の @everyone はコードブロックの外に出ない', !outside.includes('@everyone'));
  if (expectDiag) {
    check('コンソールエラーが入る', body.includes('API failed') && body.includes('boom from page'));
    check('失敗した通信が入る（fetch / XHR）', body.includes('/api/fail?token=REDACTED') && body.includes('/api/xhr-fail?session=REDACTED'));
    check('abort した XHR は入らない', !body.includes('/api/slow'));
    check('セレクタとバージョンが入る', body.includes('[data-testid="buy"]') && body.includes('version=1.2.3'));
  }
  fs.writeFileSync(path.join(OUT, 'body-normal.md'), body);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
