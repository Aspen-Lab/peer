# Peer：Seed Paper（种子论文）功能计划

核查日期：2026-10-15。状态：**只做计划，尚未开工。**代码引用均来自 `origin/main` 的 `a43b42a`。

分支：`seed-paper`（Git 不允许空格，所以 "seed paper" 写成 `seed-paper`），从 `main` 当前提交切出。本轮只提交这份计划，不实现功能、不开 PR、不部署、不调用收费模型。

读者：先给作者自己看，用高中生能读懂的方式解释。每个专业词第一次出现时都有一句白话解释；代码路径放在括号里，看不懂可以跳过，不影响理解。

上游约束：`docs/PRODUCT_DIRECTION.md`、`VISION.md`、`docs/THREE_TIER_ARCHITECTURE.md`、`README.md`、`ABC-JEV-INTEGRATION.md` 的 §1 裁定。本文不推翻任何已锁定的决定，只在上面加一层；需要重新裁定的地方在 §8 单独列出，等作者拍板。

---

## 1. 一句话结论

**把"用户亲手上传的 1–5 篇种子论文"变成找论文的第一道入口：Peer 顺着每篇种子的"谁引用了它"、"它和谁站在同一批参考文献上"、"作者还写了什么"、"OpenAlex 认为它和谁相关"四条路去找候选；这些候选在每天建论文池的时候就进池，和关键词搜到的论文一起被打分、重排、交给模型和 Jev 判断；每篇候选带一项新的、看得见的"种子亲缘分"，最高 +0.35；种子一变，当天论文池立刻重建一次，但 Jev 的判断、没变的种子的查询结果、模型已写过的排序都尽量复用；一天只允许改一次。**

这不是另加一个推荐器。现有代码里已经有一套叫 "positive seed"（正例种子）的管道，只是它今天用的是"你点过赞/收藏的论文"、默认关着、而且只在"读取时顺手加几篇"。本计划把它改成"用户亲手声明的种子"，再把它从"读取时顺手加"升级为"建池时的主力通道"。

打个比方：以前 Peer 像一个只听你口头描述（关键词、项目描述）去书库找书的图书管理员。现在你直接递给他 3 本你最喜欢的书。他会翻每本书后面的参考文献、查谁后来引用了这本书、看看同一位作者还写了什么——这三条路找到的书，比靠关键词猜准得多。ResearchRabbit 就是这么做的（Earlier Work / Later Work / Similar Work / These Authors），我们借它的思路，但做成"每天 10 篇的天气预报"，不做成"一张越点越大的网"。

---

## 2. 现状盘点：今天 Peer 怎么找论文（必须先懂这个）

### 2.1 一张图

```mermaid
flowchart TD
    U[用户：必选主题、探索主题、项目描述、挑战、导师、期刊偏好] --> B[编译"检索简报"：生成查询词、时间窗、避开词]
    B --> C{今天这组设置的论文池<br/>已经建过吗？}
    C -->|没有：建池，一天最多一次| S[5 个免费学术源并行搜索<br/>OpenAlex / S2 / arXiv / DBLP / PubMed]
    A[导师 seed：谁引用了导师的论文] --> S
    S --> D[合并去重 → 丢掉过期 → 中性打分<br/>不含个人偏好账本]
    D --> T1[Tier 1 本地重排 + 多样性]
    T1 --> J[有 Jev key：Jev 看前 50 篇]
    J --> T2[有模型 key：模型把前 50 篇重排，写 20 条理由]
    T2 --> P[(当天论文池：最多 200 篇<br/>存模型排序 aiOrder)]
    C -->|建过：直接取| P
    P --> R[每次打开页面都重算：昨天剩的候选 + 读取时通道<br/>→ 加偏好账本打分 → Tier 1 重排 → 回放 aiOrder → 期刊加分 → 去掉已推送]
    R --> F[返回 5 或 10 篇]
    F --> L[(已推送账本：当天冻结批次，<br/>以后不再推同一篇)]
```

### 2.2 五个关键名词，白话解释

| 名词 | 白话 | 代码里在哪 |
|---|---|---|
| **论文池（pool）** | 一篮子今天找到并初步打过分的论文，最多 200 篇。建一次很贵（要等 5 个网站回话，20–30 秒），所以建好后整天复用。 | `web/src/lib/feed/pipeline.ts` → `buildPaperPool` |
| **缓存标签（cache key）** | 篮子上的标签。标签相同就直接拿篮子，不重建。标签里有：必选主题、探索主题、上传 PDF 学到的兴趣词、AI 档位、用户身份摘要、日期。**没有种子。**（用户身份摘要里包含了项目描述和导师 seed 文本，所以改项目描述今天就会重建池子。） | `web/src/lib/opportunities/pool-cache.ts` → `derivePoolCacheKey`，当前版本 `PAPER_CACHE_KEY_VERSION = 23`；`private-paper-cache.ts` → `createTrustedPaperCacheScope` |
| **入场通道（admission channel）** | 每篇候选身上贴的小标签，记录它是怎么进篮子的：`keyword`（关键词搜到）、`citation`（引用关系）、`semantic`（语义搜索）、`positive-seed`、`topic-field`。贴了非 `keyword` 标签的论文，可以**跳过"必须含有必选主题词"这道硬门槛**，但不加分。 | `web/src/lib/scoring/combine.ts` → `admittedByNonLiteralChannel` |
| **读取时通道（read-time channels）** | 四条默认关着的额外找论文的路（S2 推荐、OpenAlex 按种子标题找相似、种子的被引论文、OpenAlex topic）。它们**不进篮子**，而是每次打开页面时临时合并进来，所以模型和 Jev 从来没见过它们。 | `pipeline.ts` → `resolveChannelCandidates` |
| **冻结批次（frozen batch）** | 开了 `PEER_DASHBOARD_LEDGER` 时，登录用户每天第一次打开页面的 10 篇被"冻结"，当天怎么刷新都回放同一批；这 10 篇进永久账本，以后不再推。规则原文："same papers, same order, even after feedback, refresh or an intent change that day"（§1p.C(5)）。 | `web/src/app/api/feed/route.ts` → `runLedgerAwareFeed`；`lib/dashboard/delivery-ledger.ts` |

### 2.3 已经有的"种子"基础（本计划站在它上面）

1. **`ResolvedPositiveSeed` 类型**（`lib/preferences/positive-seeds.ts`）：一个种子 = 规范身份 + 可选的 OpenAlex 作品号 `W…` + 可选的 Semantic Scholar 论文号 + 标题。今天它由"最近 10 篇被收藏/点赞的论文"算出来。规则记录里明确写着："A user-declared seed list in the IntentCard is an open P1 follow-up, not built now"（§1p.B(5)）——**本计划就是那个待办。**
2. **三条种子通道**，都用环境变量开关、默认关：
   - `PEER_CHANNEL_POSITIVE_SEED_CITATIONS`：谁引用了种子（`fetchCitationNeighborhood`：一次 OpenAlex 调用，`filter=cites:W1|W2…`，最多 8 个种子，近 3 年，按被引次数排，取 40 篇）。
   - `PEER_CHANNEL_OPENALEX_SEED_SIMILARITY`：拿种子标题做 OpenAlex 语义搜索，每个种子 10 篇，最多 5 个种子。
   - `PEER_CHANNEL_S2_RECOMMENDATIONS`：Semantic Scholar 推荐接口。规则要求把种子 id 发给 S2 需要用户明确授权，且 S2 许可证只允许非商业研究用途（§1e、§1p.B(5)）。
3. **通道结果缓存**（`lib/opportunities/channel-candidate-cache.ts`）：按"用户 + 日期 + 种子集合签名"存一份合并结果；种子一变就是新签名、重新抓一次。
4. **自我排除**（`excludeSeeds`）：种子本身永远不会被当成"新发现"推回给你。
5. **导师流程**（`lib/affiliation/openalex.ts` + `components/profile/advisor-field.tsx`）：输入导师名字 → OpenAlex 找人 → 用户点"Yes, that's my advisor"确认一次 → 每月算一次导师近 3 年、和项目最相关的 8 篇 → 建池时拉"谁引用了这 8 篇"。这是"确认身份 + 顺着引用找"的现成样板。
6. **上传 PDF**（`lib/papers/upload-store.ts`、`app/api/papers/upload/route.ts`）：已能从 PDF 第一页用正则抓 **DOI**、用最大字号行抓标题、抽摘要、抽 12 个兴趣词进偏好账本；私有、按账号隔离、**30 天后过期并清除**。还没有把 DOI 换成 OpenAlex 作品号的步骤——不过评测代码里已经有一个现成的 `resolveOpenAlexSeed(doi)`（`lib/evaluation/live-channels/seed-resolution.ts`），可以搬到产品代码里用。
7. **强制重建开关**：`getOrBuildCachedPool(..., forceRebuild)` 已经写好"跳过读缓存、仍然写回、仍然防重复点击"的逻辑，但今天没有任何调用方传这个参数。曾被刻意搁置的原因是"请求体里的 force 标志可以伪造"（UPSTREAM-02）——所以本计划**不用请求体触发重建**，而是让服务器端记录的种子变化去改变缓存标签。
8. **Jev 判断缓存**（`lib/decisions/screen.ts`）：按"用户 + 意图指纹 + 论文内容哈希"存，**不含日期、不含种子**。所以池子重建时，已判过的论文一分钱不花，只有新论文要问 Jev。
9. **模型重排（Tier 2）没有自己的缓存**，只把结果存成池子里的 `aiOrder`。池子一重建，模型就要重跑一次。

