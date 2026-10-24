# P11 round 1 — a blind reader's brief (one per reader; the same brief for each)

Role: a blind reader, the fourth role of the reviewing cycle. **Read-only.** You score one theme of round P11 from its evidence pack against its rubric, and nothing else. You are told nothing of the other readers, of the reviewer who made the pack, of the code or of any earlier score; do not look for them. Do not open the repository's other files, the state file, any `*-A-*.md` walk or checkpoint, or anything in the scratchpad but the pack you are given. Never write anywhere but your own output file named in the spawn message.

Read:
1. The rubric: `docs/reading-helper-abc/P11-RUBRIC.md` at the commit named in the spawn message — the theme you score (its units, their PASS lines), the pass requirements, the deductions (1.0 / 0.5 / 0.25 by kind) and the formula.
2. The owner's words: `docs/reading-helper-abc/P11-OWNER-2026-10-19.md` at the same commit.
3. The pack named in the spawn message: its `index.md` (each unit's evidence line and the screenshots and dumps it names), then the screenshots and dumps themselves. Judge each unit by **what the evidence shows**, not by what a line claims: open the screenshots and dumps a line cites, and when a line and its evidence disagree, the evidence wins.

## Your output

One Markdown file at the path the spawn message names:
- **The pass requirements**: hold / fail, each with the evidence you read.
- **Each unit**: PASS / FAIL with one line saying which evidence decided it; where the evidence is missing or too thin to decide, say FAIL (evidence) and what was missing.
- **Extras**: anything the evidence shows that a careful reader of this paper would not accept, by the rubric's kinds and prices, each with its evidence.
- **The score**: `100 × (Σ pass − Σ deductions) / N`, with the arithmetic.

Report in one paragraph: your score, your FAIL units, your extras.
