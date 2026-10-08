// Chrome ウェブストア / 社内配布用の ZIP を dist/ に作る（拡張機能の実行に必要なファイルだけを含める）。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const dist = path.join(root, 'dist');
// release-it は dist/*.zip を Release に添付するので、古い版の ZIP を残さない
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `github-feedback-${version}.zip`);
fs.rmSync(out, { force: true });

const include = ['manifest.json', 'LICENSE', 'icons', 'src'];
if (process.platform === 'win32') {
  // PowerShell 5.1 の Compress-Archive はパス区切りが \ になるため、Windows 標準の bsdtar を使う
  // Git for Windows の GNU tar が先に見つかることがあるので System32 のものを明示する
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', path.relative(root, out), ...include], { cwd: root, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-X', out, ...include], { cwd: root, stdio: 'inherit' });
}
console.log(`created ${path.relative(root, out)}`);
