# 对 10 月 10 日审核意见的调查报告 —— 上传 PDF 的 Deep report

写给项目所有者；同时是给后续 agent 的维修指南（每一条末尾的"给 agent 的施工说明"写明文件、行号、改法、要动的测试和要改的裁决）。

分支 `deep-report-reading-helper-enhancement`，代码头 `bffa3659`（本地另有 5 个未推送的记录提交）。调查方法：经理（Fable）读了你打印的 52 页报告和你的论文；三个 Sonnet 调查员分别做了（1）用分支自己的解析代码跑你的论文并写了修复原型，（2）逐条查代码，（3）在云端起假模型的开发服务器、用真实界面上传你的论文复现；外加一个调查员查首次启动向导。四份原始报告在 `docs/reading-helper-abc/P7-01-B-*.md`、`P7-02-B-*.md`、`P7-03-A-*.md`、`P7-04-B-*.md`。经理亲自核对了每条结论对应的代码行。本轮没有改任何代码，也没有推送。

---

## 0. 一页总结

| # | 你的意见 | 为什么会这样（一句话） | 打算怎么改 | 大小 |
|---|---|---|---|---|
| R8 | 消化出来的正文是打乱的文字 | PDF 解析把同一高度的左右两栏文字焊成一行，完全不看左右位置 | 解析时先识别"两栏"，按左栏→右栏的顺序读；附带修好上标、页脚、换行标题、摘要 | 中（约 190 行 + 130 行测试） |
| R1 | 上传同意书里多余的"subscription"一句 | 旧文案，没人改 | 删掉那句和文档里的引用 | 小 |
| R2 | 命令按钮应在标题正下方 | 布局代码里"提问/地图/术语"这一组排在"决定区"前面 | 把决定区（按钮、状态句、字体控制、DOI）挪到标题下；配合 R10 把地图和问题框移到右栏 | 小→中 |
| R3 | 复制出来的笔记带一堆元数据、"Not on this page"、bibtex | 导出函数故意写的"同一张纸"格式 | 只保留标题和正文笔记；没答案的问题单列 | 小 |
| R4 | 上传的 PDF 不需要"Open the PDF" | 代码对上传件和公开论文一视同仁 | 上传页不给这个命令和 `o` 快捷键 | 小 |
| R5 | 地图和 The paper 重复 | "The paper"上方有一条把所有标题串起来的目录行，和面板里的目录栏，都在重复地图 | 删掉目录栏和那条目录行，正文保留 | 小 |
| R6 | 字体控制和 DOI 放最上面；DOI 要能点 | 它们排在决定区最末；DOI 是"点击复制"的按钮不是链接 | 随决定区上移；DOI 改成 `https://doi.org/…` 的真链接，不用模型 | 小 |
| R7 | AI 讨论浮窗去哪了 | 只有当文字栏右边剩下 ≥376px 时才贴在旁边（要 1888px 宽的窗口）；否则变成选区下面的卡片；加上正文被打乱，选中一句话常常跨"段"，按钮根本不出现 | 改成固定在屏幕右侧的浮窗；R8 修好后按钮也会正常出现 | 中 |
| R9 | Your notes 放右侧，做成按钮 | 它是右栏第一块里的一个按钮，点了跳到笔记页 | 改成屏幕右缘固定的"Notes"按钮，和 AI 浮窗排在一起 | 小 |
| R10 | Summary 和 Paper digestion 分成两页 | 页面所有块是一个平铺列表，没有"页签"概念 | 加两个页签；"Before you read"和"For your questions"放页签下方两边共用 | 大（一轮 C） |
| R11 | Before you read：放最上、显示全文、500 字、提交按钮、打字卡 | 单行输入框、限 200 字（写在 5 处）、每敲一个字整页重算一遍路线 | 改成自动长高的多行框、500 字、加 Submit；敲字后 250ms 再算路线，并缓存 | 中 |
| R12 | 新用户没看到向导，找不到填 key 的地方 | 9 月 16 日的一次改动去掉了"首次进入自动跳转向导"；现在首页只剩一个 11.5px 的灰色小链接 | 首次进入且从未设置过时自动进向导；首页的示例卡上加"Set up Peer / Add a key"按钮 | 小 |

需要你拍板的问题集中在第 3 节（Q1–Q10）。

---

## 1. 逐条说明

### R8 ｜ 消化出来的正文是打乱的文字（最严重）

