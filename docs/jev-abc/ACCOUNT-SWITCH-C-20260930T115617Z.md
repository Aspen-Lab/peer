STATUS: IMPLEMENTED_PENDING_REVIEW (2026-09-30T13:17:15Z) — ROUND 2 DONE

# ACCOUNT-SWITCH — implementation checkpoint (C)

Role: implementer. Building the ruled design at §1bt (whole, incl. point 7
AMENDMENT which supersedes point 1 (ii) and point 2's trigger). Not
re-deciding policy. Scratchpad = the session scratchpad directory (never
printed as a real path here).

## Plan (written before any product-file edit)

Build order follows dependency, not the ruling's own numbering — each part
must be gate-clean before the next depends on it:

1. **Part A = ruling point 1, OWNER KEY.** `web/src/store/profile.ts`:
   add persisted `syncedAccountId` (store v6→7), `setSyncedAccountId`
   action, `logOut()` also resets it, `partialize` widened. Then
   `web/src/components/profile-sync.tsx`: pure `isAccountSwitch`, pure
   `planReconcileForSignIn` (test-support composition proving "switch →
   algebraically a fresh device's first sign-in"), and the real `onSession`
   wiring (compare → conditional real `logOut()` → `setSyncedAccountId`
   → today's existing code, unchanged, falls through). Gate after.
2. **Part B = ruling point 4, SERIALIZE pullMergeAndPush (the guide's Q4).**
   Same file: `runSyncSerialized` (in-flight guard + one coalesced
   follow-up), wired into the debounced-push effect's `carriesListChange`
   branch in place of the bare `pullMergeAndPush` call. Built before Part D
   because the flush's list-path reuses it. Gate after.
3. **Part C = ruling point 2 / AMENDMENT point 7, CLEAR ONLY ON A DELIBERATE
   SIGN-OUT.** `web/src/app/auth/signout/route.ts`: redirect target gains a
   one-time `?signed-out=1` marker (still 303). `profile-sync.tsx`: pure
   `hasSignedOutMarker`, `urlWithoutSignedOutMarker`, `shouldClearOnThisLoad`
   (marker present AND this device has an owner) — read inside `ProfileSync`
   itself (it is the component already mounted app-wide at the layout root;
   confirmed by reading `web/src/app/layout.tsx`, no other app-wide client
   component is a better fit) via a new mount-only `useEffect`. Gate after.
4. **Part D = ruling point 3, FLUSH FIRST, WARN ONLY ON FAILURE.**
   `profile-sync.tsx`: pure `flushBeforeSignOut` (injected deps: pushFailed,
   pendingPatch, cancelDebounce, attemptPush, stillDirty — same DI shape as
   `PullBeforePushDeps`), bounded with a real race-against-timeout helper;
   `requestProfileFlush()` bridge + a module-level registration slot filled
   by `ProfileSync` on mount (the component's own refs — debounce timer,
   last-pushed baseline, the Part B serialization flags — are not reachable
   from outside the component any other way without widening every existing
   `useRef` to module scope, which is a larger and riskier diff than
   necessary). `web/src/app/account/account-section.tsx` — actually
   `web/src/components/account/account-section.tsx`: `handleSignOutSubmit`
   always intercepts, awaits `requestProfileFlush()`, combines with the
   unchanged feed-side flag, submits the real form programmatically
   (`element.submit()`, which does not re-fire `onSubmit`) on success, shows
   the existing confirmation on failure/timeout. `AccountSectionView` itself
   (the presentational half) is NOT touched — its existing tests must stay
   green unmodified. Gate after.
5. **Part E = ruling point 5, copy check.** No code change expected —
   confirm "Some changes on this device haven't reached your account yet.
   Signing out removes them from this device." stays TRUE after Parts C+D
   (it does: Part D flushes before the warning can show for the "failed
   push" half, and when it cannot flush in time, the warning's own sentence
   — "removes them from this device" — is exactly what signing out anyway
   now does, since nothing else clears local state except this same
   deliberate path). No STOP expected; will confirm explicitly before
   closing out.

Tests: adjusted from the guide's 10 (owner key 1-5, clear-and-flush 6-10) to
§1bt.7's marker-driven clear, plus the guide's Q4 serialization 4, plus the
task's two explicit regression scenarios (topic+project+ledger together;
ledger alone). Never delete/weaken a pre-existing test; two pre-existing
source-text assertions WILL need their literal-shape updated (the
`partialize` regex in `profile.test.ts`, and the `pullMergeAndPush(
listPullDeps(...))` call-shape regex in `profile-sync.test.tsx`) because the
shape they pin is deliberately widened/wrapped by this item — both get the
comment "ACCOUNT-SWITCH (§1bt)" and keep proving the same property under the
new shape, not a weaker one.

Mutation proofs planned: remove the owner-key comparison (switch test red);
clear on any signed-out load, i.e. drop the marker gate (guest test red);
drop the flush-before-submit ordering (flush-before-clear test red); remove
the serialization guard (overlap test red).

Gates baseline (HEAD d0f86fa3, from the brief): 294 files (291 + 3 skipped) /
5680 passed + 6 skipped / 0 failed; tsc 0 errors; eslint 0 errors / 151
warnings; build OK.

No network call will be made. No commit/push/branch/worktree operation. No
`.env`/`.env.local` read or printed. No person's name will appear anywhere
in code, tests, or this file.

## Progress

### Part A (ruling point 1, OWNER KEY) — DONE (2026-09-30T12:01:12Z)

Changed: `web/src/store/profile.ts` (syncedAccountId field + setter,
logOut() resets it, partialize widened, persist v6→7 with a v7 comment,
no migrate() change — a missing key already reads as null, the same
widen-don't-rename shape v5/v6 used). `web/src/components/profile-sync.tsx`
(pure `isAccountSwitch`, pure `planReconcileForSignIn` for headless
testing, and the real `onSession` wiring: compare → real `logOut()` first
on a genuine switch (+ a defensive `didInitialPullRef.current = false`
reset, reasoned about below) → eager `setSyncedAccountId(userId)` →
today's existing code falls through unchanged).

Decision — the defensive `didInitialPullRef` reset: the guide's mechanism
says a switch should make "the same existing code... run with local ===
defaultProfile," which requires the `didInitialPullRef`-gated pull to
actually execute. Reading the file, `didInitialPullRef` is only ever
`true` entering a signed-in call if an earlier signed-in session on this
SAME mount already completed a pull — and the existing signed-out branch
already resets it to `false` on every confirmed OR involuntary sign-out
(per the AMENDMENT, `onSession(null)` still runs in both cases). So in
every auth-event shape this codebase produces today, a genuine switch is
never actually reached with `didInitialPullRef.current` still `true`. I
added the reset anyway (one line, inside the switch branch only, so it
changes nothing on the ordinary path) because it costs nothing and turns
an assumption about event ordering into a guarantee — if that assumption
ever stops holding (e.g. a future auth provider change), the reconcile
for the new owner still runs instead of silently no-op'ing. Documented
inline; not a policy change, an implementation robustness choice.

Tests added: `isAccountSwitch` (3), `planReconcileForSignIn` — the guide's
Q5 owner-key tests 1-4, adjusted to call this composed function directly
(profile-sync.test.tsx), each with its named mutation guard in a comment;
a source-text check that `onSession` actually wires `isAccountSwitch` →
`logOut()` → `setSyncedAccountId()` in that order, before the existing
`didInitialPullRef` early-return (4 tests). `profile.test.ts`: the guide's
Q5 test 5 (a pre-v7 blob has no key → null, "no owner yet"), a
lastSynced-pattern persistence round trip, and a `logOut()` reset test (3
tests). Pre-existing test CHANGED (comment "ACCOUNT-SWITCH (§1bt)"): the
`partialize` source-text regex in profile.test.ts, widened to require
`syncedAccountId` as the third (and only third) persisted key — the
property under test (entitlement never persists) is unchanged.

Mutation proof (sha256 before/after every mutation; each restored
byte-exact and re-verified — line endings confirmed unchanged by
`git ls-files --eol` before starting: profile.ts/profile.test.ts/
profile-sync.tsx are CRLF on disk, profile-sync.test.tsx/account-section.*
are LF; every edit went through the Edit tool, which preserves a file's
existing line ending):
- **Mutation 1 — removed the owner-key block from `onSession` entirely**
  (reverted to today's code: no `isAccountSwitch` check, no `logOut()`
  call, no `setSyncedAccountId`). profile-sync.tsx sha256 before
  `37bd4e5a839603015d95c92ee1245f2f93f9f19ac5070ac33473cad17e7fba29`. Ran
  `vitest -t "onSession performs the owner-key gate"` → all 3 source-text
  wiring tests RED (as designed — this wiring can only be proven by source
  text, not the pure-function tests, which test the decision in isolation
  from whether anything calls it). Restored; sha256 after
  `37bd4e5a839603015d95c92ee1245f2f93f9f19ac5070ac33473cad17e7fba29` —
  MATCH.
- **Mutation 2 — defaulted the missing-key case to a non-null sentinel**
  (`syncedAccountId: null` → `syncedAccountId: "MUTATION-SENTINEL"` in the
  store creator, the exact "widen, don't rename" spot a careless migration
  could get wrong). profile.ts sha256 before
  `659d4e27a6b8fea77277071627d412e502567788b731fcfcfce4a23d9b641e3d`. Ran
  `vitest -t "pre-v7 blob"` → test 5 RED (`expected 'MUTATION-SENTINEL' to
  be null`). Restored; sha256 after
  `659d4e27a6b8fea77277071627d412e502567788b731fcfcfce4a23d9b641e3d` —
  MATCH.
Both files' full test suites re-run clean after restoration (82/82 passed
across the two files).

Process note: an early sha256-capture command mistakenly redirected to a
bare `/tmp_sha_partA_before.txt` (Git Bash's `/` resolves to the Git for
Windows install root on this machine, not a real temp dir) instead of the
scratchpad. Caught immediately, before any mutation; deleted via its
resolved absolute Windows path (the bare `/`-rooted `rm` was itself
refused by a safety check, correctly). `git status` shows nothing at that
path now; it was never inside the repo. All sha256 values actually used
for verification above live only in
`<scratchpad>/acs-c-partA-sha-before.txt`.

### Part B (ruling point 4, SERIALIZE pullMergeAndPush) — DONE (2026-09-30T12:10:10Z)

Built before Part C/D (dependency order — the flush reuses this). Changed:
`web/src/components/profile-sync.tsx` (`SyncSerializationFlags` type,
`runSyncSerialized` — in-flight guard + one coalesced follow-up, wired into
the debounced-push effect's `carriesListChange` branch via three new
`useRef`s on `ProfileSync`).

Decision — `runSyncSerialized` always returns a genuine completion
promise, even on the branch that only COALESCES into an already-running
sequence (the guide's own pseudocode `return;`s immediately there). I
changed this because the flush (§1bt point 3, Part D) needs to know the
account is genuinely caught up before letting sign-out proceed, not merely
that an attempt was kicked off; `ProfileSync`'s own fire-and-forget caller
does not care either way (a `useEffect` cannot `await` across renders), so
this costs it nothing. One function correctly serves both callers rather
than two subtly different ones. Documented inline on the function itself.

Tests added (profile-sync.test.tsx): the guide's Q4 tests 1-4 verbatim in
intent (the invariant itself / coalescing finds nothing new / a mid-flight
edit is not dropped / bounded not unbounded), each with its named mutation
guard in a comment. Built a FIFO polling helper (`waitForNextGetRemote`)
rather than counting `await Promise.resolve()` hops by hand — an early
draft hard-coded a tick count and hung (real `pullMergeAndPush` crosses
several internal `await` boundaries between "previous call resolved" and
"next call happens"; guessing the count wrongly left a fake's resolver
permanently unconsumed). The polling helper removes that assumption and
still runs in under a second (only empty microtask turns are awaited, no
real delay). Pre-existing test CHANGED (comment "ACCOUNT-SWITCH (§1bt
point 4)"): the source-text test asserting the debounced effect's
list-carrying branch calls `pullMergeAndPush(listPullDeps(...))` directly
now asserts it calls `runSyncSerialized(listPullDeps(...), ...)` — the
property under test (list changes are routed through the pull-before-push
path, before the ordinary push path) is unchanged; the wrapping is what's
new, and is itself proven by the 4 new tests just above it.

Mutation proof: profile-sync.tsx sha256 before
`432e9868d12feac0a1dc7fa1d2e491bb59503a40a5e4e00f5dbb6628b84dcf2b`.
Removed the guard (`if (flags.inFlight.current)` → `if (false)`, so every
call runs a fresh, unguarded attempt). Ran `vitest -t "the invariant
itself"` → RED (`expected 2 to be 1` — `activeCount()` reached 2, exactly
the overlap the guard exists to prevent). Restored; sha256 after
`432e9868d12feac0a1dc7fa1d2e491bb59503a40a5e4e00f5dbb6628b84dcf2b` —
MATCH. Full file re-run clean after restoration (46/46).

Gates: `npx vitest run` → 294 files (291 + 3 skipped) / 5698 passed + 6
skipped / 0 failed (+4 over Part A's 5694). `npx tsc --noEmit` → 0 errors.
`npx eslint .` → 0 errors / 151 warnings (unchanged). `npm run build` →
OK.

### Part C (ruling point 2 / AMENDMENT point 7, CLEAR ONLY ON A DELIBERATE SIGN-OUT) — DONE (2026-09-30T12:14:50Z)

Changed: `web/src/app/auth/signout/route.ts` (redirect target
`${origin}/` → `${origin}/?signed-out=1`, still a 303, nothing else
touched). `web/src/components/profile-sync.tsx` (pure
`hasSignedOutMarker`, `urlWithoutSignedOutMarker`, `shouldClearOnThisLoad`;
a new mount-only `useEffect` on `ProfileSync`, independent of the auth
effect, `[]` deps).

Decision — where the marker is read: `ProfileSync`, confirmed by reading
`web/src/app/layout.tsx:149` — it is mounted exactly once, unconditionally
(not gated on auth state or Supabase configuration), at the app root. No
other app-wide client component is a better fit: it is already the single
place this codebase treats as "sees every fresh load" (the same reasoning
`useSyncGate`/`useProfileSyncStatus` already rely on as module-level
singletons). The new effect is deliberately its OWN `useEffect` (not
folded into the existing auth effect): it is a URL-keyed, page-load-time
cleanup, not an auth-state decision, and must run even when Supabase is
not configured or the auth check is slow/failing — tying it to the auth
effect's own control flow would make it depend on something it has no
logical dependency on.

Decision — `shouldClearOnThisLoad` checks the owner key, not just the
marker: a guest who reaches a `?signed-out=1` URL by some other means
(a shared/bookmarked link, back-button) has `syncedAccountId === null`
already, so there is nothing to clear — checking this explicitly (rather
than trusting `logOut()` to be a harmless no-op on an already-default
profile) keeps "should clear" provable as its own statement and matches
the AMENDMENT's own framing ("runs logOut() if the device's data has an
owner").

Tests added (profile-sync.test.tsx): `hasSignedOutMarker` (6 cases),
`urlWithoutSignedOutMarker` (4 cases), `shouldClearOnThisLoad` (4 cases);
the AMENDMENT's four named scenarios (guest survives repeated loads;
involuntary loss keeps data and a later same-account sign-in still merges
it, chained with Part A's `planReconcileForSignIn`; the marker clears once
and is gone from a re-derived URL; a different account after an
involuntary loss starts clean, chained with Part A again); a source-text
check that the mount effect actually gates the real `logOut()` call on
`shouldClearOnThisLoad` (not the marker alone) and strips the marker
unconditionally once seen. No pre-existing test touched in this part.

Note: an early draft of the source-text check used a start marker
containing a literal embedded newline (`"useEffect(() => {\n    if..."`),
which cannot match this CRLF-on-disk file's actual bytes — caught
immediately by the test itself failing to even collect (0 tests
reported), fixed by switching to a single-line marker (the effect's own
leading comment), matching this file's pre-existing `closureBody` helper's
own established, newline-free-marker convention.

Mutation proof: profile-sync.tsx sha256 before
`316e7c09686d072d8bd681a147678136f62e2741078987c393f319488a723e2a`.
Mutated `shouldClearOnThisLoad` to `return true;` unconditionally (the
shape of "clear on any signed-out load," the superseded point-2 trigger
the AMENDMENT replaces). Ran `vitest -t "guest"` → RED (`expected true to
be false`). Restored; sha256 after
`316e7c09686d072d8bd681a147678136f62e2741078987c393f319488a723e2a` —
MATCH. Full file re-run clean after restoration (57/57).

Gates: `npx vitest run` → 294 files (291 + 3 skipped) / 5709 passed + 6
skipped / 0 failed (+11 over Part B's 5698). `npx tsc --noEmit` → 0
errors. `npx eslint .` → 0 errors / 151 warnings (unchanged). `npm run
build` → OK.

Follow-up resolved: added `web/src/app/auth/signout/route.test.ts` (new
file — no pre-existing test covered this route), following the one
established repo pattern for this shape
(`src/app/api/profile/confirm-email/route.test.ts` — the only other route
that both mocks `@/lib/supabase/server` and asserts on a
`NextResponse.redirect`, found by delegating a short read-only search
rather than guessing): mocks `createClient` to return `{ auth: { signOut }
}`, asserts `signOut` is called once, the status is 303, and the
`location` header is exactly `<origin>/?signed-out=1` for two different
origins. 4 tests, all new (no pre-existing test in this file to weaken).

### Part D (ruling point 3, FLUSH FIRST, WARN ONLY ON FAILURE) — DONE (2026-09-30T12:22:33Z)

Changed: `web/src/components/profile-sync.tsx` (`FlushBeforeSignOutDeps`
type, pure `flushBeforeSignOut` + a small `raceWithTimeout` helper;
`requestProfileFlush()` bridge + a module-level `activeFlush` slot; a new
registration `useEffect` (`[]` deps) on `ProfileSync` building the real
deps from its own refs and calling the same functions the debounced push
already uses). `web/src/components/account/account-section.tsx`
(`handleSignOutSubmit` rewritten: always `preventDefault()`s, awaits
`requestProfileFlush()`, combines with the unchanged feed-side flag
through the EXISTING `hasUnsyncedChanges`/`shouldWarnBeforeSignOut` pure
functions, submits the real form programmatically on success or shows the
existing confirmation on failure). `AccountSectionView` (the presentational
half) was NOT touched.

Decision — the "anything unsynced" signal is one check, not two flags:
`pendingPatch()` non-empty covers BOTH named triggers (a failed push
leaves its field(s) dirty against the last-confirmed baseline forever,
since `nextSyncBaselines` never advances that baseline on failure —
§1bk.9a — so the diff stays non-empty; a live debounced edit has, by
definition, already changed the diff away from it) — kept `pushFailed` as
a second, belt-and-suspenders input anyway (not strictly redundant: a
profile that reverted back to matching the stale baseline after a failure
would show an empty diff while the flag is still stale-true — a narrow
edge case, resolved conservatively toward "still attempt the flush").
Documented inline on `FlushBeforeSignOutDeps`.

Decision — `requestProfileFlush`/`activeFlush` module-level registration,
not a widening of every existing `useRef` in `ProfileSync` to module
scope: the component's refs (debounce timer, last-pushed baseline, the
Part B serialization flags) are only reachable from OUTSIDE the component
this way without a much larger diff touching working, already-tested
code. `requestProfileFlush()` falls back to `true` (proceed) when nothing
is registered, so sign-out can never hang on a `ProfileSync` that has not
mounted yet.

Decision — `form.submit()`, never `.requestSubmit()`: the native
`.submit()` method does not fire the `submit` DOM event, so it cannot
re-invoke `handleSignOutSubmit` and cannot loop; `.requestSubmit()` would
re-fire it. Verified against MDN's documented distinction (not
re-guessed) and pinned by a source-text ordering test (submit only after
the flush decision).

No-JS fallback: unchanged and unaffected — the `<form method="POST"
action="/auth/signout">` element itself was not touched; the SAME
pre-existing tests in account-section.test.tsx that already pin its exact
`method`/`action`/single-form shape still pass unmodified (confirmed by
running that file's full suite, 15/15, with no edits to those tests).

Tests added (profile-sync.test.tsx): `flushBeforeSignOut` — nothing
unsynced (immediate true, no side effects called); success (cancel THEN
attempt, in that order); bounded/never-hangs (a promise that never
resolves still returns within the configured bound — tests pass a short
30ms bound rather than the real 2000ms, to stay fast); a settled-but-failed
attempt also warns; an already-failed push alone still triggers an
attempt (5 tests, each with a mutation-guard comment where applicable);
`requestProfileFlush`/registration source-text checks (2). Tests added
(account-section.test.tsx): source-text checks that `handleSignOutSubmit`
always calls `preventDefault()` first, awaits the flush before deciding,
submits only AFTER that decision (never before), and the warning branch
`return`s before ever reaching `form.submit()` (4 tests + 1 "markers
exist"). Tests added (route.test.ts, Part D's own follow-up): 4, listed
above. No pre-existing test deleted, weakened, or needed a changed
assertion in this part.

Mutation proof:
- profile-sync.tsx sha256 before
  `881e15de3f1dc4db2598c8746d3ad849d4005bbfb524ffc9147c09194ea28d1c`.
  Dropped the flush (`flushBeforeSignOut` body reduced to `return
  !deps.stillDirty();`, never calling `cancelDebounce`/`attemptPush`). Ran
  `vitest -t "success case"` → RED (`expected [] to deeply equal ["cancel",
  "attempt"]`). Restored; sha256 after
  `881e15de3f1dc4db2598c8746d3ad849d4005bbfb524ffc9147c09194ea28d1c` —
  MATCH.
- route.ts sha256 before
  `482bbe475c85f08de72ab21120ede5d87f54afdb4effd27030431f9f2d21c720`.
  Reverted the redirect target to the pre-§1bt.7 bare `${origin}/` (no
  marker). Ran `vitest run route.test.ts` → 3 of 4 RED (the marker-shaped
  assertions; the unrelated `signOut()` call-count test correctly stayed
  green). Restored; sha256 after
  `482bbe475c85f08de72ab21120ede5d87f54afdb4effd27030431f9f2d21c720` —
  MATCH.
Both files' full test suites re-run clean after restoration.

Gates (after adding the flush, then again after adding route.test.ts):
`npx vitest run` → final state 295 files (292 + 3 skipped) / 5725 passed +
6 skipped / 0 failed. `npx tsc --noEmit` → 0 errors. `npx eslint .` → 0
errors / 151 warnings (unchanged throughout). `npm run build` → OK.

### Part E (ruling point 5, copy check) — DONE, no change (2026-09-30T12:26:14Z)

The confirmation sentence ("Some changes on this device haven't reached
your account yet. Signing out removes them from this device.") lives only
in `AccountSectionView` (account-section.tsx line ~145), which this item
never touched — confirmed verbatim present, unmodified, by direct grep
after all four other parts landed.

Verified TRUE after Parts A-D, reasoned through both halves:
- **"haven't reached your account yet"**: the warning only shows when
  `shouldWarnBeforeSignOut(stillUnsynced, confirmingSignOut)` is true,
  and `stillUnsynced` is now `hasUnsyncedChanges(!profileFlushed,
  feedPushFailed)` — true only when the Part D flush itself failed or
  timed out (a genuine profile push that did not land) or the
  pre-existing, unaffected feed flag is set (a genuine feed push that did
  not land). The premise is never shown on a false pretense.
- **"Signing out removes them from this device"**: clicking "Sign out
  anyway" submits the second, unhandled `<form>` — a plain POST to
  `/auth/signout` (untouched) → the server redirects to
  `/?signed-out=1` (Part C) → the marker-driven mount effect sees
  `syncedAccountId !== null` (true — this device was signed in, or it
  could not have had a push failure to warn about) → calls the real
  `logOut()`, which DOES clear the local profile. Before this item this
  was FALSE for profile data (nothing ever cleared it); it is now TRUE.
  For feed data, `resetLocal()` already ran on every confirmed sign-out
  before this item (unaffected, already true).
- Residual, not a truth problem: a flush that gives up at the 2-second
  bound may still have a request genuinely in flight; whether the browser
  lets it finish during the subsequent navigation is not controlled by
  this code either way, no different in kind from the already-accepted
  "third push lands in the gap" class of residual risk named elsewhere in
  these rulings (§1bq.3). The sentence describes the device's local copy
  being cleared, which happens unconditionally and promptly once the
  marker is seen, regardless of that unrelated network race.

No STOP needed — the copy was kept byte-for-byte unchanged, as required
when it stays true.

Added one more test after all four parts landed, matching the guide's own
test 9 exactly (proving the COMBINED design, not any one mechanism in
isolation): a successful flush reaching A's own account, then the marker
clear wiping local state, then A signing back in and losing nothing — see
profile-sync.test.tsx. Re-ran all four gates after adding it (below).

---

## STATUS: IMPLEMENTED_PENDING_REVIEW (2026-09-30T12:28:46Z)

### Changed files
- `web/src/store/profile.ts` — owner key field/setter, `logOut()` widened,
  `partialize` widened, persist v6→7.
- `web/src/components/profile-sync.tsx` — `isAccountSwitch`,
  `planReconcileForSignIn`, the real `onSession` owner-key wiring;
  `SyncSerializationFlags`, `runSyncSerialized`, wired into the debounced
  effect; `hasSignedOutMarker`, `urlWithoutSignedOutMarker`,
  `shouldClearOnThisLoad`, the new mount effect; `FlushBeforeSignOutDeps`,
  `flushBeforeSignOut`, `raceWithTimeout`, `requestProfileFlush`,
  `activeFlush`, the new registration effect.
- `web/src/app/auth/signout/route.ts` — redirect target gained
  `?signed-out=1`.
- `web/src/components/account/account-section.tsx` —
  `handleSignOutSubmit` rewritten (flush-first wiring); `AccountSectionView`
  untouched.
- `web/src/store/profile.test.ts` — 3 new tests (Part A) + 1 changed
  pre-existing assertion (`partialize` regex, commented
  "ACCOUNT-SWITCH (§1bt)").
- `web/src/components/profile-sync.test.tsx` — new tests for every part
  (owner key, serialization, marker clear, flush) + 1 changed pre-existing
  assertion (the `pullMergeAndPush(listPullDeps(...))` call-shape regex,
  commented "ACCOUNT-SWITCH (§1bt point 4)").
- `web/src/components/account/account-section.test.tsx` — 5 new
  source-text wiring tests (Part D); no pre-existing test touched.
- `web/src/app/auth/signout/route.test.ts` — new file, 4 tests (no
  pre-existing test to weaken; the route had none before).

### Tests
294 → 295 test files; 5680 → 5726 passed (+46 net new), 6 skipped
throughout, 0 failed at every gate checkpoint. Breakdown: Part A 14, Part B
4, Part C 11, Part D 12 (incl. route.test.ts's 4), plus 1 added after all
parts landed (the combined-design end-to-end test) = 46. Two pre-existing
assertions changed (never deleted/weakened), each carrying the required
"ACCOUNT-SWITCH (§1bt)" comment and proving the same property the original
did, under the new (widened/wrapped) shape.

### Mutation proof (all restored byte-exact; sha256 verified before/after
every one; line endings unaffected throughout — confirmed by
`git ls-files --eol` before starting and spot-checked with `od` where a
discrepancy first looked possible)
1. Removed the owner-key comparison from `onSession` entirely → the 3
   wiring source-text tests RED. Restored, sha256 match.
2. Defaulted the missing `syncedAccountId` key to a non-null sentinel →
   the pre-v7-blob migration test RED. Restored, sha256 match.
3. Removed `runSyncSerialized`'s in-flight guard → the overlap invariant
   test RED (`activeCount` reached 2). Restored, sha256 match.
4. Mutated `shouldClearOnThisLoad` to always clear (the superseded
   "clear on any signed-out load" trigger) → the guest test RED. Restored,
   sha256 match.
5. Dropped the flush from `flushBeforeSignOut` (`return
   !deps.stillDirty()` only) → the flush-ordering success test RED.
   Restored, sha256 match.
6. Reverted `signout/route.ts`'s redirect target to the pre-item bare
   `${origin}/` → 3 of 4 new route tests RED. Restored, sha256 match.
Every mutation's target test file was re-run in full immediately after
restoration and passed completely, each time.

### Gates (final, after every part including the post-hoc test 9)
`npx vitest run` → 295 files (292 + 3 skipped) / 5726 passed + 6 skipped /
0 failed. `npx tsc --noEmit` → 0 errors. `npx eslint .` → 0 errors / 151
warnings (identical set to the baseline throughout — no new warning
introduced). `npm run build` → OK (compiles, typechecks, generates all
static/dynamic routes; the one Turbopack NFT warning about
next.config.ts/pdf-text.ts is pre-existing and unrelated to this item).

### Decisions (reasons inline above, in each part's own section; indexed here)
1. Defensive `didInitialPullRef.current = false` reset on a detected switch
   (Part A) — costs nothing on the ordinary path, closes a theoretical gap
   against the ruling's own stated intent.
2. `runSyncSerialized` always returns a genuine completion promise, even
   when only coalescing (Part B) — the guide's own pseudocode returns
   immediately there; changed because the flush (Part D) needs to know
   completion, not merely that an attempt started.
3. The marker is read inside `ProfileSync` itself, in its own independent
   mount effect (Part C) — it is the one component already mounted
   app-wide, unconditionally, and the clear is a URL-keyed page-load
   concern, not an auth-state decision.
4. `shouldClearOnThisLoad` checks the owner key, not just the marker (Part
   C) — keeps "should clear" provable as its own true/false statement
   rather than leaning on `logOut()` being a harmless no-op for a guest.
5. "Anything unsynced" is one check (`pendingPatch()` non-empty), not two
   flags kept in sync (Part D) — a failed push and a live pending edit
   both show up as the same non-empty diff against the last-confirmed
   baseline; `pushFailed` kept anyway as a conservative second input.
6. `requestProfileFlush`/`activeFlush` module-level registration rather
   than widening every existing `useRef` to module scope (Part D) —
   smaller, less risky diff; falls back to "proceed" if nothing is
   registered, so sign-out can never hang.
7. `form.submit()`, never `.requestSubmit()` (Part D) — the former cannot
   re-fire the `onSubmit` handler and therefore cannot loop; verified
   against the documented DOM distinction, pinned by a source-text
   ordering test.
8. Part E: the confirmation copy was verified true and left byte-for-byte
   unchanged — no STOP needed.
9. Build order followed dependency (A → B → C → D), not the ruling's own
   numbering (1,4,2,3 by the ruling's own point numbers) — Part D's flush
   reuses Part B's serialization, so B had to exist first; stated in the
   plan before any part began.

### Privacy / hard-constraint compliance
No network call made. No commit/push/stash/checkout/worktree/branch
operation. `.env`/`.env.local` never opened or printed; no API key
written anywhere. No person's name anywhere written (one pre-existing-style,
two-word name-shaped fixture value — not reproduced here, per this same
rule — was caught in a newly-added test during a self-review pass and
replaced with a construction-* value before this checkpoint closed — see
Part A/general notes; final `git diff` scan for name-shaped and
email-shaped strings across every changed line came back clean). Every
fictional value used is `construction-*`/`user-a`/`user-b`
prefixed. No temporary file left outside `<scratchpad>/` or
`docs/jev-abc/`; one accidental root-level file from an early sha256
capture command was caught and deleted immediately via its resolved
absolute path before any mutation ran (recorded above under Part A).
`web/src/store/feed.ts` was read for the `syncedUserId`/`sessionStep`
pattern only — not modified. `git status` at close: exactly the 7 changed
files, 1 new test file, and this checkpoint — nothing else.

---

## ROUND 2 (§1bt.8 AMENDMENT) — STATUS: IN_PROGRESS (2026-09-30T12:58:10Z)

Fresh A FAILED_REVIEW (docs/jev-abc/ACCOUNT-SWITCH-A-20260930T123154Z.md):
1 HIGH (pre-deploy transition, not disclosed), 1 MEDIUM (the URL marker is
forgeable), 1 LOW (double-click, no busy guard). §1bt.8 AMENDMENT (read in
full at ABC-JEV-INTEGRATION.md line 268) rules: (a) transition = ACCEPTED
COST, disclosed, no code; (b) replace the URL marker with a short-lived
first-party cookie, bound to a CONFIRMED signed-out outcome; (c) a busy
guard so a double submit is one flush, one POST.

### Plan

1. **(b), MEDIUM — cookie-bound clear.** Read
   `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`
   (a route handler setting `response.cookies.set(...)` alongside
   `NextResponse.redirect`) and
   `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`
   (the full cookie-options table: `maxAge`, `path`, `sameSite`, `httpOnly`,
   ...) before touching route.ts — done, see "Next docs read" below.
   `route.ts`: redirect target back to plain `${origin}/`; set a cookie
   (name `peer_signed_out`, value `"1"`, `maxAge: 60`, `path: "/"`,
   `sameSite: "lax"`, `httpOnly: false` — matching this codebase's own
   existing `response.cookies.set(name, value, options)` shape, already
   used in `web/src/lib/supabase/middleware.ts`, rather than the docs'
   alternative single-object-argument form, for in-repo consistency).
   `profile-sync.tsx`: pure `hasSignOutCookie`, pure
   `shouldClearOnConfirmedSignOut` (cookie present AND `authOutcome ===
   "signed-out"` — never "unknown"/"unconfigured"/"signed-in" — AND an
   owner recorded), a DI-based `processConfirmedSignOutCookie` (decide,
   clear if warranted, THEN always consume/delete the cookie), wired into
   `onSession`'s existing `!signedIn` branch — the one place `authOutcome`
   becomes the CONFIRMED `"signed-out"` value — replacing the old
   mount-only marker effect entirely.
   Removing (not merely bypassing) `hasSignedOutMarker`,
   `urlWithoutSignedOutMarker`, `shouldClearOnThisLoad` and the old mount
   effect: leaving them present-but-unwired would still be a live copy of
   finding 2's exact vulnerability if anything ever re-called them, and a
   forged/shared/bookmarked pre-round-2 link with `?signed-out=1` must do
   nothing under the new code regardless. Their existing tests are
   TRANSFORMED (comment "ACCOUNT-SWITCH (§1bt.8)"), not dropped — see
   Tests below; total test count for this concern only grows.
2. **(c), LOW — busy guard.** `account-section.tsx`: a `useRef`-based
   re-entrancy guard around the async flush sequence (`handleSignOutSubmit`
   → extracted, DI-based `handleSignOutSubmitCore`, testable without a
   DOM) plus the existing `busy` state reused to visually disable the
   "Sign out" button while it runs (`AccountSectionView` already threads
   `busy` through for the sign-in buttons — reused, not a new prop).
3. **(a), HIGH — accepted cost, no code.** A short "Accepted costs"
   section below, in plain words.

### Next docs read (before touching route.ts)

- `01-app/02-guides/backend-for-frontend.md` lines ~606-628: a route
  handler building `NextResponse.redirect(...)`, then calling
  `response.cookies.set({...})` on the SAME response object before
  returning it — confirms cookies attach to the redirect response itself,
  no separate step.
- `01-app/03-api-reference/04-functions/cookies.md` lines ~43-61: the full
  option table (`name`, `value`, `expires`, `maxAge`, `domain`, `path`
  [default `/`], `secure`, `httpOnly`, `sameSite` [`false|'lax'|'strict'|
  'none'`], `priority`, `partitioned`).
- Cross-checked against this repo's OWN existing cookie-setting code
  (`web/src/lib/supabase/middleware.ts:28`,
  `response.cookies.set(name, value, options)`) — the positional
  3-argument form, which this item follows for consistency rather than the
  docs' alternative single-object form.
- Decision: NOT setting `secure` explicitly. The AMENDMENT's own stated
  attribute list is exactly max-age/path/SameSite/not-HttpOnly — it does
  not mention `secure`, and this is a non-sensitive marker (not a session
  token), so I implement precisely what was ruled rather than adding an
  attribute that could silently break a plain-HTTP local dev setup I have
  no way to test live (hard constraint: never start the dev server).
  Flagging this choice explicitly for the next reviewer rather than
  deciding it silently.

### Accepted costs (§1bt.8(a) — HIGH, documentation only, no code change)

**The pre-deploy transition.** Every browser that already had Peer open
before this fix ships has no owner recorded for its local settings (the
owner field simply did not exist yet). The very first time a DIFFERENT
person signs in on one of those browsers after the fix ships, the
owner-key check cannot tell that a switch is happening — because, from
its point of view, this looks EXACTLY like a brand-new browser that has
never been signed into before, which is supposed to hand its local data
up freely. So, once, per browser, the old leak can still happen: whichever
account signs in first after the deploy inherits whatever the browser's
previous owner had sitting there unsynced.

Why this is accepted rather than fixed: the user was already told, for a
separate, earlier fix (§1bk.3), to use exactly this same kind of trust —
"open Peer on the computer whose settings are right, and let it push those
settings back up to fix a broken account." That recovery only works
because a browser's local settings, with no owner recorded, are trusted
ONCE. If a stricter rule refused to trust ANY unowned local browser data,
it would break that same recovery path for everyone who still needs it,
not just close this one gap. A rule that is stricter for one case has to
be stricter for both, and the other case is a feature the project already
relies on.

Who is actually exposed: only a browser where (1) it was used before this
fix shipped, AND (2) a DIFFERENT person signs into that same browser next,
before the FIRST person ever signs in again after the fix ships. Once any
account has signed in on a browser after the deploy, that browser has an
owner recorded and every later switch is caught normally. This is a
narrowing, one-time window, not an ongoing hole.

What would close it instead, if the project decides this cost is too high
later: ask the very first signed-in reader on a browser with no recorded
owner a plain yes/no question — "This computer has Peer settings saved
from before — keep using them for your account?" — before merging
anything. Not built now; the threshold in the ruling is one real report of
this actually happening.

### Implementation — (b) cookie-bound clear, (c) busy guard

Changed: `web/src/app/auth/signout/route.ts` (redirect target back to
plain `${origin}/`; sets `peer_signed_out=1` via `response.cookies.set(name,
value, options)` — the positional form already used in this repo's
`web/src/lib/supabase/middleware.ts`, matched for consistency over the
docs' alternative single-object form — `maxAge: 60`, `path: "/"`,
`sameSite: "lax"`, `httpOnly: false`, no `secure` set, see the "Decision"
above). `web/src/components/profile-sync.tsx` (removed, not bypassed:
`hasSignedOutMarker`, `urlWithoutSignedOutMarker`, `shouldClearOnThisLoad`,
and the old mount-only `useEffect` that wired them; added `SIGN_OUT_COOKIE_NAME`,
pure `hasSignOutCookie`, `deleteSignOutCookie`, pure
`shouldClearOnConfirmedSignOut`, DI-based `processConfirmedSignOutCookie`;
wired into `onSession`'s existing `!signedIn` branch, at the exact line
`authOutcome` becomes the confirmed `"signed-out"` value).
`web/src/components/account/account-section.tsx` (new exported
`SignOutSubmitDeps`/`SignOutGuard`/`handleSignOutSubmitCore` — the
DI-based, ref-guarded flush-then-decide sequence; `AccountSection`'s
`handleSignOutSubmit` now builds the deps and delegates to it, wrapped in
`setBusy(true)`/`finally setBusy(false)`; `AccountSectionView`'s Sign out
button gained `disabled={busy}`, reusing the existing prop already threaded
for the sign-in buttons — no new prop).

Decision — deleted the old marker functions rather than leaving them
unwired: leaving `hasSignedOutMarker`/`shouldClearOnThisLoad` present but
disconnected would still be a live copy of finding 2's exact vulnerability
if anything ever re-called them, for a mechanism that exists specifically
to close a privacy/data-loss hole — too easy to accidentally reconnect
later. Every one of their existing round-1 tests was TRANSFORMED (not
deleted) into an equivalent or stronger test of the new cookie mechanism,
each carrying the required comment; total test count for this concern
grew (8+4 old → 6+4+5+4 new, before counting the new forged-link-specific
test). One over-broad assertion in my first draft of the "old mechanism no
longer exists" test (`not.toMatch(/hasSignedOutMarker/)`) also caught my
own EXPLANATORY comments that name the old functions on purpose (to say
why they are gone) — narrowed to check actual code (a definition or a
call), not prose, and re-verified green.

Decision — `handleSignOutSubmitCore` extracted as a new pure/DI function
rather than adding the guard inline inside `handleSignOutSubmit`: this
repo's whole established testing convention (`PullBeforePushDeps`,
`FlushBeforeSignOutDeps`, and this item's own `ProcessConfirmedSignOutCookieDeps`)
is "pull the interesting decision out, test it directly with fakes, check
only the thin wrapper by source text" — followed the same shape rather than
inventing a new one, and it let the double-submit guard be proven by a
REAL concurrent call (two promises racing against a shared ref) instead of
only a regex.

Decision — the `secure` cookie attribute: NOT set, matching the
AMENDMENT's own stated attribute list exactly (max-age, path, SameSite,
not-HttpOnly — no mention of secure) and avoiding an attribute that would
silently break local HTTP development, which the hard constraints forbid
me from testing live either way. Flagged for the next reviewer rather than
decided silently — see "Next docs read" above.

Self-correction (disclosed): while privacy-scanning this round's own diff,
I found my ROUND 1 checkpoint had literally NAMED the pre-existing
name-shaped test fixture value in its own "Privacy / hard-constraint
compliance" section while disclosing that I had removed a fresh copy of
it — a violation of "no person's name anywhere you write... not even when
describing a privacy check," by me, in round 1, that slipped through my
own round-1 review. The fresh reviewer's own report correctly avoided
reproducing it ("Not reproduced here, per the no-names privacy rule").
Fixed now: reworded to describe the fixture without naming it. No code
was ever affected — this was checkpoint prose only.

### Tests

New: `hasSignOutCookie`/`deleteSignOutCookie`/`shouldClearOnConfirmedSignOut`
(6), `processConfirmedSignOutCookie` (4), the §1bt.8 scenario re-runs
including the forged-link case (6), the onSession wiring source-text
checks (5), `handleSignOutSubmitCore` behavioural tests incl. the
double-submit guard (6), the busy-attribute render checks (2), the
route.test.ts cookie-attribute checks (replacing 2 of the 4 round-1
tests' bodies, 1 repurposed, 1 unchanged) — net vitest count 5726 → 5742
(+16). Changed pre-existing assertions (comment "ACCOUNT-SWITCH (§1bt.8)"
throughout, never deleted): the two describe blocks built on
`hasSignedOutMarker`/`urlWithoutSignedOutMarker`/`shouldClearOnThisLoad`
in profile-sync.test.tsx (12 `it` blocks transformed into the cookie
equivalents); 4 `it` blocks in account-section.test.tsx's wrapper
source-text checks (2 kept checking still-true properties, 2 repurposed to
the wrapper's new responsibilities since the sequencing they used to pin
moved into `handleSignOutSubmitCore`); 3 of route.test.ts's 4 tests
(redirect target text, origin test, and the marker-vs-bare-root test
inverted into the cookie-attributes test).

### Mutation proof (sha256 before/after every one, byte-exact restores, line endings unaffected — `git ls-files --eol` checked first: profile-sync.tsx and route.ts CRLF, account-section.tsx LF, unchanged from round 1)

1. Dropped the "session confirmed gone" condition
   (`shouldClearOnConfirmedSignOut` reduced to `cookiePresent &&
   syncedAccountId !== null`) → the "never clears for any non-confirmed
   authOutcome" test RED (`expected true to be false` for a `"signed-in"`
   outcome). profile-sync.tsx sha256 before/after
   `d67c8859559e55776514a26255201fec4917557b2990b7ac0e768e2430ad1d24` —
   MATCH.
2. Read the URL parameter again (`cookiePresent:
   window.location.search.includes("signed-out=1")` in place of
   `hasSignOutCookie(document.cookie)`) → the "reads document.cookie...
   never window.location" wiring test RED (both its assertions flipped).
   Same file, same sha256 before/after — MATCH.
3. Dropped the busy guard (removed `if (guard.current) return;
   guard.current = true;` from `handleSignOutSubmitCore`) → the "a double
   submit during the flush → one flush, one POST" test RED (`expected 2 to
   be 1`). account-section.tsx sha256 before/after
   `c7c1a578492abdda793127cfde476e8692cada05662b57286b5af60e2ce34a8c` —
   MATCH.
4. (Extra, beyond the three named) Dropped the cookie entirely from
   route.ts's response → both cookie-attribute route tests RED (empty
   string received). route.ts sha256 before/after
   `f99f29c25ebc0e4ba77942b3c1cd338efc813579313b465359dddf819d2db985` —
   MATCH.
Every affected test file re-run in full immediately after its restore and
passed completely each time.

### Gates (final, round 2)

`npx vitest run` → 295 files (292 + 3 skipped) / 5742 passed + 6 skipped /
0 failed (round-1 baseline for this item was 5726; this round adds 16 net
new tests — arithmetic checks out). `npx tsc --noEmit` → 0 errors. `npx
eslint .` → 0 errors / 151 warnings (identical set — no new warning).
`npm run build` → OK (same pre-existing, unrelated Turbopack NFT warning
as every prior gate run).

### Changed files (round 2, cumulative with round 1)

- `web/src/app/auth/signout/route.ts`
- `web/src/app/auth/signout/route.test.ts` (round-1 new file, round-2
  edited)
- `web/src/components/profile-sync.tsx`
- `web/src/components/profile-sync.test.tsx`
- `web/src/components/account/account-section.tsx`
- `web/src/components/account/account-section.test.tsx`
- `web/src/store/profile.ts` (round 1 only — untouched this round)
- `web/src/store/profile.test.ts` (round 1 only — untouched this round)

No network call made this round. No commit/push/stash/checkout/worktree/
branch operation. `.env`/`.env.local` never opened. No API key written.
No person's name written anywhere in code, tests, or this file (the one
round-1 slip, in this file's own prose, is fixed above — disclosed, not
hidden). Every fictional value is `construction-*`/`user-a`/`user-b`
prefixed, matching round 1. One `web/src/__c_acs_probe_cookie.test.ts`
diagnostic file was created (to observe the REAL `Set-Cookie` header
Next.js produces, before finalizing test assertions against a guess) and
deleted immediately after, confirmed gone via `ls`/`git status`. All
sha256 captures and diagnostic scripts live only under
`<scratchpad>/acs-c-r2-*`.

Gates: `npx vitest run` → 294 files (291 + 3 skipped) / 5694 passed + 6
skipped / 0 failed (baseline 5680 + 14 new). `npx tsc --noEmit` → 0
errors. `npx eslint .` → 0 errors / 151 warnings (unchanged). `npm run
build` → OK (one pre-existing, unrelated Turbopack NFT warning about
next.config.ts/pdf-text.ts, present before this change).

Manager note (2026-09-30T13:3xZ): the gate paragraph just above is a stale round-1 intermediate line (5694 passed). Final numbers: ROUND 2 — 295 files (292 + 3 skipped) / 5742 passed + 6 skipped / 0 failed, tsc 0, eslint 0/151, build OK (re-run by the reviewer); after the manager's one added wiring test (onWarn opens the confirmation; a no-op onWarn makes it red, restored byte-exact) — 5743 passed + 6 skipped / 0 failed, tsc 0, eslint clean on the changed file.
