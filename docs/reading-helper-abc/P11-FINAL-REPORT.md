# P11 阅读助手(Peer)——最终报告 / Final report of round P11

日期 2026-10-22。分支 `reader-three-pane-p11`,草稿 PR [Aspen-Lab/peer#35](https://github.com/Aspen-Lab/peer/pull/35)(**未合并,也未推到 main**,等你自己看过再决定)。

## 一、给 Peter 的结论(中文)

**两个主题都已在连续两轮达到你定的线(每个主题 ≥ 97.9,允许每轮一处 0.25 的小瑕疵),循环结束。**

| 主题 | 达标的两轮 | 分数(三位独立评分员的中位数) |
|---|---|---|
| 三栏布局(左中右、拖边界、返回论文) | 第 5、6 轮 | 97.92、100.00 |
| 右栏(解释 / 笔记 / 图片 / 高亮) | 第 6、7 轮 | 97.92、97.92 |

**这是我(管理者)的衡量,你自己看一遍界面才是最终验收**。我没有合并 PR,也没有动 main。

你 10-19 提的 8 条要求,现状:
1. **图片点击放大到右栏**(可缩放、拖动、X 关闭,与笔记/解释同时打开时叠放):已做并通过;窗口变窄再变宽图片卡片能回来。
2. **左中右三栏像 Claude 一样,可拖边界,字不变大小只重排**:已做;拖动、收起/固定左栏、换字号时**正在读的那一行留在原位**;长词(如化学名)在行内断开不超栏;提问框随宽度和字号自动调高,多行问题不再被截。
3. **Open your notes 里"Saved"改成"Back to paper"**,回到原来的 Summary / Paper digestion 页并停在原位置:已做。
4. **截图 1 的 bug**(Explain 框报 "Maximum update depth exceeded"):已修;最后一轮在 372 项页面检查和 540 次压力循环(B11)里 0 次再现,0 个页面错误。
5. **选中文字才出现 Explain this / Take notes 两个小按钮,没选时右栏是空的**:已做;按钮和选区同高、不盖卡片上的任何按钮或标题;Esc 先收起选区再关卡片;拖选、三击、Shift+点击、松手在页脚/窗口外/右栏/分界线上都只选到正文边缘,不再误选全文。
6. **目录在 Paper digestion 里出现在左边**:已做(左栏地图),词和次数(如 LCO ×6)不再被拆行。
7. **"say it plainly 先单独推上 main"**:**没有做**——这一条要你来定,PR 还是草稿。
8. **Highlight 按钮、可改颜色、对比度足够、默认亮黄 + 黑字,记录进笔记**:已做,Summary 和回答里也能高亮;跨两段的选择不显示点了没反应的"高亮"。

**质量数字:** 568 个测试文件 / 10,636 个测试全过(另有 3 个跳过),构建 0 错,类型检查 0 错,lint 0 错 / 144 警告(与基线持平);每个修复都由我自己做过一次"去掉修复 → 测试变红 → 原样还原"的验证;没有删减或削弱任何已有测试。隐私检查(51 组字符串)在日志和缓存里 0 命中,你的论文 PDF 只通过上传界面使用,没有被复制、引用或提交。

**需要你来定的事**(都不影响达标):
- **BACKLOG-114(新,小):** 三击一段后拖到**左栏**松手,100 次里有 12 次选区落在左栏里、不出按钮(普通拖选 100 次全部正常)。与已修的"页脚条误选"同类。要不要修?(只改 `keep-selection.ts` 一个文件。)
- **按钮盖住卡片文字**(237–238 / 607 次选择:Explain 卡片的引文、图注、便签):不盖任何按钮或标题字,选区一撤就回来。我们按你批准的"一处 0.25"处理,没修(避开它要把按钮挪离选区 60–580 px)。一位评分员把它算成 1.0,我裁定仍为 0.25。
- **图片 Fit 的宽度**:七种窗口宽度下图片只占右栏 0.70–0.96(窗口窄时不到满宽)。是"尽量大但不出滚动",还是"撑满右栏"?
- **Explain 卡片只解释所选文字的前 1,200 字**,要不要在卡片上说出来?
- **摘要里两条相同的引文**(BACKLOG-108):保留还是去重?
- 小项:标题 4 行截断;窄窗口下"Open as page"只显示图标;1024 宽时右栏最小=最大=280;左栏默认宽 320 还是 360;边缘标签平时的字。
- **BACKLOG-111:** 窗口窄于 1024 时是单栏页面,不挂载选区保持/页脚条修复(行为与以前相同,没变差)。
- 两条测试小问题(BACKLOG-112 一段死分支、BACKLOG-113 一个测试名字不准),无用户影响。

**过程里要如实告诉你的几件事:**
- 停止线是你中途改的:起初要求每个主题 ≥ 99,你于 10-21 决定"允许一处 0.25 的小瑕疵",改为 ≥ 97.9。按旧线,第 3、5 轮的 97.92 不算过。没有任何一个扣分是为了凑线而压低的;评分员之间的分歧(如那个 1.0)都写进了裁定。
- 容器重启 3 次(两次因为会话磁盘配额用满),丢过两次走查,已重跑;代码和记录没有丢失。已清理磁盘并在交接书里加了规则。
- 一次"7 条之一"的字面实现被实现者实测否决(会让 113 个无关位置落点下移一行),我采纳了实现者更窄的做法(§1h.176)。

## 二、English summary

Both themes have met the owner's line (≥ 97.9 per theme, one 0.25 extra allowed per theme per round, §1h.163) in two consecutive rounds. **The loop ends as the manager's measure; the owner's own look at the surface is the acceptance above it.** PR #35 stays a draft; nothing was merged or pushed to main.

| round | head | Theme A (three panes) | Theme B (the margin) |
|---|---|---|---|
| 1 | 2d7a89b9 | 81.25 | 79.17 |
| 2 | 508f0efc / 8f7e051f | 95.83 | 85.42 |
| 3 | cab04c0c | 97.92 | 93.75 |
| 4 | dd366d8d / a7a58224 | 91.67 | 95.83 |
| 5 | 9e23d63a | **97.92** (pass 1) | 95.83 |
| 6 | d68ddd73 | **100.00** (pass 2, walking ends §1h.177) | **97.92** (pass 1) |
| 7 | ae2fbe42 (= d68ddd73 in `web/`) | — | **97.92** (pass 2, loop ends §1h.179) |

Scores are the median of three blind readers; the director's reading and the reviewer's own walk are recorded beside them in `P11-RUBRIC.md` (Scores). Rulings: `ABC-DEEP-REPORT-READING-HELPER.md` §1h.111–§1h.179. Hand-off and work log: `HANDOFF-P11.md`.

**Gates at the end (d68ddd73 code, unchanged since):** build 0; `tsc` 0; lint 0 errors / 144 warnings (the baseline cap); full suite 568 files / 10,636 tests + 3 skipped, run with `TZ=America/Chicago`; every landed item verified by the manager with its own mutation (rule disabled → test red → byte-identical restore) before landing; no test deleted or weakened.

**Standing costs (accepted, not defects):** the three-button group stands over words of an open card's content (237–238 of ~607 selections beside a card; 0 controls, 0 header words) — the owner's allowance (§1h.163, §1h.168; B P11-58 measured every rule that clears the words moves the group 60–580 px from its line); a selection across two body paragraphs offers nothing and across two Summary blocks offers no Highlight (D5, §1h.112 / §1h.155 / §1h.166 (b)).

**Open, for the owner:** BACKLOG-114 (triple click then a drag released over the left pane, 12 of 100 — same family as the foot-legend fix; one file); BACKLOG-108, -111, -112, -113; the Fit width of a figure in the margin; whether the Explain card should say it read the first 1,200 characters; the title clamp, the "Open as page" glyph at 1024/1093, the margin minimum at 1024, the left pane's default width, the edge tab's resting word. Item 7 of the owner's file (push to main plainly and on its own) is the owner's to do.

**Caveats:** Chromium only was measured. Every walk used a stubbed model (no live model call, no key). The owner's PDF was used only through the upload UI. Three container restarts (two from the session's disk allowance) cost two walks, which were re-run in full.
