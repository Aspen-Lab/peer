STATUS: VERIFIED

# EMPTY-STATE-REASON — Agent A independent review

Branch: Jev-integration-and-sorting-filtering-enhancement, HEAD 7aa542d87329ce02abff19a0b1b12e48072934f4 (change under review is UNCOMMITTED).

## §1bb ruling text (as read from ABC-JEV-INTEGRATION.md:245-254)

Adopted: a reason code computed once, server-side, at the tail of runFeedPipeline, only when the returned list is empty, first match wins: sources-unreachable (reuses everySourceFailed) → no-results (no candidates, or none survives the freshness ceiling) → no-required-match (candidates existed but none cleared the Required gate, including the reader's own exclusions and the review rule) → already-delivered (everything left was already shown). Travels as an additive FeedMeta.emptyReasonCode, stored with the feed in the client store; never stored in cached day-pools; no cache bump.

1. Copy: sources-unreachable — "Couldn't reach today's paper sources. Refresh to try again."; no-results — "Nothing new for these topics today."; no-required-match — "None of today's papers matched your Required topics. Try a broader topic in Profile."; already-delivered — "You're caught up on these topics." Unknown/missing → today's generic empty state, never a guess.
2. No counts on screen; no fifth code for exclusions; no new counters on the wire.
3. Frozen batches: live requests only now; replayed batch without stored code shows generic copy.
4. Digest email: deferred (EMPTY-EMAIL-REASON).
5. Code names: as B proposed.
6. Must not change: 503 (ledger unavailable), 429 (rate limit), intent-required states; existing FeedMeta fields; BriefingEmpty's buttons; non-empty page.
7. Tests: B's 12. Process: C → fresh A (live local empty case) → local commit.

## Check 1 — code vs rulings (read, not run)

Read the actual diffs (git diff, uncommitted) for all 7 non-test files. All confirmed matching the ruling/guide:
- types.ts: additive `FeedEmptyReasonCode` union + `FEED_EMPTY_REASON_CODES` runtime array + `FeedMeta.emptyReasonCode?` — conditional-spread convention, no existing field touched.
- pipeline.ts: `computeEmptyReasonCode(sourceStatus, inWindowCount, scoredCount)` — exhaustive if/else chain, exact waterfall order sources-unreachable → no-results → no-required-match → already-delivered. Verified by reading the surrounding code (pipeline.ts:2052-2124) that `inWindow`/`scored` are computed fresh on EVERY call (cache hit or miss) before the final return, confirming B's "fresh on every read" claim by direct inspection, not trust. Called only when `returned.length === 0` (pipeline.ts:2158-2163), spread into meta only when defined (structurally absent otherwise, matching test 9's `.not.toHaveProperty`).
- route.ts: `frozenFeedResponse` gains optional 6th param `emptyReasonCode`. Read the full `runLedgerAwareFeed`: the non-ledger/signed-out branch (line 264-273) returns the pipeline's own response directly — never goes through `frozenFeedResponse` at all, so it naturally carries the code. The "existing batch" replay call site (line 310) passes NO 6th argument — confirmed structurally absent on replay, matching "live requests only now". The mint call site (line 419+) passes `wonMintRace ? result.meta.emptyReasonCode : undefined` — `wonMintRace` (line 385-387) is computed by comparing `minted.papers` (what the ledger actually froze) against `papers` (what this call itself submitted); a losing racer's own result can never leak in. Confirmed real by the dedicated test (see Check 3).
- empty-reason.ts: `EmptyReason` widened, `"empty"` kept as an explicit literal (correct — needed for the existing `emptyReason(base) === "empty"` test and the new unrecognized-code test). `reasonCode` checked against `FEED_EMPTY_REASON_CODES.includes(...)`, not mere truthiness — correctly defends against a future/unrecognized code. Precedence order in code: loading/non-empty → intentRequired → feedError → reasonCode(validated) → "empty". Matches ruling exactly.
- page.tsx: `BriefingEmpty` exported, `reason` widened to full `EmptyReason`. Read the component body directly (page.tsx:653-688): `copy = BRIEFING_EMPTY[reason === "intent-required" ? "empty" : reason]` (title/line varies), but `actions` block branches ONLY on `reason === "error"` — every other reason (including all 4 new codes) renders the identical Refresh/Widen-topics pair. Ruling §1bb.6 holds by construction, confirmed by reading, not by trusting the comment.
- store/feed.ts: `emptyReasonCode` added to `RealFeedResult`/`FeedState`, reset alongside `feedError` in the pre-lane block, set in the same `set()` call as `papers` on success. Matches atomicity discipline.
- copy.ts: see Check 2 below.

