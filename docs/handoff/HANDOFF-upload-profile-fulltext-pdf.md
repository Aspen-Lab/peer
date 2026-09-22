# Handoff：上传论文驱动用户偏好学习、PDF 补全原报告、私有存储与版权边界

日期：2026-09-19（America/Chicago）  
目标分支：`complimentary-enhancement-to-main-update`  
调查基线 HEAD：`881bd54d88d0f1c10a47b1f06b84f6aa229763e8`  
仓库：`D:\local files on this PC\Github\Peer\peer`  
Web 项目：上述仓库下的 `web/`

**这是一份调查、设计和审核交接，不是实现完成报告，也不是上线许可。** 用户最新要求是：目前不要继续开发，把所有需求调查清楚，写成 Markdown，交给另一个 agent 实施并审核。本文之后的代码工作应由接手任务按用户指示进行。

## 0. 接手前先处理工作区状态

本轮在用户改为“只做计划”之前，已经产生了试验性、未提交的实现。用户改口后，已停止继续开发。

一次包含“撤回本轮修改、移除本轮新文件、清理本轮临时 Python 环境”的命令被自动审批策略整体拒绝，工具仅返回 `blocked by policy`，命令没有执行。**当前工作区仍有这些草稿，不能假定本仓库只增加了本文，也不能把草稿当作已经验收的实现。** 不要换工具规避此次拒绝；如果要撤销，先明确用户授权和可用的允许流程，保留既有修改。

本轮开始之前，以下两个文件已经被修改，属于已有用户工作；不得覆盖、回滚或混入本需求的实现归属：

- `web/src/components/reader/figure-lightbox.tsx`
- `web/src/components/reader/figure-lightbox.test.ts`

最终核对工作区时还出现了 `web/src/components/persona/result.tsx` 和 `web/src/components/persona/result.test.tsx` 的修改/新增；这些不属于本轮已知实现范围，视为其他进行中的工作，保留，不要回滚。

本轮草稿涉及上传 API、reading/report/figure API、reader 页面、上传按钮、profile 页面、偏好 ledger、feed 查询与缓存、PDF 图片提取器及相应测试。新文件包括：

```text
web/src/lib/papers/upload-access.ts
web/src/lib/papers/upload-access.test.ts
web/src/lib/papers/upload-policy.ts
web/src/lib/preferences/upload-concepts.ts
web/src/lib/preferences/upload-concepts.test.ts
web/src/lib/figures/private-pdf-extract.test.ts
web/src/components/briefing/upload-consent-dialog.tsx
web/src/components/reader/use-private-supplement.ts
web/src/components/reader/private-pdf-status.tsx
web/src/components/profile-uploads.tsx
web/src/app/api/jobs/purge-uploads/route.ts
```

这些文件可用于理解调查结果，但以下计划才是审核依据，**不是要求保留草稿的所有设计**。特别注意本文列出的草稿缺口。

还有忽略目录内的本轮调查辅助文件：

- `web/.local-data/pdf-runtime/`：独立 venv，安装了 PyMuPDF 1.28.2；未安装到全局 Python。
- `web/.local-data/create-private-pdf-fixture.py`、`web/.local-data/private-upload-test.pdf`：自制、非真实论文的测试材料。测试 PDF 没有通过网页上传。
- `web/.env.local`：本轮追加了指向上述 venv 的 `PYTHON_BIN`。不要输出其他环境变量或把这个文件提交到 Git。

没有提交、推送、创建 PR 或部署。本任务也没有获得这些操作的新授权。旧 handoff 里属于旧批次的授权不能自动套用到本批次。

接手时先执行只读检查：

```powershell
git branch --show-current
git status --short
git diff --stat
```

读根目录 `AGENTS.md`、`web/AGENTS.md`、`docs/PRODUCT_DIRECTION.md`。不要创建新分支。Next 是 16.2.3，修改 route/component 前读对应的 `web/node_modules/next/dist/docs/`。产品规则引用的在线 admin 站本轮未能访问，使用仓库中的产品方向文档作依据；不要声称已核对在线版本。

## 1. 用户要什么

虽然原话写“做两件事”，实际列了三个要求，三个都要交付：

1. 用户自己上传的文章是理解其兴趣的重要来源。拆解文章关键信息，接入 Peer 现有 profile 学习系统，把关键词真正用于之后的推荐。
2. Peer 推送的、非用户独立上传的 report，在 deep report 的 `Open at the publisher` 右边增加绿色按钮，文字准确为 **`upload full article pdf`**，视觉格式沿用相邻按钮。用户上传全文 PDF 后，用它完善同一篇论文原先只读到付费墙前信息的报告，包括正文依据和图片。这个主动补传行为同样是重要偏好信号。
3. 用户担心付费论文的上传与存储给 Peer 带来法律风险。需要真实的风险控制与法律边界说明，不能用一句“私有存储所以合法”交差。

产品约束：显式声明的研究方向优先；一篇论文不应改写整个用户画像；无模型 key 仍可用；复用已有上传、抽取、报告与推荐流程；不增加通用 agent 平台。

不在本需求内：破解付费墙、获取机构登录凭据、公开分发用户 PDF、共享付费论文库、自动训练公共模型、重写其他推荐系统、修理无关 benchmark。

