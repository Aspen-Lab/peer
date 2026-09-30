# DIGEST-CATCHUP-TRIPWIRES — C (implementer) report

STATUS: IMPLEMENTED_PENDING_REVIEW (addendum round closed; see "Addendum:
TW-F1" near the bottom for the final summary of the 4th test)

Repo: D:/local files on this PC/Github/Peer/peer
Branch: Jev-integration-and-sorting-filtering-enhancement
HEAD at start: b294c4e44ba479c62da1f65c9fc6ea90d450d589
Started: 2026-09-30T05:38:50Z (UTC)

Tests only. No product-code diff at the end. Files touched permanently: ONLY
`web/src/app/api/jobs/dispatch-digests/route.test.ts`.

## Reading done

- ABC-JEV-INTEGRATION.md §1bf (all 10 points, including the point-9
  AMENDMENT and point-10 fresh-A rulings) — read in full (lines 353-369).
  Point 10a is the owed tripwire: timezone-change accepted cost, DST
  fall-back, two-runs-20-minutes-apart — all three proven only in the A
  review's own deleted probe.
- docs/jev-abc/DIGEST-CATCHUP-A-20260929T161325Z.md — read in full. Used
  Check 3's table and Finding F1 for the exact scenarios/instants/reasons.
- web/src/app/api/jobs/dispatch-digests/route.ts — read in full (current
  HEAD). Guard lines confirmed: 6h lookback + `recent_delivery` at line
  446; 26h same-local-date guard + `already_delivered_today` at line 496;
  hour gate `hour < row.digest_hour_local` at line 409.
- web/src/app/api/jobs/dispatch-digests/route.test.ts — read in full
  (1227 lines). Existing DIGEST-CATCHUP describe block: lines 930-1226.
  Helpers reused: `makeAdminClient` (with its `recent`/`sameDate` mock
  options), `profileRow`, `authedRequest`, `chain`.
- web/src/lib/dashboard/timezone.ts — read in full (hourInTimezone /
  dateInTimezone, Intl-based).
- Cross-checked every instant used below against Node's real
  `Intl.DateTimeFormat` (same mechanism the route uses) before writing any
  test — see "Instant verification" below. All matched hand computation
  exactly, including confirming 2026-11-01 is the real US fall-back Sunday
  in America/Chicago (CDT at 06:15Z, CST at 07:45Z, repeated local hour 1).

## Plan

Add 3 tests inside the existing DIGEST-CATCHUP describe block in
route.test.ts (after its last existing test, same file, reusing its
`beforeEach`/mocks):

1. **Timezone-change accepted cost (§1bf.10a)** — reader sends in
   America/Chicago (chosen hour 9) at 2026-09-24T14:05:00Z (09:05 CDT).
   Profile timezone then changes to Asia/Tokyo (hour unchanged). Next run
   at 2026-09-25T00:30:00Z (09:30 JST, ~10.4h later, new Tokyo local date)
   sends ONE more email — pinned as the accepted cost, not a bug to fix
   here. A third run same Tokyo local date (2026-09-25T08:00:00Z, 17:00
   JST) sends nothing.
2. **DST fall-back (America/Chicago, 2026-11-01)** — chosen hour 1. Run A
   at 06:15Z (01:15 CDT, first occurrence) sends. Run B at 07:45Z (01:45
   CST, second occurrence of the repeated hour, 1.5h later) is skipped
   `recent_delivery` (old 6h guard). Run C at 14:00Z (08:00 CST, same
   local day) is skipped `already_delivered_today` (new 26h guard). Exactly
   one send total.
3. **Two runs 20 minutes apart** — 09:10Z then 09:30Z (UTC reader, chosen
   hour 9). Second run skipped, and the credited reason is asserted to be
   `recent_delivery` specifically (the old 6h guard), not
   `already_delivered_today` (the new guard would also technically match,
   so which one is asserted is the actual point of this test).

Each test proven sensitive by a temporary route.ts mutation (route.test.ts
never touches route.ts itself):

- Test 1 needs TWO mutations, since its two halves (the send happening,
  and the later same-day guard still working) fail in opposite directions
  and neither implies the other:
  - **M4** (over-broaden the guard so ANY prior delivery in the 26h window
    blocks, not just a same-local-date one): line 496
    `hasDeliveryOnLocalDate(deliveredAtValues, now, row.digest_timezone)`
    → `deliveredAtValues.length > 0`. Expected to flip run 2's "sends one
    more" assertion (would become blocked instead).
  - **M1** (same-date guard fully disabled): line 496
    `if (hasDeliveryOnLocalDate(...))` → `if (false && hasDeliveryOnLocalDate(...))`.
    Expected to flip run 3's "sends nothing" assertion (would send again
    instead).
