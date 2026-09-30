/**
 * Workspace: document tabs and a VS Code-style file explorer.
 *
 * This ships inside the one HTML file that both the web build and the desktop app
 * use, but it only switches itself on when a native filesystem is present (i.e.
 * under Tauri). In a browser there is no directory to show and no reliable place to
 * write back to, so the panel stays hidden rather than offering a crippled version
 * of itself.
 *
 * Everything here talks to the host through `fsAdapter`, a tiny interface with one
 * real implementation (Tauri) and one stub used by the tests. Keeping the DOM logic
 * free of Tauri calls is what makes the panel testable without a Rust toolchain.
 *
 * The tree keeps an in-memory picture of the disk (`dirCache`) rather than reading it
 * back on every render. The panel re-renders on every keystroke (the active tab's
 * dirty dot) and on every selection change; a readDir per level per keystroke would
 * make a real project folder unusable. Only mutations — create, rename, delete, move —
 * invalidate, and they invalidate exactly the directories they touched.
 */
(function (global) {
  'use strict';

  const MAX_RECENT = 12;
  // 打字停下来多久之后写盘。太短会在连续输入时反复写，太长又失去"自动"的意义。
  const AUTOSAVE_IDLE_MS = 2500;
  const AUTOSAVE_KEY = 'luogu_workspace_autosave';
  const FORMAT_ON_SAVE_KEY = 'luogu_workspace_format_on_save';
  const RECENT_KEY = 'luogu_editor_recent_files';
  const WIDTH_KEY = 'luogu_workspace_width';
  const WIDTH_DEFAULT = 240;
  const WIDTH_MIN = 180;
  const WIDTH_MAX = 480;
  const INDENT_PX = 14;
  // A filter walks the whole tree, so it needs a ceiling: past a few hundred nodes the
  // walk stops being instant and the result stops being readable anyway.
  const FILTER_MAX_NODES = 400;
  const FILTER_MAX_DEPTH = 8;

  // ---- path helpers --------------------------------------------------------
  // Paths arrive from the host already in the OS's own style, so these all have to
  // cope with both separators. Everything is compared in normalised ('/') form.

  const norm = (p) => String(p).replace(/\\/g, '/');
  const sep = (p) => (p.indexOf('\\') >= 0 && p.indexOf('/') < 0 ? '\\' : '/');
  const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
  const joinPath = (dir, name) => dir.replace(/[\\/]+$/, '') + sep(dir) + name;

  /** Parent directory, with the drive/root cases kept intact. */
  function parentOf(p) {
    const s = String(p).replace(/[\\/]+$/, '');
    if (!s) return '/';
    if (/^[A-Za-z]:$/.test(s)) return s + '\\';        // "C:" -> "C:\"
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    if (i < 0) return s;
    if (i === 0) return s.slice(0, 1);                  // "/proj" -> "/"
    const head = s.slice(0, i);
    if (/^[A-Za-z]:$/.test(head)) return head + '\\';   // "C:\x" -> "C:\"
    return head;
  }

  /** Is `p` inside `dir` (or the same path)? Case-sensitive, like the host paths. */
  function isInside(p, dir) {
    const a = norm(dir).replace(/\/+$/, '');
    const b = norm(p);
    return b === a || b.startsWith(a + '/');
  }

  /**
   * Rewrite a path that lived under `oldPrefix` so it now lives under `newPrefix`.
   * Returns null when the path was not inside the moved subtree.
   */
  function rewritePath(p, oldPrefix, newPrefix) {
    if (!isInside(p, oldPrefix)) return null;
    const rel = norm(p).slice(norm(oldPrefix).replace(/\/+$/, '').length).replace(/^\//, '');
    if (!rel) return newPrefix;
    return joinPath(newPrefix, rel.split('/').join(sep(newPrefix)));
  }

  /** Windows-style path? Drives are case-insensitive there, and only there. */
  function isWinPath(p) {
    return /^[A-Za-z]:/.test(String(p)) || String(p).indexOf('\\') >= 0;
  }

  /** Characters no filesystem in play will accept. */
  const BAD_NAME = /[\\/:*?"<>|]/;

  const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx']);

  /**
   * 已知的二进制类型。命中就"先问一句再打开"——`readTextFile` 读二进制只会得到
   * 一堆替换字符，而保存是把编辑框里的内容原样写回去，等于用乱码覆盖原文件。
   * 列成白名单式的黑名单而非反过来的白名单：真正需要拦的是这一类，而 Makefile、
   * LICENSE、.gitattributes 这类"没扩展名但其实是文本"的文件不该被烦。
   */
  const BINARY_EXTS = new Set([
    // 图片
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'avif', 'heic', 'psd',
    // 音频 / 视频
    'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'mid',
    'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v',
    // 压缩包 / 镜像
    'zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', 'zst', '7z', 'rar', 'jar', 'war',
    'deb', 'rpm', 'dmg', 'iso', 'img', 'apk',
    // 可执行文件 / 目标文件 / 库
    'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'obj', 'a', 'lib', 'class', 'wasm',
    'msi', 'app', 'appimage', 'pyc', 'pyo', 'rlib', 'rmeta', 'pdb',
    // 文档 / 表格 / 演示（都是压缩包，不是纯文本）
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
    // 字体 / 数据库
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'db', 'sqlite', 'sqlite3', 'mdb', 'dat', 'pak',
  ]);

  /**
   * 'markdown' | 'text' | 'binary'。
   * 无扩展名的按文本处理：二进制文件几乎没有不带扩展名的。
   */
  function classifyFile(name) {
    const ext = extensionOf(name);
    if (MARKDOWN_EXTS.has(ext)) return 'markdown';
    if (BINARY_EXTS.has(ext)) return 'binary';
    return 'text';
  }

  // ---- icons --------------------------------------------------------------
  // Inline SVG, deliberately: the build is checked for external references, so an
  // icon font or a sprite file is not an option. Stroke-based so one geometry reads
  // well at 16px on both themes; the colour comes from CSS per file kind.

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const GLYPHS = {
    // <span> of two chevrons — the universal "this is code" mark.
    code: ['M6 5.2 3.6 8 6 10.8', 'M10 5.2 12.4 8 10 10.8'],
    // Sheet of paper with text lines.
    doc: ['M4 2h5l3 3v9H4z', 'M6.4 8.6h3.2M6.4 11h3.2'],
    // Picture frame with a horizon.
    image: ['M2.6 3.4h10.8v9.2H2.6z', 'M2.6 10.4l3-2.8 2.6 2.4 2-1.8 3.2 2.6'],
    // Cardboard box — archives, and PDFs (which are equally "a file you don't edit").
    archive: ['M3.2 2.6h9.6v10.8H3.2z', 'M3.2 5.6h9.6M6.4 7.8h3.2'],
    // Plain file, no distinguishing content.
    file: ['M4 2h5l3 3v9H4z'],
    // Toolbar glyphs.
    refresh: ['M13 8a5 5 0 1 1-1.6-3.7', 'M13.2 2.4V5.2h-2.8'],
    newFile: ['M4 2h5l3 3v9H4z', 'M10.6 10.2h3.6M12.4 8.4v3.6'],
    newDir: ['M1.8 4c0-.6.4-1 1-1h3.3c.3 0 .6.1.8.4l.9 1.1h5.4c.6 0 1 .4 1 1v7.1H1.8z', 'M10.6 10.2h3.6M12.4 8.4v3.6'],
  };

  // Extension -> icon family and CSS colour slot. Ordered: first match wins.
  const FILE_KINDS = [
    { ext: ['md', 'markdown', 'mdown', 'mkd'], kind: 'md', glyph: 'doc' },
    { ext: ['txt', 'text', 'log', 'rst', 'csv'], kind: 'txt', glyph: 'doc' },
    { ext: ['json', 'jsonc', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'], kind: 'js', glyph: 'code' },
    { ext: ['html', 'htm', 'vue', 'svelte'], kind: 'html', glyph: 'code' },
    { ext: ['css', 'scss', 'sass', 'less'], kind: 'css', glyph: 'code' },
    { ext: ['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hxx'], kind: 'cpp', glyph: 'code' },
    { ext: ['py', 'pyw'], kind: 'py', glyph: 'code' },
    { ext: ['java', 'kt', 'kts'], kind: 'java', glyph: 'code' },
    { ext: ['rs'], kind: 'rust', glyph: 'code' },
    { ext: ['go'], kind: 'go', glyph: 'code' },
    { ext: ['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'], kind: 'shell', glyph: 'code' },
    { ext: ['yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env'], kind: 'config', glyph: 'code' },
    { ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tif', 'tiff'], kind: 'img', glyph: 'image' },
    { ext: ['pdf'], kind: 'pdf', glyph: 'pdf' },
    { ext: ['zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar'], kind: 'zip', glyph: 'archive' },
    { ext: ['exe', 'dll', 'so', 'dylib', 'bin', 'o', 'obj', 'class'], kind: 'bin', glyph: 'archive' },
  ];

  function extensionOf(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  function kindOf(name) {
    const ext = extensionOf(name);
    if (!ext) return { kind: 'plain', glyph: 'file' };
    const hit = FILE_KINDS.find((k) => k.ext.indexOf(ext) >= 0);
    return hit ? { kind: hit.kind, glyph: hit.glyph } : { kind: 'plain', glyph: 'file' };
  }

  /** Build one icon element. `glyph` picks the shape, `slot` lands in data-slot for CSS. */
  function makeIcon(glyph, slot, extraClass) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ws-svg' + (extraClass ? ' ' + extraClass : ''));
    if (slot) svg.setAttribute('data-slot', slot);
    (GLYPHS[glyph] || GLYPHS.file).forEach((d) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  /** Folders get two shapes so open/closed is legible without reading the chevron. */
  function makeFolderIcon(open) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ws-svg ws-svg-folder');
    svg.setAttribute('data-slot', 'folder');
    const shapes = open
      // Open: the lid is a separate plane, so the body gets a slant.
      ? ['M1.8 4c0-.6.4-1 1-1h3.3c.3 0 .6.1.8.4l.9 1.1h5.4c.6 0 1 .4 1 1v1.1',
         'M1.8 12.4l1.8-5.2h11.1l-1.8 5.2z']
      : ['M1.8 4c0-.6.4-1 1-1h3.3c.3 0 .6.1.8.4l.9 1.1h5.4c.6 0 1 .4 1 1v7.1H1.8z'];
    shapes.forEach((d, i) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      if (open && i === 0) path.setAttribute('class', 'ws-folder-back');
      svg.appendChild(path);
    });
    return svg;
  }

  // ---- host detection ------------------------------------------------------

  /** Detect a host that can actually read and write the user's disk. */
  function detectHost() {
    const t = global.__TAURI__;
    if (!t) return null;
    // Tauri v2 exposes plugins under __TAURI__ when withGlobalTauri is on, but the
    // bundled JS API is the supported path; accept either shape.
    const fs = t.fs || (t.plugins && t.plugins.fs);
    const dialog = t.dialog || (t.plugins && t.plugins.dialog);
    const opener = t.opener || (t.plugins && t.plugins.opener);
    if (!fs || !dialog) return null;
    return {
      readTextFile: (p) => fs.readTextFile(p),
      writeTextFile: (p, c) => fs.writeTextFile(p, c),
      readDir: (p) => fs.readDir(p),
      // Mutating calls are optional: a stub (or an older host) may not have them, and
      // the UI hides the corresponding menu entries rather than failing at click time.
      rename: fs.rename ? (a, b) => fs.rename(a, b) : null,
      mkdir: fs.mkdir ? (p) => fs.mkdir(p) : null,
      remove: fs.remove ? (p, o) => fs.remove(p, o) : null,
      exists: fs.exists ? (p) => fs.exists(p) : null,
      openFile: (opts) => dialog.open(opts),
      // `recursive` matters: the dialog puts exactly what it returns into the
      // filesystem scope, and without this flag the scope would stop at the folder
      // itself — subdirectories would be readable in the tree but not writable.
      openFolder: () => dialog.open({ directory: true, multiple: false, recursive: true }),
      saveAs: (opts) => dialog.save(opts),
      confirm: (msg, opts) => (dialog.confirm
        ? dialog.confirm(msg, opts)
        : Promise.resolve(global.confirm(msg))),
      revealInDir: opener && opener.revealItemInDir
        ? (p) => opener.revealItemInDir(p)
        : null,
    };
  }

  class LuoguWorkspace {
    constructor(editor, fsAdapter) {
      this.editor = editor;
      this.fs = fsAdapter || detectHost();
      this.docs = [];           // { path|null, name, content, dirty }
      this.active = -1;
      this.rootPath = null;
      this.treeState = {};      // path -> expanded?
      this.dirCache = new Map(); // path -> sorted entries (see the file header)
      this.selection = new Set();
      this.focusPath = null;
      this.filter = '';
      this._visible = [];       // last rendered rows, in order (keyboard nav, shift-range)
      this._menu = null;
      this._dragPaths = null;
      this._autosaveTimer = null;
      // 两个开关默认打开：都是"不用操心"的功能，随时可以在设置里关掉。
      this.autosaveToFile = this._readFlag(AUTOSAVE_KEY, true);
      this.formatOnSave = this._readFlag(FORMAT_ON_SAVE_KEY, true);
      this.enabled = !!this.fs;
    }

    // ---- 偏好 ---------------------------------------------------------------

    _readFlag(key, fallback) {
      try {
        const raw = global.localStorage && global.localStorage.getItem(key);
        return raw === null || raw === undefined ? fallback : raw === '1';
      } catch (e) { return fallback; }
    }

    _writeFlag(key, on) {
      try { global.localStorage && global.localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* 记不住不影响使用 */ }
    }

    setAutosaveToFile(on) {
      this.autosaveToFile = !!on;
      this._writeFlag(AUTOSAVE_KEY, this.autosaveToFile);
      this._syncSettingsMenu();
      this._setSaveStatus(this.autosaveToFile ? '已开启自动保存到文件' : '已关闭自动保存到文件');
      if (this.autosaveToFile) this._scheduleAutoSave();
      return this.autosaveToFile;
    }

    setFormatOnSave(on) {
      this.formatOnSave = !!on;
      this._writeFlag(FORMAT_ON_SAVE_KEY, this.formatOnSave);
      this._syncSettingsMenu();
      this._toast(this.formatOnSave ? '保存时将自动按洛谷规范排版' : '已关闭保存时自动排版', 'info');
      return this.formatOnSave;
    }

    /** 设置菜单里的勾选状态（菜单项由 index.html 提供，浏览器下是隐藏的）。 */
    _syncSettingsMenu() {
      const a = document.getElementById('autoSaveMark');
      const f = document.getElementById('formatOnSaveMark');
      if (a) a.textContent = this.autosaveToFile ? '✅' : '⬜';
      if (f) f.textContent = this.formatOnSave ? '✅' : '⬜';
    }

    /** 状态栏那一行：自动保存到底有没有发生，得看得见。 */
    _setSaveStatus(text) {
      const el = document.getElementById('fileSaveStatus');
      if (el) {
        el.textContent = text;
        el.parentElement && (el.parentElement.hidden = !this.enabled);
      }
    }

    // ---- lifecycle -----------------------------------------------------------

    mount() {
      if (!this.enabled) return false;
      this._buildDom();
      this._bindEditor();
      // Whatever is already in the editor becomes the first tab, so the user never
      // loses the draft they had open when the panel appeared.
      this.docs.push({
        path: null,
        name: this.editor.docName || '未命名.md',
        content: this.editor.getContent(),
        dirty: false,
      });
      this.active = 0;
      this.render();
      return true;
    }

    _bindEditor() {
      // Track dirtiness from the editor's own input events.
      const ta = document.getElementById('editorTextarea');
      if (!ta) return;
      ta.addEventListener('input', () => {
        const d = this.docs[this.active];
        if (!d) return;
        const now = ta.value;
        if (now !== d.content) {
          d.content = now;
          d.dirty = true;
          this.renderTabs();
          this._markDirtyInTree();
          this._scheduleAutoSave();
        }
      });
    }

    /** Repaint just the dirty dots instead of re-walking the whole tree. */
    _markDirtyInTree() {
      const host = document.getElementById('wsTree');
      if (!host) return;
      const dirty = new Set(this.docs.filter((d) => d.dirty && d.path).map((d) => d.path));
      host.querySelectorAll('.ws-node[data-path]').forEach((row) => {
        row.classList.toggle('is-dirty', dirty.has(row.getAttribute('data-path')));
      });
    }

    // ---- 自动保存 -----------------------------------------------------------

    /** 每次输入后重置计时器：写盘发生在"停下来"之后，而不是每敲一个字。 */
    _scheduleAutoSave() {
      if (!this.autosaveToFile) return;
      clearTimeout(this._autosaveTimer);
      this._autosaveTimer = setTimeout(() => this.autosaveNow(), AUTOSAVE_IDLE_MS);
    }

    /**
     * 把有路径且已修改的文档写回磁盘。
     *
     * 刻意不在这里做格式化：内容正在被编辑，替换文本会让光标跳走。格式化只发生在
     * 显式保存（Ctrl+S / 关闭时选"保存"）——那里用户本来就预期内容会变。
     * 没有路径的新文档一律跳过：自动保存绝不弹"另存为"对话框。
     */
    async autosaveNow() {
      if (!this.autosaveToFile) return 0;
      const targets = this.docs.filter((d) => d.dirty && d.path);
      if (!targets.length) return 0;
      let saved = 0;
      for (const d of targets) {
        try {
          await this.fs.writeTextFile(d.path, d.content);
        } catch (e) {
          this._setSaveStatus(`⚠ 自动保存失败：${baseName(d.path)}`);
          this._toast(`自动保存失败（${baseName(d.path)}）：${e && e.message ? e.message : e}`, 'error');
          return saved;
        }
        d.dirty = false;
        saved += 1;
      }
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      this._setSaveStatus(`已自动保存到文件 ${hh}:${mm}:${ss}`);
      this.renderTabs();
      this._markDirtyInTree();
      return saved;
    }

    // ---- 外部打开的文档 ------------------------------------------------------

    /**
     * 编辑器从工作区之外拿到了一份文档：把文件拖进窗口、用系统的"打开方式"拉起、
     * 或者浏览器里选了文件。
     *
     * 这些路径都不经过 openPath()，面板原本一无所知——于是会出现"右边有预览、
     * 左边写着没有打开的文件"这种自相矛盾的画面。这里把它补成一个标签页。
     * 不调用 setContent：内容已经在编辑区里了，再灌一次会把光标顶回开头。
     */
    adoptExternal({ name, content, path }) {
      if (!this.enabled) return;
      const cur = this.docs[this.active];
      // 空白未命名页直接顶替掉，否则每拖一个文件就多留一个空标签。
      if (cur && !cur.path && !cur.dirty && !cur.content) {
        cur.name = name || cur.name;
        cur.content = content || '';
        cur.path = path || null;
        cur.dirty = false;
      } else if (path) {
        const existing = this.indexOfPath(path);
        if (existing >= 0) { this.activate(existing); return; }
        this.docs.push({ name, content: content || '', path, dirty: false });
        this.active = this.docs.length - 1;
      } else {
        this.docs.push({ name, content: content || '', path: null, dirty: false });
        this.active = this.docs.length - 1;
      }
      const d = this.docs[this.active];
      this.editor.docName = d.name;
      const nameInput = document.getElementById('docNameInput');
      if (nameInput) nameInput.value = d.name;
      if (path) this._pushRecent(path);
      this.render();
    }

    // ---- document model ------------------------------------------------------

    indexOfPath(path) {
      return this.docs.findIndex((d) => d.path && path && d.path === path);
    }

    async openPath(path, opts) {
      const existing = this.indexOfPath(path);
      if (existing >= 0) { this.activate(existing); return; }

      const name = baseName(path);
      const kind = classifyFile(name);
      if (kind === 'binary' && !(opts && opts.force)) {
        const ok = await this.fs.confirm(
          `「${name}」看起来不是文本文件。\n\n`
            + '按文本打开只会看到乱码，而且一旦保存，这些乱码会覆盖原文件。\n\n仍要打开吗？',
          { kind: 'warning', title: '不是文本文件', okLabel: '仍要打开', cancelLabel: '取消' },
        );
        if (!ok) return;
        this._toast(`已按文本打开「${name}」，请不要保存：写回会损坏原文件`, 'error');
      } else if (kind === 'text') {
        this._hintNotMarkdown(name);
      }

      let content = '';
      try {
        content = await this.fs.readTextFile(path);
      } catch (e) {
        this._toast(`打不开 ${baseName(path)}：${e && e.message ? e.message : e}`, 'error');
        return;
      }
      this.docs.push({ path, name: baseName(path), content, dirty: false });
      this.activate(this.docs.length - 1);
      this._pushRecent(path);
    }

    /**
     * 提醒"这不是 Markdown 文档"。每种扩展名只提示一次——每开一个 .cpp 都弹同一句话，
     * 提示就从帮助变成了噪音。
     */
    _hintNotMarkdown(name) {
      this._hintedExts = this._hintedExts || new Set();
      const ext = extensionOf(name) || '(无扩展名)';
      if (this._hintedExts.has(ext)) return;
      this._hintedExts.add(ext);
      this._toast(`「${name}」不是 Markdown 文档：预览会按 Markdown 规则渲染，保存时原样写回`, 'info');
    }

    activate(i) {
      if (i < 0 || i >= this.docs.length) return;
      // Stash the live text before switching away, or edits made since the last
      // keystroke event would be lost.
      const cur = this.docs[this.active];
      if (cur) cur.content = this.editor.getContent();

      this.active = i;
      const d = this.docs[i];
      this.editor.docName = d.name;
      const nameInput = document.getElementById('docNameInput');
      if (nameInput) nameInput.value = d.name;
      // setContent pushes history; loading a different document should not be
      // undoable into the previous one.
      this.editor.resetCalloutToggles && this.editor.resetCalloutToggles();
      this.editor.setContent(d.content, false);
      // Bring the file into view — opening it from the recent list while its folder
      // is collapsed otherwise leaves the tree looking like nothing happened.
      if (d.path) this._revealTarget = d.path;
      this.render();
    }

    /**
     * "还有未保存的改动"三选一：保存 / 不保存 / 取消。
     *
     * 宿主自带的 confirm 只有两个按钮，于是用户被迫在"丢掉改动"和"关不掉"之间选，
     * 偏偏少了最常用的那个——先存再关。所以这个对话框自己画。
     */
    _askUnsaved(name) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active ws-ask';
        overlay.innerHTML = `
          <div class="modal-dialog ws-ask-dialog" role="dialog" aria-modal="true" aria-labelledby="wsAskTitle">
            <h3 class="ws-ask-title" id="wsAskTitle"></h3>
            <p class="ws-ask-body"></p>
            <div class="ws-ask-buttons">
              <button type="button" class="ws-ask-btn is-primary" data-act="save">保存</button>
              <button type="button" class="ws-ask-btn is-danger" data-act="discard">不保存</button>
              <button type="button" class="ws-ask-btn" data-act="cancel">取消</button>
            </div>
          </div>`;
        // 文件名来自磁盘，用 textContent 写入，不做字符串拼接。
        overlay.querySelector('.ws-ask-title').textContent = '是否保存更改？';
        overlay.querySelector('.ws-ask-body').textContent =
          `「${name}」有未保存的改动。不保存的话，这些改动会丢失。`;

        let settled = false;
        const done = (choice) => {
          if (settled) return;
          settled = true;
          document.removeEventListener('keydown', onKey, true);
          overlay.remove();
          resolve(choice);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done('save'); }
        };
        overlay.querySelectorAll('.ws-ask-btn').forEach((btn) => {
          btn.onclick = () => done(btn.getAttribute('data-act'));
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        const primary = overlay.querySelector('.ws-ask-btn.is-primary');
        if (primary) primary.focus();
      });
    }

    async closeTab(i) {
      const d = this.docs[i];
      if (!d) return;
      if (d.dirty) {
        const choice = await this._askUnsaved(d.name);
        if (choice === 'cancel') return;
        if (choice === 'save') {
          const ok = await this.saveIndex(i);
          // 保存失败、或用户在"另存为"里点了取消：那就别关，别把改动带走。
          if (!ok) return;
          if (this.docs.indexOf(d) !== i) i = this.docs.indexOf(d);
        }
      }
      this.docs.splice(i, 1);
      if (!this.docs.length) {
        // 允许一个标签都不留。以前这里会补一个空白页，于是"关掉所有文件"这件事
        // 做不到，人也没法真的收拾干净。
        this.active = -1;
        this._clearEditor();
        this.render();
        return;
      }
      if (this.active >= this.docs.length) {
        this.active = this.docs.length - 1;
      } else if (i < this.active) {
        this.active -= 1;
      }
      this.activate(this.active);
    }

    newTab() {
      this.docs.push({ path: null, name: '未命名.md', content: '', dirty: false });
      this.activate(this.docs.length - 1);
    }

    /** 没有标签页时把编辑区清空。 */
    _clearEditor() {
      this.editor.docName = '未命名.md';
      const nameInput = document.getElementById('docNameInput');
      if (nameInput) nameInput.value = '';
      this.editor.resetCalloutToggles && this.editor.resetCalloutToggles();
      this.editor.setContent('', false);
    }

    /**
     * 编辑区的空状态：一个标签页都没有时显示引导，并把输入区置为只读。
     *
     * 只读是刻意的：没有标签页时敲进去的字没有任何地方可存（保存是无处可写的），
     * 与其让它静默消失，不如先请人新建一个文档。
     */
    _applyEmptyState() {
      if (!this.enabled) return;
      const empty = this.docs.length === 0;
      document.documentElement.classList.toggle('ws-no-docs', empty);
      const ta = document.getElementById('editorTextarea');
      if (ta) ta.readOnly = empty;
      const nameInput = document.getElementById('docNameInput');
      if (nameInput) nameInput.readOnly = empty;
      const mark = document.getElementById('wsWatermark');
      if (mark) mark.hidden = !empty;
    }

    saveActive() {
      return this.saveIndex(this.active);
    }

    /** 按索引保存，不只是当前标签页——关闭一个后台的脏标签页时也要能存。 */
    async saveIndex(i) {
      const d = this.docs[i];
      if (!d) { this._toast('当前没有打开的文件', 'info'); return false; }
      // 只有正在编辑的文档才以编辑区为准；后台标签页的内容就是它自己存的。
      if (i === this.active) d.content = this.editor.getContent();

      let path = d.path;
      if (!path) {
        path = await this.fs.saveAs({
          defaultPath: d.name,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
        });
        if (!path) return false;   // 用户在另存为里取消了：当作没保存
      }

      let content = d.content;
      let formatted = false;
      if (this.formatOnSave && this.editor.linter && this.editor.linter.formatSpacing) {
        const fixed = this.editor.linter.formatSpacing(content);
        if (fixed !== content) { content = fixed; formatted = true; }
      }

      try {
        await this.fs.writeTextFile(path, content);
      } catch (e) {
        this._toast(`保存失败：${e && e.message ? e.message : e}`, 'error');
        return false;
      }

      const isNew = d.path !== path;
      d.path = path;
      d.name = baseName(path);
      d.content = content;
      d.dirty = false;
      // 排版改动了内容，编辑区得跟着变，否则界面显示的和文件里存的不是一回事。
      // pushHistory = true：格式化是内容变更，用户应当能撤销它。
      if (i === this.active && formatted) this.editor.setContent(content, true);
      this.editor.docName = this.docs[this.active] ? this.docs[this.active].name : d.name;
      this._pushRecent(path);
      // A brand-new file has to appear in the tree it was saved into.
      if (isNew && this.rootPath && isInside(path, this.rootPath)) {
        this._invalidate(parentOf(path));
        this.treeState[parentOf(path)] = true;
        this.selection = new Set([path]);
        this._revealTarget = path;
      }
      this.render();
      this._toast(formatted ? `已按洛谷规范排版后保存「${d.name}」` : `已保存到「${d.name}」`, 'success');
      this._setSaveStatus(`已保存到文件 ${d.name}`);
      return true;
    }

    // ---- folder tree: reading ------------------------------------------------

    async openFolderDialog() {
      const dir = await this.fs.openFolder();
      if (!dir) return;
      await this.setRoot(typeof dir === 'string' ? dir : dir.path || String(dir));
    }

    async openFileDialog() {
      const picked = await this.fs.openFile({
        multiple: true,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      });
      if (!picked) return;
      const list = Array.isArray(picked) ? picked : [picked];
      for (const p of list) await this.openPath(typeof p === 'string' ? p : p.path);
    }

    async setRoot(path) {
      this.rootPath = path;
      this.treeState = { [path]: true };
      this.dirCache.clear();
      this.selection = new Set();
      this.focusPath = null;
      this.filter = '';
      const box = document.getElementById('wsFilter');
      if (box) box.value = '';
      await this.render();
    }

    /** Drop one directory (or all of them) from the cache after a mutation. */
    _invalidate(dir) {
      if (dir) this.dirCache.delete(dir);
      else this.dirCache.clear();
    }

    async _readDirSorted(path, opts) {
      const useCache = !(opts && opts.fresh);
      if (useCache && this.dirCache.has(path)) return this.dirCache.get(path);
      let items = [];
      try {
        items = await this.fs.readDir(path);
      } catch (e) {
        // Unreadable directory (permissions, or a file raced us to the name): show it
        // empty rather than breaking the whole tree render.
        items = [];
      }
      const out = items
        .map((e) => ({
          name: e.name,
          isDir: !!(e.isDirectory || e.children),
          path: e.path || joinPath(path, e.name),
        }))
        // Hide dotfiles: a project folder is usually full of .git noise.
        .filter((e) => !e.name.startsWith('.'))
        // Folders first, then names — the ordering every file manager uses.
        .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1)
          : a.name.localeCompare(b.name, 'zh-Hans-CN')));
      this.dirCache.set(path, out);
      return out;
    }

    // ---- folder tree: building the row list ----------------------------------

    /**
     * Flatten the tree into the rows that should be on screen, in order.
     *
     * Keyboard navigation and shift-range selection both need "the row above/below
     * me" as cheap operations, and a flattened list is the only shape that makes
     * that true. With a filter active the walk ignores expansion state and instead
     * finds every match plus the folders leading to it.
     */
    async _visibleNodes() {
      const rows = [];
      if (!this.rootPath) return rows;
      const root = { name: baseName(this.rootPath), path: this.rootPath, isDir: true, depth: 0, isRoot: true };
      rows.push(root);

      if (this.filter) {
        const needle = this.filter.toLowerCase();
        const budget = { nodes: FILTER_MAX_NODES };
        await this._collectMatches(rows, this.rootPath, 1, needle, budget, {});
        return rows;
      }

      if (this.treeState[this.rootPath]) {
        await this._collectChildren(rows, this.rootPath, 1);
      }
      return rows;
    }

    async _collectChildren(rows, dir, depth) {
      const items = await this._readDirSorted(dir);
      for (const it of items) {
        rows.push({ name: it.name, path: it.path, isDir: it.isDir, depth });
        if (it.isDir && this.treeState[it.path]) {
          await this._collectChildren(rows, it.path, depth + 1);
        }
      }
    }

    /**
     * Depth-first hunt for filename matches. A folder is kept when it matches (then
     * all of its children are listed) or when something below it matches.
     */
    async _collectMatches(rows, dir, depth, needle, budget, seen) {
      if (depth > FILTER_MAX_DEPTH || budget.nodes <= 0) return false;
      if (seen[dir]) return false; // symlink loop guard
      seen[dir] = true;

      const items = await this._readDirSorted(dir);
      let kept = false;
      for (const it of items) {
        if (budget.nodes <= 0) break;
        const hit = it.name.toLowerCase().indexOf(needle) >= 0;
        if (it.isDir) {
          if (hit) {
            // Matched folder: show it with everything inside, one level deep, so the
            // result is usable without further clicking.
            rows.push({ name: it.name, path: it.path, isDir: true, depth });
            budget.nodes -= 1;
            const sub = await this._readDirSorted(it.path);
            for (const c of sub) {
              if (budget.nodes <= 0) break;
              rows.push({ name: c.name, path: c.path, isDir: c.isDir, depth: depth + 1 });
              budget.nodes -= 1;
            }
            kept = true;
          } else {
            const mark = rows.length;
            rows.push({ name: it.name, path: it.path, isDir: true, depth });
            const inner = await this._collectMatches(rows, it.path, depth + 1, needle, budget, seen);
            if (inner) {
              budget.nodes -= 1;
              kept = true;
            } else {
              rows.length = mark; // nothing below matched: drop the folder again
            }
          }
        } else if (hit) {
          rows.push({ name: it.name, path: it.path, isDir: false, depth });
          budget.nodes -= 1;
          kept = true;
        }
      }
      return kept;
    }

    // ---- folder tree: rendering ----------------------------------------------

    async renderTree() {
      const host = document.getElementById('wsTree');
      if (!host) return;
      // Rendering the tree is async (each level is a readDir await), so two calls
      // that overlap would both clear the host and then both append — the tree came
      // out duplicated several times over. Stamp each run and let only the newest
      // one touch the DOM.
      const token = (this._treeToken = (this._treeToken || 0) + 1);
      const nodes = await this._visibleNodes();
      if (token !== this._treeToken) return;

      this._visible = nodes;
      host.textContent = '';
      if (!nodes.length) {
        host.appendChild(this._emptyState());
        return;
      }
      nodes.forEach((n) => host.appendChild(this._row(n)));
      this._scrollRevealIntoView();
    }

    _emptyState() {
      const box = document.createElement('div');
      box.className = 'ws-empty ws-empty-open';
      const hint = document.createElement('div');
      hint.className = 'ws-empty-hint';
      hint.textContent = '未打开文件夹';
      const open = document.createElement('button');
      open.className = 'ws-empty-btn';
      open.textContent = '打开文件夹';
      open.onclick = () => this.openFolderDialog();
      const openFile = document.createElement('button');
      openFile.className = 'ws-empty-btn ws-empty-btn-quiet';
      openFile.textContent = '打开文件';
      openFile.onclick = () => this.openFileDialog();
      box.appendChild(hint);
      box.appendChild(open);
      box.appendChild(openFile);
      return box;
    }

    _row(node) {
      const { name, path, isDir, depth } = node;
      const openDoc = this.docs[this.active];
      const row = document.createElement('div');
      row.className = 'ws-node'
        + (isDir ? ' is-dir' : '')
        + (depth === 0 ? ' is-root' : '')
        + (this.treeState[path] ? ' is-expanded' : '')
        + (openDoc && openDoc.path === path ? ' is-open' : '')
        + (this.selection.has(path) ? ' is-selected' : '')
        + (this.focusPath === path ? ' is-focused' : '');
      const d = this.docs.find((x) => x.path === path);
      if (d && d.dirty) row.classList.add('is-dirty');

      row.style.setProperty('--ws-depth', String(depth));
      row.style.paddingLeft = `${6 + depth * INDENT_PX}px`;
      row.setAttribute('data-path', path);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth + 1));
      if (isDir) row.setAttribute('aria-expanded', this.treeState[path] ? 'true' : 'false');
      row.title = path;
      row.draggable = true;

      // Indent guides. A fixed-size, repeating gradient as the row's background keeps
      // this out of the DOM: one background box per level, no guide elements to manage.
      if (depth > 0) row.classList.add('has-guides');

      const chev = document.createElement('span');
      chev.className = 'ws-chev';
      if (isDir) {
        const tri = document.createElementNS(SVG_NS, 'svg');
        tri.setAttribute('viewBox', '0 0 16 16');
        tri.setAttribute('width', '16');
        tri.setAttribute('height', '16');
        tri.setAttribute('aria-hidden', 'true');
        tri.setAttribute('class', 'ws-svg ws-svg-chev');
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', 'M6 3.5 10.5 8 6 12.5');
        tri.appendChild(p);
        chev.appendChild(tri);
      }
      row.appendChild(chev);

      const icon = document.createElement('span');
      icon.className = 'ws-icon';
      if (isDir) {
        icon.appendChild(makeFolderIcon(!!this.treeState[path]));
      } else {
        const k = kindOf(name);
        icon.appendChild(makeIcon(k.glyph, k.kind, 'ws-svg-file'));
      }
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'ws-node-name';
      // textContent, never innerHTML: file names come from the disk and are attacker
      // controlled in exactly the case that matters (a repo you just cloned).
      label.textContent = name;
      row.appendChild(label);

      this._bindRow(row, node);
      return row;
    }

    _bindRow(row, node) {
      const { path, isDir } = node;
      row.onclick = (e) => {
        if (e.ctrlKey || e.metaKey) {
          this._toggleSelect(path);
        } else if (e.shiftKey) {
          this._selectRange(path);
        } else {
          this.selection = new Set([path]);
          this.focusPath = path;
          if (isDir) this.toggleDir(path); else this.openPath(path);
          return; // toggleDir/openPath re-render and repaint selection
        }
        this._paintSelection();
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        // Right-clicking inside a multi-selection keeps it — that is how you delete
        // or move several files at once.
        if (!this.selection.has(path)) {
          this.selection = new Set([path]);
          this.focusPath = path;
          this._paintSelection();
        }
        this._showMenu(e.clientX, e.clientY, this._menuItemsFor(node));
      };
      row.ondblclick = () => {
        if (!isDir) this.openPath(path);
      };

      // --- drag and drop ---
      row.ondragstart = (e) => {
        const paths = this.selection.has(path) ? [...this.selection] : [path];
        this._dragPaths = paths;
        row.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          // The payload is for other drop targets; our own handlers read _dragPaths,
          // which survives even if the browser sanitises the text.
          try { e.dataTransfer.setData('text/plain', paths.join('\n')); } catch (err) { /* ignore */ }
        }
      };
      row.ondragend = () => {
        this._dragPaths = null;
        document.querySelectorAll('.ws-node.is-dragging, .ws-node.is-drop-target')
          .forEach((el) => el.classList.remove('is-dragging', 'is-drop-target'));
      };
      row.ondragover = (e) => {
        if (!this._dragPaths) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        row.classList.add('is-drop-target');
      };
      row.ondragleave = () => row.classList.remove('is-drop-target');
      row.ondrop = (e) => {
        if (!this._dragPaths) return;
        e.preventDefault();
        row.classList.remove('is-drop-target');
        this._moveInto(isDir ? path : parentOf(path));
      };
    }

    toggleDir(path) {
      this.treeState[path] = !this.treeState[path];
      this.renderTree();
    }

    // ---- selection -----------------------------------------------------------

    _paintSelection() {
      const host = document.getElementById('wsTree');
      if (!host) return;
      host.querySelectorAll('.ws-node[data-path]').forEach((el) => {
        const p = el.getAttribute('data-path');
        el.classList.toggle('is-selected', this.selection.has(p));
        el.classList.toggle('is-focused', this.focusPath === p);
      });
    }

    _toggleSelect(path) {
      if (this.selection.has(path)) this.selection.delete(path);
      else this.selection.add(path);
      this.focusPath = path;
    }

    _selectRange(path) {
      const order = this._visible.map((n) => n.path);
      const to = order.indexOf(path);
      const from = order.indexOf(this.focusPath);
      if (to < 0) return;
      if (from < 0) { this.selection = new Set([path]); this.focusPath = path; return; }
      const [a, b] = from <= to ? [from, to] : [to, from];
      const next = new Set(this.selection);
      for (let i = a; i <= b; i += 1) next.add(order[i]);
      this.selection = next;
    }

    _selectAllVisible() {
      this.selection = new Set(this._visible.filter((n) => !n.isRoot).map((n) => n.path));
      this._paintSelection();
    }

    _clearSelection() {
      this.selection = new Set();
      this._paintSelection();
    }

    /** Selected paths, minus the workspace root (nothing may delete or move that). */
    _targets() {
      const list = [...this.selection].filter((p) => p !== this.rootPath);
      if (list.length) return list;
      return this.focusPath && this.focusPath !== this.rootPath ? [this.focusPath] : [];
    }

    /** Expand every ancestor of a path so its row can be shown. */
    _expandAncestors(path) {
      let dir = parentOf(path);
      while (dir && isInside(dir, this.rootPath)) {
        this.treeState[dir] = true;
        if (norm(dir) === norm(this.rootPath)) break;
        dir = parentOf(dir);
      }
      this.treeState[this.rootPath] = true;
    }

    _scrollRevealIntoView() {
      const target = this._revealTarget;
      if (!target) return;
      this._revealTarget = null;
      const host = document.getElementById('wsTree');
      const row = host && host.querySelector(`.ws-node[data-path="${CSS.escape(target)}"]`);
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    // ---- keyboard navigation -------------------------------------------------

    /** Move the cursor by one row, selecting what it lands on (as VS Code does). */
    _step(offset) {
      if (!this._visible.length) return;
      const order = this._visible.map((n) => n.path);
      const at = order.indexOf(this.focusPath);
      const next = at < 0 ? (offset > 0 ? 0 : order.length - 1)
        : Math.min(order.length - 1, Math.max(0, at + offset));
      const path = order[next];
      this.focusPath = path;
      this.selection = new Set([path]);
      this._paintSelection();
      const host = document.getElementById('wsTree');
      const row = host && host.querySelector(`.ws-node[data-path="${CSS.escape(path)}"]`);
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    _nodeFor(path) {
      return this._visible.find((n) => n.path === path) || null;
    }

    _firstChildOf(path) {
      const i = this._visible.findIndex((n) => n.path === path);
      if (i < 0) return null;
      const next = this._visible[i + 1];
      return next && next.depth > this._visible[i].depth ? next : null;
    }

    _parentNodeOf(path) {
      const parent = parentOf(path);
      return this._nodeFor(parent);
    }

    _onTreeKeyDown(e) {
      if (this._inline) return; // the inline input owns the keyboard while it is open
      const node = this._nodeFor(this.focusPath);
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); this._step(1); break;
        case 'ArrowUp': e.preventDefault(); this._step(-1); break;
        case 'ArrowRight':
          e.preventDefault();
          if (node && node.isDir && !this.treeState[node.path]) {
            this.toggleDir(node.path);
          } else if (node) {
            const child = this._firstChildOf(node.path);
            if (child) { this.focusPath = child.path; this.selection = new Set([child.path]); this._paintSelection(); }
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (node && node.isDir && this.treeState[node.path]) {
            this.toggleDir(node.path);
          } else if (node) {
            const parent = this._parentNodeOf(node.path);
            if (parent) {
              this.focusPath = parent.path;
              this.selection = new Set([parent.path]);
              this._paintSelection();
            }
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (node && node.isDir) this.toggleDir(node.path);
          else if (node) this.openPath(node.path);
          break;
        case 'F2': e.preventDefault(); this._beginRename(); break;
        case 'Delete': case 'Backspace':
          e.preventDefault();
          this._deleteSelection();
          break;
        case 'a': case 'A':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); this._selectAllVisible(); }
          break;
        case 'Home': e.preventDefault(); this._step(-this._visible.length); break;
        case 'End': e.preventDefault(); this._step(this._visible.length); break;
        case 'Escape': this._clearSelection(); break;
        default: break;
      }
    }

    // ---- inline input (new file / new folder / rename) -----------------------

    /**
     * Put a text box in the tree, where the name will actually appear.
     *
     * A dialog would be simpler, but naming happens in the tree and a modal makes the
     * user lose the context of which folder they are in; VS Code puts the input in
     * the row itself and so does this.
     */
    _openInlineInput(anchorPath, { depth, value, onCommit, selectStem }) {
      this._cancelInlineInput();
      const host = document.getElementById('wsTree');
      if (!host) return;

      const row = document.createElement('div');
      row.className = 'ws-node ws-input-row';
      row.style.paddingLeft = `${6 + depth * INDENT_PX}px`;
      row.appendChild(Object.assign(document.createElement('span'), { className: 'ws-chev' }));
      const icon = document.createElement('span');
      icon.className = 'ws-icon';
      icon.appendChild(makeIcon('file', 'plain', 'ws-svg-file'));
      row.appendChild(icon);

      const input = document.createElement('input');
      input.className = 'ws-inline-input';
      input.type = 'text';
      input.value = value || '';
      input.spellcheck = false;
      input.autocomplete = 'off';
      row.appendChild(input);

      const anchorRow = anchorPath
        ? host.querySelector(`.ws-node[data-path="${CSS.escape(anchorPath)}"]`)
        : null;
      if (anchorRow && anchorRow.parentNode === host) anchorRow.insertAdjacentElement('afterend', row);
      else host.insertBefore(row, host.firstChild);

      const finish = async (commit) => {
        if (this._inline !== token) return;
        this._inline = null;
        const name = input.value.trim();
        row.remove();
        if (commit && name) await onCommit(name);
      };

      const token = {
        input,
        finish,
        cancel: () => { if (this._inline === token) { this._inline = null; row.remove(); } },
      };
      this._inline = token;

      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // Delete/F2 in the box are text editing, not tree commands
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(false));

      input.focus();
      if (selectStem) {
        const dot = input.value.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
      } else {
        input.select();
      }
    }

    _cancelInlineInput() {
      if (this._inline) {
        const t = this._inline;
        this._inline = null;
        t.input.parentNode && t.input.parentNode.remove();
      }
    }

    // ---- file operations -----------------------------------------------------

    /** Reject names no filesystem will take, before asking the host and getting an error. */
    _checkName(name) {
      if (!name) return '名字不能为空';
      if (BAD_NAME.test(name)) return '名字里不能包含 \\ / : * ? " < > |';
      if (/^\.+$/.test(name)) return '这个名字不可用';
      if (name.endsWith(' ') || name.endsWith('.')) return '名字不能以空格或点结尾';
      return null;
    }

    async _pathExists(path) {
      if (this.fs.exists) {
        try { return await this.fs.exists(path); } catch (e) { /* fall back to the listing */ }
      }
      const parent = parentOf(path);
      const items = await this._readDirSorted(parent, { fresh: true });
      const want = baseName(path);
      return items.some((it) => (isWinPath(path)
        ? it.name.toLowerCase() === want.toLowerCase()
        : it.name === want));
    }

    _beginCreate(anchorPath, isDir) {
      if (!this.rootPath) return;
      const node = anchorPath ? this._nodeFor(anchorPath) : null;
      // Creating from a file means "in that file's folder"; from a folder, inside it.
      const dir = node ? (node.isDir ? node.path : parentOf(node.path)) : this.rootPath;
      const depth = node ? (node.isDir ? node.depth + 1 : node.depth) : 1;
      if (node && node.isDir && !this.treeState[node.path]) this.treeState[node.path] = true;

      const name = isDir ? '' : '未命名.md';
      this._openInlineInput(node ? node.path : null, {
        depth,
        value: name,
        selectStem: !isDir,
        onCommit: async (input) => {
          const bad = this._checkName(input);
          if (bad) { this._toast(bad, 'error'); return; }
          const path = joinPath(dir, input);
          if (await this._pathExists(path)) { this._toast(`「${input}」已存在`, 'error'); return; }
          try {
            if (isDir) {
              if (!this.fs.mkdir) throw new Error('该主机不支持新建文件夹');
              await this.fs.mkdir(path);
            } else {
              await this.fs.writeTextFile(path, '');
            }
          } catch (e) {
            this._toast(`创建失败：${e && e.message ? e.message : e}`, 'error');
            return;
          }
          this._invalidate(dir);
          this.treeState[dir] = true;
          this.selection = new Set([path]);
          this.focusPath = path;
          if (!isDir) { this._revealTarget = path; await this.openPath(path); }
          else await this.renderTree();
        },
      });
    }

    _beginRename() {
      const targets = this._targets();
      if (targets.length !== 1) {
        if (targets.length) this._toast('一次只能重命名一个文件', 'error');
        return;
      }
      const path = targets[0];
      const node = this._nodeFor(path);
      if (!node) return;
      const dir = parentOf(path);
      this._openInlineInput(path, {
        depth: node.depth,
        value: baseName(path),
        selectStem: !node.isDir,
        onCommit: async (input) => {
          if (input === baseName(path)) return; // no-op rename
          const bad = this._checkName(input);
          if (bad) { this._toast(bad, 'error'); return; }
          const next = joinPath(dir, input);
          if (await this._pathExists(next)) { this._toast(`「${input}」已存在`, 'error'); return; }
          if (!this.fs.rename) { this._toast('该主机不支持重命名', 'error'); return; }
          try {
            await this.fs.rename(path, next);
          } catch (e) {
            this._toast(`重命名失败：${e && e.message ? e.message : e}`, 'error');
            return;
          }
          this._afterMove(path, next);
          this._invalidate(dir);
          this.selection = new Set([next]);
          this.focusPath = next;
          this._revealTarget = next;
          await this.render();
          this._toast(`已重命名为「${input}」`, 'success');
        },
      });
    }

    async _deleteSelection() {
      const targets = this._targets();
      if (!targets.length) return;
      if (!this.fs.remove) { this._toast('该主机不支持删除', 'error'); return; }

      const names = targets.map((p) => baseName(p));
      const openDirty = this.docs.filter((d) => d.dirty && d.path && targets.some((t) => isInside(d.path, t)));
      const what = targets.length === 1
        ? `「${names[0]}」`
        : `${targets.length} 个项目（${names.slice(0, 3).join('、')}${names.length > 3 ? '…' : ''}）`;
      const extra = openDirty.length
        ? `\n\n其中 ${openDirty.map((d) => `「${d.name}」`).join('')} 有未保存的修改，一并丢弃。`
        : '';
      const ok = await this.fs.confirm(`确定要删除 ${what} 吗？此操作不可撤销。${extra}`);
      if (!ok) return;

      const failed = [];
      for (const path of targets) {
        try {
          await this.fs.remove(path, { recursive: true });
        } catch (e) {
          failed.push(`${baseName(path)}：${e && e.message ? e.message : e}`);
          continue;
        }
        this._forgetPath(path);
        this._invalidate(parentOf(path));
      }
      this.selection = new Set();
      this.focusPath = null;
      await this.render();
      if (failed.length) this._toast(`部分删除失败：${failed.join('；')}`, 'error');
      else this._toast(targets.length === 1 ? `已删除「${names[0]}」` : `已删除 ${targets.length} 个项目`, 'success');
    }

    /** Move the current drag payload into `destDir`. */
    async _moveInto(destDir) {
      const paths = (this._dragPaths || []).slice();
      this._dragPaths = null;
      document.querySelectorAll('.ws-node.is-dragging, .ws-node.is-drop-target')
        .forEach((el) => el.classList.remove('is-dragging', 'is-drop-target'));
      if (!paths.length || !this.fs.rename) return;
      if (!destDir || !isInside(destDir, this.rootPath)) return;

      let moved = 0;
      const skipped = [];
      for (const path of paths) {
        if (norm(parentOf(path)) === norm(destDir)) continue;      // already there
        if (isInside(destDir, path)) { skipped.push(`${baseName(path)}（不能移动到自身内部）`); continue; }
        const next = joinPath(destDir, baseName(path));
        if (await this._pathExists(next)) { skipped.push(`${baseName(path)}（同名已存在）`); continue; }
        try {
          await this.fs.rename(path, next);
        } catch (e) {
          skipped.push(`${baseName(path)}（${e && e.message ? e.message : e}）`);
          continue;
        }
        this._afterMove(path, next);
        this._invalidate(parentOf(path));
        moved += 1;
      }
      this._invalidate(destDir);
      this.treeState[destDir] = true;
      await this.render();
      if (moved) {
        this._toast(moved === 1 ? '已移动 1 个项目' : `已移动 ${moved} 个项目`, 'success');
      }
      if (skipped.length) this._toast(`跳过：${skipped.join('；')}`, 'error');
    }

    /**
     * Everything that has to follow a file to its new name: open tabs, expansion
     * state, selection, the recent list. Miss one and the panel starts pointing at
     * paths that no longer exist.
     */
    _afterMove(oldPath, newPath) {
      this.docs.forEach((d) => {
        if (!d.path) return;
        const moved = rewritePath(d.path, oldPath, newPath);
        if (moved) { d.path = moved; d.name = baseName(moved); }
      });
      const active = this.docs[this.active];
      if (active) {
        this.editor.docName = active.name;
        const nameInput = document.getElementById('docNameInput');
        if (nameInput) nameInput.value = active.name;
      }
      const nextState = {};
      Object.keys(this.treeState).forEach((k) => {
        nextState[rewritePath(k, oldPath, newPath) || k] = this.treeState[k];
      });
      this.treeState = nextState;
      this.selection = new Set([...this.selection].map((p) => rewritePath(p, oldPath, newPath) || p));
      if (this.focusPath) this.focusPath = rewritePath(this.focusPath, oldPath, newPath) || this.focusPath;
      this._repairRecent(oldPath, newPath);
    }

    /** Drop a deleted path from the tab list, the tree state and the recent list. */
    _forgetPath(path) {
      const doomed = this.docs
        .map((d, i) => (d.path && isInside(d.path, path) ? i : -1))
        .filter((i) => i >= 0)
        .reverse();
      if (doomed.length) {
        doomed.forEach((i) => this.docs.splice(i, 1));
        if (!this.docs.length) {
          this.active = -1;
          this._clearEditor();
        } else {
          this.active = Math.max(0, Math.min(this.active, this.docs.length - 1));
          const d = this.docs[this.active];
          this.editor.docName = d.name;
          const nameInput = document.getElementById('docNameInput');
          if (nameInput) nameInput.value = d.name;
          this.editor.resetCalloutToggles && this.editor.resetCalloutToggles();
          this.editor.setContent(d.content, false);
        }
      }
      Object.keys(this.treeState).forEach((k) => { if (isInside(k, path)) delete this.treeState[k]; });
      [...this.selection].forEach((p) => { if (isInside(p, path)) this.selection.delete(p); });
      const list = this._recent().filter((p) => !isInside(p, path));
      try {
        global.localStorage && global.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      } catch (e) { /* convenience only */ }
    }

    // ---- context menu --------------------------------------------------------

    _menuItemsFor(node) {
      const items = [];
      const isRoot = node && node.isRoot;
      if (isRoot) {
        items.push({ label: '新建文件', action: () => this._beginCreate(null, false) });
        items.push({ label: '新建文件夹', action: () => this._beginCreate(null, true) });
        items.push({ sep: true });
        items.push({ label: '刷新', action: () => this.refresh() });
        items.push({ label: '全部折叠', action: () => this.collapseAll() });
        items.push({ sep: true });
        items.push({ label: '在文件管理器中显示', action: () => this._revealInSystem(node.path) });
        items.push({ label: '复制路径', action: () => this._copyPath(node.path) });
        return items;
      }
      if (!node) {
        items.push({ label: '新建文件', action: () => this._beginCreate(null, false) });
        items.push({ label: '新建文件夹', action: () => this._beginCreate(null, true) });
        items.push({ sep: true });
        items.push({ label: '刷新', action: () => this.refresh() });
        items.push({ label: '全部折叠', action: () => this.collapseAll() });
        return items;
      }

      const many = this.selection.size > 1 && this.selection.has(node.path);
      if (node.isDir) {
        items.push({ label: '新建文件', action: () => this._beginCreate(node.path, false) });
        items.push({ label: '新建文件夹', action: () => this._beginCreate(node.path, true) });
        items.push({ sep: true });
        items.push({ label: '展开', action: () => { this.treeState[node.path] = true; this.renderTree(); } });
        items.push({ label: '折叠', action: () => { this.treeState[node.path] = false; this.renderTree(); } });
      } else {
        items.push({ label: '打开', action: () => this.openPath(node.path) });
      }
      items.push({ sep: true });
      if (!many) items.push({ label: '重命名', hint: 'F2', action: () => this._beginRename() });
      items.push({ label: many ? `删除 ${this.selection.size} 个项目` : '删除', hint: 'Del', danger: true, action: () => this._deleteSelection() });
      items.push({ sep: true });
      if (this.fs.revealInDir) {
        items.push({ label: '在文件管理器中显示', action: () => this._revealInSystem(node.path) });
      }
      items.push({ label: '复制路径', action: () => this._copyPath(node.path) });
      return items;
    }

    _showMenu(x, y, items) {
      this._closeMenu();
      const menu = document.createElement('div');
      menu.className = 'ws-menu';
      menu.setAttribute('role', 'menu');
      items.filter(Boolean).forEach((it) => {
        if (it.sep) {
          const sep = document.createElement('div');
          sep.className = 'ws-menu-sep';
          menu.appendChild(sep);
          return;
        }
        const el = document.createElement('div');
        el.className = 'ws-menu-item' + (it.danger ? ' is-danger' : '');
        el.setAttribute('role', 'menuitem');
        el.tabIndex = -1;
        const label = document.createElement('span');
        label.textContent = it.label;
        el.appendChild(label);
        if (it.hint) {
          const hint = document.createElement('span');
          hint.className = 'ws-menu-hint';
          hint.textContent = it.hint;
          el.appendChild(hint);
        }
        el.onclick = () => { this._closeMenu(); it.action(); };
        menu.appendChild(el);
      });
      document.body.appendChild(menu);
      // Keep it on screen: menus opened near the bottom/right edge would otherwise
      // hang off the window, which the webview does not scroll back into view.
      const rect = menu.getBoundingClientRect();
      const left = Math.min(x, global.innerWidth - rect.width - 4);
      const top = Math.min(y, global.innerHeight - rect.height - 4);
      menu.style.left = `${Math.max(4, left)}px`;
      menu.style.top = `${Math.max(4, top)}px`;
      this._menu = menu;

      const focusables = [...menu.querySelectorAll('.ws-menu-item')];
      if (focusables[0]) focusables[0].focus();
      menu.onkeydown = (e) => {
        const at = focusables.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (focusables[at + 1] || focusables[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (focusables[at - 1] || focusables[focusables.length - 1]).focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); this._closeMenu(); }
        else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); focusables[at].click(); }
        e.stopPropagation();
      };

      // Any click elsewhere, or a scroll inside the tree, invalidates the anchor point.
      const away = (ev) => { if (!menu.contains(ev.target)) this._closeMenu(); };
      this._menuAway = away;
      setTimeout(() => {
        document.addEventListener('mousedown', away, true);
        document.addEventListener('wheel', away, { capture: true, passive: true });
        global.addEventListener('blur', away);
      }, 0);
    }

    _closeMenu() {
      if (!this._menu) return;
      this._menu.remove();
      this._menu = null;
      if (this._menuAway) {
        document.removeEventListener('mousedown', this._menuAway, true);
        document.removeEventListener('wheel', this._menuAway, { capture: true });
        global.removeEventListener('blur', this._menuAway);
        this._menuAway = null;
      }
    }

    // ---- misc operations -----------------------------------------------------

    async refresh() {
      const dir = this.rootPath;
      if (!dir) return;
      this._invalidate();
      await this.render();
    }

    collapseAll() {
      this.treeState = this.rootPath ? { [this.rootPath]: true } : {};
      this.renderTree();
    }

    async _revealInSystem(path) {
      if (!this.fs.revealInDir) return;
      try {
        await this.fs.revealInDir(path);
      } catch (e) {
        this._toast(`无法在文件管理器中显示：${e && e.message ? e.message : e}`, 'error');
      }
    }

    async _copyPath(path) {
      try {
        if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
          await global.navigator.clipboard.writeText(path);
        } else {
          throw new Error('no clipboard api');
        }
      } catch (e) {
        // The webview can refuse clipboard access; a temporary textarea still works and
        // is the difference between "copied" and "nothing happened".
        try {
          const ta = document.createElement('textarea');
          ta.value = path;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        } catch (err) {
          this._toast('复制失败', 'error');
          return;
        }
      }
      this._toast('已复制路径', 'success');
    }

    _repairRecent(oldPrefix, newPrefix) {
      const list = this._recent();
      const next = list.map((p) => rewritePath(p, oldPrefix, newPrefix) || p);
      try {
        global.localStorage && global.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch (e) { /* convenience only */ }
      this.renderRecent();
    }

    // ---- DOM -----------------------------------------------------------------

    _buildDom() {
      if (document.getElementById('workspacePanel')) return;
      const pane = document.getElementById('editorPane');
      if (!pane) return;

      const panel = document.createElement('aside');
      panel.id = 'workspacePanel';
      panel.className = 'workspace-panel';
      panel.innerHTML = `
        <div class="ws-head">
          <span class="ws-title">资源管理器</span>
          <button class="ws-btn" id="wsNewFile" title="新建文件"></button>
          <button class="ws-btn" id="wsNewDir" title="新建文件夹"></button>
          <button class="ws-btn" id="wsRefresh" title="刷新"></button>
          <button class="ws-btn" id="wsMore" title="更多操作">⋯</button>
        </div>
        <div class="ws-filter-row">
          <input type="text" id="wsFilter" class="ws-filter" placeholder="按文件名过滤" spellcheck="false" autocomplete="off">
        </div>
        <div class="ws-tree" id="wsTree" tabindex="0" role="tree" aria-label="文件树"></div>
        <div class="ws-sec">最近打开</div>
        <div class="ws-recent" id="wsRecent"></div>`;
      pane.parentNode.insertBefore(panel, pane);

      // The drag handle is a flex item between the panel and the editor, not a child
      // of the panel: the panel clips its overflow (`overflow: hidden` is what keeps
      // the tree from spilling out), which would also clip a handle hanging off its
      // edge — and a handle inside it would sit on top of the tree's scrollbar.
      const resizer = document.createElement('div');
      resizer.className = 'ws-resizer';
      resizer.title = '拖动调整宽度，双击复位';
      pane.parentNode.insertBefore(resizer, pane);

      const tabs = document.createElement('div');
      tabs.id = 'workspaceTabs';
      tabs.className = 'ws-tabs';
      pane.insertBefore(tabs, pane.firstChild);

      // 空状态浮层。挂在 .editor-wrapper 上（它是 position: relative），这样只盖住
      // 编辑区正文，不挡上面的文件名与查找栏。内容是写死的字面量，没有插值。
      const wrapper = pane.querySelector('.editor-wrapper');
      if (wrapper) {
        const mark = document.createElement('div');
        mark.id = 'wsWatermark';
        mark.className = 'ws-watermark';
        mark.hidden = true;
        mark.innerHTML = `
          <div class="ws-watermark-icon"></div>
          <div class="ws-watermark-title">没有打开的文件</div>
          <div class="ws-watermark-actions">
            <button type="button" class="ws-watermark-btn" id="wsWmNew">新建文件</button>
            <button type="button" class="ws-watermark-btn" id="wsWmOpenFile">打开文件…</button>
            <button type="button" class="ws-watermark-btn" id="wsWmOpenDir">打开文件夹…</button>
          </div>
          <div class="ws-watermark-hint">在左侧文件树里单击文件即可打开，<kbd>Ctrl</kbd>+<kbd>S</kbd> 写回原文件</div>`;
        mark.querySelector('.ws-watermark-icon').appendChild(makeIcon('doc', null, 'ws-svg-watermark'));
        mark.querySelector('#wsWmNew').onclick = () => this.newTab();
        mark.querySelector('#wsWmOpenFile').onclick = () => this.openFileDialog();
        mark.querySelector('#wsWmOpenDir').onclick = () => this.openFolderDialog();
        wrapper.appendChild(mark);
      }

      // Toolbar icons: same SVG factory as the tree, so the panel has one visual voice.
      document.getElementById('wsNewFile').appendChild(makeIcon('newFile', null, 'ws-svg-btn'));
      document.getElementById('wsNewDir').appendChild(makeIcon('newDir', null, 'ws-svg-btn'));
      document.getElementById('wsRefresh').appendChild(makeIcon('refresh', null, 'ws-svg-btn'));

      document.getElementById('wsNewFile').onclick = () => this._beginCreate(this.focusPath, false);
      document.getElementById('wsNewDir').onclick = () => this._beginCreate(this.focusPath, true);
      document.getElementById('wsRefresh').onclick = () => this.refresh();
      document.getElementById('wsMore').onclick = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this._showMenu(r.left - 130, r.bottom + 2, [
          { label: '打开文件夹…', action: () => this.openFolderDialog() },
          { label: '打开文件…', action: () => this.openFileDialog() },
          { sep: true },
          { label: '新建标签页', action: () => this.newTab() },
          { label: '刷新', action: () => this.refresh() },
          { label: '全部折叠', action: () => this.collapseAll() },
        ]);
      };

      const filter = document.getElementById('wsFilter');
      let debounce = null;
      filter.oninput = () => {
        // Light debounce: the tree walk reads directories, and typing is faster than
        // the disk on a cold cache.
        clearTimeout(debounce);
        debounce = setTimeout(() => { this.filter = filter.value.trim(); this.renderTree(); }, 120);
      };
      filter.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { filter.value = ''; this.filter = ''; this.renderTree(); filter.blur(); }
        if (e.key === 'ArrowDown') { this._step(1); const t = document.getElementById('wsTree'); t && t.focus(); }
      };

      const tree = document.getElementById('wsTree');
      tree.addEventListener('keydown', (e) => this._onTreeKeyDown(e));
      // Clicking the blank area below the rows clears the selection, like VS Code.
      tree.addEventListener('mousedown', (e) => {
        if (e.target === tree) { this._clearSelection(); this.focusPath = null; }
      });
      tree.oncontextmenu = (e) => {
        if (e.target !== tree) return;
        e.preventDefault();
        this._showMenu(e.clientX, e.clientY, this._menuItemsFor(null));
      };
      // Dropping on the blank area means "move to the workspace root".
      tree.ondragover = (e) => {
        if (!this._dragPaths || e.target !== tree) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      };
      tree.ondrop = (e) => {
        if (!this._dragPaths || e.target !== tree) return;
        e.preventDefault();
        this._moveInto(this.rootPath);
      };

      this._bindResizer(panel, resizer);
      const stored = Number(global.localStorage && global.localStorage.getItem(WIDTH_KEY));
      if (stored) panel.style.flexBasis = `${Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, stored))}px`;
      document.documentElement.classList.add('has-workspace');
    }

    _bindResizer(panel, handle) {
      let startX = 0;
      let startW = 0;
      const onMove = (e) => {
        const w = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, startW + (e.clientX - startX)));
        panel.style.flexBasis = `${w}px`;
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.classList.remove('ws-resizing');
        const w = parseInt(panel.style.flexBasis, 10);
        try { global.localStorage && global.localStorage.setItem(WIDTH_KEY, String(w)); } catch (e) { /* ignore */ }
      };
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = panel.getBoundingClientRect().width;
        document.body.classList.add('ws-resizing');
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
      handle.addEventListener('dblclick', () => {
        panel.style.flexBasis = `${WIDTH_DEFAULT}px`;
        try { global.localStorage && global.localStorage.setItem(WIDTH_KEY, String(WIDTH_DEFAULT)); } catch (e) { /* ignore */ }
      });
    }

    renderTabs() {
      const bar = document.getElementById('workspaceTabs');
      if (!bar) return;
      bar.textContent = '';
      this.docs.forEach((d, i) => {
        const el = document.createElement('div');
        el.className = 'ws-tab' + (i === this.active ? ' is-active' : '')
          + (d.dirty ? ' is-dirty' : '');
        el.setAttribute('data-tab-index', String(i));
        el.title = d.path || d.name;
        const label = document.createElement('span');
        label.className = 'ws-tab-name';
        label.textContent = d.name;
        el.appendChild(label);
        // The dot doubles as the close button, the way most editors do it.
        const close = document.createElement('button');
        close.className = 'ws-tab-close';
        close.setAttribute('aria-label', '关闭');
        close.textContent = d.dirty ? '●' : '×';
        close.onclick = (e) => { e.stopPropagation(); this.closeTab(i); };
        el.appendChild(close);
        el.onclick = () => this.activate(i);
        bar.appendChild(el);
      });
    }

    renderRecent() {
      const host = document.getElementById('wsRecent');
      if (!host) return;
      host.textContent = '';
      const list = this._recent();
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'ws-empty';
        empty.textContent = '暂无记录';
        host.appendChild(empty);
        return;
      }
      list.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'ws-node';
        row.setAttribute('data-recent', p);
        row.title = p;
        const icon = document.createElement('span');
        icon.className = 'ws-icon';
        const k = kindOf(p);
        icon.appendChild(makeIcon(k.glyph, k.kind, 'ws-svg-file'));
        row.appendChild(icon);
        const name = document.createElement('span');
        name.className = 'ws-node-name';
        name.textContent = baseName(p);
        row.appendChild(name);
        row.onclick = () => this.openPath(p);
        host.appendChild(row);
      });
    }

    async render() {
      this.renderTabs();
      this.renderRecent();
      // 同步做、不等 renderTree：关掉最后一个标签页时，编辑区应当立刻反应。
      this._applyEmptyState();
      await this.renderTree();
    }

    // ---- recent list ---------------------------------------------------------

    _recent() {
      try {
        const raw = global.localStorage && global.localStorage.getItem(RECENT_KEY);
        const v = raw ? JSON.parse(raw) : [];
        return Array.isArray(v) ? v : [];
      } catch (e) { return []; }
    }

    _pushRecent(path) {
      if (!path) return;
      const list = this._recent().filter((p) => p !== path);
      list.unshift(path);
      try {
        global.localStorage
          && global.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
      } catch (e) { /* storage full or blocked; the list is a convenience only */ }
      this.renderRecent();
    }

    _toast(msg, kind) {
      if (this.editor && this.editor.showToast) this.editor.showToast(msg, kind);
    }
  }

  global.LuoguWorkspace = LuoguWorkspace;
  global.LuoguWorkspace.detectHost = detectHost;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LuoguWorkspace, detectHost };
  }
})(typeof window !== 'undefined' ? window : globalThis);
