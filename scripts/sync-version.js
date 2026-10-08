// release-it が package.json の版を上げた後に呼ばれ、manifest.json の version を同じ値にそろえる。
const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error(`invalid version: ${version} (Chrome extensions only accept numeric versions such as 1.2.3)`);
  process.exit(1);
}
const file = path.join(__dirname, '..', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.version = version;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json version -> ${version}`);
