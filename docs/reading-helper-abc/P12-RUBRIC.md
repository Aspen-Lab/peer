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

## Dated amendment, ruling §1h.423 (2026-10-27): P3; Theme C — the paper's structure; nine scores

(a) **P3 joins the scored inputs:** Zahiri et al. 2021 (11 pages; sha256 8d7ca92bb604ce6a…), the owner's supplied file under the same rules as P1 and P2 (§1h.422 (b)): upload UI only, never copied into a worktree, committed or quoted, no run of four of its words in an index or deliverable. Themes A and B are scored on P3 as on P1 and P2 (§1h.422 (c)–(d)).

(b) **Theme C — the paper's structure** (new; the owner's request). Does Peer tell, on its own, which part of a paper is the introduction, the methods / experiment, the results, the discussion / conclusion and the back matter — also when the headings do not say so (P3's journal prints descriptive headings and an unheaded introduction). Scored **per paper on P1, P2 and P3**, on the profile with **no key** (Tier 0), from the reading map at W1 1440×900, default step, light.
- **Units:** one per **part** of the paper as ruled by the manager from the PDF (the ground truth, below): the introduction (headed or not); each results section; the discussion and / or conclusion; the methods / experimental section; the back matter (references, acknowledgements, data and author statements) as one unit. N_p = the number of ruled parts of paper p.
- **PASS** when the map has a row that starts where the part starts (its first paragraph is the row's first paragraph; a part merged into another row or split across rows fails) **and** the role the page shows on that row is the ruled role — introduction → setup; methods / experimental → method; results → evidence; discussion, conclusion, limitations → interpretation; back matter → apparatus (the app's own five roles, `web/src/lib/papers/reading-map.ts`). A row with no role tag (`body`) for a part that has a ruled role is FAIL.
- **Extras:** a map row for something that is not a part of the paper (a caption, a running head, a journal or licence line) 0.5 (misleading); a sub-row whose role contradicts its part's 0.5; a role shown in words a reader would misread 0.25.
- **Score** per paper: `max(0, 100 × (Σ PASS − Σ extras) / N_p)`; the pass requirements of the rubric apply (Tier 0 above all).
- **Ground truth:** proposed by an independent read-only B (P12-40) from each PDF — the parts with their page, their first paragraph's locator, the proposed role and the PDF's own evidence for it — and **ruled by the manager before the first Theme C score**. The committed ruling names parts by ordinal, page and role only (no heading words); the full private list stays in the manager's scratch.

(c) **§1f.2's "no positional guessing" is superseded** for parts whose heading names no role: the owner now asks Peer to work the role out itself. The role must still come **from the document's own evidence** (where the part stands relative to parts the page can name, such as the methods and the references; the unheaded text before the first heading; the paper's own signposting), never from a model in Tier 0. Whether the page marks an inferred role differently from a named one is a design question the B answers with candidates and the manager rules.

(d) **The stop line now has nine scores:** Theme A, Theme B and Theme C, each on P1, P2 and P3 — **all nine ≥ 97.25 in two consecutive scored rounds**. Round 2's walks P12-37 / P12-38 add P3 by the manager's message; Theme C is first scored in round 2 if its ground truth is ruled in time, otherwise from round 3.

## Dated amendment, ruling §1h.424 (2026-10-27): no inferred mark; C0 / C1; P4–P6 held out

(a) **No "inferred" mark.** An inferred role is shown exactly like a named one (the owner's "先不标").

(b) **With a key, the structure must be right — the rules save tokens, the model checks.** Tier 1 adds a **structure review**: the rules (Tier 0) produce the parts, their roles and, per part, a confidence and the evidence used; with a key, the model receives **a compact skeleton, not the paper** — the headings, each paragraph's position and short head, and per paragraph the counts the rules use (figure and table references, citations, numbers with units, procedural wording) — together with the rules' draft, and returns **only corrections** in a fixed schema (a part's start moved to an existing paragraph index; a role from the five). Requirements: the answer is validated (schema, indices in range, roles from the set) and an invalid or failed answer leaves the rules' draft in place (Tier 0 never breaks); a disputed part may get a second, targeted look at that part's text only; the reviewed structure is cached per paper version (private for uploads) so a paper is reviewed once; where the reading pipeline already sends the paper to the model, the review rides on that call if it saves tokens. The token cost is measured against sending the whole text and reported to the owner. B P12-40 adds this design to its report; a C builds it after the Tier-0 rules.

(c) **Scoring.** Theme C is scored **without a key** (C0: the rules, the rubric's formula, ≥ 97.25 per paper) and **with a key** (C1: every part right and no extra — 100 % — per paper, the owner's "100%准确"). The model stub cannot judge a paper's structure, so **C1 can be measured only with a real model key supplied by the owner for testing** (held in the test server's environment only; never printed, logged or committed); until then C1 is reported as unmeasured and is not yet part of the stop line.

(d) **Three more papers, for adaptation:** **P4** (Nature Communications 2026, 12 pages, sha256 bbd9677e67e0ca89…), **P5** (Nature 2024, 21 pages, 25.6 MB — just under the upload limit of 25 MiB, sha256 6ce63dc1cb39c37f…), **P6** (Nature 2026, 11 pages, sha256 bd234ebef830bf3c…); the owner's files under the same rules as P1–P3. To measure adaptation honestly they are a **held-out set**: the Tier-0 rules are developed on P1–P3 and invented fixtures only; once they land, P4–P6 are measured **first-sight** (that score is reported to the owner as the adaptation measure), and only then may they inform further rules. Theme C (C0) is scored on P4–P6 and joins the stop line; their figures are checked by the engine and defects are fixed, but Themes A and B are scored on P1–P3 only.

(e) **The stop line:** Themes A and B on P1–P3 (six scores) and Theme C0 on P1–P6 (six scores), all ≥ 97.25 in two consecutive scored rounds; C1 joins as 100 % per paper once a key is supplied.

## Dated amendment, ruling §1h.426 (2026-10-27): Theme C's ground truth for P1–P3

(a) **Theme C's ground truth for P1–P3 is B P12-40's §2, with these decisions:** P1 N = 5 (introduction, methods, results-and-discussion, conclusions, back matter); P2 N = 5 (introduction, results-and-discussion, conclusion, the experimental section after it, back matter); P3 N = 8 (the unheaded introduction, three results parts, the unheaded two-paragraph closing, back-matter block 1, Methods after the references, back-matter block 2). (1) **Back matter is one unit per contiguous block** — P3's two blocks are two units. (2) **Sub-numbered headings are sub-rows, not units**; a sub-row whose role contradicts its part's is the 0.5 extra. (3) P3's third results part (materials description plus a result) is **evidence**, by the paper's own order. (4) A mixed **results-and-discussion** part is **evidence**; a reader does not fail it for lacking interpretation. (5) **An unheaded row's label is the role's own label** (the label the model partition's rows already use). (6) The model partition's "Peer's reading" tag on its own rows is unchanged in this round (it marks Tier-2 rows, not Tier-0 inference; §1h.424 (a) concerns the latter). (7) **The first-paragraph test is strict.** The private list (heading words, locators) stays in the manager's scratch (`p12/b40/ground-truth-private.md`).

## Dated amendment, ruling §1h.427 (2026-10-27): the held-out papers' units

(a) **The held-out judgement calls are decided by §1h.426's principles, without the manager reading the per-part detail now:** back matter is one unit per contiguous block (a block split by the print order around the methods is two units); an unheaded closing is a unit with the interpretation role (as P3's); a disputed role follows the paper's own order. By the sealed file's counts this gives **N = 5 (P4), 9 (P5), 9 (P6)**; the manager opens the sealed file only at the first-sight measure, after the Tier-0 rules land, and records there any count the principles do not settle.

## Dated amendment, ruling §1h.430 (2026-10-27): C1 with the owner's test key

(a) **C1 is measured with the owner's test key already in the environment**, `PEER_TEST_GEMINI_API_KEY` (added 2026-10-11 for P9-KEY; checked 20:3xZ today: Google answers 200 with the model list, the key's value printed nowhere). The key enters the app only as a reader's own key (BYOK: the Profile form, filled by Playwright from the environment), never as a server variable, never printed, logged, written or screenshotted; a 429 / quota / billing answer stops the run at once.
(b) **C1 joins the stop line** once measured: per paper, with the key, every part right (start and role) and no extra — 100 % — on P1–P6, by B P12-42 §7's protocol (natural drafts, 5 runs; seeded drafts reported). P4–P6 are measured first-sight only after the Tier-0 rules land; their truth stays sealed and the manager scores them.
(c) **A P12-57 builds the keyed measuring harness now** (phase 1: the BYOK path end to end on P1 with today's keyed features), and runs the C1 arms when the manager says the structure review (C P12-53) and the Tier-0 rules have landed (phase 2, resumed by message).

## Dated amendment, ruling §1h.436 (d) (2026-10-28): a row's start through its sub-rows

**Scoring interpretation (not a relaxation):** a map row whose own paragraphs are empty because its text sits in its sub-rows (a numbered part over 2.1, 2.2 …) **starts where its first sub-row's first paragraph starts**; the manager's scorer reads it so.

## Scores of record — Theme C round 2 (§1h.453), head `4f6d6e67`

C0 (no key): P1 100, P2 100, P3 100, P4 100, P5 100, P6 100 (every part right, no extras). Consecutive rounds at the target: 1. C1: not yet measured.

## Scores of record — Theme A round 2 (§1h.454)

A P12-71 on `d44aeabb`; readers A-r1 and A-r2 (median): P1 95.83, P2 95.83 (below 97.25); P3 readers 97.92 / 95.83 (third reader skipped, the round's outcome is set). Consecutive rounds at the target: 0. Theme B round 2: A P12-72 walking `ccfa098b`.

## Scores of record — Theme C round 3 (§1h.458), head `25bca3b4`

C0 (no key): P1–P6 each 100 (maps identical to round 2's). Consecutive rounds at the target (C0): 2. C1 (with the key): not yet measured — A P12-57 phase 2.

## Scores of record — Theme B round 2 (§1h.459)

A P12-72 on `ccfa098b`: P1 95.83, P2 95.83, P3 83.33 (B7 FAIL on P3); below the target whatever the readers (P3 ≤ 91.67 with no extras), readers skipped. Consecutive rounds at the target: 0.

## Scores of record — Theme A round 3 (§1h.461)

A P12-78 on `e0a80fbf`; readers A3-r1 and A3-r2 (median, the third reader cannot change it): P1 97.92, P2 97.92, P3 97.92. Consecutive rounds at the target: 1.

## Scores of record — Theme C1 (§1h.464)

With the owner's test key (A P12-57 phase 2, 5 runs per paper, the product as built): P1, P2, P3, P4, P5 — 5 / 5 runs exact, 100 %; P6 — 4 / 5 (one run damaged a right part): **not 100 %**. 11 / 30 runs fell back (`unusable`).

## Scores of record — Theme A round 4 (§1h.470)

A P12-87 on `48d14081`; readers A4-r1 and A4-r2: P1 100, P2 100, P3 100. Consecutive rounds at the target: 2 — **Theme A has met the stop line.**

## Scores of record — Theme C round 4 (§1h.471)

C0 (no key) on `web/` tree 54f4b003: P1–P6 each 100. Consecutive rounds at the target (C0): 3. C1: phase 3 running.

## Scores — Theme C1 phase 3 (§1h.472)

P3 3 / 3, P4 3 / 3 (fallbacks), P6 4 / 5 (one damaged run): C1 not yet 100 % on P6.

## Scores of record — Theme B round 3 (§1h.474)

A P12-88 on `921dbd8b`; readers B3-r1 and B3-r2: P1 95.83, P2 95.83, P3 95.83 (E2 standing + E5). Consecutive rounds at the target: 0.

## Scores — Theme C1 phase 4 (§1h.477)

P6 4 / 5 (one damaged run, a set_role of the first results part), P4 2 / 2 (fallbacks): C1 not yet 100 % on P6.

## Scores — Theme C1 phase 5 (§1h.481)

P6 5 / 5 exact (3 reviewed, 2 all-refused fallbacks; no row moved), P4 1 / 1 exact (reviewed, 0 corrections). Consecutive passes toward the stop line: P3 2, P4 2+, P1 1, P2 1, P5 1, P6 1. The confirming round is phase 6 (P1–P6 × 5 on one head).

## Scores — Theme C1 phase 6 (§1h.482)

On `cf572402`: P1 5/5, P2 5/5, P3 5/5, P4 5/5, P5 2/5 (three damaged runs: M1 ×2, M2 ×1), P6 5/5. Consecutive passes: P1 2, P2 2, P3 3, P4 5, P5 0, P6 2 (lower bounds under C P12-94's subset). C1 waits on P5 only.

## Dated amendment, ruling §1h.484 (2026-10-29): B1 at W3 needs a useful range (the owner's O1)

From round 5, B1's W3 cell (853 × 480) passes only if an outward drag of the margin divider grows the margin by at least 32 px. Round 4 is scored by B1's letter, as before.

## Scores — Theme C1 phase 7 (§1h.485)

On `d657933e`: P5 5 / 5 exact. Consecutive passes: P1 2, P2 2, P3 3, P4 5, P5 1, P6 2. Phase 8 (P5 × 5) decides C1.
