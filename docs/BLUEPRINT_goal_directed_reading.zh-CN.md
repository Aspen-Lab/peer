# Blueprint — 带着问题读（Goal-directed reading）

**Status:** Approved for implementation, 2026-10-05（作者拍板，见 §8）。只针对 web 端的 paper reader / deep report。
**读者：** 先给作者自己用。不考虑迎合大众；作者自己觉得顺手，才算第一步做对。
**上游约束：** `docs/PRODUCT_DIRECTION.md`、`VISION.md`、`README.md` §"Deep paper reports"。本文不改任何已锁定的决定，只在它们之上加一层。
**实施状态：** `ABC-DEEP-REPORT-READING-HELPER.md`（共享状态文件，§1 永远是真相）。

---

## 0. 这份蓝图回答什么

作者对"上传 PDF → deep report"的下一步提出了三个痛点（原话见 §2）。本文做三件事：

1. 盘点 `main` 上 reader / report / upload / notes 已经有什么、缺什么（§1）。
2. 把痛点翻译成产品原则，并给出一个叫 **"带着问题读"** 的方案（§2–§4）。
3. 给出最省力的实施顺序：先做不要 model key 的部分，再加 Tier 2（§5–§7）。

> 本次只能看到 GitHub `origin/main` 和当前分支。若本地 repo 有未 push 的分支或改动，本文没有计入。

---

## 1. 现状盘点（main，2026-10-05）

### 1.1 三个 surface 里只有 web 是活的

| Surface | 状态 | 和阅读有关的功能 |
| --- | --- | --- |
| `web/`（Next.js） | 活跃，所有阅读功能都在这里 | 全部 |
| `Peer/`（SwiftUI） | 早期原型，mock 数据，无网络调用 | 无（只有 feed 卡片和详情页） |
| `python/`（peer-news CLI） | 原始 MVP，Tier 0，只产 Markdown/Obsidian | 无 PDF、无 report |

### 1.2 一篇 paper 打开后发生什么

**阶段 A：reading（Tier 0，不要 key，所有人共享，edge 缓存 1 天）**
`lib/papers/reading.ts` → `buildReading()`。只用 paper 记录 + 全文，不用任何 profile。产出：

- 摘要逐句 + "ink marks"（regex 选出的 claim / 数字 / 意义句，`skim.ts`）
- findings ≤3、method ≤2、caveats ≤3，全是 regex 从 results / methods / limitations 抽出的原句，带 section heading
- `body`：整篇正文按段落，图和公式放回原位
- `omitted`：每个缺失块都有类型化原因，页面据此生成一句"Peer 读到了什么/没读到什么"

**阶段 B：deep report（Tier 2，走用户的 key 或 Peer 的 model）**
`lib/papers/deep-report.ts`，两趟：

- Pass 1（small model）：全文 >10k 字时，按 canonical bucket 喂整篇，要求返回**逐字**的 signal 句子（novelty / results / methods / prior-work，各 ≤6）。
- Pass 2（large model）：用 Pass 1 的句子（短文直接喂全文）+ 摘要 + ≤8 条图注，按固定 schema 产出 `PaperReport`：`skim`、`whatItProposes{summary, methods, newHere}`、`resultsAndSignificance{summary, keyResults[{title, detail, evidence, novelty}]}`、`limitations`、`nextStep`、`relationToYourWork`（只在 profile 有 project 时出现）、review 论文另有 `reviewContents`。
- 验证（`evidence.ts`）：每条 claim 的 `evidence` 必须在摘要 / 各 section / 图注里找到逐字子串（≥40 字符，或首 80 + 尾 40），找不到就**丢掉并计数**，并记下 `evidenceWhere`（section heading 原文）。summary / newHere / novelty 不验证，页面标为 Peer 的话。

**页面顺序**（`app/papers/[id]/page.tsx`）：plate + 标题 → skim / lead claim → 摘要（默认折叠）→ Decision block（一句可得性说明 + 按钮）→ Notes → What it proposes → How it was done → What they found → For your project → At a glance → Related → Where it is thin → Next step → **The paper**（全文）→ The record → In your library → Next。

### 1.3 用户意图目前进到哪里

- `currentProject + currentChallenges` → `readerProject` → 只用来开关 `relationToYourWork`。
- `researchTopics + preferredMethods` → `contextHint`/`userContext` → **prompt 里没有任何规则引用它**，等于没用。`preferredMethods` 有 setter 没有 UI，所以永远为空。
- Pass 1 完全不知道用户是谁。
- **没有任何"这篇我想得到什么"的输入。** feed 的 intent 不进 reader。

