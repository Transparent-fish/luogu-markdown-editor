/**
 * 版式与打印配色：
 *   - 拖动分割条之后，分割条不能消失（两侧面板的 basis 相加等于容器宽度时，
 *     flex-shrink 会把唯一可收缩的分割条压成 0px）
 *   - 切到"只有源代码"/"只有预览"时，那一栏必须铺满（拖动留下的内联宽度要清掉）
 *   - NOI 风格导出跟随主题，而不是恒为白底
 *   - Typora 模式里点开 `^` / `<` 这类合并标记格时，编辑框跟随主题（曾经写死 #fff），
 *     并且宿主单元格的 padding / 字号确实被归零（那条规则一度因为选择器漏了大括号而失效）
 */
const path = require('path');
const { chromium } = require('playwright');

const DOC = [
  '# 版式测试',
  '',
  '| 表头 A | 表头 B | 表头 C |',
  '| :-- | :-- | :-- |',
  '| 跨列 |< | 普通 |',
  '',
  '正文一段。',
].join('\\n');

(async () => {
  const APP = process.argv[2]
    || 'file://' + path.resolve(__dirname, '..', 'LuoguMarkdownEditor.html');
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ck = (c, n, x) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, x || '')); };

  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // window.print() 在无头浏览器里不会弹框，但打桩更稳，也顺带记下调用次数。
  await p.addInitScript(() => { window.__PRINTS = 0; window.print = () => { window.__PRINTS += 1; }; });
  await p.goto(APP, { waitUntil: 'networkidle' });
  // 界面语言默认跟随系统（CI 的浏览器报 en-US），而这些用例断言的是中文 UI：
  // 每次导航后把语言钉回中文，用例只测行为、不测语言。
  await p.evaluate(()=>{if(window.LuoguI18n)LuoguI18n.setLang('zh');});
  await p.waitForTimeout(800);
  await p.evaluate((doc) => { LuoguEditor.setContent(doc, false); }, DOC.replace(/\\n/g, '\n'));
  await p.waitForTimeout(400);

  const widths = () => p.evaluate(() => ({
    resizer: Math.round(document.getElementById('splitResizer').getBoundingClientRect().width),
    editor: Math.round(document.getElementById('editorPane').getBoundingClientRect().width),
    preview: Math.round(document.getElementById('previewPane').getBoundingClientRect().width),
    workspace: Math.round(document.getElementById('mainWorkspace').getBoundingClientRect().width),
  }));

  // ---- 1. 分割条：拖一次之后还在 --------------------------------------------
  const box = await p.locator('#splitResizer').boundingBox();
  const before = await widths();
  ck(before.resizer > 0, '拖动前分割条可见', JSON.stringify(before));
  await p.mouse.move(box.x + box.width / 2, box.y + 200);
  await p.mouse.down();
  await p.mouse.move(box.x - 220, box.y + 200, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const after = await widths();
  ck(after.resizer === before.resizer, '拖动一次之后分割条宽度不变（不再被挤成 0）',
    JSON.stringify(after));
  ck(after.editor < before.editor, '编辑区确实跟着变窄了（拖动生效）');
  ck(after.editor + after.preview + after.resizer === after.workspace,
    '三部分之和恰好等于容器宽度（不会顶出容器）',
    `${after.editor}+${after.preview}+${after.resizer} vs ${after.workspace}`);

  // 拖动比例要记住
  const ratio = await p.evaluate(() => LuoguEditor.splitRatio);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const restored = await p.evaluate(() => LuoguEditor.splitRatio);
  ck(Math.abs(restored - ratio) < 0.2, '重开后还是上次的分栏比例', `${ratio} -> ${restored}`);
  // 刷新会把编辑区换回自动保存的草稿，后面几条断言依赖这份文档，重新灌一次。
  await p.evaluate((doc) => { LuoguEditor.setContent(doc, false); }, DOC.replace(/\\n/g, '\n'));
  await p.waitForTimeout(500);

  // ---- 2. 单栏模式铺满 -------------------------------------------------------
  await p.evaluate(() => LuoguEditor.setViewMode('editor-only'));
  await p.waitForTimeout(400);
  const ed = await widths();
  ck(ed.editor === ed.workspace, '「只有源代码」时编辑区铺满整个宽度', JSON.stringify(ed));
  ck(await p.evaluate(() => document.getElementById('editorPane').style.flex === ''),
    '内联的拖动宽度已被清掉');
  await p.evaluate(() => LuoguEditor.setViewMode('preview-only'));
  await p.waitForTimeout(400);
  const pv = await widths();
  ck(pv.preview === pv.workspace, '「只有预览」时预览铺满整个宽度', JSON.stringify(pv));
  await p.evaluate(() => LuoguEditor.setViewMode('typora'));
  await p.waitForTimeout(600);
  const ty = await widths();
  ck(ty.preview === ty.workspace, 'Typora 模式同样铺满', JSON.stringify(ty));

  // 回到双栏：比例还在
  await p.evaluate(() => LuoguEditor.setViewMode('split'));
  await p.waitForTimeout(400);
  const back = await widths();
  ck(back.resizer > 0 && back.editor + back.preview + back.resizer === back.workspace,
    '切回双栏时分割条和比例都回来了', JSON.stringify(back));

  // ---- 3. Typora 单元格编辑器跟随主题 ----------------------------------------
  await p.evaluate(() => { LuoguEditor.setTheme('dark'); LuoguEditor.setViewMode('typora'); });
  await p.waitForTimeout(700);
  const spot = await p.evaluate(() => {
    const td = [...document.querySelectorAll('.preview-content .luogu-table td')]
      .find((x) => x.textContent.includes('跨列'));
    if (!td) return null;
    td.scrollIntoView({ block: 'center' });
    const r = td.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  ck(!!spot, '（准备）找到那张有合并的表格');
  // 悬停触发"临时拆开"。无头环境下第一次移动有时只算 pointer 移动而不重算 hover，
  // 所以先挪到旁边再进来，最多试几次。
  const hoverUnmerged = async () => {
    for (let i = 0; i < 4; i += 1) {
      await p.mouse.move(spot.x - 60, spot.y - 40);
      await p.waitForTimeout(120);
      await p.mouse.move(spot.x, spot.y, { steps: 3 });
      await p.waitForTimeout(350);
      const n = await p.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return {
          n: document.querySelectorAll('.typora-unmerged-cell').length,
          under: el ? el.tagName + '.' + el.className : null,
        };
      }, [spot.x, spot.y]);
      if (n.n) return n;
    }
    return { n: 0, under: null };
  };
  const hovered = await hoverUnmerged();
  ck(hovered.n > 0, '悬停合并单元格会拆开，露出 `<` / `^` 标记',
    `拆出的格子数 ${hovered.n}，指针下是 ${hovered.under}`);
  const marker = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.typora-unmerged-cell')]
      .find((x) => x.textContent.trim() === '<' || x.textContent.trim() === '^');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: c.textContent.trim() };
  });
  await p.mouse.move(marker.x, marker.y);
  await p.mouse.down();
  await p.mouse.up();
  await p.waitForTimeout(700);
  const cellEditor = await p.evaluate(() => {
    const el = document.querySelector('.typora-editing .typora-block-input');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const host = el.closest('td, th');
    const hs = host ? getComputedStyle(host) : null;
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      hostPadding: hs ? hs.padding : null,
      hostFontSize: hs ? hs.fontSize : null,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
  ck(cellEditor && cellEditor.bg !== 'rgb(255, 255, 255)',
    '暗色主题下单元格编辑框不再是白底', JSON.stringify(cellEditor));
  ck(cellEditor && cellEditor.bg === 'rgb(30, 30, 30)',
    '用的是暗色主题的底色（--bg-primary）', cellEditor && cellEditor.bg);
  ck(cellEditor && cellEditor.hostPadding === '0px' && cellEditor.hostFontSize === '0px',
    '宿主单元格的 padding / 字号被归零（否则标记字会压在输入框上）',
    JSON.stringify(cellEditor));

  // 亮色主题下仍然正常
  await p.evaluate(() => LuoguEditor.setTheme('light'));
  await p.waitForTimeout(500);
  const lightBg = await p.evaluate(() => {
    const el = document.querySelector('.typora-editing .typora-block-input');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  ck(lightBg === 'rgb(255, 255, 255)', '亮色主题下就是白底', String(lightBg));

  // ---- 4. NOI 风格导出跟随主题 ------------------------------------------------
  await p.evaluate(() => { LuoguEditor.setTheme('dark'); });
  await p.waitForTimeout(200);
  await p.evaluate(() => LuoguEditor.printDocument('noi'));
  await p.waitForTimeout(300);
  const noiDark = await p.evaluate(() => ({
    dark: document.documentElement.classList.contains('print-dark'),
    light: document.documentElement.classList.contains('print-light'),
    noi: document.documentElement.classList.contains('print-noi'),
    prints: window.__PRINTS,
  }));
  ck(noiDark.dark && !noiDark.light, '暗色主题下导出 NOI 风格是深色底', JSON.stringify(noiDark));
  ck(noiDark.noi, 'NOI 风格类名仍然挂上（页眉页脚与 A4 版式靠它）');
  ck(noiDark.prints === 1, '真的调用了打印');

  await p.evaluate(() => { LuoguEditor.setTheme('light'); });
  await p.waitForTimeout(200);
  await p.evaluate(() => LuoguEditor.printDocument('noi'));
  await p.waitForTimeout(300);
  ck(await p.evaluate(() => document.documentElement.classList.contains('print-light')
    && !document.documentElement.classList.contains('print-dark')),
    '亮色主题下导出 NOI 风格是浅色底');

  // 显式指定仍然优先于当前主题
  await p.evaluate(() => { LuoguEditor.setTheme('light'); LuoguEditor.printDocument('dark'); });
  await p.waitForTimeout(300);
  ck(await p.evaluate(() => document.documentElement.classList.contains('print-dark')),
    '显式传 dark 时压过当前主题');

  ck(errs.length === 0, '全程无 JS 报错', errs.slice(0, 3).join(' | '));

  console.log(`\n版式与打印配色  ${pass + fail} 项，失败 ${fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
