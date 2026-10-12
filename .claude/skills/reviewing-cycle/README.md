# reviewing-cycle

A skill for coding agents: a **manager-scored improvement loop**. The manager spawns parallel subagents (A reviewer, B investigator, C implementer), verifies every change itself, scores each round against a written rubric, and repeats until every theme scores at or above the user's target in two consecutive rounds.

It was distilled from a real campaign (ten rounds over a document-reading surface, 60+ items, two themes taken from ~60 and ~69 to 99 and 97 by the rubric).

## Install

**Claude Code** — copy the `reviewing-cycle/` directory into your project's `.claude/skills/` (project scope) or `~/.claude/skills/` (user scope):

```bash
git clone https://github.com/<owner>/reviewing-cycle.git
cp -r reviewing-cycle/reviewing-cycle .claude/skills/
```

**ChatGPT / Codex** — put `SKILL.md` and `templates/` where your agent runtime reads skills, or paste `SKILL.md` into the agent's instructions. The model defaults for that platform are in the table inside `SKILL.md` (manager `sol`, workers `tera`).

## Use

```
/reviewing-cycle 95 --themes "the digested content; the features around it"
```

- **The target percentage is required.** The skill will not start without it.
- Defaults on Claude: manager `opus`, workers and blind readers `sonnet`. On ChatGPT: manager `sol`, workers `tera`. Override with `--manager` / `--workers`.
- The manager writes `STATE.md` and `RUBRIC.md` from the templates, confirms the themes with you, and runs round 1.
- Every round you get the two numbers, what changed, what is left, and the decisions only you can make. The loop ends when every theme is at or above the target in two consecutive rounds — and your own look at the surface is the acceptance above the rubric.

## What is in the box

```
reviewing-cycle/
  SKILL.md               the loop, the roles, the manager's rules, the invocation
  templates/STATE.md     the manager's state file
  templates/RUBRIC.md    themes, costs, the formula, the stop condition
  templates/brief-C.md   the implementer's brief
  templates/brief-A.md   the reviewer's walk
  templates/brief-B.md   the investigator's brief
  templates/checkpoint.md
```

## 中文说明

这是一个给编码 agent 用的 skill：由一个 **manager** 带一组并行的子 agent（A 审查、B 调查、C 实现）做改进循环。manager 自己验证每一处改动，每轮按书面评分表打分，直到每个主题连续两轮达到你给定的目标百分比。

- 调用时**必须给目标百分比**，例如 `/reviewing-cycle 95`；不给就不会开始。
- Claude 上默认 manager 用 `opus`，子 agent 用 `sonnet`；ChatGPT 上默认 manager 用 `sol`，子 agent 用 `tera`。可用 `--manager` / `--workers` 覆盖。
- 每一轮你会收到两个分数、改了什么、还剩什么、以及只有你能做的决定。
- 分数是 manager 的度量；你自己看页面的判断才是最终验收。

## Licence

MIT.