### 2.4 今天的三个结构性缺口（本计划要补的）

1. **种子只能"顺手加"，不能"当主力"。** 读取时通道的候选不在池子里，模型重排和 Jev 从来没看过它们，也拿不到 `aiOrder` 的加分；它们只能靠 Tier 0/1 的分数竞争。一篇"引用了你种子"的好论文，天生比关键词搜来的低一等。
2. **引用图只有一个方向。** 只有"谁引用了种子"（Later Work）。没有"种子引用了谁"（参考文献，OpenAlex 的 `referenced_works` 字段）、没有"这些作者还写了什么"（`filter=author.id:`）、没有"OpenAlex 认为相关"（`related_works`）。`WORK_SELECT` 里也没请求 `referenced_works`。
3. **没有"种子相关"这一项分数，也没有对应的理由文案。** `scoreBreakdown` 只有 keyword / tfidf / topicality / recency / source；`relevanceReason` 只会说 "Matches your interest in X" 或 "Semantically close to your profile"，不会说"引用了你的种子《…》"。

另外三个必须一起处理的约束：

- **上传 PDF 30 天过期**，但种子应当长期有效 → 种子的"身份"（DOI / OpenAlex 号 / 标题 / 作者 / 摘要）必须和 PDF 文件分开存，文件过期不影响种子。
- **一天只能改一次 + 改了立刻重算** 和 **冻结批次"当天永不轮换"** 有冲突 → 需要一条新裁定：种子变化是当天唯一允许重新铸造批次的事件，且已推送过的论文仍然不重复推（§8 第 2 项）。
- **OpenAlex 从 2026 年 2 月起要求 API key**（见 §10 来源）。代码已经支持 `OPENALEX_API_KEY`（作 Bearer 头发送），但 Vercel 上要配好。免费 key 每天约 10 万"信用点"：查一篇是 1 点，列表查询是 10 点。本计划的每次建池约花 130 点。

---

## 3. 参考 ResearchRabbit：学什么，不学什么

本次调研时沙箱无法直接打开外网页面（代理拒绝），下面的事实来自搜索引擎摘要和 ResearchRabbit 自己的帮助文章标题，链接在 §10。实施前请在真实浏览器里核对一遍。

### 3.1 它怎么工作（厂商自己的说法）

- 核心是**集合（Collection）**：集合里每篇论文都是种子；推荐针对整个集合算。
- 先列出所有和种子"有连接"的论文（一篇引用另一篇；共享参考文献或共同被引；共同作者；标题摘要语义相近），候选可能有几十万篇；再按"连接度"排序，混合共享引用、共同作者、语义相似，最后还有一步没公开的调整。**不用大语言模型**做核心推荐。
- 五个面板：**Similar Work**（常被一起引用的论文）、**Earlier Work**（种子引用了谁）、**Later Work**（谁引用了种子）、**These Authors**（这些作者还写了什么）、**Suggested Authors**（通过合著关系找到的相关作者）。
- 加一篇或删一篇种子，推荐立刻更新；用户接受的推荐会变成新种子，网越点越大。
- 厂商建议**先放 1–3 篇**种子，其中一篇是奠基性的高引论文、一篇是近期论文；放太多会得到"一张又大又难走的网"。
- 提醒：每个集合可以开每周邮件提醒（旧 FAQ：周日晚上，只在"兔子觉得找到了你会喜欢的"时才发）。
- 数据来自 Semantic Scholar、OpenAlex、Crossref。支持 DOI、标题、BibTeX/RIS、Zotero 导入，以及 PDF 上传（≤25 MB，需要可选文本）。
- 公司变动：2025 年 5 月被 Litmaps 收购，2025 年 10 月改版，免费版限 50 个种子。

### 3.2 我们借什么

| ResearchRabbit 的做法 | Peer 怎么借 |
|---|---|
| Later Work（谁引用了种子） | 直接用，但只取**时间窗内的新论文**，按出版日期排，而不是按被引次数（否则永远是老的高引论文） |
| Earlier Work（种子引用了谁） | 参考文献本身大多是旧论文，不能进"每日预报"。借 Connected Papers 的办法：**看谁和种子站在同一批参考文献上**（文献耦合）——新论文哪怕一次都没被引用过，只要它引用了和你种子相同的 3 篇基础文献，就算亲缘。另外单独拉一次"种子引用的、但本身也是近期的论文"（时间窗内的 Earlier Work） |
| Similar Work | 用 OpenAlex 自己算好的 `related_works`，一次调用；标题匹配不到 OpenAlex 的种子用 OpenAlex 语义搜索兜底 |
| These Authors | 每篇种子取第一作者和末位作者（通讯作者通常在末位），拉他们时间窗内的新作 |
| "先放 1–3 篇" | 上限 5 篇，界面上提示"1–3 篇最好；放一篇奠基性的，再放一篇最新的" |
| 每周提醒 | Peer 本来就是每日预报，种子直接融入每日的 10 篇，不另做提醒 |

### 3.3 我们不借什么

- **Suggested Authors**（第二跳作者）、**网状图可视化**、**集合分享**：这是深潜（deep-dive）功能，不是每日预报。
- **"接受的推荐自动变成种子"**：Peer 的点赞/收藏已经走偏好账本（慢而温和），种子是用户亲手声明的，不自动膨胀。
- **让网越点越大**：我们反其道而行，用防洪闸把种子来源限制在每天 10 篇中的最多 6 篇。

---

## 4. 新结构：一张图和五个决定

### 4.1 一张图

```mermaid
flowchart TD
    W[Walkthrough 或主页小苗按钮：上传 1–5 篇 PDF] --> R[服务器：抽 DOI/标题 → OpenAlex 查身份<br/>→ 确认卡 → 存种子记录：身份、标题、摘要、作者、参考文献清单]
    R --> DB[(private_seed_sets：每人一行<br/>≤5 颗种子、版本号、今天改过没有)]
    DB -->|种子签名进缓存标签| K{今天 + 这组种子的池子<br/>建过吗？}
    K -->|没有：建池| S[5 个免费学术源并行搜索]
    DB --> G[同时并行：四条种子通道<br/>Later Work / 同一批基础文献 / 这些作者 / OpenAlex 相关]
    G --> M[每篇候选贴标签 + 记"种子证据"：<br/>引用了哪颗种子、共享几篇参考文献、是不是种子作者]
    S --> D[合并去重 → 丢掉过期 → 中性打分<br/>新增一项：种子亲缘分 ≤ +0.35]
    M --> D
    D --> T1[Tier 1 本地重排 + 多样性<br/>新增：每颗种子最多 3 张卡]
    T1 --> J[Jev 看前 50 篇<br/>已判过的论文直接用缓存]
    J --> T2[模型重排前 50 篇<br/>提示词里带种子标题和每篇的种子关系]
    T2 --> P[(当天池子：标签含种子签名)]
    K -->|建过| P
    P --> RD[读取时：偏好账本打分 → 回放 aiOrder → 期刊加分<br/>→ 种子来源最多占 10 篇中的 6 篇 → 去掉已推送]
    RD --> F[10 篇；卡片理由写明"引用了你的种子《…》"]
    W2[用户在小苗面板改种子<br/>一天一次] --> DB
    W2 --> SB[今天的冻结批次标记"已被取代"<br/>已推送过的论文留在永久账本]
    SB --> K
```

### 4.2 五个决定（每个都说"为什么"）

