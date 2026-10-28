# ABC — own key on peer.homes (workaholic mode)

The manager is the only writer of this file. Plan of record: the owner's answers of 2026-10-25, summarised in §3.

## §1 Header

| field | value |
|---|---|
| HELD BY | manager session (Claude Code desktop, worktree `.claude/worktrees/objective-wu-e8d6fe`) |
| BRANCH | `own-key-on-web` (cut from `origin/main` db0f070a after PR #36 merged; name approved by the owner 2026-10-25). Repository `Aspen-Lab/peer`. No push without the owner's word (AGENTS.md). The owner merges the PR himself (R6). |
| ROUND | 0 — implementation of lanes 1–4; round 1 scores after all four land |
| CURRENT ITEM | L1-C and L3-fix running; L2, L3, L4 landed; L4-A, L2-A queued |
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
- **R7 (2026-10-28), on L3-C's open points.** (a) A key the provider accepts but whose account has no credit (OpenAI/Qwen 429 `insufficient_…`, DeepSeek 402 "Insufficient Balance") is its own outcome `no-credit`, shown as "This key works, but the provider says its account has no credit left." — detected without the word that `no-company-model-copy.test.ts` bans in source (e.g. /insufficient_w+/i, status 402). (b) The provider's own 429 ("The provider is busy right now. Try again in a minute.") and Peer's hourly limit ("Too many checks this hour. Try again later.") get different lines. (c) Peer's own 401 (signed out mid-session) shows "Sign in to check your key." (d) A check cut off at 15 s leaves the provider request to finish; its answer is ignored — accepted. Goes to L3's fix pass together with L3-A's findings.
- **R8 (2026-10-28).** Re-aimed test, accepted: spend-scans scan 5 "reports the guarded count" now sorts the walked list before comparing; the untouched tree failed it on Windows only for directory order (`papers/report` before `papers/[id]`). Same names, same count check; 8 → 9 with `ai/check-key`.
- **R9 (2026-10-28), on L4-C's worry that keys may survive sign-out.** Checked: `shouldClearOnConfirmedSignOut` needs `syncedAccountId !== null`, and `profile-sync.tsx:912` records the owner eagerly at every confirmed sign-in, before the pull. A reader who signs out was signed in on this browser, so the id is set and `logOut()` runs: the dialog's and /privacy's "signing out removes it from this browser" hold. Residual edge, accepted: if the auth check after sign-out fails (network), the 60 s cookie waits for the next load. No change.
- **R10 (2026-10-28).** L4 mutation M3 (drop the "//" / "/\\" prefix check in `safeReturnPath`) left the tests green: an equivalent mutant, because the exact allow-list (`/welcome`, `/profile`) refuses those values anyway; the prefix check stays as defence in depth. M3b (drop the allow-list) → 4 red; M3c (callback forwards `next` unchecked) → 4 red.
- **R11 (2026-10-28).** Turbopack refuses a `node_modules` junction that points outside the project ("Symlink [project]/node_modules is invalid, it points out of the filesystem root"; the dev server exited 1 after 14 s, no orphan left). The branch worktree gets its own `npm ci`; lanes and `own-key-verify` keep their junction / install (tests and tsc are unaffected). The Browser pane twice refused `localhost:3000` while the server was down; retry once after the install, else render-check by HTTP.
- **R12 (2026-10-28), on L3-A (`L3-A-20261028T1725Z.md`, A10 2.0 + A11 0.75 = 2.75).** All seven defects are accepted for L3-fix (`briefs/L3-fix.md`): D1–D3 as R7, with the no-credit detectors widened (Anthropic "credit balance is too low", Qwen `Arrearage`) and run before the status switch; D4 the /privacy Check key paragraph rewritten to name the one log line (`LlmUsage`: provider, model, tokens, time, ok) instead of "keeps nothing"; D5 Anthropic `maxRetries: 0` for the check; D6 "Sign in to check your key." when signed out; D7 an empty 200 is `ok`, and a non-transient provider error gets its own `error` line instead of "Try again". The gate (KeyCheck mounted nowhere) closes in the same pass.

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
| L1-C | C | RUNNING (resumed 2026-10-28 when L4-C finished) | `.claude/worktrees/own-key-lane1` | — |
| L2-C | C | LANDED 68163acd, f6cfe7ce, 43e2a404 | `.claude/worktrees/own-key-lane2` | aeba4d49 note under the key field, 187597a6 AI provider row, 495eeba6 paper page sign-in. Manager: tsc 0, eslint 0 errors (44 warnings, pre-existing), touched tests ×3 = 933 pass / 1 fail (jev-setup, CRLF baseline); M5 (note shown for unknown/unconfigured) → 4 red; M6 (keyNeedsSignIn always false) → 1 red (unit level; the page tests take the flag as input); restored byte-identical. Full suite: 10752 tests, 35 failed, **0 new**. |
| L2-A | A | QUEUED (cap) | — | — |
| L3-C | C | LANDED 7b68634f, 14961cb2 | `.claude/worktrees/own-key-lane3` | 06e101c8 route + privacy, 1ac28885 KeyCheck. Manager in own-key-verify: tsc 0, eslint 0 on 13 files, touched tests ×3 = 272 pass / 2 fail (both baseline: privacy standing, upload record); M1 provider resolved before the gate → 6 red; M2 key rendered in the status line → 2 red; both restored byte-identical. Full suite: 10790 tests, 34 failed, **0 new** vs baseline, 1 fixed (scan 5, R8). |
| L3-A | A | DONE | own-key-lane3 (read only) | `L3-A-20261028T1725Z.md`: A10 FAIL 2.0, A11 FAIL 0.75, B5 PASS; D1–D7; gate: KeyCheck unmounted |
| L3-fix | C | RUNNING (lane 3's C resumed, worktree reset to the branch tip) | `.claude/worktrees/own-key-lane3` | brief `briefs/L3-fix.md` (R7 + R12 + mount) |
| L4-C | C | LANDED 27c1d03a, 2fc2367b, a6278be9, 395e5cfe, acbc8adf | `.claude/worktrees/own-key-lane4` | 15ec36a6 return path + open redirect, 73eff44d Account step + AI-step sign-in, 780cd45d AI summary, 1285860a sign-out dialog, 5708ad40 reset text. Manager: tsc 0, eslint 0 errors (49 warnings, pre-existing), touched tests ×3 = 334/334; M3 equivalent (R10), M3b → 4 red, M3c → 4 red, M4 (keys ignored in signOutPrompt) → 3 red; all restored byte-identical. Full suite: 10814 tests, 35 failed, **0 new** vs baseline. |
| L4-A | A | QUEUED (cap) | — | — |
| L1-A … L4-A | A | QUEUED | — | — |
| R1-score | blind readers ×3 + director | QUEUED | — | — |

## §5 Log

- 2026-10-28 | db0f070a | manager | branch cut; four lane worktrees; baselines run; four Cs spawned.
- 2026-10-28 | db0f070a | manager | workaholic mode on; cap two groups (R1); L1-C, L2-C paused clean; state file and rubric written.
- 2026-10-28 | f958bdb0 | manager | owner set target 97.9 ×2 per theme (R5).
- 2026-10-28 | cb6e0dd0 | manager | L3-C reported; L2-C resumed into the freed slot; L3 verified in own-key-verify (tsc, eslint, ×3, two mutations); rulings R7, R8.
- 2026-10-28 | 14961cb2 | manager | L3 full suite 0 new failures; L3 landed (cherry-pick 06e101c8→7b68634f, 1ac28885→14961cb2). L3-A waits for a slot.
- 2026-10-28 | 14961cb2 | manager | L4-C reported (5 commits); L1-C resumed into the freed slot; L4 verified (tsc, eslint, ×3, four mutations); rulings R9, R10.
- 2026-10-28 | acbc8adf | manager | L4 full suite 0 new failures; L4 landed (5 cherry-picks).
- 2026-10-28 | acbc8adf | manager | L2-C reported (3 commits); L3-A started in the freed slot; L2 verified (tsc, eslint, ×3, two mutations).
- 2026-10-28 | 43e2a404 | manager | L2 full suite 0 new; L2 landed (3 cherry-picks, clean). Combined tip tsc 0; full suite started.
- 2026-10-28 | 43e2a404 | manager | combined tip (L2+L3+L4) full suite: 10994 tests, 34 failed, **0 new**, 1 fixed (scan 5).
- 2026-10-28 | 43e2a404 | manager | dev server needs a real node_modules (R11); branch worktree npm ci; /welcome Account + AI steps and /privacy render on localhost:3000, no console errors. L3-A reported 2.75; R12; L3-fix started in the freed slot.

## §6 Clock

Session cron (CronCreate) `20 * * * *`, session-only, auto-expires after 7 days (2026-11-04). **Read back 2026-10-28: id `b37a2acb`, recurring, "Every hour at :20", next run 12:41 local.** Desktop scheduled tasks: none (listed). Dies if this Claude session exits; re-arm on resume if CronList is empty.

## §7 Resume section

1. Read §1, §2 and the newest §4 rows.
2. Check which workers are still running (agent notifications; `git -C <lane worktree> log db0f070a..HEAD` and `status`).
3. For a finished C: verify in `own-key-verify` (checkout the lane commit detached; tsc, eslint on changed files, the touched tests 3×, one manager mutation per rule, then the full suite compared with the baseline), then cherry-pick onto `own-key-on-web`.
4. Refill up to two groups in R1's order.
5. After all four lanes land: mount `KeyCheck` in `AiKeyFields`, write one CHANGELOG entry, run scoring round 1 (RUBRIC.md).
6. Never push, merge or sign in locally without the owner's word.
