# Round P9 — the reading-quality loop's rubric (§1a.17: "until a PhD student is 95% satisfied")

The owner's stop condition is a satisfaction, so it is measured the same way every round, by the same director (the manager, reading as a PhD student in the paper's field), on the same paper (the owner's 19-page PDF, private, never committed), from a fresh local server at the branch head, through the real upload. Two themes, two scores, both out of 100; the loop ends when **both are ≥ 95 in two consecutive rounds** (one round can be luck).

## Theme 1 — the digested paper's own content (the "Paper digestion" tab)

Score = the weighted share of the paper's **paragraphs that read as printed**. Every body paragraph of the rendered digestion (round 1: 81, plus the captions) is read against the PDF and marked with each defect kind it carries; a paragraph with no mark is clean. The score is `100 × (1 − Σ weight(defect) / Σ weight(paragraph))` where each paragraph weighs 1 and each defect kind found in it costs:

| Kind | What it is | Cost per paragraph |
|---|---|---|
| A | torn at a raised/lowered line start (a fragment paragraph, exponents or labels pulled out) | 1.0 |
| F | an equation torn into one-line paragraphs, or a sentence cut by an island | 1.0 (the whole island counts as one paragraph) |
| E | a caption or a stray block inside a sentence | 1.0 |
| B | a citation number fused into a word | 0.5 |
| C | a line-end hyphen joined or kept wrongly | 0.5 |
| H | a space lost or added at a join | 0.5 |
| D | a symbol folded to an ASCII word or sign (`degreesC`, `+/-`, `x 10`, `<=`, a `-` for the author's `−`) — **only where the PDF prints the symbol** (round 2, §1h.54 (a)): the director checks each D against the raw text layer; a word the authors typed themselves (`ohm.cm`, `Kalpha`, `2 theta`, `sigma`) is the paper's and costs nothing | 0.5 per paragraph, however many |
| G | a chemistry/variable sub- or superscript flattened **where Unicode could write it** (a digit subscript, `LiCoO2` for `LiCoO₂`; an exponent `cm2`), or mis-spaced / ambiguous (`f 0-4 μm` beside `f4-8 μm`, `I0 (hkl)`); a letter subscript Unicode cannot write, joined plain to its one-letter variable (`RCT`, `Eg`, `jmax`) or written `f(area)`, is the plain-text convention and costs 0 (round 2, §1h.54 (b)) | 0.25 |
| S | a structure fault: a section missing, out of order, mis-titled, a heading inside a paragraph, end matter in the body, column mixing | 1.0 per section |

A paragraph's cost is capped at 1.0. The director lists every marked paragraph by section and paragraph index with one word per kind (never a sentence of the paper beyond one per kind in the round's notes, scratch only). Round 1 as read by the manager: ~55; by the five blind readers 60 / 64 / 64 / 64 / 55. Round 2 (the head 5c49def0, Theme 1 landed) by the five blind readers under the table as it stood: 72.3 / 76.5 / 76.5 / 76.5 / 75.8, median **76.5** (F 3.0, H 5.0, G 6.5–6.75, D 0.5 of 65 units; without G 82–87); the director's check against the raw text layer voided the D (`ohm.cm`, `Kalpha`, `2 theta`, `sigma` are the authors' words) and found the real one (the minus sign folded by `clean.ts`) — the two amendments above date from that read. **Round 3** (the head 101ee14c — P9-13a / 13b / 14 / 15 / 16 landed, the version bump; render 06:45Z): the five blind readers 96.9 / 99.2 / 97.3 / 96.4 / 94.8, **median 96.9** — the first round at ≥ 95 (one more is needed, two consecutive); no A, B, D, E, F or S in any reader; the residuals H 0.5–1.5, G 0.5–1.0, C 0–1.5 per reader. Checked against the PDF's text layer: `MPam` (one run), `EIS(electrochemical` (one run), `(angle axis pair)` (the authors write it both ways), `{0001}crystal1` (one run), `preexisting` / `colocated` (one run each) are as printed and void; the one defect of ours is `DCod2+` (a raised `2+` after a raised run, not written as a superscript, G 0.25), with `TC101` (G 0.25, unconfirmed) — the director's reading after the check ≈ 99.

Also required for a pass, regardless of the score: the 12 (or 13 with the abstract, the owner's call) sections present in the paper's order; every figure caption present once, after the paragraph that first cites it or at the page's end; no author/affiliation/notes/reference block in the body; the map's paragraph openings whole sentences.

## Theme 2 — everything else (the features)

Score = the weighted pass share of the **feature list** (`scratchpad/p9/r1/features.json`'s F01–F24, amended as items land) plus the walk's **extras**: each feature is PASS (1) or FAIL (0); each extra found is a deduction by its kind — a control over the words, a window the reader cannot use, an order that hides the content (1.0 each); a wrap, a separator, a label, a count that misleads (0.5); a cosmetic (0.25). `100 × (Σ pass − Σ deductions) / N features`, floored at 0. Round 1: 22 / 24 PASS with 11 extras on the page (X1, X2, X3, X10, X11, X12, X13, X14 + F08, F18, X6) ≈ 73.

Each round the walk also records what is **not reproducible** (X1's merged questions) and what is **the environment's** (X4 the dev indicator, X17 the missing PyMuPDF), outside the score.

## The round

1. The manager verifies and lands the round's C items; the branch head is the round's code.
2. A fresh stubbed dev server from a detached worktree at that head; the owner's PDF uploaded through the real UI; the digestion rendered to `scratchpad/p9/r<n>/whole.txt` (scratch only) and the screenshots taken; the feature walk run.
3. The director reads the whole digestion as a PhD student (Theme 1) and walks the features (Theme 2); the blind readers (Sonnet, five, independent) score the same render; defects are clustered by mechanism.
4. Each cluster becomes a B (when the cause is not known) and then a C, in parallel worktrees on disjoint functions; the A review per group; the manager verifies and lands.
5. Both scores recorded in the state (§4) with the branch head; the owner gets the two numbers and the list per round.

The owner's own look at the page is the acceptance above the rubric: the owner compares before and after without telling which problems were seen (chat 17:0xZ 2026-10-11), so the rubric must catch what the owner would.