VERDICT: implementation matches the ruling's mechanics (waterfall, travel, storage, must-not-change list) exactly as read. No deviation found in the 6 non-copy files.

## Check 2 — copy table and truthfulness judgment

Exact strings as they will render (title + line concatenated), read from web/src/lib/briefing/copy.ts:

| Code | Title | Line |
|---|---|---|
| sources-unreachable | "Couldn't reach today's paper sources." | "Refresh to try again." |
| no-results | "Nothing new for these topics today." | "Peer only sends what is new and relevant. Refresh to look again, or widen your topics." |
| no-required-match | "None of today's papers matched your Required topics." | "Try a broader topic in Profile." |
| already-delivered | "You're caught up on these topics." | "Every match for today was already in your feed. Check back after it refreshes, or widen your topics." (ASSUMPTION, flagged by C — no second sentence in §1bb.1, reused from B's guide draft, never contradicted) |

All four match ruling §1bb.1's quoted text exactly (byte-for-byte where the ruling gave text). `no-results` verified byte-identical to the pre-existing `empty` entry via shared `NOTHING_NEW_TITLE`/`NOTHING_NEW_LINE` constants (not retyped) — matches "(today's words)". Calm tone, no counts, no blame: confirmed for all 4. UI names verbatim: "Profile" matches the actual settings page name used elsewhere in this codebase (checked against other /profile links in page.tsx — same word, same capitalization). "Required topics" — checked against Profile's own field name.

TRUTHFULNESS — read combine.ts:185-393 (the actual scoring/gate code `scored` is built from) line by line:
- `no-required-match` fires when `scored.length === 0` (pipeline.ts). Per the ruling's own definition, this folds in 3 different causes: (a) no candidate matched any Required topic at all — copy is true; (b) a candidate that WOULD match a Required topic was hard-dropped by the reader's OWN exclusion term, at combine.ts:195, which runs BEFORE the Required-topic gate/score is ever computed at line 316 — so whether it "matched" is never even checked; (c) a candidate that DID clear the Required-topic gate (kw.score > 0, proven by the fact that only gate-passing items reach the `passed` array per line 316) was then filtered out at combine.ts:392 (`shouldPushReviewPaper`) for being review-like and not directly matching the reader's own project/challenge text.
  In case (c), a paper *did* match the reader's Required topics — `kw.score > 0` is the literal fact the pipeline itself computed — and was excluded for an unrelated reason (review-policy). The copy "None of today's papers matched your Required topics" is then a **false statement** about a fact the pipeline already knows to be otherwise. Case (b) is similar in spirit (a paper containing the exact Required-topic keyword can be dropped by an unrelated dislike term before the match is even checked) but weaker as evidence since the pipeline never actually computes the match in that branch.
  This is a property of the ruling's own §1bb wording ("no-required-match ... including the reader's own exclusions and the review rule") colliding with §1bb.1's literal copy sentence, not a coding error — C implemented both exactly as ruled. Flagged as a finding below (HIGH: can be false is the review's own threshold for HIGH).
