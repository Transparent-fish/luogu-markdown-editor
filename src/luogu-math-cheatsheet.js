/**
 * KaTeX Formula Assistant & Cheatsheet Library (LaTeX 数学公式面板与速查库)
 */

(function (global) {
  'use strict';

  // i18n：应用里是真正的翻译函数（src/i18n.js 先于本文件加载）；
  // 单元测试（node 直接 require 本文件）里它退化成"原样返回 + 插值"。
  const T = (global.LuoguI18n && global.LuoguI18n.t) || ((s, v) => (v
    ? String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(v, k) ? v[k] : m))
    : s));

  const LuoguMathLibrary = [
    {
      category: T('常用与基础 (Common)'),
      items: [
        { label: T('行内变量 $x$'), code: '$x$', desc: T('普通行内数学符号') },
        { label: T('上标 (幂) $x^2$'), code: 'x^{2}', desc: T('上标') },
        { label: T('下标 (角标) $a_i$'), code: 'a_{i}', desc: T('下标') },
        { label: T('上标与下标 $x_i^2$'), code: 'x_{i}^{2}', desc: T('同时包含角标与幂') },
        { label: T('分数 \\frac{a}{b}'), code: '\\frac{a}{b}', desc: T('标准分数') },
        { label: T('大型分数 \\displaystyle'), code: '\\displaystyle\\frac{a}{b}', desc: T('显示模式大分数') },
        { label: T('开平方根 \\sqrt{x}'), code: '\\sqrt{x}', desc: T('平方根') },
        { label: T('开 n 次方根 \\sqrt[n]{x}'), code: '\\sqrt[n]{x}', desc: T('n 次方根') },
        { label: T('时间复杂度 O(n log n)'), code: '\\mathcal{O}(n \\log n)', desc: T('算法大 O 表示法') },
        { label: T('行间独立公式 $$...$$'), code: '$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$', desc: T('单独成行居中公式'), isWide: true }
      ]
    },
    {
      category: T('关系符与运算符 (Operators)'),
      items: [
        { label: T('小于等于 ≤'), code: '\\le', desc: T('小于等于') },
        { label: T('大于等于 ≥'), code: '\\ge', desc: T('大于等于') },
        { label: T('不等于 ≠'), code: '\\ne', desc: T('不等于') },
        { label: T('恒等于 ≡'), code: '\\equiv', desc: T('同余 / 恒等于') },
        { label: T('约等于 ≈'), code: '\\approx', desc: T('近似约等于') },
        { label: T('乘号 ×'), code: '\\times', desc: T('乘法符号') },
        { label: T('点乘 ·'), code: '\\cdot', desc: T('点乘') },
        { label: T('除号 ÷'), code: '\\div', desc: T('除法') },
        { label: T('正负号 ±'), code: '\\pm', desc: T('正负号') },
        { label: T('负正号 ∓'), code: '\\mp', desc: T('负正号') },
        { label: T('取模 bmod'), code: '\\bmod', desc: T('取模') },
        { label: T('异或 ⊕'), code: '\\oplus', desc: T('按位异或') },
        { label: T('同或 ⊗'), code: '\\otimes', desc: T('张量积/同或') },
        { label: T('逻辑与 ∧'), code: '\\land', desc: T('逻辑与') },
        { label: T('逻辑或 ∨'), code: '\\lor', desc: T('逻辑或') },
        { label: T('属于 ∈'), code: '\\in', desc: T('集合属于') },
        { label: T('不属于 ∉'), code: '\\notin', desc: T('不属于') },
        { label: T('包含于 ⊆'), code: '\\subseteq', desc: T('子集') },
        { label: T('真子集 ⊂'), code: '\\subset', desc: T('真子集') },
        { label: T('交集 ∩'), code: '\\cap', desc: T('交集') },
        { label: T('并集 ∪'), code: '\\cup', desc: T('并集') },
        { label: T('垂直 ⊥'), code: '\\perp', desc: T('垂直') },
        { label: T('平行 ∥'), code: '\\parallel', desc: T('平行') },
        { label: T('整除 |'), code: '\\mid', desc: T('整除') }
      ]
    },
    {
      category: T('希腊字母 (Greek Letters)'),
      items: [
        { label: 'α (alpha)', code: '\\alpha', desc: 'alpha' },
        { label: 'β (beta)', code: '\\beta', desc: 'beta' },
        { label: 'γ (gamma)', code: '\\gamma', desc: 'gamma' },
        { label: 'δ (delta)', code: '\\delta', desc: 'delta' },
        { label: 'ε (epsilon)', code: '\\epsilon', desc: 'epsilon' },
        { label: 'ζ (zeta)', code: '\\zeta', desc: 'zeta' },
        { label: 'η (eta)', code: '\\eta', desc: 'eta' },
        { label: 'θ (theta)', code: '\\theta', desc: 'theta' },
        { label: 'λ (lambda)', code: '\\lambda', desc: 'lambda' },
        { label: 'μ (mu)', code: '\\mu', desc: 'mu' },
        { label: 'π (pi)', code: '\\pi', desc: 'pi' },
        { label: 'ρ (rho)', code: '\\rho', desc: 'rho' },
        { label: 'σ (sigma)', code: '\\sigma', desc: 'sigma' },
        { label: 'τ (tau)', code: '\\tau', desc: 'tau' },
        { label: 'φ (varphi)', code: '\\varphi', desc: 'varphi' },
        { label: 'ω (omega)', code: '\\omega', desc: 'omega' },
        { label: 'Δ (Delta)', code: '\\Delta', desc: T('大写 Delta') },
        { label: 'Θ (Theta)', code: '\\Theta', desc: T('大写 Theta') },
        { label: 'Λ (Lambda)', code: '\\Lambda', desc: T('大写 Lambda') },
        { label: 'Σ (Sigma)', code: '\\Sigma', desc: T('大写 Sigma') },
        { label: 'Φ (Phi)', code: '\\Phi', desc: T('大写 Phi') },
        { label: 'Ω (Omega)', code: '\\Omega', desc: T('大写 Omega') }
      ]
    },
    {
      category: T('求和、乘积与微积分 (Sum & Calculus)'),
      items: [
        { label: T('求和 ∑'), code: '\\sum_{i=1}^{n}', desc: T('求和符号') },
        { label: T('连乘 ∏'), code: '\\prod_{i=1}^{n}', desc: T('连乘符号') },
        { label: T('极限 lim'), code: '\\lim_{x \\to \\infty}', desc: T('极限') },
        { label: T('定积分 ∫'), code: '\\int_{a}^{b} f(x) \\mathrm{d}x', desc: T('定积分') },
        { label: T('不定积分 ∫'), code: '\\int f(x) \\mathrm{d}x', desc: T('不定积分') },
        { label: T('二重积分 ∬'), code: '\\iint_D f(x,y) \\mathrm{d}x \\mathrm{d}y', desc: T('二重积分') },
        { label: T('偏导数 ∂'), code: '\\frac{\\partial y}{\\partial x}', desc: T('偏导数') },
        { label: T('无穷大 ∞'), code: '\\infty', desc: T('无穷大') },
        { label: T('趋近于 →'), code: '\\to', desc: T('趋近于') }
      ]
    },
    {
      category: T('矩阵与多行方程 (Matrices & Cases)'),
      items: [
        {
          label: T('分段函数 cases'),
          code: '$$\nf(x) = \\begin{cases}\n  2, & x > 0 \\\\\n  1, & x = 0 \\\\\n  0, & x < 0\n\\end{cases}\n$$',
          desc: T('分段函数'),
          isWide: true
        },
        {
          label: T('圆括号矩阵 pmatrix (2x2)'),
          code: '$$\n\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}\n$$',
          desc: T('圆括号矩阵'),
          isWide: true
        },
        {
          label: T('方括号矩阵 bmatrix (2x2)'),
          code: '$$\n\\begin{bmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{bmatrix}\n$$',
          desc: T('方括号矩阵'),
          isWide: true
        },
        {
          label: T('多行公式对齐 aligned'),
          code: '$$\n\\begin{aligned}\na + b &= c \\\\\n(x + y)^2 &= x^2 + 2xy + y^2\n\\end{aligned}\n$$',
          desc: T('多行等号对齐'),
          isWide: true
        }
      ]
    },
    {
      category: T('字体、字号与修饰 (Fonts & Styles)'),
      items: [
        { label: T('实数集 R'), code: '\\mathbb{R}', desc: T('实数集') },
        { label: T('整数集 Z'), code: '\\mathbb{Z}', desc: T('整数集') },
        { label: T('自然数集 N'), code: '\\mathbb{N}', desc: T('自然数集') },
        { label: T('复数集 C'), code: '\\mathbb{C}', desc: T('复数集') },
        { label: T('算法复杂度 O(n)'), code: '\\mathcal{O}(n)', desc: T('花体大 O') },
        { label: T('哥特体 g'), code: '\\mathfrak{g}', desc: T('哥特字体') },
        { label: T('手写花体 L'), code: '\\mathscr{L}', desc: T('手写花体') },
        { label: T('公式内正体中文'), code: T('\\text{满足条件 } x > 0'), desc: T('公式中文文本') },
        { label: T('加粗 \\mathbf'), code: '\\mathbf{v}', desc: T('向量加粗') },
        { label: T('向量箭头 \\vec'), code: '\\vec{a}', desc: T('向量箭头') },
        { label: T('上横线 \\overline'), code: '\\overline{AB}', desc: T('线段/平均值') },
        { label: T('洛谷蓝颜色'), code: '{\\color{#3498db} x}', desc: T('自定义颜色') },
        { label: T('红色字体'), code: '{\\color{red} x}', desc: T('红色') },
        { label: T('绿色通过颜色'), code: '{\\color{#2ecc71} \\text{AC}}', desc: T('绿色') },
        { label: T('特大字号 Huge'), code: '{\\Huge x}', desc: T('Huge 字号') },
        { label: T('大字号 Large'), code: '{\\Large x}', desc: T('Large 字号') }
      ]
    }
  ];

  global.LuoguMathLibrary = LuoguMathLibrary;
  if (typeof window !== 'undefined') {
    window.LuoguMathLibrary = LuoguMathLibrary;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LuoguMathLibrary };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