### 1.4 上传 PDF 的路径（作者的主场景）

- `POST /api/papers/upload`：hash → `upload:<sha16>`，落盘到 `web/.local-data/uploads/`，owner 隔离，30 天过期。可以是独立 paper，也可以是 DOI/标题匹配后挂到已有 paper 上的 supplement（强匹配直接绑，弱匹配弹确认）。
- 文本抽取：**上传走 Python `scripts/extract_pdf_text.py`（PyMuPDF）**，URL PDF 走 TS `pdf-outline.ts`（pdf.js）。两者差距很大：

| | URL PDF（`pdf-outline.ts`） | 上传（Python） |
| --- | --- | --- |
| 标题识别 | 字号 / 字体 / 编号推断，任何 heading 都认 | ~30 个白名单词，编号小节不拆 |
| 段落 | 保留（行距 / 缩进推断） | 全并成一行 |
| 公式 | 抽出并放回 | 无 |
| 图注 | 多行完整，带页码，放回正文 | 页码被丢，正文不放图 |
| 每个 section 的页码 | **抽出了，但 `normalize()` 丢掉**（`ExtractedSection` 没有 `page` 字段） | 同样抽出、同样丢掉 |

- **每次打开都重做一遍，而且每次都扣一次 deep report 额度。** 上传的 PDF 服务器只存原文件 + 一个小记录（标题、DOI、页数、400 字符摘要、≤12 个短语），不存全文、不存 section、不存图。`full-text.ts:326-331` 和 `figures/extract.ts:1410-1415` 对 `upload:` id 跳过缓存；浏览器端对私有 PDF 也不缓存 reading / report（`use-reading.ts:98-128`、`use-model-report.ts:185-188`）。结果：一次页面访问跑至少两次文本抽取 + 一次图抽取；**挂在已有 paper 上的 PDF 永远走 deep，每次访问都再花一次 deep report**（free 每月 5 次；BYOK 也照扣，`report/route.ts:644-666`）。
- 独立上传（没挂到 paper 上）只有 Profile 的 "Deep report" 开关打开时才走 deep，否则 report 只基于那 400 字符的摘要。
- 线上（Vercel）根本没有 Python；本仓库的云容器也没有 PyMuPDF。Python 文本抽取只在作者本机能跑。

### 1.5 周边已经有、可以直接复用的东西

- **逐字证据 + 验证**（`evidence.ts`）：任何新加的"指向论文某处"的输出都应该过这一关。
- **section 归属**：`evidenceWhere` 已经能标到 section heading；正文里每个 section 有锚点（`paper-body.tsx` `sectionAnchor(i)`），但引文的"§Heading"还不是链接。
- **Tier 0 文本原语**：`scoring/tokenize.ts`、`tfidf.ts`、`term-expand.ts`（缩写展开、同义变体、`termSpecificity`）、`skim.ts` 的 `splitSentences` / `scoreSentence` / `isBoilerplate`。
- **三档绿色**：feed 卡片已有按相关度分三档的绿色底色（`FEATURES-BUILT.md` §5），目录高亮直接复用这套 token。
- **Notes**：`lib/notes/templates.ts` 的 `readingNote()` 已有 "What it claims / How / What I think / Questions" 四段模板；notes 可引用 paper（BibTeX key），导出 `.md` / `.bib`；但 `Source` 只记 paper，**不能指向某段、某节、某页**。
- **"问题"这个概念 feed 里已经有一半**：`profile-compiler.ts:513-518` 把 `currentChallenges` 拆成 `activeQuestions`。
- **导出**：`reading-markdown.ts` 把整页按同样顺序和同样诚实度导出 Markdown（`c` 键）。
- **快捷键**：`reader-keys.ts`（j/k/s/x/l/u/t/o/c）。
- **缓存**：report 只在浏览器 localStorage，key = `id|uploadId|revision|depth|hash(project)|provider`；`report-cache-key.ts` 是死代码。reading 是公共 edge 缓存，**不能放任何按人定制的内容**。
- **图片抽取**：`figures/pdf-extract.ts` 仍走 Python；`api/papers/[id]/figure-image/route.ts` 已经用 unpdf 的 `extractImages`，是以后把图抽取也迁离 Python 的起点。

