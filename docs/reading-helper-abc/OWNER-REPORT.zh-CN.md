# 阅读助手（带着问题读）— 交接报告

写给：项目所有者。读完大约 10 分钟。所有术语第一次出现时都有解释。

分支：`deep-report-reading-helper-enhancement`，草稿 PR：https://github.com/Aspen-Lab/peer/pull/32
最终代码头：bffa3659（合入了 main 的 PR #34；最后一个 checkpoint d7acb808）

---

## 1. 一句话总结

Peer 现在可以让读者"带着问题读论文"：上传一篇 PDF（或打开一篇有全文的公开论文），先写下最多五个问题，页面就会告诉你哪些段落和你的问题有关、哪些没提到；如果你填了自己的 AI key，它还会把答案连同原文句子、页码一起列出来，并且能解释术语、把难懂的段落改写得更简单。整套功能都做完了，经过三轮独立复核，所有测试通过。

---

## 2. 我完成了什么

### 不用任何 AI key 就能用的部分（"Tier 0"，不会把论文发给任何模型）

- **阅读地图**：论文下面多了一张"地图"——每一节的标题、页码、字数、大约要读几分钟、这一节是干什么的（背景 / 方法 / 证据 / 讨论），以及每一段的第一句话（原文照抄）。手机上折叠成一行，点开才展开。
- **问题框**：每篇论文最多写五个问题，会记住；绝不会替你自动填。候选问题只来自你自己以前问过的、你个人资料里的项目/难题，以及你在"Profile"里设置的"常备问题"（standing questions，新加的字段）。还有一个"Just get the gist"按钮，不想提问时按它。
- **路线高亮**：每个问题都会在浏览器里算出哪些章节、段落提到了问题里的词，然后在目录栏、正文标题和地图上用三种深浅的绿色标出来，并写明"提到 X ×2"或"not mentioned"。**什么都不会被隐藏、折叠、变灰或重排**，也绝不会出现"skip / 别读"这类字眼。
- **Terms to know**：论文自己定义过的术语，原句照抄，带章节和页码；点一下会跳到第一次出现的位置。
- **Explain this?**：选中一段里的一句话，如果论文自己定义过这个词，就显示论文的定义。
- **PDF 解析不再依赖 Python**：章节、页码、小节编号、图注都由 pdf.js 读出；扫描版 PDF 会提示"没有可读文字"，不会去调模型。

### 填了你自己的 AI key 并打开"Deep report"后才有的部分

- **问题的答案**："For your questions"区块：每个问题一个结论、最多三条答案，每条都引用论文原句（最多 400 字，引到句子边界，截断处用"…"），带章节和页码；没提到就写"This paper does not address: …"；还有"Read next"推荐下一节。
- **模型补充的术语**，一行解释，标注"Peer's reading — not a quote"，总数最多八条。
- **Explain this? 对话**：两段式短回答（"What it means" / "Why it is here"），可以在同一个框里追问（最多 8 轮），默认 3 句以内，按"Say more"才变长。
- **每段一句摘要**（12 个词以内），在地图里标注是 Peer 写的。
- **Say it plainly**：把一段改写成三种难度之一，放在原文旁边；只要改写后的任何一个数字或单位和原文对不上，就整段丢弃（HTTP 422），原文不动；超过 1,200 字的段落不提供；按 `u` 还原。
- **导出**（按 `c`）和笔记模板会带上问题、结论和引用。
- **问题会轻微影响推荐**：问题里的关键词会以"一个赞的五分之一"的权重进入你的偏好账本（一个问题算一个信号，不管它有几个词）；每个问题旁边有"Not for recommendations"勾选框，勾上就立刻把它的词拿掉。看起来像密钥、邮箱、网址、路径或 10 位以上数字（电话、卡号）的词永远不会进账本。
- **/privacy 页面**逐句说明什么数据去了哪里，每一句都有测试钉在对应代码行上。
- **服务器日志里不会出现读者的文字**：所有模型 provider、深度报告、图注绑定、digest 路由的错误日志只打印错误类型和 HTTP 状态码，不再打印可能把 prompt 回显出来的错误原文。

### 怎么验证的

