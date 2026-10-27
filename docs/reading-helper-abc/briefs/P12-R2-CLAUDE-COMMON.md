# P12 round 2 (Claude's tenure) — what both A walks share: P12-37 (Theme A) and P12-38 (Theme B)

Written 2026-10-27 by the manager (Claude, §1h.419). Your theme's own brief (`P12-37.md` or `P12-38.md`) adds to this one; where they differ, your theme's brief wins.

## Who you are, what you may touch

You are **A, the reviewer** — read-only on product code. Model: Claude Sonnet. Read as **a PhD student who wrote the owner's paper and now reads it in Peer**: demanding, judging a feature by whether it works on the page, never by what the code or a test claims. You commit **only your deliverable** (`docs/reading-helper-abc/P12-NN-A-<UTC>.md`) in your own worktree; you never push, never branch, never touch product code, never commit a screenshot, a DOM dump, the owner's paper or anything a reader typed.

## Read first (in this order)

1. `docs/reading-helper-abc/P12-OWNER-2026-10-23.md` — the owner's nine items (the spec) and the binding reading.
2. `docs/reading-helper-abc/P12-RUBRIC.md` **whole**, including the amendments at the top and the end: the stop line is now **97.25 per theme, two consecutive rounds** (§1h.419) and every unit's "every …" means **the finite matrix of §1h.420** (end of the rubric). The units, prices, formula and pass requirements are unchanged.
3. In `ABC-DEEP-REPORT-READING-HELPER.md` (read-only): rulings **§1h.419, §1h.420, §1h.421** (search `### §1h.419`), and §1h.184 / §1h.194 (the supersessions and the multi-card reading).
4. Round 1's findings, as the predecessor list you must re-check (mark each **GONE / STILL / CHANGED** with the evidence): `P12-23-A-20261025T230000Z.md` (Theme A), `P12-24-A-20261025T230500Z.md` (Theme B), `P12-R1-DIRECTOR-20261027.md`, and the Codex manager's unfinished round-2 notes `P12-34-A-20261027T111042Z.md` and `P12-35-A-20261027T-PARTIAL.md`, plus `P12-36-B-20261027T000000Z.md` (the same note edited in the sticky card and the notes window at once — measure it on the page) and `P12-33-B-20261027T055000Z.md` (why a local production server refuses uploads). These are long; read their headings and their defect lines, not every checkpoint.

## Your worktree and server

```
H=<the head the manager gives you>
WT=/tmp/claude-0/-home-user-peer/9602921a-6ac5-5952-88ce-8364fcd8f733/scratchpad/p12/r2/<a37|a38>/wt
git -C /home/user/peer worktree add --detach "$WT" "$H"
cp -al /home/user/peer/web/node_modules "$WT/web/node_modules"
```
Check `ls "$WT/docs/reading-helper-abc/briefs/P12-R2-CLAUDE-COMMON.md"` exists (else stop and say so).

**The server is the dev server with the model stub** (§1h.421: a local `next start` refuses every upload without a signed-in account — `web/src/lib/papers/upload-access.ts`, B33 — so the uploaded inputs can only be walked on the dev server, which is what P11 walked). Start it from `$WT/web` with the Next CLI directly — **never `npm run dev`** (its `predev` script kills other dev servers, including the other walk's):
```
R=/tmp/claude-0/-home-user-peer/9602921a-6ac5-5952-88ce-8364fcd8f733/scratchpad/p12/r2/<a37|a38>
mkdir -p $R/stub $R/uploads $R/pack
cd "$WT/web" && PEER_PRIVATE_UPLOAD_DIR=$R/uploads P602_DIR=$R/stub \
  NODE_OPTIONS="--require $WT/docs/reading-helper-abc/harness/model-stub.cjs" \
  setsid npx next dev -p <your port> > $R/dev.log 2>&1 &
```
Your port is in your theme brief; it is yours alone. At the end stop **only your server**, by its process group (`kill -- -<pgid>`), and leave the worktree in place (the manager removes it).

Playwright: `require('playwright')` works from any directory; `chromium.launch()` needs no options. Chromium only — say so in the deliverable. Before every measurement or screenshot, wait for 300 ms of still scroll. Record the machine's load average with any timing you report.

**Profiles.** First a fresh browser profile with **no key** (Tier 0 — the pass requirement). Then a separate profile with a **placeholder OpenAI key** typed into the app's own key setting (any invented string; the stub answers `api.openai.com` from the paper's own sentences — `docs/reading-helper-abc/harness/model-stub.cjs`). Never print the placeholder's value; name it "the placeholder key".

## The inputs (§1h.420) — every one through the app's own upload UI and consent