**决定一：种子存在服务器端、每人一行，永远不从 HTTP 请求体读。**
新表 `private_seed_sets`（`owner_id` 主键，`seeds` jsonb ≤5 条，`version`，`changed_on`，`signature`）。喂给管线的方式和现有的 `positiveSeeds`、`rolloverCandidates`、`ledgerExclusions` 一样：由 `app/api/feed/route.ts` 在服务器上查出来，作为 `FeedPipelineOptions.seedPapers` 传进去，`FeedRequest` 里**没有**这个字段。这样任何人都不能通过伪造请求体给自己或别人塞种子，也不能用请求体触发重建（正是 UPSTREAM-02 当年搁置 `forceRebuild` 的原因）。

为什么不放在 `profiles` 表的一列里：第一，`profiles` 现有的 RLS 策略是"本人可以更新自己的行"（`schema.sql` 的 `users update own profile`），放在那里的任何一列用户自己的浏览器就能直接改，"一天一次"和"服务器核实身份"都能被绕过；第二，`profiles` 的同步机制（`profile-sync.tsx` 的差分推送、`merge.ts` 的三方合并）是为浅字段设计的，种子是服务器算出来的身份数据，不该经过浏览器再写回；第三，单独一张表能用一条原子 SQL 实现"一天一次"（见决定五）。

写入接口只接受最少的东西：`PUT /api/seeds` 的请求体里每颗种子只有 `{ uploadId?, openalexWorkId?, confirmed? }`。服务器自己重新查一次这篇作品（1 信用点，`sourceFetch` 带一天的 `revalidate`），在服务器端重建种子记录；标题、作者、参考文献清单这些字段**永远不信客户端传来的值**；"confirm 档"的候选只有在它确实出现在上一次解析返回的候选列表里、且 `confirmed=true` 时才接受。

**决定二：种子通道在"建池时"跑，不在"读取时"跑；种子签名进缓存标签。**
今天的正例种子走读取时，是因为当年改不了缓存标签（代码注释里写得很清楚）。读取时的候选永远见不到模型和 Jev，"权重很高"就做不到。所以种子通道和 5 个学术源**同时并行**跑在 `buildPaperPool` 里，候选和关键词结果一起去重、打分、进前 50、被 Jev 和模型看到，并且拿到 `aiOrder` 回放加分。

缓存标签怎么改：给 `derivePoolCacheKey` 的输入加一个可选的 `seedSignature`（对排好序的种子身份 key 做 sha256 取前 16 位；没有种子时是 `undefined`）。`JSON.stringify` 会省略 `undefined`，所以**没有种子的用户的标签一个字节都不变**，`pool-cache.test.ts` 里钉死的旧标签全部不动，不需要升 `PAPER_CACHE_KEY_VERSION`。有种子的用户：一组种子 = 一个标签；因为一天只能改一次种子，一天最多两个池子。

今天的"点赞/收藏正例种子"四条读取时通道**原样保留**（默认关、读取时、走通道缓存），不改。两者关系：声明的种子是"主力、建池时、高权重"，点赞种子是"辅助、读取时、无加分"。

**决定三：种子亲缘分是加在现有公式后面的一项，不是重新分配四项权重。**
`combine.ts` 今天的公式：

```
base     = 0.30·关键词 + 0.55·主题相近度 + 0.10·新鲜度 + 0.05·来源
combined = clamp01( base × 偏好惩罚 × 词义惩罚 + 探索主题加分(≤0.18) + 偏好加分(≤0.18) )
```

新公式只加一项：

```
combined = clamp01( 上式 + 0.35 × seedAffinity )
```

`seedAffinity` 在 0–1 之间（§5.3 有算法），没有种子证据时恒为 0，所以没有种子的用户分数**逐字节不变**，所有现有排序测试照常通过。0.35 比探索主题（0.18）和偏好账本（0.18）都大——用户亲手声明的东西要压过系统学到的偏好；但又小到一篇完全对题的关键词论文（base≈0.85）仍然能赢过一篇只是引用了种子、内容偏题的论文（0.3 + 0.35×0.5 = 0.475）。

**决定四：四条通道各有闸门，老论文和"巨型种子"进不来。**
每次种子查询都带 `from_publication_date = 今天 − 时间窗天数`（30/60/180 天，和 `dropStale` 用同一张表），所以参考文献里的经典论文永远不会成为候选，只做"亲缘证据"。Later Work **每颗种子单独一次查询**，一颗被引两千次的种子吃不掉别的种子的名额。引用"热门种子"的论文得分打折（hub 衰减）。展示层：每颗种子最多 3 张卡，纯种子来源最多占 10 篇中的 6 篇（超了往后挪，不删）。

**决定五：一天一次由服务器用一条原子 SQL 保证；种子改变 = 当天批次被取代，已推送的论文照旧不重推。**
`PUT /api/seeds` 做一条有条件的 UPDATE：只有 `changed_on` 不是今天（或者是第一次从空集合种下）才允许写入并把 `changed_on` 设为今天；两个标签页同时点也只能成功一个；不需要"失败后退还额度"的逻辑。成功后，如果开了冻结批次，把今天的批次行标记 `superseded_at`（旧行保留，供历史回看），`getBatch` 只看未被取代的行；已推送的论文因为状态是 served/acknowledged，仍然在排除集合里，所以**新批次绝不会把早上已经给过的论文再给一遍**。客户端随后重新加载 feed：新标签 → 未命中 → 建池 → 铸造新批次。

---

## 5. 详细设计

### 5.1 种子的身份：从一个 PDF 到一个 OpenAlex 作品号

上传走**现有**的 `POST /api/papers/upload`（同意框、25 MB 上限、DOI 正则、标题启发式、摘要抽取都不变），只多一个表单字段 `purpose=seed`，让上传记录知道自己是种子的文件（`UploadMeta.purpose`），并且**不**把这次上传的词写进偏好账本（避免同一天因为 `uploadInterests` 变化再多重建一次池子）。

然后 `POST /api/seeds/resolve { uploadId }`（新路由，新模块 `web/src/lib/seeds/resolve-seed.ts`）按顺序试：

| 步 | 做法 | OpenAlex 调用 | 结果 |
|---|---|---|---|
| 1 | PDF 里有 DOI | `GET /works/doi:<doi>`（查一篇，1 信用点；把评测代码里的 `resolveOpenAlexSeed` 搬到 `lib/seeds/`，再从原位置 re-export） | 命中 → 身份 `doi` |
| 2 | 没有 DOI，或 OpenAlex 不认识这个 DOI | 新增 arXiv 号正则（`arXiv:2401.01234`），走 `filter=doi:10.48550/arxiv.<id>` | 命中 → 身份 `arxiv` |
| 3 | 都没有 | `GET /works?filter=title.search:<标题>&per_page=5`（10 信用点），每个候选用**现有**的 `matchUploadedPaper` 三档规则（≥0.6 且 ≥2 个共同词 = strong；≥0.35 = confirm；否则 reject） | strong → 自动绑定；confirm → 弹确认卡；reject → 下一个 |
| 4 | 全都对不上 | 不调用 | 存成 **"仅标题"种子**：有标题和摘要，没有作品号 |

确认卡照搬导师的样式（`advisor-field.tsx`）："这是你的论文吗？《标题》· 年份 · 期刊 · 被引 N 次 ［是的］［不是这篇］"。每一颗已绑定的种子行都有一个小小的"匹配错了？"链接，可以重新打开候选卡——自动绑定永远可以被用户纠正。

绑定成功时，同一次响应里就从返回的作品对象取走后面要用的东西（不再多调用一次）：`referenced_works`（参考文献清单，截到 400 个）、`related_works`（≤10 个）、第一和末位作者的 `author.id`（≤4 个）、`cited_by_count`、年份、期刊、摘要（由 `abstract_inverted_index` 还原）。这些存进种子记录，30 天后在下一次建池时刷新一次。

"仅标题"种子怎么还能有用：它驱动一次 OpenAlex 语义搜索（`search.semantic=<标题. 摘要>`，复用现有的 `fetchOpenAlexSemantic`，10 篇），结果贴 `seed-related` 标签。它**不**参与引用通道。面板上写清楚："没能在引用索引里找到这篇 PDF。Peer 会用它的标题和摘要找相似论文，但追不到它的引用。第一页带 DOI 的 PDF 最容易匹配。"

> 和导师流程的区别：导师是"一个人 → 他的 8 篇论文"，种子是"一篇论文 → 它的邻居"。两者都用 OpenAlex、都要用户确认一次、都把身份存起来按月刷新。

### 5.2 四条寻找通道（建池时，和 5 个学术源并行）

