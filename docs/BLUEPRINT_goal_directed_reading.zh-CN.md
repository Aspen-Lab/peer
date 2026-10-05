# Blueprint — 带着问题读（Goal-directed reading）

**Status:** Proposed, 2026-10-05. 只针对 web 端的 paper reader / deep report。
**读者：** 先给作者自己用。不考虑迎合大众；作者自己觉得顺手，才算第一步做对。
**上游约束：** `docs/PRODUCT_DIRECTION.md`、`VISION.md`、`README.md` §"Deep paper reports"。本文不改任何已锁定的决定，只在它们之上加一层。

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
- `researchTopics + preferredMethods` → `contextHint`/`userContext` → **prompt 里没有任何规则引用它**，等于没用。
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

`pdf-text.ts` 的 merge note 已经把"上传路径迁到 pdf.js"标为独立的 follow-up。

- **每次打开都重做一遍，而且每次都扣一次 deep report 额度。** 上传的 PDF 服务器只存原文件 + 一个小记录（标题、DOI、页数、400 字符摘要、≤12 个短语），不存全文、不存 section、不存图。`full-text.ts:326-331` 和 `figures/extract.ts:1410-1415` 对 `upload:` id 跳过缓存；浏览器端对私有 PDF 也不缓存 reading / report（`use-reading.ts:98-128`、`use-model-report.ts:185-188`）。结果：一次页面访问跑至少两次 Python 文本抽取 + 一次图抽取；**挂在已有 paper 上的 PDF 永远走 deep，每次访问都再花一次 deep report**（free 每月 5 次；BYOK 也照扣，`report/route.ts:644-666`）。
- 独立上传（没挂到 paper 上）只有 Profile 的 "Deep report" 开关打开时才走 deep，否则 report 只基于那 400 字符的摘要。
- 图抽取只尝试 `PYTHON_BIN` / `python` / `py -3`，不试 `python3`（`figures/pdf-extract.ts:181-184`；文本抽取已修过同一问题，会多试 `python3`）。只有 `python3` 又没设 `PYTHON_BIN` 的机器上，图会静默失败。

### 1.5 周边已经有、可以直接复用的东西

- **逐字证据 + 验证**（`evidence.ts`）：任何新加的"指向论文某处"的输出都应该过这一关。
- **section 归属**：`evidenceWhere` 已经能标到 section heading；正文里每个 section 有锚点（`paper-body.tsx` `sectionAnchor(i)`），但引文的"§Heading"还不是链接。
- **Tier 0 文本原语**：`scoring/tokenize.ts`、`tfidf.ts`、`term-expand.ts`（缩写展开、同义变体、`termSpecificity`）、`skim.ts` 的 `splitSentences` / `scoreSentence`。
- **Notes**：`lib/notes/templates.ts` 的 `readingNote()` 已有 "What it claims / How / What I think / Questions" 四段模板；notes 可引用 paper（BibTeX key），导出 `.md` / `.bib`；但 `Source` 只记 paper，**不能指向某段、某节、某页**，也没有"把选中的句子发到 note"。
- **"问题"这个概念 feed 里已经有一半**：`profile-compiler.ts:513-518` 把 `currentChallenges` 拆成 `activeQuestions` 进 `NormalizedFeedIntent`。常备问题可以直接沿用这个拆分，不必再发明一套。
- `preferredMethods` 有 setter 没有 UI（`store/profile.ts:139` 无调用方），所以 `contextHint` 里的 "Methods:" 实际永远为空。
- **导出**：`reading-markdown.ts` 把整页按同样顺序和同样诚实度导出 Markdown（`c` 键）。
- **快捷键**：`reader-keys.ts`（j/k/s/x/l/u/t/o/c）。
- **缓存**：report 只在浏览器 localStorage，key = `id|uploadId|revision|depth|hash(project)|provider`；`report-cache-key.ts` 是死代码。reading 是公共 edge 缓存，**不能放任何按人定制的内容**。

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
- 没有阅读时间估计、没有分节的 读/扫/跳 指引。
- 没有术语解释，没有任何"读这节前你得先懂什么"。
- 没有按段落的"说人话"改写；Peer 的话只有英文。
- 上传 PDF 的结构最粗，恰恰是作者最常用的入口。

