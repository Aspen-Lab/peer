# <CAMPAIGN NAME> — the rubric

Target: **every theme ≥ <N> % in two consecutive rounds** (the user's number, given at invocation). Measured the same way every round, by the same director (the manager, reading as the demanding user), on the same input (<the user's own input, named; never committed>), from a fresh render at the branch head.

## Theme 1 — <the content>

Unit: <a paragraph / a section / a record>. Count: <n> (round 1).

| kind | what it is | cost per unit |
|---|---|---|
| A | <e.g. a unit torn or fused with another> | 1.0 |
| B | <e.g. a reference or number glued to a word> | 0.5 |
| C | <e.g. a symbol or script flattened where it could be kept> | 0.25 |

Score = `100 × (1 − Σ cost / Σ units)`, a unit's cost capped at 1.0. A mark is voided when the input itself prints what was marked (the director checks the raw input).

Pass requirements beside the score: <every section present in order; nothing fabricated; nothing per-user in shared state>.

## Theme 2 — <the features around it>

Unit: a feature from the frozen feature list (`F01 … Fnn`), each PASS (1) or FAIL (0). Extras the walk finds are deductions by kind: <a control over the user's words / a state the user cannot use / an order that hides the content> 1.0; <a misleading wrap, separator, label, count> 0.5; a cosmetic 0.25.

Score = `100 × (Σ pass − Σ deductions) / N features`, floored at 0.

## Each round

1. The manager lands the round's items; the branch head is the round's code.
2. A fresh render at that head on the same input; screenshots at every width and theme that matters.
3. The director reads the whole render; <n> blind readers score it independently; the score of record is the readers' median, the director's reading beside it; marks the input voids are listed.
4. Defects clustered by mechanism → B where the cause is unknown → C items in parallel → the manager verifies and lands.
5. Both scores recorded here and in `STATE.md` §4 with the branch head; the user gets the numbers and the list.

## Scores

| round | head | Theme 1 (readers' median / director) | Theme 2 | notes |
|---|---|---|---|---|
| 1 | <sha> | | | |

The user's own look at the surface is the acceptance above this rubric.