- 三个角色轮流干活：C（实现）、A（独立评审）、B（调查），都跑在 Claude Sonnet 上；我（Fable）做经理，每一次提交都亲自复核：读代码差异、在独立 worktree 里跑四道门禁、自己改坏一行代码看测试是否变红再复原。
- 三轮独立评审在真实 Chromium 浏览器里测（1440×1000 和 390×844，亮色和暗色），模型调用全部用桩代替（没有真实模型、没有真实联网），用虚构的 PDF 和虚构的字符串做隐私探针。
- 最终门禁（代码头 bffa3659，我自己在独立 worktree 里跑的）：`tsc` 0 错误；`lint` 0 错误 / 150 警告（基线）；测试 373 个测试文件 + 3 个跳过，7546 个测试通过 + 3 个跳过，0 失败；`build` 成功；Vercel 预览全绿；PR 可合并（mergeable_state: clean）。
- 生产环境守卫：Vercel 上如果出现任何公司的模型 key（GEMINI_API_KEY、OPENAI_API_KEY 等），构建直接失败，并且只报变量名、不报值。
- 收尾时 main 又合入了 PR #34（阅读页新布局：更窄的侧栏、Save / Skip / Copy 三个命令排成一行）。我们把它合进了这个分支（P6-01，带着"上传页没有 Skip"的规则一起），顺手修了一个它带来的小问题（上传页的命令行少了 Skip 后多出一个空格子，P6-01b），再请独立评审在新布局上重新量了地图、高亮、术语条、解释框、改写和问题框（P6-02）：全部通过（PASS），八项没有一项失败。几条记录：解释框在 1440 宽的屏幕上只剩 208px 空间（合并前 244px），仍然放在选区下方，不盖住任何按钮和目录；上传页的命令行是两格，没有空格子；侧栏变窄后变高了（两个问题 + 地图展开时 3,092px → 3,447px），命令和目录要多滚一点才看到，但都能用。评审还发现 main 的面板宽度常量没有任何测试钉住，于是又派 C 补了一个测试（P6-03）。。

### 没能证明的（容器里没有条件）

真实模型的回答质量、真实登录（没有 Supabase）、真实触屏设备、浏览器的前进/后退缓存、Python 图片提取（BACKLOG-01）、浏览器里打开公开论文（容器访问不到 arXiv/OpenAlex）、Gemini 联网搜索。最后两轮日志修复（P5-06、P5-06b）只由我验证，没有再请独立评审。

---

## 3. 你需要做什么（按优先级）

| # | 事情 | 大约时间 |
|---|---|---|
| A | 审阅并决定是否合并 PR #32（现在是草稿） | 30–60 分钟 |
| B | 在你自己的机器上重新生成论文 fixtures（BACKLOG-05，容器没网做不了） | 15 分钟 |
| C | 几个设计/文案的取舍（BACKLOG-12、14、23、26，以及两处手机布局） | 想清楚就行 |
| D | 可选的小修（BACKLOG-04、09、10、17、18、19、21/02、22、24、25），任何时候都能派一个 C 去做 | 每项 10–30 分钟 |
| E | 暂停每小时跑一次的 Sonnet 时钟（现在没有活干，只会白烧额度） | 1 分钟 |

### 怎么做

**A. 审阅 PR #32**
1. 打开 https://github.com/Aspen-Lab/peer/pull/32 ，先读描述（我重写过，和这份报告内容一致）。
2. 点 PR 里 Vercel 的 "Preview" 链接，按第 4 节的清单实际点一遍。
3. 满意就点 "Ready for review" 再合并；不满意就在 PR 上留评论，或者在聊天里告诉我，我会派 C 修。

**B. 重新生成 fixtures（BACKLOG-05）**
在能上网的机器上：
```bash
cd web
npx tsx scripts/regenerate-paper-fixtures.ts
git add src/lib/papers/__fixtures__
git commit -m "test(papers): regenerate the paper fixtures with ids, pages and paragraph breaks"
git push
```
然后告诉我，我派 C 把六个测试文件里钉死的数字更新掉（checkpoint `docs/reading-helper-abc/BACKLOG-05-C-*.md` 列了是哪六个）。

