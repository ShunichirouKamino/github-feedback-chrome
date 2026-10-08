const G = self.GHFB;
const FIELDS = [
  ['pattern', 'localhost:*'],
  ['repo', 'owner/repo'],
  ['env', 'local'],
  ['labels', 'feedback,env:local'],
];

const $ = (id) => document.getElementById(id);
const tbody = $('rules');

function addRow(rule = {}) {
  const tr = document.createElement('tr');
  for (const [key, ph] of FIELDS) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.dataset.key = key;
    input.placeholder = ph;
    input.value = rule[key] ?? '';
    td.appendChild(input);
    tr.appendChild(td);
  }
  const td = document.createElement('td');
  td.className = 'del';
  const del = document.createElement('button');
  del.textContent = '✕';
  del.title = '削除';
  del.onclick = () => tr.remove();
  td.appendChild(del);
  tr.appendChild(td);
  tbody.appendChild(tr);
}

function render(cfg) {
  $('githubBase').value = cfg.githubBase;
  $('defaultRepo').value = cfg.defaultRepo;
  $('defaultLabels').value = cfg.defaultLabels;
  $('shotMode').value = cfg.shotMode;
  tbody.textContent = '';
  (cfg.rules.length ? cfg.rules : [{}]).forEach(addRow);
}

/** 画面の入力を検証して設定にする。エラーがあれば errors に積む */
function readForm() {
  const errors = [];
  let githubBase = G.DEFAULTS.githubBase;
  try {
    githubBase = G.normalizeBase($('githubBase').value);
  } catch (e) {
    errors.push(e.message);
  }

  const repoOf = (value, where) => {
    const { repo, origin } = G.parseRepo(value);
    if (!repo) errors.push(`${where}: リポジトリは owner/repo の形式か、リポジトリの URL で入力してください。`);
    else if (origin && origin !== githubBase) {
      errors.push(`${where}: リポジトリのホスト（${origin}）が「GitHub のホスト」（${githubBase}）と違います。`);
    }
    return repo;
  };

  const defaultRepoRaw = $('defaultRepo').value.trim();
  const defaultRepo = defaultRepoRaw ? repoOf(defaultRepoRaw, 'デフォルトの起票先') : '';

  const rules = [];
  [...tbody.querySelectorAll('tr')].forEach((tr, i) => {
    const v = Object.fromEntries([...tr.querySelectorAll('input')].map((el) => [el.dataset.key, el.value.trim()]));
    tr.classList.remove('bad');
    if (!v.pattern && !v.repo && !v.env && !v.labels) return; // 空行は無視
    const where = `振り分け ${i + 1} 行目`;
    const before = errors.length;
    if (!G.parsePattern(v.pattern)) errors.push(`${where}: ホストのパターンの形式が正しくありません（例: localhost:* / *.stg.example.com）。`);
    const repo = repoOf(v.repo, where);
    if (errors.length > before) tr.classList.add('bad');
    rules.push({
      pattern: G.normalizePattern(v.pattern),
      repo,
      env: G.truncate(G.oneLine(v.env), 30, ''),
      labels: G.normalizeLabels(v.labels),
    });
  });

  const cfg = {
    githubBase,
    defaultRepo,
    defaultLabels: G.normalizeLabels($('defaultLabels').value),
    shotMode: $('shotMode').value === 'selection' ? 'selection' : 'viewport',
    rules,
  };
  // エラー収集用のホストと、GHES（公開リポジトリ判定の API）へのアクセス許可
  const origins = [...new Set(rules.flatMap((r) => G.matchPatternsFor(r.pattern)))];
  if (githubBase !== G.DEFAULTS.githubBase) origins.push(`${githubBase}/*`);
  return { cfg, errors, origins };
}

async function save() {
  const status = $('status');
  status.textContent = '';
  const { cfg, errors, origins } = readForm();
  $('errors').textContent = errors.join('\n');
  if (errors.length) return;

  // permissions.request はクリック直後に呼ぶ必要があるので、他の await より先に行う
  let granted = true;
  if (origins.length) {
    try {
      granted = await chrome.permissions.request({ origins });
    } catch (e) {
      console.warn('[github-feedback] permissions:', e);
      granted = false;
    }
  }

  try {
    await chrome.storage.sync.set(cfg);
  } catch (e) {
    $('errors').textContent = `保存できませんでした: ${e.message}（ルールが多すぎる場合は減らしてください）`;
    return;
  }
  render(G.normalizeConfig(cfg));
  status.textContent = granted ? '保存しました' : '保存しました（ホストへのアクセスが許可されなかったため、エラーの記録は無効です）';
  setTimeout(() => (status.textContent = ''), granted ? 2000 : 8000);
}

$('add').onclick = () => addRow();
$('save').onclick = save;
chrome.storage.sync
  .get(null)
  .then((raw) => render(G.normalizeConfig(raw)))
  .catch((e) => ($('errors').textContent = `設定を読み込めませんでした: ${e.message}`));
