STATUS: IMPLEMENTED_PENDING_REVIEW

# UPLOAD-FETCH-TIMEOUT — implementer (C)

Branch: Jev-integration-and-sorting-filtering-enhancement
HEAD at start: 35c2d2ed
Role: C — implementer. Sole writer of repo product files until report. Small item, no investigator round.

Read first: ABC-JEV-INTEGRATION.md §1bi (points 1-8, esp. 8b); docs/jev-abc/UPLOAD-404-A-20260929T203148Z.md (the review that surfaced this gap as a LOW note, re-check section, "no timeout mechanism on the underlying fetch call"); web/src/app/papers/[id]/page.tsx; its page.test.tsx; web/src/lib/api.ts (apiFetch/ApiError); web/AGENTS.md.

## The gap

`page.tsx`'s fetch effect (the one that fetches an uploaded paper's record, and also a non-upload external-id paper's record) has no timeout. `uploadFetchErrorKind` already classifies ANY non-`ApiError`/non-404 error as `"transient"` by construction (confirmed by reading — no change needed there), but nothing ever aborts a hung request, so a server that never answers leaves the reader on `LoadingMat` forever instead of reaching `UploadRetryEmpty` / the transient branch of `UploadFallbackReading` with Try again.

## Plan

1. Add a module-level constant `UPLOAD_FETCH_TIMEOUT_MS = 15000` near the file's other page-level constants (`DECIDED_VISIBLE`/`DECIDED_MS`).
2. In the fetch effect (page.tsx, current lines ~448-465): only for `isUploadId` (never for the external-id/non-upload branch — scope is "that one record fetch", ruling text and task item 3 both say non-upload papers must not change), create `const controller = isUploadId ? new AbortController() : undefined;` and `const timer = controller ? window.setTimeout(() => controller.abort(), UPLOAD_FETCH_TIMEOUT_MS) : undefined;`, mirroring this repo's own established AbortController-based-timeout idiom (`lib/decisions/jev-client.ts:79-80`, `broker-client.ts`). Pass `controller ? { signal: controller.signal } : undefined` as `apiFetch`'s second argument. Clear the timer in both `.finally()` and the cleanup. Cleanup also calls `controller?.abort()`, alongside the existing `cancelled = true` guard that already stops a state update after unmount/id-change — unchanged behavior for that guard, just extended to also cancel the in-flight request for the upload branch.
3. No change to `uploadFetchErrorKind`'s logic (it already treats an abort as transient); add a test pinning that guarantee explicitly so a future change can't special-case it silently.
4. Tests in page.test.tsx: (a) `uploadFetchErrorKind` classifies a DOMException-shaped AbortError as `"transient"`; (b) source-text checks (this repo's own technique for effectful code, already used throughout this file's test) proving the effect body wires `AbortController` + `UPLOAD_FETCH_TIMEOUT_MS` + `.abort()` scoped to `isUploadId`, and that the cleanup calls `controller?.abort()` alongside the existing `cancelled = true`; (c) the constant's value.
5. Mutation-test both required mutations (classify timeout as permanent; remove the timeout), one at a time, sha256 before/after, restore, prove a test goes red each time.
6. Gates from web/: vitest, tsc, eslint, build. Compare to baseline (294 files / 5570 passed + 6 skipped / 0 failed; tsc 0; eslint 0/151; build OK).

## Log