## 2. 已调查的现有系统（指 HEAD 基线，区别于工作区草稿）

### 2.1 代码入口

| 能力 | 关键文件 | 调查结论 |
| --- | --- | --- |
| 首页上传 | `web/src/components/briefing/upload-button.tsx` | 选择/拖放 PDF，multipart POST，成功后跳到独立 `upload:` 论文；尚无学习调用。 |
| 上传 API | `web/src/app/api/papers/upload/route.ts` | `%PDF-` magic bytes、25 MiB 上限；调用 Python 抽取标题/DOI/摘要/页数；缺失标题有本地开发模型 fallback。 |
| 文件与元数据 | `web/src/lib/papers/upload-store.ts` | `.local-data/uploads/<hash16>.pdf` 与 `.json`；原始字节 SHA-256 截前 16 个 hex；`upload:<hash16>`；按文件去重，基线没有 owner 字段。 |
| 上传记录/原文件读取 | `web/src/app/api/papers/upload/[id]/route.ts`、`[id]/file/route.ts` | 校验 ID/文件存在，基线没有用户身份归属校验；原文件缓存为 `private, max-age=3600`。private header 不等于鉴权。 |
| 完整正文 | `web/src/lib/papers/full-text.ts` | `upload:` 直接走本地 `pdfPath()`；其他来源继续原 HTML/PDF 获取流程；有按 paper ID 的进程内共享缓存。 |
| 确定性 reading | `web/src/app/api/papers/[id]/reading/route.ts` | 基线上传 reading 也可能返回 `public, s-maxage=86400, stale-while-revalidate=604800`。正文泄漏风险不能只靠保护下载链接来解决。 |
| 报告生成 | `web/src/app/api/papers/report/route.ts` | 同时有 NDJSON 与 JSON 两条逻辑；两边各自调用 `getFullText`、`generateDeepReport`、`getFigurePool`、`bindFiguresToReport`。不能只改其中一条。 |
| 报告页面/按钮位置 | `web/src/app/papers/[id]/page.tsx`、`web/src/components/reader/decision-block.tsx` | 实际按钮在 `DecisionBlock`，不在 `TitleBlock`。reader 中保留原论文 identity。 |
| 浏览器报告/reading 缓存 | `web/src/components/reader/use-model-report.ts`、`use-reading.ts` | report 基线是 `peer-paper-report-v6`；reading 是 `peer-reading-v1`；会写 localStorage。报告 key 未区分用户的 PDF 附件版本。 |
| 图片入口 | `web/src/lib/figures/extract.ts`、`web/src/app/api/figure/route.ts` | 上传图片也可由 `/api/figure?id=upload:...` 取得；命中图片时基线可发送公共 CDN 缓存头；有进程内 candidate pool。 |
| 浏览器图片缓存 | `web/src/components/paper-figure.tsx` | 模块级 `inFlight`、`settled` 缓存；不是只有 localStorage 要审计。 |
| PDF 图片提取 | `web/src/lib/figures/pdf-extract.ts` | **基线把中间结果写入 `path.dirname(pdfPath)/figures.json`。上传文件共用目录，因此并发会竞争同一文件，且结果可能长期残留。** |
| Python helper | `web/scripts/extract_pdf_text.py`、`extract_pdf_figures.py` | 已有正文分节与图片能力，应复用；扫描件无 OCR 文本时不能假装提取成功。 |
| 用户学习 | `web/src/lib/preferences/ledger.ts`、`web/src/store/profile.ts` | 已有 concepts、正负反馈、衰减、上限、来源分流、profile 摘要和 reset。上传映射基线没有可用的实验关键词。 |
| 画像同步 | `web/src/components/profile-sync.tsx`、`web/src/app/api/profile/route.ts`、`web/supabase/schema.sql` | `preference_ledger` 为 JSONB，用户行有 RLS；server 会 `cleanPreferenceLedger`，新字段必须保留。客户端同步是延迟 diff PUT。 |
| 推荐检索/排序 | `web/src/lib/feed/profile-compiler.ts`、`pipeline.ts`、`web/src/store/feed.ts` | ledger 已进入排序；检索 query 来自 compiler；有按天候选池，修改关键词还要审查 cache key 与日更新策略。 |
| 候选池 key | `web/src/lib/opportunities/pool-cache.ts` | 基线按 surface/topics/soft topics/tier/date 等建 key，未涵盖上传兴趣。如果把私人兴趣用于构建候选池，旧 key 可能让不同兴趣的用户复用不合适的池。 |
| 词汇归一化 | `web/src/lib/scoring/term-expand.ts` | 已有 NFKC/canonicalize、材料/电化学缩写组与 generic terms；优先复用，不要新建冲突的词表。 |
| 部署配置 | `web/next.config.ts` | Next proxy body cap 已为 30 MB，不能代替平台自身上限；部分 Python helper 通过 output tracing 显式包含。新上传路径和 report→figure helper 都要核对打包。 |

### 2.2 现有偏好数值与传播方向