- Test 2 and Test 3 share **M2** (6-hour guard disabled): line 446
  `if (recent && recent.length > 0)` → `if (false && recent && recent.length > 0)`.
  Expected to flip the specific credited reason (recent_delivery →
  already_delivered_today) in both tests, without changing the total send
  count in test 2 (still exactly one, just via the other guard) — this is
  exactly why both tests assert the specific reason, not just the count.

Each mutation: sha256 route.ts before, apply edit, sha256 (differs), run
the scoped test file and confirm the expected test(s) go red, revert edit,
sha256 (must equal the "before" hash), run the scoped file again and
confirm green. Hashing via PowerShell `Get-FileHash -Algorithm SHA256`
(raw bytes, not `git diff`/text-mode dependent). route.ts is CRLF in the
working tree (`git ls-files --eol` confirmed `w/crlf`); every mutation
edit is a single-line, no-embedded-newline substitution so the line's
existing CRLF terminator is never touched by the edit itself, and the
revert restores the exact original line text — so the file returns
byte-identical, not just visually identical.

After all 3 mutations proven + restored: 4 gates from web/, one at a time
(vitest, tsc, eslint, build), compared against the stated baseline (294
files (291+3 skipped) / 5545 passed + 6 skipped / 0 failed; tsc 0; eslint
0/151; build OK) — expect the same file count (294, no new file) and
+3 passed tests.

## Instant verification (Node, real Intl, before writing any test)

```
2026-11-01T06:15:00.000Z America/Chicago -> hour 1 date 2026-11-01 (CDT)
2026-11-01T07:45:00.000Z America/Chicago -> hour 1 date 2026-11-01 (CST)
2026-11-01T14:00:00.000Z America/Chicago -> hour 8 date 2026-11-01
2026-09-24T14:05:00.000Z America/Chicago -> hour 9 date 2026-09-24
2026-09-24T14:05:00.000Z Asia/Tokyo      -> hour 23 date 2026-09-24
2026-09-25T00:30:00.000Z Asia/Tokyo      -> hour 9 date 2026-09-25
2026-09-25T08:00:00.000Z Asia/Tokyo      -> hour 17 date 2026-09-25
2026-09-24T09:10:00.000Z UTC             -> hour 9 date 2026-09-24
2026-09-24T09:30:00.000Z UTC             -> hour 9 date 2026-09-24
2026-11-01 weekday in America/Chicago: Sunday (real US fall-back Sunday)
```

## Progress log

- [x] Checkpoint file created (this file).
- [x] 3 tests added to route.test.ts, inside the existing DIGEST-CATCHUP
  describe block, after its last existing test.
- [x] Baseline scoped-file test run (before any mutation): 48/48 passed
  (45 existing + 3 new), 1 file.
- [x] Baseline route.ts hash (PowerShell `Get-FileHash -Algorithm SHA256`):
  `81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958`
- [x] Mutation M4 (line 496, over-broaden the 26h guard to
  `deliveredAtValues.length > 0`): mutated hash
  `20FC75CEB0021D39D2A594B78101BEC067197C3D39529908D01FEC53321047EF`
  (differs from baseline, confirms the edit landed) -> scoped run: exactly
  1 red (test 1's run-2 "sends one more" assertion:
  `expected +0 to be 1` at the `secondBody.dispatched_count` line), 47
  green -> reverted -> hash
  `81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958`
  (== baseline, byte-identical restore proven).
