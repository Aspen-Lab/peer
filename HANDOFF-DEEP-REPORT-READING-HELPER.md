# HANDOFF — deep report reading helper（带着问题读）— entry door for any agent

**Read this first if you are not the Claude Code cloud session that opened this campaign.** A fresh Claude session, an hourly scheduled run, Codex, Cursor, ChatGPT with file access: all start here. This file orients you; every rule about the work lives in `ABC-DEEP-REPORT-READING-HELPER.md` (the shared state file) and the spec `docs/BLUEPRINT_goal_directed_reading.zh-CN.md`. This file deliberately restates none of them.

## 1. What this campaign is

The Peer web app (`web/`, Next.js) lets a reader upload a PDF and get a "deep report". The owner's complaint: reading a paper has no direction, jargon and dense prose stall it, and a wall of unsegmented text is frightening. The spec answers with "带着问题读" (goal-directed reading): ask up to five questions first; see a reading map (sections, pages, minutes, one line per paragraph); see which sections and paragraphs match each question, tinted in the contents rail; get verified answers with page numbers; get bounded term explanations and a plain rewrite in three difficulty levels. The first half needs no model key. Nothing is ever hidden from the reader.

## 2. Setup — do this before anything else

```bash
cd /home/user/peer            # or wherever this checkout lives
git branch --show-current     # must print: deep-report-reading-helper-enhancement
git pull --ff-only origin deep-report-reading-helper-enhancement
git status --short
cd web && npm ci              # once per container; node_modules is gitignored
```

Do not create another branch or worktree. Do not merge. The draft PR for this branch is the user's to merge.

## 3. What to read, in this order

1. `ABC-DEEP-REPORT-READING-HELPER.md` §1 CURRENT STATE — whose turn, which item, and its `STOPPED BECAUSE:` line.
2. The same file's §1a–§1c rulings, then §2 roles and §3 engineering contract (gates, allowed files per phase, data contracts, the 18 acceptance items in §3d).
3. `docs/BLUEPRINT_goal_directed_reading.zh-CN.md` in full — the spec. §8 records the user's decisions.
4. `AGENTS.md`, `docs/PRODUCT_DIRECTION.md`, `web/AGENTS.md` (this Next.js version differs from training data; read `web/node_modules/next/dist/docs/` before touching an App Router API).
5. The current round in §4 and the ledger §5.

## 4. How the loop runs

Manager + three roles, one at a time, on one checkout:

- **C implementer** works the next NOT_STARTED ledger item: test first, implement, run the four gates, write a checkpoint under `docs/reading-helper-abc/`, commit, push.
- **A reviewer** measures the finished phase against §3d, item by item, PASS / FAIL / BLOCKED with reproductions. Never fixes.
- **B investigator** reproduces every A FAIL and writes a fix guide. Never edits production code.
- **Manager** assigns roles, rules on policy with dated entries, verifies by reading files and running gates, and keeps §1 true.

If you can spawn subagents, run A/B/C as separate agents (the opening session uses Opus subagents with a Fable manager). If you cannot, do one role at a time in one conversation, commit and push between roles, and say in §4 that independence was reduced. Final VERIFIED still needs a reviewer who did not implement the item.

## 5. How to verify the standard is met

An item is VERIFIED only when all of these hold:

1. Its §3d acceptance items are PASS in an A checkpoint written by an agent that did not implement it, with the reproduction command or steps.
2. The four gates pass on the pushed commit: `npm run lint` (0 errors), `npx tsc --noEmit` (0), `npm test` (0 failed; the benchmark live flake is excluded by config), `npm run build` (OK). Test count did not decrease; no test was deleted.
3. The manager re-read the changed files and opened at least one real path (fixture through the function, or the paper page on the dev server for UI items).
4. The §1b product rules hold: Tier 0 intact with no questions; every paper sentence verbatim and verified; Peer presents, the user judges; nothing per-user in shared caches or logs; bounded output; nothing hidden from the reader.

## 6. How to stop so the next agent can pick up

Whenever you stop (finished, out of budget, blocked, told to stop):

1. Write what you did into §4 under the current round; mark incomplete work PARTIAL and say exactly what remains.
2. Update §5 rows and §1 so they are true right now.
3. Fill `STOPPED BECAUSE:` with one of `finished the turn`, `out of budget @ <UTC>`, `blocked: <one sentence>`.
4. Set `HELD BY: free`.
5. Commit and push. Unpushed work in this cloud container is lost when it is reclaimed.

## 6a. Latest submitted checkpoint — 2026-10-06T00:13Z

P2-04 is implemented and submitted in the current branch commit, with checkpoint `docs/reading-helper-abc/P2-04-C-20261005T220345Z.md`. The Terra C implementation adds the bounded **For your questions** block and the display-only Tier 2 answer/background overlay; focused tests are 21/21 green, lint/tsc/build are green, and the Windows full-suite failures are the five documented host-only baselines. The two briefly considered out-of-scope type-only edits were restored before submission. P2-04 is **IMPLEMENTED_PENDING_REVIEW**, not VERIFIED: Claude's next action is an independent read/mutation/gate review of this item. Do not start P2-05 until that review is recorded.

## 7. Kickoff prompt — for the user to paste into any capable agent

```
Work in the Peer repository on branch deep-report-reading-helper-enhancement.

Read HANDOFF-DEEP-REPORT-READING-HELPER.md at the root first, in full, then follow
it: confirm the branch, pull, run npm ci in web/, read ABC-DEEP-REPORT-READING-HELPER.md
in the order section 3 gives, and read the spec docs/BLUEPRINT_goal_directed_reading.zh-CN.md.

You are the MANAGER of this loop. Do whichever turn §1 says is next. Spawn A/B/C as
separate agents if you can; otherwise run them sequentially in this conversation,
committing and pushing between roles, and record the reduced independence in §4.

Commit after every ledger item and push immediately. Never delete a test, never
force-push, never rewrite history, never use git checkout/restore/reset on a file to
undo an edit. Do not merge the PR, deploy, or make paid model calls beyond what a
developer key in the environment already allows.

When you run out of budget or finish, stop the way section 6 describes. Then tell me
in one line what you did and what is next.

Start now.
```