全部走 OpenAlex（免费、无 key 时今天已经 429，所以 Vercel 上要配 `OPENALEX_API_KEY`）。每条通道都遵守现有通道的失败合同：HTTP 失败就抛错，调用方接住变成 `[]` 加一条诚实的 `sourceStatus.seed_*`（ok / empty / failed），`meta.errors` 照常报告；不会让 Tier 0 挂掉。

| 通道 | 白话 | OpenAlex 调用（已通过搜索核对过滤器名字，实施前再做一次真机探测） | 上限 | 入场标签 | 跳过主题硬门槛？ |
|---|---|---|---|---|---|
| **seed_later**（Later Work） | 谁在时间窗内引用了这颗种子 | **每颗种子一次**：`filter=cites:W<种子>,from_publication_date:<窗口起点>`，`sort=publication_date:desc`，`per_page=25`；响应的 `meta.count` 记为这颗种子的"近期被引数"（给 hub 衰减用） | 每颗 25，合计 ≤125 | `seed-later` | 是 |
| **seed_foundation**（Similar Work，文献耦合） | 谁和这颗种子站在同一批基础文献上：引用了种子参考文献的新论文 | **每颗种子一次**：`filter=cites:R1\|R2\|…\|R40,from_publication_date:<窗口起点>`，R 取这颗种子参考文献里被引最多的 40 个（OR 列表上限 50 个值）；本地把响应里每篇的 `referenced_works` 和种子的参考文献求交集 = 共享篇数 | 每颗 25 | `seed-foundation` | 是 |
| **seed_earlier**（时间窗内的 Earlier Work） | 种子引用了的、本身也还算新的论文（例如 2025 年的种子引用了 2025 年的预印本） | 一次：`filter=cited_by:W1\|…\|W5,from_publication_date:<窗口起点>`（注意 OpenAlex 的 `cited_by:` 返回的是"该作品的参考文献"，名字容易看反） | 15 | `seed-foundation` | 是 |
| **seed_authors**（These Authors） | 种子的第一/末位作者在时间窗内的新作 | 一次：`filter=authorships.author.id:A1\|…\|A10,from_publication_date:<窗口起点>`，`sort=publication_date:desc`，`per_page=40` | 40，每位作者 ≤10 | `seed-author` | **否**（作者的无关论文对每日预报是噪音；它必须像关键词论文一样过 T1–T4 门槛） |
| **seed_related**（Similar Work，OpenAlex 自算） | OpenAlex 认为和种子相关的作品 | 一次：`filter=related_to:W1\|…\|W5,from_publication_date:<窗口起点>`，`per_page=30`；"仅标题"种子另加每颗一次 `search.semantic`（这些调用要**串行**或限速到每秒 1 次，OpenAlex 语义搜索有此限制） | 30 + 每颗 10 | `seed-related` | 是 |

> `related_works` 是 OpenAlex 算好的"概念相近"的作品，不保证新。加上时间窗以后这条通道可能经常是空的——B 组真机探测时要测一下；如果一周内基本为空，就删掉这条，只留给"仅标题"种子的语义搜索。

要点：

- 所有调用都加 `select=…,referenced_works`，**只在种子通道**加（不在 5 个学术源的关键词查询上加，避免每次建池多拉几百篇的参考文献清单）。`referenced_works` 用完算证据后、在 `cache.set` 之前**从候选上删掉**，池子不会变大。
- 所有种子通道的候选先过 `excludeSeeds`（种子自己不出现），再和学术源结果一起 `dedupItems`。去重的"幸存者"要把所有成员的 `seedEvidence` 合并（和今天合并 `admissionChannels` 一样，改 `dedup.ts` 一处）。
- OR 列表（`W1|W2|…`）的上限：OpenAlex 文档两处分别写 50 和 100 个值，本计划一律按 50 取保守值。
- 某条种子通道失败时**不会**被现有的"30 分钟一次、每天 3 次"自动重试接住——`retryFailedSources` 只重试 5 个学术源（和今天的导师通道一样）。失败的通道要等下一次建池（第二天，或当天改种子时）。要不要把重试范围扩到种子通道，是 B/E 组的一个可选项。
- 时间窗起点用 `freshness.ts` 的同一张表，这样抓回来的东西不会被 `dropStale` 再丢一遍。
- 现有 `fetchCitationNeighborhood` 加三个可选参数（`fromDate`、`sort`、`extraSelect`），不传时行为逐字节不变，导师通道和点赞种子通道不受影响。新增 `fetchSeedFoundations`、`fetchSeedEarlierInWindow`、`fetchSeedAuthorsRecent`、`fetchSeedRelated` 四个同形的函数放在 `lib/affiliation/openalex.ts` 旁边的新文件 `lib/seeds/graph.ts`。
- 开了 `PEER_RANK_FUSION` 时，四条通道各算一个 RRF 频道（`cap: 30`）。RRF 没有权重参数，也不需要加——权重由下面的亲缘分承担，RRF 只保证"每条路都有名额"。

### 5.3 打分：种子亲缘分（seedAffinity）

每篇候选在建池时记一条小小的"种子证据"（`RawItem.metadata.seedEvidence`），跟着它进缓存、进去重、进读取时重算：

```
{ seedSetVersion, citedSeedKeys[], foundationOf[{seedKey, shared}], earlierOf[], authorOf[], relatedTo[], primarySeedKey }
```

亲缘分这样算（`web/src/lib/scoring/seed-affinity.ts`，纯函数，给高中生的版本在表格下面）：

| 证据 | 单项得分 |
|---|---|
| 引用了一颗种子 | `0.5 × hub衰减(这颗种子)`；引用两颗按"至少一个成立"的方式叠加（引用 1 颗普通种子 → 0.5；引用 2 颗 → 0.75） |
| hub 衰减 | `1 / (1 + log10(max(1, 近期被引数 / 50)))`：50 篇近期引用 → 1.0；500 篇 → 0.5；5000 篇 → 0.33 |
| 和种子共享参考文献 | 共享 1 篇 → 0.35；2 篇 → 0.5；3 篇 → 0.65；≥4 篇 → 0.8 |
| 被种子引用（时间窗内） | 0.6 |
| 种子作者写的 | 1 位作者 → 0.6；≥2 位 → 0.8 |
| OpenAlex 相关 / 语义相似 | 0.5 / 0.35 |
| **合成** | `seedAffinity = 1 − ∏(1 − 单项)`（"噪声或"：证据越多越高，但不会超过 1） |

白话：每条证据像一张"亲戚证明"。一张证明不够铁（引用了一篇人人都引的经典，只算半张），好几张证明凑在一起就很硬（既引用了你的种子、又是种子作者写的 → 0.8 → +0.28 分）。

几个算例（base 是原公式的分数）：

| 情形 | base | seedAffinity | 最终 |
|---|---|---|---|
| 内容一般，但引用了 1 颗普通种子、且是种子作者写的 | 0.40 | 0.80 | 0.68 |
| 内容很对题，没有种子关系 | 0.85 | 0 | 0.85 |
| 内容偏题，只引用了一颗被引 2000 次的"热门"种子 | 0.30 | 0.22 | 0.38 |
| 对题 + 引用了 2 颗种子 | 0.85 | 0.75 | 1.00（封顶） |

和其他机制的关系：

- **主题硬门槛（T1–T4）**：`seed-later / seed-foundation / seed-related` 加入 `admittedByNonLiteralChannel` 的免检名单（和今天的 `citation / semantic` 一样，符合 §1c "非字面通道不设字面门槛"）；`seed-author` **不**免检。
- **偏好账本**：不动。`偏好惩罚` 仍然乘在 base 上，所以用户点过"不感兴趣"的概念照样把这篇压下去；亲缘分和账本加分各自独立相加。点"不感兴趣"不会动种子集合——种子只在小苗面板里改。
- **Tier 1 重排**（`rerank.ts`）：公式不改；`diversify` 加一条 `MAX_PER_SEED = 3`（按 `primarySeedKey`），和现有的"每位第一作者最多 2 篇、每个主题最多 3–4 篇"并列。
- **Tier 2 模型重排**：提示词多两样东西——`seeds: [{n, title, year}]`（≤5 行）和每篇候选一行 `seedLinks: "cites seed 2; shares 4 refs with seed 1"`；系统提示加一句"seedLinks 是候选和用户自己种子论文的引用关系，是强相关证据，但仍要偏向新论文"。约多 150 个输入 token。
- **Jev**：接口不变。前 50 篇里现在有种子候选；判断缓存按论文内容哈希，重建时只有新论文要问。Jev 的问题表（rubric）不改，否则会让全部缓存失效。
- **理由文案**（`reason.ts`）：按证据强弱选一句放在最前面，然后接今天的句子：
  - 引用 ≥2 颗 → "Cites 2 of your seed papers."
  - 引用 1 颗 → "Cites your seed “<前 6 个词…>”."
  - 共享参考文献 ≥3 → "Shares 4 references with your seed “…”."
  - 被种子引用 → "Cited by your seed “…”."
  - 种子作者 → "New from <姓>, an author of your seed “…”."
  - 相关 → "Listed as related to your seed “…”." / "Similar to your seed “…”."
  
  种子标题只出现在用户自己的响应和自己的池子行里，**不进日志**（沿用 `positive-seeds.test.ts` 的"never logs"测试）。`scoreBreakdown.seed` 字段只在有证据时出现，没有种子的用户的响应形状不变。注意：今天的卡片界面**不显示**分项分数（`scoreBreakdown` 没有映射到客户端的 `Paper` 类型上），所以这项分数在 v1 只在接口 JSON 里可查；面板上那句"今天 10 篇里有 N 篇来自你的种子"靠的是 `FeedMeta.seedChannels.inTopN`，不靠分项。