### 1.6 已锁定、不能违背的决定（来自各 HANDOFF）

1. 没 key 时报告必须完整但更短；空字段不渲染，不出现占位句。
2. 论文自己的话在前，Peer 的判断在后、字体可辨（serif vs sans）。
3. 每件事只说一次；model 写的内容 3–5 条、每条一个意思。
4. **Peer presents, the user judges**：不下"该不该读"的裁决式结论。
5. 没有逐字证据的东西不上屏；宁可空着。
6. 每篇打开时一次 large-tier 调用；任何 model 失败返回 `null`，退回摘要路径。
7. 上传私有、不改公共记录；从中学习的东西有上限、会衰减、可撤回。
8. Deep-dive 是一个功能，不是产品身份；不做通用 agent 平台。

### 1.7 明确缺失（和"带着问题读"直接相关）

- 没有问题输入；没有按问题组织的输出；没有"这篇不回答你的问题"的判定。
- section 没有稳定 id、没有页码；长文 Pass 2 看不到 section 结构（只拿到扁平句子列表）。
- 没有阅读时间估计、没有分节的 读/扫 指引、没有段落级的中心句。
- 没有术语解释，没有选词解释，没有任何"读这节前你得先懂什么"。
- 没有按段落的"说人话"改写。
- 上传 PDF 的结构最粗，恰恰是作者最常用的入口。

---

## 2. 痛点 → 原则

作者的原话（节选）：

> 1. 没有方向性。如果一开始就知道想要什么具体答案、想解决什么问题，就会有方向地读。每篇文章像一堆稻草，要找的只是几根。
> 2. 分辨真正有用的信息难：术语艰深需要背景，一查就是 rabbit hole；长难句需要很强的英语阅读能力。
> 3. 恐惧一整篇没有脉络和分割的文章，像读法典。最大的恐惧是花很多时间读了对我完全没用的信息。

对应的产品原则：

| 痛点 | 原则 | 对应的产品哲学 |
| --- | --- | --- |
| 没方向 | **先问后读。** 打开一篇论文的第一个动作是说出"我想从它这里得到什么"；可以是多个问题；之后页面上的一切都围绕这些问题组织。 | User-declared intent |
| 怕浪费时间 | **先给地图，再给路线。** 读前先看到这篇有哪几节、各多长、各管什么、每段的中心句；对你的问题，哪几节值得读，一行理由 + 一句原文。**"这篇没提到你的问题"是合法且最有价值的输出之一。** | Time efficiency over volume |
| 术语 / 背景 | **有边界的背景。** 只解释"你要读的那几节"用到的、论文自己没解释的词；每词一行；论文自己有定义的，引论文原句。选中任何词可以要求解释。不展开、不外链、不做第二层。 | Ten precise items > a hundred noisy |
| 长难句 | **按段落、按需、按档位"说人话"。** 只对你点的那一段改写，原文并排保留，数字一个不改；高中 / 本科 / 研究生三档。 | Progressive enhancement |
| 法典感 | **Tier 0 就要有地图。** 地图、分节时长、段落中心句不需要 model，只需要 outline；没 key 的人也能先看到结构再决定读不读。 | Tier 0 must remain useful |

三个必须守住的边界：

1. **Peer 标"读 / 扫 / 相关背景 / 没提到"是读法建议，不是裁决。** 措辞用"这节没提到你的问题"（事实）而不是"别读"（判断），和 Phase 10 "Peer presents, the user judges" 一致。
2. **问题不等于项目**（作者 2026-10-05 的修正）。很多论文和 profile 里的 project / challenges 没有直接关系：为了一门课读、为了审稿读、为了借一个方法读、纯好奇读。所以问题是**每篇单独问、可以为空**的；profile 的 challenges 只是候选 chip 之一，不是默认值，也不自动填入；没有问题时页面照样给地图；"For your project" 块（`relationToYourWork`）和"带着问题读"是两回事。
3. **永远可读**（作者 2026-10-05 的补充）。一节或一段没提到你的问题，可能仍然是理解答案所需的背景，Peer 可能识别不出来。所以任何标记都**不隐藏、不折叠、不变灰、不重排**正文；"没提到"只是目录上没有颜色；全文永远和今天一样完整可读。

---

## 3. 方案："带着问题读"

七个部件，按阅读时间顺序排列。前四个 Tier 0 可用，后三个需要 model。Peer 自己的话一律英文（决定二）。

