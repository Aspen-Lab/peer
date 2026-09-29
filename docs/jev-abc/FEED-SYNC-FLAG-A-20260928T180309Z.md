# FEED-SYNC-FLAG — A review (independent reviewer)

Status: FAILED_REVIEW (complete; see Verdict section below)
Started: 2026-09-28T18:03:09Z
Reviewer: A (fresh instance, did not write this code)
Branch: Jev-integration-and-sorting-filtering-enhancement (HEAD 61aed451)

## 0. Snapshot

`git status --short` at start:
```
 M ABC-JEV-INTEGRATION.md
 M web/src/components/feed-sync.tsx
 M web/src/store/feed.test.ts
 M web/src/store/feed.ts
?? docs/jev-abc/FEED-SYNC-FLAG-C-20260928T173817Z.md
?? docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md
?? docs/jev-abc/SENSE-CONTEXT-C-20260928T180135Z.md
?? node_modules/
?? web/src/lib/feed/sync-status.ts
```

SHA256 of change-list files (step-0 snapshot):
```
e81dcff23abc37ae7d5560e0b5238821d2df37be6119a71e0b5a0955e4851b76  web/src/components/feed-sync.tsx
a755d8d2a2f9e34c4a95e7debf79fc9f5d3279bc09408c1f4b14ef05d9716121  web/src/store/feed.test.ts
c9c6cc6017fe7b7e17423b64e2c55615676e2c3d65c2cbbb52d4e15545cff131  web/src/store/feed.ts
9a30ce7522fe9035e871428df193f4428f342c4ca3804cd526b97371cee2f9c2  web/src/lib/feed/sync-status.ts
```
These match C's own recorded hashes exactly — file state unchanged since C's checkpoint.

## The manager's specific concern (S1/S2) — verified BY EXECUTION

Read in full: `web/src/lib/feed/sync-status.ts` (new, 36 lines), the diff of `web/src/components/feed-sync.tsx` (flag declarations moved out, re-exported, migration-batch call sites at L177-178 unchanged), the diff of `web/src/store/feed.ts` (new `updateFeedPushFailedFlag(ok)` helper + wiring into `cloudSave`/`cloudUnsave`/`cloudMarkRead`/`cloudMarkUnread`/`cloudFeedback`'s try/catch), and the 13 new tests in `web/src/store/feed.test.ts`. Confirmed the implementation is exactly what the manager described: ONE shared boolean (`useFeedSyncStatus.pushFailed`), and `updateFeedPushFailedFlag(true)` (called from every helper's try/success branch) clears it unconditionally — not scoped to which item/kind failed. Grepped `store/feed.ts` for every `apiFetch(` call (5 matches: L139 cloudSave, L152 cloudUnsave, L164 cloudMarkRead, L177 cloudMarkUnread, L194 cloudFeedback) — confirms all 5 steady-state cloud writes are covered and none missed. Grepped the whole file for retry/requeue machinery on these 5 helpers (`setInterval`, `retry`, `pushQueue` etc.) — none exists; each of the 15 call sites (`savePaper`, `saveEvent`, `saveJob`, `unsavePaper`×3, `submitFeedback`, `markRead`, `markUnread`, `setJobApplied`, `setEventRegistered`, `setEventSubmitted`×2, `commitDismiss`) calls its cloud* helper exactly once, fire-and-forget. **A failed push is never resent automatically.** Also confirmed `resetLocal()` (L2543+, runs on sign-out) wipes `savedPapers`/`savedEvents`/`savedJobs`/`readItems`/`readAt`/`library`/`paperFeedback`/`eventFeedback`/`jobFeedback` unconditionally — so if Sign out proceeds without a warning, an unsynced write is not just stale, it is permanently gone (no server copy, no local copy).

Built a TEMPORARY scenario file `web/src/store/feed-sync-flag.scenarios.tmp.test.ts` (created via Write, never an edit to product code) implementing S1 and S2 literally against the real, unmodified store (signed in via `useSyncGate`, real `savePaper`/`markRead`, deferred-promise fetch mock for exact ordering control):