### 5.4 防洪：五道闸

1. **时间窗**：每次种子查询都带 `from_publication_date`，经典论文只做证据，不做候选。
2. **每颗种子单独查询**：Later Work 和文献耦合都是一颗种子一次调用，一颗巨型种子吃不掉别人的名额。
3. **hub 衰减**：引用热门种子的论文得分打折。
4. **展示层**：`MAX_PER_SEED = 3`；纯种子来源（标签里没有 `keyword`）最多占 `ceil(0.6 × topN)` = 10 篇里 6 篇、5 篇里 3 篇，超出的往后挪而不是删掉（如果别的候选不够，它们还是会补上——"10 篇精准的"比"空位"好）。
5. **池子上限**：`MAX_PAPER_POOL_ITEMS = 200` 照旧，≤ 约 250 篇种子候选和约 300 篇关键词候选凭分数竞争席位。

### 5.5 缓存与成本：种子一变，哪些重算、哪些复用

| 步骤 | 花什么 | 存在哪 | 种子改了以后 |
|---|---|---|---|
| 5 个学术源搜索 | 免费接口，各 8 秒超时 | 当天池子 | **重抓**（标签变了）。免费，且一天最多两次。可选优化：把"关键词原始结果"单独缓存在 `peer-sources-v1-…` 下，改种子时跳过这一步（第 9 步，可选） |
| 四条种子通道 | 免费接口，每次建池 ≈13 次列表查询 ≈130 信用点 | 当天池子（候选 + 证据 + 状态） | 没变的种子的"每颗一次"查询 URL 不变，被 `sourceFetch(revalidate: 21600)` 的 6 小时缓存接住；只有新种子和两条"按集合"的查询真的打到 OpenAlex |
| 种子身份解析 + 参考文献清单 | 每颗 1 次（1 点）+ 标题兜底 10 点 | 种子记录（30 天刷新） | 只解析换掉的那颗 |
| **Jev 判断** | 用户自己的 key，每篇一次 | `private_decisions`，按论文内容哈希 | **完全复用**，只问新论文 |
| **Tier 2 模型重排** | 用户自己的 key，约 50 篇 × 1200 字摘要 ≈ 15–20k 输入、≤2.2k 输出 | 只存在池子的 `aiOrder/aiReasons` 里 | v1：**再跑一次**（一天最多多一次，因为一天只能改一次种子；面板文案会说"会再跑一次你的 AI 排序"）。v1.1：**插入式重排**——把上一个池子的排序当"锚"，提示词里旧论文只给 id+标题、新论文才给摘要，让模型把新论文插进旧顺序，只给新进前 20 的论文写理由；没有新论文进前 50 就**不调用**。估算省 45–60% token |
| 深度报告 / 图 | 重、按篇、用户点才生成 | 报告缓存 | 不受影响 |
| 读取时重算 | 本地、免费 | — | 每次打开页面都做，和今天一样 |

OpenAlex 额度——两种说法冲突，必须当成"有预算的"来设计，而不是"免费的"：

| 说法 | 来源 | 一位有种子的用户一天 ≈13–26 次列表查询意味着 |
|---|---|---|
| 信用点制：免费 key 每天 10 万点，单篇 1 点、列表 10 点 | OpenAlex 文档 git 镜像（2026-05） | ≈130–260 点 → 大约撑 400–800 位有种子的用户/天 |
| 金额制：无 key 每天约 0.1 美元，免费 key 每天约 1 美元，列表/过滤约 0.1 美元/千次、搜索约 1 美元/千次 | 项目里 2026-09 记录的 help.openalex.org 读数（`docs/jev-abc/P2-B`）和 2026-07 的二手报道 | 如果语义搜索按 1 美元/千次算，5 次 `search.semantic` 就是 0.5 美分；免费额度只够约 100–200 位用户/天 |

因此：（1）生产环境必须配 `OPENALEX_API_KEY`（代码已支持）；（2）每次建池把种子通道的调用次数记进 `meta.seedChannels.fetched`；（3）加一个全局的每日种子调用上限（用现有的 `CounterStore` 计数，和 `claimSourceRetry` 同一套），超了就当天只用关键词池并在 `meta.errors` 里诚实说明；（4）B 组开工前用一次无 key、一次带 key 的真机调用核实现行计费。

Semantic Scholar：不新增调用。`PEER_CHANNEL_S2_RECOMMENDATIONS` 开着时，声明的种子的 S2 号会并入正例 id 列表；但这个开关默认关，开不开要作者决定（§8）。

### 5.6 一天一次、冻结批次、提前准备任务

**一天一次**（`PUT /api/seeds`，新 SQL 函数 `commit_seed_set`）：

```sql
update private_seed_sets
   set seeds = $seeds, signature = $sig, version = version + 1,
       changed_on = case when signature = '' then changed_on else $today end
 where owner_id = $owner
   and (signature = '' or changed_on is distinct from $today);
-- 0 行 → 今天已经改过 → 429 seed_change_used_today, nextChangeOn = 明天
-- 没有行 → 第一次种下 → insert，不计数
```

- "今天"是哪一天：现有的 `localCalendarDate()` 返回的是**服务器**的日期（Vercel 上就是 UTC），没有时区参数；池子标签和冻结批次都用它。v1 的一天一次也用同一个日期，三者永远一致——代价是北京的用户在早上 8 点"换日"。想按用户自己的时区算，要把 `lib/dashboard/timezone.ts` 的 `dateInTimezone` 接进来，并且池子标签和批次也一起改，不要只改一处（§8 第 7 项）。
- **只有第一次种下**（表里还没有这一行，`version = 0`）不算改动。之后任何从非空集合出发的保存都算，包括"全部删掉"——这样"种下 → 全删 → 再种"不能一天白拿三次。面板里"暂存多次增删、一次保存"算一次。
- 同一天内给**今天刚加的**种子纠正匹配（"匹配错了？"）不算改动——否则 walkthrough 里一篇匹配错了要等到明天才能修。实现上：`PUT` 带 `rebindOnly=true` 且只改了 `addedAt` 是今天的种子的身份字段时，不改 `changed_on`，但签名照常变（池子照常重建）。
- 规则拒绝时的文案："今天已经换过种子了，明天再来。"

**冻结批次**（`PEER_DASHBOARD_LEDGER=on` 时）：

- 迁移：`dashboard_batches` 加 `superseded_at timestamptz` 和 `seed_set_id text`；把 `unique(owner_id, local_date)` 换成部分唯一索引 `(owner_id, local_date) where superseded_at is null`。
- 新方法 `DashboardDeliveryLedger.supersedeBatch(ownerId, localDate)`；`getBatch` 只看 `superseded_at is null`；`readExclusions` 不改（它按 served/acknowledged 状态算"已推送"，被取代的批次照样算）。被取代的行要同时标成 acknowledged（或让 `listServedUnacknowledged` 跳过它），否则"已送达未确认"的清单会越积越多。
- **触发条件是"批次记录的 `seed_set_id` 和当前种子签名不一样"**，而不是"今天改过"。这样第一次种下（不计数）也会立刻生效；否则一个今天早上已经拿到批次的老用户第一次种种子，会被回放旧批次到明天，和"立刻生效"的承诺矛盾。
- 顺序：先取代批次，再写种子（账本写不了就 503 `seeds_not_saved`，什么都不改），再让客户端重新加载 feed；`runLedgerAwareFeed` 发现没有活批次 → 读排除集合（fail-closed）→ 跑管线（新标签 → 建池）→ `prepareBatch` 铸造新批次，并记下 `seed_set_id`。被取代批次的"未展示剩余"不再写入 rollover（它们会在新池子里重新竞争）；rollover 行同时存一份 `seedSignature`，签名不一致时剥掉它身上的种子标签和证据，让它重新凭本事竞争。
- 替代方案（三位评审里两位更倾向）：**原地修订**——不动 `unique(owner_id, local_date)` 约束，给批次加 `revision` 列，一个 SQL 函数先把旧批次的论文复制进 `dashboard_deliveries`（永久排除），再替换论文、`revision + 1`；客户端的确认（ack）带 `revision`。好处是不改线上表的唯一约束、送达记录更完整；代价是 ack 流程和本地持久化状态要跟着改。两条路都保住"已给过的不重推"，实施前由 F 组二选一。
- 如果迁移暂时不能上线：v0 退路是 `PUT` 在当天已有活批次时返回 409 "明天生效"，功能照样可用，只是不"立刻"。
- 这和 §1p.C(5) 的"当天永不轮换"有冲突，需要作者新裁定（§8 第 2 项）。理由：轮换的触发者是用户自己的明确动作，一天一次，而且已推送的论文一篇都不重推——§1g 的"永不重推"原则完整保留。

