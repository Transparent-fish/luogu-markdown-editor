/**
 * 拖进窗口的文件（桌面版原生拖放）。
 *
 * 起因是一个真实的抱怨：把文件拖进窗口，右边有预览，可是按 Ctrl+S 弹的是"另存为"。
 * 根因是 WebView 的 HTML5 drop 只给 File 对象、不给路径（`.path` 是 Electron 才有的），
 * 所以那份文档在面板里是"没有出处"的。这里守住的正是修好之后的行为：
 *
 *   - 拖进来的文件带绝对路径，Ctrl+S 直接写回原文件，绝不弹另存为；
 *   - 一次拖多个 = 开多个标签页；
 *   - 拖文件夹 = 问一句要不要当工作目录；
 *   - 不认识的文件（图片等）直接说清楚，不是默默塞进来一堆乱码；
 *   - 原生拖放接管之后，HTML5 那条老路必须让位，否则同一个文件会被打开两次。
 */
const path = require('path');
const { chromium } = require('playwright');

// 桌面版宿主：fs + dialog 让 detectHost() 认定"有原生文件系统"，
// webviewWindow.getCurrentWebviewWindow().onDragDropEvent 拿到拖放回调。
const HOST_WITH_WEBVIEW = `
(function () {
  const files = {
    '/proj/README.md': '# 项目说明\\n',
    '/outside/solution.md': '# 外面的题解\\n\\n这份文件不在当前工作目录里。\\n',
    '/outside/notes.md': '# 另一份\\n'
  };
  const dirs = {
    '/proj': [
      { name: 'README.md', isDirectory: false, path: '/proj/README.md' },
      { name: 'sub', isDirectory: true, path: '/proj/sub' }
    ],
    '/proj/sub': [],
    '/outside': [
      { name: 'solution.md', isDirectory: false, path: '/outside/solution.md' },
      { name: 'notes.md', isDirectory: false, path: '/outside/notes.md' }
    ]
  };
  const log = [];
  window.__FAKE = {
    files: files, dirs: dirs, log: log, dropCb: null,
    fire: function (type, paths) { if (this.dropCb) this.dropCb({ payload: { type: type, paths: paths } }); },
    seed: function (p, c) { files[p] = c; }
  };
  window.__TAURI__ = {
    fs: {
      readTextFile: async (p) => {
        log.push('read:' + p);
        if (!(p in files)) throw new Error('ENOENT ' + p);
        return files[p];
      },
      writeTextFile: async (p, c) => { log.push('write:' + p); files[p] = c; },
      readDir: async (p) => {
        log.push('readdir:' + p);
        // 真实宿主里对文件调 readDir 是报错的；把它写进假宿主，才能挡住"把文件当成
        // 文件夹"这类判定错误。
        if (!(p in dirs) || (p in files)) throw new Error('ENOTDIR ' + p);
        return dirs[p];
      },
      exists: async (p) => (p in files) || (p in dirs),
      mkdir: async (p) => { dirs[p] = []; },
      rename: async () => {},
      remove: async () => {}
    },
    dialog: {
      open: async (o) => (o && o.directory ? '/proj' : '/proj/README.md'),
      save: async () => { log.push('saveAs'); return '/proj/另存为.md'; },
      confirm: async (m) => { log.push('confirm:' + m); return true; }
    },
    opener: { revealItemInDir: async () => {} },
    webviewWindow: {
      getCurrentWebviewWindow: () => ({
        onDragDropEvent: async (cb) => { window.__FAKE.dropCb = cb; return () => {}; }
      })
    }
  };
})();
`;

