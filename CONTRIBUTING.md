# 参与贡献

欢迎提交 Issue 与 Pull Request。

## 本地开发

```bash
npm install                 # 仅用于取 KaTeX / Prism 资源与跑测试
node build-standalone.js    # 构建单文件产物 LuoguMarkdownEditor.html
node --test test/           # 运行测试
python3 app.py              # 本地起服务（仅本机可访问）
```

开发时请直接改 `src/` 下的源码，**不要**改 `LuoguMarkdownEditor.html`——
它是构建产物，且未纳入版本库（发布时由 CI 生成并上传到 Release）。

## 项目结构

| 路径 | 说明 |
|---|---|
| `index.html` | 开发用外壳，引用 `src/` 与 `assets/` |
| `src/luogu-parser.js` | Markdown + KaTeX 解析渲染 |
| `src/luogu-linter.js` | 洛谷规范检查与排版自动修复 |
| `src/editor.js` | 编辑器交互、滚动同步、导入导出 |
| `src/styles.css` | 全部样式（含打印/PDF 配色） |
| `build-standalone.js` | 把上述内容内联成单文件 |
| `test/` | Node 内置测试 |
| `test-browser/` | Playwright 套件，针对构建产物在真实浏览器里跑 |
| `desktop/` | Tauri 外壳（Rust）。前端就是构建产物，别在这里改界面 |
| `src/luogu-workspace.js` | 桌面版的工作区：标签页 + 资源管理器（文件树） |
| `test/desktop-config.test.js` | 守住桌面版配置前提（`withGlobalTauri`、权限、拖放开关） |

桌面包一层外壳时请记住：**界面永远不属于 `desktop/`**。它只提供窗口、文件关联与
原生文件读写，前端一律来自 `node build-standalone.js` 的产物。要改编辑器行为，
改 `src/`，三端一起变。

### 桌面版的三个静默失效点

这三处配错都不会报错，只会让功能悄悄消失，所以都有测试守着
（`test/desktop-config.test.js`，在 `node --test test/` 里跑，不需要 Rust 工具链）：

| 配置 | 配错的后果 |
| :--- | :--- |
| `app.withGlobalTauri` | 必须为 `true`。前端靠 `window.__TAURI__` 判断有没有原生文件系统；Tauri v2 默认**不注入**，于是 `detectHost()` 永远是 null，整个工作区面板（含文件树）都不出现 |
| `windows[0].dragDropEnabled` | 必须为 `true`。原生拖放事件带**绝对路径**，拖进来的文件才能写回原文件（HTML5 drop 只给 File 对象，没有路径）。代价是 Windows 上页面内 HTML5 拖拽失效，所以文件树的拖动用指针事件实现——别改回 `draggable` |
| `capabilities` 里的 `fs:allow-*` | 少一条，对应操作在点击时才失败。`fs:allow-rename` 是新旧文件树交互都依赖的一条 |

另外，打开文件夹时必须传 `recursive: true`：对话框只把**它返回的那个路径**加进文件系统
作用域，不带这个参数，子目录只能读不能写——树里看得见，一改名就报错。

## 提交要求

1. **带测试**。解析或排版行为的改动请在 `test/parser.test.js` 补用例。
2. **CI 必须通过**。CI 会校验测试、构建可重复、产物完全离线
   （不得引入任何 CDN 引用）、`index.html` 保持精简。
3. **注释写"为什么"**。代码本身已说明"做了什么"，注释请解释动机——
   尤其是绕过某个坑的地方，否则后人很容易"顺手改回去"。
4. **版本号别手改单处**。它写在 `package.json`、`desktop/src-tauri/tauri.conf.json`
   和 `desktop/src-tauri/Cargo.toml` 三处，用 `node scripts/bump-version.js <版本号>`
   一次改齐，CI 会校验一致性。
5. 渲染行为以[洛谷官方 Markdown 说明](https://help.luogu.com.cn/rules/academic/handbook/markdown)
   为准；与 CommonMark 冲突时以洛谷为准，并在注释中说明。

## 安全相关

涉及安全的问题请勿公开提交，见 [SECURITY.md](SECURITY.md)。