**提前准备任务**（`PEER_DASHBOARD_PREPARE`）：`createPrepareAheadBuildPool` 读同一张 `private_seed_sets` 表并传 `seedPapers`，仍然 aiTier 0。这顺带关掉了 P6 记录的"提前准备的批次看不到种子"的差异（对点赞种子仍然成立）。定时邮件（`dispatch-digests`）同理。

### 5.7 界面

**Walkthrough（`app/welcome/`）**：放在 `work`（"你的工作"，收集项目描述、挑战、学校、导师的那一页）里，作为导师字段下面的一个带边框小节，小标题"Seed papers"，提示"Optional, up to 5. Upload the PDFs of the papers that matter most to you — Peer follows who cites them, who they cite, and what their authors publish next. 1–3 is best: one foundational, one recent."（三位评审一致建议不新开一页：onboarding 要快，而且未登录的访客用不了这一步。）

- 五个槽位：已填的显示"标题 · 年份 · 期刊"+ 状态条（"已在 OpenAlex 找到" / "仅标题——贴一个 DOI 可以连上" / 确认卡）+ ×；下一个空槽是虚线的"放一个 PDF，或点击选择"。复用 `UploadButton` 的机器（同意框、`attachPdf`、PDF/25 MB 检查），抽成一个 `useUploadPdf()` hook；同意框多一句"Peer 会把这篇论文的公开编号发给 OpenAlex 以寻找相关论文"（用现有的 `upload-legal-wording.test.ts` 钉死文案）。
- 不登录：槽位禁用，一行平静的说明"种子论文需要账号来保存。先登录，或者继续——以后可以在主页的小苗按钮里添加。"
- 不是门槛（`Topics is the only gate` 规则不变；作者如果想改成必填见 §8 第 1 项）。`completeness.ts` 的 `work` 步 "done" 判定加上 `种子数 > 0`；`summarizeStep('work')` 末尾加 "· 3 seeds"。
- 备选：单独一页 `seeds`，标题"哪几篇论文对你最重要？"。更醒目，但多一页，并且对未登录访客是空页。

**主页小苗按钮（`components/briefing/seed-button.tsx`）**：放在黑色上传方块的**左边**（上传和搜索框继续相邻）。尺寸和上传方块一模一样：`h-9 w-9 rounded-md`，固定黑底（`--color-fixed-black`），`hover:scale-125 active:scale-90`，15 px 手绘线条图标（本仓库不用图标库）。图标是一株小苗（茎 + 两片叶，描边 2，圆头）；新增一个固定绿色 token `--color-fixed-sprout`（约 `#4caf50`，在黑底上两种主题都看得清；现有 `--color-positive` 太深）。0 颗种子时用虚线画、白色；≥1 颗时绿色实线。不放数字角标（保持平静）。`aria-label`："Seed papers (3 of 5)"。显示条件：上传可用 **且** 已登录 **且** `GET /api/seeds` 返回 `enabled: true`。

**种子面板（`components/briefing/seed-sheet.tsx`）**：原生 `<dialog>`，和上传同意框同一套样式。

- 标题"Seed papers"，副标题"Peer 每天的预报从这几篇出发。"
- 五行：标题 · 年份 · 期刊 · "被引 1,204" · 状态条 · "匹配错了？" · Remove；空位是"+ 放一个 PDF"。
- 一行安静的统计："今天 10 篇里有 4 篇来自你的种子。"（来自 `meta.seedChannels.inTopN`）
- 一行披露："为了找邻居，Peer 会把你种子的 OpenAlex 编号发给 OpenAlex"（S2 开着时追加"和 Semantic Scholar"）。
- 底部左边是一天一次的状态（见下），右边 ［取消］［Replant & refresh forecast］，有暂存改动且今天没改过时才可点。保存成功 → 关闭 → feed 原地重载，日期条写一句"Replanted — today's forecast grew from your new seeds."
- PDF 过期后，行里标题不再是链接，加一句"PDF 已过期 · 身份保留"。

**一天一次的文案**：

| 状态 | 文案 |
|---|---|
| 今天还能改 | "You can replant once a day. Changes take effect right away."（有模型 key 时追加 " It re-runs your AI ranking once."） |
| 今天改过了 | "You replanted today. You can change seeds again tomorrow."（增删按钮禁用） |
| 第一次种下 | "Plant up to 5 papers. You can change them once a day afterwards." |
| 服务器 429 | "Already replanted today — try again tomorrow." |

**空态和错误**：无种子："No seeds yet. Add up to 5 PDFs of the papers that matter most to you — Peer will follow who cites them."；OpenAlex 不可达："Couldn't reach OpenAlex to look this paper up. Try again in a minute — nothing was saved."；第 6 篇：空位隐藏，接口返回 400 `seed_limit`；重复："That paper is already a seed."；建池时某条种子通道失败：feed 照常渲染，面板统计行写"Peer couldn't reach OpenAlex for your seeds this morning. Tomorrow's forecast will try again."（失败的种子通道不在现有自动重试的范围里，见 §5.2 要点）。

### 5.8 没有模型 key 的用户得到什么（Tier 0 故事）

全部功能。身份解析、四条通道、文献耦合、亲缘分、理由句子、小苗面板，都是不花 token 的 OpenAlex 调用加本地算术，跑在今天 Tier 0 已经在跑的 `combine.ts` / `rerank.ts` 里。一天的样子：walkthrough 里上传 3 篇 PDF，两篇靠 DOI 连上，一篇靠标题确认；第二天 10 张卡里大约 4 张引用了种子（卡片写"Cites your seed “Solid-state electrolyte…”"）、1 张是种子末位作者的新作、5 张是关键词和主题相近度挑出来的；没有一颗种子超过 3 张。接口 JSON 的 `scoreBreakdown.seed` 里能查到这一项。有模型 key 只改变顺序和理由的文笔；有 Jev 只多一道筛。OpenAlex 挂了，种子通道报 failed，关键词源照样撑起这一天。

---

## 6. 数据模型与改动清单

### 6.1 新东西

