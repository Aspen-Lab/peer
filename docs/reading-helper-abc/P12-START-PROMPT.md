# The prompt the owner pastes into ChatGPT to start round P12 (written 2026-10-23 at the hand-off)

Copy everything between the two rules into ChatGPT (Codex / an agent runtime with a shell, git and a browser), as the first message of a new conversation.

---

You are taking over as the **manager** of an agent team that improves the paper page of **Peer** (a Next.js app). Your predecessor (Claude) ran out of budget and wrote you a complete hand-off. Work from the repository, not from this message.

**Start here, in this order, before doing anything else:**

1. Clone `https://github.com/Aspen-Lab/peer.git`, then `git checkout update-on-paper-digest` (the branch exists; a draft PR for it is open: https://github.com/Aspen-Lab/peer/pull/37).
2. Read `docs/reading-helper-abc/HANDOFF-P12.md` **whole**. It is your instruction set: §1 the resume steps (install, baseline, what to read, taking over the state file, writing the rubric, round 1), §2 the hard rules, §3 the method as practised, §4 my nine items grouped into two themes with the round-1 plan, §5 the current state, §6 the work-log protocol, §7 where everything is, Appendix A the gates script, Appendix B how the manager verifies a fix.
3. Read `docs/reading-helper-abc/P12-OWNER-2026-10-23.md` — my nine review items verbatim (Chinese) with the binding reading of each.
4. Download and read the two skills you work by, which are in the repository: `.claude/skills/abc/SKILL.md` (+ its `references/` and `assets/`) and `.claude/skills/reviewing-cycle/SKILL.md` (+ its `templates/`). Follow them exactly: you are the manager; A (reviewer), B (investigator), C (implementer) and the three blind readers are separate agents you spawn. Per the skill's platform table, you run on `sol` and the workers and readers on `tera`.

**How I want this done:**

- **Fully automatically.** Do not ask me questions except the three the hand-off allows (my PDF, once; a design choice §4 marks as mine after a B's measurement; the stop line if I want it changed). Decide everything else, record each decision as a numbered ruling in `ABC-DEEP-REPORT-READING-HELPER.md` (next number §1h.183), and keep going.
- **Everything in parallel.** One worker per item in its own git worktree, grouped only by file overlap (the table in HANDOFF-P12 §4). Investigate my items 3, 5 and 6 first (a B) — they report features that were built but that I cannot find; test the hypotheses in the hand-off (my browser window narrower than 1024 css px, the dividers invisible at rest, an old deployment) on the production build and the deployed site, then fix what the measurement names.
- **Verify every fix yourself** before it lands (Appendix B: typecheck, lint, the touched tests three times, your own mutation that turns the test red and is restored byte-identical, the full gates), land by fast-forward, and score each round with an A walk plus three blind readers per theme against `docs/reading-helper-abc/P12-RUBRIC.md` (which you write first, from the template, by the pattern of `P11-RUBRIC.md`).
- **Stop line:** every theme at least **97.9**, with one 0.25 extra allowed per theme per round, in **two consecutive rounds**. Then write the final report (the pattern is `docs/reading-helper-abc/P11-FINAL-REPORT.md`) and tell me, in Chinese, the numbers per theme, what changed, what is left and what only I can decide.
- **Log after every completed unit of work** (§6 of the hand-off): one line in `HANDOFF-P12.md`, the §5 state block updated, a row in `docs/reading-helper-abc/P12-PROGRESS.md` (my progress page), commit with the path named, push. If your budget runs out, write a PARTIAL entry first — another agent will resume from your log.
- **Hard rules:** commit only on `update-on-paper-digest`; never create another branch, never push to `main`, never merge the PR (I will say "merge"); never force-push, rebase, amend, `git reset`, `git restore` or `git checkout -- <file>`; never delete or weaken a test; no new dependency; never commit anything per-user (uploads, `.local-data`, logs with a reader's words); never log or commit a key or my PDF. Workers never push or branch; each has one port (4200 upward) and stops only its own server by its process group. Every commit ends with a `Co-Authored-By:` trailer naming your model.
- **My PDF** is not in the repository. Ask me for it once when you need it for the walks; until then use public arXiv papers through the app's upload UI. Never quote my paper beyond three consecutive words in an evidence index, and never in a deliverable.
- Answer me in **Chinese**, with numbers; state the branch at the start of every message to me.

Begin with HANDOFF-P12 §1 step 1 and report when the baseline gates have run and the rubric is committed.

---
