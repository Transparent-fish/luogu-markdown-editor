/**
 * Workspace panel: document tabs + folder tree.
 *
 * The panel is desktop-only, but it ships inside the same HTML the browser build
 * uses, so two things have to hold: it must stay completely invisible in a plain
 * browser, and it must work when a native filesystem is present.
 *
 * The native side is stubbed here rather than driven through a real Tauri build —
 * that keeps the DOM and document-model logic under test without a Rust toolchain,
 * and it is exactly why LuoguWorkspace takes its filesystem as a parameter.
 */
const path = require('path');
const { chromium } = require('playwright');

// A fake disk: a flat map of path -> contents, plus a directory listing.
const FAKE_FS = `{
  files: {
    '/proj/a.md': '# 文件 A\\n\\n内容 A。',
    '/proj/b.md': '# 文件 B\\n\\n内容 B。',
    '/proj/sub/c.md': '# 文件 C\\n\\n内容 C。'
  },
  dirs: {
    '/proj': [
      { name: 'sub', isDirectory: true, path: '/proj/sub' },
      { name: 'a.md', isDirectory: false, path: '/proj/a.md' },
      { name: 'b.md', isDirectory: false, path: '/proj/b.md' },
      { name: '.hidden', isDirectory: false, path: '/proj/.hidden' }
    ],
    '/proj/sub': [
      { name: 'c.md', isDirectory: false, path: '/proj/sub/c.md' }
    ]
  },
  log: []
}`;

