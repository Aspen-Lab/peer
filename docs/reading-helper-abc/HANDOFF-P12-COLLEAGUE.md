# P12 handoff to a colleague's agent (2026-10-30)

Written by the outgoing P12 manager (Claude), on the owner's request, before he ran short of tokens. Branch `update-on-paper-digest`; draft PR Aspen-Lab/peer#37. The owner is Peter (`peter14531453`).

## 给同事的中文摘要

- **任务：** 在这个分支上接着跑 P12 评审循环，直到停止线全部达成。停止线：每个主题在**连续两轮**都 ≥ 97.25 分。目前的分数是 97.92。
- **已达标：** Theme A、C0（无 key 时的结构）、C1（有 key 时的结构）。
- **只剩 Theme B：** 第四轮的正式分数是三篇各 97.92，已连续达标 1 轮。**再做一轮（第五轮）并达到 ≥ 97.25 就结束。** 如果没有新问题，预计还是 97.92。
- **需要老板（Peter）先给你的东西：**
  1. 六篇论文的 PDF（P1–P6）。放在仓库外面，永远不要提交。
  2. 是否把他的测试 Gemini key 给你的环境，用于 C1 抽查。可选，见下文第 3 步。
- **硬规矩：**
  - 不建新分支，不 force-push，不 rebase。
  - 不合并 PR#37，除非老板明确说可以。
  - 不提交论文原文。
  - 不打印、不提交 key。
  - 同时最多两个 subagent。

## 1. Where things stand

Read these first:
- `AGENTS.md`;
- the skills `.claude/skills/workaholic-mode/`, `reviewing-cycle/` and `abc/`;
- this file;
- `docs/reading-helper-abc/HANDOFF-P12.md` §5;
- the newest rulings in `ABC-DEEP-REPORT-READING-HELPER.md`, which run through **§1h.491**;
- `docs/reading-helper-abc/P12-RUBRIC.md`.

**The stop line:** every theme ≥ 97.25 per paper in **two consecutive scored rounds**. Themes A and B are scored on P1–P3, Theme C0 on P1–P6, and C1 at 100 % per paper (§1h.419–§1h.426, §1h.430).