- [x] Mutation M1 (line 496, same-date guard fully disabled via
  `false && hasDeliveryOnLocalDate(...)`): mutated hash
  `0E7E425C45B6BC2C4790A7531754CE7FDEA5A2CC1936E4FFF0D04BDE39348439`
  -> scoped run: exactly 3 red -- the PRE-EXISTING ">6h same local date"
  test, test 1's run-3 "sends nothing" assertion, and test 2's (DST)
  run-C assertion; 45 green -> reverted -> hash
  `81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958`
  (== baseline).
- [x] Mutation M2 (line 446, pre-existing 6h guard disabled via
  `false && recent && recent.length > 0`): mutated hash
  `6BE856ECDFA69FA060FA44D3EF8F98C188F15836BAFA5325224380BA803F3D2E`
  -> scoped run: exactly 3 red -- the PRE-EXISTING "two runs close
  together (2h)" test, test 2's (DST) run-B reason, and test 3's (20 min)
  reason -- all three flip specifically from `recent_delivery` to
  `already_delivered_today` (the blocked/not-blocked outcome itself is
  unchanged, only which guard gets credit -- exactly the point of these
  two new tests asserting the specific reason, not just the count); 45
  green -> reverted -> hash
  `81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958`
  (== baseline).
- [x] Post-mutation full scoped-file run: 48/48 passed again (confirms
  clean restore, not just a matching hash).
- [x] `git diff HEAD --stat -- web/`: only
  `web/src/app/api/jobs/dispatch-digests/route.test.ts | 134 +++...`
  (134 insertions, 0 deletions, 0 other files under web/). route.ts not
  listed -- confirms it is byte-identical to HEAD, consistent with the
  hash proof above. `git ls-files --eol` reconfirmed route.test.ts is
  still pure `w/lf` (unchanged convention) and route.ts still `w/crlf`
  (untouched) after all 3 mutation cycles; a raw byte dump of the new
  test code's tail showed plain `\n` throughout, no stray `\r`.
- [x] Gate 1 `npx vitest run`: **294 files (291 passed + 3 skipped) / 5554
  tests (5548 passed + 6 skipped) / 0 failed** -- baseline was 5545 passed;
  +3 matches exactly the 3 new tests, same file count (no new file), 0
  failed.
- [x] Gate 2 `npx tsc --noEmit`: **exit 0**, no output.
- [x] Gate 3 `npx eslint .`: **0 errors / 151 warnings** -- exact match to
  baseline; the 151 warnings are entirely pre-existing (spacing-scale and
  unused-var warnings in unrelated files), none in either changed file.
- [x] Gate 4 `npm run build`: **exit 0**, "Compiled successfully", route
  table includes `ƒ /api/jobs/dispatch-digests`. Log written to the
  session scratchpad (not a root-level path), grepped for
  "Failed to compile"/"Build error occurred" (0 hits) and confirmed the
  route table line (1 hit); the only warning anywhere in the build output
  is the pre-existing, unrelated `next.config.ts` NFT-trace Turbopack
  warning the A review already identified as out of scope.
- [x] Final `git diff HEAD --stat -- web/`: unchanged from the
  post-mutation check above -- only route.test.ts, +134/-0. `git status`
  (repo-wide, excluding node_modules) shows exactly: `ABC-JEV-INTEGRATION.md`
  (already modified before this item started, not touched by this work),
  `web/src/app/api/jobs/dispatch-digests/route.test.ts` (this item's only
  code change), and this checkpoint doc (untracked). Final route.ts hash
  re-checked once more after all 4 gates:
  `81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958`
  (== baseline). No commit, push, stash, or branch operation performed at
  any point. No email sent, no HTTP call to peer.homes/localhost/any
  route -- every test uses the file's own mocked `createAdminClient`/
  `runFeedPipeline`/`sendDigestEmail`. `web/.env`/`web/.env.local` were
  never opened. Root `node_modules/` and the dev server were never
  touched.
- [x] Final STATUS set (below).