```
打开论文
  │
  ├─ ① 问   "What do you want from this paper?"  ← 1–5 个问题，每个一行 + 候选 chip
  │
  ├─ ② 图   Reading map：每节  heading · 页码 · 约 N 分钟 · 角色（setup/method/evidence/interpretation/apparatus）
  │         每节之下：每段一行中心句（Tier 0 = 段首句原文；Tier 2 = Peer 一句概括，标为 Peer 的话）
  │
  ├─ ③ 路   对每个问题：每节 / 每段 标  读 / 扫 / 没提到（Tier 2 另有"相关背景"）
  │         目录里标题按档位染浅绿：读 = 深一档，背景 = 中档，扫 = 最浅，没提到 = 无色；正文永远完整
  │
  ├─ ④ 答   For your questions：每个问题一句判定（answered / partly / not addressed）+ ≤3 条答案（原文 + 节 + 页码）+ "Read next §4.2 (p.7, 4 min)"
  │
  ├─ ⑤ 词   Terms to know：≤8 个术语，一行一个；论文自己定义过的引原句，否则标为 Peer 的话
  │         选中正文任意词 → "Explain this?" → 两句 plain English
  │
  └─ ⑥ 说人话  正文里被标"读"的段落 hover 出按钮；三档（high school / undergrad / graduate）；原文并排；数字逐字不变
```

### 3.1 ① 问（Ask）

- 位置：标题块之下、skim 之上（它决定下面所有东西的组织方式，必须最先出现）。
- 输入：**最多 5 个问题**，每个一行（≤200 字符），回车加一行，可删。自己写是第一选择。下面放几个 chip 当候选，点一下填入一行，不点就空着：
  1. 上一篇用过的问题（读系列论文时最常复用）。
  2. 通用读法 chip，和项目无关："Can I use this method in my own work?"、"Do the conclusions hold up?"、"How does this differ from X?"、"Just get the gist"。
  3. profile 的 `currentChallenges` 逐行拆开（复用 `profile-compiler.ts` 已有的 `activeQuestions` 拆分），**只在这篇论文和 profile 的 topics 有重叠时才显示**（用现有的 `sharedTerms` / 关键词匹配判断），避免给一篇无关论文推一个无关的问题。
  4. profile 新增的"常备问题"（standing questions，可选，Phase 5；只多一组 chip，永不自动填入）。
- 没填 = 今天的行为加一张地图，其余一个像素都不变。这是 Tier 0 的保底，也是"不强迫复杂度"的保证。
- "Just get the gist" 不是空问题的别名：它让 ③ 路按"读一篇陌生论文的通用顺序"标节（摘要 → 结论 → 图 → 方法），④ 答不出现。
- 每篇论文记住自己的问题（localStorage `peer-reading-questions-v1`，按 paper id；以后再上服务器）。
- 快捷键：`q` 聚焦问题框。

### 3.2 ② 图（Map，Tier 0）

从 `ExtractedDocument` 直接算，不要 model：

- 每节：`id`、heading、canonical bucket、起始页、字数、约分钟（字数 / 180 wpm，论文密度高，取保守值）、角色标签。
- 角色标签由 canonical bucket 映射：introduction/related_work → **setup**；methods → **method**；results → **evidence**；discussion/conclusion/limitations → **interpretation**；references/appendix/supplementary → **apparatus**。这只是把已有的 bucket 换一个读者视角的名字，不新增推断。
- **每节之下，每段一行中心句**（作者 2026-10-05 的要求：论文不会自己标，但每段都有自己的主旨）。
  - Tier 0：段首句原文（`splitSentences` 的第一句；若 <40 字符或 `isBoilerplate`，取下一句；仍无则该段不列），截到 ≤160 字符，标 "opening sentence"。永远是论文原句，不编。
  - Tier 2：small model 对整篇跑**一次**（不按问题，按 `docHash` 缓存），每段 ≤12 词一句概括，标为 Peer 的话（sans 字体）。段落数 >120 的论文只做 Tier 0。
  - 点一行跳到正文该段（段落锚点 = `sectionId` + 段序号）。
- 显示：一张紧凑的表，每节一行可展开看段落行；点击跳到正文锚点。手机上折叠成"N sections · about M min · show map"。
- 全文没读到（paywall / 扫描件）时，地图不渲染，Decision block 的那句话已经说明原因，不重复。

### 3.3 ③ 路（Route）