(async () => {
  const APP = process.argv[2]
    || 'file://' + path.resolve(__dirname, '..', 'LuoguMarkdownEditor.html');
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ck = (c, n, x) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, x || '')); };

  // ---- 1. plain browser: the panel must not exist at all ---------------------
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP, { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    ck(await p.evaluate(() => !document.getElementById('workspacePanel')),
      '普通浏览器下不创建工作区面板');
    ck(await p.evaluate(() => !document.documentElement.classList.contains('has-workspace')),
      '未加 has-workspace 类');
    ck(await p.evaluate(() => typeof LuoguEditor.workspace === 'undefined'),
      '未挂载 workspace 实例');
    ck(await p.evaluate(() => typeof LuoguWorkspace === 'function'),
      '但代码本身已随包发出（供桌面版使用）');
    ck(errs.length === 0, '网页版无报错', errs.slice(0, 2).join(' | '));
    await p.close();
  }

  // ---- 2. with a native filesystem: the panel works --------------------------
  const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // Install the stub before any script runs, so detectHost() sees it at startup.
  await p.addInitScript(`
    window.__FAKE = ${FAKE_FS};
    const F = window.__FAKE;
    window.__TAURI__ = {
      fs: {
        readTextFile: async (p) => {
          F.log.push('read:' + p);
          if (!(p in F.files)) throw new Error('ENOENT ' + p);
          return F.files[p];
        },
        writeTextFile: async (p, c) => { F.log.push('write:' + p); F.files[p] = c; },
        readDir: async (p) => { F.log.push('readdir:' + p); return F.dirs[p] || []; }
      },
      dialog: {
        open: async (o) => (o && o.directory ? window.__PICK_DIR : window.__PICK_FILE),
        save: async () => window.__PICK_SAVE,
        confirm: async () => window.__CONFIRM !== false
      }
    };
  `);
  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  ck(await p.evaluate(() => !!document.getElementById('workspacePanel')),
    '检测到原生文件系统后出现面板');
  ck(await p.evaluate(() => document.documentElement.classList.contains('has-workspace')),
    '加上 has-workspace 类');
  ck(await p.evaluate(() => document.querySelectorAll('.ws-tab').length === 1),
    '初始有一个标签页（承接当前草稿）');

  // Open a folder.
  await p.evaluate(() => { window.__PICK_DIR = '/proj'; });
  await p.evaluate(() => LuoguEditor.workspace.openFolderDialog());
  await p.waitForTimeout(500);
  const tree = await p.evaluate(() =>
    [...document.querySelectorAll('#wsTree .ws-node')].map((n) => n.textContent.replace(/^[▾▸·]/, '')));
  ck(tree.length === 4 && tree.includes('sub') && tree.includes('a.md'),
    '展开文件夹列出内容', JSON.stringify(tree));
  ck(!tree.some((t) => t.includes('.hidden')), '隐藏以点开头的文件', JSON.stringify(tree));
  ck(tree[1] === 'sub', '目录排在文件之前', JSON.stringify(tree));

  // Open a file by clicking it.
  await p.evaluate(() => {
    [...document.querySelectorAll('#wsTree .ws-node')]
      .find((n) => n.getAttribute('data-path') === '/proj/a.md').click();
  });
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => document.querySelectorAll('.ws-tab').length === 2),
    '点击文件新开一个标签页');
  ck(await p.evaluate(() => document.getElementById('editorTextarea').value.includes('内容 A')),
    '文件内容载入编辑区');

  // Opening the same path again must focus the existing tab, not duplicate it.
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/a.md'));
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => document.querySelectorAll('.ws-tab').length === 2),
    '重复打开同一文件不新建标签页');

  // Expand a subfolder.
  await p.evaluate(() => {
    [...document.querySelectorAll('#wsTree .ws-node')]
      .find((n) => n.getAttribute('data-path') === '/proj/sub').click();
  });
  await p.waitForTimeout(400);
  ck(await p.evaluate(() =>
    [...document.querySelectorAll('#wsTree .ws-node')].some((n) => n.getAttribute('data-path') === '/proj/sub/c.md')),
    '展开子目录');

  // Switching tabs must preserve each document's own text.
  await p.evaluate(() => {
    const ta = document.getElementById('editorTextarea');
    ta.value = '# 文件 A\n\n被我改过了。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => !!document.querySelector('.ws-tab.is-dirty')),
    '修改后标签页标记为未保存');
  await p.evaluate(() => LuoguEditor.workspace.activate(0));
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => !document.getElementById('editorTextarea').value.includes('被我改过了')),
    '切到别的标签页显示各自内容');
  await p.evaluate(() => LuoguEditor.workspace.activate(1));
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => document.getElementById('editorTextarea').value.includes('被我改过了')),
    '切回来仍保留未保存的修改');

  // Save writes through to the fake disk and clears the dirty flag.
  await p.evaluate(() => LuoguEditor.workspace.saveActive());
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => window.__FAKE.files['/proj/a.md'].includes('被我改过了')),
    '保存写回原文件');
  ck(await p.evaluate(() => !document.querySelector('.ws-tab.is-dirty')),
    '保存后清除未保存标记');

  // Ctrl+S must route through the workspace, not the single-document path.
  await p.evaluate(() => {
    const ta = document.getElementById('editorTextarea');
    ta.value = '# 文件 A\n\n第二次修改。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  });
  await p.waitForTimeout(400);
  await p.keyboard.press('Control+s');
  await p.waitForTimeout(600);
  ck(await p.evaluate(() => window.__FAKE.files['/proj/a.md'].includes('第二次修改')),
    'Ctrl+S 保存到当前标签页对应的文件');

  // A new tab has no path, so saving it asks where to put it.
  await p.evaluate(() => { window.__PICK_SAVE = '/proj/new.md'; LuoguEditor.workspace.newTab(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const ta = document.getElementById('editorTextarea');
    ta.value = '新建的内容。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => LuoguEditor.workspace.saveActive());
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => window.__FAKE.files['/proj/new.md'] === '新建的内容。'),
    '新标签页保存时走另存为');
  ck(await p.evaluate(() =>
    [...document.querySelectorAll('.ws-tab')].some((t) => t.textContent.includes('new.md'))),
    '另存后标签页改用新文件名');

  // Recent list.
  ck(await p.evaluate(() => document.querySelectorAll('#wsRecent .ws-node').length >= 2),
    '最近打开列表有记录');
  ck(await p.evaluate(() => {
    const v = JSON.parse(localStorage.getItem('luogu_editor_recent_files') || '[]');
    return v.includes('/proj/a.md');
  }), '最近列表持久化到 localStorage');

  // Closing a dirty tab asks first.
  await p.evaluate(() => {
    const ta = document.getElementById('editorTextarea');
    ta.value = '又改了。'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    window.__CONFIRM = false;
  });
  await p.waitForTimeout(300);
  const before = await p.evaluate(() => document.querySelectorAll('.ws-tab').length);
  await p.evaluate(() => LuoguEditor.workspace.closeTab(LuoguEditor.workspace.active));
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => document.querySelectorAll('.ws-tab').length) === before,
    '未保存时取消关闭则保留标签页');
  await p.evaluate(() => { window.__CONFIRM = true; });
  await p.evaluate(() => LuoguEditor.workspace.closeTab(LuoguEditor.workspace.active));
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => document.querySelectorAll('.ws-tab').length) === before - 1,
    '确认后关闭标签页');

  // Never end up with zero tabs.
  await p.evaluate(async () => {
    window.__CONFIRM = true;
    const ws = LuoguEditor.workspace;
    while (ws.docs.length > 1) await ws.closeTab(0);
    await ws.closeTab(0);
  });
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => document.querySelectorAll('.ws-tab').length === 1),
    '关掉最后一个标签页会自动新建空白页');

  // Concurrent renders must not duplicate the tree. renderTree() awaits a readDir
  // per level; two overlapping calls each cleared the host and then both appended,
  // so the whole tree appeared several times over.
  await p.evaluate(async () => {
    const ws = LuoguEditor.workspace;
    await ws.setRoot('/proj');
    ws.treeState['/proj/sub'] = true;
    // Fire several without awaiting in between — the interleaving is the point.
    ws.renderTree(); ws.renderTree(); ws.renderTree();
    await ws.renderTree();
  });
  await p.waitForTimeout(600);
  const paths = await p.evaluate(() =>
    [...document.querySelectorAll('#wsTree .ws-node')].map((n) => n.getAttribute('data-path')));
  ck(paths.length === new Set(paths).size, '并发渲染不会让文件树重复',
    JSON.stringify(paths));
  ck(paths.length === 5, '树结构正确（根 + sub + c.md + a.md + b.md）', JSON.stringify(paths));

  ck(errs.length === 0, '桌面模式无 JS 报错', errs.slice(0, 3).join(' | '));
  console.log(`\n工作区面板 ${pass + fail} 项，失败 ${fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