- **R1** the owner's PDF — its path is in the manager's spawn message. Use it **only through the upload UI** (the file chooser). Never copy it, never quote it: no sentence of it in your deliverable, and no run of four or more of its words in the pack's index.
- **R2** public A, arXiv 1706.03762v7: `/tmp/claude-0/-home-user-peer/9602921a-6ac5-5952-88ce-8364fcd8f733/scratchpad/p12/inputs/public-a.pdf` (sha256 `b7d72988…aff6a`).
- **R3** public B′, TraceMonkey PLDI 2009: `…/p12/inputs/compressed.tracemonkey-pldi-09.pdf` (sha256 `3662ff51…e113`).
- **S** the invented stress PDF: `…/p12/inputs/invented-stress.pdf` (sha256 `e8f1d37a…69282`; 7 pages, 6 figures, a table, a 100-character unbroken token).

Check each sha256 before use. Report every input individually; never average across inputs.

## The matrix (§1h.420), and what "done" means

Widths (CSS viewport): **W1 1440×900, W2 1024×576, W3 853×480, W4 390×844.** Reading steps: name every step the app offers in your pack, and walk **the smallest, the default and the largest**. Light everywhere; dark at W1 default and W1 largest.

- **Core cells for every unit:** {R1, R2} × {W1, W2, W3} × default step × light.
- **Stress cells** (units whose subject scales): R1 × W1 × {smallest, largest} × light, and R1 × W1 × largest × dark.
- **Phone cells:** R1 × W4 × default, for each unit whose control the phone page offers (say which ones it does not offer, and whether the spec requires them there).
- The unit-specific cells in §1h.420 (A5, A6 / A7, B6, B7, B8–B10, B11, B12, and S's units).

**A unit is PASS when every one of its cells passes with evidence in your pack; a cell you did not perform is FAIL (evidence) — so perform every cell, and do not go beyond the matrix to collect more.** The matrix is finite on purpose (the previous walks' "everything everywhere" produced 0.00 with no defect found). **A defect you see anywhere — in a cell or outside one — is costed** by the rubric's kinds (1.0 unusable or hidden, 0.5 misleading, 0.25 cosmetic), once per mechanism, with a screenshot and a measurement, and the sentence of the owner's (or the rubric line) it fails. Not extras: the stub's canned answers (a harness artefact); the dev server's own "N" development badge; justified-text word spacing (§1h.134). The standing 0.25 (§1h.168): tally the selection group / colour strip over an open card's body words per card kind, including zero.

**Pass requirements** (rubric, "Pass requirements for both themes") — answer each one first in your deliverable, PASS / FAIL with the evidence: (1) no error overlay, "This view hit a snag" or "Maximum update depth" anywhere you walked (collect the browser console and page errors at every step, and grep `$R/dev.log`); (2) Tier 0 complete with no key; (3) the privacy grep — every probe named by what it is ("a note's first five words", "the placeholder key"), never its value, with hit counts over `$R/dev.log`, `$R/stub/`, your pack and the worktree's tracked files (`git -C $WT grep`); 0 hits allowed outside `$R/uploads`; (4) the paper's words unchanged — hash the body text of R1 and R2 before and after your action sequences; (5) the P11 guard (Theme B's B11 carries it; Theme A reports any guard line it happens to break); (6) no four-word run of the owner's paper in the index, no quotation in the deliverable.

## The deliverable and the pack

- **Pack** in `$R/pack/`: `index.md` listing every unit, its cells, and for each cell the evidence file names and the measured numbers — **no score, no PASS/FAIL verdict, no opinion** (three blind readers will score from it); the screenshots; the DOM / JSON measurements; the console and page-error logs. Name files `<unit>-<input>-<width>-<step>-<theme>.png|json`.
- **Deliverable** `docs/reading-helper-abc/P12-NN-A-<UTC>.md` (NN = your item; UTC like `20261027T1830Z`): the head hash; the pass requirements first; the unit table (PASS / FAIL, the failing cells, one line of evidence each); the predecessor list GONE / STILL / CHANGED; the extras (kind, price, mechanism, evidence); **the score** by the formula with its arithmetic, a sensitivity line (what one more 0.25 does), and the theme's score under the original reading as best you can state it; **"For the manager"**: the defects grouped by mechanism (the component or function you believe causes each, with file paths), the item each should become, and anything only the owner can decide.
- Write the deliverable **as you go** (commit it in your worktree at least every hour with `git -C $WT add <that file> && git -C $WT commit`), so a usage-limit stop leaves a usable PARTIAL. If a limit refuses a command, stop cleanly, mark the deliverable PARTIAL with what is left, and say so.

Commit message trailer (your own model's name):

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017DGPdGJqr95t3pMMcspXjE
```

Hard rules: no push, no branch, no product code, no new dependency; no `git checkout -- <file>`, `git restore`, `git reset`, rebase or amend; nothing per-user committed; never a key's value; stop only your own server. Report back in one paragraph: the head, the pass requirements, PASS count, extras, the score, the pack's path, the deliverable's commit hash.