**你看到的**：引言第一段是"with the fastest Li ion diffusivity and electrical conductivity Transition metal ox- ides such as LiCoO2 (LCO), Li-"；地图有 21 个"章节"，标题都是半句话；页脚"© 2026 American Chemical Society…"和"Received: September 7, 2025"混在段落里；术语条有一行以"st th th th th"开头；没找到摘要。

**为什么**：你的论文是 ACS 期刊的双栏排版。PDF 里没有"这是左栏、那是右栏"的标记，只有每个字块的坐标。我们的解析（`web/src/lib/papers/pdf-outline.ts` 里的 `linesOfPage`）把"高度相差 2.2 pt 以内"的字块合成一行，**根本不看左右位置**，两栏之间 24 pt 的空隙被压成一个空格。于是：

- 左右两栏同一高度的两行被焊成一行（第 2 页 32 行里有 21 行是这样；全文 1,267 行里有 507 行）。
- 高度错开一点的，就按从上到下交替出现（第 3 页就是这样）。
- 标题"2. RESULTS AND DISCUSSION"焊到了左栏一行的后面；两行的小节标题只认出第二行"Crystals"。
- 上标的引文编号（6.7 pt，比正文高 4 pt）自成一行，排到它所在的行前面，所以"1st, 20th, 40th"的"st th th"跑到最前面。
- 第 1 页的页脚（只出现一次，和其他页的不同）没被当成页眉页脚去掉。
- 摘要以"ABSTRACT:"这个行内小标签开头，不是独立标题行，再加上代码把第一个认出的标题（焊坏的"1. INTRODUCTION…"）之前的所有内容当作封面丢掉，摘要就没了。
- 行距被这些交错行搞乱，图注只取了第一行，剩下的掉进正文；段落被切成 528 段。

这不是模型的问题，模型拿到的就是打乱的文字。

浏览器复现（P7-03，云端用真实界面上传你的论文）：正文渲染成 498 个 `<p>`，中位数 112 个字符，其中 51% 恰好等于打印页上的一整行（左右两栏各半），只有 28% 和 PDF 的阅读顺序连续；引言第一句 27 个词里只有前 8 个连在一起。

**打算怎么改**（调查员已在草稿目录写出原型并测过）：

1. 每页先判断是不是双栏：看页面中间有没有一条从上到下连续没有墨迹的窄带（≥8 行、两侧各占页宽 30% 以上、两侧的行都填满 60% 以上）。
2. 是双栏就按"左栏从上到下，再右栏从上到下"读；横跨两栏的整行（标题、图注、摘要）作为分隔，保持原顺序。
3. 上标小字并回它所属的行；页面最上/最下的小字当页眉页脚；换行的标题并成一个；"ABSTRACT:"这种行内标签单独算一个标题。
4. 给缓存版本号加一（`upload-concepts.ts:15`，2→3），否则你已经上传过的论文会一直用旧的乱文本。**摘要还需要你重新上传一次**，因为摘要是上传时就固定写进记录的。

原型在你这篇论文上的效果：19 个真实标题从认出 5 个变成 19 个；第 2 页混栏的行从 21 变成 0；引言第一段变成"Transition metal oxides such as LiCoO2 (LCO), LiNixCoyMnzO2 (NMC), and LiMn2O4 (LMO) constitute an important class of high-capacity intercalation cathode materials for Li-ion batteries."；"1st, 20th, 40th, 60th, and 80th"回到原位；摘要找回来了；段落从 528 降到 265（再加五条清理规则到 141）。单栏 PDF 和扫描件的输出一个字都没变；相关的 165 个现有测试全部通过。

还会剩下的小毛病（下一轮再处理）：作者单位那段斜体会被认成十几个假标题（要从 pdf.js 拿真实字体名才能分辨斜体和粗体）；引文编号会黏在单词后面（"shape17"），建议直接去掉纯数字的引文上标；图注 700 字的上限现在会截断 10 条里的 6 条，建议放宽到 2,000。

