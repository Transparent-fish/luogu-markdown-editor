/**
 * Move the version in all three files that carry it, in one shot.
 *
 *   node scripts/bump-version.js 1.34.0
 *
 * Doing this by hand is how the Rust side ends up stuck at 0.1.0 while the web
 * build ships 1.34.0: the version lives in package.json, tauri.conf.json and
 * Cargo.toml, and only the middle one is on the path a human usually edits. This
 * script writes all three, then tells you the tag command — it deliberately does
 * not touch git, so the commit message (and the tag) stay a conscious decision.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const next = process.argv[2];

if (!next) {
  console.error('用法：node scripts/bump-version.js <版本号>，例如 1.34.0');
  process.exit(1);
}
// The tag is derived from this string, so keep it boring: v1.34.0 is the tag,
// 1.34.0 is the version. No leading "v" here, nothing to normalise later.
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`版本号必须是 x.y.z 形式（不带 v），收到：${next}`);
  process.exit(1);
}

/** 覆盖 JSON 里的 version 字段，只动那一行，不重排文件。 */
function bumpJson(relPath) {
  const file = path.join(root, relPath);
  const text = fs.readFileSync(file, 'utf8');
  const before = JSON.parse(text).version; // 先解析一次：文件本身坏掉时立刻报错
  // 用正则替换顶层 version 的取值，而不是 parse + stringify —— 后者会把整个文件
  // 重排（数组被拆成多行），让一次改版本号的 diff 看起来像重写了一遍配置。
  const out = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${next}$2`);
  if (out === text) throw new Error(`${relPath} 里找不到 version 字段`);
  fs.writeFileSync(file, out);
  return before;
}

/** 只改 [package] 段里的 version，避免碰到依赖项的版本号。 */
function bumpCargoToml(relPath) {
  const file = path.join(root, relPath);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let inPackage = false;
  let before = null;
  const out = lines.map((line) => {
    if (/^\[/.test(line)) inPackage = line.trim() === '[package]';
    if (inPackage && /^\s*version\s*=/.test(line)) {
      before = line.match(/"([^"]+)"/)[1];
      return line.replace(/"([^"]+)"/, `"${next}"`);
    }
    return line;
  });
  fs.writeFileSync(file, out.join('\n'));
  return before;
}

const changed = [
  ['package.json', bumpJson('package.json')],
  ['desktop/src-tauri/tauri.conf.json', bumpJson('desktop/src-tauri/tauri.conf.json')],
  ['desktop/src-tauri/Cargo.toml', bumpCargoToml('desktop/src-tauri/Cargo.toml')],
];

for (const [file, before] of changed) {
  console.log(`${before} -> ${next}  ${file}`);
}

console.log(`
接下来：

  node scripts/check-versions.js          # 确认三处一致
  git add -A && git commit -m "v${next}: <这一版做了什么>"
  git tag v${next}
  git push origin main --tags

推送 tag 后会并排跑两个流水线，产物汇总到同一个 Release：
  Release  -> LuoguMarkdownEditor.html
  Desktop  -> Windows / macOS / Linux 安装包与便携版
`);
