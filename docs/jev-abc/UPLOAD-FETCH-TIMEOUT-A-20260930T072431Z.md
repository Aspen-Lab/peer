STATUS: VERIFIED

# UPLOAD-FETCH-TIMEOUT — independent review (A)

Branch: Jev-integration-and-sorting-filtering-enhancement
HEAD at start: 35c2d2ed
Role: A — independent reviewer. Read-only on product code except temporary, restored mutations. No commit/push/stash/branch op; no HTTP calls to any server; no reading of uploaded files or saved-paper records; no touching web/.env*; no touching root node_modules/ or the dev server.

Read first: ABC-JEV-INTEGRATION.md §1bi (points 1-8, esp. 8b); docs/jev-abc/UPLOAD-404-A-20260929T203148Z.md (LOW note: no timeout on the record fetch); docs/jev-abc/UPLOAD-FETCH-TIMEOUT-C-20260930T071405Z.md (implementer's checkpoint); `git diff HEAD -- web/`.

This file is written incrementally; updated after each check below.

## Progress checklist
- [x] Read ABC-JEV-INTEGRATION.md §1bi, UPLOAD-404-A LOW note, C's checkpoint, and the diff
- [x] Check 1 — execution: hung fetch becomes transient after timeout; no stray timer fire after unmount/success; Try again gets a fresh 15s; 404 still permanent; non-upload id creates no controller/timer
- [x] Check 2 — apiFetch passes signal through to fetch; an abort surfaces as a caught error, not an unhandled rejection
- [x] Check 3 — mutations (restore each, sha256 before/after, CRLF preserved)
- [x] Check 4 — gates on the clean tree (baseline, before any mutation) — vitest, tsc, eslint, build
- [x] Check 5 — privacy
- [x] Probe files deleted, proven by git status
- [x] Final verdict

## Check 5 — privacy scan

Scanned the two product files in this diff (`page.tsx`, `page.test.tsx`), both temporary probe files, and both this item's docs (C's checkpoint, this report) — 6 files total.
- Pattern scan (case-insensitive; described in words per the hard constraint: the account holder's email shape, the account holder's full name as it appears in this session's Windows profile path, a `C:\Users\...` path shape, and the university's name/abbreviation/domain): **zero hits** across all 6 files.
- Hex-run scan (`[0-9a-fA-F]{16,}`, to catch a real upload hash16): the only matches are (a) the same obviously-synthetic all-`a`/zero fixture id already used and cleared by both C and the earlier UPLOAD-404-A review (`aaaa000000000000`), reused here for consistency, and (b) 64-character SHA256 file-content hashes from this item's own mutation-proof records (page.tsx/page.test.tsx hashes, matching C's reported values exactly) — hashes of file bytes, not upload ids, not personal data. No real upload id anywhere.
- Per the hard constraint, no uploaded file or saved-paper record was opened or printed at any point in this review to produce or check these patterns.

**CLEAN — no personal data found.**

## Final gates (re-run on the clean, fully-restored, probe-free tree)

- `npx vitest run`: **291 passed | 3 skipped (294 files) / 5575 passed | 6 skipped (5581 tests) / 0 failed.**
- `npx tsc --noEmit`: **0 errors.**
- `npx eslint .`: **0 errors / 151 warnings.**
- `npm run build`: **exit 0**, no network-font-fetch failure, no retry needed. Same single pre-existing Turbopack NFT-tracing warning (`pdf-text.ts`, unrelated to this diff).

All four match the baseline recorded at the top of this report and C's reported numbers exactly, both before any mutation and again after full restoration.

## Probe-file cleanup proof

Two temporary probes this round, both prefixed `__a_timeout_probe_`, both under `web/src/app/papers/[id]/`: `__a_timeout_probe_extracted_effect.ts` (the generated wrapper holding the verbatim-sliced effect body) and `__a_timeout_probe_execution.test.ts` (the executing tests). Both deleted. `find src -iname "*__a_timeout_probe_*"` from `web/` immediately after: no output — none remain.