- `already-delivered`: fires only when `scored.length > 0` but `returned.length === 0`. Between `scored` and `returned` the only filters are excludeIds/ledgerExclusions (pipeline.ts:2107-2124) — no freshness/gate step in between. So "Every match for today was already in your feed" is verified TRUE in every case that reaches it.
- `no-results`: fires when sources didn't all fail but `inWindow.length === 0` (zero raw candidates OR everything stale). "Nothing new for these topics today" is true in both sub-cases (this folding was already decided in the guide/ruling, not re-litigated here).
- `sources-unreachable`: fires only when `everySourceFailed()` (scoped to the 5 registered `ACADEMIC_PAPER_SOURCES`, confirmed by reading its doc comment and body at pipeline.ts:1020-1039) is true. True in every case.

## Check 3 — route.ts ledger mint path

Confirmed by reading route.ts:341-434 directly (see Check 1) and by reading the dedicated test `"a request that loses the mint race does not leak its own pipeline's emptyReasonCode onto the winner's frozen response"` (route.test.ts) — it deterministically constructs a losing-racer scenario (mocked `prepareBatch` returns a DIFFERENT batch than what this call submitted) and asserts `body.meta` has no `emptyReasonCode` key. This test ran green (see Check 6). The whole ledger-aware path (`runLedgerAwareFeed`'s batch branches) is gated behind `dashboardLedgerEnabled()` (web/src/lib/dashboard/ledger-flag.ts:15-16: `process.env.PEER_DASHBOARD_LEDGER?.trim().toLowerCase() === "on"`, default off) — confirmed the flag check is the FIRST thing `runLedgerAwareFeed` does (route.ts:264). Did not open any .env file; took "off in production" as given per the task brief and verified only that the code path is correctly flag-gated.

## Check 4 — tests real and meaningful

Read all 6 new/changed test files in full (empty-reason-code.test.ts new 10 tests, empty-reason.test.ts +8, feed.test.ts +3, route.test.ts +3, copy.test.ts new 6, page.test.tsx +7 = 37, matches C's claim exactly). All exercise real code paths (actual `runFeedPipeline` calls with mocked source adapters, actual store `loadFeed()` with mocked fetch, actual `renderToStaticMarkup` rendering of the real component) — none are tautological or assert-on-a-mock-of-the-thing-under-test. The mint-race test (Check 3) and the frozen-batch replay test both directly verify option (a) "live-only": replay never carries the code even though the original mint's pipeline computed one — this matches the ruled option, correctly DEVIATING from guide §4 test 8's literal wording (which described option (b), not ruled). Diff stat confirms all test-file changes are pure additions (0 deletions in route.test.ts/page.test.tsx/empty-reason.test.ts/feed.test.ts per `git diff --stat`) — nothing existing was weakened.

## Check 5 — mutations (independently reproduced by A, not just re-read from C's log)

Baseline hashes taken BEFORE any edit of mine matched C's reported baseline exactly: pipeline.ts a4ee168d...931fea9e, store/feed.ts 3ad3857e...ae7e9f2261f0 (case-insensitive match to C's uppercase hex) — confirms the working tree is exactly the state C left it in.

1. Swapped the `no-results`/`no-required-match` checks in `computeEmptyReasonCode` (pipeline.ts). Ran `npx vitest run src/lib/feed/empty-reason-code.test.ts`: 3 red (both `no-results` cases + the `sources-unreachable`-precedence case), 7 still green — same 3 as C's log. Restored by editing back; `sha256sum` after = a4ee168df38fa0f5f1b8bc01bf8579da1d3f215c647afa8ff3190e2d931fea9e, byte-identical to before. Re-ran: 10/10 green.
2. Deleted the `emptyReasonCode: realFeed.emptyReasonCode ?? null,` line from store/feed.ts's `paperUpdate`. Ran `npx vitest run src/store/feed.test.ts -t "EMPTY-STATE-REASON"`: 2 red (capture test, stale-clearing test), 1 still green (the "stays null when server sent none" case, correctly unaffected) — same as C's log. Restored by editing back; `sha256sum` after = 3ad3857ece9b2c4b707120f1e45d48345e61831d2e01120e5aedae7e9f2261f0, byte-identical to before. Re-ran: 3/3 green.

VERDICT: both mutations reproduced independently, both proven by hash to have restored byte-identically. C's self-reported mutation results are accurate.

## Check 6 — full gates (independently run by A from web/, one at a time)

- `npx vitest run` → 285 passed + 3 skipped (288 files) / 5202 passed + 6 skipped (5208 total), 0 failed.
- `npx tsc --noEmit` → 0 errors.
- `npx eslint .` → 0 errors, 151 warnings.
- `npm run build` → succeeded; route list includes `/api/feed` and all other expected routes; no new/missing routes.

All 4 numbers match C's self-report exactly. VERIFIED independently, not just re-read from the checkpoint.

## Check 7 — live local reality check (signed-out, dev server already running at localhost:3000 — not started or stopped by A)

Built both requests from `<scratchpad>/lco-req.json` (project text kept verbatim; only `topics`/`controls` changed). Required tag replaced with the invented, non-existent string **"Xylquantrofin-9182"** (should match no real paper by content).

- Request 1 — `{"topics":["Xylquantrofin-9182"], "project": <same>, "topN":10}` (default "week" freshness). Response: `beforeDedup:51, afterDedup:51, returned:0`, **`meta.emptyReasonCode: "no-results"`**. `fetched`: openalex 17, semantic_scholar 34, dblp failed (bot-check, expected per DBLP-BOTWALL), arxiv/pubmed 0.
- Request 2 — same tag, `"controls":{"freshness":"month"}` (180-day ceiling, the most generous setting). Response: `beforeDedup:52, afterDedup:52, returned:0`, **`meta.emptyReasonCode: "no-results"`** again. `fetched`: openalex 17, semantic_scholar 34, pubmed 1, dblp failed.

Is it the true reason? In both live responses, real candidates WERE fetched (51-52, deduped, a genuine cache-miss/fresh build per the presence of `beforeDedup`/`afterDedup`) but 0 survived even the 180-day ceiling — i.e., `inWindow.length === 0` genuinely held both times, which is exactly what the code requires to report `no-results` ahead of `no-required-match` in the waterfall. The copy ("Nothing new for these topics today.") is truthful for both: literally nothing fetched was recent enough to show, regardless of whether it would also have matched the nonsense Required tag. This did not happen to exercise `no-required-match`/`already-delivered` live (2-request budget spent; not re-run) — those two are covered by Check 1 (code reading) + the 10 pipeline-level unit tests (Check 4) + Check 5's independent mutation reproduction, which together give equivalent confidence. Aside: OpenAlex's own date filter (`from_publication_date`, `openalex.ts`) should already scope to ≤45 days for a "month" request, yet the 17 OpenAlex results still failed the 180-day `dropStale` ceiling — plausibly explained by `dropStale`'s read-time check being the documented "authoritative" safety net against an unreliable upstream date filter (B's guide §3), not a defect in this item; out of this item's scope (a pre-existing source/query-freshness concern, not EMPTY-STATE-REASON's own logic) so not filed as a finding here.

