/**
 * One version, written down in three places — check they still agree.
 *
 * The version is not cosmetic here: the tag names every release asset, CI derives
 * the installer file names from it, and Tauri bakes its own copy into the bundles
 * and into the "关于"信息 users see. If they drift, a release ships installers
 * labelled with a version that never existed, and nothing else would notice.
 *
 *   node scripts/check-versions.js        # 不一致时以退出码 1 失败
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/** The three files that each carry the version, and how to read it out of each. */
const sources = [
  {
    file: 'package.json',
    read: (text) => JSON.parse(text).version,
  },
  {
    file: 'desktop/src-tauri/tauri.conf.json',
    read: (text) => JSON.parse(text).version,
  },
  {
    file: 'desktop/src-tauri/Cargo.toml',
    read: (text) => {
      // Only the [package] section — [dependencies] has versions of its own.
      const pkg = text.split(/^\[/m).find((s) => s.startsWith('package]'));
      const m = pkg && pkg.match(/^\s*version\s*=\s*"([^"]+)"/m);
      return m ? m[1] : null;
    },
  },
];

const found = sources.map(({ file, read }) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return { file, version: read(text) };
});

const missing = found.filter((f) => !f.version);
if (missing.length) {
  console.error('找不到版本号：', missing.map((m) => m.file).join(', '));
  process.exit(1);
}

for (const { file, version } of found) {
  console.log(`${version}  ${file}`);
}

const versions = new Set(found.map((f) => f.version));
if (versions.size > 1) {
  console.error(
    `\n版本号不一致：${[...versions].join(' vs ')}。\n` +
      '请用 `node scripts/bump-version.js <版本号>` 一次性改齐。'
  );
  process.exit(1);
}
console.log(`版本一致：${found[0].version}`);
