# DIGEST-CATCHUP — A (independent reviewer) report

STATUS: VERIFIED

Repo: D:/local files on this PC/Github/Peer/peer
Branch: Jev-integration-and-sorting-filtering-enhancement
HEAD: e143f2347b031cfb1d0e67c0701bf62aa6c7f669
Review started: 2026-09-29T16:13:25Z (UTC)
Review finished: 2026-09-29T (see final gate run timestamps in Check 7)

This file is written incrementally, one check at a time, so it stands on its own if the reviewer is cut off.

## Reading list (status)

- [x] ABC-JEV-INTEGRATION.md §1bf (points 1-9 + point-9 AMENDMENT "fail closed") — read in full (lines 246-257)
- [x] docs/jev-abc/DIGEST-CATCHUP-B-20260929T153008Z.md — read in full
- [x] docs/jev-abc/DIGEST-CATCHUP-C-20260929T155843Z.md — read in full (rounds 1+2, 4 judgment calls)
- [x] git diff HEAD -- web/ (route.ts +140/-11, route.test.ts +372/-11) — read in full, confirmed via `git diff HEAD --stat -- web/` this is the ONLY web/ change
- [x] web/src/lib/dashboard/timezone.ts — read in full
- [x] web/src/app/api/jobs/prepare-dashboards/route.ts (budget pattern) — PREPARE_DRAIN_WALL_CLOCK_BUDGET_MS = 200_000 confirmed
- [x] .github/workflows/digest-cron.yml + web/src/app/api/jobs/digest-cron-workflow.test.ts — read in full; jq filters confirmed count-only

## Checks (status) -- ALL DONE

