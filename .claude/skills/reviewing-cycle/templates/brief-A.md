# <ROUND>-W — A: round <n>'s walk of <the surface> — <the feature list> re-walked, the earlier extras re-checked, the user's answers checked on the surface, the score by the rubric

Role: A, the reviewer — **read-only on production code**. Model: <worker model>. Worktree of your own, detached from `origin/<branch>` (the head must contain this brief and the checkpoints of <items>). You commit **only your deliverable** `<dir>/<ROUND>-W-A-<UTC timestamp>.md` in the worktree; never push, never branch; never touch the main checkout. No model (the stub), no network beyond localhost, no key value. Port <n> only. Start any server with `setsid` and stop it by its process group at the end.

Read first: `RUBRIC.md`; the last round's deliverable whole (the tables, the score and its arithmetic, "For the manager"); the checkpoints of the items landed since; the rulings since; the harness scripts of the last round (copy, never edit there).

## The walk (all output under `<scratch>/<round>/` only; the user's input is never copied, committed or quoted beyond one fragment per defect)

1. A fresh stubbed server from your worktree; the user's input through the real UI; the surface at every width and theme that matters, with and without the optional inputs.
2. **Every feature of the list**: PASS / FAIL as its line says, at its width, one line of evidence, a screenshot where a layout is judged — the same ids every round so the rounds compare.
3. **Every earlier extra**: GONE / STILL / CHANGED with the measurement and the item that claimed it.
4. **The user's own answers** checked on the surface, each with a number.
5. **New extras** by the rubric's kinds, each with a screenshot and a measurement.
6. **The score** with its arithmetic, a sensitivity line, and what is not reproducible or the environment's (outside the score).

## The deliverable

The head (hash); the tables; the checks; the new extras (kind, cost, evidence, shot name); the score; "For the manager" — the next items by mechanism, and any ruling that would change the arithmetic. Report in one paragraph: the head, the pass count, the extras' outcomes, the checks, the new extras, the score.
