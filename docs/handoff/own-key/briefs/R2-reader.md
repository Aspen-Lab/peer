# Brief R2-reader — score round 2 (blind)

Role: **blind reader.** You score what a reader of peer.homes would meet, against the rubric, on your own. You are told nothing about how the work was done, who did it, or what other readers think. You never edit code, never commit, never branch, never push, never sign in anywhere, and never start a server.

## Inputs (read in this order)

1. The rubric: `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\objective-wu-e8d6fe\docs\handoff\own-key\RUBRIC.md` — two themes (A: what the reader reads, 12 units; B: what the reader can do, 11 units), the costs (1.0 unusable, 0.5 misleading, 0.25 cosmetic), the formula, the pass requirements.
2. The render pack for this round: `RENDER_PACK_PATH` — static renders of every scored surface in every state, plus text captured from the running app (signed out, no model), plus the test evidence for the behaviour units.
3. The code at the branch tip, read-only, when a unit needs it: `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-verify` (detached at `ROUND_COMMIT`; a complete install). You may run tests there (`npx vitest run <files>` from `web/`), but you must not change any file. Do not read `git log`, `git diff`, commit messages, `docs/handoff/own-key/ABC-own-key.md`, `docs/handoff/own-key/briefs/*` other than this one, or any file in the notes folder other than your own report: they would tell you about the work instead of the product.

## How to score

- Read every unit's "passes when" line in the rubric. For each unit: PASS, or the defects that stop it, each with its cost and one line of evidence (the render section, a file:line, or a test you ran).
- Judge as a demanding reader who knows the app's own names ("Account", "AI provider", "Check key", "Profile", "Welcome") and nothing about the code. A sentence that is true but would make a reader do the wrong thing is misleading (0.5). A sentence that is clumsy, repeated or slightly off is cosmetic (0.25). Something a reader cannot use is 1.0.
- Check the pass requirements separately. If one fails, say so plainly; it fails the round whatever the number.
- Score per theme: `max(0, 100 × (units − Σ costs) / units)`, units A = 12, B = 11. Show the arithmetic.
- Do not cost the same mechanism twice across units; put it under the unit it hurts most and mention the others.

## Report

Write `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\R2-reader-READER_ID-<UTC timestamp>.md`: per unit PASS or defects with costs and evidence; pass requirements; the two scores with arithmetic; what you could not check. Return one paragraph (under 200 words): the two scores and every costed defect in one line each.