1. Ruling compliance — PASS
2. End-to-end replay via real GET handler — PASS (exact match to B's numbers, both before and after)
3. Edge cases by execution — PASS, 1 new finding (timezone change)
4. Budget judgment calls — PASS
5. Flag-on path unchanged — PASS
6. Mutation testing — PASS (4/4 mutations caught; 1 LOW finding on C's self-report accuracy)
7. Gates (vitest/tsc/eslint/build) — PASS, matches C's reported numbers exactly
8. Accepted/deferred item registry — PASS, all re-listed below
9. Privacy scan — PASS, 0 hits

## Check 1 — Ruling compliance (§1bf points 1-9)

Verified by reading the full diff + full route.ts (not just the hunks):

- **Only 2 files changed under web/**: confirmed, `git diff HEAD --stat -- web/` shows exactly `route.ts` (+140/-11) and `route.test.ts` (+372/-11). `git status --porcelain` (repo-wide, excluding node_modules) shows no migration/.env/vercel.json/workflow/Profile-page file touched — only those 2 files + the manager's own ABC-JEV-INTEGRATION.md + 3 untracked docs/jev-abc/*.md.
- **Hour test `<` on both paths**: `if (hour < row.digest_hour_local)` (route.ts:404) sits BEFORE the flag-on/flag-off branch (which only starts at line 476/548) — structurally shared by both paths. Reason renamed `hour_mismatch` -> `before_chosen_hour` everywhere (skippedReasons).
- **Invalid timezone never sends**: `hourInTimezone` returns `-1` on a caught exception (timezone.ts:37-39, confirmed by reading), and `-1 < h` for every `h` in 0..23 including 0 (strict `<`, not truthiness) -- confirmed by code reading; will confirm by execution in check 3.
- **Same-date guard flag-off-only, before the pipeline**: wrapped in `if (!isDigestDedupeEnabled())` (route.ts:476-495), placed after the untouched 6h lookback and before the 30-day exclusion query (route.ts:499) and the `runFeedPipeline` call (route.ts:514). Uses `dateInTimezone` (imported, real helper) inside the new pure `hasDeliveryOnLocalDate` -- no hand-rolled offset math (confirmed by reading both).
- **Fails CLOSED on a read error**: route.ts:483-487 -- `if (recentForDateErr) { bumpReason(failedReasons, "delivery_check_error"); logJobIssue(...); continue; }` runs BEFORE `hasDeliveryOnLocalDate` is ever called; raw error text only reaches `logJobIssue` (-> `console.warn`), never the JSON response (route.test.ts's own new test asserts `JSON.stringify(body)` excludes the raw string; will re-verify by execution).
- **Pre-existing 6-hour read byte-identical**: confirmed structurally -- in the raw diff, the hunk covering the 6h block (`@@ -364,6 +443,57 @@`) shows 6 lines of UNCHANGED context (the entire 6h query + its `if (recent...)` skip) followed only by 51 pure ADDED lines (0 removed) for the new same-date block. The 6h query's own code was not part of any `-`/`+` pair anywhere in the diff.
- **Budget constant and placement**: `DISPATCH_WALL_CLOCK_BUDGET_MS = 240_000` (route.ts:208) -- matches the ruling's literal "about 240 s" and mirrors prepare-dashboards' own `PREPARE_DRAIN_WALL_CLOCK_BUDGET_MS = 200_000` naming/comment style (that file's `maxDuration = 300` comment literally says "matches dispatch-digests/route.ts's own ceiling", cross-confirming both routes share the 300s ceiling). Check placed at route.ts:427-430, AFTER the hour/frequency/intent gates and BEFORE the `try` block (so a reader who wasn't due anyway still reports their true reason regardless of budget, and the budget only gates the expensive per-reader DB/pipeline work) -- matches C's judgment call 1 and prepare-dashboards' own split between due-selection and drain-phase gating.
- **Reason vocabulary**: `before_chosen_hour`, `already_delivered_today`, `deferred_time_budget` (skippedReasons), `delivery_check_error` (failedReasons) -- all 4 present verbatim in route.ts, matching the ruling exactly.
- **Response shape unchanged**: the final `NextResponse.json({...})` block (route.ts:688-703) is untouched by the diff (no hunk touches it) -- still counts + fixed-vocabulary tallies only, no per-reader data, no raw text.
- **No migration/.env/vercel.json/workflow/Profile change**: confirmed via `git status` above -- nothing outside the 2 route files (+ the manager's own state-file/docs) is dirty.

VERDICT for check 1: PASS, no findings.

## Check 2 — End-to-end replay through the REAL GET handler

Method: wrote a temporary probe `web/src/app/api/jobs/dispatch-digests/__a_probe_replay.test.ts` (deleted at the end of this review; proof in "Cleanup proof" below). It:
- mocked only `createAdminClient`/`runFeedPipeline`/`sendDigestEmail` (same convention as route.test.ts), leaving `GET` and the real `timezone.ts` helpers unmocked;
- built a STATEFUL in-memory `briefing_deliveries` table (a real filtering chain for `.eq`/`.gte`/`.limit`, an `insert` that actually appends a row with `delivered_at = new Date().toISOString()` under the fake clock);
- fetched the REAL "Hourly digest dispatch" run history myself, independently of B: `GET https://api.github.com/repos/Aspen-Lab/peer/actions/workflows` -> resolved id `266890338` (matches B's id) -> `GET .../workflows/266890338/runs?event=schedule&created=2026-09-17..2026-09-29&per_page=100` -> 67 runs, one page, no pagination needed. Per-UTC-day counts computed independently: `6,5,7,6,5,5,6,5,5,6,5,3,3` for 09-17..09-29 -- byte-for-byte identical to B's table (DIGEST-CATCHUP-B �2.1), and my run list's first/last timestamps (`2026-09-17T00:28:15Z` .. `2026-09-29T13:59:40Z`) match B's cited examples verbatim;
- replayed all 67 real timestamps through the real `GET` handler for 24 synthetic America/Chicago daily readers (chosen hour 0-23) + 1 weekly (Monday, hour 9) + 1 weekdays (hour 9) + 1 invalid-timezone (hour 12) reader, using the SAME persistent table/client across all 67 calls (so a run's insert is visible to the next run, like the real DB);
- bucketed results by local date via the real `dateInTimezone` helper, using B's own "drop the first and last touched local date as boundary-partial" methodology (independently re-derived: first/last local dates in my window were 2026-09-16 / 2026-09-29, leaving the same 12 fully-observed days 09-17..09-28 B used).

Ran this replay TWICE: once against the reviewed code (`<`, AFTER), once against the code with the hour test reverted to `!==` (BEFORE) -- the same revert used for mutation 1 in Check 6, sha256-proven restored afterward.

### Replay table -- before vs after, per chosen hour (America/Chicago, 12 fully-observed local days, 2026-09-17..2026-09-28)

| hour | BEFORE (`!==`), my execution | BEFORE, B reported | AFTER (`<`), my execution | AFTER, B reported |
|---:|---:|---:|---:|---:|
| 0 | 33.3% (4/12) | 33% | 100% (12/12) | 100% |
| 1 | 25.0% (3/12) | 25% | 100% (12/12) | 100% |
| 2 | 16.7% (2/12) | 17% | 100% (12/12) | 100% |
| 3 | 0% (0/12) | 0% | 100% (12/12) | 100% |
| 4 | 25.0% (3/12) | 25% | 100% (12/12) | 100% |
| 5 | 8.3% (1/12) | 8% | 100% (12/12) | 100% |
| 6 | 25.0% (3/12) | 25% | 100% (12/12) | 100% |
| 7 | 8.3% (1/12) | 8% | 100% (12/12) | 100% |
| 8 | 33.3% (4/12) | 33% | 100% (12/12) | 100% |
| 9 | 33.3% (4/12) | 33% | 100% (12/12) | 100% |
| 10 | 0% (0/12) | 0% | 100% (12/12) | 100% |
| 11 | 33.3% (4/12) | 33% | 100% (12/12) | 100% |
| 12 | 16.7% (2/12) | 17% | 100% (12/12) | 100% |
| 13 | 25.0% (3/12) | 25% | 100% (12/12) | 100% |
| 14 | 25.0% (3/12) | 25% | 100% (12/12) | 100% |
| 15 | 41.7% (5/12) | 42% | 100% (12/12) | 100% |
| 16 | 16.7% (2/12) | 17% | 100% (12/12) | 100% |
| 17 | 41.7% (5/12) | 42% | 100% (12/12) | 100% |
| 18 | 41.7% (5/12) | 42% | 100% (12/12) | 100% |
| 19 | 25.0% (3/12) | 25% | 83.3% (10/12) | 83% |
| 20 | 33.3% (4/12) | 33% | 58.3% (7/12) | 58% |
| 21 | 0% (0/12) | 0% | 25.0% (3/12) | 21-25% |
| 22 | 0% (0/12) | 0% | 25.0% (3/12) | 21-25% |
| 23 | 25.0% (3/12) | 25% | 25.0% (3/12) | 21-25% |

**Every single hour matches B's reported number exactly**, independently reproduced through the REAL `GET` handler (not a standalone simulation script) against REAL GitHub run timestamps I fetched myself. This is the strongest form of confirmation available offline.

Additional invariants checked by execution in the SAME replay:
- `doubleSendViolations`: `[]` in BOTH the before and after runs -- across all 26 readers, over the WHOLE 67-run window (not just the 12 fully-observed days), no reader/local-date pair was ever sent more than once.
- Weekly reader (chosen hour 9): sent on `2026-09-21` and `2026-09-28` only under AFTER -- both independently confirmed to be Mondays (`getUTCDay() === 1`); never sent under BEFORE at all within this real window (illustrating how bad the pre-fix bug was for low-frequency readers: a weekly digest could go multiple real weeks without ever landing on an exact-hour match).
- Weekdays reader (chosen hour 9): sent on 9 real weekdays under AFTER, never on a Saturday/Sunday (asserted, passed).
- Invalid-timezone reader: never sent, either run, any hour.
- Every one of the 67 real `GET` calls returned HTTP 200 (asserted per-call).

## Check 3 — Edge cases by execution

| Edge case | Method | Result |
|---|---|---|
| Chosen hour 0 | Product's own dedicated test (clean gate run) + my MAIN REPLAY's `hour-0` reader (100%/12) | PASS |
| DST spring-forward (2026-03-08, America/Chicago) | Product's own dedicated test (clean gate run) | PASS |
| DST **fall-back** (2026-11-01, America/Chicago, 01:00-01:59 occurs twice) | Product has NO test for this -- I wrote one in the probe: reader chosen hour 1, hit at 06:15Z (first 01:15 CDT occurrence, sends), 07:45Z (second 01:45 CST occurrence, 1.5h later -- caught by the pre-existing 6h guard, `recent_delivery`), 14:00Z (7h45 after the first send, same local date -- caught by the NEW 26h guard, `already_delivered_today`) | Exactly 1 real send across all 3 runs. PASS -- `dateInTimezone`/`hourInTimezone` (Intl-based) resolve both occurrences of the repeated local hour correctly with no special-casing needed. |
| Weekly/weekdays never sent on a non-admitted day even when caught up | Product's own 2 dedicated tests (clean gate run) + my MAIN REPLAY (real 67-run data, see Check 2) | PASS, doubly confirmed |
| Two runs 20 minutes apart | Product's own test uses a 2-hour gap, not literally 20 minutes -- I wrote a dedicated 20-minute-gap test in the probe (09:10Z send, 09:30Z second run) | Second run correctly `recent_delivery` (the OLD 6h guard, not the new one). PASS. |
| A reader who changes timezone after a morning send | No ruling or existing test covers this -- I wrote a dedicated probe test | **See Finding F1 below -- a real second send occurs.** |
| A 26-hour read error (fails closed) | Product's own dedicated test (clean gate run) + my mutation 4 (AMENDMENT fail-open revert) turns exactly that test red | PASS |
| An invalid timezone | Product's own dedicated test (clean gate run) + my MAIN REPLAY's `invalid-tz-12` reader (never sent across 67 real runs, either code version) | PASS |

## Check 4 — Budget judgment calls

- **Checked before any per-reader DB call?** Yes -- route.ts:427-430, after the (cheap, in-memory) hour/frequency/intent gates and before the `try` block that contains every DB/pipeline call. Confirmed by reading AND by execution: my own independently-written budget probe (5 readers, first pipeline call advances the fake clock by 250s) showed `insertFn` called exactly once and the in-memory table left at length 1 -- the other 4 readers triggered zero DB calls of any kind.
- **Deferred readers left untouched (no row, no email)?** Confirmed by execution (same probe): `table.length === 1`, `sendDigestEmail` called exactly once, `skipped_reasons.deferred_time_budget === 4`.
- **Does the test really exercise elapsed time?** Yes. Both C's test and my independently-written version use `vi.advanceTimersByTime()` inside a mocked `runFeedPipeline` call to move the FAKE `Date.now()` forward past the budget -- I re-derived this technique myself (not copied) and it produced the correct deferred count, confirming the mechanism genuinely reads real elapsed wall-clock time (`Date.now() - startedAtMs`), not a stubbed function.
- **Would a real slow run defer correctly?** The guard reads the real JS/OS wall clock (`Date.now()`), the same primitive whether under fake or real timers -- there is no code-path difference between "real slow" and "fake-timer-advanced" as far as this check is concerned, so I have high confidence without being able to prove it against a genuinely slow live run (would need a live deployment, outside this review's offline scope).
- **C's 4 judgment calls, individually:**
  1. Budget check placed after the cheap gates, before DB/pipeline work -- AGREE. Matches prepare-dashboards' own split (gates only the expensive phase), and correctly avoids miscounting an already-not-due reader as "budget-deferred."
  2. `vi.advanceTimersByTime` inside a mocked pipeline call, instead of a full deps-injection refactor -- AGREE. Lower-risk, still exercises the real guard against real elapsed-time semantics (independently re-verified, see above), avoids an invasive rewrite of a heavily-tested route.
  3. `hasDeliveryOnLocalDate` extracted as a new pure exported helper -- AGREE. Matches this file's existing convention (`frequencyAdmitsToday`, `seedTextsFromRow`), and I exercised it indirectly through the real `GET` path in every probe test, not just its own unit tests.
  4. `idempotency.test.ts` left unmodified -- VERIFIED BY READING (not just trusting C's claim): that file's own local `makeAdminClient` (idempotency.test.ts:111-115) routes `cols === "id"` -> `recent`, `cols === "id, payload"` -> `conflictSelectFn()`, and everything else (including the new `"delivered_at"` query) falls through to the `past` slot, which its one flag-off test never populates (defaults to `{data:[],error:null}`) -- confirmed structurally correct, and cross-confirmed by execution (all 18 of that file's tests pass unchanged in the clean gate run).

## Check 5 — Flag-on path unchanged

- Full clean suite run (Check 7) shows all pre-existing claim/`already_claimed`/`already_sent`/retry-ladder tests green, including the entire `idempotency.test.ts` file (18/18).
- The new dedicated test "flag-on path: the catch-up hour rule composes with the existing claim/already_claimed ladder unchanged; the new same-date query is never issued" passed in the clean run -- it directly asserts (by execution, via a `vi.fn()` spy on `select`) that no `"delivered_at"` query is EVER issued when `PEER_DIGEST_DEDUPE=on`, not merely that the code LOOKS like it wouldn't.
- Mutation 1 (Check 6) independently confirms the flag-on path's own test is sensitive to the hour-gate change (it went red), proving the flag-on test suite is not accidentally vacuous.

## Check 6 — Mutations (sha256-proven before/after each)

Baseline hash (route.ts, reviewed state): `a0c35742982474806d13115c8a9aebc20e822d87dbcab9764971e60380ef52f2` -- matches EXACTLY the hash C's own checkpoint reports for "Round-2 baseline," confirming the working tree is byte-identical to what C claims to have left.

| # | Mutation | Mutated hash | Tests red | Restored hash matches baseline? |
|---|---|---|---:|---|
| 1 | `hour < row.digest_hour_local` -> `hour !== row.digest_hour_local` | `e3c19a28d7a952b1844429c0cf4a3801f0b4c63cb7a04685543bf42ae152e337` | **9** (see Finding F2 -- different membership than C's self-report, same code) | Yes |
| 2 | `hasDeliveryOnLocalDate(...)` -> `false && hasDeliveryOnLocalDate(...)` | `49b9009d4095d8ccae3a04e808b53e6d8bf0a8455f8f12f7cd659a2e4f0ada96` | 1 (exactly the ">6h same-date" test) | Yes |
| 3 | wall-clock check -> `false && (Date.now() - startedAtMs >= ...)` | `2156d53d1ef1d715a6e0de13920f00f3e4ac0edcc2c36740b2be783664a087bf` | 1 (exactly the budget test) | Yes |
| 4 (AMENDMENT) | `if (recentForDateErr)` -> `if (false && recentForDateErr)` (fail-open again) | `c22bc4f21fea547caf68feb983fc388f3e28f933f5a3385c55ea8bb4baa9d46b` | 1 (exactly the "fails CLOSED" test) | Yes |

Mutation 4's hash matches C's own reported mutation hash for the identical edit EXACTLY (`c22bc4f2...`), an independent cross-check that C's round-2 report is accurate for that mutation. Every mutation turned at least one real test red (none turned zero -- no finding under the task's "mutation that turns nothing red" bar), and every restore returned the file to the exact reviewed-state hash. Final confirmation after all 4 mutations: `git diff HEAD --stat -- web/` still reads `route.ts | 140 +++++++-`, `route.test.ts | 372 ++++++++++++++++++++-` -- identical to the very first diff stat taken at the start of this review.

**Finding F2 detail** (see Findings): mutation 1's actual red set, re-derived independently by hand-tracing every one of the 12 original DIGEST-CATCHUP tests against the reverted `!==` rule and then confirmed by running it, is: catch-up send, the >6h same-date-guard test, the two-runs-close-together test, midnight-early-hour, DST spring-forward, weekly non-leak, weekdays non-leak, flag-on path (8, for the round-1-era test count; +1 more for the round-2-only "fails CLOSED" test that didn't exist when C ran this mutation, since it's structurally sensitive to the same hour-gate change = 9 against today's full file). C's checkpoint instead lists: catch-up send, midnight-early-hour, chosen-hour-0, DST, weekly non-leak, weekdays non-leak, flag-on path, wall-clock-budget. `chosen-hour-0` and `wall-clock-budget` are both EXACT-HOUR-MATCH scenarios (chosen hour equals the run's local hour), so `hour !== chosen` and `hour < chosen` agree on them (both false) -- they are NOT actually sensitive to this mutation, and did not fail in my run either. The total count (8) coincidentally matches C's claim; the membership does not.

## Check 7 — Gates (run from web/, one at a time, after full restoration)

| Gate | Baseline (task-stated) | C reported | My independent run |
|---|---|---|---|
| `npx vitest run` | 288 files (285+3 skipped) / 5247 passed + 6 skipped / 0 failed | 5267 passed + 6 skipped / 0 failed | **288 files (285 passed + 3 skipped) / 5273 tests (5267 passed + 6 skipped) / 0 failed** -- exact match to C |
| `npx tsc --noEmit` | 0 errors | 0 errors | **exit 0** |
| `npx eslint .` | 0 errors / 151 warnings | 0 errors / 151 warnings | **0 errors / 151 warnings** -- exact match |
| `npm run build` | OK | OK, route table includes the route | **exit 0**, route table includes `ƒ /api/jobs/dispatch-digests`, only the pre-existing unrelated `next.config.ts` NFT-trace Turbopack warning (confirmed by reading the warning text -- names `next.config.ts`, nothing this item touches) |

All 4 gates PASS, matching C's self-reported numbers exactly, run independently from a fully-restored working tree (verified via the sha256 chain in Check 6).

## Check 8 — Accepted/deferred item registry (re-listed so none silently becomes permanent)

1. **Chosen hours 21-23**: named ACCEPTED residual in §1bf point 2. Independently re-measured in Check 2: 25% / 25% / 25% under the fix (vs B's reported 21-25%) -- still a real, unsolved gap for late-evening readers, unchanged status.
2. **Option B** (extra GitHub Actions schedule lines): deferred lead, not authorized (§1bf point 2). `.github/workflows/digest-cron.yml` confirmed untouched (git status).
3. **Option C** (Vercel Cron for this route): not pursued; standing §1x P9 ruling ("never touch vercel.json for this trigger") stands (§1bf point 6). `vercel.json` confirmed untouched.
4. **Option D** (a cross-midnight catch-up window): deferred lead, not authorized (§1bf point 2). No code in the diff crosses local midnight (confirmed by reading -- the guard only ever compares to `dateInTimezone(now, tz)`, never yesterday's date).
5. **A2** (apply `20260924000300_briefing_deliveries_dedupe.sql` + `PEER_DIGEST_DEDUPE=on`): explicitly NOT required/not applied now (§1bf point 1). No migration file added or modified; `isDigestDedupeEnabled()` still requires the literal string `"on"`, and no `.env`/`.env.example` change is in the diff -- flag stays default-off in production.
6. **No reader-visible "missed/late" signal**: silent per §1bf point 4. Profile page (`web/src/app/profile/page.tsx`) and the email templates are untouched by this diff (confirmed via `git status` -- not in the changed-file list).
7. **Pre-existing inaccurate header line** ("Triggered by Vercel Cron per vercel.json", route.ts:16-17, actually GitHub Actions): confirmed STILL PRESENT verbatim, correctly left alone (C's own plan named this as out-of-scope) -- not silently fixed in a way that would hide the pre-existing inaccuracy, and not worsened either.

## Check 9 — Privacy scan

Searched (patterns described in words, not reproduced here): the reader's own gmail address and the literal string that precedes it; the Windows profile-path short name and the account holder's first and full name as bare words; any e-mail-shaped string generally; NetID/university-domain patterns -- across both changed files (`route.ts`, `route.test.ts`) and all 3 DIGEST-CATCHUP docs (B's, C's, this one).

Result: **0 hits** for every personal pattern. The only e-mail-shaped strings found are synthetic `@example.test` fixtures (a reserved non-routable test domain) in `route.test.ts` -- expected, not personal data. This report's own scratch outputs are referred to only as `<scratchpad>/...` above (verified by grepping this file for the literal Windows path -- 0 hits).

## Cleanup proof (temporary probe file)

```
$ git status --porcelain=v1 -- . ':!node_modules'
 M ABC-JEV-INTEGRATION.md
 M web/src/app/api/jobs/dispatch-digests/route.test.ts
 M web/src/app/api/jobs/dispatch-digests/route.ts
?? docs/jev-abc/DIGEST-CATCHUP-A-20260929T161325Z.md
?? docs/jev-abc/DIGEST-CATCHUP-B-20260929T153008Z.md
?? docs/jev-abc/DIGEST-CATCHUP-C-20260929T155843Z.md
```
`__a_probe_replay.test.ts` is gone (it was untracked, so its removal leaves no trace in `git status` beyond simply no longer being listed); `git diff HEAD --stat -- web/` after cleanup and after all 4 mutation restores is still exactly `route.ts | 140 +++++++-`, `route.test.ts | 372 ++++++++++++++++++++-` -- identical to the pre-review diff. No commit, push, stash, or branch operation was performed at any point. No job route (production or local dev server) was ever called -- every test used mocked `createAdminClient`/`runFeedPipeline`/`sendDigestEmail`. `web/.env`/`web/.env.local` were never opened. Root `node_modules/` and the dev server were never touched.

## Findings

### F1 -- MEDIUM: a reader who changes their profile timezone can receive a second digest within ~10-26h of the first

Not covered by any point in §1bf, not named in B's or C's own risk lists. Found and confirmed by direct execution (probe test "A READER WHO CHANGES TIMEZONE after a morning send"):
- Reader `digest_hour_local=9`, `digest_timezone="America/Chicago"`. Sent at `2026-09-24T14:05:00Z` (09:05 CDT). `dispatched_count: 1`.
- Profile's `digest_timezone` changes to `"Asia/Tokyo"` (hour stays 9) between runs.
- Next run at `2026-09-25T00:30:00Z` (09:30 JST, ~10.4h after the first send -- outside the unchanged 6h guard, inside the new 26h lookback window). Result: `dispatched_count: 1` again -- a genuine second insert for the same reader (`table2Len: 2`), confirmed via direct execution, not inferred.

Root cause: `hasDeliveryOnLocalDate` (correctly, per its own contract) recomputes "today" using the profile's CURRENT `digest_timezone` at guard-check time, and reinterprets the EARLIER delivery's stored absolute instant in that same current timezone. It has no memory of which timezone was active when the earlier delivery actually happened. When a timezone change shifts the calendar-date boundary enough that the old delivery's instant no longer maps to the same local date as the new "today," the guard cannot recognize it as the same day. (The pre-existing 6-hour lookback does not have this problem, since it is a pure rolling wall-clock window, tz-independent -- but it also only covers 6 hours, not the full local day.)

Why MEDIUM, not HIGH: bounded to one extra email (not unbounded/looping), requires the specific precondition of a mid-flight timezone change (not the routine "GitHub ran late" failure mode this ticket targets), and the SAME class of tz-dependence already exists on the flag-on path's claim RPC (`dateInTimezone(now, row.digest_timezone)` is also computed fresh from the current profile row there) -- so this is a structural property of any same-local-date scheme keyed to a mutable, reader-editable field, not a defect introduced uniquely by this diff's chosen approach. Why not LOW: it is a real, execution-confirmed violation of the "at most one email per local day" guarantee this ticket exists to strengthen, and the review brief explicitly anticipated needing this exact scenario characterized ("describe what happens and whether it is acceptable"). Recommend surfacing as a new named residual/POLICY item (parallel to the already-accepted hours-21-23 gap) rather than leaving it undocumented.

### F2 -- LOW: C's round-1 mutation-1 self-report misidentifies which tests go red (net count right, membership wrong)

C's checkpoint claims mutation 1 (`<` reverted to `!==`) turns exactly these 8 tests red: catch-up send, midnight-early-hour, chosen-hour-0, DST, weekly non-leak, weekdays non-leak, flag-on path, wall-clock-budget. My independent re-execution of the IDENTICAL mutation (same sha256 before/after) shows a different set: catch-up send, the >6h same-date-guard test, the two-runs-close-together test, midnight-early-hour, DST, weekly non-leak, weekdays non-leak, flag-on path (9 total against today's full file, including the round-2-only fails-CLOSED test). `chosen-hour-0` and `wall-clock-budget` are both exact-hour-match scenarios where `!==` and `<` agree, so they do NOT actually fail under this mutation -- confirmed both by hand-tracing the test bodies and by direct re-execution. The >6h-guard and two-runs-close-together tests DO fail (their second run's hour no longer equals the reader's chosen hour under the old rule, so it is rejected at the hour gate itself with a different skip reason before ever reaching the logic those two tests are trying to exercise).

Impact: none on the verdict -- the mutation is still robustly caught (9 red tests, well above the "at least one" bar), so there is no coverage gap. This is purely a self-report accuracy issue: a future reader trusting C's checkpoint verbatim would misjudge which tests protect which behavior. Recommend not relying on this specific line of C's checkpoint without re-verification.

## Verdict

**VERIFIED**

The diff (`web/src/app/api/jobs/dispatch-digests/route.ts` + `route.test.ts` only) does exactly what ABC-JEV-INTEGRATION.md �1bf points 1-9 (including the point-9 AMENDMENT) specify, and nothing else:
- Catch-up hour rule (`<`), same-local-date guard (flag-off only, 26h window, `dateInTimezone`-based, fails CLOSED on a read error), wall-clock budget (240s, correctly placed and scoped), and the exact reason-code vocabulary are all present and correct, confirmed by reading AND by direct execution (including a from-scratch, independently-fetched real-GitHub-data replay through the real `GET` handler that reproduces B's predicted percentages exactly, before and after, on every one of 24 chosen hours).
- The flag-on path, the pre-existing 6-hour guard, and the response's counts-only/no-raw-text shape are all byte-identical/unchanged, confirmed structurally and by a clean full-suite execution.
- All 4 mutations (the 3 from round 1 + the round-2 AMENDMENT) are caught by the real test suite and cleanly restored (sha256-proven); none turned zero tests red.
- All 4 gates are green and match C's self-reported numbers exactly.
- Every named accepted/deferred item (hours 21-23, Options B/C/D, A2, silent-to-readers, the pre-existing Vercel-Cron comment inaccuracy) is still correctly in its stated state -- nothing silently became permanent or silently disappeared.
- Privacy scan: 0 hits.

Two findings are recorded (F1 MEDIUM -- a genuinely new, execution-discovered residual around mid-flight timezone changes, worth a POLICY decision but not a ruling violation; F2 LOW -- an accuracy issue in C's own self-report, not in the product code). Neither contradicts what the binding ruling asked for, so neither is a basis for FAILED_REVIEW.

Report path: `docs/jev-abc/DIGEST-CATCHUP-A-20260929T161325Z.md`
