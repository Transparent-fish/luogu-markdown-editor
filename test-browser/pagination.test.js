/**
 * Paging markers: `:::Pagination`, `:::Header[..]`, `:::Footer[..]`.
 *
 * These produce no article content — they steer the paged outputs. The mechanism is
 * CSS named pages (`@page name { @top-center { content: ... } }` plus `page: name`
 * on a wrapper), chosen because Chromium repeats those margin boxes on EVERY page a
 * section spans, which neither a `position: fixed` element nor a repeating <thead>
 * can do per-section.
 *
 * Everything the export mutates must also be undone: the live preview has to look
 * untouched afterwards.
 */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const APP = process.argv[2]
    || 'file://' + path.resolve(__dirname, '..', 'LuoguMarkdownEditor.html');
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ck = (c, n, x) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, x || '')); };

  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);

  const setDoc = async (md) => {
    await p.evaluate((v) => {
      const ta = document.getElementById('editorTextarea');
      ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true }));
      LuoguEditor.render(); LuoguEditor.setViewMode('preview');
    }, md);
    await p.waitForTimeout(700);
  };

  // ---- parsing ---------------------------------------------------------------
  await setDoc(':::Header[甲页眉]\n:::Footer[甲页脚]\n\n正文一。\n\n:::Pagination\n\n:::Header[乙页眉]\n\n正文二。');
  let info = await p.evaluate(() => ({
    breaks: document.querySelectorAll('[data-page-break]').length,
    headers: [...document.querySelectorAll('[data-page-header]')].map((e) => e.getAttribute('data-page-header')),
    footers: [...document.querySelectorAll('[data-page-footer]')].map((e) => e.getAttribute('data-page-footer')),
    sections: LuoguEditor._pageSections(document.getElementById('previewContent')).length,
    hasPagination: LuoguEditor.hasPagination(),
  }));
  ck(info.breaks === 1, '识别 :::Pagination', String(info.breaks));
  ck(JSON.stringify(info.headers) === '["甲页眉","乙页眉"]', '识别 :::Header', JSON.stringify(info.headers));
  ck(JSON.stringify(info.footers) === '["甲页脚"]', '识别 :::Footer', JSON.stringify(info.footers));
  ck(info.sections === 2, '切成 2 个区块', String(info.sections));
  ck(info.hasPagination, 'hasPagination() 为真');

  // Markers must not leak into the article as literal text.
  ck(await p.evaluate(() => !/:::(Pagination|Header|Footer)/i.test(
    document.getElementById('previewContent').textContent)), '标记不以原文泄漏');

  await setDoc('没有任何标记的普通文档。');
  ck(await p.evaluate(() => LuoguEditor.hasPagination() === false), '无标记时 hasPagination() 为假');
  ck(await p.evaluate(() =>
    LuoguEditor._pageSections(document.getElementById('previewContent')).length === 1),
    '无标记时视为单区块');

  // ---- generated @page CSS ---------------------------------------------------
  await setDoc(':::Header[标题]\n:::Footer[第 {page} 页 / 共 {pages} 页]\n\n甲。\n\n:::Pagination\n\n:::Header[次]\n\n乙。');
  const css = await p.evaluate(() => {
    const r = LuoguEditor._applyPagination(document.getElementById('previewContent'), 'tp');
    const out = {
      css: r.css, count: r.count,
      sections: document.querySelectorAll('.luogu-page-section').length,
      names: [...document.querySelectorAll('.luogu-page-section')].map((s) => s.style.page),
      breakBefore: [...document.querySelectorAll('.luogu-page-section')].map((s) => s.style.breakBefore),
      leftoverBreaks: document.querySelectorAll('[data-page-break]').length,
      styleTags: document.querySelectorAll('style[data-pagination]').length,
    };
    window.__undo = r.undo;
    return out;
  });
  ck(css.count === 2 && css.sections === 2, '生成 2 个分页 section', JSON.stringify(css));
  ck(JSON.stringify(css.names) === '["tp0","tp1"]', 'section 绑定具名 page', JSON.stringify(css.names));
  ck(css.breakBefore[0] !== 'page' && css.breakBefore[1] === 'page',
    '仅从第二个区块起强制分页', JSON.stringify(css.breakBefore));
  ck(/@page tp0 \{[^}]*@top-center \{ content: "标题"/.test(css.css), '页眉写入 @top-center', css.css.slice(0, 90));
  ck(/counter\(page\)/.test(css.css) && /counter\(pages\)/.test(css.css),
    '{page}/{pages} 转为实时计数器', css.css);
  ck(css.leftoverBreaks === 0, '分页符本身不进入成品');
  ck(css.styleTags === 1, '注入一份 @page 样式');

  // ---- the preview must be restored exactly ----------------------------------
  const before = await p.evaluate(() => document.getElementById('previewContent').children.length);
  const after = await p.evaluate(() => {
    window.__undo();
    return {
      sections: document.querySelectorAll('.luogu-page-section').length,
      styleTags: document.querySelectorAll('style[data-pagination]').length,
      breaks: document.querySelectorAll('[data-page-break]').length,
      kids: document.getElementById('previewContent').children.length,
    };
  });
  ck(after.sections === 0 && after.styleTags === 0, '撤销后 section 与样式均已移除', JSON.stringify(after));
  ck(after.breaks === 1, '撤销后分页符回到 DOM', String(after.breaks));
  ck(after.kids > 0, '撤销后预览区内容仍在', String(after.kids));

  // ---- escaping into a CSS string --------------------------------------------
  await setDoc(':::Header[引号" 反斜杠\\ 结束]\n\n正文。');
  const esc = await p.evaluate(() => {
    const r = LuoguEditor._applyPagination(document.getElementById('previewContent'), 'esc');
    const c = r.css; r.undo(); return c;
  });
  ck(/\\"/.test(esc) && /\\\\/.test(esc), '页眉中的引号与反斜杠已转义', esc.slice(0, 120));
  ck(await p.evaluate(() => document.querySelectorAll('style[data-pagination]').length === 0),
    '转义用例后样式已清理');

  // ---- long-image export splits per section ----------------------------------
  await setDoc(':::Header[一]\n\n# 甲\n\n' + Array.from({ length: 25 }, (_, i) => `甲第 ${i} 行。`).join('\n\n')
    + '\n\n:::Pagination\n\n# 乙\n\n' + Array.from({ length: 25 }, (_, i) => `乙第 ${i} 行。`).join('\n\n'));
  await p.evaluate(() => {
    window.__pngs = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && /\.png$/.test(this.download)) window.__pngs.push(this.download);
    };
  });
  await p.evaluate(() => LuoguEditor.exportImage());
  await p.waitForFunction(() => window.__pngs && window.__pngs.length >= 2, { timeout: 120000 });
  await p.waitForTimeout(900);
  const pngs = await p.evaluate(() => window.__pngs);
  ck(pngs.length === 2, '按分页导出 2 张 PNG', JSON.stringify(pngs));
  ck(pngs.every((n, i) => n.endsWith(`-${i + 1}.png`)), '文件名带序号', JSON.stringify(pngs));
  ck(await p.evaluate(() => [...document.getElementById('previewContent').children]
    .every((c) => c.style.display !== 'none')), '分页出图后没有残留隐藏块');

  // A document without markers still yields exactly one image.
  await setDoc('# 只有一节\n\n正文。');
  await p.evaluate(() => { window.__pngs = []; });
  await p.evaluate(() => LuoguEditor.exportImage());
  await p.waitForFunction(() => window.__pngs && window.__pngs.length >= 1, { timeout: 120000 });
  await p.waitForTimeout(700);
  ck(await p.evaluate(() => window.__pngs.length === 1
    && !/-1\.png$/.test(window.__pngs[0])), '无分页时仍为单张、不加序号',
    JSON.stringify(await p.evaluate(() => window.__pngs)));

  // ---- toolbar inserts --------------------------------------------------------
  {
    const setSrc = async (v, caretEnd) => {
      await p.evaluate(([t, c]) => {
        const ta = document.getElementById('editorTextarea');
        ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
        if (c) ta.setSelectionRange(ta.value.length, ta.value.length);
      }, [v, !!caretEnd]);
      await p.waitForTimeout(220);
    };
    const src = () => p.evaluate(() => document.getElementById('editorTextarea').value);

    for (const [fn, re_, label] of [
      ['insertPagination', /^\s*:::Pagination\s*$/m, '分页符'],
      ['insertPageHeader', /^\s*:::Header\[页眉文字\]\s*$/m, '页眉'],
      ['insertPageFooter', /^\s*:::Footer\[第 \{page\} 页 \/ 共 \{pages\} 页\]\s*$/m, '页脚（预填页码）'],
    ]) {
      await setSrc('');
      await p.evaluate((f) => LuoguEditor[f](), fn);
      await p.waitForTimeout(260);
      ck(re_.test(await src()), `工具栏插入${label}`, JSON.stringify(await src()));
    }

    // A marker glued to preceding text would stop being a leaf directive.
    await setSrc('前面一段文字。', true);
    await p.evaluate(() => LuoguEditor.insertPagination());
    await p.waitForTimeout(300);
    ck(/^\s*:::Pagination\s*$/m.test(await src()), '接在正文后仍独占一行',
      JSON.stringify(await src()));

    // End to end: what the button inserts must be what the parser understands.
    await p.evaluate(() => { LuoguEditor.render(); LuoguEditor.setViewMode('preview'); });
    await p.waitForTimeout(600);
    ck(await p.evaluate(() => document.querySelectorAll('[data-page-break]').length === 1),
      '插入的标记能被解析器识别');

    for (const fn of ['insertPagination', 'insertPageHeader', 'insertPageFooter']) {
      ck(await p.evaluate((x) => !!document.querySelector(`[onclick*="${x}"]`), fn),
        `工具栏存在 ${fn} 入口`);
    }
  }

  // ---- NOI / tuack print theme -----------------------------------------------
  {
    await setDoc('# 挑战 NPC\n\n## 【输入格式】\n\n从文件读入。\n\n```plain\n3\n1 2\n```\n\n'
      + '::cute-table{tuack}\n\n| 测试点 | $n\\le$ |\n|:-:|:-:|\n| $1$ | $100$ |\n\n'
      + ':::info[提示]\n注意常数。\n:::');
    await p.emulateMedia({ media: 'print' });

    const read = async () => p.evaluate(() => {
      const q = (sel) => document.querySelector(sel);
      const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null;
      return {
        bodyFont: cs(q('#previewContent p'), 'fontFamily'),
        codeBg: cs(q('#previewContent pre'), 'backgroundColor'),
        codeColor: cs(q('#previewContent pre'), 'color'),
        tableBorder: cs(q('#previewContent .luogu-tuack-table'), 'borderTopColor'),
        cellBorder: cs(q('#previewContent .luogu-tuack-table td'), 'borderTopColor'),
        h2Border: cs(q('#previewContent h2'), 'borderBottomStyle'),
        h2Color: cs(q('#previewContent h2'), 'color'),
        calloutBg: cs(q('#previewContent details.luogu-callout'), 'backgroundColor'),
        katexFont: cs(q('#previewContent .katex'), 'fontFamily'),
      };
    });

    // Default theme first, as the baseline to contrast against.
    await p.evaluate(() => {
      document.documentElement.classList.remove('print-noi');
      document.documentElement.classList.add('print-light');
    });
    await p.waitForTimeout(300);
    const std = await read();

    await p.evaluate(() => document.documentElement.classList.add('print-noi'));
    await p.waitForTimeout(300);
    const noi = await read();

    ck(/serif/i.test(noi.bodyFont) && !/serif/i.test(std.bodyFont) || noi.bodyFont !== std.bodyFont,
      'NOI 主题改用衬线正文', `${std.bodyFont} → ${noi.bodyFont}`);
    ck(noi.codeBg === 'rgb(255, 255, 255)', '样例框改为白底', noi.codeBg);
    ck(noi.codeColor === 'rgb(0, 0, 0)', '样例文字改为黑色', noi.codeColor);
    ck(noi.cellBorder === 'rgb(0, 0, 0)', '表格单元格黑色细线', noi.cellBorder);
    // The table element carries its own border in tuack style; it must go black too,
    // otherwise a blue frame survives on an otherwise monochrome page.
    ck(noi.tableBorder === 'rgb(0, 0, 0)', '表格外框也是黑色（非蓝）', noi.tableBorder);
    ck(noi.h2Border === 'none', '标题去掉装饰性下划线', noi.h2Border);
    ck(noi.h2Color === 'rgb(0, 0, 0)', '标题为黑色', noi.h2Color);
    ck(noi.calloutBg === 'rgb(255, 255, 255)', '折叠框在纸上变为白底', noi.calloutBg);
    ck(/KaTeX/i.test(noi.katexFont), '公式仍用 KaTeX 字体', noi.katexFont);

    // The default PDF must be untouched by all of this.
    ck(std.codeBg !== 'rgb(255, 255, 255)', '默认主题仍是深色样例框（未被改动）', std.codeBg);

    await p.evaluate(() => document.documentElement.classList.remove('print-noi', 'print-light'));
    await p.emulateMedia({ media: 'screen' });
    await p.waitForTimeout(200);
    ck(await p.evaluate(() => !document.documentElement.classList.contains('print-noi')),
      '主题类已清理');
    ck(await p.evaluate(() => typeof LuoguEditor.printDocument === 'function'
      && !!document.querySelector('[onclick*="printDocument(\'noi\')"]')),
      '导出菜单有 NOI 风格入口');
  }

  // ---- CSP-J 2025 template ----------------------------------------------------
  {
    await p.evaluate(() => { window.confirm = () => true; LuoguEditor.insertTemplate('cspj2025'); });
    await p.waitForTimeout(1600);
    const t = await p.evaluate(() => ({
      katex: document.querySelectorAll('#previewContent .katex').length,
      katexErr: [...document.querySelectorAll('#previewContent .katex')]
        .filter((k) => /#cc0000/.test(k.innerHTML)).length,
      tuack: document.querySelectorAll('#previewContent .luogu-tuack-table').length,
      merged: document.querySelectorAll('#previewContent td[rowspan]').length,
      breaks: document.querySelectorAll('#previewContent [data-page-break]').length,
      headers: [...document.querySelectorAll('#previewContent [data-page-header]')]
        .map((e) => e.getAttribute('data-page-header')),
      sections: LuoguEditor._pageSections(document.getElementById('previewContent')).length,
      raw: /:::(Pagination|Header|Footer)|::cute-table/.test(
        document.getElementById('previewContent').textContent),
    }));
    ck(t.katex > 50 && t.katexErr === 0, 'CSP-J 模板公式全部渲染无误',
      `${t.katex} 个公式 / ${t.katexErr} 个错误`);
    ck(t.tuack === 2 && t.merged > 0, '含 tuack 数据范围表与合并单元格',
      `tuack=${t.tuack} merged=${t.merged}`);
    ck(t.breaks === 2 && t.sections === 3, '分成 3 个区块（封面 + 两题）',
      `breaks=${t.breaks} sections=${t.sections}`);
    ck(t.headers.length === 3 && t.headers.every((h) => /CSP-J 2025/.test(h)),
      '每个区块都有自己的页眉', JSON.stringify(t.headers));
    ck(!t.raw, '模板标记未以原文泄漏');
    ck(await p.evaluate(() => !!document.querySelector('[onclick*="cspj2025"]')),
      '模板菜单有 CSP-J 2025 入口');
    // The removed "整套" button must be gone from both the menu and the API.
    ck(await p.evaluate(() => !document.querySelector('[onclick*="insertPageSection"]')
      && typeof LuoguEditor.insertPageSection === 'undefined'),
      '「分页+页眉+页脚（整套）」按钮与方法均已移除');
  }

  // ---- dark theme must not leave UA widgets light -----------------------------
  {
    // An unchecked <input type="checkbox"> is painted by the browser, not by our
    // CSS. Without `color-scheme: dark` it stays a solid white square — obvious on
    // a dark preview and carried straight into the dark PDF.
    await setDoc('- [ ] 未完成\n- [x] 已完成');
    await p.evaluate(() => LuoguEditor.setTheme('dark'));
    await p.waitForTimeout(400);
    ck(await p.evaluate(() =>
      getComputedStyle(document.documentElement).colorScheme === 'dark'),
      '暗色主题声明 color-scheme: dark（屏幕）');

    await p.emulateMedia({ media: 'print' });
    await p.evaluate(() => document.documentElement.classList.add('print-dark'));
    await p.waitForTimeout(350);
    ck(await p.evaluate(() =>
      getComputedStyle(document.documentElement).colorScheme === 'dark'),
      '暗色打印同样声明 color-scheme: dark');

    await p.evaluate(() => document.documentElement.classList.remove('print-dark'));
    await p.emulateMedia({ media: 'screen' });
    await p.evaluate(() => LuoguEditor.setTheme('light'));
    await p.waitForTimeout(350);
    ck(await p.evaluate(() =>
      getComputedStyle(document.documentElement).colorScheme !== 'dark'),
      '亮色主题不受影响');
  }





  ck(errs.length === 0, '无 JS 报错', errs.slice(0, 2).join(' | '));
  console.log(`\n分页与页眉页脚 ${pass + fail} 项，失败 ${fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