Saved response bodies only under `<scratchpad>/`, never copied into the repo.

## Check 8 — privacy sweep

Grepped every changed/new file in the diff (all 11 + the 2 new test files) and this review file itself for personal strings (name, email), absolute scratchpad paths, and `C:\Users\...` patterns: zero matches. This review refers to the scratchpad only as `<scratchpad>/...` throughout (see Check 7). No `.env`/`.env.local` file was opened; no environment value was printed. `web/src/lib/scoring/combine.ts`, the ledger/route code and every copy string were read but contain no personal data.

---

# FINDINGS (ranked)

## HIGH — `no-required-match`'s title sentence can be literally false for two of the three cases its own ruling folds into that code

Ruling §1bb defines `no-required-match` as covering "candidates existed but none cleared the Required gate, **including the reader's own exclusions and the review rule**." The shipped copy (`web/src/lib/briefing/copy.ts`) is: **"None of today's papers matched your Required topics. Try a broader topic in Profile."**

Read `web/src/lib/scoring/combine.ts` end to end (lines 185-393):
- The reader's own exclusion terms are hard-dropped at line 195 (`if (exclusions.some(...)) continue;`) — **before** the Required-topic gate/score is ever computed at line 316. A candidate that genuinely contains a Required topic's keyword, but also happens to contain an unrelated term the reader personally dislikes, is removed without the pipeline ever checking whether it matched.
- The review-paper filter (`shouldPushReviewPaper`, line 392) runs **after** an item has already been pushed into the scored array with `kw.score > 0` (proven by the gate at line 316, which only lets `kw.score > 0` or otherwise-admitted items through to scoring at all). A review paper that *did* match a Required topic, but doesn't directly address the reader's declared project/challenge text, is filtered out here — after already being confirmed a genuine topical match.