`git status --porcelain` immediately after, in full:
```
 M ABC-JEV-INTEGRATION.md
 M web/src/app/papers/[id]/page.test.tsx
 M web/src/app/papers/[id]/page.tsx
?? docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md
?? docs/jev-abc/UPLOAD-FETCH-TIMEOUT-A-20260930T072431Z.md
?? docs/jev-abc/UPLOAD-FETCH-TIMEOUT-C-20260930T071405Z.md
?? node_modules/
```
Exactly the session-start snapshot plus this report — `ABC-JEV-INTEGRATION.md` was already modified before I started (not touched by me); `page.tsx`/`page.test.tsx` are C's item, hash-verified byte-identical to their pre-mutation state; `NON-ASCII-TEXT-B-...md` is a concurrent read-only investigator's file, not mine; `UPLOAD-FETCH-TIMEOUT-C-...md` is C's own checkpoint, pre-existing at session start; `node_modules/` pre-existing untracked. Nothing committed, pushed, stashed, or branched. No HTTP call was made to any host (`peer.homes`, `localhost`, or otherwise). No uploaded file or saved-paper record was opened. `web/.env`/`web/.env.local` were never opened or printed. No API key was written anywhere. The root `node_modules/` folder and the dev server were never touched.

## Findings

**None at HIGH or MEDIUM.** Every point in the CHECKS list was confirmed by execution (never merely inferred from reading), including the one mutation (`abort only on success, never on unmount`) that C itself never tested — confirmed both by an existing source-text test going red and, independently, by my own execution-based probe catching the actual behavioural regression (the in-flight request no longer being cancelled on unmount).

1. **LOW — context only, not a defect of this round.** This repo's test environment is Node-only with no DOM/render harness (confirmed independently: `vitest.shared.ts` sets `environment: "node"`, no jsdom/happy-dom/@testing-library in `node_modules`, plain Node has no global `window`). So neither C's tests nor a live-mounted component can observe a REAL browser timer firing inside an actually-rendered page; both C's source-text tests and my own execution probe (which runs the real, verbatim-extracted effect body under a hand-built harness, not a live component render) are the strongest verification available without adding new tooling — a limitation already disclosed by the prior UPLOAD-404-A review and unchanged by this item (this item exists specifically to CLOSE that same review's substantive complaint — the missing timeout itself — not the test-harness gap, which was never in this item's scope).

## Verdict: VERIFIED

The shipped change does exactly what §1bi.8b's follow-up (the UPLOAD-404-A LOW note) asked for: a 15-second timeout scoped only to the upload-id record fetch, wired through a real `AbortController`, correctly classified as transient (never the permanent 404 outcome) via the unmodified `uploadFetchErrorKind`, with the timer safely disarmed on any normal settle and the in-flight request genuinely cancelled (not just UI-suppressed) on unmount, and a fresh full 15s on every retry. Every one of the 5 CHECKS-list items was verified by direct execution against the real, unmodified source (via a verbatim-extracted-and-executed effect body, the real `apiFetch`, and the real `uploadFetchErrorKind` — not reimplementations), not by reading alone: the hung-fetch-becomes-transient path, the no-stray-abort/no-state-after-unmount guarantees, the fresh-15s-on-retry guarantee, the 404-stays-permanent guarantee, the non-upload-id-untouched guarantee, the signal-passthrough in `apiFetch`, and the caught-not-unhandled-rejection guarantee. All three required mutations (including the one C never itself exercised) were independently reproduced with byte-identical PowerShell SHA256 restoration and preserved CRLF line endings, and each one is caught by at least one red test. All four gates match baseline exactly, both before and after mutation testing. Privacy scan clean. No HIGH or MEDIUM findings; one LOW contextual note, not a defect of this round.

STATUS: VERIFIED

Report path: `docs/jev-abc/UPLOAD-FETCH-TIMEOUT-A-20260930T072431Z.md`

