const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/lib.js');

test('truncate はサロゲートペアを壊さず、encodeURIComponent が通る', () => {
  const s = 'a'.repeat(79) + '😀😀';
  const t = G.truncate(s, 80);
  assert.equal(t, 'a'.repeat(79) + '😀…');
  assert.doesNotThrow(() => encodeURIComponent(t));
  assert.equal(G.truncate('abc', 5), 'abc');
});

test('codeBlock は中のバッククォートより長いフェンスを使う', () => {
  const b = G.codeBlock('x ```` y');
  assert.ok(b.startsWith('`````\n'));
  assert.ok(b.endsWith('\n`````'));
});

test('parseRepo はさまざまな書き方を owner/repo にそろえる', () => {
  const cases = {
    'example-org/app': ['example-org/app', null],
    'https://github.com/example-org/app': ['example-org/app', 'https://github.com'],
    'https://github.com/example-org/app/issues/3?x=1': ['example-org/app', 'https://github.com'],
    'example-org/app.git': ['example-org/app', null],
    'git@github.com:example-org/app.git': ['example-org/app', 'https://github.com'],
    'https://user:tok@ghe.example.co.jp/org/app/': ['org/app', 'https://ghe.example.co.jp'],
    'not a repo': ['', null],
    'a/b c': ['', null],
  };
  for (const [input, [repo, origin]] of Object.entries(cases)) {
    assert.deepEqual(G.parseRepo(input), { repo, origin }, input);
  }
});

test('normalizeBase は https・認証情報なし・パスなしだけ受け付ける', () => {
  assert.equal(G.normalizeBase(''), 'https://github.com');
  assert.equal(G.normalizeBase('https://ghe.example.co.jp/'), 'https://ghe.example.co.jp');
  assert.throws(() => G.normalizeBase('http://ghe.example.co.jp'));
  assert.throws(() => G.normalizeBase('https://u:p@github.com'));
  assert.throws(() => G.normalizeBase('https://github.com/org'));
  assert.throws(() => G.normalizeBase('github.com'));
});

test('ホストのパターン照合', () => {
  const yes = [
    ['localhost:*', 'localhost', ''],
    ['localhost:*', 'localhost', '3000'],
    ['localhost', 'localhost', '5173'],
    ['localhost:3000', 'localhost', '3000'],
    ['*.stg.example.com', 'a.stg.example.com', '8443'],
    ['*.stg.example.com', 'stg.example.com', ''],
    ['https://*.stg.example.com/', 'a.b.stg.example.com', ''],
    ['D1234.CloudFront.net', 'd1234.cloudfront.net', ''],
  ];
  const no = [
    ['localhost:3000', 'localhost', '3001'],
    ['*.stg.example.com', 'evilstg.example.com', ''],
    ['stg.example.com', 'a.stg.example.com', ''],
  ];
  for (const [p, h, port] of yes) assert.ok(G.hostMatches(p, h, port), `${p} ~ ${h}:${port}`);
  for (const [p, h, port] of no) assert.ok(!G.hostMatches(p, h, port), `${p} !~ ${h}:${port}`);
  for (const bad of ['d1234*.cloudfront.net', 'a*b', '*', '']) assert.equal(G.parsePattern(bad), null, bad);
  assert.deepEqual(G.matchPatternsFor('localhost:*'), ['*://localhost/*']);
  assert.deepEqual(G.matchPatternsFor('*.stg.example.com'), ['*://*.stg.example.com/*']);
});

test('resolveTarget: 環境名はホストから、ラベルは起票先に合わせる', () => {
  const cfg = G.normalizeConfig({
    defaultLabels: 'feedback',
    rules: [
      { pattern: 'localhost:*', repo: 'org/app', env: 'local', labels: 'env:local' },
      { pattern: '*.stg.example.com', repo: 'org/app', env: 'stg', labels: '' },
    ],
  });
  assert.deepEqual(
    (({ env, labels }) => ({ env, labels }))(G.resolveTarget(cfg, 'a.stg.example.com', '', 'org/app')),
    { env: 'stg', labels: 'feedback' },
  );
  assert.equal(G.resolveTarget(cfg, 'prod.example.com', '', 'org/app').env, '');
  assert.equal(G.resolveTarget(cfg, 'localhost', '3000', 'org/app').labels, 'env:local');
});

test('normalizeConfig は壊れた値を捨てる', () => {
  const cfg = G.normalizeConfig({
    githubBase: 'http://evil.example',
    defaultRepo: 'https://github.com/o/r',
    rules: 'nope',
    shotMode: 'x',
  });
  assert.equal(cfg.githubBase, 'https://github.com');
  assert.equal(cfg.defaultRepo, 'o/r');
  assert.deepEqual(cfg.rules, []);
  assert.equal(cfg.shotMode, 'viewport');
  assert.equal(cfg.defaultLabels, 'feedback');
  const cfg2 = G.normalizeConfig({ rules: [null, { pattern: 'a*b', repo: 'o/r' }, { pattern: 'x.com', repo: 'o/r', labels: ' a , ,b ' }] });
  assert.deepEqual(cfg2.rules, [{ pattern: 'x.com', repo: 'o/r', env: '', labels: 'a,b' }]);
});