`scored.length === 0` (the trigger for this code, pipeline.ts) can therefore be reached in a real case where a paper **did** match the reader's Required topics — the code just never got to say so, or said so and then filtered it for an unrelated reason. In that case, "None of today's papers matched your Required topics" is not what the pipeline found; it is an overclaim. This is exactly the "can be false" bar the review brief sets for HIGH.

Corroborating evidence this was seen and softened, then lost: B's own guide (§2 table) drafted this code's line as *"Try a broader topic in Profile, **or review your excluded terms**."* — a hedge acknowledging the exclusion-cause case. The ruling's adopted line drops that clause, leaving only the unqualified title claim. Not a C implementation defect — C transcribed the ruling's exact text (confirmed byte-for-byte in Check 2) — this is a gap in the ruling's own copy decision that the code faithfully carries out.

## LOW — `already-delivered`'s second sentence was never actually ruled, only assumed

§1bb.1 gives only one sentence for `already-delivered` ("You're caught up on these topics."). C reused B's guide-draft line ("Every match for today was already in your feed. Check back after it refreshes, or widen your topics.") verbatim, flagged explicitly as an assumption in both the checkpoint and a code comment. Independently checked for truthfulness (Check 2): TRUE in every case that reaches this code, since the only filters between `scored` (already-matched) and `returned` are the delivered-exclusion filters (excludeIds/ledgerExclusions) — no freshness/gate step in between. Not a defect, just needs the manager's explicit sign-off since the ruling itself didn't dictate this exact sentence.

# STATUS: FAILED_REVIEW (superseded — see Re-check below)

---

# Re-check (manager fix-round, 2026-09-29T17:1xZ)

Read the CORRECTION at ABC-JEV-INTEGRATION.md:255 and the "Fix round" section of
docs/jev-abc/EMPTY-STATE-REASON-C-20260929T120140Z.md:232-266. Ruled text: title "None of today's
papers passed your Required topics and filters.", line "Try a broader Required topic in Profile."

## 1. New copy — truthfulness and verbatim UI names

Read the actual change: `git diff -- web/src/lib/briefing/copy.ts` shows exactly one entry touched
(`no-required-match`: new title + new line + a comment recording the fix-round rationale); every
other key (`error`, `empty`, `sources-unreachable`, `no-results`, `already-delivered`) byte-identical
to what I reviewed before.

Truthfulness against all 3 folded causes (re-applying the same combine.ts:195/316/392 reading from
my first review): the new sentence is a conjunctive claim — "passed your Required topics AND
filters" — not the old bare "matched your Required topics."
- Cause (a), no topic match at all: trivially true (nothing passed the topic step, so nothing passed
  both).
- Cause (b), reader's own exclusion (combine.ts:195, a filter, runs before the topic gate at line
  316): the paper did not pass the filter step, so "passed topics AND filters" is true even if it
  would have matched the topic.