## Method note — how Check 1/2 were executed (no DOM test harness exists in this repo)

Confirmed independently (matching UPLOAD-404-A's own finding): `vitest.shared.ts` sets `environment: "node"`; plain Node has no global `window` (`node -e "console.log(typeof window)"` → `undefined`); no jsdom/happy-dom/@testing-library anywhere in `node_modules`/`package.json`. So the real `useEffect` callback in `page.tsx` (which references `window.setTimeout`/`window.clearTimeout` directly) can never actually run inside a real component render in this repo's tests — this is why C's own tests, and UPLOAD-404-A's, are source-text (`.toContain`) checks only.

To get real EXECUTION rather than only string matching, I mechanically sliced the fetch effect's body **verbatim, byte-for-byte** out of the current `page.tsx` (between the two source markers `if (!shouldFetchById) return;` and `}, [id, fetchKey, shouldFetchById, isUploadId]);` — confirmed unique in the file, one hit each, via `grep -c`), using a small generator script (`scratchpad/gen-extracted-effect.mjs`, not part of the product), and wrapped that unmodified slice in an exported function in a temporary probe module. A second temporary probe test file then calls that function with a controlled harness — a mock `apiFetch`/`fetch`, vitest fake timers, a minimal injected `window` object whose methods look up `globalThis.setTimeout`/`clearTimeout` at call time (so they correctly target vitest's fake timers once installed) — and separately imports and calls the REAL, unmodified `uploadFetchErrorKind` (from `page.tsx`) and the REAL, unmodified `apiFetch`/`ApiError` (from `lib/api.ts`). Only the lowest-level global `fetch` and the test's own hand-built `apiFetch` stand-ins are mocked (required — a real HTTP call is forbidden by this review's hard constraints). This proves the actual shipped logic's runtime behaviour, not a hand-retyped mirror of it.

Probe files (temporary, prefix `__a_timeout_probe_`, both under `web/src/app/papers/[id]/`, deleted at the end of this review with git-status proof):
- `__a_timeout_probe_extracted_effect.ts` — generated wrapper holding the verbatim slice.
- `__a_timeout_probe_execution.test.ts` — the executing tests.

## Check 1 + Check 2 — results (`npx vitest run "src/app/papers/[id]/__a_timeout_probe_execution.test.ts"`)

**9/9 passed, first run, no retries, no adjustment needed.**