// 只有老的 event 接口的宿主：走 tauri://drag-drop 这条备用路。
const HOST_WITH_EVENT_ONLY = `
(function () {
  const files = { '/proj/README.md': '# 项目说明\\n', '/other/a.md': '# A\\n' };
  const dirs = { '/proj': [{ name: 'README.md', isDirectory: false, path: '/proj/README.md' }], '/other': [] };
  const log = [];
  window.__FAKE = {
    files: files, dirs: dirs, log: log,
    fire: function (payload) { if (this.listenCb) this.listenCb({ payload: payload }); }
  };
  window.__TAURI__ = {
    fs: {
      readTextFile: async (p) => { if (!(p in files)) throw new Error('ENOENT ' + p); return files[p]; },
      writeTextFile: async (p, c) => { files[p] = c; },
      readDir: async (p) => { if (p in files) throw new Error('ENOTDIR'); return dirs[p] || []; },
      exists: async (p) => (p in files) || (p in dirs),
      mkdir: async () => {},
      rename: async () => {},
      remove: async () => {}
    },
    dialog: { open: async () => '/proj', save: async () => '/x', confirm: async () => true },
    event: {
      listen: async (name, cb) => { if (name === 'tauri://drag-drop') window.__FAKE.listenCb = cb; return () => {}; }
    }
  };
})();
`;

