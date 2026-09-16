# Follow-up ledger — branch `complimentary-enhancement-to-main-update`

Source of truth for the hourly clock on this branch. One tick = read this file, do at most ONE open item, update §1/§2/§4, stop.

## §0 Turn lock

- **Writer:** none
- Rule: a tick that finds a writer other than itself stands down without touching anything. A tick sets `Writer: clock <local time>` before working and clears it when done. The user's interactive session always outranks the clock: if a user message arrived since the last tick, answer it and let the clock idle.

## §1 Done (verified in the browser unless noted)

1. **Search box on the briefing** — right of the day strip, `/` focuses it, Enter → `/search?q=`. Search page now says "search failed" on an index error instead of "no results"; `/api/papers/search` reads `OPENALEX_EMAIL`.
2. **Figures on the reading page** — root causes fixed: `OPENALEX_EMAIL` set locally (Unpaywall lookups now run), PyMuPDF installed, PDF helper output moved from stdout to a file (`--output`; two real bugs), `extract_pdf_text.py` import fixed. Per-section figure lookup restored in `components/reader/report-sections.tsx` with a page-level dedupe registry.
3. **Report content restored** — `PaperReport` regained `whatItProposes.novelty[]`, `keyResults[].novelty`, `reviewContents`, `whyItFitsYou`; both prompts (deep pass 2, abstract tier) ask for them; sanitizer + tests; cache key v5; Markdown export carries them. Reading page order: old sections (novelty / proposal / method / results+figures or review contents / fit / glance / related) ABOVE the rewrite's blocks (caveats / next step / paper body / record). Abstract-tier report moved to the `large` model tier (evidence sentences were being paraphrased and every claim dropped).

4. **Deep reports read the whole paper** — pass 1 gets every section (incl. Conclusions), 400k-char budget, PDFs to 100 pages; the evidence checker folds PDF artifacts (fraction slash, line-break hyphen, zero-width chars) and indexes figure captions; page-footer/page-number furniture stripped at extraction; pass 2 asks for 2–4 key results. Publisher 403 → "paywalled", aggregator 403 → "blocked".
5. **Figures** — graphical-abstract (og:image) candidate with an honesty guard; Semantic Scholar queue + retry, and a 429 never masks the publisher outcome; bounce/bot-check pages reported honestly. Of the user's 17 briefing papers only 1 exposes a figure Peer may use (9 paywalled, Springer bot walls, one figure-less manuscript) — honest absence elsewhere.
6. **Scramble ("matrix") reveal** — `components/scramble-text.tsx` restored; fires only on a freshly generated report, cached reports render plain; reduced motion → fade.
7. **"What is new" merged into "What it proposes"; "Why it fits you" removed** — both prompts, sanitizer, page, Markdown export, copy; cache key v6.
8. **PDF upload → deep report** — black upload button left of the search box (click or drop); `POST /api/papers/upload` stores under `web/.local-data/uploads/` (local to this machine), `upload:<sha16>` ids flow through the same report/figure/save pipeline; full titles from page-1 layout (model fallback, then file name); a textless PDF shows a plain message instead of a report.
9. **Justified reading prose** — `reading-justify` utility on the report's body paragraphs, quotes, abstract and paper body; titles, labels, pull quotes, captions, byline and Decision line stay left; left while a ScrambleText is still revealing.
10. **Upload button hover** — pointer cursor, glyph swells to 1.25× in 120 ms; same cue on drag-over; none while disabled.
11. **Open-paper latency** — one Semantic Scholar lookup per paper, 3 s enrich grace, 1/2/4 s backoff, 10-min empty-pool cache, og:image fallback cached; today's briefing papers persisted so a hard refresh renders a cached report in < 1 s.
12. **Large PDF upload** — Next 16 proxy body limit raised to 30 MB (`experimental.proxyClientMaxBodySize`); Content-Length pre-check → honest 413 above 25 MB; client refuses oversize inline. The user's 14.5 MB Zotero PDF now uploads and reads.

Also on this branch, from before the pull: search-provider failures now surface in `meta.errors` (`lib/sources/search-failure.ts`), `kill-dev-orphans.mjs` catches the server process, `scoring.test.ts` clock pinned.

## §2 Open (the user adds; the clock takes the top item)

_(none — S3–S7 (2026-09-15) and S8–S11 (2026-09-16) closed via the ABC loop in `docs/handoff/ABC-followup-round2.md`; see §1 items 4–12)_

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

- 2026-09-15 ~22:10 UTC — ABC loop closed: 4 rounds, all five items verified; gate tsc/eslint clean, vitest 2639/2639; clock deleted. Not pushed.

- 2026-09-16 — loop reopened for S8–S11 (round 5), closed the same day; gate tsc/eslint clean, vitest 2646/2646; clock deleted. Not pushed.

## §5 Authorizations

- Commit to the branch: **authorized by the user 2026-09-14** ("commit, with descriptions of each commit")
- Push to origin: **not yet authorized**