---

## 2. 痛点 → 原则

作者的原话（节选）：

> 1. 没有方向性。如果一开始就知道想要什么具体答案、想解决什么问题，就会有方向地读。每篇文章像一堆稻草，要找的只是几根。
> 2. 分辨真正有用的信息难：术语艰深需要背景，一查就是 rabbit hole；长难句需要很强的英语阅读能力。
> 3. 恐惧一整篇没有脉络和分割的文章，像读法典。最大的恐惧是花很多时间读了对我完全没用的信息。

对应的产品原则（每条都能回溯到 `PRODUCT_DIRECTION.md` 的某一条）：

| 痛点 | 原则 | 对应的产品哲学 |
| --- | --- | --- |
| 没方向 | **先问后读。** 打开一篇论文的第一个动作是说出"我想从它这里得到什么"；之后页面上的一切都围绕这个问题组织。 | User-declared intent |
| 怕浪费时间 | **先给地图，再给路线。** 读前先看到这篇有哪几节、各多长、各管什么；对你的问题，哪几节值得读、哪几节可以不读，一行理由 + 一句原文。**"这篇不回答你的问题"是合法且最有价值的输出之一。** | Time efficiency over volume |
| 术语 / 背景 | **有边界的背景。** 只解释"你要读的那几节"用到的、论文自己没解释的词；每词一行；论文自己有定义的，引论文原句。不展开、不外链、不做第二层。 | Ten precise items > a hundred noisy |
| 长难句 | **按段落、按需"说人话"。** 只对你点的那一段改写成 ≤25 词的短句（可选中文），原文并排保留，数字一个不改。 | Progressive enhancement |
| 法典感 | **Tier 0 就要有地图。** 地图和分节时长不需要 model，只需要 outline；没 key 的人也能先看到结构再决定读不读。 | Tier 0 must remain useful |

一个必须守住的边界：**Peer 标"读 / 扫 / 跳"是 Peer 的读法建议，不是裁决。** 措辞用"这节没提到你的问题"（事实）而不是"别读"（判断），和 Phase 10 "Peer presents, the user judges" 一致。

第二个必须守住的边界（作者 2026-10-05 的修正）：**问题不等于项目。** 很多论文和 profile 里的 project / challenges 没有直接关系：为了一门课读、为了审稿读、为了借一个方法读、纯好奇读。所以：

- 问题是**每篇单独问、可以为空**的；profile 的 challenges 只是候选 chip 之一，不是默认值，也不自动填入。
- 没有问题时，页面照样给地图（§3.2）和通用报告，不假装用户有一个问题。
- 现有的 "For your project" 块（`relationToYourWork`）和"带着问题读"是两回事：前者只在论文确实和项目有关时出现，后者只在用户写了问题时出现；两者可以同时出现、同时不出现。

---

## 3. 方案："带着问题读"

六个部件，按阅读时间顺序排列。前三个 Tier 0 可用，后三个需要 model。

```
打开论文
  │
  ├─ ① 问   "你想从这篇里得到什么？"  ← 一行输入 + 几个 chip（现有 challenges、常备问题、"只是了解一下"）
  │
  ├─ ② 图   Reading map：每节  heading · 页码 · 约 N 分钟 · 它是干什么的（setup/method/evidence/interpretation/apparatus）
  │
  ├─ ③ 路   对你的问题：每节标  读 / 扫 / 没提到   + 一行理由 + 一句原文（Tier 0 用词匹配，Tier 2 用 model）
  │
  ├─ ④ 答   For your question：一句判定（回答了 / 部分 / 没提到）+ ≤3 条答案，每条一句原文 + 所在节 + 页码 + 「接着读 §4.2（p.7，4 分钟）」
  │
  ├─ ⑤ 词   先懂这几个词：≤8 个术语，一行一个；论文自己定义过的引原句，否则标为 Peer 的话
  │
  └─ ⑥ 说人话  正文里被标"读"的段落 hover 出一个按钮；点了才改写；原文并排；可选中文
```