- 20260930T071405Z — checkpoint created, STATUS IN_PROGRESS. Read ABC-JEV-INTEGRATION.md §1bi in full, the UPLOAD-404-A review (the LOW note that is this item's origin), page.tsx in full, page.test.tsx in full, lib/api.ts (apiFetch/ApiError shape), web/AGENTS.md. Surveyed the codebase's own AbortController/timeout idioms: every client-effect hook in components/reader/ (use-reading.ts, use-model-report.ts, use-private-supplement.ts) and lib/papers/use-uploads-available.ts already does `new AbortController()` + `return () => controller.abort()` on unmount, but NONE of them has a timeout — confirms this gap is real and repo-wide for React effects specifically (server-side one-shot fetches like lib/papers/fetch-by-id.ts already use `AbortSignal.timeout(8000)`, and the non-React `lib/decisions/jev-client.ts`/`broker-client.ts` already do `setTimeout(() => controller.abort(), timeoutMs)` + `clearTimeout` in a `finally` — mirroring that shape for page.tsx's effect). Confirmed tsconfig lib includes "dom" (AbortController available) and Node v24.19.0 (native AbortController/DOMException). Starting implementation next.

## Implementation

`web/src/app/papers/[id]/page.tsx`:
1. New module-level constant, next to `DECIDED_VISIBLE`/`DECIDED_MS`: `const UPLOAD_FETCH_TIMEOUT_MS = 15000;` with a doc comment explaining why (§1bi.8b, `uploadFetchErrorKind` already treats an abort as transient by construction) and that it is scoped to the upload id only.
2. The fetch effect: `const controller = isUploadId ? new AbortController() : undefined;` then `const timer = controller ? window.setTimeout(() => controller.abort(), UPLOAD_FETCH_TIMEOUT_MS) : undefined;`. `apiFetch`'s second argument becomes `controller ? { signal: controller.signal } : undefined` (mirrors `lib/decisions/jev-client.ts`'s `attemptFetch`, adapted for a React effect). `.finally(() => { if (timer !== undefined) window.clearTimeout(timer); })` added after the existing `.then`/`.catch` so a normal finish (success or a real error) never leaves the timer armed. Cleanup now also clears the timer and calls `controller?.abort()`, alongside the pre-existing `cancelled = true` guard (unchanged — it already stopped a state update after unmount/id-change for both branches; the new lines add an actual abort of the in-flight request, a no-op for the non-upload branch since `controller` is `undefined` there).
3. `uploadFetchErrorKind` itself: **no change.** It already returns `"transient"` for anything that is not `ApiError` with `status === 404`, which already covers an abort/timeout error by construction. Locked in with a new test instead (see below) so a future change cannot special-case it silently.
4. Non-upload (`isExternalId`) branch: no controller, no signal, no timeout — byte-for-byte the same fetch call shape as before this change.
5. Retry: `retryUploadFetch` (unchanged) resets `fetchResult` to `{ done: false, errorKind: "none" }`, which re-arms `shouldFetchById` and re-runs this same effect from scratch — a fresh `controller`/`timer` is created each run, so "Try again" after a timeout automatically gets a fresh request and a fresh timeout with no separate code path needed. Verified by reading; matches the mechanism the UPLOAD-404-A review already verified for retry in general (state-transition proof through `resolveUploadPageState`, dependency-array tracing).

`web/src/app/papers/[id]/page.test.tsx` — 5 new tests, 0 removed/weakened:
- `uploadFetchErrorKind (§1bi.8b)` describe block, one new case: an aborted/timed-out fetch (`new DOMException("The operation was aborted.", "AbortError")`) → `"transient"`.
- New describe block `page.tsx source — the upload record fetch has a timeout (UPLOAD-FETCH-TIMEOUT)`, 4 tests, using this file's own established technique (no live-DOM/effect harness exists in this repo — confirmed by the UPLOAD-404-A review reading `vitest.shared.ts`'s `environment: "node"` — so effectful code is proven by reading the actual source text, the same pattern this file already uses for the retry-wiring checks): the constant is declared and used in the effect; the effect creates the controller/timer/signal scoped to `isUploadId`; the timer is cleared in `.finally`; the cleanup calls `controller?.abort()` and `window.clearTimeout(timer)` alongside the pre-existing `cancelled = true`.

## Mutation proof

Both required mutations, one at a time, from the clean implemented tree, hashed with PowerShell (`[System.IO.File]::ReadAllBytes` + SHA256, never Bash) before and after, `page.tsx` only (`page.test.tsx` never mutated, hash checked once at the end to confirm):

- `page.tsx` BEFORE = `6C0CABC263901134CB726F1F438D766F6DD29409BD7444598FC312AE661A1DA4`
- `page.test.tsx` BEFORE = `E870F2F536A3BF368E84FFCC29E1F67661AD6B7B77C546A6FB4A3CA46C2FD8DB`

