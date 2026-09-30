/**
 * Workspace explorer: the VS Code-style file tree.
 *
 * The panel is desktop-only and ships inside the same HTML the browser build uses,
 * so the native side is stubbed here rather than driven through a real Tauri build.
 * The stub is a mutable fake disk — create, rename, delete and move all land in it,
 * which is what makes it possible to assert that a right-click menu item actually
 * touched the filesystem instead of only repainting the tree.
 *
 * Drag and drop is driven with synthetic DragEvents instead of real mouse input:
 * Playwright's mouse cannot synthesise an HTML5 drag session, and the handlers are
 * written so a null dataTransfer is fine (the payload rides in `_dragPaths`).
 */
const path = require('path');
const { chromium } = require('playwright');

const FAKE_FS = `
(function () {
  const files = {
    '/proj/README.md': '# 项目说明\\n',
    '/proj/.gitignore': 'node_modules\\n',
    '/proj/src/main.cpp': 'int main() { return 0; }\\n',
    '/proj/src/util.cpp': '// util\\n',
    '/proj/src/notes.txt': '随手记\\n',
    '/proj/assets/logo.png': 'PNG'
  };
  const dirs = {
    '/proj': [
      { name: 'assets', isDirectory: true, path: '/proj/assets' },
      { name: 'src', isDirectory: true, path: '/proj/src' },
      { name: '.gitignore', isDirectory: false, path: '/proj/.gitignore' },
      { name: 'README.md', isDirectory: false, path: '/proj/README.md' }
    ],
    '/proj/src': [
      { name: 'main.cpp', isDirectory: false, path: '/proj/src/main.cpp' },
      { name: 'notes.txt', isDirectory: false, path: '/proj/src/notes.txt' },
      { name: 'util.cpp', isDirectory: false, path: '/proj/src/util.cpp' }
    ],
    '/proj/assets': [
      { name: 'logo.png', isDirectory: false, path: '/proj/assets/logo.png' }
    ]
  };
  const log = [];

  const parentOf = (p) => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
  const base = (p) => p.split('/').pop();
  function addEntry(dir, name, isDir, full) {
    if (!dirs[dir]) dirs[dir] = [];
    if (!dirs[dir].some((e) => e.path === full)) {
      dirs[dir].push({ name: name, isDirectory: isDir, path: full });
    }
  }
  function dropEntry(dir, full) {
    if (dirs[dir]) dirs[dir] = dirs[dir].filter((e) => e.path !== full);
  }
  function removeTree(p) {
    Object.keys(files).forEach((k) => { if (k === p || k.indexOf(p + '/') === 0) delete files[k]; });
    Object.keys(dirs).forEach((k) => { if (k === p || k.indexOf(p + '/') === 0) delete dirs[k]; });
    dropEntry(parentOf(p), p);
  }

  window.__FAKE = {
    files: files, dirs: dirs, log: log,
    // 测试用：直接在假磁盘上放一个文件（含父目录登记）
    seed: function (p, content) { files[p] = content; addEntry(parentOf(p), base(p), false, p); },
    // 测试用：把某个路径的所有记录搬走
    move: function (oldP, newP) {
      Object.keys(files).forEach((k) => {
        if (k === oldP || k.indexOf(oldP + '/') === 0) {
          files[newP + k.slice(oldP.length)] = files[k];
          delete files[k];
        }
      });
      const movedDirs = {};
      Object.keys(dirs).forEach((k) => {
        if (k === oldP || k.indexOf(oldP + '/') === 0) {
          movedDirs[newP + k.slice(oldP.length)] =
            dirs[k].map((e) => ({ name: e.name, isDirectory: e.isDirectory, path: newP + e.path.slice(oldP.length) }));
          delete dirs[k];
        }
      });
      Object.assign(dirs, movedDirs);
      dropEntry(parentOf(oldP), oldP);
      addEntry(parentOf(newP), base(newP), !!dirs[newP], newP);
    }
  };

  window.__TAURI__ = {
    fs: {
      readTextFile: async (p) => {
        log.push('read:' + p);
        if (!(p in files)) throw new Error('ENOENT ' + p);
        return files[p];
      },
      writeTextFile: async (p, c) => {
        log.push('write:' + p);
        if (p in dirs) throw new Error('EISDIR ' + p);
        files[p] = c;
        addEntry(parentOf(p), base(p), false, p);
      },
      readDir: async (p) => { log.push('readdir:' + p); return dirs[p] || []; },
      mkdir: async (p) => {
        log.push('mkdir:' + p);
        if (p in dirs || p in files) throw new Error('EEXIST ' + p);
        dirs[p] = [];
        addEntry(parentOf(p), base(p), true, p);
      },
      rename: async (a, b) => {
        log.push('rename:' + a + '->' + b);
        if (!(a in files) && !(a in dirs)) throw new Error('ENOENT ' + a);
        if (b in files || b in dirs) throw new Error('EEXIST ' + b);
        window.__FAKE.move(a, b);
      },
      remove: async (p, o) => {
        log.push('remove:' + p + (o && o.recursive ? ':recursive' : ''));
        if (!(p in files) && !(p in dirs)) throw new Error('ENOENT ' + p);
        removeTree(p);
      },
      exists: async (p) => (p in files) || (p in dirs)
    },
    dialog: {
      open: async (o) => (o && o.directory ? window.__PICK_DIR : window.__PICK_FILE),
      save: async () => window.__PICK_SAVE,
      confirm: async (m, o) => {
        log.push('confirm:' + m + (o ? '|opts:' + JSON.stringify(o) : ''));
        return window.__CONFIRM !== false;
      }
    },
    opener: {
      revealItemInDir: async (p) => { log.push('reveal:' + p); }
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

  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(FAKE_FS);
  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  // ---- 打开工作区 -----------------------------------------------------------
  await p.evaluate(() => { window.__PICK_DIR = '/proj'; });
  await p.evaluate(() => LuoguEditor.workspace.openFolderDialog());
  await p.waitForTimeout(500);

  const rows = () => p.evaluate(() =>
    [...document.querySelectorAll('#wsTree .ws-node')].map((n) => n.getAttribute('data-path')));
  const rowSel = (path) => `#wsTree .ws-node[data-path="${path}"]`;
  const tabCount = () => p.evaluate(() => document.querySelectorAll('.ws-tab').length);
  const toasts = () => p.evaluate(() => [...document.querySelectorAll('#toastContainer .toast')]
    .map((t) => t.textContent).join(' | '));

  // ---- 1. 视觉结构：内联 SVG 图标、缩进线、树语义 ----------------------------
  ck(await p.evaluate(() => {
    const svg = document.querySelector('#wsTree .ws-node[data-path="/proj/README.md"] svg');
    return !!svg && svg.tagName.toLowerCase() === 'svg' && svg.querySelectorAll('path').length > 0;
  }), '文件图标是内联 SVG（不是 emoji 或字体）');

  ck(await p.evaluate(() => {
    const slot = (p) => {
      const svg = document.querySelector(`#wsTree .ws-node[data-path="${p}"] svg`);
      return svg && svg.getAttribute('data-slot');
    };
    return slot('/proj/README.md') === 'md';
  }), '.md 用 markdown 图标槽位');

  // 行内的第一个 svg 是折叠箭头，图标要看 .ws-icon 里的那个。
  ck(await p.evaluate(() => {
    const svg = document.querySelector('#wsTree .ws-node[data-path="/proj/src"] .ws-icon svg');
    return !!svg && svg.classList.contains('ws-svg-folder');
  }), '文件夹用文件夹图标');

  // 展开两级，才能看到里层的文件（图标槽位按扩展名分派）
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    ws.treeState['/proj/src'] = true;
    ws.treeState['/proj/assets'] = true;
    return ws.renderTree();
  });
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => {
    const svg = document.querySelector('#wsTree .ws-node[data-path="/proj/src/main.cpp"] .ws-icon svg');
    return !!svg && svg.getAttribute('data-slot') === 'cpp';
  }), '.cpp 用 C++ 图标槽位');

  ck(await p.evaluate(() => {
    const svg = document.querySelector('#wsTree .ws-node[data-path="/proj/assets/logo.png"] .ws-icon svg');
    return !!svg && svg.getAttribute('data-slot') === 'img';
  }), '.png 用图片图标槽位');

  ck(await p.evaluate(() => {
    const el = document.getElementById('wsTree');
    const row = document.querySelector('#wsTree .ws-node[data-path="/proj/README.md"]');
    return el.getAttribute('role') === 'tree' && el.tabIndex === 0
      && row.getAttribute('role') === 'treeitem' && row.getAttribute('aria-level') === '2';
  }), '树容器与行带正确的 ARIA 角色');

  // 检查缩进引导线与展开态（写成幂等的展开，不靠点击切换——上面已经展开过一次）
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    if (!ws.treeState['/proj/src']) ws.treeState['/proj/src'] = true;
    return ws.renderTree();
  });
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => {
    const row = document.querySelector('#wsTree .ws-node[data-path="/proj/src/main.cpp"]');
    if (!row) return false;
    const depth = row.style.getPropertyValue('--ws-depth');
    return row.classList.contains('has-guides') && depth === '2';
  }), '嵌套行带缩进引导线与深度变量');

  ck(await p.evaluate(() => {
    const row = document.querySelector('#wsTree .ws-node[data-path="/proj/src"]');
    return row.classList.contains('is-expanded');
  }), '展开的目录带 is-expanded（箭头靠它旋转）');

  ck(await p.evaluate(() => {
    const row = document.querySelector('#wsTree .ws-node[data-path="/proj/src/main.cpp"]');
    return row.draggable === true;
  }), '行可拖拽（原生 HTML5 拖拽已接上）');

  // ---- 2. 过滤 --------------------------------------------------------------
  await p.fill('#wsFilter', 'util');
  await p.waitForTimeout(400);
  const filtered = await rows();
  ck(filtered.includes('/proj/src/util.cpp') && filtered.includes('/proj/src')
     && filtered.includes('/proj') && !filtered.includes('/proj/README.md'),
    '按文件名过滤：只留命中项与它的祖先目录', JSON.stringify(filtered));

  await p.fill('#wsFilter', '');
  await p.waitForTimeout(400);
  ck((await rows()).includes('/proj/README.md'), '清空过滤后恢复完整树');

  // ---- 3. 键盘导航 ----------------------------------------------------------
  await p.evaluate(() => {
    // 折叠所有子目录、清掉焦点，从"根 + 一级子项"这个确定状态开始数着走
    const ws = LuoguEditor.workspace;
    ws.collapseAll();
    ws.focusPath = null;
    ws.selection = new Set();
    ws._paintSelection();
    document.getElementById('wsTree').focus();
  });
  await p.waitForTimeout(300);
  await p.keyboard.press('ArrowDown');
  const firstSel = await p.evaluate(() => [...document.querySelectorAll('#wsTree .ws-node.is-selected')]
    .map((n) => n.getAttribute('data-path')));
  ck(firstSel.length === 1 && firstSel[0] === '/proj', '↓ 从无焦点开始，选中第一行（工作区根）', JSON.stringify(firstSel));

  await p.keyboard.press('ArrowDown');
  const second = await p.evaluate(() => document.querySelector('#wsTree .ws-node.is-focused').getAttribute('data-path'));
  ck(second === '/proj/assets', '↓ 继续移动到下一行', second);

  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  const fourth = await p.evaluate(() => document.querySelector('#wsTree .ws-node.is-focused').getAttribute('data-path'));
  ck(fourth === '/proj/README.md', '↓ 跳过已折叠目录的子项', fourth);

  await p.keyboard.press('ArrowUp');
  const back = await p.evaluate(() => document.querySelector('#wsTree .ws-node.is-focused').getAttribute('data-path'));
  ck(back === '/proj/src', '↑ 回到上一行', back);

  await p.keyboard.press('ArrowRight');   // 展开 src
  await p.waitForTimeout(300);
  ck(await p.evaluate(() => LuoguEditor.workspace.treeState['/proj/src'] === true), '→ 展开目录');
  await p.keyboard.press('ArrowRight');   // 进入第一个子项
  const intoChild = await p.evaluate(() => document.querySelector('#wsTree .ws-node.is-focused').getAttribute('data-path'));
  ck(intoChild === '/proj/src/main.cpp', '→ 再按一次进入第一个子项', intoChild);

  await p.keyboard.press('ArrowLeft');    // 回到父目录
  const toParent = await p.evaluate(() => document.querySelector('#wsTree .ws-node.is-focused').getAttribute('data-path'));
  ck(toParent === '/proj/src', '← 回到父目录', toParent);

  await p.evaluate(() => { LuoguEditor.workspace.focusPath = '/proj/README.md'; });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  ck(await tabCount() === 2, 'Enter 打开文件（新标签页）');

  await p.evaluate(() => document.getElementById('wsTree').focus());
  await p.keyboard.press('Control+a');
  const selAll = await p.evaluate(() => document.querySelectorAll('#wsTree .ws-node.is-selected').length);
  const total = await p.evaluate(() => document.querySelectorAll('#wsTree .ws-node').length);
  ck(selAll === total - 1, 'Ctrl+A 全选（不含工作区根）', `${selAll}/${total - 1}`);

  await p.keyboard.press('Escape');
  ck(await p.evaluate(() => document.querySelectorAll('#wsTree .ws-node.is-selected').length) === 0,
    'Esc 清除选择');

  // ---- 4. 右键菜单 + 新建 ---------------------------------------------------
  await p.click(rowSel('/proj/src'), { button: 'right' });
  await p.waitForTimeout(300);
  ck(await p.evaluate(() => !!document.querySelector('.ws-menu')), '右键弹出菜单');
  ck(await p.evaluate(() => {
    const t = [...document.querySelectorAll('.ws-menu-item')].map((e) => e.textContent);
    return t.some((x) => x.includes('新建文件')) && t.some((x) => x.includes('新建文件夹'));
  }), '菜单里有新建文件 / 新建文件夹');

  await p.click('.ws-menu-item:has-text("新建文件")');
  await p.waitForTimeout(300);
  ck(await p.evaluate(() => !!document.querySelector('.ws-inline-input')), '新建时在树内出现输入框');

  await p.fill('.ws-inline-input', 'graph.cpp');
  await p.press('.ws-inline-input', 'Enter');
  await p.waitForTimeout(600);
  ck(await p.evaluate(() => '/proj/src/graph.cpp' in window.__FAKE.files), '新建的文件真的落盘');
  ck(await p.evaluate(() => !!document.querySelector('#wsTree .ws-node[data-path="/proj/src/graph.cpp"]')),
    '新文件出现在树里');
  ck(await tabCount() === 3, '新建后自动打开成标签页');

  // 重名要被挡住，且不能覆盖已有文件
  await p.evaluate(() => {
    window.__FAKE.seed('/proj/src/dup.cpp', '原来的内容');
    LuoguEditor.workspace._beginCreate('/proj/src', false);
  });
  await p.waitForTimeout(300);
  await p.fill('.ws-inline-input', 'dup.cpp');
  await p.press('.ws-inline-input', 'Enter');
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => window.__FAKE.files['/proj/src/dup.cpp'] === '原来的内容'),
    '重名时不覆盖已有文件');
  ck((await toasts()).includes('已存在'), '重名给出提示');

  // 非法名字
  await p.evaluate(() => LuoguEditor.workspace._beginCreate('/proj/src', false));
  await p.waitForTimeout(250);
  await p.fill('.ws-inline-input', 'a/b.cpp');
  await p.press('.ws-inline-input', 'Enter');
  await p.waitForTimeout(400);
  ck((await toasts()).includes('不能包含'), '非法字符被拒绝并说明原因');
  ck(!(await p.evaluate(() => '/proj/src/a/b.cpp' in window.__FAKE.files)), '非法名字没有创建任何东西');

  // 新建文件夹
  await p.evaluate(() => LuoguEditor.workspace._beginCreate('/proj/src', true));
  await p.waitForTimeout(250);
  await p.fill('.ws-inline-input', 'tests');
  await p.press('.ws-inline-input', 'Enter');
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => Array.isArray(window.__FAKE.dirs['/proj/src/tests'])), '新建文件夹落盘');

  // ---- 5. 重命名 ------------------------------------------------------------
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    ws.selection = new Set(['/proj/src/util.cpp']);
    ws.focusPath = '/proj/src/util.cpp';
    ws._paintSelection();
    document.getElementById('wsTree').focus();
  });
  await p.keyboard.press('F2');
  await p.waitForTimeout(300);
  ck(await p.evaluate(() => {
    const i = document.querySelector('.ws-inline-input');
    return !!i && i.value === 'util.cpp' && i.selectionStart === 0 && i.selectionEnd === 4;
  }), 'F2 重命名，且只预选主干名（不含扩展名）');

  await p.keyboard.type('helper');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  ck(await p.evaluate(() => ('/proj/src/helper.cpp' in window.__FAKE.files)
     && !('/proj/src/util.cpp' in window.__FAKE.files)), '重命名写回磁盘');
  ck(await p.evaluate(() => !!document.querySelector('#wsTree .ws-node[data-path="/proj/src/helper.cpp"]')),
    '树里换成新名字');

  // 重命名一个已打开的文件，标签页与编辑器标题都要跟着走
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/src/main.cpp'));
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => document.getElementById('docNameInput').value === 'main.cpp'),
    '打开文件后标题栏显示文件名');
  await p.evaluate(async () => {
    const ws = LuoguEditor.workspace;
    ws.selection = new Set(['/proj/src/main.cpp']);
    ws.focusPath = '/proj/src/main.cpp';
    ws._openInlineInput('/proj/src/main.cpp', {
      depth: 2, value: 'main.cpp', selectStem: true,
      onCommit: async (name) => {
        await ws.fs.rename('/proj/src/main.cpp', '/proj/src/' + name);
        ws._afterMove('/proj/src/main.cpp', '/proj/src/' + name);
        ws._invalidate('/proj/src');
        await ws.render();
      }
    });
  });
  await p.waitForTimeout(300);
  await p.fill('.ws-inline-input', 'entry.cpp');
  await p.press('.ws-inline-input', 'Enter');
  await p.waitForTimeout(600);
  ck(await p.evaluate(() => document.getElementById('docNameInput').value === 'entry.cpp'),
    '重命名后编辑器标题同步');
  ck(await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    const d = ws.docs[ws.active];
    return d.path === '/proj/src/entry.cpp' && d.name === 'entry.cpp';
  }), '重命名后标签页指向新路径');

  // ---- 6. 多选与拖拽 --------------------------------------------------------
  await p.click(rowSel('/proj/src/helper.cpp'));           // 单击打开（本来就是这么设计的）
  await p.waitForTimeout(350);
  const tabsAfterOpen = await tabCount();
  await p.click(rowSel('/proj/src/notes.txt'), { modifiers: ['Control'] });  // Ctrl+点击只加选
  await p.waitForTimeout(350);
  ck(await p.evaluate(() => document.querySelectorAll('#wsTree .ws-node.is-selected').length) === 2,
    'Ctrl+点击多选两个文件');
  ck(await tabCount() === tabsAfterOpen, 'Ctrl+点击只加选，不会顺带打开文件');
  ck(await p.evaluate(() => LuoguEditor.workspace.selection.size === 2), '选择集里是两个路径');

  const dragTo = async (from, to) => p.evaluate(([f, t]) => {
    const q = (x) => document.querySelector(`#wsTree .ws-node[data-path="${x}"]`);
    const src = q(f), dst = q(t);
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, [from, to]);

  await dragTo('/proj/src/helper.cpp', '/proj/assets');
  await p.waitForTimeout(700);
  ck(await p.evaluate(() => ('/proj/assets/helper.cpp' in window.__FAKE.files)
     && ('/proj/assets/notes.txt' in window.__FAKE.files)
     && !('/proj/src/notes.txt' in window.__FAKE.files)),
    '拖拽移动整个多选集合（两个文件都搬走）');
  ck(await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    return ws.docs.some((d) => d.path === '/proj/assets/helper.cpp');
  }), '被移动文件的标签页路径跟着更新');
  ck(await p.evaluate(() => {
    const F = window.__FAKE;
    // 不变量：选择集里不能留下已经不在磁盘上的路径（移动/删除后最容易出错的地方）
    return [...LuoguEditor.workspace.selection]
      .every((x) => (x in F.files) || (x in F.dirs));
  }), '移动后选择集不残留失效路径');

  // 拖到自己内部应当被拒绝
  await p.evaluate(() => {
    const before = Object.keys(window.__FAKE.dirs).length;
    window.__DIRS_BEFORE = before;
  });
  await dragTo('/proj/src', '/proj/src');
  await p.waitForTimeout(600);
  ck((await toasts()).includes('跳过'), '拖进自身内部被拒绝并提示', await toasts());
  ck(await p.evaluate(() => Array.isArray(window.__FAKE.dirs['/proj/src'])), '被拒绝后原目录完好');

  // 同名冲突
  await p.evaluate(() => window.__FAKE.seed('/proj/assets/entry.cpp', '占位'));
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    ws.selection = new Set(['/proj/src/entry.cpp']);
    ws.focusPath = '/proj/src/entry.cpp';
  });
  await p.evaluate(() => {
    document.getElementById('wsTree').focus();
  });
  // 直接走内部移动逻辑，等价于把 entry.cpp 拖到 assets
  await p.evaluate(async () => {
    const ws = LuoguEditor.workspace;
    ws._dragPaths = ['/proj/src/entry.cpp'];
    await ws._moveInto('/proj/assets');
  });
  await p.waitForTimeout(600);
  ck(await p.evaluate(() => window.__FAKE.files['/proj/assets/entry.cpp'] === '占位'),
    '同名冲突时不覆盖目标文件');

  // ---- 7. 删除 --------------------------------------------------------------
  await p.evaluate(() => { window.__CONFIRM = true; });
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    ws.selection = new Set(['/proj/src/tests']);
    ws.focusPath = '/proj/src/tests';
    ws._deleteSelection();
  });
  await p.waitForTimeout(600);
  ck(await p.evaluate(() => !('/proj/src/tests' in window.__FAKE.dirs)), '删除文件夹');
  ck(await p.evaluate(() => window.__FAKE.log.some((l) => l.indexOf('remove:/proj/src/tests:recursive') === 0)),
    '删除目录时声明递归');

  // 取消确认：什么都不做
  await p.evaluate(() => { window.__CONFIRM = false; });
  const beforeCancel = await p.evaluate(() => Object.keys(window.__FAKE.files).length);
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    ws.selection = new Set(['/proj/assets/logo.png']);
    ws.focusPath = '/proj/assets/logo.png';
    ws._deleteSelection();
  });
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => Object.keys(window.__FAKE.files).length) === beforeCancel,
    '确认框里点"取消"则不动任何文件');

  // 删除已打开且有未保存修改的文件：应当警告，并关掉它的标签页
  await p.evaluate(() => { window.__CONFIRM = true; });
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/README.md'));
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const ta = document.getElementById('editorTextarea');
    ta.value = '# 改过的内容';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  const tabsBeforeDelete = await tabCount();
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    ws.selection = new Set(['/proj/README.md']);
    ws.focusPath = '/proj/README.md';
    ws._deleteSelection();
  });
  await p.waitForTimeout(700);
  ck(await p.evaluate(() => window.__FAKE.log.some((l) => l.indexOf('confirm:') === 0
     && l.includes('未保存'))), '删除未保存的文件前提醒会丢改动');
  ck(await p.evaluate(() => !('/proj/README.md' in window.__FAKE.files)), '文件被删除');
  ck(await tabCount() === tabsBeforeDelete - 1, '被删除文件的标签页自动关闭');
  ck(await p.evaluate(() => !LuoguEditor.workspace.docs.some((d) => d.path === '/proj/README.md')),
    '文档模型里不再留着已删除的路径');

  // ---- 7.5 关到零个标签：空状态 ---------------------------------------------
  const tabsAtStart = await tabCount();
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    ws._closingAll = (async () => { while (ws.docs.length) await ws.closeTab(0); })();
  });
  for (let i = 0; i < 25; i += 1) {
    if (!(await p.evaluate(() => !!document.querySelector('.ws-ask')))) break;
    await p.click('.ws-ask-btn[data-act="discard"]');
    await p.waitForTimeout(200);
  }
  await p.evaluate(() => LuoguEditor.workspace._closingAll);
  await p.waitForTimeout(400);
  ck(await tabCount() === 0, `可以一个标签都不留（起始 ${tabsAtStart} 个，全部关掉）`);
  ck(await p.evaluate(() => !document.getElementById('wsWatermark').hidden), '空状态引导出现');
  ck(await p.evaluate(() => document.getElementById('editorTextarea').readOnly === true),
    '空状态下编辑区只读');
  ck(await p.evaluate(() => document.getElementById('editorTextarea').value === ''),
    '空状态下编辑区内容是空的');
  ck(await p.evaluate(() => document.getElementById('docNameInput').value === ''),
    '空状态下文件名栏也清空');
  ck(await p.evaluate(() => !document.querySelector('.ws-tab.is-active')),
    '没有标签页时不存在 active 标签页');
  // 空状态下按 Ctrl+S：不该抛错，也不该走回"下载一份副本"的老路径
  await p.evaluate(() => {
    const ta = document.getElementById('editorTextarea');
    ta.focus();
  });
  await p.keyboard.press('Control+s');
  await p.waitForTimeout(400);
  ck((await toasts()).includes('没有打开的文件'), '空状态下 Ctrl+S 提示没有打开的文件');
  ck(errs.length === 0, '空状态下无 JS 报错', errs.slice(0, 3).join(' | '));

  // 引导里的按钮能把人带回来
  await p.click('#wsWmNew');
  await p.waitForTimeout(400);
  ck(await tabCount() === 1, '空状态引导里的"新建文件"可用');
  ck(await p.evaluate(() => document.getElementById('editorTextarea').readOnly === false),
    '新建后编辑区恢复可写');
  ck(await p.evaluate(() => document.getElementById('wsWatermark').hidden), '新建后引导消失');

  // ---- 7.6 非 Markdown 文件的提示 -------------------------------------------
  // 打开 .md 应当安安静静
  await p.evaluate(() => { document.getElementById('toastContainer').textContent = ''; });
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/src/../README.md')
    .catch(() => LuoguEditor.workspace.openPath('/proj/README.md')));
  await p.waitForTimeout(500);
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/README.md'));
  await p.waitForTimeout(500);
  ck(!(await toasts()).includes('不是 Markdown 文档'), '打开 .md 不打扰');

  // 打开 .txt：提示"不是 Markdown"，且只提示一次
  await p.evaluate(() => { document.getElementById('toastContainer').textContent = ''; });
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/src/notes.txt'));
  await p.waitForTimeout(500);
  ck((await toasts()).includes('不是 Markdown 文档'), '.txt 会提示不是 Markdown 文档');

  await p.evaluate(() => { document.getElementById('toastContainer').textContent = ''; });
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    const i = ws.indexOfPath('/proj/src/notes.txt');
    if (i >= 0) ws.docs.splice(i, 1);   // 先关掉，才能重新"打开"
    return ws.openPath('/proj/src/notes.txt');
  });
  await p.waitForTimeout(500);
  ck(!(await toasts()).includes('不是 Markdown 文档'), '同一扩展名不再重复提示（避免噪音）');

  // 打开 .cpp：同样是文本，给提示。
  // 先清掉"已提示过的扩展名"——前面已经打开过 main.cpp，不清的话这次不会再提示，
  // 断言就变成了在测执行顺序而不是在测行为。
  await p.evaluate(() => {
    LuoguEditor.workspace._hintedExts.clear();
    document.getElementById('toastContainer').textContent = '';
  });
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/src/main.cpp'));
  await p.waitForTimeout(500);
  ck((await toasts()).includes('不是 Markdown 文档'), '.cpp 也会提示（每种扩展名各一次）');

  // 打开 .png：先确认，取消则什么都不发生
  await p.evaluate(() => { window.__CONFIRM = false; });
  const tabsBeforePng = await tabCount();
  const readsBeforePng = await p.evaluate(() => window.__FAKE.log.filter((l) => l === 'read:/proj/assets/logo.png').length);
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/assets/logo.png'));
  await p.waitForTimeout(500);
  ck(await p.evaluate(() => window.__FAKE.log.some((l) => l.indexOf('confirm:') === 0 && l.includes('不是文本文件'))),
    '打开图片前先确认');
  ck(await p.evaluate(() => window.__FAKE.log.some((l) => l.includes('|opts:') && l.includes('warning'))),
    '确认框按警示样式弹出（标题/按钮文字已传入）');
  ck(await tabCount() === tabsBeforePng, '取消后不打开任何标签页');
  ck(await p.evaluate((n) => window.__FAKE.log.filter((l) => l === 'read:/proj/assets/logo.png').length === n, readsBeforePng),
    '取消后连读都没读——不去碰那个文件');

  // 确认后打开，并给出"别保存"的警告
  await p.evaluate(() => { window.__CONFIRM = true; document.getElementById('toastContainer').textContent = ''; });
  await p.evaluate(() => LuoguEditor.workspace.openPath('/proj/assets/logo.png'));
  await p.waitForTimeout(600);
  ck(await tabCount() === tabsBeforePng + 1, '确认后打开图片');
  ck((await toasts()).includes('请不要保存'), '打开二进制后警告不要保存');

  // ---- 8. 菜单里的两项杂务 --------------------------------------------------
  await p.click(rowSel('/proj/src'), { button: 'right' });
  await p.waitForTimeout(300);
  await p.click('.ws-menu-item:has-text("复制路径")');
  await p.waitForTimeout(400);
  ck((await toasts()).includes('已复制路径'), '复制路径给出反馈');

  await p.click(rowSel('/proj/src'), { button: 'right' });
  await p.waitForTimeout(300);
  await p.click('.ws-menu-item:has-text("在文件管理器中显示")');
  await p.waitForTimeout(400);
  ck(await p.evaluate(() => window.__FAKE.log.includes('reveal:/proj/src')),
    '“在文件管理器中显示”调用了宿主能力');

  // ---- 9. 工具栏与刷新 ------------------------------------------------------
  await p.evaluate(() => {
    const ws = LuoguEditor.workspace;
    ws.selection = new Set(['/proj/src']);
    ws.focusPath = '/proj/src';
  });
  await p.click('#wsNewFile');
  await p.waitForTimeout(300);
  ck(await p.evaluate(() => !!document.querySelector('.ws-inline-input')), '工具栏“新建文件”也能起输入框');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  ck(await p.evaluate(() => !document.querySelector('.ws-inline-input')), 'Esc 取消输入框');

  // 外部新增的文件，刷新后应当出现
  await p.evaluate(() => window.__FAKE.seed('/proj/outside.md', '# 外部新增'));
  await p.click('#wsRefresh');
  await p.waitForTimeout(600);
  ck(await p.evaluate(() => !!document.querySelector('#wsTree .ws-node[data-path="/proj/outside.md"]')),
    '刷新（清缓存重读）能看见外部新增的文件');

  // 折叠
  await p.evaluate(() => LuoguEditor.workspace.collapseAll());
  await p.waitForTimeout(400);
  const collapsed = await rows();
  ck(collapsed.includes('/proj') && collapsed.includes('/proj/src')
     && !collapsed.some((x) => x.startsWith('/proj/src/')),
    '“全部折叠”收起所有子目录（根与其一级子项保留）', JSON.stringify(collapsed));
  ck(await p.evaluate(() => document.querySelectorAll('#wsTree .ws-node.is-expanded').length) === 1,
    '折叠后只有根是展开态');

  ck(errs.length === 0, '全程无 JS 报错', errs.slice(0, 3).join(' | '));

  console.log(`\n文件浏览器 ${pass + fail} 项，失败 ${fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