对每个问题、每节和每段给一个相对问题的标记。两档实现，同一个输出形状：

**Tier 0（词匹配）**
- 把每个问题 `tokenize` + `expandTerm`（缩写、复数、变体都在 `term-expand.ts` 里），去掉 `GENERIC_TERMS`。
- 每节算：命中的问题词数、命中句数、TF-IDF 余弦（问题 vs 节，用 `tfidf.ts` 建一次索引，文档 = 各节）；每段算命中词数。
- 阈值：节命中 ≥2 个 specific term 且 ≥2 句 → **读**；命中 1 个 → **扫**；0 → **没提到**。段：命中 ≥1 个 specific term → 该段中心句行染色。
- 理由只写事实："mentions LCO ×3, H1-3 ×3"；原文引命中句里 `scoreSentence` 最高的一句。
- 多个问题：每节取最高档，并列出命中的问题序号（Q1、Q3）。
- 跑在客户端（问题是私人的，reading 缓存是公共的，不能进服务器 reading）。
- 问题太空（specific term <2 个）时不做路线，只给地图，并提示 "Ask something more specific and Peer can point you to the right sections."

**Tier 2（model）**
- 并入 deep report 的 Pass 2（见 §4），model 只能从"我们给它的 section id 列表"里选，并对每个"读"节给一句逐字原文，过 `verifyReportEvidence`。
- Tier 2 多一档 **相关背景（background）**：没提到问题的词，但 model 判断是理解答案所需的节（例如定义了答案里用到的量）。目录染中档绿，标 "background for Q2"。这是对"Peer 可能识别不出来"的部分补救，不是全部；永远可读（§2 边界 3）仍然是底线。
- Tier 2 结果覆盖 Tier 0；model 失败时 Tier 0 结果仍在。

**目录颜色**（作者 2026-10-05 的要求）
- `paper-contents.tsx` 的目录和正文里的节标题、地图里的段落行，按档位染色：读 = 绿色第一档，相关背景 = 第二档，扫 = 第三档（最浅），没提到 = 无色。复用卡片已有的三档绿色 token，明暗两种主题都要可读。
- 染色只作用于标题和中心句行；正文本身不染色、不隐藏、不折叠、不变灰、不重排。

### 3.4 ④ 答（Answer，Tier 2）

新增 report 块 `forYourQuestions`，每个问题一条（只在有问题时进 schema，服务器回填 `question` 原文）：

```ts
forYourQuestions?: {
  question: string;                       // 服务器回填，不信 model 的复述
  verdict: "answered" | "partly" | "not_addressed";
  answers: Claim[];                       // ≤3，每条 text + evidence + evidenceWhere + sectionId + page
  readNext: { sectionId: string; why: string; kind: "answer" | "background" }[];   // ≤4，why 一行；页面补 heading / page / minutes
}[]
```

- `verdict === "not_addressed"` 时页面只显示一句 "This paper does not address: 〈question〉." 加 Tier 0 的地图作对照（给用户自己判断的机会）。**不显示空的 answers 标题。**
- 这是整个方案里最值钱的一句话：它直接消解"花了时间读了没用的东西"的恐惧。
- 位置：Decision block 之后、What it proposes 之前（问题相关的东西永远排在通用摘要前面）。
- 导出：`reading-markdown.ts` 加一段 "For your questions"，frontmatter 加 `questions:`。
- Notes：`readingNote()` 模板在有问题时多一段 "My questions → what it said"，预填判定和答案的引文。

### 3.5 ⑤ 词（Terms）

- 范围：只看被标"读"或"相关背景"的节（没有问题时看 methods + results）。
- Tier 0：正则找论文自己给的定义：`X (ABBR)`、`ABBR (X)`、`X, defined as …`、`X refers to …`、`we define X as …`。每个 ≤1 句，带 `evidenceWhere`。`term-expand.ts` 的缩写逻辑可直接复用。
- Tier 2：让 Pass 2 额外返回 `terms[]`（≤8）：`{ term, definition, evidence? }`。有 `evidence` 的走验证；没有的标为 Peer 的话（sans 字体，和 `newHere` 同一规则）。
- 显示：地图下面一条 "Terms to know"，每词一行；点词高亮正文中的首次出现。
- **选词解释**（作者 2026-10-05 的要求）：在正文里选中任意词或短语（≤12 词），出现一个小浮层 "Explain this?"。点了才跑：`POST /api/papers/[id]/explain`，body `{ term, sentence, sectionId }`，small tier，返回 ≤2 句 plain English，标为 Peer 的话；若论文自己定义过这个词，先显示论文原句。Tier 0：只在论文自己有定义句时才出现浮层（显示原句），否则不出现（locked-block 规则）。按 `(paperId, term)` 缓存。
- 明确不做：外链、二级术语、维基式长解释。rabbit hole 在产品层面被禁止。

