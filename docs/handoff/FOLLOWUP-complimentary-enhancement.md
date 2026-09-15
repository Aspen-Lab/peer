# Follow-up ledger — branch `complimentary-enhancement-to-main-update`

Source of truth for the hourly clock on this branch. One tick = read this file, do at most ONE open item, update §1/§2/§4, stop.

## §0 Turn lock

- **Writer:** none
- Rule: a tick that finds a writer other than itself stands down without touching anything. A tick sets `Writer: clock <local time>` before working and clears it when done. The user's interactive session always outranks the clock: if a user message arrived since the last tick, answer it and let the clock idle.

## §1 Done (verified in the browser unless noted)

1. **Search box on the briefing** — right of the day strip, `/` focuses it, Enter → `/search?q=`. Search page now says "search failed" on an index error instead of "no results"; `/api/papers/search` reads `OPENALEX_EMAIL`.
2. **Figures on the reading page** — root causes fixed: `OPENALEX_EMAIL` set locally (Unpaywall lookups now run), PyMuPDF installed, PDF helper output moved from stdout to a file (`--output`; two real bugs), `extract_pdf_text.py` import fixed. Per-section figure lookup restored in `components/reader/report-sections.tsx` with a page-level dedupe registry.
3. **Report content restored** — `PaperReport` regained `whatItProposes.novelty[]`, `keyResults[].novelty`, `reviewContents`, `whyItFitsYou`; both prompts (deep pass 2, abstract tier) ask for them; sanitizer + tests; cache key v5; Markdown export carries them. Reading page order: old sections (novelty / proposal / method / results+figures or review contents / fit / glance / related) ABOVE the rewrite's blocks (caveats / next step / paper body / record). Abstract-tier report moved to the `large` model tier (evidence sentences were being paraphrased and every claim dropped).

Also on this branch, from before the pull: search-provider failures now surface in `meta.errors` (`lib/sources/search-failure.ts`), `kill-dev-orphans.mjs` catches the server process, `scoring.test.ts` clock pinned.

## §2 Open (the user adds; the clock takes the top item)

_The 2026-09-15 batch (S3–S7) runs as an ABC loop — see `docs/handoff/ABC-followup-round2.md`. This ledger is not the clock's source of truth while that loop is open._

## §3 Rules for a tick

1. Read §0. Stand down if someone else is writing.
2. No open item → run `npx tsc --noEmit` and `npx vitest run --exclude "**/benchmark.test.ts"` in `web/`; log one line in §4; that is the whole tick (noop).
3. Open item → take the top one only. Bounded work; no AI subagents unless the item says so. Verify in the browser when the change is visible (the dev server is `peer-web` in `.claude/launch.json`). Move the item to §1 with what was verified.
4. **Never commit or push unless §5 says the user authorized it.** Uncommitted work stays on the branch's working tree.
5. A usage-limit or spawn error is a no-op for that tick; retry next tick. Do not slow the clock down.
6. Report to the user in plain language, ADHD-shaped, Chinese unless they wrote in English; noop ticks get one line.

## §4 Log

- 2026-09-13 ~02:10 — clock started. Three items done, nothing open. Working tree uncommitted (31 files).

- 2026-09-13 02:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 03:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 04:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 05:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 06:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 07:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 08:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 09:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 10:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 11:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 12:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 13:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 14:35 — noop tick: tsc clean, 2546/2546 tests pass, nothing open.

- 2026-09-13 15:27 — clock stopped by the user after 13 noop ticks; nothing changed on the branch since it started.

- 2026-09-14 — user authorized commits ("commit, with descriptions of each commit"); 12 commits landed (search box, figures, restored sections, Tavily removal, Gemini 3.x, Vertex global-only, arXiv PDF hand-off, report tier knob).

- 2026-09-15 — new batch S3–S7 opened as an ABC loop (`ABC-followup-round2.md`); hourly clock restarted for that loop.

## §5 Authorizations

- Commit to the branch: **authorized by the user 2026-09-14** ("commit, with descriptions of each commit")
- Push to origin: **not yet authorized**
