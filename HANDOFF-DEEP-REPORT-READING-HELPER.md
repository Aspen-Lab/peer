# HANDOFF — deep report reading helper（带着问题读）— take over the manager's work from here

给用户的一句话（中文）：把这个文件整份贴给任何能读写这个仓库的 agent（ChatGPT/Codex、Cursor、另一个 Claude），它就能接手"经理"的工作：读状态文件、派任务、逐项验证、提交推送。第 8 节是可以直接粘贴的启动提示。

**Read this first if you are not the agent that last held the manager role.** Any capable agent with file and shell access to this repository can take over: a fresh Claude Code session, a Codex or ChatGPT session on the owner's machine, Cursor. This file tells you how the campaign is organised, how to take the manager role over without stepping on a live one, how to run the three worker roles when you cannot spawn subagents, and exactly what "verified" means here. Every rule about the product and the work itself lives in `ABC-DEEP-REPORT-READING-HELPER.md` (the shared state file; the manager alone writes it) and in the spec `docs/BLUEPRINT_goal_directed_reading.zh-CN.md`. This file restates none of them; it only tells you where they are and how to apply them.

## 1. What this campaign is

The Peer web app (`web/`, Next.js) lets a reader upload a PDF and get a "deep report". The owner's complaint: reading a paper has no direction, jargon and dense prose stall it, and a wall of unsegmented text is frightening. The spec answers with "带着问题读" (goal-directed reading): ask up to five questions first; see a reading map (sections, pages, minutes, one line per paragraph taken from the paragraph's opening sentences); see which sections and paragraphs match each question, tinted light green in the contents rail; get verified, verbatim-quoted answers with page numbers; get bounded term explanations and a plain rewrite in three difficulty levels. The first half (Tier 0) needs no model key. Nothing is ever hidden from the reader. Peer's voice is English only.

