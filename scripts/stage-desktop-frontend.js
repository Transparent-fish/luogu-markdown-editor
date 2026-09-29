/**
 * Stage the built single-file editor as the desktop app's frontend.
 *
 * The desktop build deliberately has no frontend of its own: it ships exactly the
 * artifact users already download, so the two can never drift apart. This copies
 * LuoguMarkdownEditor.html to desktop/dist/index.html, building it first if needed.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const artifact = path.join(root, 'LuoguMarkdownEditor.html');
const outDir = path.join(root, 'desktop', 'dist');

if (!fs.existsSync(artifact)) {
  console.log('[desktop] LuoguMarkdownEditor.html not found — building it first.');
  execFileSync(process.execPath, [path.join(root, 'build-standalone.js')], { stdio: 'inherit' });
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(artifact, path.join(outDir, 'index.html'));
const kb = Math.round(fs.statSync(artifact).size / 1024);
console.log(`[desktop] staged frontend: desktop/dist/index.html (${kb} KB)`);