**给 agent 的施工说明**（C 项，建议编号 P7-10）：
- 文件：`web/src/lib/papers/pdf-outline.ts`。替换 `linesOfPage`（:217–255）为按栏分组的版本；在 `buildOutline`（:397–494）加两条规则（页边小字、换行标题）；`page1Text` 的调用（`pdf-text.ts:248–254`）要用同一套栏信息。`readPages`（`pdf-text.ts:125–155`）不用改，unpdf 已经给出 pdf.js 的 items 和 transform。
- 原型和数据：`scratchpad/p7b1/proto/pdf-outline.ts`、`proto.diff`、`variants-patra.json`、`compat.txt`（容器重启后可能丢失；`P7-01-B-*.md` §5 完整描述了每条规则和阈值：中缝扫描页宽中央 35–65%、2 em 宽、≥8 行、填充率 60%；上标 <0.75× 行高、基线上 3.5–下 7.5 pt；页边小字 <0.8× 正文字号）。
- 测试：先写红测试——用 `minimal-pdf.test-helper.ts` 的 `minimalPdf` 造一个 2 页、每栏 24 行、第二页右栏错位 5 pt 的双栏 PDF（草稿 `scratchpad/p7b1/proto-tests/two-column.draft.test.ts`，分支上失败：96 次左右切换，期望 3 次）；再加上标、页边小字、换行标题、行内 ABSTRACT 各一个 item 级测试；现有 `pdf-text.test.ts`、`pdf-outline.test.ts`、`full-text.test.ts`、`reading.test.ts`、`upload/route.test.ts`、`report/route.private-upload.test.ts` 必须保持全绿。
- 版本：`web/src/lib/papers/upload-concepts.ts:15` `UPLOAD_CONCEPT_EXTRACTION_VERSION` 2→3。
- 第二个提交（P7-11，可选）：五条清理规则（以连字符结尾的不是标题；小数或 ≥4 位数字开头的不是编号标题；≥3 个单词的行不是公式；段落左缘取行首 x 的第 10 百分位；连续 ≥2 行 Received/Revised/Accepted/Published 丢弃）各带测试；`CAPTION_MAX`（:136）700→2,000；纯数字引文上标丢弃。"密度规则"（相邻 11 行里 ≥5 行是无编号标题则全都不算）会把设计文档从 44 节变成 37 节，先不做。
- 裁决：§3d 4 不变；新增一条裁决记录"双栏按栏读"的阈值和已知残留。

### R1 ｜ 上传同意书里的"Having subscription access alone may not grant these permissions."

**为什么**：这句话写死在同意框的勾选项文字里（`upload-consent-dialog.tsx:24–25`），`docs/PRIVATE_PDF_UPLOADS.md:47–48` 也引用了它。订阅取消后没人改。没有测试钉住它。

**打算怎么改**：删掉这句和文档里的引用。`UPLOAD_RIGHTS_VERSION`（同意书版本号，`upload-policy.ts:2`）不用升，因为这是去掉一句提醒，不是新增授权。

**给 agent**：两处删除；`upload-legal-wording.test.ts` 不受影响。

### R2 ｜ Read it here / Save / Copy 放到标题正下方

**为什么**：面板的顺序在 `reader-layout.tsx:161–167`：图版、标题、`ask`（问题框+地图+术语）、`decision`（状态句+命令+私有 PDF 状态+字体控制+DOI）、目录栏。`ask` 在 `decision` 前面是 §1f.10 的裁决。窄屏（你打印的那种单栏布局）还把摘要插在中间。

**打算怎么改**：把 `decision` 挪到标题正下方（两种布局都改），顺序改成：命令按钮 → 状态句（"Read by your model from…"）→ 私有 PDF 状态 → 字体控制 + DOI 链接（R6）。

要注意一个连锁问题：面板比窗口高时，现在是"按底部钉住"，所以决定区总在屏幕里；按钮挪到顶上以后，面板下半部分（地图、术语）会把按钮顶出屏幕。解决办法是配合 R10：把"Before you read"和地图移到右栏页签下面，面板就短了，按顶部钉住即可。

**给 agent**（和 R5、R6、R9、R10 同一轮，P7-14）：`reader-layout.tsx:135–145`（窄屏）和 `:161–167`（宽屏）交换 `ask`/`decision`；`decision-block.tsx:84–119` 里把命令行（:109–119）提到状态句（:84–107）前面；更新文件头注释和 `ask` 槽注释（:25–27）；`globals.css:551–557` 的 `reader-panel` 改为按顶部钉住。没有测试钉住面板顺序；`for-your-questions.test.tsx:209–232`、`page.terms.test.ts:34–40` 钉的是 `page.tsx` 的属性顺序，不受影响。裁决 §1f.10 作废。

### R3 ｜ 复制（`c`）出来的笔记带元数据、"Not on this page"、bibtex

**为什么**：`reading-markdown.ts` 的 `readingToMarkdown`（:335–495）是按"和页面同一张纸"的设计写的：开头 YAML 元数据（:349–367），末尾"## Not on this page"（:479–491）和 bibtex 块（:493）。这是 P2-05/§1g.6 定下的，当时想让笔记可以进 Obsidian。