### 3.1 ① 问（Ask）

- 位置：标题块之下、skim 之上（它决定下面所有东西的组织方式，必须最先出现）。
- 输入：一行文本，自己写是第一选择。下面放几个 chip 当候选，点一下填入，不点就空着：
  1. 上一篇用过的问题（读系列论文时最常复用）。
  2. 通用读法 chip，和项目无关："它的方法能不能搬到我这"、"结论站得住吗"、"它和 X 有什么不同"、"只是了解一下"。
  3. profile 的 `currentChallenges` 逐行拆开（复用 `profile-compiler.ts` 已有的 `activeQuestions` 拆分），**只在这篇论文和 profile 的 topics 有重叠时才显示**（用现有的 `sharedTerms` / 关键词匹配判断），避免给一篇无关论文推一个无关的问题。
  4. profile 新增的"常备问题"（standing questions，可选，Phase 5）。
- 没填 = 今天的行为，页面一个像素都不变。这是 Tier 0 的保底，也是"不强迫复杂度"的保证。
- "只是了解一下"不是空问题的别名：它让 ③ 路按"读一篇陌生论文的通用顺序"标节（摘要 → 结论 → 图 → 方法），④ 答不出现。
- 每篇论文记住自己的问题（先 localStorage，和 report cache 同一套；以后再上服务器）。
- 快捷键：`q` 聚焦问题框。

### 3.2 ② 图（Map，Tier 0）

从 `ExtractedDocument` 直接算，不要 model：

- 每节：`id`、heading、canonical bucket、起始页、字数、约分钟（字数 / 180 wpm，论文密度高，取保守值）、角色标签。
- 角色标签由 canonical bucket 映射：introduction/related_work → **setup**；methods → **method**；results → **evidence**；discussion/conclusion/limitations → **interpretation**；references/appendix/supplementary → **apparatus**。这只是把已有的 bucket 换一个读者视角的名字，不新增推断。
- 显示：一张紧凑的表，每节一行，点击跳到正文锚点。手机上折叠成"N 节 · 约 M 分钟 · 展开看地图"。
- 全文没读到（paywall / 扫描件）时，地图不渲染，Decision block 的那句话已经说明原因，不重复。

### 3.3 ③ 路（Route）

对每节给一个相对问题的标记。两档实现，同一个输出形状：

**Tier 0（词匹配）**
- 把问题 `tokenize` + `expandTerm`（缩写、复数、变体都在 `term-expand.ts` 里），去掉 `GENERIC_TERMS`。
- 每节算：命中的问题词数、命中句数、TF-IDF 余弦（问题 vs 节，用 `tfidf.ts` 建一次索引，文档 = 各节）。
- 阈值：命中 ≥2 个 specific term 且 ≥2 句 → **读**；命中 1 个 → **扫**；0 → **没提到**。
- 理由只写事实："提到 LCO、H1-3 各 3 次"；原文引命中句里 `scoreSentence` 最高的一句。
- 跑在客户端（问题是私人的，reading 缓存是公共的，不能进服务器 reading）。

**Tier 2（model）**
- 并入 deep report 的 Pass 2（见 §4），model 只能从"我们给它的 section id 列表"里选，并对每个"读"节给一句逐字原文，过 `verifyReportEvidence`。
- Tier 2 结果覆盖 Tier 0；model 失败时 Tier 0 结果仍在。

### 3.4 ④ 答（Answer，Tier 2）

新增 report 块 `forYourQuestion`，形状和 `relationToYourWork` 同构（只在有问题时进 schema，服务器回填 `question` 原文）：