**C. 设计/文案取舍**（在聊天里告诉我你的决定即可）
- BACKLOG-12：浅灰的辅助文字对比度是 3.14:1，低于无障碍标准 4.5:1——是调深，还是明知故犯地保留？
- BACKLOG-14：1440 宽的屏幕上 "Explain this?" 的框放在选区下面而不是旁边（侧边栏要 376px，新布局下只剩 208px，要到大约 1888px 宽的屏幕才会放到旁边）——接受，还是改成更窄的侧栏？
- BACKLOG-23：/privacy 没有一条说明"每次刷新推荐时，你的主题、项目描述和整个偏好账本都会发给 Peer 服务器（用完即弃）"，也没说登录后账户里存的账本还会用于夜间 digest 和 dashboard——要不要加一句？你来定措辞。
- BACKLOG-26：模型路径之外的其它错误日志（职位/活动数据源、web-search）还是整条打印——要不要也改成只记类型？
- 手机（390px）上：常备问题输入框只能显示约 25 个字；"Not for recommendations" 勾选框只有 16px，偏小。
- main 的新布局把左侧栏从 370px 收窄到 320px，侧栏因此更高（两个问题时 1,681px → 1,769px；再把地图全部展开 3,092px → 3,447px），决定按钮和目录要往下滚更多才出现——接受，还是让地图/术语条默认折叠？
- 输入问题以后，论文在"只略读"章节里定义的术语会从 Terms to know 里消失、也失去 Tier 0 的 "Explain this?"（这是最初的范围规则 §1h.1：Tier 0 只看标为 read/background 的章节）——接受，还是让论文自己定义的术语不受章节限制？
- 4 个词以上的问题单独起不了推荐作用（账本有 0.05 的门槛），只有多篇论文问到同一个词才累积——接受，还是改权重？

**E. 暂停小时钟**
在 claude.ai 的 Routines（例行任务）里把 "ABC hourly clock"（trigger `trig_01FeaMVuXhEt9Bn6RDEuSdPv`）暂停；或者在聊天里让我暂停。

---

## 4. 最后怎么测试

### 4.1 本地跑起来

```bash
cd web
npm install
npm run dev        # 打开 http://localhost:3000
```
不设任何环境变量也能用 Tier 0（地图、问题、高亮、论文自带定义）。本地开发不需要登录。

要在本地测**上传 PDF**，在 `web/.env.local` 里加两行（目录要在项目外面）：
```
PEER_UPLOADS_ENABLED=true
PEER_PRIVATE_UPLOAD_DIR=/absolute/path/outside/the/repo
```
要测**图片提取**（可选，BACKLOG-01 之前仍走 Python）：装好 `python3`，或设 `PYTHON_BIN=`。

### 4.2 接入你自己的 API key（现在这是唯一的方式）

**为什么没有"通用 API"了**：PR #33 把公司自己的模型 key 全部拿掉了。线上每一次模型调用都用读者自己的 key；服务器不持有任何模型 key；Vercel 构建时有一个守卫脚本，只要环境变量里出现 `GEMINI_API_KEY`、`GOOGLE_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`QWEN_API_KEY`/`DASHSCOPE_API_KEY`、`DEEPSEEK_API_KEY`、`JEV_API_KEY`、`TAVILY_API_KEY`、`BRAVE_SEARCH_API_KEY`、`GOOGLE_VERTEX_*` 之一，构建就失败。唯一的例外：**本地 `next dev`** 仍然接受 `.env.local` 里的 provider key，方便开发——但别把它们放到 Vercel。

**在应用里接 key 的步骤**（本地和线上一样）：
1. 打开 **Profile** 页，找到 **"AI provider"** 这一行。
2. 下拉选一个 provider：Google Gemini（推荐，性价比高）、OpenAI、Alibaba Qwen、Anthropic Claude、DeepSeek（无图片分析）。
3. 在出现的输入框里粘贴你的 key（占位文字会写 "Gemini API key" / "OpenAI API key" 等）。key 只保存在**你这台浏览器**里，不会同步到 Peer 服务器（同步时会把它剥掉）。
4. 把同一页的 **"Deep report"** 开关打开。这个开关控制论文正文是否发给模型：关着时只做摘要级报告，每段摘要、答案等都不会触发。
5. 第一次打开 Peer 时的 `/welcome` 页也有同一组设置。
6. 其它读者自带的 key：**Jev key**（论文筛选，在 Profile 的 Jev 一行）、**Tavily key**（职位/活动的网页发现）。