**打算怎么改**：删掉这三部分，保留"# 标题"、模型的 skim、摘要、决定句、"For your questions"、各报告段落。没有答案的已提交问题，现在只出现在元数据的 `questions:` 里，删掉后会消失——改为在没有报告时输出一个"## Your questions"列表。

**给 agent**（P7-12）：删 `:349–367`（保留 `# title`）、`:479–491`、`:493` 及其死代码（`yaml`、`BLOCK_NAME`、`REASON_PHRASE`、`REASON_ORDER`、`buildBibTeX`、`extractYear`）；`page.tsx:1129–1137` 的 `omitted`/`generatedAt` 参数可去。测试：`reading-markdown.test.ts` :26–42、:74–75、:80、:114、:128–170、:172–195、:197–204、:207–219 要重钉或按"主题已删除"的名义删除；`reading-markdown.questions.test.ts` 的 `frontmatter()` 辅助、:315–347 的 sha256 整体钉、:353–392 整个 describe。裁决 §3d 12、§1g.6 修订；`docs/PRODUCT_DIRECTION.md:32, 148` 加一句"`c` 复制按所有者要求不带 front matter；Obsidian 笔记模板（`lib/notes/templates.ts`）仍带"。

### R4 ｜ 上传的 PDF 不需要"Open the PDF"

**为什么**：`reading.ts:554–567` 的 `pickSource` 对任何"读到的 PDF"都返回"Open the PDF"，指向私有文件路由 `/api/papers/upload/<id>/file`；`reader-commands.tsx:77–98` 只要有 `source` 就画这个按钮并绑 `o` 键。上传件没有被区别对待。

**打算怎么改**：上传页不传 `source`、不注册 `open`，脚注快捷键栏去掉 `o open`。去往出版社页面的入口由 R6 的 DOI 链接承担。

**给 agent**（P7-12）：`page.tsx:1388` 改 `source={isUploadId ? null : reading.source}`；`:1164–1178` 仅在 `!isUploadId` 时注册 `open`（和 `skip` 同样的守卫）；`reader-keys.ts:79–81` `paperKeysFor({upload:true})` 去掉 `open`。不要改 `pickSource`（会改共享的 reading 缓存版本）。测试：仿 `page.upload-skip.test.ts` 加源码钉；`reader-keys.test.ts:197–199, 305–311` 改期望；`key-legend.test.tsx` 复查。

### R5 ｜ 地图和"The paper"重复

**为什么**："THE PAPER"出现在三处：面板里的目录栏 `paper-contents.tsx`（只在宽屏，列出全部标题）；正文上方的一条把全部标题用"·"串起来的行（`paper-body.tsx:633–635`，只在窄屏，就是你打印件第 4 页看到的那行）；以及"Read from PDF · 21 sections · 10,908 words"计数行（:636–638）。地图（`reading-map.tsx`）已经按同样顺序列出同样的章节，还多了页码、分钟和每段第一句。

**打算怎么改**：删掉目录栏和那条标题串；"Read from PDF · 10,908 words"并进地图的汇总行；正文本身保留（它是高亮、Explain、Say it plainly、引文跳转的载体，删了这些全坏）。"The paper"这个标签作为正文的标题保留。

**给 agent**（P7-14）：删 `paper-contents.tsx` 及其在 `page.tsx:102, 1408` 的导入和挂载、`reader-layout.tsx` 的 `contents` 槽（:30–32, :166）；删 `paper-body.tsx:633–635`；计数并入 `copy.ts:151–152` 的 `MAP.summary`。测试：`paper-body.test.tsx:37`、`paper-body.plain.test.tsx:76, 79` 三个快照重钉；`route-tint.test.tsx:151–165, 157, 226, 236, 245` 删除或改指向地图行。裁决 §1a.5(d)（目录栏着色）由所有者本次决定撤销；§1f.13、§3d 8 的三处着色面改为两处（正文标题、地图行）。

### R6 ｜ 字体控制和 DOI 放最上面；DOI 做成真链接，不用 AI

**为什么**：两者是决定区的最后两项（`decision-block.tsx:122–142`）。DOI 现在是一个"点击复制"的按钮（`<button onClick={onCopyDoi}>`），带链接图标但不是链接。上传件的 DOI 已经是不用模型得到的：`upload/route.ts:48` 用正则 `10.\d{4,9}/…` 在第 1 页文字里找（:206–210），存进记录（:294）。

