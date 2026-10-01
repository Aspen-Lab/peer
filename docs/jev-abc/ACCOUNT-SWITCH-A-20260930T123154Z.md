# ACCOUNT-SWITCH — A review — 20260930T123154Z

STATUS: FAILED_REVIEW (2026-09-30T12:50:48Z)

Reviewer: fresh A, independent. Rulings under review: §1bt (whole, including AMENDMENT §1bt.7), read together with §1bq.6 and §1bk. Target: uncommitted diff on branch Jev-integration-and-sorting-filtering-enhancement at HEAD ecec7ad8 — 7 modified files under web/src plus new web/src/app/auth/signout/route.test.ts. Implementer checkpoint docs/jev-abc/ACCOUNT-SWITCH-C-20260930T115617Z.md and guide docs/jev-abc/ACCOUNT-SWITCH-B-20260930T103019Z.md are read as claims to verify, not as fact.

## Plan

1. Read checkpoint (C) and guide (B) docs in full; read the real diff (`git diff` for the 7 files + the new test file content).
2. Re-run guide scenarios (a)-(e) plus §1bt.7's four new behaviors against the REAL code on the new (uncommitted) tree, using the real store/merge/route functions — adapt <scratchpad>/acs-*.mjs, copying the hook to a-acs-hook.mjs before any edit.
3. Work out the pre-deploy → post-deploy transition case by execution (old device, no syncedAccountId; lastSynced present vs absent) and check whether feed.ts's syncedUserId offers a safe one-time inference. Report as execution result; flag POLICY.
4. Trace the sign-out flow in account-section.tsx (handleSignOutSubmit / requestProfileFlush / flushBeforeSignOut / the 2s bound) for: no-op fast path, debounce-window flush, failed/hung flush confirmation, "Sign out anyway", no-JS form POST structure, double-click race, and confirmation-copy truth.
5. Trace the marker (web/src/app/auth/signout/route.ts → "/?signed-out=1") for where/when ProfileSync reads it, one-time clearing, and whether a crafted link to a signed-in reader could wipe their device; flag POLICY if it matters.
6. Check serialization of pullMergeAndPush (runSyncSerialized): no concurrent sequences, one coalesced follow-up, no lost mid-flight edit, bounded, flush waits for real completion.
7. Diff every changed test file against HEAD for deleted/weakened assertions; judge the two changed assertions (partialize regex, debounced-effect call-shape regex); reproduce >=4 mutations (owner-key comparison removed, clear-on-any-signed-out-load, drop the flush, remove the serialization guard) with sha256 before/after and byte-exact restores (checking line endings with `git ls-files --eol` first).
8. Run the four gates from web/ one at a time (vitest, tsc, eslint, build); compare counts against the implementer's claim and the HEAD baseline.
9. Privacy scan every changed file + the new test file + the checkpoint doc for personal strings and secret-shaped strings; report counts only.
10. Write the verdict (VERIFIED or FAILED_REVIEW), findings ranked by severity with evidence, scenario table, gate numbers.

## Log

- 20260930T123154Z — file created, plan above, starting step 1 (read checkpoint/guide/diff).
- 20260930T124252Z — Read checkpoint (C), guide (B), rulings §1bt/§1bq.6/§1bk in full, and the real diff for all 7 files + the new route.test.ts. Read the full current profile-sync.tsx (both the marker/owner-key/flush sections and the pre-existing debounced-push effect) and store/profile.ts (migration/merge functions). Read store/feed.ts's sessionStep/syncedUserId mechanism for CHECK 2.

  Executed two independent scripts against the REAL, uncommitted code (not a reimplementation): <scratchpad>/a-acs-main.mjs (owner-key scenarios (a)-(d), §1bt.7's four named behaviors, scenario (e), CHECK 4 marker-abuse, CHECK 2 transition x3 sub-cases) and <scratchpad>/a-acs-flush-serial.mjs (CHECK 5 serialization x4, CHECK 3 flush x3 + the double-click race x2). All assertions ran via `isAccountSwitch`/`planReconcileForSignIn`/`hasSignedOutMarker`/`urlWithoutSignedOutMarker`/`shouldClearOnThisLoad`/`runSyncSerialized`/`flushBeforeSignOut` imported directly from the real profile-sync.tsx (hook: <scratchpad>/a-acs-hook.mjs, copied from the guide's acs-hook.mjs, unchanged; harness: <scratchpad>/a-acs-harness.mjs, copied from acs-harness.mjs, unchanged). Both scripts: ALL ASSERTIONS PASSED (i.e. every real behavior matched what it should be, including the two genuine gaps below, which are gaps by design/scope, not test failures).

  RESULTS — scenario table:
  | Scenario | Result on the NEW code |
  |---|---|
  | (a) A unsynced (topic+project+ledger), B signs in | FIXED — none of the three reach B's pushPayload or B's account row |
  | (b)-ii A fully synced, ledger-only, B signs in | FIXED — ledger no longer leaks (closes §1bq.6(a)) |
  | (c) A signs out, signs back into A | SAFE — A's own unsynced edit still reaches A's own account |
  | (d) never-signed-in guest's first sign-in | UNCHANGED, still works (both remote shapes) |
  | (e) screen shows A's data before any sign-in | FIXED for a DELIBERATE sign-out (marker present + owner recorded) — real logOut() empties the store |
  | §1bt.7-1 guest survives repeated signed-out loads | PASS (5x + a decoy query param) |
  | §1bt.7-2 involuntary loss keeps data, later same-account sign-in merges it | PASS |
  | §1bt.7-3 marker clears once, stripped from URL, other params/hash preserved | PASS |
  | §1bt.7-4 different account after involuntary loss starts clean | PASS |

  FINDING (CHECK 4, marker abuse) — CONFIRMED BY EXECUTION, ranked MEDIUM below: `shouldClearOnThisLoad` only checks "marker present + owner recorded" — it has no way to tell a real `/auth/signout` redirect apart from any other page load that merely carries `?signed-out=1` in its URL (a crafted link, a shared link, a stale bookmark/browser-history entry). For a FULLY SYNCED signed-in reader this self-heals on the same load (the still-valid session's normal reconcile pulls their real data straight back down) — proved by execution. For a signed-in reader with a genuine EDIT sitting locally but not yet pushed, the same forged link permanently discards that edit — proved by execution (see doc for exact assertions). Flagged POLICY — see findings.

  FINDING (CHECK 2, transition) — CONFIRMED BY EXECUTION, ranked HIGH below: a browser holding A's pre-deploy data (`syncedAccountId` absent, i.e. reads as `null`, "no owner yet") is NOT protected by the new owner-key gate on B's first post-deploy sign-in — `isAccountSwitch(null, B) === false`, so today's OLD merge runs unchanged. Tested 3 sub-cases: (i) lastSynced present, A fully synced at deploy time → the ledger STILL leaks into B (scenario (b)-ii's exact leak, unprotected). (ii) lastSynced present, A had a live unsynced edit at deploy time → the FULL scenario-(a) leak reproduces (topic/project reach B). (iii) lastSynced absent too (a device that predates even §1bk) → WORSE — the bootstrap rule treats every local field as dirty, so scalars AND lists reach B, not just the ledger. This is a real, if one-time (self-resolving once every device has done ONE post-deploy sign-in), gap against this item's own HIGH-privacy mandate. Investigated whether feed.ts's `syncedUserId` could safely infer the owner for this one case: `feed-sync.tsx` sets it unconditionally on every real sign-in (not gated on using any feed feature), so on MOST pre-deploy devices it would already hold A's id and COULD be borrowed as a one-time fallback for the profile store's owner-key comparison. But it is not a complete substitute: (1) a device where the reader already went through a clean feed-level sign-out has `syncedUserId === null` while the profile-store leak-in-waiting is still sitting there untouched (pre-fix, sign-out never cleared the profile store) — the fallback gives NO protection in exactly that case; (2) pre-fix the profile store was never gated at all, so in principle it could hold a blend from more than one prior account, which a single `syncedUserId` value cannot perfectly represent. Reported by execution; the decision (ship a fallback inference, accept the one-time gap as-is, or something else) is POLICY.

  FINDING (CHECK 3, double-click) — CONFIRMED BY EXECUTION, ranked LOW below: `account-section.tsx`'s Sign out button has no disabled/busy state, so a fast double click fires `handleSignOutSubmit` twice before the first `await requestProfileFlush()` resolves. For a LIST-carrying pending patch, both calls share `ProfileSync`'s own `runSyncSerialized` refs, so they correctly serialize (proved by execution: at most 2 total `getRemote()` calls, never two truly concurrent pull-merge-push sequences). For a SCALAR-only pending patch, `flushBeforeSignOut`'s `attemptPush` calls `pushRemote(patch)` directly with NO guard — proved by execution: two concurrent, real `PUT /api/profile` calls fire with the IDENTICAL (idempotent) payload. Not observed to cause data loss or a leak (both calls carry the same values), just a wasted duplicate network call. Ranked LOW.

