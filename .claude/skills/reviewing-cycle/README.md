# reviewing-cycle

The **abc loop with a manager feedback cycle on top**. abc (the sibling skill in this repository)
gives you the three roles — A reviewer, B investigator, C implementer — and a manager who rules,
plus the state file that survives everything. reviewing-cycle adds:

- a **rubric** with themes, defect costs and a formula, so the round's number is reproducible;
- a **scoring round**: the manager reads as the demanding user, N blind readers score the same
  render independently, the median is the score of record;
- the **manager verifies every C itself** — gates, the touched tests several times, and one
  mutation of its own (break the rule → the test goes red → restore byte-identical) before it lands;
- **parallel items**, one C per cluster of defects, each in its own detached worktree, the manager
  cherry-picks;
- a **stop condition**: every theme at or above the user's target in **two consecutive rounds**.

It was distilled from a real campaign: ten rounds over a document-reading surface, 60+ items, two
themes taken from ~60 and ~69 to 99 and 97 by the rubric.

## Install

Both skills, into Claude Code's skills directory (user scope `~/.claude/skills/`, or project
scope `.claude/skills/`):

```bash
git clone https://github.com/peter14531453/claude-skills.git
cp -r claude-skills/abc claude-skills/reviewing-cycle ~/.claude/skills/
```

ChatGPT / Codex / any agent that reads files: put both folders in the working directory and tell
the agent *"Read `reviewing-cycle/SKILL.md` and follow it."* The platform's model defaults are in
the table inside `SKILL.md`.

## Use

```
/reviewing-cycle 95 --themes "the digested content; the features around it"
```

- **The target percentage is required.** The skill will not start without it.
- Model defaults — Claude: manager `opus`, workers and blind readers `sonnet`. ChatGPT: manager
  `sol`, workers `tera`. Override with `--manager` / `--workers`.
- The manager writes the state file (abc's template) and `RUBRIC.md` (this skill's template),
  confirms the themes with you, and runs round 1.
- Every round you get the score per theme, what changed, what is left, and the decisions only you
  can make. The loop ends when every theme is at or above the target in two consecutive rounds —
  and your own look at the surface is the acceptance above the rubric.

## In the box

```
reviewing-cycle/
  SKILL.md                        what it adds to abc, the round, the invocation, the model defaults
  templates/RUBRIC.md             themes, costs, the formula, the stop condition, the score table
  templates/brief-C-parallel.md   a C's brief for a parallel item in its own worktree
  templates/checkpoint.md         what every worker returns
```

## 中文说明

这是 **abc 循环加上 manager 评分反馈**。abc（同一仓库里的那个 skill）提供三个角色（A 审查、B 调查、C 实现）、做裁决的 manager 和一份经得住中断的状态文件；reviewing-cycle 在上面加：

- 评分表：主题、缺陷扣分、公式，每一轮的分数可复现；
- 打分轮：manager 以挑剔用户的身份通读，N 个独立"盲审"读者按评分表打分，取中位数；
- manager 亲自验证每个 C 的改动：跑检查、多次跑被改的测试、自己做一次破坏测试（关掉规则 → 测试变红 → 逐字节恢复），通过后才合入；
- 并行：每簇缺陷一个 C，各自在独立 worktree 里做，manager 挑选合入；
- 停止条件：每个主题连续两轮 ≥ 目标百分比。

用法：`/reviewing-cycle 95`。**必须给目标百分比**，不给不开始。Claude 上默认 manager 用 `opus`、子 agent 用 `sonnet`；ChatGPT 上默认 manager 用 `sol`、子 agent 用 `tera`。分数是 manager 的度量，你自己看页面的判断才是最终验收。

## Licence

MIT (`LICENSE`).
