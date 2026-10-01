# EMAIL-TOKEN-REPLAY — C implementation

STATUS: IMPLEMENTED_PENDING_REVIEW (round 2 complete — fix round after A's FAILED_REVIEW; see "Round 2"
section below for full detail; round 1's own report is preserved further down this file)

Item: ABC-JEV-INTEGRATION.md §1bn (binding). Guide: docs/jev-abc/EMAIL-TOKEN-REPLAY-B-20260930T055356Z.md
(COMPLETE, 17/17 execution checks). Root cause: `GET /api/profile/confirm-email` writes the token's
address right after the uid check, never reading the live `digest_email` first, so an old but
not-yet-expired confirmation link can silently revert the reader's digest address after they moved on to
a different one (self-inflicted replay; needs the old email + a signed-in session as that same account).

Role: C — implementer. Read before starting: ABC-JEV-INTEGRATION.md §1bn (this ruling) and §1as
(EMAIL-TOKEN-PRIVACY — v2 AES-256-GCM token design, no dual-format fallback, strict shape checks); the B
guide (whole); web/AGENTS.md; web/src/lib/email/confirm-token.ts + its test; the confirm-email route (POST
mints, GET verifies+writes) + its test; the Profile page's confirm-flag message map.

## Plan (Option (d), no migration — §1bn point 1)

1. **confirm-token.ts:** add `priorEmail: string` to the token payload (the digest address the profile
   held when the token was minted; `""` sentinel when none). `signConfirmToken` gains a `priorEmail`
   parameter (positioned right after `email`, before `now`/`ttlMs` — every call site updated). The
   post-decrypt shape check adds `typeof parsed.priorEmail === "string"` alongside the existing
   uid/email/exp checks, so a pre-fix token (no `priorEmail`) is rejected as `malformed` — no dual-format
   fallback, per §1as point 2. `VerifyConfirmTokenResult`'s `ok:true` branch gains `priorEmail: string`.
2. **confirm-email/route.ts POST:** pass the already-read `storedEmail` (the existing `currentDigestEmail`
   call, unchanged) as `priorEmail` into `signConfirmToken` — no new read.
3. **confirm-email/route.ts GET:** after the existing uid check (`result.uid !== user.id`) and before the
   write, call the existing `currentDigestEmail` helper (module-private, same file, reused not duplicated)
   to read the live `digest_email`. Write only if `current === result.priorEmail` (nothing changed since
   mint) or `current === result.email` (this exact link already applied — keeps same-link-twice harmless
   for mail-gateway prefetch). Otherwise: no write, redirect `digest_email_confirm=stale_link`. A failed
   read falls back to the existing generic `invalid_link` outcome (same convention as the existing write-
   failure branch just below it) rather than a new error path.
4. **Profile page:** extract the inline GET-flag message map (page.tsx ~1660-1665) into an exported pure
   function `confirmFlagMessage(flag)`, mirroring the existing `confirmAddressMessage`/`testSendMessage`
   "page owns the sentence" pattern (both already exported+tested the same way) — needed because the
   wrapper component that currently holds this map calls useRouter/useSearchParams and isn't unit-tested
   directly (page.test.tsx's own documented convention). Add the `stale_link` entry. Drafted sentence:
   **"Your email settings changed since that link was sent. Request a new confirmation link."** (matches
   the guide's own Option (d) writeup verbatim, §1bn point 2's "along the lines of" wording, same voice as
   the existing entries — ends the same way `invalid_link` does).
5. **Tests** (confirm-token.test.ts, confirm-email/route.test.ts, profile/page.test.tsx): the guide's 11 —
   priorEmail round-trip, empty-sentinel, tamper, old-shape-rejected; the replay scenario; the short-circuit
   variant; same-link-twice-with-DB-reflecting-the-write; ordinary confirmation (no false positive);
   re-request-after-supersession (both sub-cases); error precedence (expired beats stale); the stale-link
   sentence. The route.test.ts redirect allow-list regression guard gets `stale_link` added to its allowed
   set (a real behavior addition, tagged).
6. **Mutations to prove:** (a) skip/remove the current-address comparison in GET → the replay test goes
   red. (b) accept an old-shape token (drop the `priorEmail` shape check) → the old-shape-rejected test
   goes red. Each applied, run, restored; sha256 before/after compared.
7. **Gates:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`, one at a time, from
   `web/`. Baseline at HEAD 9dd3d16c: 294 files (291 + 3 skipped) / 5549 passed + 6 skipped / 0 failed;
   tsc 0 errors; eslint 0 errors / 151 warnings; build OK.

Not touched (per scope): the 24h TTL, the 5/day counter, the wrong-account check, `PUT /api/profile`'s
existing digest_email guard (already correct — read at route.ts:296-327, confirmed no code change needed;
its write path is covered by the general fix since GET reads the live column directly, not a per-write-
site flag).

## Progress log

- Read ABC-JEV-INTEGRATION.md §1bn, §1as; the B guide (whole); web/AGENTS.md; confirm-token.ts + test;
  confirm-email/route.ts + test; profile/page.tsx's GET-flag message map (~1637-1683) and
  `confirmAddressMessage`/`testSendMessage` pattern (~1290-1360); PUT /api/profile's digest_email guard
  (route.ts:296-327, confirmed no change needed). Plan above written.
- **confirm-token.ts:** `ConfirmTokenPayload` gains `priorEmail: string`; `signConfirmToken` gains a
  `priorEmail` parameter (after `email`, before `now`/`ttlMs`); the post-decrypt shape check in
  `verifyConfirmToken` now also requires `typeof priorEmail === "string"` (alongside uid/email/exp), and
  `VerifyConfirmTokenResult`'s `ok:true` branch returns `priorEmail`. Old-shape tokens (no priorEmail) fail
  the shape check -> `malformed`, same honest outcome as any other bad token, no dual-format fallback.
- **confirm-token.test.ts:** every `signConfirmToken` call site updated with a `priorEmail` argument (12
  call sites); 4 result-shape assertions gained a `priorEmail` field, each commented
  "EMAIL-TOKEN-REPLAY (§1bn)"/"priorEmail added to the expected shape" at the point of change; new describe
  block `priorEmail — ...` (7 new tests): round-trip, normalization, empty sentinel, no-leak-in-token,
  ciphertext tamper, old-shape rejected (mutation anchor), wrong-type rejected. `npx vitest run
  src/lib/email/confirm-token.test.ts` alone: 35/35 passed.
- **confirm-email/route.ts:** POST passes the already-read `storedEmail ?? ""` as `priorEmail` into
  `signConfirmToken` (no new read). GET, after the existing uid check and before the write, calls the
  existing `currentDigestEmail` helper (same file, reused, not duplicated) and writes only if
  `current === priorEmail` or `current === token's own email`; otherwise redirects
  `digest_email_confirm=stale_link`, nothing written. A failed read falls back to the existing
  `invalid_link` outcome (same convention as the write-failure branch). Module header comment updated to
  document the new GET step.
- **confirm-email/route.test.ts:** `tokenFor` helper moved to module scope (was describe-local; both the
  existing GET describe block and the new one need it) and gained a `priorEmail = ""` 4th parameter — every
  pre-existing call site is unchanged (default keeps today's behavior, matching the default mock's
  `digest_email: null`). New describe block `EMAIL-TOKEN-REPLAY (§1bn): a token that is still valid can
  still be stale` (7 tests): the exact item replay scenario (mutation anchor), the account-email
  short-circuit variant, same-link-twice with the DB reflecting the write in between, re-request-after-
  supersession (both sub-cases), error precedence (expired beats stale), a live-read-failure fallback. The
  redirect allow-list regression guard's `ALLOWED` set gained `digest_email_confirm=stale_link`, commented
  "EMAIL-TOKEN-REPLAY (§1bn)". `npx vitest run src/app/api/profile/confirm-email/route.test.ts` alone:
  30/30 passed.
- **profile/page.tsx:** extracted the inline GET-flag `messages` map into an exported pure function
  `confirmFlagMessage(flag)`, same "page owns the sentence" pattern as `confirmAddressMessage`/
  `testSendMessage` (needed for testability — the wrapper component needs a router/search-params tree).
  Added `stale_link` entry. **Drafted sentence:** "Your email settings changed since that link was sent.
  Request a new confirmation link." (matches the guide's own Option (d) wording verbatim; same voice/
  ending as the existing `invalid_link` entry). The `useEffect` now calls `confirmFlagMessage(confirmFlag)`
  instead of the inline map.
- **profile/page.test.tsx:** imported `confirmFlagMessage`; new describe block (7 tests) covering every
  existing flag plus `stale_link`, the unrecognized-flag fallback, and the null-flag fallback. `npx vitest
  run src/app/profile/page.test.tsx` alone: 65/65 passed.
- **Mutation proof 1** (skip the current-address comparison): sha256 before = 4e074702b2dfa3a9003d034fdd
  a4c7e239c9ef146bc4c2b4e0292cf02ae1d050. Changed route.ts's GET comparison to `if (false && currentValue
  !== result.priorEmail && currentValue !== result.email)`. Ran route.test.ts: **3 tests went red** — the
  exact item replay scenario, the account-email short-circuit variant, and the re-request-after-
  supersession test's final assertion (all three assert `stale_link`; with the guard skipped every one
  silently succeeded as `digest_email_confirmed=1` instead) — 27/30 passed, 3 failed, exactly the predicted
  break. Restored the exact original text. sha256 after = 4e074702b2dfa3a9003d034fdda4c7e239c9ef146bc4c2b
  4e0292cf02ae1d050 — **identical**.
- **Mutation proof 2** (accept an old-shape token): sha256 before = 6ca676ebe7a0aeddb57168f5c5e5860a03db9
  7b2e598ae90e3f0063b51675fa4. Removed the `typeof priorEmail !== "string"` line from confirm-token.ts's
  shape check. Ran confirm-token.test.ts: **2 tests went red** — "a token minted before this fix shipped
  (old shape...)" (now returned `ok:true, priorEmail: undefined` instead of `malformed`) and "rejects
  priorEmail of the wrong type" (now returned `ok:true, priorEmail: 12345` instead of `malformed`) — 33/35
  passed, 2 failed, exactly the predicted break. Restored the exact original text (with its comment).
  sha256 after = 6ca676ebe7a0aeddb57168f5c5e5860a03db97b2e598ae90e3f0063b51675fa4 — **identical**.
- Line endings reverified post-restore via `git ls-files --eol`: all six touched files match their
  pre-edit convention (page.tsx w/crlf; the other five w/lf) — unchanged throughout.
- **Gates (all from web/, one at a time):**
  - `npx vitest run` — 294 files (291 + 3 skipped) / **5569 passed + 6 skipped / 0 failed** (baseline 5549
    passed; net +20 from the new tests across the three test files, 0 regressions).
  - `npx tsc --noEmit` — 0 errors (no output), matches baseline.
  - `npx eslint .` — **0 errors / 151 warnings**, matches baseline exactly (all 151 pre-existing warnings,
    none new).
  - `npm run build` — compiled successfully, TypeScript pass finished, all pages generated, "Route (app)"
    table printed including `/api/profile/confirm-email`. One pre-existing Turbopack NFT-trace warning on
    `next.config.ts` → `src/lib/papers/pdf-text.ts` → `src/app/api/papers/upload/route.ts` — unrelated to
    this item's files, not introduced by this change.
- `git status`/`git diff --stat` confirms only the intended 6 product/test files changed under web/, plus
  this checkpoint doc under docs/jev-abc/. `ABC-JEV-INTEGRATION.md` (modified) and
  `docs/jev-abc/EMAIL-TOKEN-REPLAY-B-20260930T055356Z.md` (untracked) were both already in that state at
  session start per the initial git snapshot — neither was touched by this C. `node_modules/` untouched.

## Round 2 — fix round after A's FAILED_REVIEW (docs/jev-abc/EMAIL-TOKEN-REPLAY-A-20260930T063542Z.md)

STATUS (this round): IN_PROGRESS

Binding: ABC-JEV-INTEGRATION.md §1bn point 7 (AMENDMENT). A confirmed ruling compliance, every named
scenario, all 11 tests, mutations, copy and privacy — FAILED_REVIEW only on two NEW findings from its own
required bypass-hunt/flakiness checks, both addressed by this ruling:

a. **HIGH, §1bn.7a — fix the flaky tamper test.** Root cause (A's arithmetic, independently re-verified
   below): the "tampered inside the ciphertext/tag region" test flips only the LAST base64url character of
   the token. With `priorEmail` added the plaintext grew from 62 to 78 bytes, so the blob (iv+ciphertext+tag)
   grew from 90 to 106 bytes; `90 % 3 == 0` (HEAD: full base64 group, every bit of the last char decoded,
   flip always caught) vs `106 % 3 == 1` (now: partial trailing group, only the last char's top 2 of 6 bits
   are actually decoded — the low bits the 'a'/'b' flip lives in are discarded ~25% of the time depending on
   the random IV, so the "tamper" sometimes silently produces byte-identical decoded content and the test
   wrongly passes/fails by luck). Fix: flip a DECODED byte (not a base64url character) before re-encoding, so
   the change is always real regardless of base64 alignment. Plan: decode the blob, XOR the LAST byte (deep
   inside the 16-byte GCM tag — unambiguously still "ciphertext/tag region") with 0xff (guaranteed to differ
   from the original for any byte value), re-encode. Comment "EMAIL-TOKEN-REPLAY (§1bn.7a)". Proof required:
   20/20 consecutive isolated runs of confirm-token.test.ts; then prove the test still catches real tampering
   by mutating verifyConfirmToken to skip the auth-tag check -> red; restore with sha256 proof.
b. **ACCEPTED COST tripwire, §1bn.7b.** A mint-time snapshot is a VALUE not a history: if the live address
   round-trips back to it (A minted while unset -> B confirmed -> field cleared, which PUT allows
   unconditionally, no confirmation needed, route.ts:296-327 `let allowed = candidate === ""`) the old A link
   still works. One new route test pins today's behaviour (write happens, outcome `digest_email_confirmed=1`)
   with the comment "accepted cost, §1bn.7b — pins today's behaviour so a change is a conscious decision".
   Not closed in this item (needs per-user state — a generation counter or column — out of §1bn's no-
   migration scope); threshold for revisiting: one real report.
c. Re-run all 4 gates from web/, one at a time, after both fixes; update this checkpoint after each step.

Not in this round's scope (A's own findings, correctly NOT assigned to C): the LOW-MEDIUM TOCTOU race
(pre-existing architectural pattern, reported as a lead only, not a blocker); check c in A's amendment list.

### Round 2 progress

- **(a) Flaky tamper test fixed.** confirm-token.test.ts's "rejects a token tampered inside the
  ciphertext/tag region..." now decodes the token's base64url blob, XORs the LAST byte (inside the 16-byte
  GCM tag) with `0xff` (guaranteed to differ from the original for any byte value), and re-encodes — no
  longer depends on which base64 group-alignment class the blob length falls into. Comment
  "EMAIL-TOKEN-REPLAY (§1bn.7a)" added with the full root-cause explanation inline.
  - **20-run proof:** looped `npx vitest run src/lib/email/confirm-token.test.ts` 20 times in a fresh
    process each time. **20/20 runs: "Tests 35 passed (35)", 0 failures, every single run.**
  - **Mutation proof (still catches real tampering):** sha256 before = `6ca676ebe7a0aeddb57168f5c5e5860a0
    3db97b2e598ae90e3f0063b51675fa4`. Mutated confirm-token.ts's `verifyConfirmToken` catch block (the
    branch that runs when GCM's auth-tag check throws) to return a fake `{ ok: true, uid: "mutated", ... }`
    instead of `{ ok: false, reason: "tampered" }` — simulates the auth check being skipped/ignored. Ran
    confirm-token.test.ts: **5 tests went red**, including — critically — the exact test just fixed
    ("rejects a token tampered inside the ciphertext/tag region..."), plus 4 sibling tamper tests (IV
    region, IV swap, wrong secret, the dedicated priorEmail-region tamper test) — 30/35 passed. Proves the
    fixed test is genuinely load-bearing, not vacuously passing. Restored the exact original catch block;
    sha256 after = `6ca676ebe7a0aeddb57168f5c5e5860a03db97b2e598ae90e3f0063b51675fa4` — **identical**. Ran
    the file once more post-restore: 35/35 passed, confirming clean restoration.
- **(b) Accepted-cost tripwire added.** New test in route.test.ts's "EMAIL-TOKEN-REPLAY (§1bn)" describe
  block: mint A while unset (priorEmail ""), confirm B (real GET), simulate the field being cleared via PUT
  (mock returns `digest_email: ""` — the literal value `profilePatchToRow` writes for a cleared field,
  route.ts:147), click the old A link -> asserts `digest_email_confirmed=1` and the upsert writes A. Comment
  in the test body: "accepted cost, §1bn.7b — pins today's behaviour so a change is a conscious decision"
  (verbatim, plus the mechanism explanation). `npx vitest run
  src/app/api/profile/confirm-email/route.test.ts`: 31/31 passed (was 30; +1 new test, 0 regressions).
- Line endings reverified via `git ls-files --eol` on both edited files (confirm-token.ts, confirm-
  token.test.ts, route.test.ts): all `w/lf`, unchanged.
- **Gates (all from web/, one at a time):**
  - `npx vitest run` — 294 files (291 + 3 skipped) / **5570 passed + 6 skipped / 0 failed** (round 1's 5569
    + 1 new tripwire test; 0 regressions). Run twice back-to-back for extra confidence given A's flakiness
    finding: both runs identical (5570/0 failed).
  - `npx tsc --noEmit` — 0 errors (no output), matches baseline.
  - `npx eslint .` — **0 errors / 151 warnings**, exact match to baseline, no new warnings.
  - `npm run build` — **one transient failure, then two clean successes, all reported honestly:** the first
    attempt this round failed on a Next.js font-loader error unrelated to this diff (`next/font/google`
    failed to resolve `noto_sans_sc` — a network-dependent build step; nothing in the 6 changed files
    touches fonts, layout, or CSS). Re-ran twice: the second run (captured through `tee | head`, inconclusive
    due to a pipe-truncation artifact but showing a clean route table with no errors up to the truncation
    point) and a third run with output fully redirected to a file (no truncation) both **exit code 0**, full
    "Route (app)" table through the static/dynamic legend, only pre-existing Turbopack NFT-trace warning
    (pdf-text.ts, unrelated), matches round 1's baseline exactly. Treated as environmental flakiness (a
    network fetch during the font-optimization step), not a regression — reproduced clean twice after.
- `git status`/`git diff --stat` confirms only the same 6 product/test files changed under web/ (route.ts's
  diff unchanged from round 1 — round 2 touched only route.test.ts, confirm-token.ts [restored to
  byte-identical], and confirm-token.test.ts), plus this checkpoint. `docs/jev-abc/
  EMAIL-TOKEN-REPLAY-A-20260930T063542Z.md` is the reviewer's own file, not created or touched by C.
  `node_modules/` untouched. No commit/push/branch operation performed.

## Round 2 — STATUS: IMPLEMENTED_PENDING_REVIEW

**(a) HIGH fix (§1bn.7a):** confirm-token.test.ts's ciphertext/tag tamper test now flips a decoded byte
(XOR 0xff on the blob's last byte, inside the GCM tag) before re-encoding instead of a post-encoding base64
character — deterministic regardless of the blob's base64 group alignment. **20/20 consecutive isolated
runs passed** (35/35 tests each run, 0 failures across all 20). Mutation proof: simulating a skipped auth
check (catch block returns a fake `ok:true` instead of `ok:false, reason:"tampered"`) turned the fixed test
red (plus 4 sibling tamper tests) — 30/35 passed — proving it is genuinely load-bearing. Restored;
sha256 `6ca676ebe7a0aeddb57168f5c5e5860a03db97b2e598ae90e3f0063b51675fa4` before = after.

**(b) Tripwire added (§1bn.7b):** new route.test.ts test pins the accepted-cost scenario (mint A while
unset → confirm B → field cleared via PUT with no confirmation needed → click old A link → confirms A,
writes) with the exact required comment "accepted cost, §1bn.7b — pins today's behaviour so a change is a
conscious decision".

**Gates:** vitest 5570 passed + 6 skipped / 0 failed (run twice, identical both times); tsc 0 errors;
eslint 0 errors / 151 warnings; build exit 0 with full route table (one transient, diff-unrelated
font-fetch failure on the first attempt, two clean reproductions after — reported honestly above, not
hidden).

**Not addressed (correctly out of scope per §1bn.7):** the LOW-MEDIUM TOCTOU race (A's own finding,
explicitly a lead not a blocker, not assigned to C).

## STATUS: IMPLEMENTED_PENDING_REVIEW

**Changed files:**
- `web/src/lib/email/confirm-token.ts` — `priorEmail` added to the payload/sign/verify contract.
- `web/src/lib/email/confirm-token.test.ts` — 12 call sites updated, 4 assertions extended (tagged), 7 new
  tests.
- `web/src/app/api/profile/confirm-email/route.ts` — POST passes `priorEmail`; GET adds the stale-address
  comparison after the uid check.
- `web/src/app/api/profile/confirm-email/route.test.ts` — `tokenFor` moved to module scope + gained
  `priorEmail`; 7 new tests; allow-list guard extended (tagged).
- `web/src/app/profile/page.tsx` — new exported `confirmFlagMessage`; the GET-flag `useEffect` now calls it.
- `web/src/app/profile/page.test.tsx` — 7 new tests for `confirmFlagMessage`.

**The drafted stale-link sentence:** "Your email settings changed since that link was sent. Request a new
confirmation link." (matches the guide's own Option (d) wording verbatim; same voice/ending as the
existing `invalid_link` entry it sits beside).

**Tests:** the guide's 11 are covered — priorEmail round-trip/normalization/empty-sentinel/no-leak (
confirm-token.test.ts); tampering rejected, including a dedicated priorEmail-region tamper case
(confirm-token.test.ts); an old-shape token rejected as malformed, plus a wrong-type variant
(confirm-token.test.ts, mutation-anchored); the replay scenario, the account-email short-circuit variant,
same-link-twice-with-DB-reflecting-the-write, an ordinary first confirmation, re-requesting a superseded
address then confirming the new link (both sub-cases), error precedence (expired beats stale), and a
DB-read-failure fallback (route.test.ts, mutation-anchored); the page's stale-link sentence plus every
other flag and both fallback paths (page.test.tsx). No pre-existing test was deleted or weakened; every
changed assertion is commented "EMAIL-TOKEN-REPLAY (§1bn)" or an equivalent inline note at the point of
change.

**Mutation proof:** both required mutations applied, run, and restored with identical sha256 (see the
Progress log entries above for exact hashes and which tests went red). Skipping the current-address
comparison turned the replay/short-circuit/re-request tests red (27/30). Accepting an old-shape token
turned the old-shape and wrong-type tests red (33/35).

**Gates:** vitest 5569 passed + 6 skipped / 0 failed (294 files); tsc 0 errors; eslint 0 errors / 151
warnings; build OK. All match or improve on the HEAD 9dd3d16c baseline with 0 regressions.

**Not touched (per scope, unchanged):** the 24h TTL, the 5/day counter, the wrong-account check, `PUT
/api/profile`'s digest_email guard (read, confirmed already correct, no code change — its write path is
covered by the fix since GET reads the live column directly).
