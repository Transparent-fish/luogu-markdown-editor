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

test('关闭 dragDropEnabled，否则文件树的拖拽在 Windows 上不会生效', () => {
  const conf = readJson('desktop/src-tauri/tauri.conf.json');
  const win = conf.app.windows[0];
  // Tauri 默认接管 webview 的拖放以产生自己的 DragDropEvent，官方文档写明
  // "Disabling it is required to use HTML5 drag and drop on the frontend on Windows
  // since we replace the drag drop handler of WebView2"。不关掉，页面里 draggable
  // 的元素（文件树的行）在 Windows 上根本拖动不了。
  // 代价是没有原生拖放事件，但编辑器"把文件拖进窗口打开"本来监听的就是标准
  // HTML5 drop 事件（见 src/editor.js），关掉之后走的就是浏览器原生路径。
  assert.strictEqual(win.dragDropEnabled, false, 'windows[0].dragDropEnabled 必须为 false');
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

test('没有原生文件系统时，工作区面板不得启用', () => {
  // 网页版靠这条保持"左侧什么都没有"的原状：detectHost 拿不到宿主就返回 null。
  const { detectHost, LuoguWorkspace } = require('../src/luogu-workspace.js');
  assert.strictEqual(detectHost(), null);
  assert.strictEqual(new LuoguWorkspace({}).enabled, false);
});

test('面板图标不得依赖任何外部资源', () => {
  const src = read('src/luogu-workspace.js');
  // SVG 命名空间常量是唯一合法的 http 字符串——它是标识符，不是请求。
  const withoutNs = src.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
  assert.ok(!/https?:\/\//.test(withoutNs), '不应出现外部资源地址');
  assert.ok(!/@font-face/.test(src), '图标不能靠图标字体，必须是内联 SVG');
  assert.ok(!/@import/.test(src) && !/url\(/.test(src), '不应引入外部样式');
});
