/**
 * Luogu Markdown Preset Templates (洛谷预设模板库)
 */

(function (global) {
  'use strict';

  const LuoguTemplates = {
    // 1. 洛谷 Markdown 完整特性演示文档
    demo: `# 洛谷 Markdown 格式与 KaTeX 公式全特性演示

本文档演示了 [洛谷 Markdown 格式手册](https://help.luogu.com.cn/rules/academic/handbook/markdown) 与 [LaTeX 格式手册](https://help.luogu.com.cn/rules/academic/handbook/latex) 中的全部特性。

---

## 一、段落与排版

一个 Markdown 段落是由一个或多个连续文本行组成，前后需要有空行。

在行末输入两个空格或一个反斜杠（\`\\\`），可以实现比分段更加紧凑的换行效果：

这是第一行文本  
这是通过行末两个空格换行的第二行

这是第三行文本\\
这是通过行末反斜杠换行的第四行

### 强调与修饰
- *单星号斜体* 与 _单下划线斜体_
- **双星号加粗** 与 __双下划线加粗__
- ***粗斜体文本***
- ~~删除线文本~~
- 转义符号演示：\\*不是斜体\\*、\\[不是链接\\]、\\$不是公式\\$

---

## 二、代码块（带行号与高亮）

洛谷代码块默认会 fallback 到 C++，同时支持 \`line-numbers\`（显示行号）和 \`lines=start-end\`（指定行高亮）：

\`\`\`cpp line-numbers lines=7-10
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    
    int n;
    if (!(cin >> n)) return 0;
    cout << "Hello, Luogu! n = " << n << endl;
    return 0;
}
\`\`\`

---

## 三、LaTeX 与 KaTeX 数学公式支持

洛谷使用 KaTeX 进行公式渲染，支持行内公式 \`$ ... $\` 和行间公式 \`$$ ... $$\`。

行内公式示例：对于任意的 $x, y \\in \\mathbb{R}$，均有 $(x + y)^2 = x^2 + 2xy + y^2$。

行间公式示例（多行对齐与微积分）：

$$
\\begin{aligned}
\\int_{0}^{+\\infty} e^{-x^2} \\mathrm{d}x &= \\frac{\\sqrt{\\pi}}{2} \\\\
H_n &= \\sum_{i = 1}^{n} \\frac{1}{i} \\sim \\ln n + \\gamma + \\mathcal{O}\\left(\\frac{1}{n}\\right)
\\end{aligned}
$$

分段函数与矩阵：

$$
f(x) = \\begin{cases}
  \\displaystyle \\frac{\\sin x}{x}, & x \\neq 0 \\\\
  1, & x = 0
\\end{cases}
\\quad \\text{与} \\quad
A = \\begin{pmatrix}
1 & 8 & 4 \\\\
7 & 9 & 2 \\\\
3 & 5 & 6
\\end{pmatrix}
$$

字号与颜色支持：

$$
{\\color{#3498db} \\Huge \\mathbb{N} \\subset \\mathbb{Z} \\subset \\mathbb{Q} \\subset \\mathbb{R} \\subset \\mathbb{C}}
$$

---

## 四、表格与单元格合并【新特性】

使用 \`^\` 向上合并单元格（rowspan），使用 \`<\` 向左合并单元格（colspan）：

| 测试点编号 | 范围 $n, m$ | 约束 $k$ | 特殊性质 |
|:---:|:---:|:---:|:---:|
| 1 | $\\le 10$ | $\\le 10$ | 无 |
| 2 | ^ | ^ | 无 |
| 3 | ^ | ^ | A |
| 4 | $\\le 10^5$ | ^ | 无 |
| 5 | ^ | $\\le 10^5$ | 跨列合并 1 |
| 6 | 跨列合并 2 | < | 无 |

### 更像 Tuack 的表格【新特性】

使用 \`::cute-table{tuack}\` 创建 Tuack 风格的竞赛表格：

::cute-table{tuack}

| 测试点编号 | $n, m \\leq$ | $k \\leq$ | 特殊性质 |
| :-: | :-: | :-: | :-: |
| $1, 2$ | $6$ | $6$ | C |
| $3 \\sim 5$ | $10^3$ | $10^3$ | ^ |
| $6 \\sim 8$ | $5 \\times 10^4$ | $10^2$ | 无 |
| $9, 10$ | $10^5$ | $10^5$ | AB |
| $11 \\sim 12$ | ^ | ^ | A |

---

## 五、居中与居右排版【新特性】

:::align{center}
**这是居中排版的文本与公式**

$\\displaystyle \\sum_{k=1}^n k = \\frac{n(n+1)}{2}$
:::

:::align{right}
—— 洛谷学术排版规范
:::

---

## 六、引言【新特性】

使用 \`:::epigraph[落款]\` 创建引言块：

:::epigraph[—— 《算法竞赛进阶指南》]
博观而约取，厚积而薄发。在算法的世界里，每一个看似精妙的结论，都是无数次思考与推导的结晶。
:::

---

## 七、折叠框【新特性】

支持 \`:::info\`、\`:::success\`、\`:::warning\`、\`:::error\`，可用 \`{open}\` 默认展开，标题支持 KaTeX 公式，且支持多层嵌套：

::::info[我是默认展开的提示框]{open}
使用 \`{open}\` 参数可以让折叠框在初次加载时保持展开状态。
::::

::::success[$$\\displaystyle\\sum_{i = 1}^n \\sum_{j = 1}^n \\gcd(i, j) = \\sum_{d=1}^n d \\cdot (2\\sum_{i=1}^{\\lfloor n/d \\rfloor} \\varphi(i) - 1)$$]
折叠框的标题中可以直接编写复杂的 LaTeX 数学公式！
::::

::::warning[警告与注意事项]
请勿滥用多层嵌套，以免影响文章的阅读体验。
::::

::::error[常见错误提示]
数组越界 (RE)、超时 (TLE)、内存超限 (MLE) 是算法竞赛中最常见的问题。
::::

### 嵌套折叠框示例：

::::::warning[外层警告]

:::::info[第二层提示]

::::success[第三层成功信息]

:::info[最深层]
合理的多层嵌套能够有效组织超长题解或算法推导步骤！
:::
::::
:::::
::::::

---

## 八、任务列表与引用

- [x] 掌握洛谷 Markdown 基础语法
- [x] 掌握 KaTeX 数学公式排版
- [x] 掌握折叠框与表格合并扩展
- [ ] 在洛谷发表一篇符合规范的优质题解！

> 区块引用支持嵌套与其他 Markdown 语法：
> > 深入理解算法本质，提高代码实现能力。

---

## 九、插入 Bilibili 视频

支持使用图片语法直接嵌入 B 站视频播放器：

![](bilibili:BV1GJ411x7h7)
`,

    // 2. 洛谷题解标准模板
    solution: `# 题解：[题目编号] [题目名称]

## 题目大意
简要概述题目的输入输出与核心要求（注意数学变量使用 \`$ ... $\` 包裹）。

给定一个长度为 $n$ 的正整数序列 $a_1, a_2, \\dots, a_n$，要求在 $\\mathcal{O}(n \\log n)$ 或更优的时间复杂度内求出满足某种条件的最优解。

---

## 解题思路

### 1. 基础分析与转化
首先观察数据范围，$n \\le 10^5$，因此暴力 $\\mathcal{O}(n^2)$ 的做法显然会 TLE。

考虑状态转移方程：
设 $dp[i]$ 表示前 $i$ 个元素的最优值，则：

$$
dp[i] = \\min_{0 \\le j < i} \\left\\{ dp[j] + (s_i - s_j)^2 + C \\right\\}
$$

其中 $s_i = \\sum_{k=1}^i a_k$ 为前缀和。

### 2. 优化推导（斜率优化 / 数据结构优化）
展开状态转移方程：

$$
dp[i] = s_i^2 + C + \\min_{0 \\le j < i} \\left\\{ (dp[j] + s_j^2) - 2 s_i s_j \\right\\}
$$

令：
- $y = dp[j] + s_j^2$
- $k = 2 s_i$
- $x = s_j$

则方程可化为 $y = kx + (dp[i] - s_i^2 - C)$，截距越小 $dp[i]$ 越小。由于斜率 $k$ 和横坐标 $x$ 均单调递增，可以使用**单调队列**在 $\\mathcal{O}(n)$ 时间内完成维护。

---

## 代码实现

::::info[C++ 核心实现代码]{open}
以下为完整 AC 代码：

\`\`\`cpp line-numbers lines=14-22
#include <bits/stdc++.h>
using namespace std;

using ll = long long;
const int MAXN = 100005;

int n;
ll C;
ll a[MAXN], s[MAXN], dp[MAXN];
int q[MAXN];

inline double getSlope(int j1, int j2) {
    ll y1 = dp[j1] + s[j1] * s[j1];
    ll y2 = dp[j2] + s[j2] * s[j2];
    ll x1 = s[j1], x2 = s[j2];
    if (x1 == x2) return y2 >= y1 ? 1e18 : -1e18;
    return (double)(y2 - y1) / (x2 - x1);
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    if (!(cin >> n >> C)) return 0;
    for (int i = 1; i <= n; i++) {
        cin >> a[i];
        s[i] = s[i - 1] + a[i];
    }

    int head = 0, tail = 0;
    q[0] = 0;

    for (int i = 1; i <= n; i++) {
        ll k = 2 * s[i];
        while (head < tail && getSlope(q[head], q[head + 1]) <= k) {
            head++;
        }
        int j = q[head];
        dp[i] = dp[j] + (s[i] - s[j]) * (s[i] - s[j]) + C;
        while (head < tail && getSlope(q[tail - 1], q[tail]) >= getSlope(q[tail], i)) {
            tail--;
        }
        q[++tail] = i;
    }

    cout << dp[n] << "\\n";
    return 0;
}
\`\`\`
::::

---

## 复杂度分析

- **时间复杂度**：每个元素最多进出单调队列各一次，均摊时间复杂度为 $\\mathcal{O}(n)$。
- **空间复杂度**：需要存储前缀和数组与 DP 数组，空间复杂度为 $\\mathcal{O}(n)$。

::::success[注意事项]
1. 注意整数溢出问题，公式中的平方项可能超过 \`int\` 范围，需使用 \`long long\`。
2. 斜率比较时注意分母为 0 的边界情况。
::::
`,

    // 3. 洛谷题目题面模板
    problem: `# [题目名称]

## 题目背景
（可留空或编写生动的背景故事）

---

## 题目描述
给出一段清晰、严谨的题目描述。

给定一个包含 $n$ 个节点和 $m$ 条有向边的图 $G = (V, E)$，每条边有一个权值 $w(u, v)$。请计算从源点 $s$ 到汇点 $t$ 的最短路径长度。

---

## 输入格式
输入第一行包含四个整数 $n, m, s, t$，分别表示节点数、边数、源点编号和汇点编号。

接下来 $m$ 行，每行包含三个整数 $u, v, w$，表示一条从 $u$ 到 $v$ 权值为 $w$ 的有向边。

---

## 输出格式
输出一行一个整数，表示从 $s$ 到 $t$ 的最短距离。若无法到达，则输出 $-1$。

---

## 输入输出样例

### 样例输入 #1
\`\`\`plain
4 4 1 4
1 2 2
2 3 3
3 4 1
1 4 7
\`\`\`

### 样例输出 #1
\`\`\`plain
6
\`\`\`

---

## 说明/提示

### 数据规模与约定

::cute-table{tuack}

| 测试点编号 | $n \\le$ | $m \\le$ | 边权 $w$ | 特殊性质 |
|:---:|:---:|:---:|:---:|:---:|
| $1 \\sim 2$ | $10$ | $20$ | $\\ge 0$ | 无 |
| $3 \\sim 5$ | $10^3$ | $2 \\times 10^3$ | ^ | DAG（有向无环图） |
| $6 \\sim 8$ | $10^5$ | $2 \\times 10^5$ | ^ | 无 |
| $9 \\sim 10$ | $10^5$ | $5 \\times 10^5$ | $\\ge -10^3$ | 无负环 |

对于 $100\\%$ 的数据，保证 $1 \\le n \\le 10^5$，$1 \\le m \\le 5 \\times 10^5$，$1 \\le s, t \\le n$，$|w| \\le 10^9$。
`,

    // 4. 洛谷学术/文章模板
    article: `# 深入浅出算法系列：浅谈 [算法主题]

:::epigraph[—— 洛谷学术专栏]
千里之行，始于足下；算法之美，贵在探究。
:::

## 1. 引言与背景
在计算机科学与算法竞赛中，[算法名称] 是一种极其优美且实用的方法……

---

## 2. 核心数学理论与证明

:::align{center}
**定理 1（核心结论）**

设 $G$ 为无向连通图，则对于任意割集 $C$，包含在最小生成树中的边必为 $C$ 中的最小权边。
:::

### 证明过程
::::info[展开详细数学证明]{open}
采用反证法。假设存在最小权边 $e = (u, v) \\notin T$……

由树的性质可知，$T \\cup \\{e\\}$ 中必定包含唯一的简单回路 $C'$。
因为 $u, v$ 处于割的两侧，回路中必存在另一条跨越该割的边 $e'$，满足 $w(e') \\ge w(e)$。

若用 $e$ 替换 $e'$，得到新树 $T' = T \\setminus \\{e'\\} \\cup \\{e\\}$，其权值：

$$
W(T') = W(T) - w(e') + w(e) \\le W(T)
$$

与 $T$ 的最小性矛盾。证毕。
::::

---

## 3. 视频讲解辅助

![](bilibili:BV1GJ411x7h7)

---

## 4. 总结与延伸思考
通过上述推导，我们不仅掌握了算法的核心思想，更能触类旁通，解决更广泛的拓展问题。
`,

    // A statement booklet laid out the way CCF publishes them, meant to be read
    // through 「导出 → 打印 / 导出 PDF（NOI 风格）」: the cover table, the per-problem
    // running heads, the page breaks and the tuack 数据范围 table are all exercised.
    // Problem metadata follows CSP-J 2025 第二轮 (2025-11-01); the statements are
    // abridged for template use.
    cspj2025: `:::Header[CSP-J 2025 第二轮认证 入门级]
:::Footer[第 {page} 页 共 {pages} 页]

:::align{center}
# CCF 非专业级软件能力认证

## CSP-J 2025 第二轮认证 · 入门级

时间：2025 年 11 月 1 日 08:30 ~ 12:00
:::

| 题目名称 | 拼数 | 座位 | 异或和 | 多边形 |
|:--|:--:|:--:|:--:|:--:|
| 题目类型 | 传统型 | 传统型 | 传统型 | 传统型 |
| 目录 | \`number\` | \`seat\` | \`xor\` | \`polygon\` |
| 可执行文件名 | \`number\` | \`seat\` | \`xor\` | \`polygon\` |
| 输入文件名 | \`number.in\` | \`seat.in\` | \`xor.in\` | \`polygon.in\` |
| 输出文件名 | \`number.out\` | \`seat.out\` | \`xor.out\` | \`polygon.out\` |
| 每个测试点时限 | 1.0 秒 | 1.0 秒 | 1.0 秒 | 1.0 秒 |
| 内存限制 | 512 MiB | 512 MiB | 512 MiB | 512 MiB |
| 测试点数目 | 20 | 20 | 20 | 20 |
| 测试点是否等分 | 是 | 是 | 是 | 是 |

**提交源程序文件名**

| 对于 C++ 语言 | \`number.cpp\` | \`seat.cpp\` | \`xor.cpp\` | \`polygon.cpp\` |
|:--|:--:|:--:|:--:|:--:|

**编译选项**

| 对于 C++ 语言 | \`-O2\` |
|:--|:--|

## 注意事项（请仔细阅读）

1. 文件名（程序名和输入输出文件名）必须使用英文小写。
2. C++ 中函数 \`main()\` 的返回值类型必须是 \`int\`，程序正常结束时的返回值必须是 $0$。
3. 提交的程序代码文件的放置位置请参照各省的具体要求。
4. 因违反以上三点而出现的错误或问题，申诉时一律不予受理。
5. 若无特殊说明，结果的比较方式为对于整数或字符串比较是否完全相同，对于实数需保留特定位数，比较绝对误差或相对误差不超过 $10^{-4}$。
6. 选手提交的程序源文件必须不大于 $100\\text{KB}$。
7. 程序可使用的栈空间内存限制与题目的内存限制一致。
8. 全国统一评测时采用的机器配置为：CPU Intel(R) Core(TM) i7-8700K，内存 32GB。上述时限以此配置为准。
9. 只提供 Linux 格式附加样例文件。
10. 评测在当前最新公布的 NOI Linux 下进行，各语言的编译器版本以此为准。

:::Pagination

:::Header[CSP-J 2025 第二轮 · 拼数（number）]

# 拼数（number）

## 【题目描述】

小 R 正在学习字符串处理。小 X 给了小 R 一个字符串 $s$，其中 $s$ 仅包含小写英文字母及数字，且**包含至少一个 $1 \\sim 9$ 中的数字**。

小 X 希望小 R 使用 $s$ 中的任意多个数字，按任意顺序拼成一个正整数。**注意：小 R 可以选择 $s$ 中相同的数字，但每个数字只能使用一次。**

例如，若 $s$ 为 \`1a01b\`，则小 R 可以同时选择第 $1, 3, 4$ 个字符，分别为 $1, 0, 1$，拼成正整数 $101$ 或 $110$；但小 R 不能拼成正整数 $111$，因为 $s$ 仅包含两个数字 $1$。

小 R 想知道，在他所有能拼成的正整数中，最大的是多少。

## 【输入格式】

从文件 \`number.in\` 中读入数据。

输入的第一行包含一个字符串 $s$，表示小 X 给小 R 的字符串。

## 【输出格式】

输出到文件 \`number.out\` 中。

输出一行一个正整数，表示小 R 能拼成的正整数的最大值。

## 【样例 1 输入】

\`\`\`plain
5
\`\`\`

## 【样例 1 输出】

\`\`\`plain
5
\`\`\`

## 【样例 2 输入】

\`\`\`plain
290es1q0
\`\`\`

## 【样例 2 输出】

\`\`\`plain
92100
\`\`\`

## 【样例 2 解释】

$s$ 包含数字 $2, 9, 0, 1, 0$。可以证明，小 R 拼成的正整数的最大值为 $92100$。

## 【数据范围】

对于所有测试数据，保证：$1 \\le |s| \\le 10^6$，$s$ 仅包含小写英文字母及数字，且至少包含一个 $1 \\sim 9$ 中的数字。

::cute-table{tuack}

| 测试点编号 | $\\lvert s \\rvert \\le$ | 特殊性质 |
|:--:|:--:|:--:|
| $1 \\sim 4$ | $10$ | 无 |
| $5 \\sim 8$ | $10^3$ | A |
| $9 \\sim 12$ | ^ | B |
| $13 \\sim 20$ | $10^6$ | 无 |

- 特殊性质 A：$s$ 仅包含数字。
- 特殊性质 B：$s$ 仅包含不超过 $10^3$ 个数字。

:::Pagination

:::Header[CSP-J 2025 第二轮 · 座位（seat）]

# 座位（seat）

## 【题目描述】

CSP-J 2025 第二轮正在进行。小 R 所在的考场共有 $n \\times m$ 名考生，所有考生的第一轮成绩互不相同。

所有考生将按照第一轮成绩由高到低**蛇形**分配座位，排列成 $n$ 行 $m$ 列。设成绩从高到低为 $s_1 > s_2 > \\cdots > s_{n \\times m}$，则 $s_1$ 坐第 $1$ 列第 $1$ 行，$s_2$ 坐第 $1$ 列第 $2$ 行，$\\cdots$，$s_n$ 坐第 $1$ 列第 $n$ 行，$s_{n+1}$ 坐第 $2$ 列第 $n$ 行，$\\cdots$，$s_{2n}$ 坐第 $2$ 列第 $1$ 行，以此类推。

给定 $n, m$ 与所有考生的成绩 $a_1, a_2, \\cdots, a_{n \\times m}$（其中 $a_1$ 为小 R 的成绩），求小 R 的座位是第几列第几行。

## 【输入格式】

从文件 \`seat.in\` 中读入数据。

输入的第一行包含两个正整数 $n, m$。

输入的第二行包含 $n \\times m$ 个正整数 $a_1, a_2, \\cdots, a_{n \\times m}$。

## 【输出格式】

输出到文件 \`seat.out\` 中。

输出一行两个正整数，分别表示小 R 座位的列号与行号。

## 【样例 1 输入】

\`\`\`plain
2 2
99 100 97 98
\`\`\`

## 【样例 1 输出】

\`\`\`plain
1 2
\`\`\`

## 【样例 1 解释】

成绩为 $100$ 的考生坐第 $1$ 列第 $1$ 行，$99$ 坐第 $1$ 列第 $2$ 行，$98$ 坐第 $2$ 列第 $2$ 行，$97$ 坐第 $2$ 列第 $1$ 行。小 R 成绩为 $99$，故座位为第 $1$ 列第 $2$ 行。

## 【数据范围】

对于所有测试数据，保证 $1 \\le n \\le 10$，$1 \\le m \\le 10$，$1 \\le a_i \\le 100$ 且互不相同。

::cute-table{tuack}

| 测试点编号 | $n \\le$ | $m \\le$ | 特殊性质 |
|:--:|:--:|:--:|:--:|
| $1$ | $1$ | $1$ | AB |
| $2, 3$ | ^ | $10$ | 无 |
| $4, 5$ | $10$ | $1$ | 无 |
| $6$ | $2$ | $2$ | A |
| $7$ | ^ | ^ | B |
| $8, 9$ | ^ | ^ | 无 |
| $10$ | ^ | $10$ | A |
| $11$ | ^ | ^ | B |
| $12 \\sim 14$ | ^ | ^ | 无 |
| $15 \\sim 17$ | $10$ | $2$ | 无 |
| $18 \\sim 20$ | ^ | $10$ | 无 |

- 特殊性质 A：对于所有 $1 \\le i \\le n \\times m$，均有 $a_i = i$。
- 特殊性质 B：对于所有 $1 \\le i \\le n \\times m$，均有 $a_i = n \\times m - i + 1$。

:::info[出题人提示]
本题是纯模拟，关键在于把「排名」正确映射到蛇形座位：列号为 $\\lfloor (rank-1)/n \\rfloor + 1$，行号再按列的奇偶决定正数还是倒数。
:::
`
  };

  global.LuoguTemplates = LuoguTemplates;
  if (typeof window !== 'undefined') {
    window.LuoguTemplates = LuoguTemplates;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LuoguTemplates };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