(async () => {
  const APP = process.argv[2]
    || 'file://' + path.resolve(__dirname, '..', 'LuoguMarkdownEditor.html');
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ck = (c, n, x) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, x || '')); };

  const openApp = async (initScript) => {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    p.on('pageerror', (e) => { p.__errs = (p.__errs || []).concat(e.message); });
    await p.addInitScript(initScript);
    await p.goto(APP, { waitUntil: 'networkidle' });
    await p.waitForTimeout(900);
    await p.evaluate(() => LuoguEditor.workspace.openFolderDialog());
    await p.waitForTimeout(400);
    return p;
  };

  // ==========================================================================
  // 1. 主路径：webviewWindow.onDragDropEvent
  // ==========================================================================
  const p = await openApp(HOST_WITH_WEBVIEW);
  const tabs = () => p.evaluate(() => document.querySelectorAll('.ws-tab').length);
  const toasts = () => p.evaluate(() => [...document.querySelectorAll('#toastContainer .toast')]
    .map((t) => t.textContent).join(' | '));

  ck(await p.evaluate(() => LuoguEditor.workspace.nativeDrop === true),
    '桌面版接上了原生拖放事件');
  ck(await p.evaluate(() => typeof window.__FAKE.dropCb === 'function'), '（准备）拿到了拖放回调');

  // 拖到窗口上时显示提示层
  await p.evaluate(() => window.__FAKE.fire('enter', []));
  await p.waitForTimeout(200);
  ck(await p.evaluate(() => document.getElementById('wsDropHint').hidden === false),
    '文件拖到窗口上时显示"松开即可打开"');
  await p.evaluate(() => window.__FAKE.fire('leave', []));
  await p.waitForTimeout(200);
  ck(await p.evaluate(() => document.getElementById('wsDropHint').hidden === true),
    '拖出去之后提示层收起');

  // 丢一个"当前工作目录之外"的文件：这正是用户报的那一幕
  const tabsBefore = await tabs();
  await p.evaluate(() => window.__FAKE.fire('drop', ['/outside/solution.md']));
  await p.waitForTimeout(700);
  ck(await tabs() === tabsBefore + 1, '拖进来的文件开成一个新标签页');
  ck(await p.evaluate(() => document.querySelector('.ws-tab.is-active .ws-tab-name').textContent === 'solution.md'),
    '标签页名字就是文件名');
  ck(await p.evaluate(() => LuoguEditor.workspace.docs[LuoguEditor.workspace.active].path === '/outside/solution.md'),
    '文档记住了绝对路径（不是"没有出处"的内容）');
  ck(await p.evaluate(() => document.getElementById('editorTextarea').value.includes('这份文件不在当前工作目录里')),
    '编辑区拿到的是磁盘上的内容');
  ck(await p.evaluate(() => document.getElementById('wsWatermark').hidden === true && !document.documentElement.classList.contains('ws-no-docs')),
    '空状态引导消失');
  ck(await p.evaluate(() => document.getElementById('wsDropHint').hidden === true),
    '放下之后提示层收起');

  // 关键那一条：Ctrl+S 写回原文件，而不是另存为
  await p.evaluate(() => {
    const ta = document.getElementById('editorTextarea');
    ta.value = '# 外面的题解\n\n改了一行。\n';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(200);
  await p.evaluate(() => { LuoguEditor.workspace.setAutosaveToFile(false); });   // 手动保存，看清是哪一步写盘
  await p.evaluate(() => document.getElementById('editorTextarea').focus());
  await p.keyboard.press('Control+s');
  await p.waitForTimeout(700);
  ck(await p.evaluate(() => window.__FAKE.files['/outside/solution.md'].includes('改了一行')),
    'Ctrl+S 把改动写回了原文件');
  ck(await p.evaluate(() => !window.__FAKE.log.includes('saveAs')),
    '全程没有弹过"另存为"');
  ck((await toasts()).includes('solution.md'), '提示里说明了保存到了哪个文件', await toasts());

  // 一次拖多个 = 多个标签页
  const beforeMulti = await tabs();
  await p.evaluate(() => window.__FAKE.fire('drop', ['/outside/notes.md', '/proj/README.md']));
  await p.waitForTimeout(900);
  ck(await tabs() === beforeMulti + 2, '一次拖两个文件就开两个标签页',
    `${beforeMulti} -> ${await tabs()}`);

  // 已经打开的再拖一次：不重复开，直接切过去
  const beforeAgain = await tabs();
  await p.evaluate(() => window.__FAKE.fire('drop', ['/proj/README.md']));
  await p.waitForTimeout(600);
  ck(await tabs() === beforeAgain, '重复拖入已打开的文件不会开出第二个标签页');

  // 不认识的文件：明说，不要静默塞进来
  const beforePng = await tabs();
  await p.evaluate(() => window.__FAKE.fire('drop', ['/outside/pic.png']));
  await p.waitForTimeout(500);
  ck(await tabs() === beforePng, '图片之类的文件不会被当成文档打开');
  ck((await toasts()).includes('不是文本文件'), '并且给出说明', await toasts());

  // 拖文件夹 = 问一句要不要换成工作目录
  await p.evaluate(() => window.__FAKE.fire('drop', ['/outside']));
  await p.waitForTimeout(800);
  ck(await p.evaluate(() => window.__FAKE.log.some((l) => l.startsWith('confirm:'))),
    '拖文件夹会先问一句');
  ck(await p.evaluate(() => LuoguEditor.workspace.rootPath === '/outside'),
    '确认后工作目录换成拖进来的文件夹');

  // 原生拖放接管之后，HTML5 的 drop 必须让位，否则同一个文件开两次
  const beforeHtml5 = await tabs();
  await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['# 重复打开\n'], 'duplicate.md', { type: 'text/markdown' }));
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await p.waitForTimeout(600);
  ck(await tabs() === beforeHtml5, '原生拖放在用时，HTML5 的 drop 被忽略（不会开两遍）');

  ck((p.__errs || []).length === 0, '全程无 JS 报错', (p.__errs || []).slice(0, 2).join(' | '));
  await p.close();

  // ==========================================================================
  // 2. 备用路径：只有 __TAURI__.event 的宿主
  // ==========================================================================
  const q = await openApp(HOST_WITH_EVENT_ONLY);
  ck(await q.evaluate(() => LuoguEditor.workspace.nativeDrop === true),
    '没有 webviewWindow 时，退到 tauri://drag-drop 事件上（同样算接上了）');
  const q0 = await q.evaluate(() => document.querySelectorAll('.ws-tab').length);
  await q.evaluate(() => window.__FAKE.fire({ paths: ['/other/a.md'] }));
  await q.waitForTimeout(700);
  ck(await q.evaluate(() => document.querySelectorAll('.ws-tab').length) === q0 + 1,
    '备用路径同样能把拖进来的文件开成标签页');
  ck(await q.evaluate(() => LuoguEditor.workspace.docs[LuoguEditor.workspace.active].path === '/other/a.md'),
    '备用路径也带上了绝对路径');
  ck((q.__errs || []).length === 0, '备用路径无 JS 报错', (q.__errs || []).slice(0, 2).join(' | '));
  await q.close();

  console.log(`\n拖入文件  ${pass + fail} 项，失败 ${fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