| 什么 | 在哪 | 形状 |
|---|---|---|
| 表 `private_seed_sets` | `web/supabase/migrations/20261015000000_private_seed_sets.sql` | `owner_id uuid pk → auth.users on delete cascade; seeds jsonb not null default '[]' (check array, ≤5); version int; changed_on text (YYYY-MM-DD); signature text; updated_at`。RLS：本人只读；写入只经服务角色的 `/api/seeds` |
| 函数 `commit_seed_set` | 同一迁移文件 | §5.6 的条件 UPDATE，返回 `ok` / `used_today` |
| `dashboard_batches.superseded_at`, `seed_set_id` + 部分唯一索引 | `web/supabase/migrations/20261015000100_dashboard_batches_superseded.sql` | 见 §5.6 |
| 类型 `SeedPaper` | `web/src/lib/seeds/types.ts` | `{ seedKey, aliases[], uploadId?, title, year?, venue?, doi?, arxivId?, openalexWorkId?, s2PaperId?, status: 'linked'\|'title-only', match: 'doi'\|'arxiv'\|'title-strong'\|'title-confirmed'\|'none', summaryIntro?, graph?: { authorIds[], referencedWorks[] (≤400), relatedWorks[] (≤10), citedByCount, recentCiterCount?, refreshedAt }, addedAt }` |
| 类型 `SeedEvidence` | `web/src/lib/sources/types.ts`（`RawItem.metadata.seedEvidence?`） | §5.3 |
| `FeedAdmissionChannel` 新成员 | `web/src/lib/scoring/types.ts` | `'seed-later' \| 'seed-foundation' \| 'seed-author' \| 'seed-related'` |
| `FeedChannelId` 新成员 | `web/src/lib/feed/pipeline.ts` | `'seed_later' \| 'seed_foundation' \| 'seed_earlier' \| 'seed_authors' \| 'seed_related'` |
| `ScoreBreakdown.seed?` | `web/src/lib/scoring/types.ts` | 0–1，只在有证据时出现 |
| `PoolCacheKeyInput.seedSignature?` | `web/src/lib/opportunities/pool-cache.ts` | 16 位 hex；`undefined` 时省略，旧标签不变 |
| `FeedPipelineOptions.seedPapers?` | `pipeline.ts` | 服务器端生成，永不来自请求体 |
| `FeedMeta.seedChannels?` | `web/src/lib/feed/types.ts` | `{ seedSetId, fetched: {...}, inTopN }` |
| 路由 | `web/src/app/api/seeds/route.ts`（GET/PUT）、`seeds/resolve/route.ts`（POST） | §5.1、§5.6 |
| 模块 | `web/src/lib/seeds/{types,seed-store,signature,resolve-seed,graph,evidence,flags}.ts`、`web/src/lib/scoring/seed-affinity.ts` | 新文件 |
| 组件 | `components/briefing/seed-button.tsx`、`seed-sheet.tsx`、`components/seeds/seed-papers-field.tsx`、`store/seeds.ts` | 新文件 |
| 开关 | `PEER_SEED_PAPERS=on`（字面 `on`，默认关） | `lib/seeds/flags.ts`（放在 pipeline.ts 之外，因为 `route.test.ts` 整体 mock 了 pipeline 模块） |

### 6.2 改动的已有文件（都是加法，关掉开关时逐字节不变）

`lib/feed/pipeline.ts`（建池并行种子通道、标签、证据、`sourceStatus.seed_*`、RRF 频道、`MAX_PER_SEED` 和份额闸、Tier 2 提示词、rollover 证据剥离）；`lib/opportunities/pool-cache.ts`（`seedSignature`）；`lib/scoring/combine.ts`（免检名单 + 亲缘分一项）；`lib/scoring/reason.ts`（种子句）；`lib/feed/rerank.ts`（`MAX_PER_SEED`）；`lib/feed/dedup.ts`（合并 `seedEvidence`）；`lib/feed/tier2-rerank.ts`（提示词；v1.1 插入式）；`lib/affiliation/openalex.ts`（`fetchCitationNeighborhood` 三个可选参数）；`lib/utils/openalex.ts`（`OpenAlexWork` 加 `referenced_works`、`related_works`、`authorships[].author.id`）；`app/api/feed/route.ts`（`resolveSeedPapersForRequest`、取代批次路径）；`app/api/papers/upload/route.ts`（`purpose=seed`、arXiv 正则）；`lib/papers/upload-store.ts`（`UploadMeta.purpose`、`arxivId`）；`lib/dashboard/delivery-ledger.ts`（`supersedeBatch`）；`lib/dashboard/prepare-pool.ts`（读种子）；`app/welcome/completeness.ts` + `page.tsx`（`work` 步里的种子小节）；`app/page.tsx`（按钮位置）；`app/globals.css`（`--color-fixed-sprout`）；`lib/briefing/copy.ts`（文案）；`web/.env.example`；`docs/PRIVATE_PDF_UPLOADS.md`（一句交叉引用：种子身份不随 PDF 过期）。

Python CLI（`python/`）不在范围内：它是独立的 Tier 0 MVP，没有上传和账号。

---

## 7. 实施顺序（按 AGENTS.md 的并行要求分组）

每组一个实现者在自己的 worktree 里做，组之间只在文件重叠处排序。每组列出验收命令。

| 组 | 内容 | 主要文件 | 依赖 | 验收 |
|---|---|---|---|---|
| **A 数据层** | 迁移 `private_seed_sets` + `commit_seed_set`；`SeedSetStore`（Supabase + Memory）；`seedSignature`；`PEER_SEED_PAPERS` 开关；`SeedPaper`/`SeedEvidence` 类型 | 全新文件 | 无 | `cd web && npx vitest run src/lib/seeds` |
| **B OpenAlex 适配** | `OpenAlexWork` 加字段；`fetchCitationNeighborhood` 可选参数（无参时 URL 逐字节不变，钉测试）；`lib/seeds/graph.ts` 四个函数；上传路由加 arXiv 正则和 `purpose` | `lib/utils/openalex.ts`、`lib/affiliation/openalex.ts`、`lib/seeds/graph.ts`、`app/api/papers/upload/route.ts` | 无 | `npx vitest run src/lib/affiliation src/lib/seeds src/app/api/papers/upload`；**先做一次真机探测**（需 `OPENALEX_API_KEY`）：`cites:`、`cited_by:`、`related_to:`、`authorships.author.id:`、`/works/doi:`、`select=referenced_works`、OR 列表 50 个值 |
| **C 解析 + 路由** | `resolve-seed.ts`（搬 `resolveOpenAlexSeed`，加 arXiv/标题兜底、三档匹配、确认）；`GET/PUT /api/seeds`、`POST /api/seeds/resolve`；一天一次；never-logs 测试 | `lib/seeds/resolve-seed.ts`、`app/api/seeds/**` | A、B 的接口（先用 Memory 实现） | `npx vitest run src/app/api/seeds src/lib/seeds` |
| **D 打分** | `seed-affinity.ts`；`combine.ts` 免检名单 + 一项；`reason.ts` 种子句；`rerank.ts` `MAX_PER_SEED`；`dedup.ts` 合并证据；`evidence.ts` 纯函数 | `lib/scoring/**`、`lib/feed/rerank.ts`、`lib/feed/dedup.ts` | A 的类型 | `npx vitest run src/lib/scoring src/lib/feed/rerank.test.ts src/lib/feed/dedup.test.ts`；**变异测试**：把 0.35 改成 0 必须有测试变红；没有证据时 `ranking.test.ts`、`required-gate.test.ts`、`admission.test.ts` 输出逐字节不变 |
| **E 管线 + 缓存标签** | `FeedPipelineOptions.seedPapers`；`derivePoolCacheKey.seedSignature`；建池并行通道、标签、证据剥离、`sourceStatus`；份额闸；RRF 频道；Tier 2 提示词；rollover 剥离；`FeedMeta.seedChannels` | `pipeline.ts`、`pool-cache.ts`、`tier2-rerank.ts`、`route.ts`（rollover） | B、D | `npx vitest run src/lib/feed src/lib/opportunities`；新 `pipeline.seeds.test.ts`（有种子：通道并行、标签、`referencedWorks` 被剥离、状态；无种子：零额外调用、输出逐字节不变）；`pool-cache.test.ts` 旧 key 不动 + 新 key 钉死 |
| **F 路由接线 + 冻结批次** | `resolveSeedPapersForRequest`（服务器端）；两处 `runFeedPipeline` 传入；`supersedeBatch` + 迁移；`prepare-pool.ts` 读种子 | `app/api/feed/route.ts`、`lib/dashboard/**`、迁移 | A、E | `npx vitest run src/app/api/feed src/lib/dashboard`；账本测试：取代后 `getBatch` 为空、`prepareBatch` 可再铸、`readExclusions` 仍含旧批次论文；请求体里的 `seedPapers` 被忽略 |
| **G 界面** | `useUploadPdf()` hook；小苗按钮 + 图标 + token；面板；walkthrough `work` 步里的种子小节；同意框多一句披露；`store/seeds.ts`；文案 | `components/**`、`app/page.tsx`、`app/welcome/**`、`globals.css`、`copy.ts` | C 的接口形状 | `npx vitest run src/components/briefing src/app/welcome`；本仓库没有组件渲染测试，决策逻辑（暂存、一天一次判断、重复检测、图标颜色）作为纯函数测试 |
| **H 文档 + 开关** | `.env.example`；`docs/SEED_PAPERS.md`（存什么、发什么给谁、一天一次）；`PRIVATE_PDF_UPLOADS.md` 一句 | 文档 | — | 人读 |
| **I（v1.1，可选）** | Tier 2 插入式重排（`prior` 锚）；关键词原始结果缓存 `peer-sources-v1-…` | `tier2-rerank.ts`、`pipeline.ts`、新 `source-candidate-cache.ts` | E | `tier2-rerank.test.ts`：无新论文则零调用；提示词含锚和新论文 |