**在 Vercel 预览上测**，还需要：
- Vercel 项目里有 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（或 `…_ANON_KEY`）、`SUPABASE_SERVICE_ROLE_KEY`——缺一个构建就失败。
- 线上所有模型路由都要求**先登录**（GitHub 或 Google 账号），否则返回 401 "Sign in before using an AI feature"；每个账户每小时有次数上限（explain 40、报告 20、plain 40、guide 20、figure 60）。
- 上传功能线上要：私有 Supabase 存储桶（跑 `supabase/migrations/20261001000000_private_uploads_bucket.sql`），`PEER_UPLOADS_ENABLED=true`，`PEER_UPLOAD_BUCKET=private-uploads`，以及用 `CRON_SECRET` 每天调一次 `/api/jobs/purge-uploads`。

### 4.3 手动测试清单（照着勾）

不填 key：
- [ ] 上传一篇文字版 PDF → 正文下面出现地图（每节标题/页码/分钟/角色，每段第一句）。
- [ ] 上传一篇扫描版 PDF → 提示 "no readable text"，没有地图也没有问题框。
- [ ] 写两个问题，按回车 → 目录栏、标题、地图出现三种绿色；展开一行能看到"mentions X ×2"或"not mentioned"；正文一个字都没少。
- [ ] 写一个太泛的问题 → 出现 "Ask something more specific…" 提示，没有高亮。
- [ ] "Terms to know" 只列论文自己定义过的词；点一下跳到原处；Esc 取消高亮。
- [ ] 选中一句论文定义过的术语 → "Explain this?" 显示论文的原句。
- [ ] 上传的 PDF 页面上**没有** Skip 按钮，按 `x` 什么都不发生；命令行只有 Save 和 Copy 两格，没有空格子。
- [ ] 打开 /privacy，读一遍 "Your questions" 和 "What your questions teach Peer"。

填了 key 并打开 Deep report：
- [ ] 同一篇论文出现 "For your questions"：每题有结论、最多三条带页码的原文引用；没提到的写 "This paper does not address: …"；有 "Read next"。
- [ ] "Terms to know" 最多八条，模型写的一行解释标着 "Peer's reading — not a quote"。
- [ ] "Explain this?" 两段短答，追问几轮，"Say more" 后变长；第八轮后提示 thread 已满。
- [ ] 高亮为"读"的段落下有 "Say it plainly"，三种难度切换；超过 1,200 字的段落没有这个按钮；按 `u` 还原。
- [ ] 按 `c` 复制 Markdown，里面有 `questions:` 和引用。
- [ ] 勾一个问题的 "Not for recommendations" → Profile 的偏好账本里这个问题的词立刻消失。
- [ ] 看服务器日志（本地终端或 Vercel Logs）：里面不应出现你的问题、论文标题或正文片段；错误行只会像 `[gemini-api] gemini-… failed: ApiError status 400` 这样。

### 4.4 自动化门禁

```bash
cd web
npx tsc --noEmit                    # 0 错误
npm run lint                        # 0 错误（警告数见基线）
TZ=America/Chicago npm test         # 0 失败（373 个测试文件 + 3 个跳过，7546 个测试通过 + 3 个跳过）
npm run build                       # 成功
```
`src/lib/jobs/card.test.ts` 偶尔会因为时区闪一次（BACKLOG-21/02），单独重跑一次即可。

---

## 5. 之后怎么继续

- 一切状态在 `ABC-DEEP-REPORT-READING-HELPER.md`：§1 写着当前该谁做什么，§5 是逐项账本（含 BACKLOG），§1h 是每一条裁决和理由。
- `HANDOFF-DEEP-REPORT-READING-HELPER.md` §8 是可以直接贴给任何 agent 的启动提示；§6 写明"验证"在这里的标准。
- 每轮的详细记录在 `docs/reading-helper-abc/`（briefs 是任务书，`*-C-*.md` 是实现记录，`*-A-*.md` 是评审记录）。
- 想继续某个 BACKLOG 项，在聊天里说编号即可。
