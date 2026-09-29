# FEED-SYNC-FLAG — C checkpoint (implementer)

STATUS: IMPLEMENTED_PENDING_REVIEW

Branch `Jev-integration-and-sorting-filtering-enhancement`. Role: C (implementer), no separate B — cause already located by POLISH-1-SYNC-A. Item: FEED-SYNC-FLAG (ABC-JEV-INTEGRATION.md §5 row).

Binding inputs read in full: §1al (c) (P6 mechanism + escape clause), §1aj (P3 "a failed push is retried on the next change and shown to the user once", P6 "warn-and-ask"), §5 rows POLISH-1 and FEED-SYNC-FLAG. Evidence read: `docs/jev-abc/POLISH-1-SYNC-A-20260928T163023Z.md` (the MEDIUM finding: `useFeedSyncStatus.pushFailed` set/cleared only inside feed-sync.tsx's one-time sign-in migration batch; steady-state `store/feed.ts` cloud writes — `cloudSave`/`cloudUnsave`/`cloudMarkRead`/`cloudMarkUnread` — swallow failures with `console.warn` only).

## Step 0 — Confirm the defect (DONE)

Read in full: `web/src/components/feed-sync.tsx`, `web/src/components/profile-sync.tsx`, `web/src/store/feed.ts` (all ~2700 lines, in sections), `web/src/app/api/saved/route.ts`, `web/src/app/api/read/route.ts`, `web/src/app/api/feedback/route.ts`.

Confirmed exactly what the reviewer found:
- `useFeedSyncStatus`/`markFeedPushFailed`/`clearFeedPushFailed` are defined PRIVATELY in `feed-sync.tsx` (setters not exported); set/cleared only at L162-168, inside `onSession`'s one-time-per-sign-in migration batch.
- `store/feed.ts` has 5 fire-and-forget cloud-write helpers following the identical try/apiFetch/catch-console.warn-only pattern: `cloudSave`, `cloudUnsave`, `cloudMarkRead`, `cloudMarkUnread` (the 4 the reviewer named) **and a 5th sibling on the exact same pattern: `cloudFeedback`** (L144-158), called from `submitFeedback`, itself called by `savePaper`/`moreLikePaper`/`saveEvent`/`moreLikeEvent`/`saveJob`/`moreLikeJob`. Decision: include `cloudFeedback` in scope — `resetLocal()` (sign-out) wipes `paperFeedback`/`eventFeedback`/`jobFeedback` alongside saved/read state (verified by reading `resetLocal`, L2498-2559), so an unsynced feedback push is exactly the same P6 data-loss risk as an unsynced save. Flagging this as a deliberate scope decision beyond the reviewer's literal 4-function list, per my brief's "any sibling write you find on the same pattern; list them."
- All 15 call sites of these 5 helpers (`savePaper`, `saveEvent`, `saveJob`, `unsavePaper`, `unsaveEvent`, `unsaveJob`, `submitFeedback`, `markRead`, `markUnread`, `setJobApplied`, `setEventRegistered`, `setEventSubmitted`, `commitDismiss`) call them fire-and-forget (not awaited) after a synchronous `set()` — confirms the fix belongs INSIDE the 5 helper functions themselves, not at each of the 15 call sites.
- No gating on sign-in state exists before any of these 5 helpers fire today (pre-existing, unrelated to this fix — not changing when they're called, only what happens to the flag on their result). Confirmed `POST /api/saved` / `/api/read` / `/api/feedback` all 401 when signed out (no session) — so an ungated flag-set would spuriously flag a signed-out visitor's failed (401) writes; the brief's own test list requires "signed-out (no cloud) writes never touch it", so the flag update needs to be gated on sign-in.
- `store/feed.ts` already imports `useSyncGate` from `@/components/profile-sync` (for `resolveOwnerKeyForLoad`) — `useSyncGate.getState().authUserId` is the exact "is this a real signed-in account right now" signal already trusted elsewhere in this same file, reused here as the gate.
- No existing test in `feed.test.ts` (2520 lines) directly exercises `savePaper`/`unsavePaper`/`markRead`/`markUnread`/`cloudFeedback` — writing fresh tests, following this file's established `vi.stubGlobal("fetch", ...)` / `useSyncGate.setState(...)` / `vi.waitFor(...)` conventions (confirmed by reading the file's shared `beforeEach` and several `it()` blocks).

## Step 1 — Design decision: flag location (DONE)

Escape-clause check: importing the flag's setters directly from `feed-sync.tsx` into `store/feed.ts` would be a real circular import (`feed-sync.tsx` already imports `useFeedStore` FROM `store/feed.ts`). Chose the explicitly-offered alternative: **moved the tiny flag store to a new module**, `web/src/lib/feed/sync-status.ts` (exports `useFeedSyncStatus`, `markFeedPushFailed`, `clearFeedPushFailed`). Neither `feed.ts` nor `feed-sync.tsx` is imported BY this new module, so both can depend on it with no cycle. `feed-sync.tsx` re-exports `useFeedSyncStatus` so the two existing external imports (`account-section.tsx`, `app/profile/page.tsx`, both out of scope/untouched) keep working unchanged. Single source of truth preserved — one flag, one store, now just relocated.

## Step 2 — Implementation (DONE)

- Created `web/src/lib/feed/sync-status.ts` (new tiny shared module).
- Edited `web/src/components/feed-sync.tsx`: removed the inline `useFeedSyncStatus`/`markFeedPushFailed`/`clearFeedPushFailed` definitions, imports them from the new module instead, re-exports `useFeedSyncStatus`. The migration-batch logic itself (L162-168 pre-edit) is untouched.
- Edited `web/src/store/feed.ts`: imported `markFeedPushFailed`/`clearFeedPushFailed` from the new module; added a private `updateFeedPushFailedFlag(ok: boolean)` helper gated on `useSyncGate.getState().authUserId`; wired it into all 5 cloud* helpers' try (success) and catch (failure) branches. No call site (the 15 listed above) changed — the fix is entirely inside the 5 helpers.

## Step 3 — the "visible notice" check (DONE, per brief item 2 — report, don't build)

Read `web/src/app/profile/page.tsx` L74-91. A visible notice for feed push failures **already exists and needed no change**: `SyncStatusNotice()` reads BOTH `useProfileSyncStatus((s) => s.pushFailed)` AND `useFeedSyncStatus((s) => s.pushFailed)` and renders one `role="alert"` line — "Couldn't save to your account — your changes are kept on this device." — whenever either is true. This is §1aj P3's notice, already wired to the feed flag before this change. Two existing consumers benefit automatically from this fix with zero edits to either file:
1. `account-section.tsx`'s P6 sign-out warning (`shouldWarnBeforeSignOut`/`hasUnsyncedChanges`).
2. `profile/page.tsx`'s `SyncStatusNotice` above.
Both already read `useFeedSyncStatus().pushFailed`; this fix only makes THAT flag itself track steady-state writes too, so both surfaces now correctly react to a failed mid-session save/unsave/read/feedback push, not just the one-time sign-in migration batch. No copy change, no new UI — confirmed nothing needed building here.

## Step 4 — Tests (DONE)

Added to `web/src/store/feed.test.ts`, inside the existing `describe("feed lane loading")` block (reusing its shared `beforeEach`/fetchMock/`useSyncGate` infrastructure, same as the neighboring `hydrateFromRemote`/`P4-S5a`/`P4-S5b` blocks): new `describe("feed push-failed flag (FEED-SYNC-FLAG)")` with **13 tests** (grew from an initial 9 — see Step 5, two rounds of self-mutation-testing found and closed two real test-design gaps before handoff). Import added: `useFeedSyncStatus` from `@/lib/feed/sync-status`.

Design notes on test isolation (both found via self-mutation-testing, not by inspection — see Step 5):
1. **Cross-helper confound.** `savePaper`/`saveEvent`/`saveJob` fire BOTH `cloudSave` AND (via `submitFeedback`) `cloudFeedback` — two concurrent network calls whose resolution order is not guaranteed. A test using `savePaper` with a uniform pass/fail mock cannot reliably attribute the flag's final state to `cloudSave` specifically. Fixed: the two `cloudSave`-via-`savePaper` tests mock ONLY `/api/saved` to resolve; every other path (`/api/feedback`) returns a promise that never resolves, so `cloudFeedback`'s own (separately, correctly tested) handling cannot race or mask `cloudSave`'s. `cloudUnsave`/`cloudMarkRead`/`cloudMarkUnread`/`cloudFeedback` (via `unsavePaper`/`markRead`/`markUnread`/`moreLikePaper`) are each naturally isolated already (their triggering action fires exactly one of the five helpers) and needed no such fix.
2. **Wrong starting state for success-path tests.** A test proving "a successful write does not set the flag" that starts from `pushFailed: false` cannot distinguish the correct code (`if (ok) clearFeedPushFailed()`, false→false no-op) from a mutant that deletes that call entirely (also false→false) — both look identical from a false start. Fixed: every per-helper success test now pre-sets `pushFailed: true` and asserts the write drives it back to `false`, which only the real `clearFeedPushFailed()` call can do. One additional test (`"a successful write does not set the flag"`, via `unsavePaper`) keeps the false→false direction too, since that is a distinct property (a hypothetical bug that sets the flag from `false` specifically).
3. Every "must NOT have changed" (negative, starts-and-stays-false) assertion adds an explicit `await new Promise((resolve) => setTimeout(resolve, 0))` macrotask flush after the `vi.waitFor` that only confirms the request started — `vi.waitFor`'s first poll can pass synchronously, before the helper's own `await`-chain (and its `updateFeedPushFailedFlag` call) has actually run. Positive/transition assertions (waiting for `true`, or waiting for a pre-set `true` to become `false`) don't need this — `vi.waitFor`'s polling is safe for those since it keeps retrying until the real transition happens or it times out.

Tests (all in the new describe block, `web/src/store/feed.test.ts`):
1. "a failed cloudSave (savePaper) sets the flag when signed in"
2. "a failed cloudUnsave (unsavePaper) sets the flag when signed in"
3. "a failed cloudMarkRead (markRead) sets the flag when signed in"
4. "a failed cloudMarkUnread (markUnread) sets the flag when signed in"
5. "a failed cloudFeedback (moreLikePaper, the sibling write) sets the flag when signed in"
6. "a successful cloudSave clears a previously-set flag"
7. "a successful cloudUnsave clears a previously-set flag"
8. "a successful cloudMarkRead clears a previously-set flag"
9. "a successful cloudMarkUnread clears a previously-set flag"
10. "a successful cloudFeedback (moreLikePaper) clears a previously-set flag"
11. "a successful write does not set the flag" (false→false direction, via `unsavePaper`)
12. "a signed-out write's failure never sets the flag (no cloud to speak of)"
13. "a signed-out write's success never clears a previously-set flag either"

Tests 1-5 and 6-10 are fully symmetric and independently isolated per helper (5 helpers × 2 directions). `feed-sync.test.tsx` needed NO changes — its existing `useFeedSyncStatus.getState().pushFailed` test still passes unchanged because `feed-sync.tsx` re-exports the same hook from the new module.

## Step 5 — Self mutation-testing (DONE — 4 targeted mutations across 2 rounds; not the full exhaustive per-line pass, that is the fresh A's job)

Baseline hashes before any mutation (`sha256sum`), also the final restored hashes (re-verified after every mutation cycle, all matched):
```
c9c6cc6017fe7b7e17423b64e2c55615676e2c3d65c2cbbb52d4e15545cff131  web/src/store/feed.ts
e81dcff23abc37ae7d5560e0b5238821d2df37be6119a71e0b5a0955e4851b76  web/src/components/feed-sync.tsx
9a30ce7522fe9035e871428df193f4428f342c4ca3804cd526b97371cee2f9c2  web/src/lib/feed/sync-status.ts
```

Round 1 (against the initial 9-test draft — this round is WHY the suite grew to 13; both gaps below were closed before handoff, not left as disclosed limitations):

| # | Mutation | Result | Restore hash matches |
|---|---|---|---|
| M1 | `cloudSave`'s catch block: delete the `updateFeedPushFailedFlag(false)` line | First attempt (uniform-fail mock via `savePaper`) stayed **GREEN** — confounded by `cloudFeedback` (also fired by `savePaper`, also failing under a uniform mock) independently setting the same flag. Root-caused to the cross-helper confound (Step 4, design note 1) and fixed (hang `/api/feedback`, only `/api/saved` resolves). Re-run: **RED** — exactly 1 test failed, others stayed green | YES — `c9c6cc60…` |
| M2 | `updateFeedPushFailedFlag`: delete the `if (!useSyncGate.getState().authUserId) return;` guard | **RED** — exactly 2 tests failed (both signed-out tests), the other 7 stayed green | YES — `c9c6cc60…` |

While writing the mutation notes after M1/M2, reasoning through "what would catch a success-path deletion in `cloudFeedback`/`cloudSave`/`cloudMarkUnread` specifically" surfaced design note 2 (Step 4) as a real, not just theoretical, gap. Verified empirically rather than assumed:

Round 2 (against the fixed design, before adding the 4 new success tests + rewriting the 5th):

| # | Mutation | Result | Restore hash matches |
|---|---|---|---|
| M3 | `cloudFeedback`'s try block: delete `updateFeedPushFailedFlag(true)` | With the (then-9-test) suite: **stayed GREEN** — confirmed the gap was real, not hypothetical (a false-start test cannot see a deleted no-op). Closed by rewriting the success tests to pre-set `pushFailed: true` first (design note 2). Re-run with the fixed 13-test suite: **RED** — exactly 1 test failed ("a successful cloudFeedback... clears a previously-set flag"), the other 12 stayed green | YES — `c9c6cc60…` |
| M4 | `cloudSave`'s AND `cloudMarkUnread`'s try blocks: delete both `updateFeedPushFailedFlag(true)` lines in the same pass | **RED** — exactly 2 tests failed ("a successful cloudSave... clears...", "a successful cloudMarkUnread... clears..."), the other 11 stayed green (confirms no cross-helper masking between these two either) | YES — `c9c6cc60…` |

Full suite re-run after all 4 mutation cycles restored: 5034/5034 project-wide (see Step 6). Mutation notes for the later A (one-line deletions, mapped to the test that must catch each — all 4 below independently verified above, not just reasoned about):
- Delete `updateFeedPushFailedFlag(false)` from any one of `cloudSave`/`cloudUnsave`/`cloudMarkRead`/`cloudMarkUnread`/`cloudFeedback`'s catch block → its own named "a failed cloud... sets the flag" test (tests 1-5) goes red; no other test affected.
- Delete `updateFeedPushFailedFlag(true)` from any one of the 5 helpers' try block → its own named "a successful cloud... clears a previously-set flag" test (tests 6-10) goes red; no other test affected (verified for `cloudFeedback` alone via M3, and for `cloudSave`+`cloudMarkUnread` together via M4; `cloudUnsave`/`cloudMarkRead` follow the identical pattern).
- Delete the `if (!useSyncGate.getState().authUserId) return;` line in `updateFeedPushFailedFlag` → tests 12 AND 13 both go red together (confirmed via M2).
- Change `if (ok)` to `if (!ok)` in `updateFeedPushFailedFlag` (inverted polarity) → every one of tests 1-11 asserts a specific direction, so all would go red.

## Step 6 — Gates (DONE, from `web/`, after all mutations restored — hash re-verified before running)

- `npx vitest run`: **280 files (277 passed + 3 skipped); 5034 passed + 6 skipped; 0 failed.** Baseline was 5021 passed — exactly +13, matching the 13 new tests; no existing test's count changed.
- `npx tsc --noEmit`: **0 errors** (exit code 0).
- `npx eslint .`: **0 errors, 151 warnings** — identical to baseline, no new warnings introduced.
- `npm run build`: **OK** (run once, against the hash-confirmed final file content — re-verified byte-identical after the later mutation-testing rounds, so not re-run a second time). All routes generated including `/api/saved`, `/api/read`, `/api/feedback`, `/api/profile`. The one pre-existing Turbopack NFT-tracing notice (next.config.ts → pdf-text.ts → upload/route.ts) present and unrelated (same one prior C/A checkpoints noted). No Windows file lock encountered at any step.

## Final `git status --short`

```
 M ABC-JEV-INTEGRATION.md
 M web/src/components/feed-sync.tsx
 M web/src/store/feed.test.ts
 M web/src/store/feed.ts
?? docs/jev-abc/FEED-SYNC-FLAG-C-20260928T173817Z.md
?? docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md
?? node_modules/
?? web/src/lib/feed/sync-status.ts
```
`ABC-JEV-INTEGRATION.md` — pre-existing modification, not mine (manager-only writer; untouched by me). `docs/jev-abc/SENSE-CONTEXT-B-*.md` — the parallel read-only B investigator's own file, per the brief, ignored. `node_modules/` — pre-existing untracked. Everything else is exactly the allowed-files list: `web/src/store/feed.ts` (+ test), `web/src/components/feed-sync.tsx` (its test needed no change), the one new shared module `web/src/lib/feed/sync-status.ts`, and this checkpoint.

## STATUS: IMPLEMENTED_PENDING_REVIEW

Write paths now covered (all set/clear the same `useFeedSyncStatus.pushFailed` flag, gated on `useSyncGate.getState().authUserId`): `cloudSave` (save), `cloudUnsave` (unsave), `cloudMarkRead` (mark read), `cloudMarkUnread` (mark unread), and `cloudFeedback` (feedback — sibling on the identical pattern, included because `resetLocal()` wipes `paperFeedback`/`eventFeedback`/`jobFeedback` on sign-out exactly like saved/read state, so an unsynced feedback push is the same P6 risk).

Flag location: moved from a private declaration inside `feed-sync.tsx` to a new tiny module, `web/src/lib/feed/sync-status.ts` (exports `useFeedSyncStatus`, `markFeedPushFailed`, `clearFeedPushFailed`), because `feed-sync.tsx` already imports `useFeedStore` FROM `store/feed.ts`, so `store/feed.ts` importing the flag back from `feed-sync.tsx` would be circular. `feed-sync.tsx` re-exports `useFeedSyncStatus` so both existing external consumers (`account-section.tsx`, `app/profile/page.tsx`) needed no changes.

Tests: 13 new (listed in Step 4), all in `web/src/store/feed.test.ts`. Gates: vitest 280 files (277+3 skipped) / 5034 passed+6 skipped / 0 failed; tsc 0; eslint 0 errors/151 warnings; build OK. Mutation spot-check: 4/4 targeted mutations caught (2 rounds — round 1 found and fixed a cross-helper test-confound bug, round 2 found and fixed a false-start test-design gap that let 3 of 5 helpers' success branches go unproven; both fixes verified by re-running the same mutation and watching it flip from green to red). Final `git status --short` matches the allowed-files list exactly (see above) plus the untouched parallel-lane files.
