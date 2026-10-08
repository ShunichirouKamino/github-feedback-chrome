// manifest.json と package.json のバージョンが一致し、参照しているファイルがすべて存在することを確認する。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const errors = [];

if (manifest.version !== pkg.version) errors.push(`version mismatch: manifest ${manifest.version} / package ${pkg.version}`);

const files = [
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.background?.service_worker,
  manifest.options_page,
  'src/lib.js',
  'src/overlay.js',
  'src/hook.js',
].filter(Boolean);
for (const f of files) if (!fs.existsSync(path.join(root, f))) errors.push(`missing file: ${f}`);

if ((manifest.host_permissions || []).includes('<all_urls>')) errors.push('host_permissions must not include <all_urls>');
if (manifest.content_scripts) errors.push('static content_scripts are not expected (hook.js is registered dynamically)');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`manifest OK (v${manifest.version}, ${files.length} files)`);