```ts
forYourQuestion?: {
  question: string;                       // 服务器回填，不信 model 的复述
  verdict: "answered" | "partly" | "not_addressed";
  answers: Claim[];                       // ≤3，每条 text + evidence + evidenceWhere + sectionId + page
  readNext: { sectionId: string; why: string }[];   // ≤4，why 一行；页面补 heading / page / minutes
}
```

- `verdict === "not_addressed"` 时页面只显示一句："这篇没有提到〈你的问题〉。" 加 Tier 0 的"读/扫"地图作对照（给用户自己判断的机会）。**不显示空的 answers 标题。**
- 这是整个方案里最值钱的一句话：它直接消解"花了时间读了没用的东西"的恐惧。
- 位置：Decision block 之后、What it proposes 之前（问题相关的东西永远排在通用摘要前面）。
- 导出：`reading-markdown.ts` 加一段 "For your question"，frontmatter 加 `question:`。
- Notes：`readingNote()` 模板在有问题时多一段 "My question → what it said"，预填 verdict 和 answers 的引文。

### 3.5 ⑤ 词（Terms）

- 范围：只看被标"读"的节（没有问题时看 methods + results）。
- Tier 0：正则找论文自己给的定义：`X (ABBR)`、`ABBR (X)`、`X, defined as …`、`X refers to …`、`we define X as …`。每个 ≤1 句，带 `evidenceWhere`。`term-expand.ts` 的缩写逻辑可直接复用。
- Tier 2：让 Pass 2 额外返回 `terms[]`（≤8）：`{ term, definition, evidence? }`。有 `evidence` 的走验证；没有的标为 Peer 的话（sans 字体，和 `newHere` 同一规则）。
- 显示：地图下面一条"先懂这几个词"，每词一行；点词高亮正文中的首次出现。
- 明确不做：外链、二级术语、维基式长解释。rabbit hole 在产品层面被禁止。

### 3.6 ⑥ 说人话（Plain，Tier 2，按需）

- 正文里被标"读"的段落 hover 出"说人话"（无 key 时按 locked-block 规则不显示）。
- `POST /api/papers/[id]/plain`，body `{ sectionId, paragraphIndex, text, language: "en" | "zh" }`，small tier，≤ 段落原长 ×1.2，规则：≤25 词一句、数字和单位逐字保留、不加论文没有的信息、不删任何数值。
- 服务器端按 `hash(text)|language` 内存缓存；客户端 localStorage 同 key。
- 原文并排，不替换；`u` 撤回。
- 这是唯一一处 Peer 的话可以是中文的地方；是否把 summary / answers 也中文化，见 §8。

---

## 4. 数据模型与代码落点（最小改动）