| Theme | Status | Evidence |
|---|---|---|
| A (the question, map and answers surface) | **DONE** (§1h.470): round 3 97.92 ×3, round 4 100 ×3 | `P12-RUBRIC.md` |
| C0 (structure without a key) | **DONE**: 100 on P1–P6 in rounds 2–4, re-verified 100 ×6 after C P12-97 (§1h.491) | `p12-tools/manager/` |
| C1 (structure with the owner's test key) | **DONE** (§1h.486): every paper 100 % in two consecutive phases. One spot check is open after C P12-97 (step 3) | §1h.482–§1h.486 |
| B (notes, explain, margin and controls) | **Round 4 of record 97.92 ×3** (§1h.489; two blind readers agree): 12/12 PASS, only the standing E2 0.25. **Consecutive count 1.** Round 5 is the confirming round | §1h.487–§1h.489 |

Code landed since round 4's walk (all verified by the manager: own mutation per rule, full gates):
- **C P12-95, the owner's O1:** a drag floor of about 50 characters. The margin divider at 853 px now moves 280→347. The first visit is unchanged.
- **C P12-97, figure text and the running foot leave the paragraphs:** the short blocks on P3–P6 went from 46/96/111/29 to 1/10/3/10, with no prose lost. The extraction version is 14 and the reading version 18.

Gate counts at `3d931688`: tsc 0; lint 0 errors / 144 warnings; 663 files + 3 skipped, 12,597 tests + 3 skipped; build 0.

**Next numbers:** ruling **§1h.492**, item **P12-98**.

## 2. Setup in your own environment

1. **The owner's papers.** Ask Peter to upload the six PDFs to your session. Save them **outside the repository** as `P1.pdf` … `P6.pdf`, by this map (first author or article id, year):

   | Label | Paper |
   |---|---|
   | P1 | Lin et al., 2025 (atom probe, Li-ion cathode) |
   | P2 | Sederholm et al., 2026 (electrochemical recycling) |
   | P3 | Zahiri et al., 2021 (solid-state batteries) |
   | P4 | Nature Communications article s41467-026-78832-y |
   | P5 | Nature article s41586-024-08465-y |
   | P6 | Nature article s41586-026-11138-7 |

   They are used in place only. Never copy them into a worktree, commit them or quote them, and never put a run of four or more of their words in anything you write. Refer to them only as P1–P6.
2. **The tools.** Copy `docs/reading-helper-abc/p12-tools/` to your scratch and fill its placeholders, as its `README.md` says.
3. **The verify tree V.** Make it with `git worktree add --detach <V> <head>`, then `cp -al web/node_modules <V>/web/node_modules`. If a build there fails on fonts, the `node_modules` links are stale: remove them and copy again.
4. **Servers.**
   - Never run `npm run dev`. Use `env -u PEER_TEST_GEMINI_API_KEY npx next dev -p <port>` from a worktree's `web/`.
   - Stop only your own process group.
   - Delete `web/.next` afterwards.
   - Chromium is pre-installed with Playwright.
5. **The key, only if Peter gives it.** It goes in your environment as the secret `PEER_TEST_GEMINI_API_KEY`.
   - It reaches the app only as a reader's own key, typed into the Profile form by Playwright (BYOK).
   - It is never a server variable, and is never printed, logged, committed or screenshotted.
   - A 429, quota or billing answer stops the run at once.

## 3. What is left, in order

**Step 1. Theme B round 5: A P12-96, a new A.**
- Brief: `docs/reading-helper-abc/briefs/P12-96.md`.
- **Walk the current branch head**, not `a6c0761b`: C P12-97 has landed since, so tell the A that in its spawn message.
- The old partial walk lived in the old session's scratch and is lost. Start fresh with the harness in `p12-tools/walk/`.
- From this round, **§1h.484** applies: B1's W3 cell needs an outward margin drag of at least 32 px. C P12-95 gives 66 px.
- §1h.487 applies: the W3 text column of 468 px is the ruled width.
- Expected: 12/12 on each paper with E2 0.25, which is **97.92 ×3**, unless the walk finds something new.

**Step 2. Two blind readers, B5-r1 and B5-r2**, one at a time beside other work.
- Brief: `briefs/P12-R2-reader.md`; spawn text: `p12-tools/readers/spawn-B.txt` (it says round 4: change it to round 5, and point it at the new pack and head).
- The score of record is the readers' median.
- As director, check every mark the readers disagree on against the raw evidence.
- If P1, P2 and P3 are all ≥ 97.25, **Theme B is DONE (two consecutive rounds)**.
- If a reader charges something new, cluster it by mechanism, brief a C, verify the C yourself (an own mutation per rule, the full gates), land it, and walk round 6.

**Step 3. The C1 spot check after C P12-97: A P12-57 phase 9.**
- Brief section: `briefs/P12-57.md`, "Phase 9 (§1h.491)".
- Run P3, P4, P5 and P6 × 2 each with the key and `p12-tools/c1/`.
- Score with `p12-tools/manager/score-structure.py c1 <P> <dumps>`.
- **37 calls are left of the manager's ceiling of 280.** That ceiling was the manager's own guard, not the owner's.
- A damaged run (any part wrong) reopens C1.
- **If Peter does not give the key,** record by ruling that C1 stands on the pre-C P12-97 tree, with the spot check pending a key, and tell him.

**Step 4. The end.**
- When steps 1–3 are clean, write the end ruling: every theme met the stop line in two consecutive rounds.
- Update `HANDOFF-P12.md` §5, `P12-RUBRIC.md` and `P12-PROGRESS.md`, which takes Chinese rows for the owner.
- Push, and tell Peter in Chinese with the numbers. The loop's end is the manager's measure; **his own look at the surface is the acceptance above it.**
- After the end, fix only small named items from the last round. Start no new feature without him.
- **Do not merge PR #37.**

## 4. The standing rules (from the owner and the rulings; none may be relaxed)

**Git**
- Commit on `update-on-paper-digest` only. Never create a branch without Peter's approval.
- Never push to `main`, and never merge PR #37 without his word.
- Never force-push, rebase or amend. Never run `git checkout -- <file>`, `git restore` or `git reset`.
- Workers commit in their own detached worktrees, never push and never branch. The manager cherry-picks.
- A worker that commits its deliverable in several parts: cherry-pick every part, from the worker's base onward.

**Working mode** (workaholic mode, owner's limit §1h.443)
- **At most two subagents at a time.**
- Roles: A reviews, B investigates, C implements, and blind readers score.
- The manager verifies every C itself, in V:
  - one own mutation per rule, which turns its test red and is then restored byte-identical by sha256;
  - the full gates;
  - only then a cherry-pick onto the branch.
- Workers' models are never larger than the manager's.

**Tests**
- Never delete, skip or weaken a test. Name every re-aimed test, with its reason.
- Add no new dependency.

**Secrets and privacy**
- Never print, log or commit a credential.
- Put nothing per-user in shared state.

**The container may restart.** Make every worker commit early and often. After a restart, resume workers from their worktrees by message.

**Rulings**
- A policy question gets a numbered, dated ruling in `ABC-DEEP-REPORT-READING-HELPER.md`.
- The rubric changes only by a dated amendment.
- A blind reader is never told the director's reading or the diff.

**Commit trailer** (the attribution reminder of your own session wins). The old session used:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <your session link>
```

**The hourly resume clock** (`trig_01MkdKP21BdT8TbcyZpB4umB`) is on Peter's account and is **disabled**. Set up your own only if he asks.

## 5. Known open items, not on the stop line

- **The notes tab's hit area is 18 px**, under WCAG's 24 px. Reported to Peter; widening it costs about one character a line at W3. His call.
- **Unpriced observations** O3–O13 (A P12-92 §4):
  - **O12:** P2's reading place drifts 29 px after W1→W4→W1.
  - The answers control's dark fill is 2.89 : 1, with a visible border.
- **Text-pipeline residue after C P12-97:** formula fragments, and a few short runs in reading order. B P12-93 lists the options it did not build: R-Box (the engine's boxes as a pre-pass), R-C, and runs of two.
- **Backlog:**
  - the O8 phone row return;
  - P5's Extended Data 26-character caption;
  - `move_start` one-paragraph parts;
  - the W4 toolbar wrap;
  - the `model` / `validation` words (§1h.450).