1. **Classify a timeout as permanent** — added `if (error instanceof DOMException && error.name === "AbortError") return "not-found";` as the first line of `uploadFetchErrorKind`. `npx vitest run "src/app/papers/[id]/page.test.tsx"` → **1 failed / 36 passed** — exactly the new "is 'transient' for an aborted/timed-out fetch" test, red as expected (`AssertionError: expected 'not-found' to be 'transient'`). Restored; after-hash `6C0CABC263901134CB726F1F438D766F6DD29409BD7444598FC312AE661A1DA4` — **identical to BEFORE.**
2. **Remove the timeout** — reverted the whole effect body to the pre-change shape (no `controller`, no `timer`, no `signal`, no `.finally`, cleanup back to bare `cancelled = true`). `npx vitest run "src/app/papers/[id]/page.test.tsx"` → **4 failed / 33 passed** — exactly the 4 new timeout-wiring source-text tests, red as expected; the 33 pre-existing tests (including the new abort-classification test, which does not depend on the effect's wiring) still passed. Restored; after-hash `6C0CABC263901134CB726F1F438D766F6DD29409BD7444598FC312AE661A1DA4` — **identical to BEFORE.**

`page.test.tsx` after both mutations: `E870F2F536A3BF368E84FFCC29E1F67661AD6B7B77C546A6FB4A3CA46C2FD8DB` — **identical to BEFORE** (never touched during mutation testing).

Line endings: `git ls-files --eol` on both files, before and after all edits: `i/lf w/crlf` — unchanged (CRLF preserved; the Edit tool's string-replacement approach does not alter the file's existing line-ending convention).

Full `npx vitest run "src/app/papers/[id]/page.test.tsx"` on the final restored tree: **37 passed** (32 pre-existing + 5 new: 1 abort-classification + 4 timeout-wiring).

## Gates (from web/, clean restored tree)

- `npx vitest run`: **291 passed | 3 skipped (294 files) / 5575 passed | 6 skipped (5581 tests) / 0 failed.** Baseline was 5570 passed + 6 skipped / 0 failed — exactly +5, matching the 5 new tests. File count unchanged (294).
- `npx tsc --noEmit`: **0 errors** (no output). Matches baseline.
- `npx eslint .`: **0 errors / 151 warnings.** Matches baseline exactly (same warning set — spot-checked the tail of the output, all pre-existing Latent-scale/unused-var warnings in unrelated files).
- `npm run build`: **exit 0.** Route table unchanged in shape (`/api/papers/upload-availability`, `/api/papers/upload/[id]`, `/api/papers/upload/[id]/file`, `/papers/[id]` all present as before); the one Turbopack NFT-tracing warning (pdf-text.ts / upload/route.ts) is pre-existing and unrelated to this diff (neither file touched here) — same warning the UPLOAD-404-A review already flagged as pre-existing.

## Scope check (task item 3: "nothing else changes")

- 404 path: `uploadFetchErrorKind` untouched; a 404 `ApiError` still classifies `"not-found"`. Not exercised differently by the timeout change (no controller/signal involved in that branch's classification logic).
- File-missing path (`fileAvailable: false`, §1bi.8a): `resolveUploadPageState`'s `fileMissing` branch untouched — no code in this diff touches it.
- Non-upload papers (`isExternalId`, e.g. `openalex:`/`arxiv:` ids): the fetch call for that branch is byte-for-byte identical to before — no controller created (`isUploadId ? new AbortController() : undefined` is `undefined` there), no `signal` passed to `apiFetch` (`controller ? {...} : undefined` is `undefined`), no timer armed. The existing "is never unavailable for a non-upload id" test (pre-existing, untouched) still passes as part of the full suite run above.

## Privacy / constraints check

No uploaded file or saved-paper record opened or printed. No HTTP call made to any host (all verification was `vitest`/`tsc`/`eslint`/`npm run build`, no dev server started, no `peer.homes`/`localhost` request). `web/.env`/`web/.env.local` never opened. No API key written anywhere. Root `node_modules/` never touched (pre-existing untracked entry from session start, left as-is). No commit/push/stash/branch operation performed. One stray command (`npm run build > /tmp_build_check.log 2>&1` followed by an `rm`) was correctly BLOCKED by the sandbox's own destructive-command guard before anything was written or deleted outside the allowed locations; re-ran the build with `> /dev/null 2>&1` instead (a device, not a file) to get a clean exit-code read — no root-level temp file was ever created (confirmed: `ls /tmp_build_check.log` → no such file). No other command wrote outside `web/`'s tracked files, `docs/jev-abc/`, or the session scratchpad.

## Final git status (before this report)

```
 M ABC-JEV-INTEGRATION.md                                    <- pre-existing at session start, not touched by C
 M web/src/app/papers/[id]/page.test.tsx                      <- this item
 M web/src/app/papers/[id]/page.tsx                           <- this item
?? docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md          <- a concurrent read-only investigator's file, not C's
?? docs/jev-abc/UPLOAD-FETCH-TIMEOUT-C-20260930T071405Z.md    <- this checkpoint
?? node_modules/                                              <- pre-existing untracked at session start
```

## STATUS: IMPLEMENTED_PENDING_REVIEW

Changed files: `web/src/app/papers/[id]/page.tsx` (timeout constant + effect wiring), `web/src/app/papers/[id]/page.test.tsx` (5 new tests). Checkpoint: this file.