| # | 改动 | 文件 | 说明 |
| --- | --- | --- | --- |
| D0 | 上传抽取结果缓存（`ExtractedDocument` 按 `owner|hash|revision|extractionVersion` 落在私有上传目录旁）；`use-model-report.ts:185-188` 对私有 PDF 改为按 key 缓存而不是永不缓存 | `lib/papers/full-text.ts:326`、`lib/papers/upload-store.ts`、`components/reader/use-model-report.ts` | 这是作者主场景的成本问题，和"带着问题读"无关也该先修；换问题重跑 Pass 2 的前提也是全文不用再抽一遍 |
| D1 | `ExtractedSection` 加 `id: string`（`s0`, `s1`…按顺序）和 `page?: number` | `lib/papers/html-text.ts:17` | pdf.js outline 和 Python 输出都已有页码，只是 `normalize()` / `normalizePythonOutput()` 没传；HTML 源无页码，字段可空 |
| D2 | `pdf-text.ts` 两个 normalize 透传 `page`，并给每节编 id | `lib/papers/pdf-text.ts:184, 340` | 顺手修 `pdf-outline.ts:97` TERMINAL 里永远匹配不到的 "acknowledgements"/"appendix"，和 `figures/pdf-extract.ts:181` 不试 `python3` 的问题 |
| D3 | 上传路径改走 pdf.js `buildOutline`，Python 退为 `no-sections` 时的 fallback | `lib/papers/pdf-text.ts` `extractPdfTextFromPath` | 作者主场景的结构质量直接对齐 URL PDF；去掉上传对 Python 的硬依赖（图片抽取仍用 Python） |
| D4 | Pass 1 输入从 `{canonical: text}` 改为 `[{id, heading, text}]`，输出每句带 `sectionId` | `lib/papers/deep-report.ts:156` | 让 Pass 2 在长文上也看得到结构；同时加 `readerQuestion` 和第五桶 `questionRelevant`（≤8 句） |
| D5 | Pass 2 加 `readerQuestion`、`forYourQuestion` schema、`terms` schema（都只在有问题时进 schema） | `deep-report.ts:220` | 和 `relationToYourWork` 同一模式；`PASS2_MAX_INPUT_CHARS` 的截断要改成**先截 body 再拼 schema**，否则 schema/rules 在尾部会被截掉（现有 bug） |
| D6 | `verifyReportEvidence` 覆盖 `forYourQuestion.answers`、`terms`（有 evidence 的）；`readNext.sectionId` 校验在 doc 里存在 | `lib/papers/evidence.ts:189` | 不存在的 id 丢掉并计数 |
| D7 | `sanitizePaperReport` 加对应 caps：answers 3、readNext 4、terms 8、term 行 ≤160 字符 | `lib/papers/report.ts:168` | |
| D8 | `buildReportKey` 加 `hash(question)`；`report` 路由 body 加 `question` | `components/reader/use-model-report.ts:100`、`app/api/papers/report/route.ts` | 换问题 = 新 key；Pass 1 结果按 `docHash` 内存缓存 1 小时，换问题只重跑 Pass 2 |
| D9 | 新纯函数 `buildReadingMap(doc)` 与 `routeByQuestion(map, doc, question)` | 新文件 `lib/papers/reading-map.ts` | Tier 0，可在客户端跑；单测用现有 `__fixtures__/*.doc.json` |
| D10 | 新组件：`question-field.tsx`、`reading-map.tsx`、`for-your-question.tsx`、`terms-strip.tsx`、`plain-button.tsx` | `components/reader/` | 按 §3 位置插入 `page.tsx`；`EvidenceQuote` 的 "§Heading" 改成指向 `sectionAnchor` 的链接 |
| D11 | `reading-markdown.ts` 与 `notes/templates.ts` 加问题段 | | 保持"同一张纸、同一顺序"的导出原则 |
| D12 | `reader-keys.ts` 加 `q`（聚焦问题）、`g`（跳到下一个"读"节） | | |

不动的东西：reading 的公共缓存（所有按问题的计算都在客户端或 report 路由里）、ledger 权重、feed、`Peer/`、`python/`。

---

## 5. Tier 矩阵

| 部件 | Tier 0（无 key） | Tier 2（有 key） |
| --- | --- | --- |
| ① 问 | 有 | 同 |
| ② 图：节、页码、分钟、角色 | 有 | 同 |
| ③ 路：读 / 扫 / 没提到 | 词匹配，理由是命中事实 | model 选节 + 逐字原文；失败回退 Tier 0 |
| ④ 答 | 命中最高的 ≤3 句原文，标"按词匹配" | 验证过的 claims + 判定 + readNext |
| ⑤ 词 | 论文自带定义（正则） | + Peer 一行解释（标为 Peer 的话） |
| ⑥ 说人话 | 不显示 | 按段按需 |

每一行都满足"没 key 时完整但更短，空的不渲染"。

---

## 6. 分期（按省力和收益排序）

