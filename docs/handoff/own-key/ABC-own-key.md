# ABC — own key on peer.homes (workaholic mode)

The manager is the only writer of this file. Plan of record: the owner's answers of 2026-10-25, summarised in §3.

## §1 Header

| field | value |
|---|---|
| HELD BY | manager session (Claude Code desktop, worktree `.claude/worktrees/objective-wu-e8d6fe`) |
| BRANCH | `own-key-on-web` (cut from `origin/main` db0f070a after PR #36 merged; name approved by the owner 2026-10-25). Repository `Aspen-Lab/peer`. No push without the owner's word (AGENTS.md). The owner merges the PR himself (R6). |
| ROUND | 0 — implementation of lanes 1–4; round 1 scores after all four land |
| CURRENT ITEM | L3-C and L4-C running; L1-C and L2-C paused (owner's cap) |
| NEXT TURN | on each worker report: verify → land on the branch → refill up to the cap of two groups |
| STOPPED BECAUSE | — |
| TARGET | **97.9 per theme, two consecutive rounds** (the owner, 2026-10-28, R5: "达标线用 97.9，每个主题连续两轮达到就停。") |
| CAP | **at most two subagent groups running at once** (the owner, 2026-10-28: "使用workaholic mode工作，但确保每次最多只有两个subagent group在跑"). A group = one item's A/B/C chain, or one scoring round's blind readers. |
| GATE BASELINE | untouched db0f070a in `own-key-verify` (full `npm ci`): vitest 10681 tests, **35 failed** (25 files: CRLF under `core.autocrlf=true`, Windows backslash paths, reader timing, papers page tests, spend-scans scan 5 count). List: manager scratch `verify-baseline.json`. With the main checkout's stale node_modules (no `server-only`, no `mupdf`): 69 failed + feed suites error at import. |
| CLOCK | `b37a2acb`, session cron `20 * * * *`, read back 2026-10-28 (§6) |

## §2 Rulings

- **R1 (2026-10-28).** The owner caps concurrency at two subagent groups. L1-C and L2-C were stopped before they had edited anything (both worktrees clean); they resume, context intact, when a slot frees. Order of refill: L2 (unblocks L3's mount) → L1 → scoring round 1.
- **R2 (2026-10-28).** Worker models: opus, per the owner's standing subagent-model policy (memory, 2026-08-13), which overrides the skill's smaller-model default.
- **R3 (2026-10-28).** `own-key-verify` holds the only complete `node_modules`; the branch worktree and lanes 1–2 are junctions to it. Do not remove `own-key-verify` before the loop ends.
- **R4 (2026-10-28).** Rendering for scoring uses the dev server with only the public Supabase URL and publishable key (no service-role key) and never signs in locally without the owner's explicit OK (local writes are production writes). Signed-in states are scored from route/unit evidence and static renders of the views.
- **R5 (2026-10-28).** The owner set the stop line: "达标线用 97.9，每个主题连续两轮达到就停。" Every theme at or above 97.9 in two consecutive rounds; a theme that has done so stops being scored, and a later change to its files reopens only the lines it could move.
- **R6 (2026-10-28).** The owner: "分支给我来merge就行，我也有权限" — he merges the PR to `main` himself. The manager flagged once that a merge to `main` auto-deploys peer.homes, which Addendum No. 1 §4.2 (draft) lists among the Operating Roles; the decision is the owner's. The manager still never merges.

## §3 Items

| item | scope (owner's word) | lane |
|---|---|---|
| B | remote profile can never set/clear device-only fields ("做") | L1 |
| F | remove Tavily ("清理") | L1 |
| C | sign-in notes beside the model key; paper page sentence for a signed-out reader with a key ("o") | L2 (+ L4 for the Welcome summary) |
| G | Profile note: the key does not follow the account ("在profile页面的ai key下面说明一下") | L2 |
| D | "Check key" button + route + privacy sentences ("做") | L3 |
| A | sign-in in the walkthrough ("加到walk through"); the Account section is already first on Profile | L4 |
| E | sign-out dialog: keys will be deleted, and why — safety ("跳出一个弹框，警告用户key会被删除，并说出原因（安全）") | L4 |

## §4 Ledger

| id | role | status | worktree | evidence |
|---|---|---|---|---|
| L1-C | C | PAUSED (R1) | `.claude/worktrees/own-key-lane1` | — |
| L2-C | C | PAUSED (R1) | `.claude/worktrees/own-key-lane2` | — |
| L3-C | C | RUNNING | `.claude/worktrees/own-key-lane3` | — |
| L4-C | C | RUNNING | `.claude/worktrees/own-key-lane4` | — |
| L1-A … L4-A | A | QUEUED | — | — |
| R1-score | blind readers ×3 + director | QUEUED | — | — |

## §5 Log

- 2026-10-28 | db0f070a | manager | branch cut; four lane worktrees; baselines run; four Cs spawned.
- 2026-10-28 | db0f070a | manager | workaholic mode on; cap two groups (R1); L1-C, L2-C paused clean; state file and rubric written.
- 2026-10-28 | f958bdb0 | manager | owner set target 97.9 ×2 per theme (R5).

## §6 Clock

Session cron (CronCreate) `20 * * * *`, session-only, auto-expires after 7 days (2026-11-04). **Read back 2026-10-28: id `b37a2acb`, recurring, "Every hour at :20", next run 12:41 local.** Desktop scheduled tasks: none (listed). Dies if this Claude session exits; re-arm on resume if CronList is empty.

## §7 Resume section

1. Read §1, §2 and the newest §4 rows.
2. Check which workers are still running (agent notifications; `git -C <lane worktree> log db0f070a..HEAD` and `status`).
3. For a finished C: verify in `own-key-verify` (checkout the lane commit detached; tsc, eslint on changed files, the touched tests 3×, one manager mutation per rule, then the full suite compared with the baseline), then cherry-pick onto `own-key-on-web`.
4. Refill up to two groups in R1's order.
5. After all four lanes land: mount `KeyCheck` in `AiKeyFields`, write one CHANGELOG entry, run scoring round 1 (RUBRIC.md).
6. Never push, merge or sign in locally without the owner's word.