- 常规偏好半衰期：60 天；facet 偏好另用 14 天。
- 一条 item 最多 16 个 concepts。
- 正反馈总增益上限：0.18；负反馈最大扣减：0.6。
- 原正反馈一次加 1；用户声明的 required topics 有负反馈保护。
- paper 来源可影响 paper、event、job；反向不能让 job/event 兴趣改写 paper 研究方向。不要读反 `ORIGIN_INFLUENCE` 的 target/origin 下标。
- `conceptsFromPaper()` 优先用 `preferenceSignals`，否则用 `summaryExperimentKeywords`。只往 PDF metadata 写一份关键词，不接入 ledger 和排序，不算完成。

### 2.3 实际调查中的限制

- 本机原先 `python`、`py -3` 均不能 import PyMuPDF；`python3` 是 Windows Store alias。调查安装了上述独立 venv。接手后需核对实际 server 的 `PYTHON_BIN`，不能只看 shell 里能否 import。
- 本轮浏览器看到了真实 report 和绿色按钮，但当时按钮在狭窄双栏左面板里换到了 publisher 按钮下面。随后草稿调整了布局，**调整后的同排效果尚未完成浏览器复验**。
- 没有跑完“真实上传 → 原报告补全 → 刷新 → 删除”的浏览器端到端流程。不能用已有截图或 unit test 宣称完成。

## 3. 推荐的数据与职责边界

将下面三个概念分开，不要把私人全文变成公共 Paper 的新属性后全站复用：

1. **公共论文记录**：原 `paper.id`、title、authors、DOI、publisher URL、收藏身份不变。
2. **用户私有资产与关联**：`owner + originalPaperId → uploadAssetId + revision`。同一篇公共论文允许不同用户提供自己的全文。
3. **用户偏好证据**：每篇文档提取出的少量规范化概念与上传行为；通过现有 ledger 影响该用户推荐。

建议数据契约（名称可调整，语义必须保留）：

```ts
type UploadedConcept = {
  key: string;
  label: string;
  facet: "topic" | "problem" | "method" | "material" | "dataset" | "application";
  confidence: number;
  evidence: { section: string; start?: number; end?: number };
};

type PrivateUpload = {
  assetId: string;
  ownerId: string;             // 只从服务端认证取得
  objectKey: string;           // 不暴露为公共 URL
  contentSha256: string;
  documentKey: string;         // owner 内逻辑文档身份
  createdAt: string;
  expiresAt?: string;
  status: "pending" | "ready" | "deleted" | "blocked";
  rightsVersion: string;
  rightsAcceptedAt: string;
  extractionVersion: string;
  concepts: UploadedConcept[];
};

type PaperSupplement = {
  ownerId: string;
  paperId: string;
  assetId: string;
  revision: string;
  match: "verified" | "needs-confirmation";
};
```

`ownerId`、objectKey、权利确认审计字段不直接回给浏览器。API 返回需要显示的 paper/附件摘要、到期时间和 concepts 即可。

数据库与文件路径都是实现选择：自托管可沿用私有磁盘；多实例/托管环境需真正共享的私有持久存储与身份隔离。不要新增一个无法在目标部署使用的本机目录却宣称上线可用。

## 4. 任务 A：把上传文章变成偏好信号

### 4.1 提取什么

目标是“这位用户愿意花精力了解什么”，不是“用户认同文中结论”。按重要性提取研究问题、核心主题、方法/仪器、材料/研究对象、数据集/评价任务、应用场景。

按标题/作者关键词/摘要 → 方法/结果/结论 → 引言/其他正文的优先级取证。忽略参考文献、作者单位、版权页眉、页码、重复模板、资助声明。不要把 `paper`、`results`、`novel`、`high performance` 等泛词当有效画像。

保留“来自哪篇文档、哪个 section、抽取版本、置信度”。正文引用如有必要，只放 owner 私有资产，不把大段原文写进 profile、feed 缓存、日志或事件/职位查询。

### 4.2 两层实现

**Tier 0 必须先成立。** 本地从已抽取的分节文本取少量短语，推荐最多 8–12 项；过滤停用词/动作词/泛词，处理大小写、Unicode、连字符和已有缩写别名。标题/摘要证据强于正文一次提及；方法词应确实出现在本文的方法语境。模型不可用时仍能给出可信子集，允许空列表。

**可选模型增强。** 复用现有已选择 provider，输出受 schema 限制的候选概念。每个候选须能在提供文本中定位，或能映射到现有受控别名，无法取证就丢弃。PDF 内容视为不可信数据，不得让文内提示词修改系统规则、调用工具或外传画像。失败回退 Tier 0；不要为了学习额外强制用户购买模型。

不要把一个简陋 n-gram 排序器描述成已完成语义画像。审核至少使用材料论文、计算机论文与不同排版的长标题；检查动词拼接、错误领域词和引用文献污染。

### 4.3 如何进入现有 ledger