| 期 | 内容 | 估量 | 验收 |
| --- | --- | --- | --- |
| **P0 地基** | D1–D3：section id + 页码透传；上传改走 pdf.js，Python 兜底；修 TERMINAL。**加 D0：上传的抽取结果按 `owner+hash+revision` 在服务器内存/磁盘缓存；私有 PDF 的 report 在浏览器按同一 key 缓存，不再每次访问重跑、重扣额度**（私有目录本来就是 owner 隔离的，缓存放同一目录不新增暴露面） | 1 天 | 现有 `pdf-outline.test.ts`、`pdf-text.test.ts`、`private-pdf-extract.test.ts` 全绿；用一篇自己的上传对比前后 section 数和段落数；同一篇刷新两次，deep report 计数只加 1 |
| **P1 地图 + 问 + Tier 0 路** | D9、D10 的前三个组件、D12 | 1–2 天 | 不配 key，上传一篇 PDF，能看到分节时长表；输入问题后每节有 读/扫/没提到 和命中事实；点节跳正文 |
| **P2 答** | D4–D8、D11 | 2 天 | 有 key 时 `forYourQuestion` 出现在 Decision block 之后；故意问一个论文不涉及的问题，得到 "not_addressed" 一句话；换问题只触发 Pass 2；`c` 导出含问题段 |
| **P3 词** | ⑤ 的 Tier 0 + Tier 2 | 1–2 天 | 术语 ≤8，有定义句的带 §，无定义的标 Peer |
| **P4 说人话** | ⑥ | 1 天 | 只对"读"节出现；原文并排；数字逐字相等（单测用正则比对数值） |
| **P5 沉淀** | profile 常备问题；问题词以低权重进 ledger（`upload-concepts.ts` 同一机制）；notes 模板问题段 | 后续 | 符合"反馈渐进、不过度反应" |

P0 + P1 不需要任何 model，一两天内就能让作者本地用上"先看地图再决定读不读"。P2 之后才动 prompt。

---

## 7. 成本与缓存

- 问题进 Pass 1 约 +200 输入 token；Pass 2 多约 600 输出 token（answers + readNext + terms）。仍然是每篇一次 large 调用，不违反锁定决定 6。
- 换问题：Pass 1 的 signal 按 `docHash` 在服务器内存缓存 1 小时（和现有 full-text 缓存同一位置），只重跑 Pass 2。
- 说人话：small tier、按段、用户主动触发，自然有上限。
- 所有按问题的产物只进浏览器缓存（`peer-paper-report-v7` 的 key 加 `hash(question)`），不进公共 reading 缓存。

---

## 8. 需要作者拍板的四件事

1. **问题存在哪一层。** 建议：先每篇一问（P1），常备问题进 profile 放到 P5。理由：每篇一问最接近"读这篇我到底要什么"，也最便宜。
2. **Peer 的话要不要中文。** 建议：加一个 reading-prefs 开关 `peerVoiceLanguage: "en" | "zh"`，只作用于 summary / answers / terms / 说人话；**论文原句永远不翻译**（证据必须逐字，翻译就无法验证）。
3. **上传改走 pdf.js（D3）要不要做。** 建议做，这是作者主场景的结构质量上限；Python 保留为兜底。
4. **"跳"的措辞。** 建议页面不出现"跳"字，用"没提到〈问题〉"，保持 Peer presents, the user judges。

---

## 9. 风险

- **问题太空**（"这篇讲什么"）：Tier 0 路会把每节都标"扫"。对策：问题少于 2 个 specific term 时不做路由，只给地图，并提示"问得具体一点，Peer 才能指路"。
- **长文 Pass 2 看到了结构后输出变长**：caps（D7）兜底；answers 3、readNext 4、terms 8 是硬上限。
- **上传切换抽取器后旧 report 缓存不一致**：`revision` 已在 key 里；D3 上线时 bump 上传的 `extractionVersion`（`upload-concepts.ts` 已有这个概念）。
- **说人话改错数字**：单测用数值正则比对原文与改写；不相等就丢弃改写，显示原文。
- **范围蔓延成 Q&A 聊天**：v1 只有"一篇一问、可换问"，没有多轮；追问 = 换问题重跑 Pass 2。Deep-dive 仍然是另一个 blueprint 的事。