**打算怎么改**：随 R2 一起上移；DOI 改为 `<a href="https://doi.org/<doi>" target="_blank" rel="noopener noreferrer">`。`doi.org` 会自动转到出版社页面，不需要任何网络请求或模型。为防正则抓多了造成坏链接，渲染前校验形如 `10.xxxx/…`。

**给 agent**（P7-12）：`decision-block.tsx:124–142` 改为 `<a>`，保留图标和等宽字体类；删 `onCopyDoi`、`copyDoi`（`page.tsx:1146–1155`）、`DOI.copy`、`TOAST.doi`（`copy.ts:359–365`）；`decision-block.test.tsx:46` 去掉 `onCopyDoi`，新增一个"渲染为 https://doi.org/ 链接"的测试。

### R7 ｜ AI 讨论浮窗去哪了

**为什么**：浮窗（`explain-box.tsx`）的位置规则 `placePanel`（:256–265）是：只有当"文字栏右边还剩 ≥376 px"时才贴在文字旁边作为侧栏；否则变成选区下面的一张 360 px 卡片。main 合并后的新布局在 1440 宽只剩 208 px，要到 1888 px 宽的窗口才会出现侧栏。你的屏幕看到的是"选区下面的卡片"，不是"右侧的窗"。这个阈值是实现者的选择，不是裁决；BACKLOG-14 一直在等你的决定。

另一个原因让它看起来"没了"：按钮只在选区落在**同一个段落**里时出现（`paper-body.tsx:254–306`），而你这篇论文被解析成了 528 个两行的"段落"，选一句话经常跨段，按钮就不出现。R8 修好后这一点自然恢复。

**打算怎么改**：改成固定在屏幕右缘的浮窗（dock）：窗口 ≥1024 px 时，固定在右侧、顶部在页眉下、高度到页脚，宽 360 px，盖在页面右边缘上（1440 宽时会盖住文字栏最右 168 px）；手机仍是底部弹层。第二步（可选）：浮窗打开时让页面让出宽度。

**给 agent**（P7-15）：`explain-box.tsx:256–265` 新增 `kind: "dock"` 分支（left = 视口宽 − 360 − 16，top = 页眉下，height 到页脚），`SIDE_ROOM` 判断改为 dock；`measureBodyColumn`（`paper-body.tsx:592–596`）和 `column` 参数在 dock 下不再需要。测试：`explain-box.test.tsx` 的 `placePanel` 表（含 376 边界）、`explain-box.flow.test.tsx`、`.thread.flow`、`.search.flow`、`.brevity.flow` 里的 kind 名称、`paper-body.column.test.ts`、`page.explain.test.ts:40–47`。裁决：§1a.10、§1h.3、BACKLOG-14 关闭，§3d 14 修订。

### R9 ｜ Your notes 放最右侧，做成按钮

**为什么**：`paper-notes.tsx:49–53` 是右栏第一块里的一个按钮（"Take notes"/"Open your notes →"），点击 `router.push('/notes/<id>')` 跳到整页的笔记编辑器（1,574 行的组件）。

**打算怎么改**：改成屏幕右缘固定的"Notes"小按钮，和 AI 浮窗排在一起（上下错开），点击仍然打开笔记页（创建首条笔记的逻辑不变）。把笔记做成右侧抽屉和 AI 窗并排，要把整个编辑器嵌进来，是大改，先不做。

**给 agent**（P7-14）：从 `PaperNotes` 抽出 `open()`，在 `page.tsx` 与 `ExplainBox` 并排挂一个固定按钮组件；从 `additions` 里移除 Band。测试：`paper-notes.test.ts`（钉在 `additions` 里的挂载和 `questions`/`forYourQuestions` 两个 prop）、`for-your-questions.test.tsx:209–232` 改指向新位置；P2-05 的 `readingNote(..., {questions, forYourQuestions})` 调用必须保留。

### R10 ｜ Summary 和 Paper digestion 分成两个页签

**先纠正一个前提**：打开 Deep report 以后，"What it proposes / How it was done / What they found / Where it is thin / For your project / Next step"是**从全文**写出来的，不是摘要级（`report/route.ts:619–695` 用全文调 `generateDeepReport`，每条结论都在正文里核对过原句；你页面上的那句"Read by your model from the full text (PDF, 19 pages)"说的就是这个）。只有关掉 Deep report 时它们才来自摘要。所以这个分页是按"呈现方式"分，不是按来源分："Summary"= Peer 写的报告，"Paper digestion"= 读原文的辅助。页签这样命名没问题，但不要以为 Summary 只用了摘要。

