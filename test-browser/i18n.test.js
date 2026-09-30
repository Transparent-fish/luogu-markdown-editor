/**
 * 双语界面：英文模式下界面上到底变成了什么。
 *
 * 单元测试（test/i18n.test.js）守的是词典本身 —— 每个键都有英文、占位符不少。
 * 这里守的是另一头：真的切过去之后，屏幕上那些**渲染时才生成的**文案也换了 ——
 * 标签页名、状态栏、帮助手册、数学公式速查表（它是加载期构建的数组，只 applyDom
 * 不够，必须重建）、排版检查的提示。顺便钉住两条产品约定：首次跟随系统语言、
 * 手动选择之后记住。
 *
 * 注意：本文件**不**把语言钉回中文（其他浏览器套件都钉了）——语言就是被测对象。
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const url = process.argv[2] || 'file://' + path.resolve(__dirname, '..', 'LuoguMarkdownEditor.html');
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  let pass = 0, fail = 0;
  const ck = (c, n, x) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, x || '')); };
  const text = (sel) => p.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? (el.textContent || '').trim() : null;
  }, sel);
  const CJK = /[\u4e00-\u9fff]/;

  // CI 的浏览器报 en-US，第一次打开应当直接是英文界面（跟随系统语言）。
  await p.goto(url, { waitUntil: 'networkidle' });
  ck(await p.evaluate(() => LuoguI18n.current()) === 'en', '首次打开跟随系统语言（en-US → 英文）');
  const SAVE_BTN = 'button[onclick="LuoguEditor.saveMarkdownFile()"] > span';
  ck((await text(SAVE_BTN)) === 'Save', '顶栏按钮已是英文', await text(SAVE_BTN));
  ck(!CJK.test((await text('.app-title + .app-badge')) || ''), '标题旁的徽标已是英文', await text('.app-badge'));
  ck(!CJK.test(await text('.editor-pane .pane-header')), '「MARKDOWN 源代码」面板头无中文');
  ck((await text('html')) !== null && (await p.evaluate(() => document.documentElement.lang)) === 'en',
    'html[lang] 跟着切成 en');

  // ---- 帮助手册：整块 data-i18n-html 的段落 ----
  await p.evaluate(() => LuoguEditor.openModal('helpModal'));
  await p.waitForTimeout(200);
  const helpTitle = await text('#helpModal .modal-title');
  ck(!CJK.test(helpTitle || ''), '帮助手册标题是英文', helpTitle);
  const bodyCJK = await p.evaluate(() => {
    const skip = new Set(['CODE', 'PRE']);
    let n = 0;
    const walk = (el) => {
      for (const node of el.childNodes) {
        if (node.nodeType === 3) { n += (node.textContent.match(/[\u4e00-\u9fff]/g) || []).length; }
        else if (node.nodeType === 1 && !skip.has(node.tagName)) walk(node);
      }
    };
    walk(document.querySelector('#helpModal .modal-body'));
    return n;
  });
  ck(bodyCJK === 0, `帮助手册正文（按钮说明、快捷键、折叠框语法）整体无中文，代码示例除外（残留 ${bodyCJK} 字）`);
  await p.evaluate(() => LuoguEditor.closeModal('helpModal'));

  // ---- 公式速查表：加载期构建，切语言必须重建 ----
  await p.evaluate(() => LuoguEditor.openModal('mathModal'));
  await p.waitForTimeout(400);
  const cheat = await p.evaluate(() =>
    [...document.querySelectorAll('#mathModal .math-category-title, #mathModal .math-item-label')]
      .slice(0, 40).map((e) => e.textContent.trim()).join(' | '));
  const cheatCJK = (cheat.match(/[\u4e00-\u9fff]/g) || []).length;
  ck(cheatCJK === 0, `公式速查表分类与条目均已重建为英文（残留 ${cheatCJK} 字）`, cheat.slice(0, 120));
  await p.evaluate(() => LuoguEditor.closeModal('mathModal'));

  // ---- 排版检查：渲染期拼出来的提示 ----
  await p.evaluate(() => {
    const ta = document.getElementById('editorTextarea');
    ta.value = '中文句末用了半角句号. 还有 中文and英文之间缺空格。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    LuoguEditor.render();
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => LuoguEditor.openModal('linterModal'));
  await p.waitForTimeout(300);
  const lint = await p.evaluate(() => document.getElementById('linterReportBody').textContent.replace(/\s+/g, ' ').trim());
  ck(lint.length > 0 && !CJK.test(lint), '排版检查报告已英文', lint.slice(0, 140));
  const lintTitle = await text('#linterModal .modal-title');
  ck(!CJK.test(lintTitle || ''), '排版报告标题已英文', lintTitle);
  await p.evaluate(() => LuoguEditor.closeModal('linterModal'));

  // ---- 预设模板：整篇是含真实换行的长字符串，Windows 的 CRLF 签出曾经让它查不到表 ----
  const demo = await p.evaluate(() => window.LuoguTemplates.demo);
  const demoCJK = (demo.match(/[\u4e00-\u9fff]/g) || []).length;
  ck(demoCJK === 0, `英文模式下"全特性演示"模板正文是英文（残留 ${demoCJK} 字）`, demo.slice(0, 60));
  ck(/full tour of Luogu Markdown/.test(demo), '模板确实取到了英文版本');
  const cspj = await p.evaluate(() => window.LuoguTemplates.cspj2025);
  ck(!/[\u4e00-\u9fff]/.test(cspj), '英文模式下 CSP-J 试题册模板正文也是英文');

  // ---- 状态栏 / 标签页这类渲染期文案 ----
  const status = await p.evaluate(() => document.getElementById('docStatsText').textContent);
  ck(!CJK.test(status), '状态栏字数统计已英文', status);

  // ---- 切回中文：静态与动态文案都要跟着回来 ----
  await p.evaluate(() => LuoguEditor.setLanguage('zh'));
  await p.waitForTimeout(300);
  ck((await text(SAVE_BTN)) === '保存', '切回中文后按钮回到「保存」', await text(SAVE_BTN));
  ck(CJK.test((await text('#docStatsText')) || ''), '状态栏回到中文', await text('#docStatsText'));
  ck(await p.evaluate(() => document.documentElement.lang) === 'zh-CN', 'html[lang] 回到 zh-CN');
  const marks = await p.evaluate(() => ({
    zh: document.querySelector('#langZhItem > span').textContent,
    en: document.querySelector('#langEnItem > span').textContent,
    sys: document.querySelector('#langSystemItem > span').textContent,
  }));
  ck(marks.zh === '✅' && marks.en === '⬜' && marks.sys === '⬜', '设置菜单的勾选状态正确', JSON.stringify(marks));
  ck(await p.evaluate(() => window.T('保存')) === '保存', 'window.T 在中文下原样返回');

  // ---- 手动选择要记住（file:// 下 localStorage 可能不可用，不可用就跳过这一段）----
  const usable = await p.evaluate(() => {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (e) { return false; }
  });
  if (!usable) {
    console.log('  ⏭️  file:// 下 localStorage 不可用，跳过"记住选择"的重载验证');
  } else {
    await p.evaluate(() => LuoguEditor.setLanguage('en'));
    await p.waitForTimeout(200);
    await p.goto(url, { waitUntil: 'networkidle' });
    ck(await p.evaluate(() => LuoguI18n.current()) === 'en', '重载后记住手动选择的英文');
    await p.evaluate(() => LuoguI18n.setLang('zh'));
  }

  // ---- 英文模式下不该有任何 JS 报错 ----
  ck(errs.length === 0, '全程无 JS 报错', errs.join(' / '));

  console.log(`\ni18n 双语界面 ${pass} 项，失败 ${fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
