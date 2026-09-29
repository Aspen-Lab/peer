# DIGEST-CATCHUP — Implementer (C) Checkpoint

STATUS: IMPLEMENTED_PENDING_REVIEW (round 2 complete -- see the "ROUND 2"
section for the §1bf point 9 AMENDMENT fail-closed fix, and the final
STATUS line near the bottom of that section). Round 1's summary below is
otherwise unchanged and still accurate for everything it covers.

## ROUND 2 (§1bf point 9 AMENDMENT — fail-closed fix)

Manager's diff read found: the new 26-hour `briefing_deliveries` read
(added in round 1) destructures only `data` and ignores `error` -- a failed
read becomes `[]`, i.e. "no delivery today", so a DB hiccup after a morning
send would let a later run send a SECOND email the same local day (fails
OPEN). Ruling (§1bf point 9, AMENDMENT, read in full): that read must fail
CLOSED -- on an error, do not process this reader this run: tally
`failed_reasons.delivery_check_error`, raw error text only to the private
log via `logJobIssue`, no pipeline call, no insert, no email; the reader
stays due for the next run. The pre-existing 6-hour read stays
byte-identical. Same constraints as round 1 (never call a job route, no
commit/push/stash, no `.env*`, no keys, no personal strings, don't touch
root `node_modules/` or the dev server).

Plan:
1. route.ts: destructure `error` from the 26h read too; on a truthy error,
   `bumpReason(failedReasons, "delivery_check_error")`,
   `logJobIssue(...)`, `continue` -- before ever calling
   `hasDeliveryOnLocalDate`. Update the comment block above the guard.
2. route.test.ts: one new test -- 26h read returns an error -> no
   pipeline call, no insert, no email, `failed_reasons.delivery_check_error
   === 1`, response contains no raw error text. Extend `makeAdminClient`'s
   `sameDate` option additively (allow an `error` alongside `data`, same
   shape the pre-existing `recent`/`past`/`rpc` options already use).
3. Mutation: fail open again (ignore the error) -> new test goes red;
   restore; sha256sum before/after identical.
4. Gates from web/, one at a time.

Progress:
- [x] Step 1: route.ts fail-closed fix -- destructured `error` from the 26h
      read as `recentForDateErr`; on truthy, bumps
      `failedReasons.delivery_check_error`, logs raw text via `logJobIssue`
      (never the response), `continue`s before `hasDeliveryOnLocalDate` is
      ever called -- no pipeline call, no insert, no email. Comment block
      above the guard extended (not replaced) with the fail-closed
      rationale. 6-hour lookback query untouched.
- [x] Step 2: test added in route.test.ts, same DIGEST-CATCHUP describe
      block, right after the "two runs close together" test. No
      `makeAdminClient` extension needed -- the `sameDate` option's type was
      already `{ data: unknown; error: unknown }` from round 1 (matching
      every other DB-shaped option in this helper) and `chain()` already
      resolves with whatever `{data,error}` shape is passed, so
      `sameDate: { data: null, error: { message: "..." } }` works
      out of the box.
- [x] Step 3: mutation proven, restored, hashes of
      `web/src/app/api/jobs/dispatch-digests/route.ts`:
      - Round-2 baseline (fail-closed fix + test, all green):
        `a0c35742982474806d13115c8a9aebc20e822d87dbcab9764971e60380ef52f2`
      - Mutation (`if (recentForDateErr)` → `if (false && recentForDateErr)`,
        i.e. fail open again): hash
        `c22bc4f21fea547caf68feb983fc388f3e28f933f5a3385c55ea8bb4baa9d46b`
        (differs) -- the new test went red (`runFeedPipeline` was called
        with the full feed-request object despite the DB error, proving the
        guard is load-bearing).
      - Restored: hash returns to `a0c35742...` exactly; targeted suite
        re-run green (60/60).
