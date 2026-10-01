/**
 * Long-image (PNG) export.
 *
 * The capture has to survive four things that each silently ruin the picture:
 * the preview is a scroll container (only the visible slice would be drawn), its
 * scrollbars would be baked in, collapsed callouts would be shot shut, and the
 * scroll-sync tail padding would leave a blank strip under the article. Every one
 * of those must also be undone afterwards, so exporting does not disturb the page.
 *
 * SnapDOM clamps to the 32767px canvas limit by shrinking proportionally rather
 * than truncating, so "is it complete" is checked via aspect ratio, not height.
 */
const path = require('path');
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const APP = process.argv[2]
    || 'file://' + path.resolve(__dirname, '..', 'LuoguMarkdownEditor.html');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // What must never happen is the document reaching a third party. Same-origin
  // fetches are legitimate: in the hosted (multi-file) build SnapDOM reads the local
  // KaTeX font files in order to inline them. The single-file build already carries
  // them as data URIs, so it makes no requests at all.
  const origin = (() => { try { return new URL(APP).origin; } catch (e) { return null; } })();
  const net = [];
  const foreign = [];
  p.on('request', (r) => {
    const u = r.url();
    if (/^(file|data|blob):/.test(u)) return;
    net.push(u);
    if (!origin || !u.startsWith(origin)) foreign.push(u);
  });

  // 拦截下载，拿到 PNG 字节
  await p.goto(APP, { waitUntil: 'networkidle' });
  // 界面语言默认跟随系统（CI 的浏览器报 en-US），而这些用例断言的是中文 UI：
  // 每次导航后把语言钉回中文，用例只测行为、不测语言。
  await p.evaluate(()=>{if(window.LuoguI18n)LuoguI18n.setLang('zh');});
  await p.evaluate(() => {
    window.__caught = null;
    window.__all = [];
    const oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && /\.png$/.test(this.download)) {
        window.__caught = { name: this.download, href: this.href };
        window.__all.push({ name: this.download, href: this.href });
        return;
      }
      return oc.apply(this, arguments);
    };
  });

  let pass = 0, fail = 0;
  const ck = (c, n, x) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, x || '')); };

  const run = async (md, label, theme) => {
    await p.evaluate(([v, th]) => {
      window.__caught = null; window.__all = [];
      document.documentElement.setAttribute('data-theme', th);
      const ta = document.getElementById('editorTextarea');
      ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true }));
      LuoguEditor.render(); LuoguEditor.setViewMode('preview');
    }, [md, theme || 'light']);
    await p.waitForTimeout(1200);
    const before = await p.evaluate(() => {
      const el = document.getElementById('previewContent');
      const cs = getComputedStyle(el);
      return { h: el.style.height, ov: el.style.overflow, st: el.scrollTop,
               pb: el.style.paddingBottom,
               open: [...el.querySelectorAll('details')].map((d) => d.open),
               overflowComputed: cs.overflowY };
    });
    const t0 = Date.now();
    net.length = 0; foreign.length = 0;   // 页面自身的加载不算"截图联网"
    await p.evaluate(() => LuoguEditor.exportImage());
    await p.waitForFunction(() => window.__caught !== null, { timeout: 120000 });
    const ms = Date.now() - t0;
    const got = await p.evaluate(() => window.__caught);
    const after = await p.evaluate(() => {
      const el = document.getElementById('previewContent');
      return { h: el.style.height, ov: el.style.overflow, st: el.scrollTop,
               pb: el.style.paddingBottom,
               open: [...el.querySelectorAll('details')].map((d) => d.open),
               leftoverStyle: !!document.querySelector('style')
                 && [...document.querySelectorAll('style')].some((x) => /scrollbar-width:none!important/.test(x.textContent)) };
    });
    // 下载链接现在是 blob: URL（不再是多兆字节的 base64 data URL），
    // 所以要在页面里取回内容再读尺寸。
    const b64 = await p.evaluate(async (u) => {
      const r = await fetch(u); const bl = await r.blob();
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result.split(',')[1]);
        fr.readAsDataURL(bl);
      });
    }, got.href);
    const buf = Buffer.from(b64, 'base64');
    if (process.env.KEEP_SHOTS) fs.writeFileSync(`/tmp/w-${label}.png`, buf);
    // PNG 头部读尺寸
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    return { got, ms, w, h, kb: Math.round(buf.length / 1024), before, after };
  };

  console.log('=== 1) 基本导出（含公式/代码/表格/折叠框）===');
  const MD = '# 题解\n\n$$\\sum_{i=1}^{n}\\frac{1}{i^2}=\\frac{\\pi^2}{6}$$\n\n行内 $O(n\\log n)$。\n\n```cpp\nint main(){ return 0; }\n```\n\n| 甲 | 乙 |\n|:-:|:-:|\n| 1 | 2 |\n\n:::info[折叠的提示]\n这段在折叠框里，导出时应可见。\n:::';
  let r = await run(MD, 'basic');
  ck(/\.png$/.test(r.got.name), '触发 PNG 下载', r.got.name);
  ck(r.w > 100 && r.h > 100, `图片尺寸合理 ${r.w}×${r.h}`, `${r.w}×${r.h}`);
  console.log(`     ${r.w}×${r.h}, ${r.kb}KB, ${r.ms}ms`);
  ck(JSON.stringify(r.before.open) === JSON.stringify(r.after.open), '折叠框开合状态已还原',
    `${JSON.stringify(r.before.open)} -> ${JSON.stringify(r.after.open)}`);
  ck(r.after.h === r.before.h && r.after.ov === r.before.ov && r.after.pb === r.before.pb,
    '容器样式（含尾部留白）已还原', JSON.stringify(r.after));
  ck(!r.after.leftoverStyle, '临时隐藏滚动条的样式已移除');
  ck(foreign.length === 0, '截图期间无任何第三方请求（内容不外泄）', foreign.slice(0, 3).join(','));
  if (/^file:/.test(APP)) {
    ck(net.length === 0, '单文件版截图期间零网络请求（完全离线）', net.slice(0, 3).join(','));
  } else {
    ck(true, `托管版仅同源取本地字体用于内嵌（${net.length} 个同源请求）`);
  }

  console.log('\n=== 2) 长文档：切片而非缩小 ===');
  for (const n of [60, 300, 700]) {
    const md = Array.from({ length: n }, (_, i) => `## 第 ${i} 节\n\n内容含 $O(n)$ 说明文字。`).join('\n\n');
    await run(md, `long${n}`);
    // 在与截图相同的条件下测量内容尺寸
    const dim = await p.evaluate(() => {
      const el = document.getElementById('previewContent');
      const save = [el.style.height, el.style.maxHeight, el.style.overflow, el.style.paddingBottom];
      el.style.height = 'auto'; el.style.maxHeight = 'none';
      el.style.overflow = 'visible'; el.style.paddingBottom = '0px';
      const d = { w: el.scrollWidth, h: el.scrollHeight };
      [el.style.height, el.style.maxHeight, el.style.overflow, el.style.paddingBottom] = save;
      return d;
    });
    const all = await p.evaluate(async () => {
      const out = [];
      for (const x of window.__all) {
        const r = await fetch(x.href); const bl = await r.blob();
        const bmp = await createImageBitmap(bl);
        out.push({ w: bmp.width, h: bmp.height });
      }
      return out;
    });
    const scale = all[0].w / dim.w;
    const covered = all.reduce((a, x) => a + x.h, 0) / scale;
    console.log(`  ${String(n).padStart(3)} 节: 内容 ${dim.w}×${dim.h} → ${all.length} 片，`
      + `每片 ${all[0].w} 宽，倍率 ${scale.toFixed(2)}x`);
    ck(all.every((x) => x.h <= 32767 && x.w <= 32767), '每片都在画布上限内',
      JSON.stringify(all.map((x) => x.h)));
    // 关键差别：不再整体缩小，每片都是 2x
    ck(Math.abs(scale - 2) < 0.05, '保持 2x 全分辨率（不再整体缩小）', `${scale.toFixed(2)}x`);
    ck(Math.abs(covered - dim.h) / dim.h < 0.02, '所有切片合起来覆盖整篇',
      `覆盖 ${Math.round(covered)}px vs 内容 ${dim.h}px`);
  }

  console.log('\n=== 3) 暗色主题 ===');
  r = await run(MD, 'dark', 'dark');
  ck(r.w > 100 && r.h > 100, `暗色导出成功 ${r.w}×${r.h}`);
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

  console.log('\n=== 4) 空文档 ===');
  await p.evaluate(() => {
    window.__caught = null;
    const ta = document.getElementById('editorTextarea');
    ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }));
    LuoguEditor.render();
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => LuoguEditor.exportImage());
  await p.waitForTimeout(800);
  ck(await p.evaluate(() => window.__caught === null), '空文档不产生下载');

  ck(errs.length === 0, '无 JS 报错', errs.slice(0, 2).join(' | '));
  console.log(`\n长图导出 ${pass + fail} 项，失败 ${fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
