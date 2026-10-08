// 拡張機能（background / overlay / options / Issue 画面への注入）と Node のテストで共有する純粋関数。
// ブラウザでは self.GHFB に、Node では module.exports に公開する。
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    githubBase: 'https://github.com',
    defaultRepo: '',
    defaultLabels: 'feedback',
    shotMode: 'viewport', // 'viewport'（画面全体＋選択範囲を強調） | 'selection'（選択範囲のみ）
    rules: [],
  });

  const MARKER = '<!-- github-feedback:screenshot -->';
  const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const REDACTED = 'REDACTED';

  // ---------- 文字列 ----------

  /** コードポイント単位で切り詰める（サロゲートペアを壊さない） */
  function truncate(s, max, ellipsis = '…') {
    const chars = Array.from(String(s ?? ''));
    return chars.length > max ? chars.slice(0, max).join('') + ellipsis : chars.join('');
  }

  /** 改行・制御文字を空白にして 1 行にする */
  function oneLine(s) {
    return String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  }

  /** 中身に含まれるバッククォートより長いフェンスで囲む（コードブロックから抜けられないようにする） */
  function codeBlock(s, lang = '') {
    const text = String(s ?? '');
    const longest = Math.max(0, ...(text.match(/`+/g) || []).map((m) => m.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}${lang}\n${text}\n${fence}`;
  }

  // ---------- 設定 ----------

  /** "https://github.com/o/r/issues/1" / "o/r.git" / "git@github.com:o/r.git" → { repo, origin } */
  function parseRepo(value) {
    let v = String(value ?? '').trim();
    let origin = null;
    const ssh = v.match(/^[\w.-]+@([^:/]+):(.+)$/);
    if (ssh) {
      origin = `https://${ssh[1].toLowerCase()}`;
      v = ssh[2];
    } else if (/^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v);
        origin = u.origin;
        v = u.pathname;
      } catch {
        return { repo: '', origin: null };
      }
    }
    v = v.replace(/[?#].*$/, '');
    const repo = v.split('/').filter(Boolean).slice(0, 2).join('/').replace(/\.git$/i, '');
    return { repo: REPO_RE.test(repo) ? repo : '', origin };
  }

  /** GitHub のホスト設定を検証して origin を返す。不正なら Error を投げる */
  function normalizeBase(value) {
    const raw = String(value ?? '').trim() || DEFAULTS.githubBase;
    let u;
    try {
      u = new URL(raw);
    } catch {
      throw new Error('GitHub のホストが URL の形式ではありません');
    }
    if (u.protocol !== 'https:') throw new Error('GitHub のホストは https:// で始まる必要があります');
    if (u.username || u.password) throw new Error('GitHub のホストに認証情報を含めないでください');
    if (u.pathname.replace(/\/+$/, '') !== '' || u.search || u.hash) {
      throw new Error('GitHub のホストにはパスを含めないでください（例: https://ghe.example.co.jp）');
    }
    return u.origin;
  }

  function normalizeLabels(s) {
    return String(s ?? '')
      .split(',')
      .map((x) => oneLine(x))
      .filter(Boolean)
      .join(',');
  }

  /** スキーム・パスを落として小文字にする（"https://*.stg.example.com/" → "*.stg.example.com"） */
  function normalizePattern(p) {
    return String(p ?? '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/?#].*$/, '');
  }

  /**
   * ホストのパターンを解析する。許可する形式は次のとおり（それ以外は null）。
   *   example.com / *.example.com / localhost:3000 / localhost:*
   * ポートを書かなければどのポートにも一致する。"*." は example.com 自身にも一致する。
   */
  function parsePattern(p) {
    const s = normalizePattern(p);
    const m = s.match(/^(\*\.)?((?:[a-z0-9-]+\.)*[a-z0-9-]+|\[[0-9a-f:.]+\])(?::(\d{1,5}|\*))?$/);
    if (!m) return null;
    return { wildcard: !!m[1], hostname: m[2], port: m[3] && m[3] !== '*' ? m[3] : null };
  }

  function hostMatches(pattern, hostname, port) {
    const p = typeof pattern === 'string' ? parsePattern(pattern) : pattern;
    if (!p) return false;
    const h = String(hostname ?? '').toLowerCase();
    const hostOk = p.wildcard ? h === p.hostname || h.endsWith('.' + p.hostname) : h === p.hostname;
    return hostOk && (p.port === null || p.port === String(port ?? ''));
  }

  /** chrome.permissions / registerContentScripts 用の match pattern（ポートは指定できないので全ポート） */
  function matchPatternsFor(pattern) {
    const p = parsePattern(pattern);
    return p ? [`*://${p.wildcard ? '*.' : ''}${p.hostname}/*`] : [];
  }

  function matchRule(rules, hostname, port) {
    return (rules || []).find((r) => r.repo && hostMatches(r.pattern, hostname, port)) || null;
  }

  function isLocalHost(hostname) {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(String(hostname ?? ''));
  }

  /** storage から読んだ値を型・形式の検証込みで正規化する */
  function normalizeConfig(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    let githubBase;
    try {
      githubBase = normalizeBase(r.githubBase);
    } catch {
      githubBase = DEFAULTS.githubBase;
    }
    const rules = (Array.isArray(r.rules) ? r.rules : [])
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({
        pattern: normalizePattern(str(x.pattern)),
        repo: parseRepo(str(x.repo)).repo,
        env: truncate(oneLine(str(x.env)), 30, ''),
        labels: normalizeLabels(str(x.labels)),
      }))
      .filter((x) => parsePattern(x.pattern) && x.repo);
    return {
      githubBase,
      defaultRepo: parseRepo(str(r.defaultRepo)).repo,
      defaultLabels: r.defaultLabels === undefined ? DEFAULTS.defaultLabels : normalizeLabels(str(r.defaultLabels)),
      shotMode: r.shotMode === 'selection' ? 'selection' : 'viewport',
      rules,
    };
  }

  /** 選択肢に出す起票先（デフォルト → ルール順、重複なし） */
  function configuredRepos(cfg) {
    return [...new Set([cfg.defaultRepo, ...cfg.rules.map((r) => r.repo)].filter(Boolean))];
  }

  /** 環境名はホストに一致したルールから、ラベルは選んだ起票先に合わせて決める */
  function resolveTarget(cfg, hostname, port, repo) {
    const matched = matchRule(cfg.rules, hostname, port);
    const env = matched?.env || (isLocalHost(hostname) ? 'local' : '');
    const labels = matched && matched.repo === repo ? matched.labels || cfg.defaultLabels : cfg.defaultLabels;
    return { matched, env, labels };
  }

  function defaultTitle(comment, env) {
    const first = truncate(oneLine(String(comment ?? '').split('\n')[0]), 80);
    return env ? `[${env}] ${first}` : first;
  }

  // ---------- 秘密情報のマスク ----------

  const SENSITIVE_KEY = /token|secret|passw|pwd|session|sid$|auth|code|key|signature|^sig$|credential|jwt|otp|nonce|^state$|saml/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function looksLikeSecret(value) {
    const v = String(value ?? '');
    return v.length >= 32 && /^[A-Za-z0-9._~+/=-]+$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v) && !UUID_RE.test(v);
  }

  function redactParams(params) {
    for (const [k, v] of [...params]) {
      if (SENSITIVE_KEY.test(k) || looksLikeSecret(v)) params.set(k, REDACTED);
    }
  }

  /** URL のクエリ・フラグメント・認証情報から秘密情報らしき値を除く */
  function redactUrl(raw, base) {
    const s = String(raw ?? '');
    const DUMMY = 'https://relative.invalid';
    let u;
    let relative = false;
    try {
      u = new URL(s, base);
    } catch {
      // 相対 URL（"/api/x?token=..."）は仮のホストで解析し、出力では元の相対形に戻す
      try {
        u = new URL(s, DUMMY);
        relative = true;
      } catch {
        return redactText(s, { urls: false });
      }
    }
    u.username = '';
    u.password = '';
    redactParams(u.searchParams);
    const hash = u.hash.slice(1);
    if (hash) {
      // "#access_token=..." のような値と、"#/route?x=y" のようなルーティングの両方を扱う
      const q = hash.indexOf('?');
      const [route, query] = /^[^/?]*=/.test(hash) ? ['', hash] : q >= 0 ? [hash.slice(0, q), hash.slice(q + 1)] : [hash, ''];
      if (query) {
        const params = new URLSearchParams(query);
        redactParams(params);
        u.hash = route ? `${route}?${params}` : String(params);
      } else if (looksLikeSecret(route)) {
        u.hash = REDACTED;
      }
    }
    return relative ? u.href.slice(DUMMY.length) : u.href;
  }

  /** ログや HTML などの自由テキストから秘密情報らしき値を除く */
  function redactText(s, { urls = true } = {}) {
    let t = String(s ?? '');
    if (urls) {
      // スタックトレースの "URL:行:列" は行・列を URL から切り離してから扱う
      t = t.replace(/https?:\/\/[^\s"'<>`)\]]+/g, (m) => {
        const pos = m.match(/(:\d+){1,2}$/);
        return pos ? redactUrl(m.slice(0, -pos[0].length)) + pos[0] : redactUrl(m);
      });
    }
    return t
      .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, `[${REDACTED}_JWT]`)
      .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 [${REDACTED}]`)
      .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, `[${REDACTED}_AWS_KEY]`)
      .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, `[${REDACTED}_GITHUB_TOKEN]`)
      .replace(
        /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization|session(?:[_-]?id)?|csrf[_-]?token|cookie)["']?\s*[:=]\s*["']?)(?!\[?REDACTED)([^"'\s,;&}<]{3,})/gi,
        `$1[${REDACTED}]`,
      )
      .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g, '$1***@$2');
  }

  // ---------- 診断データ（ページ由来なので信用しない） ----------

  function validateDiag(raw) {
    const out = { logs: [], net: [] };
    if (!raw || typeof raw !== 'object') return out;
    const list = (a) => (Array.isArray(a) ? a.slice(-50) : []);
    for (const l of list(raw.logs)) {
      if (!l || typeof l !== 'object') continue;
      out.logs.push({ t: Number(l.t) || 0, level: truncate(oneLine(l.level), 20, ''), msg: truncate(String(l.msg ?? ''), 500) });
    }
    for (const n of list(raw.net)) {
      if (!n || typeof n !== 'object') continue;
      out.net.push({
        t: Number(n.t) || 0,
        method: truncate(oneLine(n.method), 10, ''),
        url: truncate(oneLine(n.url), 500),
        status: truncate(oneLine(n.status), 20, ''),
      });
    }
    return out;
  }

  // ---------- Issue ----------

  function formatTime(t) {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /**
   * Issue 本文を組み立てる。コメント以外のページ由来の値はすべてマスクしてコードブロックに入れ、
   * メンション・リンク・HTML として解釈されないようにする。
   */
  function buildBody(ctx) {
    const c = ctx || {};
    const L = [];
    L.push('## コメント', '', truncate(String(c.comment ?? '').trim(), 20000), '');
    L.push('## スクリーンショット', MARKER, '', '');
    L.push('> [!NOTE]', '> 以下はページから自動で取得した未検証のデータです（秘密情報らしき値はマスク済み）。', '');

    const env = [
      ['URL', c.url ? redactUrl(c.url) : ''],
      ['ページ', c.pageTitle ? redactText(truncate(c.pageTitle, 120)) : ''],
      ['環境', c.env],
      ['バージョン', c.appVersion ? redactText(truncate(c.appVersion, 200)) : ''],
      ['画面サイズ', c.viewport],
      ['ブラウザ', c.browser],
      ['日時', c.time],
    ].filter(([, v]) => v);
    L.push('## 環境', '', codeBlock(env.map(([k, v]) => `${k}: ${oneLine(v)}`).join('\n'), 'text'), '');

    if (c.target) {
      const lines = [`セレクタ: ${oneLine(truncate(c.target.selector, 300))}`];
      if (c.target.text) lines.push(`テキスト: ${oneLine(redactText(truncate(c.target.text, 200)))}`);
      L.push('## 対象要素', '', codeBlock(lines.join('\n'), 'text'));
      if (c.target.html) {
        L.push('', '<details><summary>HTML（抜粋）</summary>', '', codeBlock(redactText(truncate(c.target.html, 1500)), 'html'), '', '</details>');
      }
      L.push('');
    }

    if (c.diag) {
      const d = validateDiag(c.diag);
      const lines = [
        ...d.logs.map((l) => ({ t: l.t, s: `[${formatTime(l.t)}] ${l.level}: ${oneLine(redactText(truncate(l.msg, 300)))}` })),
        ...d.net.map((n) => ({ t: n.t, s: `[${formatTime(n.t)}] ${n.method} ${redactUrl(truncate(n.url, 300, ''))} → ${n.status}` })),
      ]
        .sort((a, b) => a.t - b.t)
        .slice(-30)
        .map((x) => x.s);
      L.push('## コンソール / 通信エラー（直近）', '', lines.length ? codeBlock(lines.join('\n'), 'text') : '_なし_', '');
    }

    L.push('<sub>Filed via github-feedback</sub>');
    return L.join('\n');
  }

  /** 本文は URL に載せない（マーカーだけ入れて、Issue 画面で本文に置き換える） */
  function buildIssueUrl(base, repo, { title, labels } = {}) {
    if (!REPO_RE.test(repo)) throw new Error('リポジトリの形式が正しくありません');
    const enc = encodeURIComponent;
    let q = `title=${enc(truncate(oneLine(title), 250, ''))}&body=${enc(MARKER)}`;
    const l = normalizeLabels(labels);
    if (l) q += `&labels=${enc(l)}`;
    return `${normalizeBase(base)}/${repo}/issues/new?${q}`;
  }

  /** before → after で挿入された部分（共通の先頭と末尾を除いた残り） */
  function insertedText(before, after) {
    const a = String(before ?? '');
    const b = String(after ?? '');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let j = 0;
    while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    return b.slice(i, b.length - j);
  }

  /**
   * 画像を貼り付けた後の本文の状態。
   *   done: 画像のリンクが挿入された / uploading: GitHub が何か挿入した（アップロード中） / none: 変化なし
   */
  function uploadState(before, after) {
    const ins = insertedText(before, after);
    if (/<img\b[^>]*\bsrc=["']https?:\/\/|!\[[^\]]*\]\(https?:\/\//i.test(ins)) return 'done';
    return ins.trim() ? 'uploading' : 'none';
  }

  const api = {
    DEFAULTS,
    MARKER,
    REPO_RE,
    truncate,
    oneLine,
    codeBlock,
    parseRepo,
    normalizeBase,
    normalizeLabels,
    normalizePattern,
    parsePattern,
    hostMatches,
    matchPatternsFor,
    matchRule,
    isLocalHost,
    normalizeConfig,
    configuredRepos,
    resolveTarget,
    defaultTitle,
    redactUrl,
    redactText,
    validateDiag,
    buildBody,
    buildIssueUrl,
    insertedText,
    uploadState,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GHFB = api;
})(typeof self !== 'undefined' ? self : globalThis);