**为什么现在没有**：页面是一个平铺列表（`page.tsx:1318–1542` 填进 `ReaderLayout` 的几个槽），没有任何"模式"状态。

**打算怎么改**：
- 有全文的论文（上传件、读到 PDF/HTML 的公开论文）在标题区下方显示两个页签按钮 `Summary` / `Paper digestion`；没有全文的论文不显示页签（和现在一样）。默认页签：有全文时 Paper digestion（Q5 请你确认）。
- 页签下方、两个页签共用：Before you read（问题框，R11）和 For your questions（答案）。
- Paper digestion：地图、术语、正文。
- Summary：skim/摘要、What it proposes、How it was done、What they found, and how big、Where it is thin、For your project、Next step、At a glance、Related from your feed、The record、In your library。
- 不显示的那一组直接不渲染（省掉打字时的重算），并处理好跨页签的跳转：`t`/Read it here 先切到 digestion 再滚动；引文上的"§章节"链接从 Summary 点击时先切页签；"已读"判定的观察对象改成随页签；`useReveal` 加 `tab` 依赖；切页签时清空 Explain 的选区。

**给 agent**（P7-14，最大的一项）：`page.tsx` 加 `const [tab, setTab] = useState<"summary"|"digestion">`，仅当 `hasBody`；`reader-layout.tsx` 加 `tabs` 槽（面板里标题和决定区之下）；按上表把 `additions` 拆成两组；`page.tsx:673–682` `readHere`、`evidence-quote.tsx:19–34` `SectionLinks`、`:1036–1067` 已读观察、`:1078` `useReveal`、`:782` `explainTarget` 各加一个小处理。页签状态如要记住，放 `store/reading-prefs.ts`。测试：`for-your-questions.test.tsx:209–232`、`paper-notes.test.ts`、`page.terms.test.ts:31–40`、`question-field.standing.test.tsx:110–117`、`page.explain.test.ts`、`page.plain.test.ts`、`page.paragraph-guide.test.ts` 的源码顺序钉要重钉；新增页签切换、跨页签跳转、无全文不显示页签的测试。裁决：§1f.10、§1f.12、§1g.15(d)、§3d 9（答案在 Decision 之后 What it proposes 之前）修订；§1a.4"永远可读"补一句"页签不是隐藏"。

### R11 ｜ Before you read：位置、显示全文、500 字、提交按钮、打字卡

**（a）单行、200 字**：每行问题是 `<input type="text" maxLength=200>`（`question-field.tsx:393–430`），在 320 px 的面板里只能看到约 40 个字，其余藏在左边。200 这个数写在 5 处：`store/reading-questions.ts:21`、`lib/papers/deep-report.ts:67`、`app/api/papers/report/route.ts:55`、`copy.ts` 的 `ASK.counter`、两处 `COUNTER_FROM = 160`。

**（b）打字卡**：每敲一个字，键盘事件 → 写入 store（zustand 的 persist 会把**所有论文**的问题整个序列化写进 localStorage）→ 整个页面重渲染（`page.tsx:662, 965` 订阅了 store）→ `tier0Route`（:672）对**已存的每一个问题**（最多 5 个）在**整篇正文**上重算路线（每个问题 22 ms，五个 100+ ms）→ 术语扫描因为 scope 对象每次都是新的而重跑（40 ms）→ 正文的几百个段落、地图、术语条全部重渲染。开发模式下 React 的 Strict Mode 还会把这些 memo 算两遍。调查员在和你论文同样大小的合成文本上测到每个按键 141–156 ms 的纯计算，加上渲染约 160–190 ms；浏览器里实测（云端开发模式、假模型、你的论文）：连打 60 个字符用了 17.4–19.0 秒，**每个按键约 290–320 ms**（普通输入框是 98 ms），出现 44–48 个长任务、最长 0.5–0.7 秒，每个按键引起 14–15 次 DOM 改动，最后一次改动在最后一个按键后 0.4–0.7 秒才落下；正文滚出视野也没有差别，说明是整页重算而不是绘制。这就是 BACKLOG-24 记录的问题，当时留给你决定。

**（c）没有提交按钮**：问题框现在靠"离开框 1.5 秒后"、"在空行上按 Enter"、点 × 或打勾来"结算"（`question-field.tsx:190, 202–206, 304–317`），结算后才写入偏好账本、才向模型发请求。这是 §1g.18/§1g.21/§1h.15/§1h.16 的设计。