Phases: P0 foundation and P1 Tier 0 helper are VERIFIED. P2 (the model answers the reader's questions) is in progress. P3 (terms, "Explain this?", paragraph gists), P4 (plain rewrite), P5 (standing questions, final review, handoff) follow. The ledger in §5 of the state file is the source of truth for what is done.

## 2. Setup — do this before anything else

```bash
cd <the checkout>              # the cloud container uses /home/user/peer
git branch --show-current      # must print: deep-report-reading-helper-enhancement
git pull --ff-only origin deep-report-reading-helper-enhancement
git status --short             # expect nothing; if files are modified, read section 4 before touching them
cd web && npm ci               # once per machine; node_modules is gitignored
```

Do not create another branch. Do not merge or deploy. The draft PR for this branch (Aspen-Lab/peer#32) is the owner's to merge. Never force-push, rebase pushed commits, or amend; never use `git checkout --`, `git restore` or `git reset` on a file to undo an edit in the main checkout (edit it back); never delete or skip a test to get green.

Platform note: the gate of record is a Linux run. On Windows, five host-only tests fail at the baseline (two POSIX `0600` mode assertions, one file-URL path, one CRLF byte comparison, one reference-IDF parse); a Windows manager records them as the known baseline and uses the implementer's exact-commit Linux run, or the Vercel preview build plus the focused tests, as the gate evidence. No WSL is needed.

## 3. What to read, in this order

1. `ABC-DEEP-REPORT-READING-HELPER.md` §1 CURRENT STATE: `HELD BY`, `CURRENT ITEM`, `NEXT TURN`, `STOPPED BECAUSE`.
2. The same file's §1a (the owner's decisions, binding), §1b (product rules), §1c (git and evidence protocol), then the dated rulings §1d–§1g (every design decision with its reason; the newest are at the end of §1f and §1g), §2 (roles), §3 (gates, allowed files per phase, data contracts, the acceptance inventory §3d).
3. The briefs for the next items in `docs/reading-helper-abc/briefs/` (one file per item, written by the manager; an item without a brief is specified by its §1f/§1g ruling and its §5 row).
4. `docs/BLUEPRINT_goal_directed_reading.zh-CN.md` in full. §8 records the owner's decisions.
5. `AGENTS.md`, `docs/PRODUCT_DIRECTION.md`, `web/AGENTS.md` (this Next.js version differs from training data; read `web/node_modules/next/dist/docs/` before touching an App Router API).
6. The current round in §4 (append-only log, newest at the end) and the ledger §5 (one row per item, status + evidence).
7. The checkpoints in `docs/reading-helper-abc/` for the last two or three items, to see the expected shape and depth.

## 4. Taking the manager role over

There is exactly one manager at a time. §1 `HELD BY` names the manager and the worker currently holding the checkout.

1. Look at `HELD BY` and the last entry in §4, and at `git log -5` with times. If the named manager pushed within the last hour, assume it is alive: stop and tell the owner instead of taking over. If it is older than that, or §1 says `HELD BY: free`, or the owner told you to take over, continue.
2. Append one §4 entry: "<UTC> <your name/model> takes the manager role from <previous>; reason". Set `HELD BY` to yourself. Commit and push that before anything else (`git commit -- ABC-DEEP-REPORT-READING-HELPER.md`).
3. If `git status` shows modified files you did not make, they are an interrupted worker's in-progress edits. Do not commit them and do not discard them: `git stash push -m "<item> in-progress by <who>, stashed by <you> <UTC>"`, note the stash in §4, and decide with the ledger whether the item is re-run from scratch (usual) or resumed from the stash.
4. Hand back the same way: a §4 entry, `HELD BY: free` (or the next manager's name), `STOPPED BECAUSE:` filled, commit, push. The Claude cloud session has an hourly scheduled resume (a Routine) that reads §1 and continues whatever it says; if it finds `HELD BY` naming another live manager, it waits.

## 5. How the loop runs

Manager plus three worker roles, one writer at a time on one checkout:

- **C implementer** works the next NOT_STARTED ledger item from its brief: tests first (show the red run), implement, run its own mutations, run the four gates, write a checkpoint under `docs/reading-helper-abc/<ITEM>-C-<UTC>.md`, commit (only its own files), push, report in one paragraph. It asks the manager when a ruling is missing and continues on the parts that do not depend on the answer.
- **A reviewer** measures a finished phase against §3d item by item on the dev server with a real browser where the item is visual, writes PASS / FAIL / BLOCKED with reproductions, never fixes.
- **B investigator** reproduces a finding, writes the smallest fix guide with exact lines and the tests C must add, never edits production code.
- **Manager** assigns one item at a time, rules on every open question with a dated entry in §1f/§1g (never in chat only), verifies every commit, keeps §1 true, commits per item and pushes immediately.

If you can spawn subagents, run A/B/C as separate agents with the role brief in the prompt. Model (owner decision 2026-10-06, §1a.9): every worker — A, B and C — runs on Claude Sonnet (in Claude Code, the Agent tool's `model: "sonnet"`); never spawn a worker on a larger model, because credit burns too fast. The manager itself is whatever the owner is driving (Claude Fable in the cloud session). If you cannot spawn subagents, run one role at a time in your own conversation, commit and push between roles, and write in §4 that independence was reduced. An item is VERIFIED only after a reviewer who did not implement it has passed it (A at the phase review), so a single-conversation manager still needs a separate reviewer pass later.

Worker prompt skeleton (fill the item and the brief path; spawn it on Claude Sonnet):

```
You are C, the implementer in an ABC loop on the Peer repository, branch
deep-report-reading-helper-enhancement. Read ABC-DEEP-REPORT-READING-HELPER.md
§0, §1, §1a–§1c, §2 (your role), §3a, the ruling your brief names, and your brief
docs/reading-helper-abc/briefs/<ITEM>.md. Pull first. Tests first, then the code,
then your own mutations, then the four gates in web/. Commit only your files plus
your checkpoint docs/reading-helper-abc/<ITEM>-C-<UTC>.md; push; report in one
paragraph. Never delete a test, never force-push, never git checkout/restore/reset
a file to undo an edit, no question text or credentials in any log, fixture or
checkpoint.
```

## 6. How the manager verifies a commit (the standard)

Every C commit gets this, and the evidence goes into the item's §5 row (the existing rows show the format):

1. Read the production diff in full (`git show <sha> -- <files>`), against the ruling. Choices beyond the brief are accepted or sent back with a dated ruling.
2. In a detached scratch worktree at the commit (outside the checkout; symlink `web/node_modules` into it): `npx tsc --noEmit` and the touched test files.
3. At least one mutation of your own, different from C's: break the behaviour with a one-line edit (sed), run the touched tests, see them fail, restore the file and prove it byte-identical (`git diff --quiet`). A mutation that no test catches is a finding: C adds the test.
4. Full `npm run lint` (0 errors; 151 warnings is the baseline) and full `TZ=America/Chicago npx vitest run` (0 failed; the count never goes down) in a second worktree, in the background. `npm run build` in the main checkout when no worker is editing it, else the Vercel preview build of the pushed commit is the build gate (GitHub PR status, or the Vercel bot comment on the PR).
5. For a visual item, open the real path once yourself (the dev server and Chromium, or a fixture through the function) in addition to C's browser check.
6. Record it: the §5 row (status IMPLEMENTED_PENDING_REVIEW with the evidence), a §4 line, §1 updated, `git commit -- ABC-DEEP-REPORT-READING-HELPER.md`, push.

An item becomes VERIFIED only when A's phase review passes its §3d items and the manager has read that checkpoint in full.

## 7. How to stop so the next agent can pick up

Whenever you stop (finished, out of budget, blocked, told to stop):

1. Write what you did into §4 under the current round; mark incomplete work PARTIAL and say exactly what remains and where any uncommitted work is (a stash name, a machine).
2. Update the §5 rows and §1 so they are true right now, including the queue in `CURRENT ITEM`.
3. Fill `STOPPED BECAUSE:` with one of `finished the turn`, `out of budget @ <UTC>`, `blocked: <one sentence>`.
4. Set `HELD BY: free` (or the name of the manager you hand to).
5. Commit and push. Unpushed work on a cloud container is lost when the container is reclaimed; unpushed work on a laptop is invisible to every other agent.

This file carries no snapshot of the latest item on purpose: §1 of the state file (`CURRENT ITEM`, `NEXT TURN`) and the newest §4 entries are the only place that state lives, so they cannot drift apart.

## 8. Kickoff prompt — for the owner to paste into any capable agent

```
Work in the Peer repository on branch deep-report-reading-helper-enhancement.

Read HANDOFF-DEEP-REPORT-READING-HELPER.md at the root first, in full, then follow
it: confirm the branch, pull, run npm ci in web/, take the manager role over the way
section 4 describes (one §4 entry, HELD BY, commit, push), read
ABC-DEEP-REPORT-READING-HELPER.md in the order section 3 gives, and read the spec
docs/BLUEPRINT_goal_directed_reading.zh-CN.md.

You are the MANAGER of this loop. Do whichever turn §1 says is next, using the
brief in docs/reading-helper-abc/briefs/ for that item. Spawn A/B/C as separate
agents if you can; otherwise run them sequentially in this conversation, committing
and pushing between roles, and record the reduced independence in §4. Verify every
commit the way section 6 describes before you assign the next item. Rule on every
open question with a dated entry in the state file, never in chat only.

Commit after every ledger item and push immediately. Never delete a test, never
force-push, never rewrite history, never use git checkout/restore/reset on a file to
undo an edit. Do not merge the PR, deploy, or make paid model calls beyond what a
developer key in the environment already allows. Nothing per-user (questions,
private PDF text, keys) in any log, fixture, checkpoint or shared cache.

When you run out of budget or finish, stop the way section 7 describes. Then tell me
in one line what you did and what is next.

Start now.
```
