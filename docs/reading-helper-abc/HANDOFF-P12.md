# HANDOFF-P12 — the reading helper (Peer), round P12 "update on paper digest": for the next manager (ChatGPT / Codex, or any agent)

Written 2026-10-23 by the P11 manager (Claude, cloud session `session_017DGPdGJqr95t3pMMcspXjE`) at the owner's request, because that session's budget is nearly spent. **Everything you need is in this repository; nothing is on the previous manager's machine.** Read §1, do its steps, and you are working within ten minutes. Then obey §6: **one log entry after every completed unit of work**, so the next agent after you can resume from this file alone.

The owner writes Chinese; answer the owner in Chinese, with the numbers. The owner wants this round **fully automatic**: no questions to the owner except the ones §2 names, every item in parallel, stop only at the stop line.

---

## §1 Read this first — how to resume in ten minutes

1. **Get the code.** `git clone https://github.com/Aspen-Lab/peer.git && cd peer && git checkout update-on-paper-digest`. The branch exists (created 2026-10-23 from `main` a2575ddb by the previous manager, with the owner's approval of its name; a draft PR is open for it: Aspen-Lab/peer#37, https://github.com/Aspen-Lab/peer/pull/37). **Never create another branch without the owner's written approval** (AGENTS.md). All P12 work is committed on this branch; the PR is merged only when the owner says so.
2. **Install and baseline.** Node 22 (`node --version` → v22.x). `cd web && npm ci`. Chromium for the walks: `npx playwright install chromium` (the walks drive the real page). Then run the gates once on the untouched head (Appendix A's script): expect **build 0, tsc 0, lint 0 errors / 144 warnings, 569 test files + 3 skipped / 10,684 tests + 3 skipped** (`TZ=America/Chicago`). Write the numbers as the GATE BASELINE line of the state file's §1 (step 5). If they differ, stop and record why before anything else.
3. **Read, whole, in this order** (all paths from the repo root):
   - `AGENTS.md` (the project rules: parallel work, no branch without approval, the decision priorities) and `docs/PRODUCT_DIRECTION.md`.
   - **The two skills you work by — "download them from the owner's GitHub" means these files:** `.claude/skills/abc/SKILL.md` with `.claude/skills/abc/references/{agent-briefs.md,state-file.md,resume-clock.md}` and `.claude/skills/abc/assets/STATE-TEMPLATE.md`; then `.claude/skills/reviewing-cycle/SKILL.md` with `.claude/skills/reviewing-cycle/templates/{RUBRIC.md,brief-C-parallel.md,checkpoint.md}` and its `README.md`. (`docs/reading-helper-abc/HANDOFF-P11.md` Appendices A–B carry both SKILL.md files verbatim as well.) **On the ChatGPT platform the skill's model table applies: the manager runs on `sol`, the A / B / C workers and the blind readers on `tera`; a worker is never on a larger model than the manager.** If `tera` is refused by a usage limit, re-spawn the item on `sol` and go back at the next item.
   - `docs/reading-helper-abc/P12-OWNER-2026-10-23.md` — the owner's nine items verbatim and the manager's reading (the spec of this round).
   - `docs/reading-helper-abc/HANDOFF-P11.md` §2, §3 and the protocol part of §6 — the method **as practised** here (worktrees, the manager's own mutation, cherry-picking, the readers, the director), which this file repeats in short in §3.
   - `docs/reading-helper-abc/P11-RUBRIC.md` (the rubric's pattern: themes, units, prices, pass requirements, the Scores table) and `docs/reading-helper-abc/P11-FINAL-REPORT.md` (what P11 delivered, what is open).
   - The state file `ABC-DEEP-REPORT-READING-HELPER.md`: its §1 header; rulings **§1h.111–§1h.182** (P11's decisions — many bind P12: the one 0.25 allowance §1h.163, the accepted cost of the group over a card's words §1h.168, the cross-block rule §1h.112 / §1h.166 (b), the keep-selection design §1h.157 / §1h.176 / §1h.181); the ledger's P11 rows; the BACKLOG table (BACKLOG-108, -111, -112, -113 are open).
   - Exemplar briefs, all in `docs/reading-helper-abc/briefs/`: `P11-59.md` (an A walk), `P11-58.md` (a B investigation), `P11-62.md` and `P11-66.md` (a C), `P11-R1-reader.md` (a blind reader — reused unchanged every round). Write P12's briefs by these patterns, from a script file or by hand, never from an inline shell heredoc that substitutes.
4. **Take the clock and the state file over.** The hourly Haiku resume clock of P11 is **disabled** (the owner's "关掉吧"); if your platform has a scheduler, set an hourly poke of your own per `abc/references/resume-clock.md` (it only wakes the manager; it never does work). Edit the state file's `HELD BY:` line to yourself and append the ruling that opens your tenure (the next free number is **§1h.183**; §1h.182 is the hand-off itself).
5. **Write the rubric** `docs/reading-helper-abc/P12-RUBRIC.md` from `.claude/skills/reviewing-cycle/templates/RUBRIC.md`, by `P11-RUBRIC.md`'s pattern, with §4's themes, units and pass requirements; commit it before round 1's first brief. The rubric changes only by a dated ruling.
6. **Round 1, all at once** (§4's plan): one B for the shared cause of items 3 / 5 / 6, and the Cs for items 1 + 7, 2, 4, 8, 9 in their own detached worktrees; then the Cs the B's finding names; then an A walk per theme, three blind readers per theme, the director, the score. Repeat until the stop line.
7. **Log** (§6) after every completed unit, and keep `docs/reading-helper-abc/P12-PROGRESS.md` (§7) for the owner's progress page.

---

## §2 The project, the branch, the hard rules

**Peer** is a calm daily forecast for research reading (`docs/PRODUCT_DIRECTION.md` is the spec; the owner's site https://hermes-admin-eta.vercel.app/ wins where they differ). The paper page ("report" to the owner) is `web/` — Next.js 16 (Turbopack), React, Tailwind v4, zustand, Vitest. Round P11 (PR #35, merged 2026-10-22 at the owner's instruction, before the owner's own look) built the three-pane reader, the margin actions (Explain this / Take notes / Highlight), the figure viewer and "Back to paper". **Round P12 is the owner's review of that merged `main`: nine items, `P12-OWNER-2026-10-23.md`.**

**Branch:** `update-on-paper-digest` (from `main` a2575ddb). Commit on it; push `git push -u origin update-on-paper-digest`; the draft PR stays a draft until the owner says "merge". Never push to `main`. Never force-push, rebase, amend a pushed commit, `git checkout -- <file>`, `git restore` or `git reset`; restore a mutation from a saved copy (sha256 before = after). State the current branch at the start of every session with the owner.

**The owner's standing constraints (every one of them held through P11; keep them):**
- Never create a branch without the owner's written approval. Never merge the PR without the owner's word.
- Never print, log or commit a credential or a key's value. Never commit anything per-user (`web/.local-data/`, uploads, logs with a reader's words).
- **The owner's PDF** (a paper of their own, used for the walks in P11) **is not in the repository and is not on your machine.** Ask the owner for it **once** (an upload or a path), use it only through the product's upload UI, never copy, quote (more than 3 consecutive words in a pack's index, none in a deliverable) or commit it. Until it arrives, walk with public papers (any arXiv PDF the stub can digest; P11 used two public papers besides the owner's).
- Never delete, skip, quarantine or weaken a test; name any re-aimed test.
- No new dependency. No switch or feature flag to route around a rule.
- Workers never push, never branch, touch only the files their brief names, stop only the dev server they started (by its process group: `setsid` to start, `kill -- -<pgid>` to stop), one port each (P12 starts at **4200**, upward).
- Every commit ends with an attribution trailer naming the model that wrote it (P11's shape: `Co-Authored-By: <vendor> <model> <noreply@…>`); no model identifiers anywhere else in a commit, a PR or a document.
- The owner's decisions on record: justified prose stays ("两端对齐", §1h.134); the group over a card's words is an accepted 0.25 cost (§1h.168); the stop line is the owner's (§1h.163).

**What you may ask the owner (only these):** the PDF (once); a decision §4 marks "the owner rules" when a B's finding leaves two designs of equal cost; the stop line if the owner wants it changed. Everything else: decide, record the ruling, go on.

---

## §3 The method — reviewing-cycle on top of abc, as practised here (short)

Roles: **the manager** (you; the only writer of the state file, the rubric and the briefs; verifies every C itself; never writes product code), **A** the reviewer (read-only; walks the real page with Playwright at the rubric's widths; one deliverable `P12-NN-A-<UTC>.md`; an evidence pack of screenshots and DOM dumps with an `index.md` that has **no score and no verdict**), **B** the investigator (read-only; one report `P12-NN-B-<UTC>.md` with numbers and three candidate rules, never the fix), **C** the implementer (its own detached worktree from the head you name; commits `test red on the base → fix → checkpoint P12-NN-C-<UTC>.md`, the path named on each commit; one mutation per rule, restored byte-identical; measures before and after on an invented input), **three blind readers** per theme (told nothing but the rubric, the owner's file and the pack; each writes one file; the median is the score of record; the director — you — checks every disputed mark against the evidence and voids a mark the input itself prints or a rule already ruled by design).

The round (reviewing-cycle "The round"): RENDER (a fresh stubbed dev server from the worktree, the owner's input through the real upload path) → SCORE (A's walk, the readers, the director) → CLUSTER by mechanism → BRIEF one C per cluster in disjoint files, a B first where the cause is unknown → VERIFY (you, in a free copy that is not the worker's worktree: cherry-pick the C's range onto the branch head, read the diff, `npx tsc --noEmit`, `npm run lint` (0 errors, ≤ 144 warnings), the touched tests three times, **one mutation of your own** — disable the rule the item claims → its test red → restore byte-identical — then the full gates of Appendix A) → LAND (`git merge --ff-only <tip>` when the branch has not moved, else cherry-pick; `git diff --quiet <tip> HEAD -- web` must be silent; remove the worktree) → RECORD (a numbered ruling, the ledger row, the log entry, the progress file; the owner told in Chinese).

**Stop:** every theme ≥ the line in two consecutive rounds. **The owner's standing line (from P11, ruling §1h.163, the owner's decision of 2026-10-21): ≥ 97.9 per theme; one extra priced 0.25 is allowed per theme per round; a 0.5, a FAIL unit or a failed pass requirement is not a pass; two consecutive rounds per theme.** It applies to P12 unless the owner writes a different number; the owner was told so at the hand-off. Both themes' counts start at 0. Never lower a price to fit the line, never raise one; a disagreement among readers is recorded in the ruling, not hidden.

Practicalities that cost P11 time, so you do not pay them again:
- **Disk.** Walks write ~1.5 GB each (screenshots + a `.next` build). Check free space before spawning; delete a round's screenshots after it is scored (readers' files, dumps and scripts stay); remove every landed item's worktree.
- **A full-page `.next` cache per worktree:** delete `web/.next/dev/cache` before a build in a reused copy.
- **The dev server with the stub** (no model, no key; `docs/reading-helper-abc/harness/model-stub.cjs` answers every model call from the paper's own sentences): from the worktree, `mkdir -p <scratch>/stub && cd web && P602_DIR=<scratch>/stub NODE_OPTIONS="--require $(pwd)/../docs/reading-helper-abc/harness/model-stub.cjs" setsid npm run dev -- -p <port> > <scratch>/dev.log 2>&1 &`. Everything per-run goes to a scratch directory **outside the repository** (never committed).
- **Items 3 / 5 / 6 need the production build too:** `npm run build && npx next start -p <port>` with the same `NODE_OPTIONS` / `P602_DIR`.
- Take every reading after 300 ms of still scroll; record load averages with timings; Chromium only is what P11 measured — say so in every deliverable.
- When a brief's literal wording and its "nothing else changes" rule collide, the C measures and stops at the rule (§1h.176 is the precedent); you rule.

---

## §4 The spec, the themes, the plan for round 1

The spec is `P12-OWNER-2026-10-23.md` (verbatim + the binding reading). **Two themes** for the rubric (the P11 pattern: 12 units each, the formula `100 × (Σ units − Σ costs) / Σ units`, prices 1.0 / 0.5 / 0.25 by kind, pass requirements that hold whatever the number says):

**Theme A — the note** (items 1, 2, 7). Units to write (the manager may split or merge, 12 is the pattern): A1 the sticky card shows a formatting row; A2 bold / italic / underline work and survive save; A3 bullet list; A4 indent / outdent, Tab / Shift+Tab; A5 the structure is in the record and in every export (Markdown, Obsidian, the notes page, "Open your notes"); A6 the blue square is aligned to the first text line at every reading-scale step; A7 its side equals the text's font size; A8 Save puts the note in "Open your notes" and closes the card; A9 Delete removes the note outright and closes the card; A10 Escape and every other path unchanged (name them from the measurement); A11 keyboard reach and labels for every new control; A12 light and dark, at every step, nothing per-user.

**Theme B — the margin and the controls** (items 3, 4, 5, 6, 8, 9). Units: B1 the two pane dividers are visible at rest and draggable at the owner's likely window sizes and zooms (the B's finding decides which sizes the page must serve — a ruling); B2 the one-column page / the breakpoint per that ruling; B3 Explain + note open: equal split; B4 the boundary between cards drags, with a minimum height and keys; B5 three cards: thirds, two boundaries; B6 a selection offers Highlight wherever a mark can be drawn (and the other two buttons), at every width the page serves; B7 every visible figure opens in the margin on a click, at every width the page serves, in the production build; B8 the answers control: section-title size, orange, white, AA, dark mode, scales; B9 the Submit control's two states with their colours and words; B10 contrast AA for every new colour, light and dark; B11 P11's guard — the P11 rubric's A1–A12 and B1–B12 still PASS on this head (the regression guard, as P11 carried P10's); B12 no error overlay, no "Maximum update depth", no snag, Tier 0 without a key.

**Pass requirements (both themes):** no error view / snag / max-depth in the pack's checks; Tier 0 complete without a key; the privacy grep (every string named by what it is, never its value) 0 hits outside the upload store; the paper's text unchanged by any route; the P11 guard units hold; no run of 4+ words of the owner's paper in a pack or a deliverable.

**Round 1, in parallel (group only by file overlap; say why whenever two run one after another):**

| item | role | files (yours) | port |
|---|---|---|---|
| **P12-01** the shared cause of the owner's 3 / 5 / 6 | **B** (read-only) — test the width / zoom hypothesis, the discoverability hypothesis and the deployment hypothesis on the production build and the deployed site, with real clicks and drags; report numbers and three candidate rules per item | none | 4200 |
| **P12-02** items 1 + 7 (the sticky card) | C | `web/src/components/notes/sticky-note.tsx`, `note-toolbar.tsx`, `note-editor.tsx`, `wysiwyg-field.tsx`, the notes export code the toolbar's structure must reach (find it: `paper-notes.tsx`, the notes page under `web/src/app/notes/`), their tests | 4201 |
| **P12-03** item 2 (the square) | C | `web/src/components/notes/highlight-row.tsx` and the square's rules in `web/src/app/globals.css` (the P10-46 token lines ~320 and ~379); tests | 4202 |
| **P12-04** item 4 (equal split + card divider) | C | `web/src/components/reader/explain-dock.ts`, `margin-card.tsx`, `figure-host.tsx`, a horizontal variant of `pane-divider.tsx` (or a new file beside it), `lib/reader/figure-viewer.ts` only if the stack logic lives there; tests | 4203 |
| **P12-05** item 8 (the answers control) | C | `web/src/components/reader/for-your-questions.tsx`, `copy.ts` (the `control` string), a colour token in `globals.css` (a disjoint section from P12-03's); tests | 4204 |
| **P12-06** item 9 (the Submit control) | C | `web/src/components/reader/question-field.tsx`, `copy.ts` (its own strings), tests | 4205 |
| P12-07 … | C | items 3 / 5 / 6 as the B's finding names them (likely `reader-layout.tsx` / `reader-shell.tsx` / `pane-divider.tsx` for the width or the affordance; `selection-toolbar.tsx` / `paper-body.tsx` for Highlight; `matted-figure.tsx` / `figure-viewer.ts` / `keep-selection.ts` for the figure click) | 4206+ |

`copy.ts` is touched by P12-05 and P12-06: give each its own lines and merge yourself, or run P12-06 after P12-05 and say so. `globals.css` likewise (P12-03, P12-05). `sticky-note.tsx` holds items 1 and 7 → one C. Then **A P12-1x** walks Theme A and **A P12-1y** Theme B on the landed head (both at once), three readers each, the director, the score; the extras become the next items; round 2 walks the next landed head. A theme's walking ends after its second consecutive pass; the loop ends when both have; then the final report (the P11 one is the pattern) and the owner's own look.

Ruling numbers continue the state file's §1h series (next free: **§1h.183**). Item ids **P12-01** upward. Checkpoints and deliverables `docs/reading-helper-abc/P12-NN-{A,B,C}-<UTC>.md`. Briefs `docs/reading-helper-abc/briefs/P12-NN.md`.

---

## §5 Current state — always true (update it with every log entry)

```
AS OF        2026-10-23T23:50:33.044Z
BRANCH       update-on-paper-digest; draft PR Aspen-Lab/peer#37; local clone peer-p12-manager
HELD BY      Codex manager (local desktop chat); only writer of the state file
LAST RULING  §1h.193   NEXT RULING §1h.194   NEXT ITEM ID P12-07   NEXT FREE PORT 4206
RUBRIC       P12-RUBRIC.md frozen; scores none; consecutive A0/B0; stop ≥97.9 / one0.25 / two rounds
RUNNING      C02/03 notes port4201, C04 margin port4203, C05 disclosure port4204; all detached at d8a4574d; baseline landing gate unresolved
THEN         independent early-contract verification; C06 after05 token contract; measured follow-up briefs
OWNER'S PDF  supplied attachment; use only original path through upload UI; never commit or quote
CLOCK        hourly heartbeat peer-p12 ACTIVE; independent cheapest model unavailable in current heartbeat tool
```

---

## §6 Work log — the protocol, then the entries

**Protocol (the owner's requirement; it is what makes the work survive a cut-off):** after **every completed unit of work** — a brief written, an agent spawned, a deliverable picked, a C verified and landed, a round scored, a ruling, a push — append **one line** above the marker below, newest last, and update §5; commit the two files together with the path named (`git commit -m "docs(abc): handoff log — <what>" -- docs/reading-helper-abc/HANDOFF-P12.md …`) and push. Shape:

`- <UTC> | <head sha after the commit> | <who: manager (model) / A / B / C / reader> | <what was completed, with the numbers> | evidence: <paths> | next: <the next unit>`

When a usage limit or a crash stops you mid-unit, write a **PARTIAL** entry first (what is done, what is not, where the worktree is) so the next agent does not redo or lose it. A resuming agent of another vendor (Claude, ChatGPT, …) reads the entries since its last one and continues; it backfills the owner's progress page (§7) under the other agent's name.

- 2026-10-23 18:17Z | 3402e465 | manager (Claude Fable 5.1) | Branch pushed; draft PR Aspen-Lab/peer#37 opened (base main; documents only so far); the owner's progress page updated | evidence: https://github.com/Aspen-Lab/peer/pull/37 | next: the next manager (ChatGPT) does §1 steps 1–7; Claude's session is handing off
- 2026-10-23 18:2xZ | 5108ebdb | manager (Claude Fable 5.1) | The owner's start prompt for ChatGPT written: `P12-START-PROMPT.md` (points at this hand-off, the owner file, the skills' paths, the rules, the stop line, the log protocol) | evidence: that file | next: the next manager starts from HANDOFF-P12 §1
<!-- APPEND NEW ENTRIES BELOW THIS LINE, ONE PER COMPLETED UNIT OF WORK -->
- 2026-10-23T18:37:27.858Z | base 220ca9e1 (this entry's commit follows) | manager | SETUP: Fresh clone, existing approved branch checked out, head 220ca9e1; PR #37 attached; complete hand-off and owner review read | evidence: HANDOFF-P12.md, P12-OWNER-2026-10-23.md | next: resolve baseline then commit rubric
- 2026-10-23T18:37:27.858Z | base 220ca9e1 (this entry's commit follows) | manager | ENV: Node 22.23.4 SHA256 verified, npm ci completed, Chromium installed outside project dependencies | evidence: scratch baseline logs; manifests unchanged | next: resolve baseline then commit rubric
- 2026-10-23T18:37:27.858Z | base 220ca9e1 (this entry's commit follows) | manager | PREFLIGHT: Independent read-only guard comparison delivered; source-shape baseline discrepancy investigation running | evidence: P11-RUBRIC.md, P12-OWNER-2026-10-23.md | next: resolve baseline then commit rubric
- 2026-10-23T18:37:27.858Z | base 220ca9e1 (this entry's commit follows) | manager | CLOCK: Hourly heartbeat peer-p12 created and confirmed ACTIVE; cheapest model parameter unavailable | evidence: app automation peer-p12 | next: resolve baseline then commit rubric
- 2026-10-23T18:37:27.858Z | base 220ca9e1 (this entry's commit follows) | manager | TAKEOVER: PARTIAL baseline: build 0, tsc 0, lint 0 errors / 144 warnings; full tests running, failures observed; no product changes | evidence: state ruling §1h.183 | next: resolve baseline then commit rubric
- 2026-10-23 (hand-off) | 453c8732 | manager (Claude Fable 5.1, the P11 manager) | Round P12 opened: the owner's nine items recorded verbatim with the binding reading (`P12-OWNER-2026-10-23.md`); this hand-off written; branch `update-on-paper-digest` created from main a2575ddb with the owner's approval; ruling §1h.182 in the state file; P11's hourly clock disabled | evidence: this file, P12-OWNER-2026-10-23.md, state file §1h.182 | next: the next manager does §1 steps 1–7

- 2026-10-23T13:43:49-05:00 | e047ffb4 | manager (backfilled from committed progress/events after CRLF log bug) | RUBRIC: Frozen P12 rubric: two themes, 12 units each, threshold 97.9, at most one 0.25 extra, two consecutive rounds; independent audit gaps corrected before freeze. Windows baseline completed and discrepancies recorded; unchanged app now awaiting genuine Linux baseline. | evidence: P12-RUBRIC.md; rulings §1h.184–185; scratch baseline.log / baseline.log.test | next: finish Linux runtime baseline; prepare first-round briefs after this rubric commit
- 2026-10-23T13:46:22-05:00 | 68cad2c6 | manager (backfilled from committed progress/events after CRLF log bug) | P12-01-BRIEF: Committed first round-1 B brief after frozen rubric; read-only production/deployment measurements for owner3/5/6 while Linux baseline setup proceeds; no implementation authorized before green baseline | evidence: briefs/P12-01.md; P12-RUBRIC.md at e047ffb4 | next: spawn independent B at committed head on port4200
- 2026-10-23T13:47:15-05:00 | d02860d6 | manager (backfilled from committed progress/events after CRLF log bug) | P12-01-SPAWN: Independent B started from68cad2c6 in detached p12-01/wt, port4200; portable Linux runtime now boots and runs original-head setup/gates in parallel; no product code changed | evidence: briefs/P12-01.md; agent /root/p12_01_investigator; infrastructure /root/linux_runtime; local scratch Linux logs | next: collect production/deployment B report and Linux gate summary; prepare disjoint C briefs
- 2026-10-23T13:51:57-05:00 | e3acd3e0 | manager (backfilled from committed progress/events after CRLF log bug) | P12-01-HARNESS: Ruled a local-only synthetic auth fixture for production UI measurement; production upload/auth code and NODE_ENV remain unchanged, no real account or key used; anonymous blocked baseline remains evidence | evidence: upload-access.ts and supabase/server.ts read by manager; ruling§1h.186; B bootstrap report | next: B banks PARTIAL bootstrap evidence, then measures authenticated local upload UI and public-only deployed site
- 2026-10-23T13:52:42-05:00 | 0115b258 | manager (backfilled from committed progress/events after CRLF log bug) | P12-01-PARTIAL-1: Read entire and picked B bootstrap report da00d9a6: own production build0; anonymous upload UI absent; no paper feature counted yet. Production site public200 but no upload; PR preview redirects to Vercel login; served revision unknown. B continues under local auth-fixture ruling186. | evidence: P12-01-B-20261023T190000Z.md; private scratch deployment evidence | next: B local synthetic-auth production upload measurements; Linux baseline completes independently
- 2026-10-23T13:56:12-05:00 | 6151e498 | manager (backfilled from committed progress/events after CRLF log bug) | P12-02/03-BRIEF: Committed structured-note and square C cluster brief, grouped only by measured note-editor/sticky marker file overlap; known data/export ownership gaps included. Product edits held until genuine Linux baseline. Suspended synthetic-auth method after automatic policy rejection. | evidence: briefs/P12-02.md; scope investigation; ruling§1h.187 | next: prepare P12-04/05/06 disjoint briefs; finish Linux baseline; B normal dev/public-only deployed checks
- 2026-10-23T13:58:49-05:00 | ff08cde1 | manager (backfilled from committed progress/events after CRLF log bug) | P12-04-BRIEF: Margin split C brief committed with actual windows.ts authority, all visible bodies, adjacent-pair drag/keys, measured minima, session shares and stable visual order; no overlap with note C | evidence: briefs/P12-04.md; ruling§1h.188 | next: write answer/submit control briefs while Linux gates and B continue
- 2026-10-23T14:00:14-05:00 | 66588b89 | manager (backfilled from committed progress/events after CRLF log bug) | P12-05-BRIEF: Committed answers-disclosure C brief, matching computed section-title size and AA orange/white; early shared colour contract allows disjoint Submit worker to proceed | evidence: briefs/P12-05.md; ruling187 shared-token/file scopes | next: write Submit brief; wait Linux gates while B measures dev/public production
- 2026-10-23T14:01:37-05:00 | 567ed06a | manager (backfilled from committed progress/events after CRLF log bug) | P12-06-BRIEF: Committed Submit/Submitted C brief; raw last-submission display distinguished from normalized no-op guard, initial empty/gist/revert/IME/refit cases required. All planned initial C briefs now banked, no product edits yet. | evidence: briefs/P12-02.md, P12-04.md, P12-05.md, P12-06.md; rulings187/188 | next: finish Linux original-head baseline; dispatch C02/03,04,05 concurrently as slots free; C06 after05 token contract; B names3/5/6 fixes
- 2026-10-23T14:02:33-05:00 | 6e70a39d | manager (backfilled from committed progress/events after CRLF log bug) | BRIEF-AUDIT: Independent read-only pre-implementation contract audit started on committed02/03,04,05,06 briefs, checking fileownership and impossible requirements while Linux gates and B run; no product C dispatched | evidence: briefs/P12-02.md, P12-04.md, P12-05.md, P12-06.md; preflight_reader separate worker | next: read audit result and correct manager contracts if needed; collect Linux baseline and B measurements
- 2026-10-23T14:04:39-05:00 | 008833cb | manager (backfilled from committed progress/events after CRLF log bug) | BRIEF-AUDIT-DONE: Independent contract audit returned; clarified logical test/fix/checkpoint commit units, exclusive existing CSS-test ownership, and session-only raw submit acknowledgement with normalized reload initialization; no product code edited | evidence: briefs/P12-02.md, P12-04.md, P12-05.md, P12-06.md; ruling§1h.189 | next: collect Linux baseline and B checkpoint2; C dispatch after green
- 2026-10-23T14:09:01-05:00 | 687c7bda | manager (backfilled from committed progress/events after CRLF log bug) | P12-01-PARTIAL-2: Picked second B checkpoint: observed productiona2575dd has identical web tree (manager independently git-diff confirmed); preview login-blocked, synthetic auth restart policy-blocked and suspended. Corrected stale P12 resume branch/clock playbook and added per-item ledger. Native Linux CI feasibility will be attempted while portable baseline continues. | evidence: P12-01-B-20261023T190000Z.md; manager git-diff exit0; ruling§1h.190; shared ledger | next: attempt branch-scoped dependency-free native Linux baseline workflow through connected GitHub; preserve portable baseline until result

- 2026-10-23T23:43:58.447Z | parent a77f7fa7 (entry commit follows) | manager | P12-RESUME-1: Resumed after usage-limit interruption without duplicating workers; banked B checkpoint3 dc3134d4 as a77f7fa7. Genuine Linux original-head gates completed build0/tsc0/lint0errors144warnings/test1: 4failed565passed3skipped files,4failed10680passed3skipped tests. Four causes now being checked in isolation; native CI create_file was rejected403. Corrected scratch log helper CRLF delimiter and backfilled12 missing section6 records from committed progress/events. | evidence: P12-01-B-20261023T190000Z.md; Linux scratch logs/exits.txt and test.log; P12-PROGRESS.md; ruling191; git history | next: collect isolated four-file Linux reruns and native performance comparison; finish B remaining probes; rule baseline next step before product C edits

- 2026-10-23T23:45:32.664Z | parent 93c7d0b2 (entry commit follows) | manager | BASELINE-CAUSAL-DONE: Four original-head failures causally classified; historical ref fixed and migration9/9 passes. Default isolated TCG runs preserve failures: pane29pass1timeout;partition54pass1timeout;wysiwyg118pass2fail(frame46.979ms and propertytimeout). Native unchanged wysiwyg120/120 passes. Release only detached implementation hold to allow parallel progress; hard clean-gates landing requirement unchanged. | evidence: ruling192; environment B scratch isolated logs; unchanged native serializer benchmark; updated C briefs | next: dispatch disjoint note/margin/orange C clusters as slots free; resolve verification executor before landing; B finishes remaining probes

- 2026-10-23T23:48:36.764Z | parent 36dec920 (entry commit follows) | manager | P12-01-B-BOUNDED: Banked bounded final B addendum34c1a565: owner420 andpublicA210 figure clicks opened; publicB63delivered opened,66blocked beforeclick fromimagefailures; verifiedstandingselection36/36opens; phonesall3Highlightmarks butnoanchoredTake notes; deployedcrossbody21/21noactions. Auth/actualzoom/enhancement/Summary/exportlimitationsstillPARTIAL. Own4200serverstopped. | evidence: P12-01-B-20261023T190000Z.md; scratchmatrix evidence filenames in report | next: manager rules responsivewidth/range/viewer contracts; issue B-named implementation briefs by shared-file dependencies

- 2026-10-23T23:48:59.192Z | parent 9bbfeb35 (entry commit follows) | manager | P12-ENV-B-PARTIAL: Imported independent environment checkpoint affea779 under campaign directory, removing an unnecessary model identifier before commit. Exact Linux and isolated counts, fetched historical ref, runtime restart and unresolved native executor are recorded. No app/test change; full gates remain red. | evidence: P12-ENV-B-20261023T234546Z.md; source affea779; scratch baseline-logs | next: continue detached C implementation; manager resolves independent full clean-gates execution before landing

- 2026-10-23T23:50:32.807Z | parent d84dff85 (entry commit follows) | manager | P12-02/03-SPAWN: Independent C02/03 started at d8a4574d in p12-02/wt on port4201. Export and structured ownership early commits returned, not landed. | evidence: briefs/P12-02.md; worker5bb7f13b and6f880860 | next: manager checks early contracts in independent copy; complete C work; prepare measured follow-up briefs

- 2026-10-23T23:50:32.935Z | parent d84dff85 (entry commit follows) | manager | P12-04-SPAWN: Independent C04 started at d8a4574d in p12-04/wt on port4203; existing model stub, invented upload, active/visible contract coordinated. | evidence: briefs/P12-04.md; ruling193 | next: manager checks early contracts in independent copy; complete C work; prepare measured follow-up briefs

- 2026-10-23T23:50:33.044Z | parent d84dff85 (entry commit follows) | manager | P12-05-SPAWN: Independent C05 started at d8a4574d in p12-05/wt on port4204. Requested worker model unavailable again; exposed same-generation fallback used. Early token range through02b1c3d7 returned, not landed. | evidence: briefs/P12-05.md; early worker token range; ruling193 | next: manager checks early contracts in independent copy; complete C work; prepare measured follow-up briefs

---

## §7 Where everything is

| what | where |
|---|---|
| the owner's spec for P12 | `docs/reading-helper-abc/P12-OWNER-2026-10-23.md` |
| the prompt the owner pastes to start ChatGPT | `docs/reading-helper-abc/P12-START-PROMPT.md` |
| this hand-off and its log | `docs/reading-helper-abc/HANDOFF-P12.md` |
| **the owner's progress page** | The P11 owner followed a live dashboard (a Claude artifact) the previous manager updated; you cannot write it. Keep **`docs/reading-helper-abc/P12-PROGRESS.md`** instead: one table, columns `id | kind | what (Chinese, one line) | state (进行中 / 已交回 / 已合入 / 不做) | started (UTC) | by (谁做的)`, plus a two-line status at the top in Chinese; update it with every log entry. A resuming Claude backfills the dashboard from it. |
| the state file (rulings, ledger, BACKLOG) | `ABC-DEEP-REPORT-READING-HELPER.md` (repo root) — the manager's only; §1h.183 is the next ruling |
| the rubric | `docs/reading-helper-abc/P12-RUBRIC.md` (to write, from `.claude/skills/reviewing-cycle/templates/RUBRIC.md`, by `P11-RUBRIC.md`) |
| the skills | `.claude/skills/abc/` and `.claude/skills/reviewing-cycle/` (verbatim copies also in `HANDOFF-P11.md` Appendices A–B) |
| briefs | `docs/reading-helper-abc/briefs/P12-NN.md` (exemplars: `P11-59.md` A, `P11-58.md` B, `P11-62.md` / `P11-66.md` C, `P11-R1-reader.md` reader) |
| deliverables and checkpoints | `docs/reading-helper-abc/P12-NN-{A,B,C}-<UTC>.md` |
| the model stub | `docs/reading-helper-abc/harness/model-stub.cjs` (§3 has the command); `render-digestion.mjs` renders a digestion without a server |
| the gates script | Appendix A below (also `HANDOFF-P11.md` Appendix D) |
| P11's record | `P11-FINAL-REPORT.md`, `P11-RUBRIC.md`, `HANDOFF-P11.md`, `P11-*-{A,B,C}-*.md`, rulings §1h.111–§1h.181 |
| the P11 evidence packs, screenshots, the owner's PDF | **gone with the previous manager's machine** — not needed; a new round makes its own |
| the product's web app | `web/` (`npm run dev`, `npm run build`, `npm test` = Vitest, `npm run lint`); private uploads in `web/.local-data/` (never committed) |

---

## Appendix A — the gates script (`gates-build-first.sh`; usage: `bash gates-build-first.sh <worktree> <log> "<label>"`)

Keep it outside the repository (it was `scratchpad/p505/gates-build-first.sh` in P11). A clean run reads `build 0`, `tsc 0`, `✖ 144 problems (0 errors, 144 warnings)`, `test 0`, and the file and test counts.

```bash
#!/bin/bash
cd "$1/web" || exit 1
L="$2"
echo "== gates at $(git rev-parse --short HEAD) ($3) $(date -u +%H:%MZ), build first" > "$L"
npm run build > "$L.build" 2>&1; echo "build $?" >> "$L"
npx tsc --noEmit >/dev/null 2>&1; echo "tsc $?" >> "$L"
npm run lint 2>&1 | grep problems >> "$L"
TZ=America/Chicago npm test -- --maxWorkers=2 > "$L.test" 2>&1; echo "test $?" >> "$L"
grep -E "Test Files|^      Tests|×| FAIL " "$L.test" | head -20 >> "$L"
echo "== done $(date -u +%H:%MZ)" >> "$L"
```

## Appendix B — the manager's verification of a C, step by step (what "verified" meant in P11)

1. In a free copy of the repo (a second worktree of your own, never the C's): `git checkout -q --detach <branch head>`; `git cherry-pick <C's base>..<C's tip>`.
2. Read the whole production diff. Anything outside the brief's "yours" files, any test deleted or weakened, any new dependency → back to the C with the reason.
3. `npx tsc --noEmit` → 0. `npm run lint` → 0 errors, ≤ 144 warnings.
4. The touched test files three times (`TZ=America/Chicago npx vitest run <paths>`), all green each time.
5. **Your own mutation:** save a copy of the production file (sha256), disable the rule the item claims with a one-line edit, run the touched tests → red; copy the saved file back → sha256 equal → green again. A C whose rule cannot be made red has not tested its rule.
6. The full gates (Appendix A) on the combined head, in the background; clean.
7. Land: `git merge --ff-only <tip>` on the branch (or cherry-pick the range when the branch moved); `git diff --quiet <tip> HEAD -- web` silent; `git worktree remove --force <the C's worktree>`; push; ruling + ledger row + log entry + progress row; tell the owner.