test('redactUrl は秘密情報らしきクエリとフラグメントをマスクする', () => {
  const r = (u) => G.redactUrl(u);
  assert.equal(r('https://app.example.com/cb?code=abc123&tab=2'), 'https://app.example.com/cb?code=REDACTED&tab=2');
  assert.equal(
    r('https://app.example.com/#access_token=xyz&expires_in=3600'),
    'https://app.example.com/#access_token=REDACTED&expires_in=3600',
  );
  assert.equal(r('https://app.example.com/#/users/1?token=t'), 'https://app.example.com/#/users/1?token=REDACTED');
  assert.equal(r('https://app.example.com/#/users/1'), 'https://app.example.com/#/users/1');
  const s3 = r('https://b.s3.amazonaws.com/k.png?X-Amz-Credential=AKIA&X-Amz-Signature=deadbeef&X-Amz-Date=20260101');
  assert.ok(s3.includes('X-Amz-Credential=REDACTED') && s3.includes('X-Amz-Signature=REDACTED') && s3.includes('X-Amz-Date=20260101'));
  assert.equal(r('https://u:p@x.com/'), 'https://x.com/');
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(r(`https://x.com/?id=${uuid}`), `https://x.com/?id=${uuid}`);
  assert.ok(r('https://x.com/?q=' + 'a1'.repeat(20)).endsWith('q=REDACTED'));
  assert.equal(G.redactUrl('/api/items?session=1', 'https://x.com'), 'https://x.com/api/items?session=REDACTED');
});

test('redactText はトークン・鍵・メールをマスクする', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijk';
  const t = G.redactText(
    `Authorization: Bearer abcdefghijklmnop ${jwt} AKIAABCDEFGHIJKLMNOP ghp_${'a'.repeat(36)} password=hunter22 taro.yamada@example.co.jp https://x.com/?token=1`,
  );
  for (const leak of ['abcdefghijklmnop', jwt, 'AKIAABCDEFGHIJKLMNOP', 'ghp_', 'hunter22', 'taro.yamada', 'token=1']) {
    assert.ok(!t.includes(leak), `leaked: ${leak} in ${t}`);
  }
  assert.ok(t.includes('t***@example.co.jp'));
});

test('validateDiag は不正な形を受け流す', () => {
  assert.deepEqual(G.validateDiag(null), { logs: [], net: [] });
  assert.deepEqual(G.validateDiag({ logs: 'x', net: {} }), { logs: [], net: [] });
  const d = G.validateDiag({ logs: [null, 1, { t: 'x', level: 5, msg: { a: 1 } }], net: [{ url: {}, status: 500, method: 'get' }] });
  assert.equal(d.logs.length, 1);
  assert.equal(typeof d.logs[0].msg, 'string');
  assert.equal(d.net[0].status, '500');
});

test('buildBody はページ由来の値をコードブロックの外に出さない', () => {
  const evil = '@everyone <img src=x> [link](https://evil) | x\n## 偽見出し ```';
  const body = G.buildBody({
    comment: 'ボタンが押せない',
    url: 'https://app.example.com/?code=secret1',
    pageTitle: evil,
    env: 'stg',
    appVersion: evil,
    viewport: '1440×900 @2x',
    browser: 'Chrome 154 / Windows',
    time: '2026/10/8 15:00:00',
    target: { selector: '#a > b', text: evil, html: `<input type="hidden" value="x">${evil}` },
    diag: { logs: [{ t: 1, level: 'error', msg: evil + ' password=abc' }], net: [{ t: 2, method: 'GET', url: '/x?token=t', status: 500 }] },
  });
  assert.ok(body.includes(G.MARKER));
  assert.ok(!body.includes('secret1') && !body.includes('password=abc') && !body.includes('token=t'));
  // コードブロックの外側に @everyone や偽見出しが出ていないこと
  const outside = body.replace(/(`{3,})[^\n]*\n[\s\S]*?\n\1/g, '');
  assert.ok(!outside.includes('@everyone'), outside);
  assert.ok(!outside.includes('偽見出し'), outside);
  assert.ok(!outside.includes('<img src=x>'), outside);
});

test('buildIssueUrl は本文を載せず、タイトルとラベルだけ渡す', () => {
  const url = G.buildIssueUrl('https://github.com', 'o/r', { title: 'タイトル😀', labels: ' a, b ' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://github.com/o/r/issues/new');
  assert.equal(u.searchParams.get('body'), G.MARKER);
  assert.equal(u.searchParams.get('labels'), 'a,b');
  assert.equal(u.searchParams.get('title'), 'タイトル😀');
  assert.throws(() => G.buildIssueUrl('https://github.com', 'https://github.com/o/r', {}));
  assert.ok(G.buildIssueUrl('https://github.com', 'o/r', { title: 'x'.repeat(1000) }).length < 400);
});

test('uploadState は挿入された部分だけで判定する', () => {
  const before = `## コメント\nUploading が終わらない\n${G.MARKER}\n\n## 環境`;
  const ins = (s) => before.replace(G.MARKER, G.MARKER + s);
  assert.equal(G.uploadState(before, before), 'none');
  assert.equal(G.uploadState(before, ins('\n![Uploading screenshot.png…]()')), 'uploading');
  assert.equal(G.uploadState(before, ins('\n<img width="800" alt="Image" src="https://github.com/user-attachments/assets/a" />')), 'done');
  assert.equal(G.uploadState(before, ins('\n![Image](https://github.com/user-attachments/assets/a)')), 'done');
  assert.equal(G.uploadState(before, ''), 'none');
});