- **S1**: `savePaper(X)` with `/api/saved` (cloudSave) failing (500) and `/api/feedback` (cloudFeedback) left hanging (isolates cloudSave's own effect) → flag becomes `true`. Then `markRead(Y)` (a different item, different helper, `/api/read` succeeds) → flag re-checked.
- **S2**: `savePaper(X)` alone — its own concurrent `cloudSave` (fails) and `cloudFeedback` (succeeds, resolved after cloudSave) racing within the SAME call.

Ran it with `npx vitest run src/store/feed-sync-flag.scenarios.tmp.test.ts` from `web/`. Both assertions (coded as "what SHOULD hold if X's still-unsynced save stays visible to P6": `pushFailed === true`) **FAILED — actual value was `false` in both cases**:
```
[S1 RESULT] pushFailed after X-save-fail then Y-read-success = false
[S2 RESULT] pushFailed after cloudSave-fail then concurrent cloudFeedback-success = false
 FAIL  S1: X's failed save is not erased from the flag by Y's later, unrelated successful read
 FAIL  S2: savePaper's own concurrent cloudSave-fail + cloudFeedback-success does not end with the flag false
```
**CONFIRMED BY EXECUTION, not reasoning: both S1 and S2 reproduce exactly the manager's predicted bug.** X's save genuinely fails (server never receives it, confirmed via the mocked 500), the flag nonetheless reads `false` afterward, and — per the `resetLocal()` reading above — if the user signs out at that point the P6 warning stays silent and X's save is permanently destroyed with no way to recover it. This is precisely the data-loss scenario P6 exists to prevent, still open after this change.

Deleted the temporary file immediately after recording results (`rm web/src/store/feed-sync-flag.scenarios.tmp.test.ts`); `git status --short` re-checked, confirms it is gone (grep for "scenarios.tmp" over git status: no match).

**HIGH FINDING** (ranked #1 — see Verdict): the purpose stated in this review's brief — "so Sign out warns before wiping this device's copy" — does not hold. The flag is cleared by ANY helper's success system-wide, not scoped to the item/kind that actually failed, so it systematically under-reports data loss the moment any other feed write succeeds afterward (which in ordinary use is likely to happen quickly — e.g. every `savePaper` triggers its own second, concurrent, independently-outcomed `cloudFeedback` call, so S2 alone can misfire on nearly every single save a user makes).

## Check 2 (partial) — mutation testing BLOCKED by the harness permission system

Attempted the first of C's 4 prescribed mutations (delete `updateFeedPushFailedFlag(false)` from `cloudSave`'s catch block in `web/src/store/feed.ts`, the smallest, most standard of the 4). The Edit call was **denied by the Claude Code auto-mode classifier**: "Reason: [Modify Shared Resources]" — `web/src/store/feed.ts` is live-served by the shared dev server the user (signed in, on the home page) is actively using, and the harness will not let me edit an existing tracked source file under that condition, even for a brief, SHA256-restored mutation window that my task brief explicitly anticipated ("keep mutation windows short").

Per my hard constraints (never route a denied action through another tool, file, or encoding), I did not attempt this via Bash/PowerShell text substitution, did not try the same class of edit against `feed-sync.tsx` or `sync-status.ts` as a workaround, and did not retry the same call. This sub-step (C's 4 prescribed mutations: delete-catch-call / delete-try-call / delete-signed-in-guard / invert-polarity) is **BLOCKED, not skipped-by-judgment** — treating it the same way the brief's own "Windows file lock → STOP that step and report" clause instructs for an environment-level stoppage.

This does not weaken the verdict: the manager's brief frames S1/S2 execution as the check that matters most ("verify BY EXECUTION, do not reason it away") and that check is complete, independent, and conclusive — it exercised the real, unmodified code and did not need any product-file mutation. The 4 prescribed mutations would have tested whether C's OWN test suite is internally self-consistent (i.e., whether deleting one line turns exactly one test red) — a narrower, lower-stakes question than whether the feature works, which S1/S2 already answered: no. Read-only baseline (no mutation needed) already run: `npx vitest run src/store/feed.test.ts src/components/feed-sync.test.tsx` from `web/` → **2 files passed, 95 tests passed** (matches C's per-file claim).

## Check 1 — Code review (DONE)

- **Shared module is the single source of truth.** `web/src/lib/feed/sync-status.ts` is the only place `useFeedSyncStatus`/`markFeedPushFailed`/`clearFeedPushFailed` are defined (36 lines, read in full). Grepped the whole `web/src` tree for `useFeedSyncStatus` — every other reference is either an import of this one store or a re-export of it. One flag, one store.
- **feed-sync.tsx's migration-batch behaviour is unchanged.** The diff removes only the inline `create<...>`/`markFeedPushFailed`/`clearFeedPushFailed` declarations and replaces them with an import + re-export; the batch's own call sites (`if (anyFailed) markFeedPushFailed(); else clearFeedPushFailed();`, L177-178) are untouched — same condition, same calls, just now imported instead of locally defined.
- **The re-export keeps both existing external consumers working.** `account-section.tsx` L37 and `app/profile/page.tsx` L33 both still `import { useFeedSyncStatus } from "@/components/feed-sync"` — unchanged import paths, and `feed-sync.tsx` L33 (`export { useFeedSyncStatus };`) re-exports the exact same store object from the new module, so both keep working with no edits needed to either file. `feed-sync.test.tsx` also still imports it from `"./feed-sync"` — unaffected.
- **The signed-in guard uses the right signal.** `updateFeedPushFailedFlag` gates on `useSyncGate.getState().authUserId`, the same signal `resolveOwnerKeyForLoad` elsewhere in this file already trusts as "is this device currently acting as a real signed-in account." Confirmed by reading: every route these 5 helpers call (`/api/saved`, `/api/read`, `/api/feedback`) requires a session and 401s without one, so gating is necessary (else a signed-out visitor's expected 401s would spuriously flag the P6 warning) — and sufficient, since `authUserId` is set only after a real session resolves.
- **No circular import.** `sync-status.ts` imports only `zustand`'s `create` — nothing from `feed.ts` or `feed-sync.tsx`. Both of those import FROM it, never the reverse. Confirmed by reading the new file in full; no cycle.
- **All 5 helpers covered; no missed sibling write.** `grep -n "apiFetch(" web/src/store/feed.ts` → exactly 5 matches (L139 `cloudSave`, L152 `cloudUnsave`, L164 `cloudMarkRead`, L177 `cloudMarkUnread`, L194 `cloudFeedback`), and all 5 are the ones wired to `updateFeedPushFailedFlag` in both their try and catch branches (confirmed by reading each function in full). These are the only network-writing calls in the file — no other steady-state cloud write on the same fire-and-forget pattern exists to miss.

No gaps found in check 1 — the mechanism is wired correctly everywhere the brief asked me to check. The defect is not in any of these six sub-items; it is in the design itself (see S1/S2 above): one shared boolean, cleared by ANY of the 5 helpers' success, with no per-item/per-kind tracking and no retry. Wiring it correctly into all 5 helpers made the flag MORE often wrong in practice (more helpers now race each other to clear it), not less.

## Check 2 — Tests + mutations (PARTIAL — see blocker recorded above)

Baseline run (no mutation needed): `npx vitest run src/store/feed.test.ts src/components/feed-sync.test.tsx` from `web/` → **2 files passed, 95 tests passed.** C's 13 new tests are each individually well-isolated per helper (confirmed by reading all 13: each mocks exactly one path to resolve and hangs the sibling path, exactly as C's own notes describe) and would very likely each catch its own named single-line deletion or polarity flip, matching C's own self-reported mutation table. I was not able to independently confirm this with my own mutation edits — **the harness's auto-mode classifier denied editing `web/src/store/feed.ts`** (reason given: "Modify Shared Resources" — the file is live-served by the shared dev server the signed-in user is actively using) when I attempted the first of C's 4 prescribed mutations. Per my hard constraints, I did not attempt this through Bash/PowerShell text substitution, a different file, or a retry — see the full note above ("Check 2 (partial) — mutation testing BLOCKED"). This is a gap in confirming the test suite's own internal self-consistency, not a gap in confirming whether the feature works — S1/S2 already answered that directly against the real, unmodified code with no product-file edits needed.

## Check 3 — Gates (PARTIAL — 2 of 4 independently confirmed; 2 blocked by the same permission restriction)

From `web/`:
- `npx vitest run`: **280 files (277 passed + 3 skipped); 5034 passed + 6 skipped; 0 failed.** Matches the brief's expected numbers exactly. CONFIRMED by me.
- `npx tsc --noEmit`: **0 errors** (empty output, clean exit). CONFIRMED by me.
- `npx eslint .`: **NOT independently confirmed** — the harness denied this command with the identical "Modify Shared Resources" classifier reason, even though this is a plain read-only lint check with no `--fix` flag. I did not retry or route around it. C's self-reported number (0 errors, 151 warnings, matching the pre-existing baseline) stands **unverified by me**.
- `npm run build`: **NOT independently confirmed** — same classifier denial. I did not retry. This is consistent with the brief's own separate warning about Windows file locks on this exact step (a real risk here too: a production build can collide with a live dev server's `.next` directory on the same checkout) — I'm treating the denial with the same STOP-and-report discipline that clause asks for. C's self-reported "OK" stands **unverified by me**.

This PARTIAL gate result is an artifact of my permission environment this session, not a finding about the code. I recommend the manager re-run `npx eslint .` and `npm run build` itself (or via a session with broader permissions) before treating POLISH-1/FEED-SYNC-FLAG-style full gate confirmation as complete — separately from this item's verdict, which does not depend on either of these two gates.

## Check 4 — Scope (DONE)

Final `git status --short`:
```
 M ABC-JEV-INTEGRATION.md
 M web/src/components/feed-sync.tsx
 M web/src/store/feed.test.ts
 M web/src/store/feed.ts
?? docs/jev-abc/FEED-SYNC-FLAG-A-20260928T180309Z.md
?? docs/jev-abc/FEED-SYNC-FLAG-C-20260928T173817Z.md
?? docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md
?? docs/jev-abc/SENSE-CONTEXT-C-20260928T180135Z.md
?? node_modules/
?? web/src/lib/feed/sync-status.ts
```
Re-hashed all 4 change-list files — **all match the step-0 snapshot exactly** (no drift; my mutation attempt was denied before any bytes changed, and my temporary scenario file/scratch work left no residue):
```
e81dcff23abc37ae7d5560e0b5238821d2df37be6119a71e0b5a0955e4851b76  web/src/components/feed-sync.tsx
a755d8d2a2f9e34c4a95e7debf79fc9f5d3279bc09408c1f4b14ef05d9716121  web/src/store/feed.test.ts
c9c6cc6017fe7b7e17423b64e2c55615676e2c3d65c2cbbb52d4e15545cff131  web/src/store/feed.ts
9a30ce7522fe9035e871428df193f4428f342c4ca3804cd526b97371cee2f9c2  web/src/lib/feed/sync-status.ts
```
`ABC-JEV-INTEGRATION.md` — the manager's, pre-existing, untouched by me. `docs/jev-abc/FEED-SYNC-FLAG-C-*.md` — C's own checkpoint, read-only input. `docs/jev-abc/SENSE-CONTEXT-B-*.md`/`SENSE-CONTEXT-C-*.md` — the parallel lane, explicitly out of scope per the brief, untouched. `node_modules/` — pre-existing untracked. `docs/jev-abc/FEED-SYNC-FLAG-A-*.md` — this checkpoint. Everything else is exactly the allowed change-list. My temporary scenario test file is confirmed gone (checked twice: immediately after deletion, and again in this final snapshot). Scope is clean.

## Verdict

**VERDICT: FAILED_REVIEW**

### Ranked findings

**HIGH — the P6 sign-out warning misses exactly the data loss it exists to prevent, confirmed by direct execution (S1 and S2 both reproduce).**
The purpose this item was reviewed against: "When a signed-in reader has ANY feed write... that failed to reach their account and is still unsynced, the flag... must be true." This does not hold. `useFeedSyncStatus.pushFailed` is ONE shared boolean; `updateFeedPushFailedFlag(true)` (called from every one of the 5 cloud* helpers' success branch) clears it unconditionally, with no tracking of which item or kind of write actually failed. Executed against the real, unmodified code (temporary test file, deleted after use, no product-code edits):
- **S1**: item X's `cloudSave` genuinely fails (mocked 500, confirmed via the thrown `ApiError`) → flag correctly becomes `true` → a completely unrelated item Y's `markRead` succeeds → flag becomes `false`. X's save is still unsynced; the flag says otherwise.
- **S2**: within a SINGLE `savePaper(X)` call, X's own `cloudSave` fails while X's own concurrent `cloudFeedback` (fired by the same call, via `submitFeedback`) succeeds afterward → flag ends `false`. Even the same item's own save is invisible to the flag once its sibling write succeeds.
- No retry exists anywhere for these 5 helpers (confirmed by reading + grep) — a failed push is not "eventually consistent," it is silently and permanently lost the moment anything else about this device's feed data next succeeds.
- `resetLocal()` (sign-out) unconditionally wipes `savedPapers`/`savedEvents`/`savedJobs`/`readItems`/`readAt`/`library`/`paperFeedback`/`eventFeedback`/`jobFeedback` — so a Sign out that proceeds without warning (because the flag was wrongly cleared) destroys X's only copy, local and remote both.
- Practical severity: S2's shape (`savePaper` firing both `cloudSave` and `cloudFeedback` concurrently) is not a rare edge case — it happens on every single save. Any ordinary save-then-something-else session is likely to trip this.

This is a HIGH finding, not MEDIUM: unlike POLISH-1-SYNC-A's original finding (a flag that under-covers because a whole class of writes was never wired in — a coverage gap), this is the flag now being wired into the exact paths that matter and still landing on the wrong answer in ordinary use — a correctness gap in the mechanism itself, in the specific scenario P6 exists for.

**Direction for B/C (not code, per my role):** the smallest honest fix is to stop tracking "did the last write succeed" and start tracking "is there an unsynced write outstanding right now," scoped per write, e.g. a `Set`/`Map` keyed by `` `${itemKind}:${itemId}:${writeKind}` `` (or similarly, per outstanding write) that a helper adds its own key to on failure and removes ONLY that same key on ITS OWN later success (not any other helper's); `pushFailed` becomes "is the set non-empty," derived, not itself the primary state. That alone would fix S1 (Y's success only removes Y's key) and S2 (cloudSave's failure and cloudFeedback's success are different keys, so cloudFeedback's success cannot remove cloudSave's failure record). Equivalent designs (e.g. a monotonic per-item "last known good" attempt counter compared against the one that was submitted) would also work; a full-re-sync-clears-everything escape hatch is fine as an additional, explicit "we just confirmed everything" path, but the per-write success path must stay scoped to what it actually confirmed.

**MEDIUM (process, not product) — check 2's mutation-testing sub-step and half of check 3's gates could not be independently completed this session.**
The harness denied editing `web/src/store/feed.ts` ("Modify Shared Resources" — the file is live-served by the dev server the signed-in user is actively using) and separately denied `npx eslint .` and `npm run build` with the same reason, even though eslint is a plain read-only check. I did not attempt to route around any of these three denials through another tool, file, or retry, per my hard constraints. `npx vitest run` (full suite) and `npx tsc --noEmit` WERE independently confirmed and match C's reported numbers exactly. C's self-reported eslint (0 errors/151 warnings) and build (OK) numbers are plausible (nothing else in this review suggests otherwise — the change is small and self-contained, and the full vitest/tsc runs found nothing this touch would plausibly break) but stand unverified by me. Recommend the manager re-run those two commands directly, or in a session with broader permissions, before closing this item either way.

### S1/S2 results (repeated from above for the summary)
S1: **REPRODUCED** — flag reads `false` after X's real failure + Y's unrelated success. S2: **REPRODUCED** — flag reads `false` after X's own concurrent success/failure pair resolves. Both via a temporary, deleted-after-use test file against the unmodified store; no product code was edited to get this result.

### Mutation results + restore hashes
Not completed — see Check 2 above. No mutation was actually applied (the Edit call was denied before any write), so no restore was needed; the unchanged hashes in Check 4 confirm this.

### Gates
vitest: 280 files (277+3 skipped) / 5034 passed + 6 skipped / 0 failed — CONFIRMED. tsc: 0 errors — CONFIRMED. eslint: 0 errors/151 warnings — UNVERIFIED (blocked). build: OK — UNVERIFIED (blocked).

## Final `git status --short`

```
 M ABC-JEV-INTEGRATION.md
 M web/src/components/feed-sync.tsx
 M web/src/store/feed.test.ts
 M web/src/store/feed.ts
?? docs/jev-abc/FEED-SYNC-FLAG-A-20260928T180309Z.md
?? docs/jev-abc/FEED-SYNC-FLAG-C-20260928T173817Z.md
?? docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md
?? docs/jev-abc/SENSE-CONTEXT-C-20260928T180135Z.md
?? node_modules/
?? web/src/lib/feed/sync-status.ts
```

STATUS: FAILED_REVIEW (verdict recorded; A review complete)
