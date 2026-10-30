# P12 tools — the manager's harnesses, carried out of the old session's scratch

These are the tools the P12 manager and its workers used. They are kept here for the colleague who takes over (`docs/reading-helper-abc/HANDOFF-P12-COLLEAGUE.md`). **They are not product code.** Copy them to your own scratch before running them, and never run them from inside the repository.

## Placeholders

Every absolute path was replaced with a placeholder. Fill the placeholders in your copy:

```
cp -r docs/reading-helper-abc/p12-tools "$SCRATCH/p12/tools-src"
grep -rl '__P12_' "$SCRATCH/p12/tools-src" | xargs sed -i "s#__P12_SCRATCH__#$SCRATCH#g; s#__P12_PDF_DIR__#$PDF_DIR#g"
```

- `__P12_SCRATCH__`: your scratch directory. The old layout under it is `p12/mgr/` (the manager), `p12/r2/a<NN>/` (an A's walk), `p12/a57/` (the C1 harness) and `p504/wt` (the manager's verify tree V).
- `__P12_PDF_DIR__`: a directory **outside the repository** that holds the owner's six papers, named `P1.pdf` … `P6.pdf`. The handoff says which paper is which. Never commit, copy into a worktree or quote these files.
- Other absolute paths, such as the verify tree, are written in the scripts themselves. Read each script before you run it.

## What is here

| Folder | What | Notes |
|---|---|---|
| `manager/` | `map-dump-v.test.ts` and `vitest.vf.config.mjs` | They dump the reading map as the page builds it, for one PDF. Set `MGR_PDF` and `MGR_OUT`. The config's `WEB` is the verify tree's `web/`. |
| | `dump-all.sh <tag>` | Dumps and C0-scores P1–P6. It calls `score-c.py`, which no longer exists here. Change those lines to `python3 score-structure.py c0 …`. |
| | `score-structure.py` | Scores against **`truth-hashed.json`**: the ruled parts (role, plus a sha256 of each part's normalized 40-character start). There is no word of a paper in it. `c0-rows-hashed.json` holds the current C0 rows (heading hash, role, level), for C1's "rows unlike C0". |
| | `gates-v.sh` | The full gates on V: lint, the whole suite with `TZ=America/Chicago --maxWorkers=2`, and the build. Run `npx tsc --noEmit` before it. |
| | `mut.py NAME FILE OLDFILE NEWFILE TESTS…` | The manager's own mutation. It applies OLD→NEW in V, runs the tests and restores the file byte-identical, checking the sha256. |
| | `diff97.py` | The before/after word diff of every paragraph of P1–P6 (§1h.491). |
| `walk/` | A P12-92's Theme B walk harness | `lib.cjs` holds the shared setup. `chain_*.sh` and `cell_*.cjs` hold the cells; `make_index92.py` builds the pack index. `fourword.py` and `words_fidelity.py` are the privacy and fidelity checks. |
| `c1/` | A P12-57's keyed C1 harness | The newest generation is `*9*` (`keyed9.mjs`, `runall9.sh`, `runone9.sh`, `analyze9.mjs`, `gen9.mjs`), plus the `hygiene*.mjs` scripts and `fourgram.py`. The key is read from the environment and typed into the Profile form only (BYOK). It is never printed. |
| `readers/spawn-B.txt` | The blind readers' spawn text for Theme B | Fill `__OUT__` and `__HEAD__`, both everywhere they occur (`sed …/g`). |

## The privacy checks before anything is committed

- **No run of four or more words of a paper.**
  1. Make `pdftotext` text of `P1.pdf` … `P6.pdf` into `$SCRATCH/p12/mgr/qcheck/`. These text files stay out of the repository.
  2. Check every deliverable against them, as `c1/fourgram.py` does. Generic phrases such as "and one or more" may be reworded rather than argued.
- **No key value.** Count the occurrences of `$PEER_TEST_GEMINI_API_KEY` in every file you wrote, without printing it. The count must be 0.