### 3.6 ⑥ 说人话（Plain，Tier 2，按需）

- 正文里被标"读"的段落 hover 出 "Say it plainly"（无 key 时按 locked-block 规则不显示）。
- **三档**（作者 2026-10-05 的要求），阅读偏好记住上次选的档：
  - `highschool`：每句 ≤20 词，不出现未解释的术语，每个术语就地一句解释。
  - `undergrad`（默认）：每句 ≤25 词，领域通用术语可保留。
  - `graduate`：每句 ≤30 词，术语全部保留，只拆长句和被动语态。
- `POST /api/papers/[id]/plain`，body `{ sectionId, paragraphIndex, text, level }`，small tier，≤ 段落原长 ×1.2，规则：数字和单位逐字保留、不加论文没有的信息、不删任何数值。改写里的数值集合必须等于原文的数值集合，否则丢弃改写、显示原文（单测）。
- 服务器端按 `hash(text)|level` 内存缓存；客户端 localStorage 同 key。
- 原文并排，不替换；`u` 撤回。
- 全部英文（决定二）。

---

## 4. 数据模型与代码落点（最小改动）

| # | 改动 | 文件 | 说明 |
| --- | --- | --- | --- |
| D0 | 上传抽取结果缓存（`ExtractedDocument` 按 `owner|hash|revision|extractionVersion` 落在私有上传目录旁）；`use-model-report.ts:185-188` 对私有 PDF 改为按 key 缓存而不是永不缓存 | `lib/papers/full-text.ts:326`、`lib/papers/upload-store.ts`、`components/reader/use-model-report.ts` | 这是作者主场景的成本问题，和"带着问题读"无关也该先修；换问题重跑 Pass 2 的前提也是全文不用再抽一遍 |
| D1 | `ExtractedSection` 加 `id: string`（`s0`, `s1`…按顺序）和 `page?: number` | `lib/papers/html-text.ts:17` | pdf.js outline 已有页码，只是 `normalize()` 没传；HTML 源无页码，字段可空 |
| D2 | `pdf-text.ts` 的 normalize 透传 `page`，并给每节编 id | `lib/papers/pdf-text.ts:184` | 顺手修 `pdf-outline.ts:97` TERMINAL 里永远匹配不到的 "acknowledgements"/"appendix" |
| D3 | 上传路径改走 pdf.js `readPages` + `buildOutline`，**不保留 Python 文本兜底**（决定三：线上没有 Python，两条路径等于两种行为）；`extractPdfTextFromPath` 读磁盘字节 → 同一个 normalize；`page1Text` 由第 1 页的行拼出，供上传路由找 DOI / 标题；`scripts/extract_pdf_text.py` 删除；图抽取的 Python 脚本不动，另立 backlog 迁到 unpdf | `lib/papers/pdf-text.ts` `extractPdfTextFromPath`、`app/api/papers/upload/route.ts:205`、`lib/papers/full-text.ts:225` | 作者主场景的结构质量直接对齐 URL PDF；去掉上传对 Python 的硬依赖 |
| D4 | Pass 1 输入从 `{canonical: text}` 改为 `[{id, heading, text}]`，输出每句带 `sectionId` | `lib/papers/deep-report.ts:156` | 让 Pass 2 在长文上也看得到结构；同时加 `readerQuestions` 和第五桶 `questionRelevant`（每题 ≤8 句） |
| D5 | Pass 2 加 `readerQuestions`、`forYourQuestions` schema（含 `readNext.kind`）、`terms` schema（都只在有问题时进 schema） | `deep-report.ts:220` | 和 `relationToYourWork` 同一模式；`PASS2_MAX_INPUT_CHARS` 的截断要改成**先截 body 再拼 schema**，否则 schema/rules 在尾部会被截掉（现有 bug） |
| D6 | `verifyReportEvidence` 覆盖 `forYourQuestions[].answers`、`terms`（有 evidence 的）；`readNext.sectionId` 校验在 doc 里存在 | `lib/papers/evidence.ts:189` | 不存在的 id 丢掉并计数 |
| D7 | `sanitizePaperReport` 加对应 caps：questions 5、answers 3、readNext 4、terms 8、term 行 ≤160 字符 | `lib/papers/report.ts:168` | |
| D8 | `buildReportKey` 加 `hash(questions 排序后拼接)`；`report` 路由 body 加 `questions: string[]` | `components/reader/use-model-report.ts:100`、`app/api/papers/report/route.ts` | 换问题 = 新 key；Pass 1 结果按 `docHash` 内存缓存 1 小时，换问题只重跑 Pass 2 |
| D9 | 新纯函数 `buildReadingMap(doc)`（含段落首句）与 `routeByQuestions(map, doc, questions)` | 新文件 `lib/papers/reading-map.ts` | Tier 0，可在客户端跑；单测用现有 `__fixtures__/*.doc.json` |
| D10 | 新组件：`question-field.tsx`、`reading-map.tsx`、`for-your-questions.tsx`、`terms-strip.tsx`、`explain-popover.tsx`、`plain-button.tsx`；`paper-contents.tsx` 加档位染色；`paper-body.tsx` 加段落锚点 | `components/reader/` | 按 §3 位置插入 `page.tsx`；`EvidenceQuote` 的 "§Heading" 改成指向 `sectionAnchor` 的链接 |
| D11 | `reading-markdown.ts` 与 `notes/templates.ts` 加问题段 | | 保持"同一张纸、同一顺序"的导出原则 |
| D12 | `reader-keys.ts` 加 `q`（聚焦问题）、`g`（跳到下一个"读"节） | | |
| D13 | 段落中心句 Tier 2：新路由 `POST /api/papers/[id]/paragraph-guide`，small tier，一次整篇，按 `docHash` 缓存 | 新文件 | 不按问题，不进 Pass 2，避免 Pass 2 输出膨胀 |
| D14 | 选词解释路由 `POST /api/papers/[id]/explain`；说人话路由 `POST /api/papers/[id]/plain`（三档） | 新文件 | 都是 small tier、按需、带缓存、无 key 时 404 且前端不显示入口 |