1. **Hung fetch → transient after 15s** (real `AbortController` + real `uploadFetchErrorKind`, mocked `apiFetch` that only settles on abort): before 15s, `setFetchResult` uncalled and the signal unaborted; after `vi.advanceTimersByTimeAsync(15000)`, the signal is aborted and `setFetchResult` is called exactly once with `{ paper: null, done: true, errorKind: "transient" }`. CONFIRMED by execution.
2. **No stray timer/abort after a successful response:** a resolving `apiFetch` → one `setFetchResult` call (`errorKind: "none"`); advancing fake time 20 000 ms further produces no second call (the `.finally` clearTimeout genuinely disarms the timer — proven, not assumed); calling the effect's own returned cleanup afterward (simulating a later unmount) still calls `controller.abort()` unconditionally by design, and this is confirmed harmless — no second `setFetchResult` call results. CONFIRMED.
3. **No state update after unmount, mid-flight:** cleanup invoked 3 s into a hanging fetch aborts the real signal (proven: `capturedSignal.aborted === true`) but `setFetchResult` is never called (the pre-existing `cancelled` guard, extended by this diff to also cover the abort, suppresses it) — and advancing time a further 20 000 ms afterward still produces nothing (timer was cleared too). CONFIRMED — this is the specific "stray abort of a finished request" / "state update after unmount" risk named in my CHECKS list, and it does not occur.
4. **Try again gets a fresh 15s, not a continuation of the first run's elapsed time:** run 1 advanced 10 s then torn down (no call yet); run 2 (a fresh call into the same extracted function, exactly what React does when `retryUploadFetch` re-arms the effect) does not fire at 14 999 ms but does at the 15 000th — proving each run owns its own full, independent timer. CONFIRMED.
5. **404 stays the permanent outcome, and its timer is cleared too:** a real `ApiError` with `status === 404` rejecting immediately → one `setFetchResult` call with `errorKind: "not-found"`; advancing 20 000 ms further produces no stray second call. CONFIRMED.
6. **Non-upload id: no controller, no timer, unsignalled fetch:** with `isUploadId: false`, an `AbortController` stand-in that throws if constructed is never invoked; a `setTimeout` spy is never invoked; the mocked `apiFetch` receives `undefined` as its second argument (asserted inside the mock itself) — matching page.tsx's own `controller ? {...} : undefined`. CONFIRMED — the non-upload branch is untouched, by execution, not just by reading.
7. **`apiFetch` (real, `lib/api.ts`) passes the exact `AbortSignal` object through to `fetch()`:** identity-equal (`init.signal === controller.signal`), not a copy or a rebuilt object. CONFIRMED.
8. **An abort surfaces as a caught rejection, never an unhandled one, and is never wrapped as `ApiError`:** with a mocked `fetch` that rejects with a `DOMException("...", "AbortError")` on abort, `apiFetch(...)`'s own returned promise rejects with that exact same `DOMException` (an `instanceof DOMException`, `name === "AbortError"`, and explicitly `not.toBeInstanceOf(ApiError)` — confirming by execution what reading `lib/api.ts` already suggested: `ApiError` is thrown only for a `!res.ok` HTTP response, never for a `fetch()`-level rejection, so `uploadFetchErrorKind`'s `error instanceof ApiError && error.status === 404` check correctly falls through to `"transient"` for an abort). A `process.on("unhandledRejection", ...)` listener recorded zero firings across the whole scenario. CONFIRMED — directly answers CHECKS item 2.
9. **End-to-end, only global `fetch` mocked:** the real extracted effect body + the real unmocked `apiFetch` + the real unmocked `uploadFetchErrorKind`, run together — a hung global `fetch` still ends `errorKind: "transient"` after exactly 15 s. This chains checks 1 and 2 through the one seam that cannot be executed for real here (an actual HTTP request, forbidden by this review's own hard constraints). CONFIRMED.

No test in this probe needed a second attempt or a code change to pass — the shipped logic behaved exactly as the ruling and C's plan describe on every one of these 9 executed scenarios.

## Check 3 — mutations (all independently reproduced by A on `page.tsx` only; `page.test.tsx` never touched)

Baseline hash, PowerShell (`[System.IO.File]::ReadAllBytes` + SHA256), before any mutation: `page.tsx` = `6C0CABC263901134CB726F1F438D766F6DD29409BD7444598FC312AE661A1DA4` (55470 bytes, 1260 CRLF pairs, 0 lone LF/CR — matches C's own reported BEFORE hash exactly, confirming the file was untouched since C's checkpoint). `page.test.tsx` = `E870F2F536A3BF368E84FFCC29E1F67661AD6B7B77C546A6FB4A3CA46C2FD8DB` (24838 bytes) — checked once at the end, matches C's reported hash exactly (never edited during my mutation testing, since all three required mutations touch only `page.tsx`).

1. **Classify a timeout as permanent** — added `if (error instanceof DOMException && error.name === "AbortError") return "not-found";` as the first line of `uploadFetchErrorKind`. `npx vitest run "src/app/papers/[id]/page.test.tsx"` → **1 failed / 36 passed** — exactly the "is 'transient' for an aborted/timed-out fetch" test, red as expected (`expected 'not-found' to be 'transient'`). Restored; after-hash `6C0CABC2...661A1DA4` — **identical to baseline.**
2. **Remove the timeout** — reverted the whole effect body to the pre-change shape (no `controller`, no `timer`, no `signal`, no `.finally`, cleanup back to bare `cancelled = true`). `npx vitest run "src/app/papers/[id]/page.test.tsx"` → **4 failed / 33 passed** — exactly the 4 timeout-wiring source-text tests, red as expected. Restored; after-hash identical to baseline.
3. **Abort the controller only on success, never on unmount** (the mutation C did not itself test — required by my own CHECKS list) — moved `controller?.abort();` out of the cleanup's `return () => {...}` and into the `.then()` success handler instead. Two independent proofs, both executed:
   - `npx vitest run "src/app/papers/[id]/page.test.tsx"` → **1 failed / 36 passed**: the existing source-text test "the cleanup aborts the controller and clears the timer, alongside the existing no-state-after-unmount guard" goes red (`expected '...' to contain 'controller?.abort()'`), because that string no longer appears inside the sliced cleanup region.
   - Independently, regenerated my own extracted-effect probe from this mutated `page.tsx` and re-ran the Check-1/2 execution probe: `npx vitest run "src/app/papers/[id]/__a_timeout_probe_execution.test.ts"` → **1 failed / 8 passed** — my "unmounting before a hung fetch settles..." test fails on `expect(capturedSignal?.aborted).toBe(true)` (received `false`): with the abort moved to `.then()`, an unmount that happens WHILE the request is still hanging (the exact scenario this mutation targets) no longer aborts the in-flight request at all — a genuine behavioural regression (the request keeps running after unmount instead of being cancelled), not just a string-match failure. This is stronger evidence than the source-text test alone, since it proves the actual runtime consequence rather than only the absence of a substring.
   - **Verdict: a test goes red (in fact two, by two different methods) — not a finding.** Restored; after-hash identical to baseline.

Final state, hash-verified: `page.tsx` = `6C0CABC263901134CB726F1F438D766F6DD29409BD7444598FC312AE661A1DA4`, 1260 CRLF pairs, 0 lone LF/CR — byte-identical to the pre-mutation baseline; CRLF convention fully preserved across all three mutate/restore cycles. `page.test.tsx` untouched throughout (single hash check, matches C exactly). Regenerated the extracted-effect probe from the final restored file and re-ran both `page.test.tsx` and my own probe together: **46/46 passed** (37 + 9), confirming a clean, fully-restored tree before moving to the gates.

## Log

- 20260930T072431Z — report created, STATUS IN_PROGRESS. Read §1bi (points 1-8), the UPLOAD-404-A review (LOW note origin), C's checkpoint. Read the full `git diff HEAD -- web/` (page.tsx + page.test.tsx only, matches C's claimed scope exactly — no other file touched). Read the surrounding source in full: `lib/api.ts` (apiFetch/ApiError), and page.tsx lines 100-560 (the timeout constant, the fetch effect, `uploadFetchErrorKind`, `isUploadFetchFailure`, `resolveUploadPageState`, `retryUploadFetch`, and how `uploadTransient`/`uploadUnavailable` are consumed downstream).
- Gates run on the current (clean, unmutated) tree, one at a time, from `web/`, matching the order requested:
  - `npx vitest run`: **291 passed | 3 skipped (294 files) / 5575 passed | 6 skipped (5581 tests) / 0 failed.** Exact match to the implementer's reported numbers (baseline 5570 + 5 new = 5575).
  - `npx tsc --noEmit`: **0 errors** (no output, exit 0).
  - `npx eslint .`: **0 errors / 151 warnings**, exit 0 — exact match to baseline.
  - `npm run build`: **exit 0.** No network-font-fetch failure, no retry needed. Route table includes `/api/papers/upload-availability`, `/api/papers/upload/[id]`, `/api/papers/upload/[id]/file`, `/papers/[id]` as separate routes, matching prior reports. One Turbopack NFT-tracing warning, import trace `next.config.ts` → `src/lib/papers/pdf-text.ts` — same pre-existing warning both UPLOAD-404-A and C already flagged as unrelated (neither `pdf-text.ts` nor `upload/route.ts` is in this diff).
  All four gates match C's reported numbers exactly on the clean tree, confirmed independently before any mutation.
