/**
 * Workspace: document tabs and a folder tree, in the spirit of Dev-C++.
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
 */
(function (global) {
  'use strict';

  const MAX_RECENT = 12;
  const RECENT_KEY = 'luogu_editor_recent_files';

  /** Detect a host that can actually read and write the user's disk. */
  function detectHost() {
    const t = global.__TAURI__;
    if (!t) return null;
    // Tauri v2 exposes plugins under __TAURI__ when withGlobalTauri is on, but the
    // bundled JS API is the supported path; accept either shape.
    const fs = t.fs || (t.plugins && t.plugins.fs);
    const dialog = t.dialog || (t.plugins && t.plugins.dialog);
    if (!fs || !dialog) return null;
    return {
      readTextFile: (p) => fs.readTextFile(p),
      writeTextFile: (p, c) => fs.writeTextFile(p, c),
      readDir: (p) => fs.readDir(p),
      openFile: (opts) => dialog.open(opts),
      openFolder: () => dialog.open({ directory: true, multiple: false }),
      saveAs: (opts) => dialog.save(opts),
      confirm: (msg) => (dialog.confirm ? dialog.confirm(msg) : Promise.resolve(global.confirm(msg))),
    };
  }

  const sep = (p) => (p.indexOf('\\') >= 0 && p.indexOf('/') < 0 ? '\\' : '/');
  const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
  const joinPath = (dir, name) => dir.replace(/[\\/]+$/, '') + sep(dir) + name;

  class LuoguWorkspace {
    constructor(editor, fsAdapter) {
      this.editor = editor;
      this.fs = fsAdapter || detectHost();
      this.docs = [];           // { path|null, name, content, dirty, saved }
      this.active = -1;
      this.rootPath = null;
      this.treeState = {};      // path -> expanded?
      this.enabled = !!this.fs;
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
        if (now !== d.content) { d.content = now; d.dirty = true; this.renderTabs(); }
      });
    }

    // ---- document model ------------------------------------------------------

    indexOfPath(path) {
      return this.docs.findIndex((d) => d.path && path && d.path === path);
    }

    async openPath(path) {
      const existing = this.indexOfPath(path);
      if (existing >= 0) { this.activate(existing); return; }
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
      this.render();
    }

    async closeTab(i) {
      const d = this.docs[i];
      if (!d) return;
      if (d.dirty) {
        const ok = await this.fs.confirm(`「${d.name}」尚未保存，仍要关闭吗？`);
        if (!ok) return;
      }
      this.docs.splice(i, 1);
      if (!this.docs.length) {
        this.docs.push({ path: null, name: '未命名.md', content: '', dirty: false });
        this.active = 0;
      } else if (this.active >= this.docs.length) {
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

    async saveActive() {
      const d = this.docs[this.active];
      if (!d) return false;
      d.content = this.editor.getContent();
      let path = d.path;
      if (!path) {
        path = await this.fs.saveAs({
          defaultPath: d.name,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
        });
        if (!path) return false;
      }
      try {
        await this.fs.writeTextFile(path, d.content);
      } catch (e) {
        this._toast(`保存失败：${e && e.message ? e.message : e}`, 'error');
        return false;
      }
      d.path = path;
      d.name = baseName(path);
      d.dirty = false;
      this.editor.docName = d.name;
      this._pushRecent(path);
      this.render();
      this._toast(`已保存到「${d.name}」`, 'success');
      return true;
    }

    // ---- folder tree ---------------------------------------------------------

    async openFolderDialog() {
      const dir = await this.fs.openFolder();
      if (!dir) return;
      await this.setRoot(typeof dir === 'string' ? dir : dir.path || String(dir));
    }

    async setRoot(path) {
      this.rootPath = path;
      this.treeState = { [path]: true };
      await this.render();
    }

    async _readDirSorted(path) {
      let items = [];
      try {
        items = await this.fs.readDir(path);
      } catch (e) {
        return [];
      }
      return items
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
          <span class="ws-title">工作区</span>
          <button class="ws-btn" id="wsOpenFolder" title="打开文件夹">📂</button>
          <button class="ws-btn" id="wsOpenFile" title="打开文件">📄</button>
          <button class="ws-btn" id="wsNew" title="新建标签页">＋</button>
        </div>
        <div class="ws-tree" id="wsTree"></div>
        <div class="ws-sec">最近打开</div>
        <div class="ws-recent" id="wsRecent"></div>`;
      pane.parentNode.insertBefore(panel, pane);

      const tabs = document.createElement('div');
      tabs.id = 'workspaceTabs';
      tabs.className = 'ws-tabs';
      pane.insertBefore(tabs, pane.firstChild);

      document.getElementById('wsOpenFolder').onclick = () => this.openFolderDialog();
      document.getElementById('wsOpenFile').onclick = () => this.openFileDialog();
      document.getElementById('wsNew').onclick = () => this.newTab();
      document.documentElement.classList.add('has-workspace');
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

    async renderTree() {
      const host = document.getElementById('wsTree');
      if (!host) return;
      // Rendering the tree is async (each level is a readDir await), so two calls
      // that overlap would both clear the host and then both append — the tree came
      // out duplicated several times over. Stamp each run and let only the newest
      // one touch the DOM.
      const token = (this._treeToken = (this._treeToken || 0) + 1);
      const rows = [];
      if (!this.rootPath) {
        const empty = document.createElement('div');
        empty.className = 'ws-empty';
        empty.textContent = '未打开文件夹';
        rows.push(empty);
      } else {
        rows.push(this._row(baseName(this.rootPath), true, this.rootPath, 0));
        if (this.treeState[this.rootPath]) {
          await this._collectChildren(rows, this.rootPath, 1);
        }
      }
      // A newer render started while this one was awaiting: drop this result.
      if (token !== this._treeToken) return;
      host.textContent = '';
      rows.forEach((r) => host.appendChild(r));
    }

    async _collectChildren(rows, dir, depth) {
      const items = await this._readDirSorted(dir);
      for (const it of items) {
        rows.push(this._row(it.name, it.isDir, it.path, depth));
        if (it.isDir && this.treeState[it.path]) {
          await this._collectChildren(rows, it.path, depth + 1);
        }
      }
    }

    _row(name, isDir, path, depth) {
      const row = document.createElement('div');
      row.className = 'ws-node' + (isDir ? ' is-dir' : '')
        + (this.docs[this.active] && this.docs[this.active].path === path ? ' is-open' : '');
      row.style.paddingLeft = `${6 + depth * 14}px`;
      row.setAttribute('data-path', path);
      row.title = path;
      const icon = document.createElement('span');
      icon.className = 'ws-node-icon';
      icon.textContent = isDir ? (this.treeState[path] ? '▾' : '▸') : '·';
      row.appendChild(icon);
      const label = document.createElement('span');
      label.className = 'ws-node-name';
      label.textContent = name;
      row.appendChild(label);
      row.onclick = () => {
        if (isDir) {
          this.treeState[path] = !this.treeState[path];
          this.renderTree();
        } else {
          this.openPath(path);
        }
      };
      return row;
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
        row.textContent = baseName(p);
        row.onclick = () => this.openPath(p);
        host.appendChild(row);
      });
    }

    async render() {
      this.renderTabs();
      this.renderRecent();
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
