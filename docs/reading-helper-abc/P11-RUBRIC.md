# P11 — the owner's requests of 2026-10-19: the rubric

The owner's requests (`P11-OWNER-2026-10-19.md`, verbatim, rulings §1h.111–§1h.113) are the spec of round P11. The owner's order: the `reviewing-cycle` and `abc` skills — Opus the manager, Sonnet every worker, every group in parallel, the hourly Haiku resume clock on, **every theme ≥ 99 in two consecutive rounds** (§1h.111 (b)). Measured the same way every round: a fresh stubbed server at the branch head, the owner's PDF uploaded through the real UI (never copied, quoted or committed) and an invented PDF, light and dark, no key then the stub key.

Two themes, each a list of **units** taken from the owner's numbered items. A unit is PASS (1) or FAIL (0) as its line says; a PASS needs the thing to work on the walk, not to exist in the code. **Extras** the walk finds are deductions by kind: a control over the reader's words, a card the reader cannot use or that covers the paper's words, a crash or an error view, an order that hides the content — 1.0 each; a wrap, a separator, a label, a count that misleads — 0.5; a cosmetic — 0.25.

Score = `100 × (Σ pass − Σ deductions) / N units`, floored at 0.

**Pass requirements beside the score** (a failure here is the theme at 0 whatever the arithmetic): no React error overlay and no "This view hit a snag" view anywhere in the walk; Tier 0 complete without a key (a locked block is hidden, never shown broken); nothing per-user (a question, a note, a highlight, a passage, a key) in the shared reading cache, a server log line, a fixture or a checkpoint; the paper's text never hidden, collapsed, greyed or reordered by a route; P10's rubric units (`P10-RUBRIC.md` A1–A15, B1–B16) still PASS except where P11 amends them (A8: the map is in the left pane — Theme A A6 here; B3 and B4: the selection's actions stand in the margin — Theme B B2 here; B5 and B6: the cards stack in the margin — Theme B B5 here); the P9 feature list F01–F24 as amended by P10.

Widths: the three panes are scored at **1280 × 720, 1366 × 768, 1440 × 900** (the owner's laptop) and **1920 × 1080**, plus **1024 × 768** and 1366 at browser zoom **110 % / 125 %** (emulated as 1242 / 1093 css px) where a unit names a width; 390 × 844 is recorded, not scored.

## Theme A — the three panes and the way back (items 2, 6, 3)

| unit | item | PASS when |
|---|---|---|
| A1 | 2 | From 1024 css px the paper page is three panes — left (the title, the commands, the Summary / Paper digestion strip, the map), centre (the question bar and the answers at its top, then the paper's text), right (the margin) — at every scored width; below 1024 the one column as before |
| A2 | 2 | The left pane collapses to a narrow rail and can be pinned: a control in the pane collapses it; on the rail a short hover peeks at it without moving the text; a press pins it; the choice survives a reload; on a first visit it is pinned where it fits |
| A3 | 2 | The boundary between the left pane and the centre is dragged with the mouse (and moved with the arrow keys when focused): the centre re-flows, its minimum and maximum hold, the width survives a reload |
| A4 | 2 | The boundary between the centre and the margin likewise |
| A5 | 2 | The text re-flows and **never changes size**: the paper's computed font size is identical before and after every drag, collapse and pin; no horizontal scroll at any width ≥ 1024, at the minimum widths too; Fit's zoom is not changed by a drag |
| A6 | 6 | In Paper digestion and in the Summary the map is in the left pane and **on screen on arrival** (no scroll) on the owner's paper at 1280 × 720, 1366 × 768 and 1440 × 900; it scrolls inside the pane when taller; it stays in view while the centre scrolls; a row press lands its heading at y 80 |
| A7 | 2 | The title, the commands and the strip stay in view in the left pane while it is pinned and the centre scrolls; a tab switch, a collapse or a drag never remounts the question field or the map (typed text and open rows survive) |
| A8 | 2 | The words never move when a card opens or closes: the centre's text x and width identical before and after Explain this, Take notes and a figure open (was −184 px at 1440) |
| A9 | 3 | "Open your notes" from a paper → the notes page's top-left button reads "Back to paper"; pressing it returns to that paper on the tab the reader left (Summary or Paper digestion) |
| A10 | 3 | …at the place the reader left (the same paragraph at the top of the view, ±1 line), both tabs; the notes page opened from Saved reads "Saved" and goes to Saved; a later visit to the paper opens normally |
| A11 | 2 | Keyboard and screen reader: each boundary is reachable by Tab (`role="separator"`, its value announced) and moves with the arrows; the rail's control is named; Escape closes a peek; the DOM order is the visual order |
| A12 | 2 | Light and dark: the panes, the boundaries, the rail and the peek use the theme's colours and are legible in both (a screenshot per theme at each scored width) |

## Theme B — the margin: actions, cards, highlights, figures (items 5, 8, 1, 4)

| unit | item | PASS when |
|---|---|---|
| B1 | 5 | On opening the report and with nothing selected the margin is **completely empty**: no explain window, no empty-state text, nothing reserved — at every scored width and zoom |
| B2 | 5, 8 | A selection in the paper shows **three small buttons — Explain this, Take notes, Highlight — in the right margin, level with the selection's first line** (its top within ±8 px of the line's top); they go when the selection goes; a press acts on that selection. Without a key, Explain this is offered only where the page can explain (the paper's own definition) — Take notes and Highlight always |
| B3 | 5 | Explain this opens the explain card in the margin level with the selection (P10 8.4–8.5: the large highlighted X, the follow-up questions); the card stays inside the margin |
| B4 | 5 | Take notes opens a sticky note in the margin level with the selection; the passage gets its mark and `[n]` tag; the note is saved into the paper's overall note (P10 7.1) |
| B5 | 1, 5 | With a figure, a sticky note and Explain this open together they **stack as cards** in the margin: one forward and whole, the others' headers visible; a header press brings that card forward; each X closes its own card |
| B6 | 8 | Highlight marks the selected words — default bright yellow with black words — and the highlight is a record of the paper's overall note (the notes window and `/notes/<id>`), showing its words |
| B7 | 8 | A highlight's colour can be changed (the presets) from the margin and from the notes; on every preset the words are black or white with contrast **≥ 4.5:1**, light and dark (measured) |
| B8 | 8 | A highlight survives a reload, can be removed, and its words are in every export (txt, md, Word, PDF, copy) |
| B9 | 1 | In Paper digestion a left click on any body figure opens it **in the margin, filling the margin**, with an X at the top right; the X and Escape close it; the Summary's figures keep their lightbox |
| B10 | 1 | In the margin the figure zooms in and out (buttons and the wheel, up to 6x), drags to pan, and resets to fit; its caption is readable (scrolling) |
| B11 | 4 | No "Maximum update depth" and no error view across the walk's margin actions, including 30 open / close / resize cycles at 1280, 1366 and 1440, zoom 100 / 110 / 125 %, Fit on and off |
| B12 | 5, 8 | Keys: `e` explains, `n` takes notes, `h` highlights the current selection, and none acts with nothing selected; at 390 the thumb bar offers Explain this and Highlight while a selection is on offer |

## Each round

1. The manager lands the round's items; the branch head is the round's code.
2. The reviewer (A, on Sonnet, reading as a PhD student who wrote the paper and reads it in Peer) walks the surface at the head: every unit PASS / FAIL with one line of evidence and a screenshot; every extra costed; every earlier extra GONE / STILL / CHANGED; both scores with their arithmetic and a sensitivity line; a fresh evidence pack.
3. The manager reads the whole walk as the director; three blind readers score the same pack against this rubric independently; the score of record is the median of the three readers, A's and the director's readings beside it; the director checks every disagreement against the evidence.
4. Defects clustered by mechanism → B where the cause is unknown → C items in parallel → the manager verifies (gates, the touched tests ×3, one own mutation restored byte-identical) and lands.
5. Both scores recorded here and in the state file with the head; the owner gets the numbers, what changed, what is left, and the decisions only they can make.

Stop: every theme ≥ **99** in two consecutive rounds (§1h.111 (b)); a theme that reaches it twice stops being walked, and a later item that touches its files gets A's re-check of the lines it could move (as P10's §1h.100). The loop's end is the manager's measure; the owner's own look at the surface is the acceptance above it.

## Scores

| round | head | Theme A (three panes, the way back) | Theme B (the margin) | notes |
|---|---|---|---|---|
| 1 | 2d7a89b9 | **81.25** (median of the readers 81.25 / 83.3 / 81.25; A 87.5; director 81.25) — A7 FAIL on a briefing paper; extras: the map's meta wrap 0.5, the pane's step at the foot 0.25, the Day button pressed in a dark OS 0.25, the blank band after keyboard focus 0.25 | (walk running) | §1h.120, §1h.121 |