## Tests added (all inside the existing DIGEST-CATCHUP describe block,
route.test.ts, after its last existing test, before its closing brace)

1. `accepted cost, §1bf.10a -- pins today's behaviour so a change to it is
   a conscious decision: a reader who changes timezone after a send gets
   one more email for the new local date, then nothing more that Tokyo
   day`
2. `DST fall-back day (America/Chicago, 2026-11-01, when 01:00-01:59
   happens twice): both occurrences of the repeated hour plus a later
   same-day run add up to exactly one send`
3. `two runs 20 minutes apart, both after the chosen hour: exactly one
   send, and the second is skipped by the pre-existing 6-hour guard, not
   the new same-date guard`

## Mutation proof summary

| Mutation | route.ts line (pre-mutation text) | Mutated hash | Tests turned red (scoped file run) | Restored hash == baseline? |
|---|---|---|---|---|
| M4 -- over-broaden the 26h guard: `hasDeliveryOnLocalDate(deliveredAtValues, now, row.digest_timezone)` -> `deliveredAtValues.length > 0` | line 496 | `20FC75CEB0021D39D2A594B78101BEC067197C3D39529908D01FEC53321047EF` | 1: test 1's run-2 "sends one more" assertion (`secondBody.dispatched_count` 1 -> 0) | Yes |
| M1 -- same-date guard fully disabled: `if (hasDeliveryOnLocalDate(...))` -> `if (false && hasDeliveryOnLocalDate(...))` | line 496 | `0E7E425C45B6BC2C4790A7531754CE7FDEA5A2CC1936E4FFF0D04BDE39348439` | 3: the pre-existing ">6h same local date" test, test 1's run-3 "sends nothing" assertion, test 2's (DST) run-C assertion | Yes |
| M2 -- pre-existing 6h guard disabled: `if (recent && recent.length > 0)` -> `if (false && recent && recent.length > 0)` | line 446 | `6BE856ECDFA69FA060FA44D3EF8F98C188F15836BAFA5325224380BA803F3D2E` | 3: the pre-existing "two runs close together (2h)" test, test 2's (DST) run-B reason, test 3's (20 min) reason -- all three flip specifically from `recent_delivery` to `already_delivered_today` | Yes |

Baseline/restored hash (all 3 rows): `81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958`.
Every mutation turned at least one test red; no mutation turned zero red;
every restore returned route.ts to the exact byte-identical baseline hash,
confirmed a second time by a full green re-run of the scoped file (not
just the hash match) and a third time by the final gate run (Gate 1) and
the final `git diff --stat` showing route.ts as untouched.

## STATUS: IMPLEMENTED_PENDING_REVIEW

Diff: `web/src/app/api/jobs/dispatch-digests/route.test.ts` only
(+134/-0). route.ts is byte-identical to HEAD (b294c4e4). 3 new tests
pinning the tripwire owed by §1bf.10a, each proven sensitive to the
mechanism it pins by a temporary, sha256-verified-and-restored mutation.
Gates: vitest 294 files (291+3 skipped) / 5548 passed + 6 skipped / 0
failed; tsc 0 errors; eslint 0 errors / 151 warnings; build OK (route
table includes the job route). No escape found -- all three behaviours
matched what the review recorded (the accepted-cost second send, the
DST fall-back's single real send across both occurrences of the repeated
hour, and the 20-minute-apart run being credited to the pre-existing
6-hour guard specifically, not the new same-date guard) -- nothing here
contradicts §1bf.10a or the A review; ready for a fresh A.

## Addendum: TW-F1 (review docs/jev-abc/DIGEST-CATCHUP-TRIPWIRES-A-20260930T055418Z.md)

STATUS OF ADDENDUM: IN_PROGRESS

Finding: passing `"UTC"` instead of `row.digest_timezone` at the same-date
guard call site (route.ts line 496) turned NO test red -- none of the 3
original tests have a delivery/run pair whose LOCAL dates differ while
their UTC dates coincide, so the suite never actually proved the guard
must use the reader's own zone rather than UTC.