整体验收：`cd web && npm test && npx tsc --noEmit && npm run lint`；开关关着时全套测试和今天一样绿；开关开着、预览环境只给作者账号，观察 `meta.errors.seed_*`、建池延迟、种子来源占比，再决定默认开。

---

## 8. 需要作者拍板的决定

1. **种子步是否必填？** 作者原话是"要求用户上传"，但现有规则"Topics is the only gate"（README）让其他步骤都可跳过。本计划按**可跳过但醒目**设计；要改成必填需要同时解决"未登录用户无法保存种子"。
2. **种子改变可以取代当天的冻结批次吗？** §1p.C(5) 说当天批次"even after … an intent change that day"都不轮换。本计划主张：种子改变是用户亲手的一天一次动作，取代批次但**绝不重推已给过的论文**（§1g 不动）。如果不同意，退路是"明天生效"（§5.6 的 409 方案）。
3. **声明的种子要不要发给 Semantic Scholar？** 面板里有披露句，但 S2 许可证是非商业研究用途（§1e）。本计划 v1 **只用 OpenAlex**，`PEER_CHANNEL_S2_RECOMMENDATIONS` 保持关。
4. **常数**：0.35 的权重、hub 衰减的 50 篇拐点、`MAX_PER_SEED = 3`、6/10 的份额，都是起点，要像当年的 REQUIRED-GATE 一样拿保存下来的池子调。
5. **OpenAlex key 和预算**：Vercel 上配 `OPENALEX_API_KEY`；核实当前是"10 万信用点/天"还是"约 1 美元/天"；决定超额后降级还是付费。
6. **种子摘要要不要进 TF-IDF 的 `seedTexts`？** 导师 seed 文本今天就在里面。但读代码发现：`seedTexts` 一变会让短标签的"词义上下文门"从"放行"变成"真的在判"（`keyword.ts` 里只有上下文文本为空时才放行），还会改变 T4 的相似度门槛和综述过滤。本计划 v1 **不进**，"仅标题"种子只走语义搜索；这是保守选择（三位评审里两位同意、一位主张进），可以在 v1.1 用保存的池子评估后再开。
7. **"一天"按谁的时区算？** v1 按服务器日期（和池子标签、冻结批次一致；北京用户早上 8 点换日）。要改成用户时区，三处要一起改。

---

## 9. 不做什么

- 二跳扩展（引用了"引用种子的论文"的论文）、Suggested Authors、引用网络可视化、集合分享——深潜功能。
- 把种子的参考文献本身（旧论文）放进每日 10 篇——违反新鲜度规则；它们只做证据。以后可以在面板里加一个"种子的基础文献"阅读清单视图。
- 把 feed 卡片或收藏的论文一键设为种子——作者要求的是 PDF；数据模型留了 `uploadId?` 的口子。
- 超过 5 颗、每颗权重滑杆、负种子。
- 把种子 PDF 的正文发给 Tier 2 模型——提示词里只有标题和年份。
- 改 RRF 加权重参数；改 Jev 的问题表。
- 复用 `forceRebuild` 或读取时通道缓存来做声明种子——它们继续服务"refresh now"和点赞种子。
- Python CLI。

---

## 10. 术语表、来源与本次调研方法

### 术语表

| 词 | 白话 |
|---|---|
| DOI | 论文的身份证号，形如 `10.1038/xxx` |
| OpenAlex | 免费开放的论文索引，知道每篇论文引用了谁、被谁引用、作者是谁 |
| `W…` / `A…` | OpenAlex 给论文 / 作者的编号 |
| Later Work / Earlier Work | 谁引用了它 / 它引用了谁 |
| 文献耦合（bibliographic coupling） | 两篇论文引用了同一批参考文献，说明它们在同一个话题上 |
| hub | 被成千上万篇论文引用的"枢纽"论文；引用它不说明什么 |
| Tier 0 / 1 / 2 | 不用模型 / 本地规则重排 / 用户自己的云端模型 |
| 冻结批次 | 今天给你的 10 篇，当天不变 |
| 信用点（credit） | OpenAlex 的计费单位：查一篇 1 点，列一张表 10 点 |

### 外部来源（搜索引擎摘要；沙箱无法直接打开页面，实施前请核对）

- ResearchRabbit 官方帮助："How ResearchRabbit uses AI"（learn.researchrabbit.ai/en/articles/13545485）、"What's behind ResearchRabbit's search algorithm"（…/12875619）、"Welcome to the new ResearchRabbit"（…/12440130）、FAQ（researchrabbit.notion.site）；第三方：HKUST 图书馆指南（libguides.hkust.edu.hk/citation-chaining/researchrabbit）、Cole & Boutet 2023（JCHLA 44(2)）、Aaron Tay 2025 改版评论（aarontay.substack.com）；收购报道：IT Brief 2025-05（itbrief.co.nz/story/litmaps-acquires-researchrabbit-raises-1-million-for-ai）。
- 可借鉴的同类工具：Connected Papers（文献耦合让零引用的新论文也能匹配）、Litmaps Monitor（重跑保存的检索、只发增量）、Inciteful（多颗种子合成一个"虚拟论文"再算相似）、Semantic Scholar Research Feeds（正例/负例评分）。
- OpenAlex：过滤器 `cites` / `cited_by`（= 该作品的参考文献）/ `related_to` / `authorships.author.id`（github.com/ourresearch/openalex-docs/blob/main/api-entities/works/filter-works.md；docs.ropensci.org/openalexR/articles/Filters.html）；OR 列表 ≤50 值；额度：信用点制（github.com/ourresearch/openalex-docs/blob/main/how-to-use-the-api/rate-limits-and-authentication.md）；2026-02-13 起要求 API key（groups.google.com/g/openalex-users/c/rI1GIAySpVQ；casrai.org/news/openalex-api-keys-mandatory-usage-based-pricing-2026）。

### 本次调研方法（诚实记录）

- 先由我亲自读完 `pipeline.ts`、`positive-seeds.ts`、`combine.ts`、`rerank.ts`、`tier2-rerank.ts`、`affiliation/openalex.ts`、`pool-cache.ts`、`channel-candidate-cache.ts`、`route.ts`、`rrf.ts` 等核心文件并写成事实清单；再派 7 个只读子代理分别梳理通道、缓存、上传、界面、打分、历史裁定、ResearchRabbit；再派 3 个设计子代理从"检索精度优先 / 成本缓存优先 / 最小改动优先"三个角度各出一版完整设计；最后 3 个评审子代理按 10 条标准打分。
- 评审子代理第一次运行时撞上账号用量上限全部失败；用量恢复后已重跑完成。三位评审（分别扮演"熟悉代码库的怀疑派工程师"、"产品负责人"、"成本与正确性审计员"）独立打分，排序一致：精度优先版最高（43/42/44 分，满分 50），成本优先版次之（42/41/42），最小改动版最低（35/38/33）。三版设计在骨架上高度一致（服务器端种子、建池时通道、签名进标签、可解释的加分、服务器端一天一次、取代冻结批次）；本文以精度优先版的检索与打分为核心，嫁接成本优先版的基础设施（原子的一天一次 SQL、服务器端重建种子记录、复用评测代码里的 DOI 解析器、Tier 2 插入式重排、按颗种子的确定性 URL），再取最小改动版的几个细节（rollover 行带签名、409 退路、开关、`dispatch-digests` 同步、小苗颜色即状态）。
- 评审指出并已在本文修正的问题：`localCalendarDate` 是服务器日期而非用户时区（§5.6）；今天的界面没有"分数检查器"（§5.3、§5.8）；失败的种子通道不会被现有自动重试接住（§5.2、§5.7）；第一次种下也必须立刻生效，所以取代批次的条件是签名不一致而非"今天改过"（§5.6）；"种下 → 全删 → 再种"的漏洞（§5.6）；写接口不能信任客户端传来的身份字段（§4.2 决定一）；OpenAlex 两种计费说法冲突，要当成有预算的（§5.5）；`related_to` 加时间窗后可能常空（§5.2）；语义搜索要限速（§5.2）；OR 列表上限文档自相矛盾，取 50（§5.2）；种子字段放在 `work` 步里而不是新开一页（§5.7）。评审里未采纳的建议：把种子摘要并入 `seedTexts`（见 §8 第 6 项）。
- 沙箱出口代理拒绝所有外网页面，ResearchRabbit 和 OpenAlex 的事实来自搜索引擎摘要和一份 2026-05 的 OpenAlex 文档 git 镜像，**没有做过真机 API 调用**。实施 B 组时必须先探测。