- 20260930T124550Z — CHECK 3 remainder + CHECK 6 mutation proofs done.

  CHECK 3 (no-JS / confirmation copy): confirmed by reading the current account-section.tsx in full. The plain `<form method="POST" action="/auth/signout" ... onSubmit={onSignOutSubmit}>` (Sign out) is untouched structurally — with JS disabled, `onSubmit` never attaches, so the browser's native POST fires exactly as before this item. "Sign out anyway" is a SEPARATE, always-unhandled `<form method="POST" action="/auth/signout">` (no onSubmit at all) — a plain POST regardless of JS. Confirmation copy ("Some changes on this device haven't reached your account yet. Signing out removes them from this device.") verified TRUE by tracing both halves: the warning only shows after a genuine flush attempt already failed/timed out (first half true), and "Sign out anyway"'s plain POST → the route's new marker → the mount effect's real `logOut()` (proved by my own scenario-(e) execution above) actually empties local profile state (second half now true; was false before this item, matching the guide's/checkpoint's own finding).

  CHECK 6 — test-file diff audit: numstat confirms exactly which files have ANY removed line: route.ts 10+/1-, account-section.test.tsx 55+/0- (pure addition, nothing touched), account-section.tsx 25+/8-, profile-sync.test.tsx 592+/4- (all 4 removed lines belong to the ONE changed assertion, verified below), profile-sync.tsx 401+/2-, profile.test.ts 87+/5- (the ONE changed partialize-regex assertion), profile.ts 61+/4-. No `it(`/`test(` block is deleted anywhere (grepped the diff for removed `it(`/`describe(` lines — none found outside the two disclosed changed assertions). Both changed assertions independently judged: (1) profile.test.ts's partialize regex — widened from 2 keys to 3 (`profile`, `lastSynced`, `syncedAccountId`), still positionally anchored (a 4th key anywhere, including a smuggled-back `entitlement`, still breaks the match) — a strengthening, not a weakening, of "entitlement never persists". (2) profile-sync.test.tsx's call-shape regex — `pullMergeAndPush(listPullDeps(...))` → `runSyncSerialized(listPullDeps(...), ...)`; the property (list-carrying patch reaches the pull-before-push path, before the ordinary push path) is preserved, and serialization is separately tested by 4 new tests right below it. Both carry the required "ACCOUNT-SWITCH (§1bt...)" comment. Judged: NEITHER is a weakening.

  Mutation proofs — reproduced independently (not re-running C's own mutations, my own from-scratch edits), all 4 the brief named, all in web/src/components/profile-sync.tsx (the only file any of the 4 touch):
  - sha256 before (matches C's own final checkpoint value, confirming the file is untouched since C closed): `881e15de3f1dc4db2598c8746d3ad849d4005bbfb524ffc9147c09194ea28d1c`. Backup kept at `<scratchpad>/a-mut-profile-sync.orig.tsx`. `git ls-files --eol` confirmed CRLF on disk both before and after every restore; every restore used a byte-for-byte file copy (never retyped), so line endings could not drift.
  1. **Removed the owner-key comparison** (the whole `if (isAccountSwitch(...)) {...}` block plus the eager `setSyncedAccountId` call, reverted to pre-item behavior) → `vitest -t "owner-key gate"` → 3 of 3 wiring tests RED (`isAccountSwitch(...)` text no longer found; logOut/setSyncedAccountId indices both -1). Restored; sha256 after matches.
  2. **`shouldClearOnThisLoad` → `return true` unconditionally** (clear on any signed-out load, the superseded trigger) → `vitest -t "guest"` → RED (`expected true to be false`). Restored; sha256 after matches.
  3. **Dropped the flush** (`flushBeforeSignOut` body reduced to `return !deps.stillDirty();`, `cancelDebounce`/`attemptPush` never called) → `vitest -t "success case"` → RED (`expected [] to deeply equal ["cancel","attempt"]`). Restored; sha256 after matches.
  4. **Removed `runSyncSerialized`'s in-flight guard** (`if (flags.inFlight.current)` → `if (false)`) → `vitest -t "the invariant itself"` → RED (`expected 2 to be 1`, activeCount reached 2 — exactly the overlap the guard exists to prevent). Restored; sha256 after matches.
  Full profile-sync.test.tsx suite re-run after the 4th restore: 65/65 passed — confirms the restore chain left no residue.

- 20260930T124903Z — CHECK 7 (gates) and CHECK 8 (privacy scan) done.

  CHECK 7 — gates, run one at a time from web/, on the CURRENT (fully restored, mutation-free) tree:
  - `npx vitest run` → 295 files (292 + 3 skipped) / 5726 passed + 6 skipped / 0 failed. MATCHES the implementer's reported final count exactly.
  - `npx tsc --noEmit` → 0 errors. MATCHES.
  - `npx eslint .` → 0 errors / 151 warnings. MATCHES (spot-checked several warning lines; all pre-existing style-scale warnings unrelated to this item, none in a file this item touches beyond what already existed).
  - `npm run build` → compiled successfully, typechecked, generated all static/dynamic routes, OK. Same pre-existing, unrelated Turbopack NFT warning (next.config.ts importing src/lib/papers/pdf-text.ts) the implementer also reported. No retry needed (no font-fetch failure).
  Baseline comparison (HEAD, per the brief): 294 files / 5680 passed. New code adds 1 file (the new route.test.ts) and +46 tests net — consistent with the implementer's own part-by-part accounting (14+4+11+12+1+4=46, where the +4 for route.test.ts is counted once here and once in Part D's "12 incl. route.test.ts's 4" — arithmetic checks out at 5680+46=5726).

  CHECK 8 — privacy scan, every changed file + the new test file + the checkpoint doc, whole-file (not diff-only) for the name check, diff-added-lines re-checked separately:
  - Personal name check: one repeating two-word name-shaped fixture value found, 20 occurrences across two test files (profile-sync.test.tsx and profile.test.ts) plus 1 mention in the checkpoint's own prose disclosing it. Verified by direct comparison against `git show HEAD:<file>` and against the diff's added-lines-only text: ALL 20 in-code occurrences are PRE-EXISTING at HEAD (present before this item, in test fixtures this item did not write or touch) and ZERO appear in any added (`+`) line of this diff. This item did not introduce it. Not reproduced here (privacy rule). Flagged as a pre-existing, out-of-scope item worth the manager's attention separately (the project has swapped exactly this shape of value for a fictional one before, e.g. the PROFILE-SYNC item's "Dr. Morgan Example" fix) — POLICY, not a defect of this change.
  - Email-shaped strings: 6 total across scope, all on `@example.edu` (1) or `@example.test` (5) — both reserved/conventional-fictional domains. None in the diff's added lines are on a real-looking domain. Safe.
  - Windows user-profile paths (`C:\Users\...`, `/Users/...`, `/home/...`): 0 found anywhere in scope.
  - Secret-shaped strings (API-key patterns, Bearer tokens, PEM blocks, JWTs): 0 found anywhere in scope.
  Net: no NEW personal or secret-shaped string introduced by this diff.

  All 8 checks now complete. Writing the final verdict below.

