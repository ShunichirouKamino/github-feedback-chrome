const DEFAULTS = { githubBase: 'https://github.com', defaultRepo: '', defaultLabels: 'feedback', rules: [] };
const FIELDS = [
  ['pattern', 'localhost:*'],
  ['repo', 'owner/repo'],
  ['env', 'local'],
  ['labels', 'feedback,env:local'],
];

const tbody = document.getElementById('rules');

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

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  for (const k of ['githubBase', 'defaultRepo', 'defaultLabels']) document.getElementById(k).value = cfg[k];
  (cfg.rules.length ? cfg.rules : [{}]).forEach(addRow);
}

// "https://github.com/owner/repo/issues" や "owner/repo.git" を "owner/repo" にそろえる。
// URL の場合は GitHub URL の推定用に origin も返す。
function parseRepo(value) {
  let v = value.trim();
  let origin = null;
  const m = v.match(/^(https?:\/\/[^/]+)\/(.*)$/i);
  if (m) [, origin, v] = m;
  const repo = v.split('/').filter(Boolean).slice(0, 2).join('/').replace(/\.git$/i, '');
  return { repo, origin };
}

async function save() {
  let githubBase = document.getElementById('githubBase').value.trim().replace(/\/+$/, '') || DEFAULTS.githubBase;
  const origins = [];
  const normalize = (value) => {
    const { repo, origin } = parseRepo(value);
    if (origin) origins.push(origin);
    return repo;
  };

  const rules = [...tbody.querySelectorAll('tr')]
    .map((tr) => Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.dataset.key, i.value.trim()])))
    .filter((r) => r.pattern && r.repo)
    .map((r) => ({ ...r, repo: normalize(r.repo) }));
  const defaultRepo = normalize(document.getElementById('defaultRepo').value);

  // GitHub URL が既定のままで、貼られた URL が別ホスト (GHES) ならそちらに合わせる
  if (githubBase === DEFAULTS.githubBase && origins.length && origins.every((o) => o === origins[0])) {
    githubBase = origins[0];
  }

  const cfg = {
    githubBase,
    defaultRepo,
    defaultLabels: document.getElementById('defaultLabels').value.trim(),
    rules,
  };
  await chrome.storage.sync.set(cfg);
  // 正規化後の値を画面にも反映
  tbody.innerHTML = '';
  load();
  const status = document.getElementById('status');
  status.textContent = '保存しました';
  setTimeout(() => (status.textContent = ''), 2000);
}

document.getElementById('add').onclick = () => addRow();
document.getElementById('save').onclick = save;
load();