- 增加独立的 upload evidence/source；不要冒充一次 save，也不要把来源信息丢成一个不可逆 positive 数字。
- 建议初始权重为 `2 × confidence`，普通 positive 仍为 1。这个数值是设计建议，不是用户指定值，需通过样例审核校准。
- 独立上传与给推荐论文补传全文，都算主动投入，使用同一强信号语义。
- 继续使用 60 天衰减、现有正向总增益上限与显式负反馈逻辑。不要自动改写 `researchTopics`、`currentProject`、required topics 或已声明的职业信息。
- 同一逻辑文档重复上传/刷新/重跑抽取，只计一次。先用 content hash 去重；只有 DOI 确认属于本文时才用于合并不同 PDF 版本，不能取参考文献里第一个 DOI 当本文 DOI。
- 文档版本变了，可更新该文档的提取结果，但不能把“重新提取”计成用户再次表达偏好。
- 删除某个来源应能撤销它贡献的证据，保留用户的 likes/saves/dislikes。存在同文档的多份私有副本时，删除一份不能误删仍有效的另一份来源证据。
- `cleanPreferenceLedger`、profile server 映射、hydrate、export/import、reset 都要覆盖新字段。
- 不要只依靠“上传返回后浏览器发一个延迟同步”保证持久化；验证导航/断网/重试/多设备同步。可做服务端幂等写入，或可靠 outbox；重复请求不得双倍计分，服务端仍须绑定 owner。

### 4.4 如何真正影响推荐

1. 排序：进入已有 `scorePreferenceMatch`，同义词可以通过既有规范化桥接。候选来源没有 OpenAlex concept 标签时，仍需匹配 title/abstract 中的真实词组，使用词边界，不能宽泛 substring 命中。
2. 检索：在 compiler 中少量补充高置信兴趣 query。建议最多 3 个，以 declared topic 为锚；不取代原 query，不扩大公共推送为文章原文检索库。
3. 缓存：如果 build pool 受上传兴趣影响，key 必须含对应的规范化输入摘要/版本；私有正文不进入缓存。或者保持共享候选池完全不受 private learning 影响，只做读取时排序。**必须二选一并明确，不允许 private query + 旧 shared key 的混搭。**
4. 节奏：现有系统有按日候选池与 promoted search inputs。推荐在现有池即时重排、下一次合理刷新/下一天扩展检索；不要每次 profile 渲染都重抓来源或花模型费。
5. UI：在现有 “What Peer has learned” 中可见、可 reset；至少能说明某个信号来自用户上传。推荐增加“这篇文章不代表我的兴趣/移除该来源”入口，允许保留私有 PDF 而撤销学习。

## 5. 任务 B：在原报告补传全文

### 5.1 UI 与状态流

- 在 `DecisionBlock` 的 publisher 按钮**右边**放绿色按钮。使用 `buttonVariants` 的尺寸、字体、间距、边框/圆角语言，而不是另造视觉系统。
- 精确文案：`upload full article pdf`。
- 对非 `upload:` 来源的论文 report 提供入口，包括因付费墙而降级到 abstract 的 deep-report 请求。不能把“当前生成结果 depth=deep”当显示前提，否则最需要按钮的页面反而没有。
- 用户独立上传论文不显示重复的“补全文”按钮。
- 双栏左面板约 400–503 px，两个长按钮的自然宽度可能超过它。要设计为一组等高相邻按钮，在需要时让标签有控制地换行；桌面不得悄悄把绿色按钮挤到下一行。移动端处理可读性、44px 点击目标和无横向溢出。
- 选择 PDF → 简短权利与处理说明 → 明确确认 → 上传/验证/提取进度 → 重新生成原报告；失败恢复可重试，保留原报告。
- 完成后留在原论文 URL；不跳成另一个 `upload:` 论文，不丢作者、DOI、收藏、已读和反馈。
- 状态说明应区分“PDF 已附加”“全文已读到”“模型生成失败/未配置”“PDF 无文本”，不能上传成功就声称 deep report 完成。

### 5.2 API 与匹配

复用现有 multipart PDF 上传入口和抽取 helper，可加可选 `targetPaper`/`paperId` 参数，或用独立 attachment route 调同一 service，避免两套上传实现。

实施顺序：

1. 服务端身份、同源写入检查、部署能力检查、资源限额。
2. PDF 大小与 magic bytes 验证；考虑缺失/伪造 Content-Length 和 chunked body，读取过程中仍有上限。
3. 在私有、独立的临时目录解析，不要先把未验证文件永远写入最终资产库。
4. 核对 PDF 与原论文。优先 DOI（须是本文 DOI）；否则 title token overlap/规范化标题加证据。不能仅凭文件名验证。若标题分行导致 extractor 不完整，要有明确的人工“确认这是该论文”路径，不能误拒一切合法 PDF，也不能默默接受不确定匹配。
5. 确认后原子落盘/落库并绑定 owner+paper；失败回收临时文件。相同文档并发提交必须幂等。
6. 记录上传偏好证据，与报告生成成功解耦：AI 故障不应抹去用户已表达的兴趣；无正文时不制造猜测关键词。
7. 返回附件版本、必要的阅读状态与提取信号；不向其他用户更新公共论文记录。

扫描件/OCR：本轮不要求开发 OCR。无文字时说明限制，不用摘要伪装全文。是否保留作为私有文件可与是否成功附加全文分开处理。

### 5.3 原报告如何升级

