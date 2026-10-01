/**
 * i18n 的守卫测试。
 *
 * 这里守的不是"翻译得好不好"，而是几条会让英文模式悄悄坏掉的规则：
 *   1. 每个 T('…') / data-i18n 的键都必须在 src/i18n-en.js 里有条目 ——
 *      否则英文界面会露出中文（用户明确要求不能出现未翻译的漏网之鱼）；
 *   2. 英文值里不能残留中文（少数故意保留的除外）；
 *   3. 插值占位符 {a} 必须原样出现在译文里 —— 漏一个就是运行时 undefined；
 *   4. 未收录的键要回退成中文原文，而不是键名或空串；
 *   5. 切换语言要落盘，并且真的改写 DOM（text / title / aria-label / innerHTML）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ---- 载入被测模块（node 下没有 navigator，detect() 会落到 en）-----------------
const i18n = require(path.join(ROOT, 'src/i18n.js'));
require(path.join(ROOT, 'src/i18n-en.js'));
const EN = i18n.EN;

const SOURCES = [
  'index.html',
  'src/editor.js',
  'src/luogu-workspace.js',
  'src/luogu-linter.js',
  'src/luogu-typora.js',
  'src/luogu-math-cheatsheet.js',
  'src/luogu-templates.js',
];

/** JS 字面量里的转义要还原：查表用的是运行时字符串，不是源码文本。 */
function unescapeJs(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (m, e) => {
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'u') {
      const hex = e[1] === '{' ? e.slice(2, -1) : e.slice(1);
      return String.fromCodePoint(parseInt(hex, 16));
    }
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] || e;
  });
}

const CJK = /[\u4e00-\u9fff]/;

