/**
 * 桌面版配置必须满足的前提。
 *
 * 这些断言全是"某处少写了一行，桌面版就会静默降级"的类型——面板整个不出现、
 * 右键菜单点了没反应、跟着人走的绿色版把数据存错地方。它们不需要 Rust 工具链，
 * 也不需要浏览器，所以能在 CI 的秒级反馈里跑。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

test('withGlobalTauri 必须为 true，否则工作区面板永远不会出现', () => {
  const conf = readJson('desktop/src-tauri/tauri.conf.json');
  // 前端是通过 window.__TAURI__ 判断"有没有原生文件系统"的（见
  // luogu-workspace.js 的 detectHost）。Tauri v2 里这个全局对象默认不注入，
  // 关掉它不会报任何错，只会让 detectHost() 一直返回 null，于是面板、
  // 标签页、文件树一起消失——桌面版看起来就像"左边什么都没有"。
  assert.strictEqual(
    conf.app.withGlobalTauri, true,
    'app.withGlobalTauri 必须显式为 true（Tauri v2 默认 false）'
  );
});

test('打开 dragDropEnabled，否则拖进来的文件拿不到路径，Ctrl+S 只能另存为', () => {
  const conf = readJson('desktop/src-tauri/tauri.conf.json');
  const win = conf.app.windows[0];
  // WebView 的 HTML5 drop 只给 File 对象，不给路径（`.path` 是 Electron 才有的），
  // 所以关掉原生拖放虽然能让页面里的 HTML5 拖拽工作，却换来"拖进来的文件没有出处"
  // ——保存时只能弹另存为。原生事件带绝对路径，拖进来的文件因此和从文件树打开的
  // 一模一样。
  assert.strictEqual(win.dragDropEnabled, true, 'windows[0].dragDropEnabled 必须为 true');
});

test('既然开了原生拖放，页面里就不能再依赖 HTML5 拖放', () => {
  const src = read('src/luogu-workspace.js');
  // 开原生拖放的代价：Windows 上 WebView 里的 HTML5 拖放会被顶掉。文件树的拖动
  // 因此改成指针事件（_pressRow / _dragMove / _dragUp），一旦有人改回 draggable，
  // Windows 上会静默失灵——这条断言就是拦住那次改动。
  assert.ok(!/draggable\s*=\s*true/.test(src), '文件树不应再使用 HTML5 draggable');
  assert.match(src, /_pressRow\(/, '文件树的拖动应由指针事件驱动');
  assert.match(src, /tauri:\/\/drag-drop/, '应订阅 Tauri 的原生拖放事件');
});

test('文件操作所需的 fs 权限都在 capabilities 里', () => {
  const cap = readJson('desktop/src-tauri/capabilities/default.json');
  const perms = cap.permissions || [];
  for (const need of [
    'fs:allow-read-text-file',   // 打开文件
    'fs:allow-write-text-file',  // 保存 / 新建空文件
    'fs:allow-read-dir',         // 展开目录
    'fs:allow-exists',           // 重名检查
    'fs:allow-mkdir',            // 新建文件夹
    'fs:allow-rename',           // 重命名与拖拽移动
    'fs:allow-remove',           // 删除
  ]) {
    assert.ok(perms.includes(need), `缺少权限 ${need}`);
  }
});

test('"在文件管理器中显示"用的是收窄的 opener 权限，不是整套默认权限', () => {
  const cap = readJson('desktop/src-tauri/capabilities/default.json');
  const perms = cap.permissions || [];
  assert.ok(
    perms.includes('opener:allow-reveal-item-in-dir'),
    '缺少 opener:allow-reveal-item-in-dir'
  );
  // opener:default 还包含 allow-open-url / allow-default-urls：那会让页面能把
  // 任意 http(s) 链接甩给系统浏览器打开。编辑器不需要这个能力。
  assert.ok(!perms.includes('opener:default'), '不要用 opener:default，权限过宽');
});

test('opener 插件在 Rust 侧已注册', () => {
  assert.match(read('desktop/src-tauri/Cargo.toml'), /tauri-plugin-opener\s*=/);
  assert.match(read('desktop/src-tauri/src/main.rs'), /tauri_plugin_opener::init\(\)/);
});

test('打开文件夹时要声明递归读取，否则子目录拿不到写权限', () => {
  const src = read('src/luogu-workspace.js');
  // 对话框只把"它返回的那个路径"加进 fs scope。不带 recursive，scope 就止步于
  // 文件夹本身：树里能看见子目录，却写不进去——新建、重命名、删除全部失败。
  assert.match(
    src,
    /dialog\.open\(\{\s*directory:\s*true,\s*multiple:\s*false,\s*recursive:\s*true\s*\}\)/,
    'openFolder 必须传 recursive: true'
  );
});

test('没有原生文件系统时进入网页版形态：只有标签页，没有文件树', () => {
  // 网页版现在也有多标签（用户要的），但没有可写回的磁盘：文件树、自动保存到文件、
  // 写回原文件这些都得靠 isDesktop 关掉，否则会对着 null 调 fs。
  const { detectHost, LuoguWorkspace } = require('../src/luogu-workspace.js');
  assert.strictEqual(detectHost(), null);
  const ws = new LuoguWorkspace({});
  assert.strictEqual(ws.mode, 'web');
  assert.strictEqual(ws.isDesktop, false);
  assert.strictEqual(ws.enabled, false, '挂载成功前不算启用');
});

test('面板图标不得依赖任何外部资源', () => {
  const src = read('src/luogu-workspace.js');
  // SVG 命名空间常量是唯一合法的 http 字符串——它是标识符，不是请求。
  const withoutNs = src.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
  assert.ok(!/https?:\/\//.test(withoutNs), '不应出现外部资源地址');
  assert.ok(!/@font-face/.test(src), '图标不能靠图标字体，必须是内联 SVG');
  assert.ok(!/@import/.test(src) && !/url\(/.test(src), '不应引入外部样式');
});
