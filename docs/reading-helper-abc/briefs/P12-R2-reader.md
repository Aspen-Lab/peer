# P12 round 2 — a blind reader's brief (the same brief for every reader of both themes)

Role: a blind reader, the fourth role of the reviewing cycle. **Read-only.** You score **one theme** of round 2 from its evidence pack against the rubric, and nothing else. You know nothing of the other readers, of the reviewer who made the pack, of the code, or of any earlier score; do not look for them. Do not open the repository's other files, the state file, any `*-A-*.md` walk or checkpoint, or anything in the scratchpad except the pack you are given. Do not contact another agent. Write only your own output file, named in the spawn message.

Read, at the commit named in the spawn message:
1. `docs/reading-helper-abc/P12-RUBRIC.md` **whole, including the amendments**: the stop line 97.25 (§1h.419), **the finite evidence matrix** at the end (§1h.420) and the dev-server environment (§1h.421). Your theme's 12 units, the pass requirements, the prices (1.0 / 0.5 / 0.25 by kind) and the formula.
2. `docs/reading-helper-abc/P12-OWNER-2026-10-23.md` — the owner's words (the spec).
3. The pack named in the spawn message: its `index.md`, then **the screenshots, DOM dumps and measurements it cites** — open them. Judge each unit by what the evidence shows, not by what a line claims; when a line and its evidence disagree, the evidence wins.

How to judge: a unit is PASS when every cell of its matrix (§1h.420) has evidence that it passes; a cell with no evidence is **FAIL (evidence)** — name the missing cell. Do not demand cells beyond the matrix. A defect the evidence shows anywhere (in or out of the matrix) is an extra by its kind, once per mechanism; never charge one mechanism both as a unit's FAIL and as an extra on that unit. The standing readings apply as the rubric states them (justified word spacing is not costed; the selection group over an open card's body words is the accepted 0.25 only while it covers no control or header word). The model stub's canned answers and the dev server's development badge are not defects.

## Your output (one Markdown file at the path in the spawn message)

- **The pass requirements**: hold / fail, each with the evidence you read (a failed one makes the theme 0).
- **Each unit**: PASS / FAIL with one line naming the evidence that decided it (and the missing cells for FAIL (evidence)).
- **Extras**: each with its kind, price and evidence.
- **The score**: `max(0, 100 × (Σ PASS − Σ extras) / 12)` with the arithmetic, two decimals, compared unrounded with 97.25; the score before a pass-requirement override if one applies; and one line of sensitivity (one more 0.25).
- No quotation of the paper and no run of four of its words; refer to evidence files and numbers instead.

Report in one paragraph to the manager: your score, your FAIL units, your extras, your output path.