- [x] Step 4: gates run from `web/`, one at a time, all green:
      - `npx vitest run` (full suite): 288 files (285 passed + 3 skipped) /
        5273 tests (5267 passed + 6 skipped) / 0 failed -- exactly the
        expected 5267 (round-1's 5266 + 1 new test).
      - `npx tsc --noEmit`: exit 0, 0 errors.
      - `npx eslint .`: 0 errors / 151 warnings -- unchanged.
      - `npm run build`: exit 0, "Compiled successfully", route table
        includes `ƒ /api/jobs/dispatch-digests`.

## STATUS: IMPLEMENTED_PENDING_REVIEW (round 2 complete)

Final diff vs HEAD e143f234 (both rounds combined):
```
web/src/app/api/jobs/dispatch-digests/route.ts       | 140 +++++++-
web/src/app/api/jobs/dispatch-digests/route.test.ts  | 372 ++++++++++++++++++++-
2 files changed, 501 insertions(+), 11 deletions(-)
```
No other file touched in round 2. Same two files as round 1; nothing new
added to scope.

Role: C (implementer). Branch `Jev-integration-and-sorting-filtering-enhancement`.
Starting HEAD for this item: `e143f234` (docs-only "state after batch 4" commit;
one commit ahead of the `eb094453` named in my brief — TOKENIZE-PLURALS/
OUTBOX-RETRY/EMPTY-STATE-REASON landed first, per "C starts only after the
TOKENIZE-PLURALS A has finished its gates"). Working tree before my edits:
`ABC-JEV-INTEGRATION.md` modified (manager's own state file, not mine to
touch), `docs/jev-abc/DIGEST-CATCHUP-B-20260929T153008Z.md` untracked (the B
guide), `node_modules/` untracked (pre-existing, per DIRTY_SCOPE — not mine).
No product files dirty at start.

Ruling read: ABC-JEV-INTEGRATION.md §1bf (binding). Guide read in full:
docs/jev-abc/DIGEST-CATCHUP-B-20260929T153008Z.md. Engineering contract read:
§0b, §3. web/AGENTS.md read (Next.js version-drift banner only, no
DIGEST-CATCHUP-relevant content). Prior code read in full: `web/src/app/api/
jobs/dispatch-digests/route.ts`, `route.test.ts` (762 lines), `idempotency.
test.ts` (598 lines), `web/src/lib/dashboard/timezone.ts`,
`web/src/app/api/jobs/prepare-dashboards/route.ts` (wall-clock budget
pattern), `.github/workflows/digest-cron.yml`,
`web/src/app/api/jobs/digest-cron-workflow.test.ts`. Confirmed by grep: zero
test files anywhere under `web/` reference the literal string `hour_mismatch`
(only `route.ts:339` itself does) — matches B's own finding — so there is no
existing test to rewrite for that string; new tests are additive. Confirmed
by grep: only `route.test.ts` and `idempotency.test.ts` import `GET` from
this route; `prepare-dashboards/route.test.ts` and `prepare-pool.ts` import
only `ProfileRow`/`digestFeedRequestFromProfile`/`digestIdempotencyKey`/
`feedControlsFromRow`/`seedTextsFromRow` — none of whose shapes I am
changing — so those files need no edits.

## Plan (written before any edit)

1. **Selection rule (§1bf point 1).** Change the hour gate in `GET`'s per-row
   loop from `hour !== row.digest_hour_local` (skip reason `hour_mismatch`)
   to `hour < row.digest_hour_local` (skip reason `before_chosen_hour`).
   `hourInTimezone` returns `-1` for an unresolvable timezone (confirmed in
   `timezone.ts:37,39` and pinned by the pre-existing `timezone.test.ts:48`);
   since `-1 < h` is true for every valid `digest_hour_local` in `0..23`
   (including `0`), an invalid timezone always takes the `before_chosen_hour`
   branch and never reaches the send path — this is a structural property of
   the comparison, not a special case, but I will add an explicit regression
   test for it (never rely on an unstated invariant). The falsy trap (chosen
   hour `0`) is safe because the comparison is strict `<`, never a
   truthiness check on `row.digest_hour_local` itself.

2. **Same-local-date guard, flag-off path only (§1bf point 1).** Inside the
   existing `try` block, immediately after the unchanged 6-hour lookback and
   BEFORE the 30-day exclusion query / pipeline call, add: when
   `!isDigestDedupeEnabled()`, fetch this user's `briefing_deliveries.
   delivered_at` for the last 26 hours (separate query from the 6-hour
   check, per the ruling's explicit permission to use a separate query — the
   6-hour query's columns/shape stay byte-identical), and skip with
   `already_delivered_today` when any row's local date (via the existing
   `dateInTimezone` helper, never hand-rolled offset math) equals today's
   local date for this reader. Extracted as a small pure exported helper
   `hasDeliveryOnLocalDate(deliveredAtValues, now, tz)` so it has direct unit
   tests independent of the DB mock shape. Not added to the flag-on path (the
   per-`(user_id, local_date)` claim RPC is already that guarantee) — will
   assert in a test that the new query is never issued when the flag is on.

3. **Frequency rule** — unchanged code (`frequencyAdmitsToday`, evaluated on
   the run's own current local weekday). Add regression tests proving
   catch-up does not leak a `weekly`/`weekdays` reader into a non-admitted
   day, since gate order (hour → frequency) is what makes this hold and nothing
   currently pins it.

4. **Wall-clock budget (§1bf point 3).** Mirror `prepare-dashboards/route.ts`'s
   named-constant style (`PREPARE_DRAIN_WALL_CLOCK_BUDGET_MS = 200_000`,
   ~200s of its own 300s `maxDuration`). This route's `maxDuration` is
   confirmed 300 (route.ts:181). Add `export const DISPATCH_WALL_CLOCK_BUDGET_MS
   = 240_000` and check `Date.now() - startedAtMs >= DISPATCH_WALL_CLOCK_BUDGET_MS`
   once per row — placed AFTER the cheap hour/frequency/intent gates (so a
   row that would have been skipped anyway still reports its true reason
   regardless of budget) and BEFORE the `try` block's DB/pipeline work (so
   "stop starting new readers" gates exactly the expensive part, mirroring
   how prepare-dashboards' own budget check gates only its expensive drain
   phase, never its cheap due-selection phase). Skip reason
   `deferred_time_budget` on the `skippedReasons` tally (one entry per
   deferred reader, since dispatch-digests already holds the full row list
   in memory, unlike prepare's queue-based drain). Test technique: since
   `GET` has no deps-injection seam (unlike `runDashboardPrepareCycle`,
   which prepare-dashboards' tests call directly with a hand-rolled
   `elapsedMs`), I will use the suite's existing `vi.useFakeTimers()` +
   `vi.setSystemTime` and advance the fake clock with
   `vi.advanceTimersByTime(...)` from inside a mocked `runFeedPipeline`
   call for an earlier row — this moves `Date.now()` (read fresh per
   iteration) without mutating the already-captured `now` Date object used
   for hour/date/frequency decisions, which is exactly the real behavioural
   split prepare-dashboards' own `now` (logical, pinned) vs `elapsedMs`
   (real wall clock) makes, just wired through fake timers instead of a
   second injected function — no restructuring of `GET`'s exported
   signature, so all ~40 existing tests are unaffected (they run in
   milliseconds of real/fake time, never near a 240,000ms budget).

5. **Reason vocabulary (§1bf point 5).** `hour_mismatch` → `before_chosen_hour`;
   add `already_delivered_today`, `deferred_time_budget`. Response shape
   (`skipped_reasons: Record<string,count>`, etc.) is unchanged — still
   counts + fixed-vocabulary tallies only. Confirmed the GitHub workflow's
   `jq` filter only selects `*_count` fields, never `*_reasons`
   (`.github/workflows/digest-cron.yml:41`), so no reason-code string ever
   reaches the public run log either way — `digest-cron-workflow.test.ts`
   needs no change (confirmed by re-reading it in full).

6. Update the route's own top-of-file doc comment (lines 3-5) describing the
   old "local hour matches the current hour" rule, since leaving it would
   directly contradict the code right below it — the file's existing
   "Triggered by Vercel Cron per vercel.json" line is a separate,
   pre-existing inaccuracy (actually GitHub Actions) unrelated to this
   ruling and out of my scope; left untouched.

7. Tests to add in `route.test.ts` (new describe block(s), reusing the
   file's existing `makeAdminClient`/`profileRow`/`authedRequest`/`chain`
   helpers, extended additively — a new optional `sameDate` mock option and
   the `select` spy wrapped as `vi.fn()` for call-shape assertions; both
   changes are additive/backward compatible, verified against every
   existing caller of `makeAdminClient` in this file before editing):
   a. Reader due earlier today (hour > chosen) sent on a later run.
   b. Reader whose hour has not come yet → `before_chosen_hour`.
   c. Second run, same local date, > 6h after the first send →
      `already_delivered_today` (not `recent_delivery`).
   d. First run after local midnight: early-hour reader sent; a
      never-caught-up late-hour (23) reader from "yesterday" stays
      `before_chosen_hour` today too (no cross-midnight leak).
   e. Chosen hour `0` (falsy trap) sends when due.
   f. DST spring-forward day (America/Chicago 2026-03-08): a reader whose
      chosen local hour (2) never literally occurs that day is still caught
      up by the first later run (3).
   g. `weekly` reader not sent on a non-admitted weekday even though caught
      up; `weekdays` reader not sent on a Saturday even though caught up.
   h. Two runs close together (< 6h apart, same date) → `recent_delivery`
      still wins over the new guard (proves check ordering).
   i. Flag-on path: catch-up hour + existing claim/already_claimed ladder
      unchanged; new 26h same-date query is never issued on this path.
   j. Wall-clock budget defers the remaining readers with an exact tally.
   k. Invalid timezone (`hourInTimezone`/`dateInTimezone` both fail-safe)
      never sends, regardless of chosen hour.
   Plus direct unit tests for the new pure `hasDeliveryOnLocalDate` helper
   (same-date match, different-date no-match, empty input, invalid tz,
   multiple rows).
   `idempotency.test.ts` needs no structural change: its own
   `makeAdminClient` routes any `cols !== "id" && cols !== "id, payload"`
   (including my new `"delivered_at"` query) to its existing `past` slot,
   which every flag-off test there leaves at its empty default — verified
   this produces no behaviour change before deciding not to touch that file.

8. Mutations (sha256sum before/after each, restore each before the next):
   revert the hour comparison to `!==` → catch-up tests (7a/7f) red; disable
   the same-date guard → the >6h-later test (7c) red; disable the
   wall-clock check → the budget test (7j) red.

9. Gates from `web/`, one at a time: `npx vitest run`, `npx tsc --noEmit`,
   `npx eslint .`, `npm run build`. Compare against the stated baseline
   (288 files / 285 passed + 3 skipped / 5247 passed + 6 skipped / 0 failed;
   tsc 0; eslint 0/151; build OK) plus my new tests, all passing, 0
   regressions.

10. No migration, no `.env`/`vercel.json`/workflow file change, no Profile
    copy change — confirmed nothing in this plan touches any of those.

Will update this checkpoint after each numbered step below, and end with
STATUS IMPLEMENTED_PENDING_REVIEW (or STOPPED_ESCAPE) plus the exact changed
file list.

## Progress log

- [x] Step 1: hour gate rewritten (`hour < row.digest_hour_local`, reason
      `before_chosen_hour`; comment records the -1/invalid-tz/falsy-0
      reasoning inline).
- [x] Step 2: same-date guard added inside the `try` block (flag-off only,
      separate 26h query, before the 30-day query/pipeline) + pure exported
      `hasDeliveryOnLocalDate` helper added near `frequencyAdmitsToday`.
- [x] Step 4: `DISPATCH_WALL_CLOCK_BUDGET_MS = 240_000` added after
      `maxDuration`; check placed after the hour/frequency/intent gates,
      before the `try` block, using a fresh `Date.now() - startedAtMs` read
      (added `const startedAtMs = Date.now()` right after `now`).
- [x] Step 5/6: reason vocabulary updated in-place (no separate step needed
      — done as part of step 1/2/4 edits); top-of-file doc comment rewritten
      to describe the new selection rule; confirmed (re-grep) no test names
      `hour_mismatch`, so nothing to rewrite there; confirmed
      digest-cron-workflow.test.ts/.github/workflows/digest-cron.yml need no
      change (jq filters only ever selected `*_count`, never `*_reasons`).
      Full route.ts re-read end to end after all edits — consistent.
- [x] Step 7: tests written in `route.test.ts`: 7 direct unit tests for the
      new pure `hasDeliveryOnLocalDate` helper, plus a new 12-test describe
      block covering every item in the brief's TESTS list (catch-up send,
      before_chosen_hour, >6h same-date guard, midnight non-leak, chosen
      hour 0, DST, weekly/weekdays non-leak (2 tests), 6h-lookback-still-wins
      ordering, flag-on unchanged + guard-not-issued, wall-clock budget
      tally, invalid timezone). `makeAdminClient` extended additively (new
      `sameDate` option, `select` wrapped as a spy) -- verified against
      every existing call site in this file before editing; zero existing
      tests changed. `idempotency.test.ts` needs no edit (confirmed: its own
      `makeAdminClient` routes the new `"delivered_at"` query to its unused-
      by-default `past` slot; its one flag-off test never sets `past`).
      Targeted run (`npx vitest run src/app/api/jobs/dispatch-digests`):
      2 files, 59/59 passed (41 in route.test.ts incl. 19 new, 18 in
      idempotency.test.ts unchanged), 0 failed.
- [x] Step 8: mutations proven, each restored before the next, hashes of
      `web/src/app/api/jobs/dispatch-digests/route.ts`:
      - Baseline (implementation complete, all green):
        `6e89dc5f2802dcd80f5f22916514b1f962e53776271992542e74f75b438ea33a`
      - Mutation 1 (hour gate `<` reverted to `!==`): hash
        `d8a70c0c30c6c89b172f84ec0c03ef40082cb8151f078b31c88a1c13ce116ffb`
        (differs) -- 8 tests went red (catch-up send, midnight-early-hour,
        chosen-hour-0, DST, both weekly/weekdays non-leak tests, flag-on
        path, wall-clock-budget test all depend on `>` catch-up firing).
        Restored -- hash returns to baseline exactly.
      - Mutation 2 (same-date guard disabled via `if (false && ...)`): hash
        `1e0860a3c618b7c7186e221ecd610e7dcfff5fcd694f35202ca77701c625a6f3`
        (differs) -- the ">6h later" test went red (`dispatched_count` 1
        instead of 0, `already_delivered_today` never reported). Restored --
        hash returns to baseline exactly.
      - Mutation 3 (wall-clock check disabled via `if (false && ...)`): hash
        `38fb945dcd15a79eb1dd001704625deade2e2fb605897650e40ec885e22a086c`
        (differs) -- the budget test went red (`runFeedPipeline` called 3
        times instead of 1, all 3 readers dispatched instead of 1).
        Restored -- hash returns to baseline exactly.
      Final hash after all restores re-confirmed equal to baseline; targeted
      suite re-run green (59/59) after the last restore.
- [x] Step 9: gates run from `web/`, one at a time, all green:
      - `npx vitest run` (full suite): 288 files (285 passed + 3 skipped) /
        5272 tests (5266 passed + 6 skipped) / 0 failed. Baseline was 5247
        passed + 6 skipped -- the +19 exactly matches the 19 new tests added
        (7 pure `hasDeliveryOnLocalDate` + 12 GET-level). File count
        unchanged (288), consistent with adding tests to existing files
        only.
      - `npx tsc --noEmit`: exit 0, 0 errors.
      - `npx eslint .`: 0 errors / 151 warnings -- identical count to
        baseline; zero new warnings from this item's code.
      - `npm run build`: succeeded (`next build`, Turbopack). The one
        printed "Turbopack build encountered 1 warnings" is pre-existing
        and unrelated (next.config.ts / src/lib/papers/pdf-text.ts /
        api/papers/upload/route.ts trace warning, nothing this item
        touches). `ƒ /api/jobs/dispatch-digests` compiled and is listed in
        the route table.

## STATUS: IMPLEMENTED_PENDING_REVIEW

## Exact changed files (git diff --stat vs HEAD e143f234)

```
web/src/app/api/jobs/dispatch-digests/route.ts       | 122 +++++++-
web/src/app/api/jobs/dispatch-digests/route.test.ts  | 345 ++++++++++++++++++++-
2 files changed, 456 insertions(+), 11 deletions(-)
```

No other product file touched. `web/src/app/api/jobs/dispatch-digests/
idempotency.test.ts` was read in full and deliberately left unmodified (see
step 7 reasoning above -- verified this produces no behaviour change before
deciding not to touch it). No migration, `.env`/`.env.example`,
`vercel.json`, or `.github/workflows/digest-cron.yml` file was touched (the
workflow's `jq` filters were re-read and confirmed to already select only
`*_count` fields, never `*_reasons`, so none of the new reason strings ever
reach the public run log either way -- `digest-cron-workflow.test.ts` was
re-read in full and needs no change). No Profile page copy was touched. Only
files outside my scope left dirty in the working tree (not mine, pre-existing
per the brief's own git-status snapshot): `ABC-JEV-INTEGRATION.md` (manager's
state file) and untracked `docs/jev-abc/DIGEST-CATCHUP-B-20260929T153008Z.md`
(the B guide) / `node_modules/`.

## Judgment calls the rulings did not explicitly cover

1. **Exact placement of the wall-clock budget check**: placed AFTER the
   hour/frequency/intent gates and BEFORE the `try` block's DB/pipeline
   work, not at the very top of the per-row loop. Reasoning: "every reader
   not started is tallied `deferred_time_budget` and **stays due** for the
   next run" only makes sense for a reader who WAS due this run; a reader
   who wasn't due anyway (wrong hour/frequency/intent) already "stays due"
   trivially and should keep reporting their true reason regardless of
   budget. This also mirrors prepare-dashboards' own split more precisely:
   its wall-clock guard gates only the expensive drain phase, never its
   cheap due-selection phase.
2. **Test technique for the wall-clock budget** (no deps-injection seam
   exists on this route's `GET`, unlike `runDashboardPrepareCycle`): used
   `vi.advanceTimersByTime` inside a mocked `runFeedPipeline` call to move
   the fake `Date.now()` between rows, rather than refactoring `GET` into a
   deps-passing orchestration function. This keeps the change additive and
   leaves all ~40 pre-existing tests' calling convention (`GET(authedRequest())`)
   completely untouched. Flagging this choice explicitly since the brief
   says "mirror that pattern" and a full deps-injection refactor was the
   more literal reading; I judged the smaller, additive change lower-risk
   for a route this heavily tested elsewhere, and it still tests the real
   guard against real elapsed time, not a stubbed clock function.
3. **`hasDeliveryOnLocalDate` extracted as a new pure exported helper**
   (not explicitly requested by name) so the same-date guard has direct
   unit tests independent of the DB mock shape, matching this file's own
   existing convention (`frequencyAdmitsToday`, `seedTextsFromRow`, etc. are
   all pure exported helpers already).
4. **`idempotency.test.ts` left unmodified.** Verified its own local
   `makeAdminClient` routes the new `"delivered_at"` query to its `past`
   slot (unused by default), and its one flag-off test never populates
   `past` -- so no behaviour change reaches it. Decided this was safer than
   editing a file the brief lists as "read-only" input unless a failure
   forced a change; none did.