---

## VERDICT: FAILED_REVIEW (2026-09-30T12:50:48Z)

One HIGH finding — a real, reproduced-by-execution gap against this item's
own unconditional privacy mandate ("one account's data must never reach
another account") — is not disclosed or accepted anywhere in §1bt or its
AMENDMENT. Everything else the implementation does, it does correctly and
well: scenarios (a)-(e), all four of §1bt.7's named behaviors, the
serialization fix, the flush design, and the test suite are all sound,
independently re-proven by execution against the real code, not just
re-read from the checkpoint's own claims. This is a narrow, well-defined
gap in an otherwise careful, thorough piece of work — not a broad quality
problem.

### Findings, ranked by severity

**1. HIGH, privacy — the owner-key fix does not cover the pre-deploy
transition; the ORIGINAL leak still reproduces for it. Not disclosed or
accepted in any binding ruling. POLICY — manager decides how to close it
before shipping (or to accept and disclose the cost, as §1bk.3 did for a
much lower-stakes transition).**

Every browser that ever signed in before this change ships has
`syncedAccountId` absent (reads as `null`, "no owner yet" — the only value
a pre-v7 blob can have; confirmed by reading `migrateProfileStore` and
`mergeHydratedProfileState` in store/profile.ts in full: neither writes
anything for a missing v7 key). `isAccountSwitch(null, anyUserId)` is
`false` by design (this is also §1bk's own correct bootstrap rule for a
genuinely NEW device) — so the owner-key gate does not engage, and
whichever account signs in FIRST on that browser after deploy runs
exactly TODAY'S (pre-fix) merge against whatever the PREVIOUS real user
left there. Proved by execution (`<scratchpad>/a-acs-main.mjs`, "CHECK 2"
section) in three sub-cases, all against the real `planReconcileForSignIn`:
- lastSynced present, prior device fully synced at deploy time → the
  preference-ledger leak (scenario (b)-ii's exact leak) still reaches the
  new account.
- lastSynced present, prior device had a live unsynced edit at deploy
  time → the FULL scenario-(a) leak (topic + project text) still reaches
  the new account.
- lastSynced absent too (a device that predates even §1bk) → WORSE: the
  bootstrap rule treats every local field as dirty, so scalars AND lists
  reach the new account, not just the ledger.

This is not a rare corner case: it is the state of EVERY currently-used
browser until its own next sign-in, and it reproduces on exactly the
shared/borrowed-computer scenario this whole item exists to protect
(the second, different person to sign in on that browser after the
deploy). Investigated whether `web/src/store/feed.ts`'s already-shipped
`syncedUserId` could safely infer the owner for this one-time case:
`feed-sync.tsx` sets it unconditionally on every real sign-in (confirmed
by reading the file — not gated on using any feed feature), so on MOST
affected browsers it would already hold the prior owner's id and could be
borrowed as a one-time fallback comparison. But it is not a complete fix:
a browser where the reader already went through an ordinary, correct
feed-level sign-out has `syncedUserId === null` while the profile-store
leak-in-waiting is still sitting there untouched (pre-fix, sign-out never
touched the profile store at all) — the fallback gives NO protection in
exactly that case. Whether to ship a fallback inference, run a one-time
server-side backfill, accept and disclose the cost, or something else is
POLICY — I did not implement anything; this is reported by execution only.

**2. MEDIUM, data-loss — the sign-out marker is not bound to an actual
sign-out; a forged, shared, or bookmarked link reproduces the same clear.
POLICY — manager decides whether this needs a fix.**

`shouldClearOnThisLoad` is `hasSignedOutMarker(search) && syncedAccountId
!== null` — pure string/state matching, with nothing tying the marker to
this device having actually just POSTed to `/auth/signout`. `ProfileSync`
mounts unconditionally at the app root (confirmed: `web/src/app/layout.tsx:149`,
`<ProfileSync />`, no surrounding condition) and its marker check reads
`window.location.search` with no pathname guard — so this fires on ANY
page of the site, not only `/`. Proved by execution
(`<scratchpad>/a-acs-main.mjs`, "CHECK 4" section): a signed-in reader who
merely loads a URL carrying `?signed-out=1` (sent by someone else,
bookmarked, or sitting in browser history) gets the same `logOut()` a
real sign-out would trigger — no click, no form submit, nothing the
reader would recognize as signing out. For a FULLY SYNCED reader this
self-heals on the same load (the still-valid session's ordinary reconcile
pulls their real data straight back down — also proved by execution). For
a reader with a genuine edit sitting locally but not yet pushed at that
instant, the edit is permanently discarded — proved by execution. This
never crosses accounts (not a privacy leak, matching the rest of this
item's own privacy/data-loss distinction), but it is a real, unwarned
data-loss path that requires nothing more than a link, which is a lower
bar than the "DELIBERATE sign-out" the AMENDMENT's own text specifically
intends to require.

**3. LOW, efficiency — a double-click on "Sign out" during the flush
(no busy indicator) causes a real, harmless duplicate network call for a
scalar-only pending edit. Not blocking; informational.**

Proved by execution (`<scratchpad>/a-acs-flush-serial.mjs`, "DOUBLE-CLICK"
sections). `handleSignOutSubmit` has no disabled/busy guard, so two fast
clicks run it twice, concurrently, before the first `await
requestProfileFlush()` resolves. When the pending patch carries a LIST
field, both calls share `ProfileSync`'s own `runSyncSerialized` refs and
correctly serialize (at most one extra run, never two truly concurrent
pull-merge-push sequences — proved). When the pending patch is
SCALAR-only, `flushBeforeSignOut`'s `attemptPush` calls `pushRemote(patch)`
directly with no guard at all — proved: two concurrent, real `PUT
/api/profile` calls fire with the identical (idempotent) payload. No data
loss or leak observed or expected (both calls carry the same values); just
a wasted duplicate request. Ships fine as-is; a manager may still want a
disabled-while-flushing state on the button for its own sake (not a
privacy or correctness requirement).

**4. INFORMATIONAL / POLICY — a pre-existing, out-of-scope personal-name-
shaped test fixture, unrelated to and untouched by this diff, surfaced by
the required privacy scan.**

Confirmed by comparing the whole-file scan against `git show HEAD:<file>`
and against the diff's added-lines-only text: the value appears 20 times
across two test files, ALL pre-existing at HEAD before this item, ZERO in
any line this diff adds. The checkpoint's own text (Part A / general
notes) discloses that a NEW occurrence of the same value, freshly typed
into one of this item's own new tests, was caught and replaced before the
checkpoint closed — independently confirmed: the diff's added lines
contain no such string anywhere (checked directly). Not reproduced here,
per the no-names privacy rule. This item did not introduce it and is not
the place to fix it; flagged only because the project has swapped exactly
this shape of value for a fictional one before (the PROFILE-SYNC item's
"Dr. Morgan Example" fix, per §1bk.9(b)) and might want to do the same
here in a follow-up. Does not affect this verdict.

### Scenario / behavior table (all re-proven by execution against the real, uncommitted code)

| # | Scenario | Result |
|---|---|---|
| (a) | A unsynced (topic+project+ledger), B (different) signs in | **FIXED** — none reach B's pushPayload or account row |
| (b)-i | A fully synced, scalars/lists, B signs in | Safe (as before) |
| (b)-ii | A fully synced, ledger-only, B signs in | **FIXED** — ledger no longer leaks |
| (c) | A signs out, signs back into A | Safe — A's own unsynced edit still reaches A's own account |
| (d) | Never-signed-in guest's first sign-in (both remote shapes) | Unchanged, still works |
| (e) | Screen shows A's data before any sign-in | **FIXED** for a deliberate sign-out — real `logOut()` empties the store |
| §1bt.7-1 | Guest survives repeated signed-out loads | PASS |
| §1bt.7-2 | Involuntary loss keeps data; later same-account sign-in merges it | PASS |
| §1bt.7-3 | Marker clears once, stripped from URL, other params/hash preserved | PASS |
| §1bt.7-4 | Different account after involuntary loss starts clean | PASS |
| Transition | Pre-deploy device, B is first to sign in after deploy | **NOT FIXED — HIGH finding 1** (all 3 sub-cases leak) |
| Marker abuse | Forged/shared/bookmarked `?signed-out=1` link | **MEDIUM finding 2** (self-heals if fully synced; loses an unsynced edit otherwise) |
| Double-click | Two concurrent Sign-out clicks, no busy indicator | **LOW finding 3** (harmless duplicate PUT for scalar-only edits; serialized correctly for list edits) |
| Sign-out flow | No-op / debounce-window flush / failed-flush confirmation / "Sign out anyway" / no-JS structure | All PASS (traced + proved by execution) |
| Confirmation copy | "...haven't reached your account yet...removes them from this device." | TRUE on the new code (both halves traced) |
| Serialization | No concurrent sequences / 1 coalesced follow-up / mid-flight edit kept / bounded | All PASS (4/4 proved by execution) |

### Mutation proofs (all 4 named in the brief, independently reproduced, all in web/src/components/profile-sync.tsx)

sha256 before = after for every one (`881e15de3f1dc4db2598c8746d3ad849d4005bbfb524ffc9147c09194ea28d1c`,
matches the implementer's own final value — the file was untouched since
their checkpoint closed); CRLF-on-disk confirmed unchanged throughout via
`git ls-files --eol`; every restore was a byte-for-byte file copy from a
backup taken before mutating, never a retype.
1. Removed the owner-key comparison from `onSession` → 3/3 wiring
   source-text tests RED. Restored, sha256 match.
2. `shouldClearOnThisLoad` forced to `return true` unconditionally → the
   guest-survives test RED (`expected true to be false`). Restored, sha256
   match.
3. Dropped the flush (`flushBeforeSignOut` reduced to `return
   !deps.stillDirty()`) → the success-case ordering test RED (`expected []
   to deeply equal ["cancel","attempt"]`). Restored, sha256 match.
4. Removed `runSyncSerialized`'s in-flight guard → the invariant test RED
   (`expected 2 to be 1`). Restored, sha256 match.
Full profile-sync.test.tsx suite re-run after the last restore: 65/65
passed — no residue from the mutation/restore cycle.

### Gates (run one at a time from web/, on the final, restored tree)

- `npx vitest run` → 295 files (292 + 3 skipped) / 5726 passed + 6 skipped
  / 0 failed. Matches the implementer's reported final count exactly.
  Baseline (HEAD) was 294 files / 5680 passed — this item adds 1 file and
  46 net new tests, arithmetic checks out.
- `npx tsc --noEmit` → 0 errors. Matches.
- `npx eslint .` → 0 errors / 151 warnings. Matches; warnings spot-checked
  as pre-existing and unrelated to this item.
- `npm run build` → OK (compiles, typechecks, generates every static/
  dynamic route). Same pre-existing, unrelated Turbopack NFT warning
  (next.config.ts → src/lib/papers/pdf-text.ts) the implementer also
  reported. No retry needed.

### Privacy / secret scan (every changed file + the new test file + the checkpoint; counts only)

- Personal-name-shaped strings: 1 distinct value, 20 occurrences, ALL
  pre-existing at HEAD, 0 in this diff's added lines (see finding 4).
- Email-shaped strings: 6, all on reserved/fictional domains
  (`example.edu` ×1, `example.test` ×5). None real-looking.
- Windows user-profile paths: 0.
- Secret-shaped strings (API keys, Bearer tokens, PEM blocks, JWTs): 0.

### Hard-constraint compliance (this review)

No network call made; no commit/push/stash/checkout/worktree/branch
operation; `.env`/`.env.local` never opened; no API key written anywhere;
no file created under web/ (all mutation testing was done by editing
`web/src/components/profile-sync.tsx` in place and restoring it
byte-exact from a scratchpad backup after each mutation, verified by
sha256); no file written at any root-level path; no person's name written
anywhere in this document; every script/scratch file lives under
`<scratchpad>/` with the `a-acs-`/`a-mut-` prefix, or under
`docs/jev-abc/` (this file only). No tool call or edit was denied during
this review.

---

## RE-CHECK (§1bt.8) — STATUS: VERIFIED (2026-09-30T13:34:57Z)

Coordinator reports: implementer finished round 2 per AMENDMENT §1bt.8,
ruling on all 4 round-1 findings — (a) pre-deploy transition ACCEPTED COST
(reason + threshold stated), (b) clear now bound to a server-set cookie,
(c) a busy guard added, (d) no action (the pre-existing name-shaped fixture
stays out of scope). Round 2 touched: web/src/app/auth/signout/route.ts +
its test, web/src/components/profile-sync.tsx + its test,
web/src/components/account/account-section.tsx + its test. Round-2
checkpoint appended to docs/jev-abc/ACCOUNT-SWITCH-C-20260930T115617Z.md.

Plan: (1) read §1bt.8 in full; (2) read the appended round-2 checkpoint
section; (3) isolate the round-2-only diff for each of the 6 files (backup
copies of my round-1 record exist for profile-sync.tsx/.test.tsx in
<scratchpad>/a-review-diff-profile-sync*.patch — for route.ts/
account-section.tsx/.test.tsx I hold the exact round-1 content/diff in
this session's own record and will reconstruct backups to diff against);
(4) re-run round-1 behaviour by execution on the new code; (5) verify the
cookie mechanism (CHECK b) and the busy guard (CHECK c) by execution; (6)
confirm (a) is recorded in the checkpoint's own words; (7) diff test files
against HEAD for deletions/weakening, judge the transformed marker tests,
reproduce >=2 round-2 mutations with sha256 + byte-exact restore; (8) run
the 4 gates; (9) privacy scan the round-2 diff + checkpoint; (10) verdict.

### §1bt.8 read in full (ABC-JEV-INTEGRATION.md line 268)

Rules on all 4 round-1 findings: (a) HIGH transition — ACCEPTED COST,
disclosed, reasoned (the manager's own check: the feed-store fallback I
investigated "almost never fires" in the realistic switch case, since a
switch normally follows a sign-out that already clears it; the existing
§1bk.3 recovery path itself depends on trusting a device's unowned local
data once, so a stricter rule would break that too); threshold for
revisiting = one real report. (b) MEDIUM forged marker — replace the URL
parameter with a short-lived first-party cookie (max-age 60s, path "/",
SameSite=Lax, not HttpOnly), bound to a CONFIRMED signed-out outcome, an
owner recorded, consumed once. (c) LOW double-click — a busy guard, one
flush, one POST. (d) INFO pre-existing name fixture — no action. Same C
fixes (b)+(c) and records (a); same A (me) re-checks.

### Round-2 checkpoint read in full (docs/jev-abc/ACCOUNT-SWITCH-C-20260930T115617Z.md, appended section)

Plan, Next-docs-read (cookies.md / backend-for-frontend.md, cross-checked
against this repo's own existing `response.cookies.set(...)` call in
web/src/lib/supabase/middleware.ts), the "Accepted costs" section (read in
full — plain words, present, reasoned, bounded, matches §1bt.8(a) — CHECK 4
of this re-check SATISFIED by direct reading), the implementation writeup,
tests, mutation proof (4 named), gates, changed-files list. One disclosed
self-correction: C found their OWN round-1 checkpoint had literally named
the pre-existing name-shaped fixture in its "privacy compliance" prose
(violating the no-names rule) and fixed it this round — independently
confirmed below (CHECK 7). One documentation oddity noted, not a functional
issue: the file's very last paragraph (lines 810-814) is a stale, verbatim
copy of round-1's OWN intermediate Part-A gate count (294 files/5694
passed), sitting after round 2's own correctly-stated final gates
(295/5742) earlier in the same section — harmless (I ran every gate myself
regardless, see below) but worth C tidying up.

### Diff isolation method

For web/src/components/profile-sync.tsx, an exact round-1 END-STATE backup
already existed from this review's own round-1 mutation testing
(<scratchpad>/a-mut-profile-sync.orig.tsx, sha256-verified identical to the
implementer's own round-1-final value) — `diff -u` against the current file
gives a byte-precise, tool-verified round-2-only delta (saved:
<scratchpad>/a-r2-diff-profile-sync-round1-to-round2.patch). For the other
5 files, no exact round-1 backup existed, so I used `git diff` against HEAD
(ecec7ad8) plus this review's own verbatim round-1 record (quoted in full,
above, in this same document) to identify the round-2-only delta by direct
comparison, cross-checked with `git show HEAD:<path>` and targeted greps
where precision mattered (e.g. confirming the OLD marker functions are
truly removed, not merely unwired). Note for anyone re-reading this later:
a diff against HEAD cannot show "-" for text round 1 added and round 2 then
removed, since neither endpoint of a two-point HEAD-vs-working-tree diff
ever contained BOTH states — a 0-deletion numstat for a file is therefore
NOT proof that round 1's own additions survived unchanged; I verified that
directly (by grep/describe-block enumeration) everywhere it mattered, not
by numstat alone.

### CHECK 1 (b) — the cookie mechanism, verified by execution

Read `web/src/app/auth/signout/route.ts` and the relevant slice of
`web/src/components/profile-sync.tsx` in full (both reproduced above). Then
executed the REAL `hasSignOutCookie`, `deleteSignOutCookie`,
`shouldClearOnConfirmedSignOut`, `processConfirmedSignOutCookie` (imported
directly from the real, uncommitted profile-sync.tsx) in
<scratchpad>/a-acs-r2-cookie.mjs. ALL PASSED:
- A URL carrying "?signed-out=1" and no cookie does nothing: confirmed —
  nothing in the new mechanism reads `window.location` at all any more
  (verified both by execution — `cookiePresent=false` → `logOut()` never
  called, cookie never touched — and by the implementer's own source-text
  test asserting `hasSignedOutMarker`/`shouldClearOnThisLoad`/
  `window.history.replaceState` are gone from the file entirely, which I
  independently re-derived via my own diff isolation above).
- A signed-in reader with the cookie present → no clear: confirmed for
  every owner value — `shouldClearOnConfirmedSignOut(true, "signed-in",
  owner)` is false regardless (the mechanism only runs from `onSession`'s
  `!signedIn` branch at all, so a signed-in load never even reaches it).
- A confirmed signed-out load + the cookie + a recorded owner → clear and
  the cookie is consumed: confirmed — `logOut()` called once, cookie
  deleted once. Re-ran round-1's scenario (e) (screen exposure) end to end
  through this new mechanism against the real store: still empties it.
- The cookie with no owner (a guest) → no clear, cookie consumed: confirmed
  — `logOut()` never called, `deleteCookie()` still called (so a guest's
  browser never carries a stale cookie into a later real sign-in).
- An unresolved or failed auth check with the cookie → no clear: confirmed
  for `authOutcome` "unknown" and "unconfigured" via the pure function, and
  via `processConfirmedSignOutCookie` directly for "unknown" (cookie still
  consumed, matching the guest case's own reasoning). Traced the ROOT cause
  in the real `onSession`: a rejected/still-pending `getUser()` never calls
  `onSession` at all (goes straight to `.catch(() => markSyncSettled())`),
  so `authOutcome` never becomes "signed-out" and this code path is not
  reached in that case — confirmed by reading, not assumed.
- Set-Cookie attributes: read directly from route.ts — name
  `peer_signed_out`, value `"1"`, `maxAge: 60`, `path: "/"`, `sameSite:
  "lax"`, `httpOnly: false`. Redirect target confirmed back to plain
  `${origin}/`, no query string (read directly; also proven by the real
  route.test.ts, which I read in full — 5 tests, one attribute checked per
  assertion line rather than one brittle exact-string match).
- Cookie-name consistency: grepped both files directly — route.ts's
  `SIGNED_OUT_COOKIE_NAME` and profile-sync.tsx's `SIGN_OUT_COOKIE_NAME`
  are both the literal `"peer_signed_out"`, exactly. Two independent
  literals by design (server route vs. "use client" browser code can't
  share a module) — each is independently pinned by its own file's tests,
  so a drift in either would break something, just not via one shared
  source of truth. Reasonable, disclosed, not a finding.

**Judgment on NOT setting `secure`:** reasonable and consistent with this
codebase's own existing practice. Read `web/src/lib/supabase/middleware.ts`
(the repo's other real `response.cookies.set(...)` call, for Supabase's own
session cookie, which carries FAR more sensitive data than this marker) —
it does not set `secure` either, and no HSTS/forced-HTTPS-redirect code
exists anywhere in `web/src` (grepped), meaning this app already relies on
its hosting platform for HTTPS, not hand-rolled enforcement. The one
scenario where `secure`'s absence has ANY marginal effect — an active
network attacker forcing an HTTP downgrade and injecting a forged
Set-Cookie — is a materially harder attack than the one this AMENDMENT
closes (sending a link), and even if pulled off, the worst case is
identical in kind to round 1's own already-accepted MEDIUM finding (a
false "clear" signal), never a privacy cross-account leak. Setting
`secure` would additionally break the cookie outright on local HTTP
development, which the implementer has no way to test live either way
(hard constraint). VERIFIED as a sound, disclosed, low-risk call — not a
finding.

### CHECK 2 (c) — the busy guard, verified by execution

Building a JSX-capable variant of the review's own hook
(<scratchpad>/a-acs-r2-hook.mjs — same "@/" alias resolution as
a-acs-hook.mjs, but running every .tsx file through this repo's own
installed `typescript` compiler's real JSX emit instead of mere
type-stripping, since account-section.tsx — unlike profile-sync.tsx —
contains real JSX; the plain type-stripping hook cannot parse it at all,
confirmed by trying first and getting `ERR_INVALID_TYPESCRIPT_SYNTAX`).
Then executed the REAL `handleSignOutSubmitCore`, imported directly from
the real, uncommitted account-section.tsx, in
<scratchpad>/a-acs-r2-busy.mjs. ALL PASSED:
- A double submit during the flush → one flush, one POST: confirmed with
  the exact concurrency shape a real double-click produces (two calls
  sharing one guard ref, the second starting before the first's awaited
  `requestFlush()` resolves) — `requestFlush` called exactly once, exactly
  one `onSubmitForm` (POST) call, guard resets after. Also checked 3
  simultaneous overlapping calls (not just 2): still exactly one flush, one
  POST.
- The guard does not permanently jam: two SEQUENTIAL (non-overlapping)
  calls each get their own independent flush (2 calls → 2 flushes); the
  guard resets to `false` in a `finally` block after BOTH a success outcome
  and a warn outcome, so a later click (e.g. after "Stay signed in") is
  never stuck.
- The visible half: read the current `AccountSectionView` JSX directly —
  the "Sign out" button now carries `disabled={busy}`; `AccountSection`
  wraps the whole `handleSignOutSubmitCore` call in `setBusy(true)` /
  `finally { setBusy(false); }`. The ref-based guard is checked
  SYNCHRONOUSLY, before any `await`, so it closes the double-click race at
  the JS-execution-order level (a browser processes one click's synchronous
  handler code to completion — including the guard-set — before the next
  click's handler begins), independent of React's own re-render timing for
  the visible `disabled` attribute — a stronger guarantee than the visual
  state alone would give.
- "Sign out anyway" still works: read the current file directly — that
  second `<form>`/button (used only once `confirmingSignOut` is already
  true) has no `onSubmit`, no `disabled`, untouched by this round's diff
  entirely (confirmed via the round-2-only delta) — a plain POST regardless
  of `busy`.

### CHECK 3 — round-1 behaviour still holds

Re-ran round-1's scenario (e) through the NEW cookie mechanism (above —
still empties the store). Did not need to re-run scenarios (a)-(d) or the
owner-key/runSyncSerialized checks by execution again: round-2's own diff
(isolated precisely for profile-sync.tsx via the exact backup, see above)
touches ONLY the marker→cookie mechanism and its wiring point inside
`onSession`'s `!signedIn` branch — `isAccountSwitch`, `planReconcileForSignIn`,
`runSyncSerialized`, and the entire `signedIn` branch of `onSession` (owner
key, serialization) are BYTE-IDENTICAL to round 1 in this diff (confirmed
directly in <scratchpad>/a-r2-diff-profile-sync-round1-to-round2.patch —
the only hunks touch the marker functions, the new cookie functions, and
the `!signedIn` branch). The flush (`flushBeforeSignOut`,
`requestProfileFlush`) is likewise untouched by round 2 in profile-sync.tsx
(confirmed by the same patch — no hunk near it) other than being CALLED
through the new, guarded `handleSignOutSubmitCore` wrapper in
account-section.tsx, which CHECK 2 above re-verified by direct execution.
Re-ran the FULL vitest suite (see gates below), which re-executes every
round-1 test (owner key, serialization, flush) unmodified and green.
Confirmation copy: read directly, byte-for-byte unchanged from round 1
(still truthful — its two preconditions, an actually-attempted flush and an
actual local clear on "Sign out anyway", are both still exactly what
happens).

### CHECK 4 — (a) recorded in plain words

Confirmed by direct reading: docs/jev-abc/ACCOUNT-SWITCH-C-20260930T115617Z.md,
"### Accepted costs (§1bt.8(a) — HIGH, documentation only, no code
change)" — four short paragraphs in plain language: what the gap is, why it
is accepted (tied explicitly to the §1bk.3 recovery path's own reliance on
trusting unowned local data once), exactly who is exposed (two-part,
narrowing condition, "not an ongoing hole"), and what would close it later
plus the stated threshold (one real report). Satisfies §1bt.8(a).

### CHECK 5 — tests: no pre-existing (HEAD) test deleted/weakened; round-1→round-2 transformations judged; mutations reproduced

Diffed every round-2 file against HEAD (ecec7ad8). route.ts: 27+/1-, the
one removal is the original single-line `return NextResponse.redirect(...)`
replaced by the cookie-setting version — product code, not a test.
account-section.test.tsx: 208+/0- — zero HEAD-relative deletions (the
round-1 wrapper-wiring block was fully replaced, but since round 1's own
additions were never part of HEAD, their removal is invisible to a
HEAD-relative diff by construction — verified directly that the OLD block
is really gone via a describe-block enumeration, not inferred from
numstat). profile-sync.test.tsx: 696+/5- — 4 of the 5 are round-1's own
already-reviewed single changed assertion (unchanged this round); the 5th
is the `import { describe, expect, it } from "vitest"` line widened to
include `vi`/`beforeEach` etc. for the new cookie tests — not a test
deletion. profile-sync.tsx / account-section.tsx: product code, reviewed
above.

Round-1→round-2 transformations, judged:
- profile-sync.test.tsx's marker describe blocks (`hasSignedOutMarker`/
  `urlWithoutSignedOutMarker`/`shouldClearOnThisLoad`, 12 `it` blocks per
  the checkpoint) → replaced by 4 new describe blocks (cookie parsing,
  `processConfirmedSignOutCookie`, the §1bt.8 scenario re-runs including
  the NEW forged-link regression test, the onSession wiring source-text
  check) — read in full (reproduced above). EQUIVALENT OR STRONGER: every
  §1bt.7 scenario this review required is still separately proven, PLUS a
  new dedicated forged-link test that did not exist before (the exact
  regression guard for round 1's own MEDIUM finding) — a strict superset of
  round 1's coverage for this concern, at the new (correct) mechanism.
- account-section.test.tsx's wrapper-wiring block (5 `it`s) → a new
  wrapper-wiring block (5 `it`s, 2 same property/kept, 2 repurposed to the
  wrapper's narrower new responsibility, 1 new for `busy`) PLUS a new
  `handleSignOutSubmitCore` behavioural block (6 `it`s, real function calls
  with fakes, not source-text regexes) PLUS a new busy-render block (2
  `it`s). STRONGER for the flush-then-decide sequencing specifically (now
  proven by real execution of the actual decision function, not merely by
  matching source text) — see the one gap this same transformation
  introduced, below.
- route.test.ts: 1 test unchanged (`signOut()` called once), 2 test bodies
  replaced (redirect-target text, origin test — same title/property,
  updated for the plain-root target), 1 repurposed (marker-vs-bare-root →
  the cookie-attributes test), 1 new (marker-text-must-never-appear
  regression guard). Read in full (reproduced above) — each new/changed
  assertion is truthful against the real route.ts I also read directly.
  EQUIVALENT OR STRONGER.

**One gap found by my own additional mutation, not one of the four the
brief named** — reported for completeness, ranked LOW below: I mutated the
wrapper's real `onWarn: () => setConfirmingSignOut(true)` (account-section.tsx)
to `onWarn: () => {}` (a no-op) and ran the FULL vitest suite. Result: all
295 files / 5742 tests still PASSED — nothing catches this. Round 1 had a
direct test for exactly this wiring (`setConfirmingSignOut(true)` called on
the warn branch); round 2's transformation moved the SEQUENCING proof
(flush-before-decide, submit-only-after) onto the real
`handleSignOutSubmitCore`, which is a genuine improvement, but the
WRAPPER's specific `onWarn` callback content is no longer checked by
anything (the analogous `onSubmitForm` callback IS still checked, by
`/onSubmitForm:\s*\(\)\s*=>\s*form\.submit\(\)/` — only `onWarn` was
dropped). I read the real code and it IS correctly wired
(`account-section.tsx:282`) — this is a test-coverage regression, not a
shipped functional bug. sha256 before/after
`c7c1a578492abdda793127cfde476e8692cada05662b57286b5af60e2ce34a8c` — MATCH,
restored byte-exact (LF unchanged).

**Mutation proofs (the two the brief named, plus two more for extra
confidence), all in the two files C's own checkpoint named, both backed up
first (<scratchpad>/a-r2-mut-profile-sync.orig.tsx,
<scratchpad>/a-r2-mut-account-section.orig.tsx; sha256 before matched the
checkpoint's own reported "before" values exactly — d67c8859.../
c7c1a578..., confirming the files were untouched since C's round-2
checkpoint closed; `git ls-files --eol` confirmed CRLF/LF unchanged
throughout, matching round 1):**
1. **Dropped the "session confirmed gone" condition**
   (`shouldClearOnConfirmedSignOut` reduced to `cookiePresent &&
   syncedAccountId !== null`) → `vitest -t "never clears for any
   non-confirmed authOutcome"` → RED (`expected true to be false`).
   Restored; sha256 after `d67c8859...` — MATCH.
2. **Read the URL parameter again** (`cookiePresent:
   window.location.search.includes("signed-out=1")` in place of
   `hasSignOutCookie(document.cookie)`) → `vitest -t "reads
   document.cookie"` → RED (the positive match fails; the file now DOES
   contain `window.location`, so the negative assertion would also fail if
   reached). Restored; sha256 after `d67c8859...` — MATCH.
3. **Dropped the busy guard** (removed `if (guard.current) return;` from
   `handleSignOutSubmitCore`) → `vitest -t "double submit during the
   flush"` → RED (`expected 2 to be 1`). Restored; sha256 after
   `c7c1a578...` — MATCH.
4. (Extra, the exploratory one above) onWarn wired to a no-op → nothing
   red across the full suite — see the finding above.
Every affected test file re-run in full immediately after each restore;
all four touched test files (145 tests total) re-run clean after the last
restore.

### CHECK 6 — gates (run one at a time from web/, on the final, restored tree)

- `npx vitest run` → 295 files (292 + 3 skipped) / 5742 passed + 6 skipped
  / 0 failed. Matches the implementer's reported round-2 final count
  exactly.
- `npx tsc --noEmit` → 0 errors. Matches.
- `npx eslint .` → 0 errors / 151 warnings (identical set — spot-checked;
  no new warning). Matches.
- `npm run build` → first attempt hit a network Google-Fonts fetch failure
  (Noto Sans SC) unrelated to this change; retried once per the standing
  instruction → OK on retry (compiles, typechecks, generates every
  static/dynamic route, including `ƒ /auth/signout`). Matches.

### CHECK 7 — privacy scan (round-2 files + the checkpoint; counts only)

Scanned the current content of all 6 round-2 files plus the full
checkpoint doc. Email-shaped strings: 6, unchanged from round 1, all on
`example.edu`/`example.test`. Windows user-profile paths: 0. Secret-shaped
strings: 0. The pre-existing name-shaped fixture: still 20 occurrences
total (unchanged — confined to profile-sync.test.tsx and the untouched-
this-round store/profile.test.ts, as in round 1), confirmed 0 within
round-2's own newly-added region of profile-sync.test.tsx specifically
(checked directly). The checkpoint's OWN prose: 0 occurrences now (round 1
had 1, in its "privacy compliance" section) — confirms C's disclosed
self-correction (see "Round-2 checkpoint read in full" above) actually
landed. No new personal or secret-shaped string introduced this round.

### Hard-constraint compliance (this re-check)

No network call made by me; `npm run build`'s own Google-Fonts fetch is
the project's standard build step, not a call I made, and succeeded on the
standing one-retry allowance. No commit/push/stash/checkout/worktree/
branch operation. `.env`/`.env.local` never opened. No API key written.
No file created under web/ (mutation testing edited
`web/src/components/profile-sync.tsx` and
`web/src/components/account/account-section.tsx` in place, each restored
byte-exact from a scratchpad backup, sha256-verified). No file written at
any root-level path. No person's name written anywhere in this document.
Confirmed the implementer's own disclosed temporary diagnostic file
(`web/src/__c_acs_probe_cookie.test.ts`) is genuinely gone (checked
directly — absent from disk and from `git status`). Every script/scratch
file lives under `<scratchpad>/` with the `a-acs-r2-`/`a-r2-mut-` prefix.
No tool call or edit was denied during this re-check.

---

## RE-CHECK VERDICT: VERIFIED (2026-09-30T13:34:57Z)

All three of round 2's changes hold up under independent execution against
the real, uncommitted code: the cookie-bound clear closes the forged-link
vector exactly as specified (6 required behaviours, all proven by
execution, not by reading), the busy guard closes the double-submit gap
(proven by real concurrent execution of the actual decision function,
including a 3-way race), and the pre-deploy transition is now disclosed in
plain, reasoned, bounded language in the implementer's own checkpoint.
Round-1 behaviour is intact (re-proven where round 2 touched shared code;
confirmed byte-identical where it didn't). Gates match exactly. No
pre-existing (HEAD) test was deleted or weakened, and every round-1→round-2
test transformation judged equivalent or stronger than what it replaced.

### Findings, ranked

**1. LOW — a test-coverage gap (not a shipped bug) introduced by round 2's
wrapper-wiring refactor.** `account-section.tsx`'s `handleSignOutSubmit`
wires `onWarn: () => setConfirmingSignOut(true)` correctly (read directly)
— but nothing in the current test suite would catch it if that wiring
broke (proven by execution: mutating it to a no-op leaves all 5742 tests
green). Round 1 had a direct test for exactly this; round 2's refactor
moved the sequencing proof onto `handleSignOutSubmitCore` (a real
improvement) but dropped the wrapper-specific check without a
replacement — asymmetric with `onSubmitForm`, which IS still checked.
Suggested fix, not performed (out of scope for a reviewer): one more
source-text assertion, `expect(body).toMatch(/onWarn:\s*\(\)\s*=>\s*
setConfirmingSignOut\(true\)/)`, in the existing wrapper-wiring describe
block. Does not block shipping.

**2. INFO, unchanged from round 1 — the pre-deploy transition is now an
explicit, disclosed, reasoned ACCEPTED COST (§1bt.8(a)), not an open
finding.** No further action from this reviewer; recorded here only for
continuity with round 1's report.

**3. INFO — a documentation-only oddity in the checkpoint file** (its very
last paragraph is a stale, verbatim copy of round-1's intermediate Part-A
gate count, sitting after round 2's own correct final gate count earlier
in the same section). Harmless — I ran every gate myself regardless — but
C may want to delete that trailing paragraph for clarity.

### CHECK (b)/(c) results, summarized

(b) cookie: all 6 required behaviours verified true by execution (forged
link → nothing; signed-in + cookie → nothing; confirmed sign-out + cookie
+ owner → clears and consumes; guest + cookie → no clear, still consumes;
unresolved/failed auth check + cookie → nothing; attributes match exactly:
`peer_signed_out=1`, Max-Age=60, Path=/, SameSite=Lax, not HttpOnly, no
`secure` — judged reasonable and consistent with this codebase's own
existing cookie-setting convention). (c) busy guard: double submit → one
flush, one POST (verified with 2 AND 3 overlapping calls); the control is
visibly disabled while busy (`disabled={busy}`, read directly); "Sign out
anyway" is structurally untouched and unaffected by `busy`.

### Mutation proof

4 total (2 required + 2 extra): "drop the session-confirmed-gone
condition" → RED; "read the URL parameter again" → RED; "drop the busy
guard" → RED; "wire onWarn to a no-op" → NOT caught by anything (finding
1). All sha256-verified byte-exact restores, matching the implementer's
own reported "before" hashes.

### Gates

vitest 295 files (292+3 skipped) / 5742 passed + 6 skipped / 0 failed;
tsc 0 errors; eslint 0 errors / 151 warnings; build OK (one retry for an
unrelated network font fetch). All match the implementer's round-2 report
exactly.