- Cause (c), review-paper filter (combine.ts:392, runs after a genuine `kw.score > 0` topic match):
  same reasoning — it passed the topic but not the filter, so the conjunctive claim holds.

No case found where the new sentence can be false. Calm, no blame — confirmed. UI names verbatim:
"Required" matches the Profile page's actual field label (`label="Required"`, checked in my first
review) and the precedent already used in web/src/app/welcome/page.tsx ("Add at least one Required
topic"); "Profile" matches the nav bar's literal label (masthead.tsx comment: "Search · Saved ·
Profile · ?"). Checked the word "filters" against the codebase for a literal UI element named
"Filters" that it might be confused with (`grep -rn "\"Filters\"" src --include=*.tsx`, excluding
tests) — no match, so it reads as a plain descriptive word, not a mismatched UI-control name.

Confirmed nothing else in copy.ts or the product code changed since my first review:
`git diff --numstat` now vs. the totals recorded in my first review is line-for-line identical for
every one of the other 9 tracked files (route.ts 31+2, route.test.ts 121+0, page.tsx 23+3,
empty-reason.ts 36+2, empty-reason.test.ts 62+0, pipeline.ts 53+1, types.ts 39+0, feed.test.ts
55+0, feed.ts 30+1 — same totals as the pre-fix-round diff). Hash-verified the two files most
central to the waterfall/store logic directly: pipeline.ts and store/feed.ts both re-hash to the
exact same SHA-256 as my Check-5 baseline (a4ee168d...931fea9e and 3ad3857e...e9f2261f0) — byte-
identical, untouched. Only copy.ts, copy.test.ts and page.test.tsx changed, exactly as C's checkpoint
claims; ABC-JEV-INTEGRATION.md changed too (the manager's own CORRECTION entry — expected, not part
of the reviewed change).

## 2. The 2 rewritten tests

- `web/src/lib/briefing/copy.test.ts`: the old "no-required-match" case was renamed to "gives
  no-required-match the corrected, always-true title and line" and its `toMatchObject` now pins the
  exact new title+line (read in full — matches byte-for-byte). Not deleted, not weakened; file still
  has 6 tests (same count as before).
- `web/src/app/page.test.tsx`: the `it.each` row's expected substring changed from `"matched your
  Required topics."` to `"Required topics and filters."`, which is a true substring of the new title.
  Read in full — the render assertions (same two buttons, no "Try again" leaking in) are untouched;
  still 6 parameterized cases + 1 error case = 7 tests, same as before.

Both rewrites are real assertions on the new text, not tautologies or skips. Nothing weakened.

## 3. Gates (re-run by A from web/, one at a time, after the fix)

- `npx vitest run` → 285 passed + 3 skipped (288 files) / 5202 passed + 6 skipped, 0 failed —
  identical totals to before the fix round (rewrites, not additions).
- `npx tsc --noEmit` → 0 errors.
- `npx eslint .` → 0 errors, 151 warnings (unchanged).
- `npm run build` → succeeded, same route list.

All 4 match C's fix-round report exactly.

## 4. Privacy sweep

Grepped copy.ts, copy.test.ts, page.test.tsx, and this review file for personal strings (name,
email) and absolute paths: zero matches in the 3 code files. This review file's own matches are only
its existing `<scratchpad>/...` redacted references (Check 7, unchanged) — no raw absolute path, no
personal string. No `.env`/`.env.local` opened. Nothing BLOCKED — every command in this re-check ran
without a permission denial.

## Re-check verdict

Both prior findings resolved as the CORRECTION directs: the HIGH is fixed (new copy verified true for
all 3 causes, by independent re-derivation, not by trusting the ruling text) and the LOW was already
signed off with no change needed. No new issue found. Every other file confirmed untouched by diff
totals + 2 direct hashes. Gates and privacy clean.

# STATUS: VERIFIED