**打算怎么改**：
- 输入框改成自动长高的 `<textarea rows=1>`，粘贴进来的换行折成空格；放到页签下方（R10），宽度随右栏，能看到全部内容。
- 上限 200→500：五处常量一起改，计数从 400 开始显示。Profile 的"常备问题"是否也到 500（Q7）。
- 框的右边加 **Submit** 按钮：点击立即结算（等于现在点 × 的那条路径 `settleQuestions`）。**去掉"离开框 1.5 秒自动结算"**，这样不会在你只是点了一下别处时就用你的 key 发请求；空行上按 Enter 仍然等于提交（Q8 请确认是否保留）。无 key 时按钮照常显示，只是结算后只写账本。
- 卡顿：页面不再直接订阅每个按键，而是用一个 250 ms 的防抖订阅（输入框自己仍然每个字都存，持久化不变）；术语扫描的 scope 用章节 id 的字符串做 key，不再每次新建对象；路线按"正文 + 问题文本"缓存，敲一个字只重算正在打的那一个问题。三条加起来，每个按键接近零成本。

**给 agent**（P7-13）：`question-field.tsx:393–430` input→textarea（`focusFirstEmptyQuestion` :230 的选择器 `input[data-ask-line]` 改 `[data-ask-line]`；`setSelectionRange` :285 可用）；五处 200→500，`COUNTER_FROM` 160→400；Submit 按钮调用 `settleQuestions`（:221–224），删 `settleBoxSoon`/`BOX_IDLE_MS`（:190, :304–317）和 pagehide 结算（:296–327）；新 hook `useDebouncedQuestions(paperId, 250)` 替换 `page.tsx:662, 965` 的直接订阅；`page.tsx:700–704` 的 `termScope` 改为按 `sectionIds.join()` 做 memo key；`reading-map.ts:392–409` `routeByQuestions` 外加一层按 (body, question) 的缓存（保持纯函数）。测试：`question-field.test.tsx:113–124`、`store/reading-questions.test.ts:44–55`、`store/profile.standing.test.ts:26–31`、`standing-questions-field.test.tsx:49`、`question-examples.test.ts:101`、`deep-report.passes.test.ts:369–382`、`report/route.questions.test.ts:106`（200→500）；`question-field.settle.test.tsx` 整体改写（去掉"离开后 1.5 秒结算"、"离开页面时结算"的 describe，新增"点 Submit 立即结算、只发一次请求、取消等待"）；`question-box.flow.test.tsx:221–300`、`use-model-report.effects.test.ts` 的 unload 测试同改；新增 hook、scope、缓存的测试。裁决：§1a.1（≤200）、§1f.9、§1f.13、§1f.18(a)（实时着色改为 250 ms 后）、§1g.11、§1g.18、§1g.21(5)(6)、§1h.15(c)(e)、§1h.16(f) 修订；BACKLOG-24 关闭。`lib/scoring/term-expand.ts` 里缓存正则属于 §1b 保护区，本轮不动。

### R12 ｜ 新用户没看到向导，找不到填 key 的地方

**为什么**：2026-09-16 的提交 `f020a4b3`（"feat(first-run): open on a paper, not a form"）去掉了首次进入自动跳转 `/welcome` 的逻辑，提交说明写着"FirstRunGate no longer redirects; /welcome is a page, not a gate"，依据是 `ABC-JEV-INTEGRATION.md:2909` 的"零设置首次运行"裁决。现在 `FirstRunGate`（`first-run.tsx:60–81`，挂在 `layout.tsx:151`）只做一件事：有主题就补写 `onboardedAt` 标记。首页通往向导的唯一入口是示例卡角落里一个 11.5 px、对比度 3.1:1 的灰色链接"is here."（`starter-strip.tsx:75–83`）；用户点一下任何领域标签，这张卡就永久消失，首页从此没有任何通往 `/welcome` 的链接，也不提 key。从首页到 key 输入框：走向导要 5 次点击；走 Profile → Edit 要 2 次点击加滚动约 1,500 px；没有一条路径的 key 框是首屏可见的。

**打算怎么改**（需要你确认，因为这推翻 9 月 16 日的裁决，Q9）：
- 首次进入且完全没设置过（没有 `onboardedAt`、没有主题、没有 key、没有点过"Skip setup"）时，自动进入 `/welcome` 向导，等 store 水合完成后再跳以免闪烁；向导里"Skip setup →"仍可跳过，跳过也记一个标记，不再二次打扰。
- 首页示例卡上加两个真正的按钮"Set up Peer"和"Add a key"；再加一条可关闭的"Add a key"提示行，用户点了领域标签后仍然在。