不动的东西：reading 的公共缓存（所有按问题的计算都在客户端或 report 路由里）、ledger 权重、feed、`Peer/`、`python/`、图抽取的 Python 脚本。

---

## 5. Tier 矩阵

| 部件 | Tier 0（无 key） | Tier 2（有 key） |
| --- | --- | --- |
| ① 问 | 有 | 同 |
| ② 图：节、页码、分钟、角色、段落首句 | 有 | + 每段一句 Peer 概括（标为 Peer 的话） |
| ③ 路：读 / 扫 / 没提到 + 目录染色 | 词匹配，理由是命中事实 | model 选节 + 逐字原文 + 相关背景档；失败回退 Tier 0 |
| ④ 答 | 命中最高的 ≤3 句原文，标 "matched by words" | 验证过的 claims + 判定 + readNext |
| ⑤ 词 | 论文自带定义（正则）；选词浮层只在有定义句时出现 | + Peer 一行解释；选词解释两句 |
| ⑥ 说人话 | 不显示 | 三档，按段按需 |

每一行都满足"没 key 时完整但更短，空的不渲染"。

---

## 6. 分期（按省力和收益排序）

| 期 | 内容 | 估量 | 验收 |
| --- | --- | --- | --- |
| **P0 地基** | D0–D3：上传抽取缓存 + 私有 PDF report 缓存；section id + 页码透传；上传改走 pdf.js（无 Python 文本兜底）；修 TERMINAL | 1 天 | 现有 `pdf-outline.test.ts`、`pdf-text.test.ts`、`private-pdf-extract.test.ts` 按新契约全绿（改断言，不删测试）；用一篇 PDF 对比前后 section 数和段落数；同一篇刷新两次，deep report 计数只加 1；PyMuPDF 不存在时上传仍能读出全文 |
| **P1 地图 + 问 + Tier 0 路** | D9、D10 的 question-field / reading-map / 目录染色 / 段落锚点、D12 | 1–2 天 | 不配 key，上传一篇 PDF，能看到分节时长表和每段首句；输入 1–5 个问题后每节每段有 读/扫/没提到 和命中事实，目录按档染色；点节、点段跳正文；正文一字不变、不折叠 |
| **P2 答** | D4–D8、D11 | 2 天 | 有 key 时 `forYourQuestions` 出现在 Decision block 之后；故意问一个论文不涉及的问题，得到 "does not address" 一句话；换问题只触发 Pass 2；`c` 导出含问题段；相关背景档出现在目录 |
| **P3 词 + 段落概括** | ⑤ 的 Tier 0 + Tier 2、选词解释、D13 | 1–2 天 | 术语 ≤8，有定义句的带 §，无定义的标 Peer；选中词出现浮层；每段一句 Peer 概括按 docHash 缓存 |
| **P4 说人话** | ⑥ 三档，D14 | 1 天 | 只对"读"段落出现；三档可切；原文并排；数值集合相等（单测）；无 key 不显示 |
| **P5 沉淀** | profile 常备问题（只多一组 chip，永不自动填入）；问题词以低权重进 ledger（`upload-concepts.ts` 同一机制），**每个问题可勾选"不进推荐"**；notes 模板问题段 | 后续 | 符合"反馈渐进、不过度反应" |
| **Backlog** | 图抽取迁离 Python（unpdf `extractImages` 已在 figure-image 路由用上） | 后续 | 本机无 Python 也能出图 |