/** 从仓库里抽出所有键：T('…')、T("…")、T(`…`)、data-i18n*="…"。 */
function extractKeys() {
  const found = new Map();          // key → 出现位置
  const record = (key, where) => { if (CJK.test(key) && !found.has(key)) found.set(key, where); };
  for (const rel of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const patterns = [
      [/\bT\(\s*'((?:[^'\\]|\\.)*)'/g, true],
      [/\bT\(\s*"((?:[^"\\]|\\.)*)"/g, true],
      [/T\(\s*`((?:[^`\\]|\\.)*)`/g, true],
      [/data-i18n[a-z-]*="([^"]*)"/g, false],
    ];
    for (const [re, escape] of patterns) {
      for (const m of src.matchAll(re)) {
        const raw = escape ? unescapeJs(m[1]) : m[1];
        // Windows 的 Git 会把文件签出成 CRLF，而词典是按 LF 生成的：这里先归一化，
        // 运行时那边由 i18n.t() 负责同一件事（见 src/i18n.js）。
        const key = raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\r\n?/g, '\n');
        record(key, rel);
      }
    }
  }
  return found;
}

const keys = extractKeys();

/**
 * 少数条目本来就该出现汉字，不能一刀切：
 *   - 语言名用本语言书写（简体中文 / English），换语言时不该被翻译；
 *   - 标点规范那几条，讲的正是中文标点与汉字之间要不要空格，例子本身就是中文；
 *   - 下划线那条要展示 ++文字++ 这个无效写法。
 */
const KEEP_CHINESE_PREFIX = ['简体中文', '《洛谷基本规范第 3 条》', '洛谷渲染器基于 GFM'];
const keepsChinese = (key) => KEEP_CHINESE_PREFIX.some((p) => key.startsWith(p));



test('词典非空，且没有多余条目', () => {
  assert.ok(Object.keys(EN).length > 500, `词典只有 ${Object.keys(EN).length} 条，疑似没加载`);
  const stale = Object.keys(EN).filter((k) => !keys.has(k));
  assert.deepStrictEqual(stale, [], `词典里有已经用不到的键：\n  ${stale.slice(0, 10).join('\n  ')}`);
});

test('每个键都有英文，英文模式下不会漏出中文', () => {
  const missing = [...keys.keys()].filter((k) => !(k in EN));
  assert.deepStrictEqual(missing, [], `这些键没有英文：\n  ${missing.slice(0, 20).join('\n  ')}`);
});

test('英文值里不该残留中文（代码示例与数学排除在外）', () => {
  // 反引号代码片段与 $…$ 公式是"原样展示"的内容，里面出现汉字是正常的。
  const prose = (s) => s
    .replace(/<code>[\s\S]*?<\/code>/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\$[^$]*\$/g, '');
  const bad = Object.entries(EN)
    .filter(([k]) => !keepsChinese(k))
    .filter(([, v]) => CJK.test(prose(v)));
  assert.deepStrictEqual(
    bad.map(([k]) => k),
    [],
    `这些译文里还有中文：\n  ${bad.slice(0, 20).map(([k, v]) => `${k} → ${prose(v)}`).join('\n  ')}`,
  );
});

test('插值占位符在译文里一个都不能少', () => {
  // 只要求"键里的占位符，译文里都得在"：反过来（译文多出 {and} 这种）不算错 ——
  // 模板与公式里 \text{and}、\begin{cases} 的花括号都会被这个正则看见，那不是占位符。
  // 只看"以字母开头的"占位符：公式里的 {2}、{cases} 之类是 LaTeX 花括号，
  // 插值函数不会碰它们（只有 vars 里给了值才替换），不该拿它们判错。
  const placeholders = (s) => [...new Set([...s.matchAll(/\{([A-Za-z]\w*)\}/g)].map((m) => m[1]))].sort();
  const broken = Object.entries(EN)
    .map(([k, v]) => [k, placeholders(k), placeholders(v)])
    .filter(([, want, got]) => !want.every((w) => got.includes(w)));
  assert.deepStrictEqual(
    broken.map(([k, want, got]) => `${k} [${want}] → [${got}]`),
    [],
  );
});

test('带 CRLF 的键也能查到（Windows 签出）', () => {
  const multi = Object.keys(EN).find((k) => k.includes('\n'));
  assert.ok(multi, '词典里应该有含换行的键');
  assert.strictEqual(i18n.t(multi.replace(/\n/g, '\r\n')), EN[multi]);
  // 换行归一化不该把原本就查不到的键变成乱查
  assert.strictEqual(i18n.t('这条还没翻译\r\n第二行'), '这条还没翻译\r\n第二行');
});

test('没收录的键回退成中文原文，而不是键名或空串', () => {
  assert.strictEqual(i18n.t('这条还没翻译'), '这条还没翻译');
  assert.strictEqual(i18n.t('保存'), EN['保存']);
  assert.strictEqual(i18n.t(''), '');
  assert.strictEqual(i18n.t(null), '');
  assert.strictEqual(i18n.t('已保存到「{a}」', { a: 'x.md' }), 'Saved to “x.md”');
  // 占位符没给值时要保留原样，不能变成 undefined
  assert.strictEqual(i18n.t('已保存到「{a}」'), 'Saved to “{a}”');
});

test('切换语言会落盘，并且改写 DOM 的四种挂点', () => {
  const saved = new Map();
  global.localStorage = {
    getItem: (k) => (saved.has(k) ? saved.get(k) : null),
    setItem: (k, v) => saved.set(k, String(v)),
  };
  const el = (attrs = {}) => ({
    _attrs: { ...attrs },
    textContent: '',
    title: '',
    placeholder: '',
    innerHTML: '',
    getAttribute(n) { return this._attrs[n]; },
    setAttribute(n, v) { this._attrs[n] = v; },
  });
  const nodes = [
    el({ 'data-i18n': '保存' }),
    el({ 'data-i18n-title': '保存到本地 (Ctrl+S)' }),
    el({ 'data-i18n-placeholder': '在此输入 Markdown…' }),
    el({ 'data-i18n-aria-label': '切换主题' }),
  ];
  global.document = {
    documentElement: el(),
    querySelectorAll: (sel) => {
      const attr = sel.slice(1, -1);
      return nodes.filter((n) => attr in n._attrs);
    },
  };

  i18n.setLang('zh');
  assert.strictEqual(saved.get(i18n.LANG_KEY), 'zh');
  assert.strictEqual(nodes[0].textContent, '保存', '中文模式下应保持中文原文');
  assert.strictEqual(global.document.documentElement._attrs.lang, 'zh-CN');

  i18n.setLang('en');
  assert.strictEqual(saved.get(i18n.LANG_KEY), 'en');
  assert.strictEqual(nodes[0].textContent, 'Save');
  assert.strictEqual(nodes[1].title, 'Save locally (Ctrl+S)');
  assert.strictEqual(nodes[2].placeholder, 'Type Markdown here…');
  assert.strictEqual(nodes[3]._attrs['aria-label'], 'Switch theme');
  assert.strictEqual(global.document.documentElement._attrs.lang, 'en');

  let notified = null;
  i18n.onChange((lang) => { notified = lang; });
  i18n.setLang('system');
  assert.strictEqual(notified, 'en', 'system 下没有 navigator 时应解析为 en');
  assert.strictEqual(saved.get(i18n.LANG_KEY), 'system', '跟随系统也要记住，好和"手动选过"区分开');

  delete global.document;
  delete global.localStorage;
});

test('繁体与其它中文标签都归到中文，其余归到英文', () => {
  const withNav = (tag) => {
    global.navigator = { language: tag };
    const got = i18n.detect();
    delete global.navigator;
    return got;
  };
  assert.strictEqual(withNav('zh-CN'), 'zh');
  assert.strictEqual(withNav('zh-TW'), 'zh');
  assert.strictEqual(withNav('zh-Hans'), 'zh');
  assert.strictEqual(withNav('en-US'), 'en');
  assert.strictEqual(withNav('ko-KR'), 'en');
});