- 公共 `paper.id` 保留；增加仅在 owner 请求上下文有效的 `fullTextUploadId` 或等价 source resolver。
- `getFullText`、`getFigurePool` 使用该 owner 的上传资产；provider 与 `generateDeepReport` 仍得到原论文身份和用户上下文。
- JSON 与 NDJSON 都走同一授权与正文选择规则。
- 更新 `useModelReport` 的 key：至少原论文 ID、私有附件 revision、report depth、当前工作上下文与 provider。旧的 abstract/paywall 报告不能挡住重生成。
- reading 也要刷新，不能只替换模型 report；PDF 页数、完整正文、provenance 和图片来自新资产。
- `deepRequested` 的说明与实际请求保持一致。补全文后若直接启动一次 deep read，要尊重 provider 配置/付费选择并解释动作；不能一个 hook 强制 deep，另一个仍显示“请开启 deep reports”。
- 没有模型时仍显示从 PDF 提取的真实文本和可用图片；禁止伪造 model report。
- 图来自同一 PDF，保留 caption/evidence 定位。不要把 publisher 缩略图混成用户补传文档的已验证图。
- 冷启动、刷新、另一设备登录后能恢复 owner 的附件关系。退出登录/换账号后清除私有文本与图片的 UI 状态、中止相关请求。

## 6. 任务 C：存储、隐私与版权风险控制

### 6.1 必须明确的法律结论

**任何 agent 都不能承诺“上传后绝对合法”“Peer 不承担法律风险”。** 私有存储、短保留期、用户勾选声明都是风险控制，不是版权许可，也不是平台自动免责。