P0 + P1 不需要任何 model，一两天内就能让作者本地用上"先看地图再决定读不读"。P2 之后才动 prompt。P3 的 Tier 0 部分不依赖 P2；P3 的 Tier 2 部分要等 P2 把 Pass 2 改完。

---

## 7. 成本与缓存

- 问题进 Pass 1 约 +200 输入 token / 题；Pass 2 多约 600 输出 token / 题（answers + readNext + terms）。仍然是每篇一次 large 调用，不违反锁定决定 6。
- 换问题：Pass 1 的 signal 按 `docHash` 在服务器内存缓存 1 小时（和现有 full-text 缓存同一位置），只重跑 Pass 2。
- 段落概括：small tier，整篇一次，按 `docHash` 缓存，和问题无关。
- 选词解释、说人话：small tier、按需、用户主动触发，自然有上限。
- 所有按问题的产物只进浏览器缓存（`peer-paper-report-v7` 的 key 加 `hash(questions)`），不进公共 reading 缓存。

---

## 8. 作者已拍板（2026-10-05）

1. **问题存在哪一层：A，每篇一问**（可多问）。常备问题进 profile 留到 P5，视需要再做。
2. **Peer 的话要不要中文开关：A，不加。** Peer 的话全英文；论文原句永远不翻译。
3. **上传改走 pdf.js：做。** 作者问"线上没有 Python，还有必要留 Python 兜底吗"：答案是没必要。线上根本跑不了，本容器也没有 PyMuPDF，两条路径等于两种行为。文本抽取只走 pdf.js；图抽取的 Python 脚本暂时不动，另立 backlog。
4. **无关章节的措辞：C，"没提到〈问题〉"**，页面不出现"跳"。并且（作者补充）一节没提到问题也可能是理解答案的必要背景、Peer 可能识别不出来，所以**永远可读**：不隐藏、不折叠、不变灰、不重排；Tier 2 另加"相关背景"档作部分补救。

作者另外提出的六项要求（已并入 §3）：选词解释（§3.5）、说人话三档（§3.6）、段落中心句（§3.2）、目录按档染浅绿（§3.3）、问题框允许多个问题（§3.1）、"没提到"不等于不用读（§2 边界 3）。

---

## 9. 风险

- **问题太空**（"what is this paper about"）：Tier 0 路会把每节都标"扫"。对策：问题少于 2 个 specific term 时不做路由，只给地图，并提示问得具体一点。
- **长文 Pass 2 看到了结构后输出变长**：caps（D7）兜底；每题 answers 3、readNext 4，terms 8 是硬上限；问题上限 5。
- **上传切换抽取器后旧 report 缓存不一致**：`revision` 已在 key 里；D3 上线时 bump 上传的 `extractionVersion`（`upload-concepts.ts` 已有这个概念）。
- **说人话改错数字**：单测用数值正则比对原文与改写；不相等就丢弃改写，显示原文。
- **段落概括编造**：Tier 2 概括标为 Peer 的话，永远和 Tier 0 的原句首句并存，用户可对照。
- **范围蔓延成 Q&A 聊天**：v1 只有"一篇多问、可换问"，没有多轮；追问 = 改问题重跑 Pass 2。Deep-dive 仍然是另一个 blueprint 的事。