Plan: add ONE more test to the same DIGEST-CATCHUP block (after test 3),
reusing the same helpers. Instants (verified with Node's real
`Intl.DateTimeFormat` before writing the test, same mechanism route.ts
uses):

```
2026-09-25T04:30:00.000Z America/Chicago -> hour 23 date 2026-09-24 (CDT)
2026-09-25T04:30:00.000Z UTC             -> hour 4  date 2026-09-25
2026-09-25T13:00:00.000Z America/Chicago -> hour 8  date 2026-09-25 (CDT)
2026-09-25T13:00:00.000Z UTC             -> hour 13 date 2026-09-25
gap: 8.5 real hours (> 6h -- the old guard is not what decides this run)
```

Reader: America/Chicago, chosen hour 8. First send at 2026-09-25T04:30:00Z
(23:30 CDT, LOCAL date 2026-09-24). Second run at 2026-09-25T13:00:00Z
(08:00 CDT, LOCAL date 2026-09-25) -- a genuinely new local day, so the
correct (local-date) guard must let it send. Both instants' UTC calendar
date is the SAME (2026-09-25), so a guard that compared UTC dates instead
would wrongly see "already delivered today" and block it -- exactly
TW-F1's point. Mutation: route.ts line 496, `row.digest_timezone` -> the
literal `"UTC"` (a narrower, more targeted mutation than the round-1 M1/M4
mutations -- this one changes only the third argument, not the guard's
enclosing condition), sha256 before/after/restored, scoped run before and
after, then the 4 full gates.

### Result

Test added: "UTC-vs-local-date tripwire (review TW-F1): a Chicago
reader's previous delivery shares the new run's UTC calendar date but not
its local one -- the guard compares LOCAL dates, so this run still sends"
-- 4th test in the same DIGEST-CATCHUP block, after the 20-minutes-apart
test.

Baseline scoped run (before mutation): 49/49 passed (the 45 original +
the 3 round-1 tripwires + this one).

Mutation M5 (route.ts line 496, `hasDeliveryOnLocalDate(deliveredAtValues, now, row.digest_timezone)`
-> `hasDeliveryOnLocalDate(deliveredAtValues, now, "UTC")`):
- Baseline hash: `81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958`
- Mutated hash: `F171678416037FA6622DF5B27AEEB6F2C9F1A82DB981B767E197D76990A5CB00`
  (differs, confirms the edit landed)
- Scoped run under mutation: **exactly 1 red** -- the new test, and
  ONLY the new test (`expected +0 to be 1` at `secondBody.dispatched_count`).
  All 48 others (including the 3 round-1 tripwires) stayed green,
  confirming the review's TW-F1 finding precisely: those three genuinely
  are not sensitive to this mutation, and now exactly one test is.
- Reverted -> hash `81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958`
  (== baseline). Scoped run after revert: 49/49 passed again.

`git diff HEAD --stat -- web/` after the addendum: only
`route.test.ts | 180 +++...` (180 insertions, 0 deletions -- up from 134
after round 1, i.e. the 4th test added 46 lines). route.ts hash
re-confirmed identical to baseline after all 4 gates below.

Gates (from web/, after full restoration):
- `npx vitest run`: **294 files (291 passed + 3 skipped) / 5555 tests
  (5549 passed + 6 skipped) / 0 failed** -- exact match to the
  coordinator's expected 5549 passed + 6 skipped / 0 failed.
- `npx tsc --noEmit`: **exit 0**.
- `npx eslint .`: **0 errors / 151 warnings** -- exact match, unchanged.
- `npm run build`: **exit 0**, no "Failed to compile"/"Build error
  occurred" in the log (grepped, 0 hits), route table still includes
  `ƒ /api/jobs/dispatch-digests` (1 hit). Log written to the session
  scratchpad, not a root-level path.

No BLOCKED sub-steps this round; every tool call and edit was permitted.

ADDENDUM STATUS: IMPLEMENTED_PENDING_REVIEW. Diff is still ONLY
route.test.ts (now +180/-0 total across both rounds). Ready for a fresh
A on the addendum.
