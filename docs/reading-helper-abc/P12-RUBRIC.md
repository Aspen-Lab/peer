# P12 — the note, the margin and the controls: frozen rubric

Frozen 2026-10-23 by ruling §1h.184, before any round-1 brief. Spec: `P12-OWNER-2026-10-23.md` (the owner's nine items and binding reading), `HANDOFF-P12.md` §4. Pattern: repository reviewing-cycle template and P11 rubric. A later change requires a dated numbered ruling, both old and new scores where applicable, and notification to the owner.

**Target: every theme ≥97.9 in two consecutive rounds; each theme may carry at most one extra priced 0.25 per round.**

> **Amended 2026-10-27 by §1h.419: every theme ≥ 97.25 (unrounded) in two consecutive scored rounds** (replaces the line above; one 0.25 extra on 12 PASS units = 97.92 passes, two 0.25 or one 0.5 = 95.83 fails). **Evidence scope amended by §1h.420** — see the section at the end of this file. Both consecutive counts start at zero. The owner controls the stop line. No FAIL unit, missing evidence, 0.5 extra, or failed pass requirement can count as a pass.

Two themes, **12 units each**. Each unit is PASS (1) only when the fresh real-page walk supplies the required evidence; otherwise FAIL (0). An unperformed or blocked check is not inferred from code and cannot be marked PASS.

| Extra kind | What the evidence shows | Cost |
|---|---|---|
| Unusable or hidden | A control over the paper's words; a card or action the reader cannot use; an error view/crash; an order hiding content | 1.0 |
| Misleading | A wrap, separator, label or count that misleads | 0.5 |
| Cosmetic | A visible cosmetic defect without the higher-kind consequences | 0.25 |

Score = `max(0, 100 × (Σ PASS − Σ extras) / 12)`. Show two decimals, compare the unrounded number with 97.9. Do not double-charge the same mechanism as both a FAIL and an extra on that unit; distinct mechanisms remain distinct. Never change a price to fit the line. With all 12 units PASS, one 0.25 extra gives 97.916666…; two give 95.833333…; one 0.5 also gives 95.833333… .

**Standing readings:** justified prose remains justified; its word spacing is not costed (§1h.134 / §1h.143), but overflow or hidden text is. The selection group over an open card's body words remains the accepted 0.25 cost (§1h.168), only while it covers no control or header word and goes away with the selection. A tallied observation is required each round, by card kind, for the group and colour strip, including zero. Re-list exclusions by name; none is silently removed from the denominator. The existing accepted-cost threshold remains: a median price ≥0.5, or a second extra leaving this standing cost as the sole obstacle, authorizes investigation of a safer placement rule.

## Inputs and reproducible render

Use the same input set in each scored round: the owner's supplied attachment (private original path supplied outside Git, uploaded only through the real UI), two fixed public arXiv PDFs chosen and identified by public URL in the first investigation, and an invented stress PDF. Real inputs are reported individually, not averaged. The invented fixture keeps comparisons repeatable; it never substitutes for the three real papers. Workers implementing changes use invented input only. The model stub in `harness/model-stub.cjs` answers optional model paths; no live model or real key is used. First a new profile without a key, then a stub-only profile. Name private probes by purpose, never by their value.

Fresh worktree/server at a named commit; Chromium only (state this limit in deliverables). Wait for 300 ms of still scroll before every measurement and screenshot. Record timings and machine load where meaningful. Evidence must come through the app's upload path; direct function probes are separately labelled and cannot close a page unit.

The width/zoom investigation covers **1280×720, 1366×768, 1440×900, 1920×1080 at 100%, 110%, 125%, 150%** on the production build and the deployed site. Identify the deployed site's served revision where available; unavailable access or revision is recorded as unresolved, never proof of an old deployment. For layout checks, a zoom cell uses CSS viewport dimensions `round(screen width / zoom)` and `round(screen height / zoom)`; list these dimensions explicitly and label emulation. Also check 1024×768, 768×1024 and 390×844. The manager's measurement-backed width ruling determines the pane/one-column contract for B1/B2; until it exists these units cannot be closed. All widths still serve selections and figure clicks. Test the complete set of reading-scale steps exposed by the app, light and dark; enumerate the values in the pack. Check real browser zoom separately if a behavior depends on something viewport emulation does not reproduce.

## Theme A — the note (owner items 1, 2, 7)

| Unit | Item | PASS when |
|---|---|---|
| A1 | 1 | Every sticky card shows the same complete formatting row as the existing notes window (including its Highlight, Code, Heading and Numbered list controls), plus bullets and indent/outdent; no existing formatting capability is silently dropped. No clipped or unreachable control at the served widths and reading-scale steps. |
| A2 | 1 | Bold, italic and underline each work on selected text, survive Save, reopening and reload, and remain represented in the note. |
| A3 | 1 | Bullet list creation/toggle works; Enter in an empty bullet leaves the list without losing text; ordinary paragraphs still work. |
| A4 | 1 | Indent and outdent buttons work; Tab / Shift+Tab inside a list item indent/outdent with bounded nesting, no focus trap or lost words. |
| A5 | 1 | Structure survives the note record and every existing export route: Markdown uses `- ` with two-space nesting; Obsidian, text/copy, Word/PDF as available, the notes page and Open your notes retain the intended hierarchy and formatting their format supports. A sticky's source quotation remains outside exports; highlight words remain exported. |
| A6 | 2 | On the notes page and notes window the blue square aligns to the first text line's content area (top-aligned or centred by measured ruling), regardless of row height; evidence includes long/multiline rows at every step. |
| A7 | 2 | The square's side equals that row text's computed font size (1em, ≤1 CSS px rounding tolerance) at every reading-scale step, light/dark, notes page/window; it never scales with total row height. |
| A8 | 7 | Save is at the sticky card's top right, keyboard reachable and labelled; it retains exactly that note in Open your notes and closes the card with a brief nonmodal confirmation. Saving again never duplicates it. |
| A9 | 7 | Delete is beside Save, keyboard reachable and labelled; it removes exactly that note from the paper's notes and closes the card without a confirmation dialog; any undo toast is calm and optional. |
| A10 | 7 | Escape retains the old X behavior, measured before implementation and explicitly named in the checkpoint; outside press, navigation, reload, other cards' close paths, and highlight-made note rows retain their measured contracts except for the owner's explicit Save/Delete change. |
| A11 | 1,7 | Every new control has a meaningful accessible name, visible focus and keyboard access; selection survives a formatting-button press; list keyboard actions and escape routes work; toolbar semantics do not trap focus. |
| A12 | 1,2,7 | All above operate in light/dark, at every reading step and served width, without overlap, lost text, error view or per-user shared state. |

## Theme B — the margin and the controls (owner items 3, 4, 5, 6, 8, 9)

| Unit | Item | PASS when |
|---|---|---|
| B1 | 3 | The two pane dividers are visible at rest and draggable at all pane widths named by the measurement-backed ruling: a grip or ≥2px rule at ≥3:1 contrast, a col-resize cursor over the whole hit strip, hover/focus feedback; existing arrow-key resizing, floors and reflow remain. Production-build evidence, not dev alone. |
| B2 | 3 | The pane breakpoint and one-column fallback follow that ruling, with the measured tradeoff recorded (including a useful text measure near the product's ~60-character floor); the fallback retains access to selections, highlights, figures and notes. Narrowing then widening preserves reading place and active cards by the ruled design. |
| B3 | 4 | With Explain and a sticky open, the available margin height is initially split equally (≤2 CSS px rounding difference); both content areas scroll internally, no paper text moves. A single card retains its original selection-aligned behavior. |
| B4 | 4 | The boundary between two cards drags and has the same visible affordance as the pane dividers, horizontal resize semantics, minimum height per card (header plus one content row), and appropriate arrow keys. Ratios survive for the page session without per-user shared persistence. Closing a card redistributes freed space equally. |
| B5 | 4 | A third figure card gives three equal initial shares and two working boundaries; all orders of opening/closing work, their controls and content remain reachable, and minimums/session ratios hold. |
| B6 | 5 | On the production build, every drawable text selection offers Highlight plus the other applicable actions at every served width: body, headings/captions, Summary and answers, within and across paragraphs/blocks, all lengths. A cross-paragraph highlight produces per-paragraph marks grouped into one note row; reload, colour/remove and exports preserve it. Explain retains the route's existing bounded passage and Tier-0 availability rules. No button silently does nothing. |
| B7 | 6 | A real left click on every visible figure of each real paper, including Summary/inline figures, opens it in the margin at every served width on the production build. Zoom/pan/Fit, caption, focus, Escape and its close control work; no document-level pointer capture swallows a click. A blocked/unbound figure is reported, never assumed to work. |
| B8 | 8 | The answers disclosure keeps its triangle and open/closed behavior, matches the Introduction section-title computed font size at each reading step, uses an orange background and white text with ≥4.5:1 contrast, with readable light/dark hover and focus states. |
| B9 | 9 | Never submitted or edited since last submit: orange/white, Submit. Exactly equal to the last submitted text: grey, Submitted. Repeat click/Enter does not submit anew; new input restores Submit. Existing empty one-row and reflow/refit rules remain, including Enter settling. |
| B10 | 3,4,8,9 | Every new colour is measured in light/dark: text ≥4.5:1, new functional divider/control boundaries ≥3:1; labels, focus, hover, disabled/submitted states remain legible at every scale. |
| B11 | all | The P11 rubric A1–A12 and B1–B12 regression guard still passes through the real page, with only the explicit supersessions listed below; each guard line gets its own evidence. |
| B12 | all | No React overlay, snag or Maximum update depth across entry, selections, all card orders, repeated clicks, resize/close and at least 30 action cycles per relevant width/zoom; Tier 0 is complete without any key and optional stub paths degrade correctly. |

## Explicit P11 guard supersessions (§1h.184)

These follow the owner's P12 instructions; every other P11 rule remains. They are tested as new contracts, not excluded from the denominator.

- P11 A1: the 1024px breakpoint may change only after B's measurement and the manager's numbered ruling; no assumed narrower pane layout is pre-approved.
- P11 B3/B4/B5: one card stays selection-aligned; multiple cards use P12 equal initial shares and draggable boundaries rather than a foreground card with headers behind it. Multi-card sharing takes precedence over independently aligning each card to its selection.
- P11 B4/B5: sticky X becomes Save/Delete; Escape keeps the measured old X contract. Explain/figure controls keep their respective contracts.
- P11 B2/B6 and D5, P11-50, §1h.166(b): the cross-paragraph/block exclusion is superseded wherever marks can be drawn; one grouped note row represents the per-block marks. Existing caps and applicability of model-free Explain remain.
- P11 B9: the Summary lightbox exception is superseded by P12's binding reading: every visible figure opens in the margin, at every served width. B's measurement identifies the needed wiring and fallback, rather than silently retaining the old exception.

## Pass requirements for both themes

A failure makes the theme **0 regardless of arithmetic**, and its consecutive-pass count returns to zero:

1. No error overlay, snag or Maximum update depth in the checks; missing/blocked checks are named and leave the relevant gate open.
2. Complete Tier 0 with no key; a model enhancement cannot break the model-free reader.
3. No per-user question, note, highlight, passage or key in shared reading caches, source, fixtures, deliverables or logs. Privacy grep: probes named by purpose, never values; zero hits outside the owner's scoped upload store (any local compile artifact exception must be separately measured and ruled, never assumed).
4. The paper's words remain unchanged, visible in document order, never hidden/collapsed/greyed/reordered by a route. Compare body text/hash before/after actions; transient marks must not change its words.
5. P11 guard lines and inherited pass requirements hold except for the explicit supersessions, which must pass their new contracts. Retain P11's amended P10 A1–A15/B1–B16 and P9 F01–F24 guard chain; name each legacy guard and evidence rather than assuming it from a passing P11 row. If the old scratch-only feature inventory is unavailable, reconstruct it from the committed P9 rubric/reports and record its public source paths before the first walk.
6. No run of four or more consecutive words from the owner's paper in an evidence index, and no paper quotation in a deliverable. Screenshots/DOM evidence stay in private scratch outside Git. No owner PDF, uploads, .local-data, reader prose, or key is ever committed.

## Each round and evidence independence

1. Manager verifies every C in a separate free copy: entire diff, typecheck, lint (0 errors / ≤144 warnings), touched tests ×3, manager's own mutation red then byte-identical restore, full gates. Only then land by fast-forward of the verified combined head and record web-tree identity.
2. Two independent A agents walk the landed head, one theme each, concurrently as capacity allows. A is read-only on product code and supplies its own score separately from the evidence pack. The index gives observations and file references with **no score or verdict**.
3. Three fresh blind readers per theme get only this frozen rubric, the owner's file at the named commit, and that theme's evidence pack. Each opens the cited evidence, writes only its private output, marks absent evidence FAIL (evidence), and knows no previous score or other reader's marks. Median is the score of record; A's score and the manager/director's independent read sit beside it.
4. Director checks every disputed mark against evidence/raw input and records each void with the reason. Input-printed content or a measured harness artifact can void a mark; inconvenient prices cannot. Report the sensitivity of one extra 0.25.
5. Cluster findings by mechanism; B first when cause is unknown, C per disjoint file cluster in detached worktrees, A after substantial changes; manager alone edits state/rubric/briefs. Four runtime slots include the manager, so only three workers can be active at once; queued independent items retain distinct worktrees and start as a slot frees, without being combined. Blind readers remain separate agents even when queued.
6. Record every completed unit in HANDOFF-P12, its current-state block, P12-PROGRESS and the shared ledger/rulings; commit with explicit paths and push. A stop mid-unit gets PARTIAL first. A theme stops walks only after its second consecutive pass; later changes touching it require an A regression recheck.

The unmodified app baseline must be measured and its discrepancies explained before implementation; a failed baseline is never written as green. The preparation status and exact counts live in the state file, rather than becoming an assumed score here.

## Scores

| Round | App head | Theme A (readers' median / A / director) | Theme B (readers' median / A / director) | Pass runs A / B; notes |
|---|---|---|---|---|
| 1 | 82fe23db / web88ac6122 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0 / 0; common evidence gates unestablished; P12-R1-DIRECTOR-20261027.md |

The loop's end is the manager's measure; **the owner's own look at the surface is the acceptance above this rubric**. The final report follows P11-FINAL-REPORT.md and states in Chinese each theme's two scores, changes, open backlog, owner-only decisions and material evidence limits.


Dated clarification, ruling §1h.194 (2026-10-23): for B3–B5, multiple cards use a fixed labelled header with full quotation/content/controls inside each independently scrolling body. Actual header plus one content-row minimum includes padding/borders. When an unbounded number of existing cards cannot physically fit, one shared margin track scrolls vertically and retains equal initial shares at the largest required minimum; bodies remain mounted and reachable regardless of active state, with opening order stable. Record the score under the original simultaneous-fit reading alongside this clarification if an overcapacity case differs. No unit, price, stop threshold or pass requirement changes.

## Dated amendment, ruling §1h.420 (2026-10-27): the finite evidence matrix

**Why.** Under the frozen rubric's reading — every input × every width × every step × every action family, absent evidence = FAIL — both themes scored 0.00 in round 1 while not one unit failed on a defect: A24 charged "0.00 on the evidence available" and marked B1–B12 "FAIL (evidence)", A23 likewise A1–A12. A number that cannot move with the page cannot measure the owner's 97.25 bar. reviewing-cycle lets a rubric line be amended by a dated ruling when the old reading cannot be met by the input; both numbers are then recorded and the owner may restore the old line.

**What changes.** Only the evidence scope: each unit's "every …" is read as the finite matrix below. Unchanged: the units, the prices, the formula, the pass requirements, "an unperformed cell is FAIL (evidence)" **within** the matrix, and that **every defect observed anywhere — inside or outside the matrix — is costed** by its kind. While the old reading stays computable from a pack, the A records it beside the new score.

**Inputs (the same every round).** R1 the owner's PDF (the manager's scratch copy; never copied into a worktree, committed or quoted; upload UI only). R2 public A, arXiv 1706.03762v7 (15 pages; sha256 b7d72988fd81…; fetched from a public mirror because this environment's network policy refuses arxiv.org). R3 public B′, "Trace-based Just-in-Time Type Specialization for Dynamic Languages" (PLDI 2009; pdf.js's public demo file; 14 pages, two columns, figures and tables; sha256 3662ff519e48…) — it **replaces arXiv 1512.03385**, which this environment cannot fetch. S an invented stress PDF made by a script in the walk's scratch (its sha256 recorded by the first walk, the same file reused every round).

**Environment.** The production build (`npm run build` then `next start`) with the model stub; a profile with no key first, the stub profile for the model-optional paths; Chromium only (named in every deliverable). The deployed site is not required by any unit (its previews need a login); its served revision is recorded when reachable, otherwise "unresolved".

**The matrix.** Widths (CSS viewport): W1 1440×900; W2 1024×576 (a 1280×720 screen at 125 %); W3 853×480 (1280×720 at 150 %); W4 390×844. Reading steps: the smallest, the default and the largest the app offers (named in the pack). Light everywhere; dark at W1 default and W1 largest.
- **Core cells (every unit):** {R1, R2} × {W1, W2, W3} × default step × light.
- **Stress cells (every unit whose subject scales):** R1 × W1 × {smallest, largest} × light, and R1 × W1 × largest × dark.
- **Phone cells:** R1 × W4 × default, for every unit whose control the phone page offers.
- **Unit-specific:** A5 — one structured note (bold, italic, underline, a two-level bullet list) on R1 through every export route the app offers, the notes page and "Open your notes". A6 / A7 — the notes page and the notes window at every reading step, light and dark at default, a long multi-line row included. B6 — a selection inside a paragraph, across two paragraphs, in a heading or caption, in the Summary and in an answer, on R1 and R2 at W1, W2, W3 (inside a paragraph also at W4). B7 — every visible figure of R1, R2 and R3 at W1; every figure of R1 at W3; three figures of R1 at W4. B8 / B9 / B10 — every reading step at W1 light, the default step dark, W3 default. B11 — the P11 rubric's A1–A12 and B1–B12, one evidence line each on R1 at W1 (the P11 pattern); the P10 / P9 chains of pass requirement 5 are carried by the full test suite on the head together with these P11 lines, not walked ID by ID. B12 — 30 action cycles (open and close each card kind, select, highlight, resize a divider) at W1 and at W3 on R1, and the entry of all four inputs at W1. S is walked at W1 default for A1–A4, A8, A9, B3–B7.

The blind readers score from the pack against this matrix; the director voids a mark only on evidence (§1h.184's rules for voids unchanged).

**Environment amended by §1h.421 (2026-10-27):** the walks run on **the dev server with the model stub** (the Next CLI directly), because a local production server refuses every upload without a signed-in account and this environment cannot fetch arxiv.org; the production build is still built and gated at every landing. A unit's "production-build evidence" is read as this dev-server evidence; a defect only production could show is an evidence limit named to the owner.

## Dated amendment, ruling §1h.422 (2026-10-27): the owner's two papers; a score per paper

(a) **The Codex manager has stopped** (the owner's word); §1h.419 (a) is complete. No Codex writer remains on the branch.

(b) **The scored inputs are the owner's two papers**, replacing R1, R2, R3 and S of §1h.420: **P1** Lin et al. 2025 (10 pages; sha256 32d7e6b4c5c2face…) and **P2** Sederholm et al. 2026 (10 pages; sha256 0153251d92847dfd…). Both are the owner's supplied files: they enter only through the upload UI, are never copied into a worktree, committed or quoted, and no run of four of their words appears in an index or a deliverable. The earlier inputs (the owner's earlier paper, the two public papers, the invented PDF) leave the scoring; a C still tests on invented input only.

(c) **A score per paper.** Each theme is scored **separately on each paper**: its 12 units are judged on that paper's cells only, and an extra is charged to the paper whose evidence shows it (a mechanism shown on both papers is charged to both). Each round therefore gives four numbers — Theme A on P1, Theme A on P2, Theme B on P1, Theme B on P2 — each by the formula `max(0, 100 × (Σ PASS − Σ extras) / 12)`; the pass requirements are judged per paper (a failed one makes that paper's theme 0). **The loop ends when all four are ≥ 97.25 in two consecutive scored rounds.**

(d) **The matrix, per paper** (§1h.420's widths, steps and themes unchanged): core cells {W1, W2, W3} × default step × light; stress cells W1 × {smallest, largest} × light and W1 × largest × dark; phone cells W4 × default. Unit-specific, on each paper: A5 one structured note through every export route, the notes page and "Open your notes"; A6 / A7 that paper's note rows at every reading step, light and dark at default, a long multi-line row included; B6 the five selection kinds at W1, W2, W3 (inside a paragraph also at W4); B7 every visible figure at W1 and at W3, three figures at W4, each compared with its figure on the PDF page; B8–B10 every step at W1 light, default dark, W3 default; B11 the P11 guard lines A1–A12 and B1–B12 one evidence line each at W1; B12 30 action cycles at W1 and 30 at W3, and the paper's entry at W1 with no key.

(e) Round 2's walks P12-37 and P12-38 switch to P1 and P2 by the manager's message; their worktrees and ports stay.