以美国法律为参考基线，研究用途只是 fair use 可能适用的目的之一，仍需结合用途、作品性质、使用量与市场影响等具体情况评估；整篇付费文章不能仅因“供个人研究”就推定可上传到第三方并交给 AI 处理。[美国版权局 fair use 说明](https://www.copyright.gov/fair-use/more-info.html)

美国 section 512 的安全港有条件。托管服务若拟依赖它，需要依法落实指定代理与登记、公开联系方式、通知/删除与反通知处理、重复侵权政策等适用条件；自动生成报告是否及在何种范围受保护也需要专门评估。不要在产品里宣称 Peer 已取得安全港保护。[美国版权局 section 512 说明](https://www.copyright.gov/512/)、[17 USC 512 原文](https://uscode.house.gov/view.xhtml?req=%28title%3A17+section%3A512+edition%3Aprelim%29)

用户、经营主体、服务器和用户所在法域未确认，不能把美国规则当全球法律意见。上线前应让合格法律顾问确认目标法域、出版商/机构订阅条款、允许的第三方处理、原文/图表在私有报告中的使用方式与运营流程。订阅下载权和作者身份都不自动代表拥有全部再处理权。

已有 PDF helper 使用 PyMuPDF，其许可另有 GNU AGPL/commercial 双许可问题；不能把 Peer 仓库的 MIT 标签当作已经覆盖它。评估当前集成方式与发布模式的许可义务，必要时取得合适商业许可或替换依赖；不要在本任务中作武断许可结论。[PyMuPDF 官方仓库](https://github.com/pymupdf/PyMuPDF)、[官方 PyPI 许可信息](https://pypi.org/project/pymupdf/)

以上资料为本轮已查阅的权威/官方来源；若实施时事实或运营计划变化，要重新核对。不要用上传确认框替代这些工作。

### 6.2 工程上必须做到

| 面 | 必须满足的条件 |
| --- | --- |
| Owner | 生产环境从服务端认证 session 得 owner；不能信任 multipart/body/header 自称的 userId；无认证配置应拒绝 hosted 上传。 |
| 本地开发 | 若继续支持未登录使用，使用每浏览器独立 HttpOnly capability 或明确的单机隔离；严禁共同 `local-user` 让所有来访者共享。开发授权不能误开到生产。 |
| ID/路径 | 不以难猜的 hash 代替 ACL；所有 ID 解析集中校验；文件路径不得逃出私有 root。ID/去重至少按 owner 隔离，跨 owner 相同 PDF 不能变成共享资产。 |
| 文件/存储 | 不放 `public/`；bucket 私有并有 RLS/对象授权；下载需认证或短时受限授权。使用合适的加密、ACL、传输安全和可控备份。Windows 的 POSIX mode 数值并不能自动证明 NTFS ACL 合格。 |
| 授权覆盖 | metadata、原 PDF、reading、report（含 shallow/deep/JSON/NDJSON）、figure、profile 列表、附件查询、删除都检查 owner；内部“直接读路径”不能绕开。 |
| 缓存 | 私有响应 `private, no-store`，按 Cookie/认证区分；不要进公共 CDN、公共候选池或跨账号可读 localStorage。进程缓存若保留，必须 owner+revision key 且每次先鉴权，否则直接不缓存私有派生内容。 |
| 中间产物 | 解决共享 `figures.json`：每次提取使用独立临时目录，成功/失败/超时都清理；并发 A/B 图不能串。检查 helper 的其他输出和子进程临时文件。 |
| 明示许可 | 上传前说明私有存储、学习用途、保留期、AI provider 外发；明确确认有权进行这些操作，服务端校验并留版本/时间审计记录。 |
| 外部 AI | 原文/图片只去用户配置且同意使用的 provider；说明 provider 可能有自己的保留/训练条款。不得承诺 Peer 无法控制的第三方“绝不存储/绝不训练”。审查标题 fallback、语义选图和视觉选图这些隐蔽调用。 |
| 数据最小化 | 画像仅需有限概念及来源，不存整篇正文；不为公共检索/其他用户训练、营销、搜索收录重用私有内容。 |
| 删除/封禁 | 有 owner 删除入口；撤销访问、清理 PDF/关联/派生缓存，撤销或按政策保留已明示的学习信号；版权处理需可由授权运营人员 block/remove，不能只有用户自己能删。 |
| 并发删除 | 删除/封禁/到期后，在途提取与 AI 工作不能再发布或重新落盘该资产。最终写入/返回前检查状态/version，取消或丢弃过期任务。 |
| 保留期 | 有实际执行的清理任务及失败监控，覆盖孤儿 PDF、metadata、附件索引、临时图、缓存和备份策略；不是仅加 expiresAt。 |
| 资源防护 | 流式大小上限、并发/配额/超时，隔离解析不可信 PDF；错误日志不吐正文、图片 base64、API key。 |
| 打包/部署 | 上传目录不被 Git、静态资源、Next file tracing 或 build artifact 意外带入公开发布；确认目标运行时有 Python/helper/依赖及私有持久存储。 |

### 6.3 保留期建议与界面诚实性

工作区草稿暂定 30 天，是本轮提出的设计选择，**不是用户已经指定的期限**。接手者应按产品用途选择并明确说明期限；如果用 30 天：

- 到期即拒绝访问；正常清理任务在约定窗口物理清除。
- 每次新上传“顺带清扫”只能作为补充，不能替代无人上传时仍运行的定时任务。
- “文件到期”与“画像兴趣衰减/清除”是两个生命周期，向用户说明，不要默默永久保留来源信息。
- 备份、legal hold、第三方处理的保留例外需准确描述。不要承诺删除后能收回用户已下载副本或第三方已接收的数据。
- 临时草稿里的 purge API 和 `.env.example` 不代表 scheduler 已配置，必须实际验收。

### 6.4 旧数据迁移

基线旧 metadata 无 owner，不能通过“第一个访问这个 hash 的账号”认领。

推荐：先阻止旧无主资产通过现有路由继续公开读取，按运营政策隔离；有可靠归属证据时迁移，否则提示用户重新上传。任何批量删除须明确授权，不能擅自清空旧目录。

部署时清除旧公共 reading/figure CDN 缓存；仅给新响应加 no-store 不能撤回已有 CDN 内容。浏览器旧 `peer-paper-report-v6` 与 `peer-reading-v1` 中可能有上传正文，需要版本迁移/清理。检查模块级图片缓存、service worker（如有）、收藏记录里不该含的派生内容。

### 6.5 上线边界

开发可以完成所有技术保障；上线前另行确认：

1. 目标法域与上传/AI 处理许可路径经法律审核；用户条款与隐私说明真实一致。
2. 适用的投诉联系、通知处理、重复侵权处理与登记等运营措施确实存在。不可编造 DMCA 代理联系人。
3. 存储与访问部署、清理 scheduler、备份和事故处理经过实测。
4. PyMuPDF 等依赖许可处理妥当。
5. （2026-09-22 补充）同一个人在不同设备上看到同一份上传（B6 的跨设备半边）本地无法验证：本地开发环境用每个浏览器一份能力 cookie 认 owner，没有真实登录账号，因此这一项在本地既不能通过也不能失败。上线后必须在真实 Supabase 登录下实测：同一账号在两台设备上看到同一份上传，且别人的账号看不到。在实测通过前，不得在任何文档或报告里写“跨设备已验证”。

在这些条件缺失时，建议 hosted 上传默认关闭，但保留可解释的不可用状态；不要让一个环境开关本身被当成法律合规证明。用户当前没有要求部署。

## 7. 现有草稿不能直接作为最终实现的具体原因

接手者除常规 review 外，特别复查：

- 关键词只是启发式候选，尚未充分验证跨领域、别名、否定/比较、语言和方法语境；需按第 4 节完善或明确能力边界。
- DOI 仍可能来自错误的引用；文章匹配阈值和 fallback 标题可能误拒/误绑，尚无完整的不确定匹配确认流程。
- 上传学习主要在浏览器成功 callback 写 ledger，再靠延迟 profile sync；断网、多设备竞争、服务端幂等尚未闭环。
- 同一 DOI 的不同 PDF 删除其中一份，草稿直接按 documentKey forget，可能过早移除仍有效证据。
- 草稿对正文/图片“不缓存”有初步处理，但缺少完整的在途删除/封禁、历史 CDN 清理和跨标签页删除验收。
- 文件写入和关联索引不是完整事务；同 owner 并发上传/替换、metadata 写入失败与删除竞争需要测试。
- 30 天到期有检查/清理入口，但未配置实际定时任务；不存在完整的孤儿文件恢复、备份与投诉处理闭环。
- 自托管本地路径方案不是 Vercel 或多实例生产存储方案；平台请求体上限和 Python 运行环境未验证。
- 改了 report hook 的 supplement deep 行为，但 reader 的 `deepRequested` 说明仍需核对，不能显示互相矛盾的状态。
- 对超大 chunked body 的限制、rate limit/解析资源限制尚未完整实现。
- 临时文件清理解决了一个共享 `figures.json` 问题，但不能据此声称所有已存在派生副本均已清除。
- 用户改为只做计划前，尚未完成最终代码格式整理、完整 UI 验收、生产 build 与新字段端到端同步检查。

## 8. 给执行 agent 的实施顺序

### 阶段 0：整理基线，不误伤已有工作

核对用户当前授权与本文件 §0；确认分支；记录已有 figure-lightbox diff；审查草稿，决定哪些按计划修正、哪些应弃用。不要进行未经允许的批量恢复/删除。把“HEAD 原有问题”和“草稿新行为”分开记。

### 阶段 1：先封住私有资产边界

完成 owner 契约、存储适配、访问检查和缓存边界；修复图像中间文件竞争；规划旧数据隔离与迁移。全路径的跨账号拒绝测试先通过，再联通新上传按钮。

### 阶段 2：完成可追溯学习

完成本地提取、normalize、upload evidence、幂等、撤销、profile 同步/导出/reset；接入排序与受控检索，修正候选池 key。明确用户可见解释与强度上限。

### 阶段 3：补传原论文与重生成

复用上传入口，完成匹配和原子关联；两个 report 分支、reading、图片都解析 owner supplement；刷新 cache key；保留原 URL/身份；实现错误与重试状态。

### 阶段 4：生命周期与运营准备

删除/封禁/到期/在途任务，私有文件列表与学习撤销，实际清理任务、监控、legacy 缓存迁移、部署文档与许可审核事项。不要最后才发现生产没有可用存储。

### 阶段 5：按下表审核，并交代剩余上线前置条件

先 targeted tests，再类型/相关 lint，再本地回归。浏览器检查桌面、手机、日/夜和 reader 缩放。只报告实际验证过的结果，未经用户要求不 push/部署。

## 9. 审核与验收矩阵

| 编号 | 场景/动作 | 必须观察到的结果 |
| --- | --- | --- |
| A1 | 独立上传一个自制、有明确标题/摘要/方法的 PDF | 有限真实关键词；能指出来源 section；profile 学习可见；无需模型 key。 |
| A2 | 同一 PDF 上传两次，刷新/重新抽取 | 无重复论文资产（owner 内按策略）；不重复加权、不刷新为虚假新偏好。 |
| A3 | 同一论文的不同 PDF 版本 | 在可靠 DOI/身份确认后只计一份逻辑兴趣；删除一个副本不误撤销其他有效来源。 |
| A4 | 参考文献重复不相关主题、版权页眉、普通动词 | 这些内容不主导关键词；不存在虚构的作者关键词。 |
| A5 | 候选论文没 taxonomy tags，但 title/abstract 有抽取的词组 | 有适度排序提升；无相关词者不获提升；不会把一个短词误匹配到所有领域。 |
| A6 | 一篇不相关上传、很多重复上传、明确 dislike、required topics | declared intent 与负反馈仍有效；单篇增益受上限限制，不能劫持 feed。 |
| A7 | 时间推进 60 天、reset、移除一篇来源、导出/导入、登录另一设备 | 衰减正确；reset/撤销精准；同步字段不被 cleaner 丢掉；不误删其他反馈。 |
| A8 | 用户 A/B 同 topics 不同上传兴趣 | 若检索不同，候选池缓存不误共享；公共缓存没有任一用户私有正文/图。 |
| B1 | 非上传来源的付费墙降级报告 | publisher 按钮右边出现绿色准确文案；不能被 depth=abstract 降级状态隐藏。 |
| B2 | 独立上传论文页面 | 不显示重复补全文入口；仍能查看私有状态及删除。 |
| B3 | 给报告补传正确全文 | 留在原 URL；title/authors/DOI/save/read 不变；旧简陋报告失效；正文与图片基于新 PDF。 |
| B4 | PDF 上传成功但模型失败/无 key | 保留原报告或真实确定性阅读；准确说明缺失；上传学习仍幂等保存。 |
| B5 | 错误文章、DOI 不符、长标题、扫描件、损坏/加密 PDF | 不静默覆盖；错误可恢复；不存在假“全文已读”；不残留未确认最终资产。 |
| B6 | JSON、NDJSON、重开页面、重启 server、另一设备 | 都恢复同一 owner 附件；无 stale public report 遮挡、无重复累计信号。 |
| B7 | 替换附件/并发上传 | 最终 revision 明确；报告、图和 reading 不混用两个版本；文件与索引一致。 |
| C1 | 未登录者/B 账号知道 A 的完整 upload ID | metadata/PDF/reading/report/figure/关联列表/删除全部拒绝；先热缓存再测仍拒绝。 |
| C2 | 伪造 owner 参数、路径穿越、无效 ID、CSRF | 无越权、无越目录访问、无第三方站点可触发上传/删除。 |
| C3 | 同 PDF 被 A/B 上传 | 各自私有对象；没有跨用户认领、共享 download URL 或公共 dedupe side effect。 |
| C4 | 同时抽两份有明显不同图片的 PDF | A 永远得到 A 图，B 得到 B 图；输出临时路径不同，成功/失败后均不残留 `figures.json`。 |
| C5 | 删除/封禁/到期时仍有模型/图片请求在途 | 任务不能重新发布/落盘；下一次访问拒绝；浏览器旧状态正确移除。 |
| C6 | 到期后长时间没有新上传 | 定时清理仍执行；故障可被发现；不靠有人上传才清除。 |
| C7 | 注销/账号切换/另一标签页、刷新后读缓存 | 私有正文、report、data URI 图不会沿用上一个 owner 的内容。 |
| C8 | 旧无 owner 文件、旧 localStorage 和 CDN | 没有抢占认领；迁移有证据或要求重传；旧公开缓存按运行手册处理。 |
| C9 | 不勾权利确认、旧版本确认、跨站、超大 chunked upload | 在外发模型/持久存储前拒绝；资源消耗受限。 |
| C10 | 检查日志、构建产物、公共静态目录、备份策略 | 没有明文 PDF/base64/钥匙进入不该去的地方；部署与备份确实受控。 |
| L1 | 产品文案与上线说明 | 无“免责保证”；明确订阅访问≠全部上传处理许可；不虚构版权代理与第三方数据政策。 |

安全审核不要只 mock 掉 `ownedUpload()` 然后宣称鉴权通过。需要测试真实授权 helper 与至少一个完整 route 链路，覆盖拒绝发生在磁盘读/模型调用/缓存返回之前。不要只测试新按钮 JSX 字符串。

### 9.1 推荐的验证命令

在 `web/` 执行，按实际新增文件调整：

```powershell
npx tsc --noEmit
npx vitest run src/lib/preferences src/lib/papers/upload-store.test.ts src/lib/papers/full-text.test.ts src/lib/figures/extract.test.ts src/lib/figures/pdf-extract.test.ts src/app/api/papers src/store/profile.test.ts src/store/profile-hydration.test.ts src/lib/feed/paper-daily-cache.test.ts
npx vitest run --exclude "**/benchmark.test.ts"
```

再对实际改动文件运行 ESLint。运行 build 前检查项目自己的 `prebuild`/生产 BYOK 环境要求；不要为让 build 通过关闭安全检查或填假密钥。如果部署目标涉及 Python、private storage、scheduler，还需在该环境实测，单元测试不替代部署验证。

### 9.2 浏览器验证

使用项目开发服务器与专用测试账户/会话，上传自行生成的原创测试 PDF。不要拿用户的付费论文或个人文档当测试材料，不要自动上传到外部服务。

至少检查：常规桌面双栏、约 390px 手机宽度、日/夜主题、reader 缩放；关注按钮是否确实在 publisher 右边、长文案可读、modal 键盘与 Esc/焦点恢复、error 后按钮恢复、重新选择同一文件可触发、报告重新生成不改变导航位置。

测试论文应包含正文只有全文才有的明确事实和唯一图片，确认报告基于它们；仅看到 depth 标签改变或出现任意图片不算验证成功。匹配错误测试需确保旧 report 仍在。

## 10. 本轮已运行的实验记录（不是最终验收）

以下结果都针对尚未交付的工作区草稿，**不是对原始 HEAD 或本文最终方案的通过证明**：

- 相关原有回归一轮：11 个文件、127 项通过。
- 后续部分新测试覆盖：owner/expiry/legacy rejection、关键词/衰减/撤销/排序、上传授权与匹配、JSON/NDJSON supplement routing；一个子集为 4 个文件、47 项通过。
- 单独的并发 PDF 图片临时文件隔离测试：1 项通过。
- 若干中间版本通过 `tsc --noEmit`；一轮相关 ESLint 命令无错误退出。最后一批调整后未完成完整最终检查。
- 一次不排除 live benchmark 的全量运行：127 个测试文件通过、1 个文件失败；2706 项通过、5 项跳过、1 项失败。失败为 `src/lib/events/benchmark.test.ts` 的在线数据 city 断言：`sdle.co.il -> Chicago`，预期为 silent。这是另一功能面的在线 benchmark，**尚未在原始 HEAD 重跑以确认是否既有失败**，不要直接称它“基线失败”，也不要因此扩展本任务去修 events。
- 浏览器确认过原 report 能加载以及绿色上传入口已出现；未完成真实补传与端到端验证。临时布局截图暴露了按钮换行问题，详见 §2.3。

## 11. 最终交付给用户时应报告什么

执行完成后，用中文简要说明：

1. 上传文章如何形成、去重、衰减与撤销学习信号，在哪些检索/排序环节生效。
2. 绿色按钮与原报告补全文、正文/图片、失败回退和刷新恢复是否实测通过。
3. 已落实的 owner 隔离、存储/缓存/临时文件/删除/到期保障。
4. 仍需法律与运营确认的上线事项，明确代码不能保证零法律风险。
5. 实际测试命令、结果与未验证部分；当前分支和是否提交/部署。

不要把“实现了一些保护”说成“所有上传 PDF 已合法”；也不要因为法律无法绝对保证，就跳过可以完成的产品与工程工作。