**给 agent**（P7-16）：`first-run.tsx` 的 `FirstRunGate` 加 redirect 分支（`pathname !== "/welcome"`、`settled`、无 `onboardedAt`/主题/key/`welcomeSkipped`）；`store/profile.ts` 加 `welcomeSkipped` 字段，向导的 Skip 和完成都写；`starter-strip.tsx:70–86` 把灰链接换成两个按钮；README 和 `OWNER-REPORT.zh-CN.md` 里"首次打开会显示 /welcome"的说法以及 `first-run.tsx` 里描述 redirect 的注释一并更正。测试：`first-run` 的现有测试（补写标记的行为保留）+ 新的 redirect/skip 测试；`starter-strip` 的测试。

### 你没提、但调查中看到的

- **顶部空白的图版**：你打印件第 1 页顶部是一个带"Figure 4."图注的空框。代码里图像缺失时并不会画空框（会退回到"术语图版"或不画），所以这是**取到了图片 URL 但画出来是空白**——很可能是图片提取的 Python 助手在你电脑上跑了，但裁到了没有图的区域。云端没有装 PyMuPDF，调查员没法复现这一点；请你在那一页按 F12 → Elements 找到顶部的 `<img>`，把它的 `src` 开头（`data:image/…` 的前 30 个字符就够）和 `naturalWidth`/`naturalHeight` 告诉我。这是另一个 bug，和 BACKLOG-01 不同。
- 术语条把乱文本的片段当"论文原文定义"引用、地图给片段标题分配 setup/evidence 角色，都是 R8 的后果，不用单独修。

---

## 2. 建议的施工顺序

每一项一个 C（Sonnet）回合，经理逐项核对（读 diff、四道门禁、自己改坏一行看测试变红、Vercel 预览），最后一轮 A 用你的论文在浏览器里重新测量：

1. **P7-10** R8 核心（按栏读、上标、页边小字、换行标题、行内 ABSTRACT、双栏测试 fixture、版本号 +1）
2. **P7-11** R8 清理规则、图注上限、引文上标（可选，各带测试）
3. **P7-12** 小项合集：R1 文案、R4 去掉 Open the PDF、R6 DOI 链接、R3 复制输出
4. **P7-13** R11 问题框：textarea、500、Submit、防抖与缓存
5. **P7-14** 布局：R2 决定区上移、R5 删目录栏、R10 两个页签、R9 Notes 按钮
6. **P7-15** R7 右侧 AI 浮窗
7. **P7-16** R12 首次启动向导
8. **P7-17** A：用你的论文在浏览器里按 §3d 重新测量

P7-12/P7-13 和 P7-10 互不相关，可以并行。

修完之后，**你需要重新上传这篇论文**（版本号 +1 会让缓存失效，但摘要只在上传时写入）。

---

## 3. 需要你拍板的问题

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | R2 决定区上移后，窄屏（手机）也改吗？现在窄屏把摘要放在决定区前面是为了读屏软件的顺序。 | 也改，保持一致 |
| Q2 | R3 复制输出：决定句（"Read by your model from…"）和摘要下的"From the abstract"小字也删吗？标题下要不要保留一行 `DOI: …`？ | 保留决定句，保留一行 DOI，其余删 |
| Q3 | R5 "The paper"这个标签作为正文标题保留吗？ | 保留 |
| Q4 | R7 浮窗盖在页面上（简单），还是打开时页面让出宽度（多一轮）？ | 先盖在页面上 |
| Q5 | R10 默认页签：有全文时默认 Paper digestion？ | 是 |
| Q6 | R10 "For your questions"放页签下方两边共用，还是只在 Summary？ | 两边共用（它回答的是你的问题） |
| Q7 | R11 Profile 的常备问题也放宽到 500 吗？ | 是，同一个常量 |
| Q8 | R11 去掉"离开框 1.5 秒自动结算"后，空行上按 Enter 还算提交吗？ | 算（和 Submit 一样） |
| Q9 | R12 恢复首次自动进向导，推翻 9 月 16 日的"零设置首次运行"裁决？ | 是，但只对完全没设置过的用户，且可跳过 |
| Q10 | 施工期间是否允许我把修复推到一个单独的测试分支（需要你批准新建分支），方便你在笔记本上拉下来测？否则你拉不到修复。 | 允许，分支名 `deep-report-reading-helper-fixes` |

你回复 Q1–Q10（也可以只说"都按建议"），我就开始派 C。
