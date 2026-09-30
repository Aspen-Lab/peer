# EMAIL-TOKEN-REPLAY — A (independent review)

STATUS: VERIFIED (round 2; round 1 was FAILED_REVIEW — see below)

Reviewer: A (independent, read-only on product code)
Branch: Jev-integration-and-sorting-filtering-enhancement
HEAD at start: 9dd3d16c

## Plan
1. Read ABC-JEV-INTEGRATION.md §1bn (binding ruling) and §1as (token format/strict-shape rule)
2. Read guide doc B and implementer checkpoint C
3. Read the diff (confirm-token.ts+test, confirm-email route.ts+test, profile page.tsx+test)
4. Check 1: ruling compliance point by point
5. Check 2: hole-closure scenarios by execution
6. Check 3: no regression / opaque tokens / redirect allow-list / no raw text
7. Check 4: mutation testing (restore + sha256 proof)
8. Check 5: gates (vitest, tsc, eslint, build)
9. Check 6: copy + privacy scan
10. Final verdict

## Reads completed

ABC-JEV-INTEGRATION.md §1bn (binding ruling, lines 246-254) and §1as (EMAIL-TOKEN-PRIVACY, lines 538-548,
in particular point 2/3's no-dual-format strict-shape rule referenced by §1bn.3); guide
docs/jev-abc/EMAIL-TOKEN-REPLAY-B-20260930T055356Z.md (whole); implementer checkpoint
docs/jev-abc/EMAIL-TOKEN-REPLAY-C-20260930T062416Z.md (whole); full diff of all 6 changed files
(confirm-token.ts + test, confirm-email/route.ts + test, profile/page.tsx + page.test.tsx) read in full,
not just skimmed.

## Check 1 — ruling compliance (§1bn points 1-6): PASS on the letter of the ruling

1. Option (d) implemented as specified: `priorEmail` added to the token payload; POST passes the already-read
   `storedEmail ?? ""` (no new read at mint); GET reads live `digest_email` via the reused `currentDigestEmail`
   helper (not duplicated) and writes only if `current === priorEmail` or `current === result.email` (own
   target); otherwise `stale_link`, nothing written. Matches route.ts:275-296 exactly.
2. Stale-link copy shipped as `confirmFlagMessage`'s `stale_link` entry: "Your email settings changed since
   that link was sent. Request a new confirmation link." — truth-checked in Check 6 below.
3. Old-shape tokens (no priorEmail) rejected as malformed via a strict `typeof priorEmail !== "string"` check
   in `verifyConfirmToken`, same discipline as uid/email/exp, no dual-format fallback (confirm-token.ts:232-247).
4. Scope respected: only confirm-token.ts, both confirm-email handlers, and their tests touched; TTL, 5/day
   counter, wrong-account check untouched (confirmed by reading the surrounding unchanged code).
5. B's 11 tests: all present in the diff (round-trip, empty-sentinel, tamper incl. dedicated priorEmail-region
   tamper, old-shape-rejected, wrong-type-rejected; replay scenario, short-circuit variant, same-link-twice,
   ordinary confirmation, re-request-after-supersession both sub-cases, error precedence, live-read-failure
   fallback, stale-link sentence). Mutations 1/2 as specified.
6. Process: C ran after DIGEST-CATCHUP-TRIPWIRES per the state file's queue note; fresh A (this review) now.

STATUS: ruling compliance PASS. (Does not by itself determine the final verdict — see Checks 2-5 below.)

## Check 2 — hole closure + bypass hunt: HOLE CLOSED for the exact scenario; TWO NEW BYPASS CLASSES FOUND (both proven by execution)

All of C's own scenario tests (route.test.ts's new "EMAIL-TOKEN-REPLAY (§1bn)" describe block) were read
line-by-line against the real route.ts logic and independently executed via `npx vitest run` (see Check 5) —
the exact item scenario, the short-circuit variant, same-link-twice, ordinary confirmation,
re-request-after-supersession (both sub-cases), and error precedence (expired beats stale) all pass and are
correctly wired, not vacuous (mutation-anchored).

Independent bypass hunt: wrote a temporary probe file
`web/src/app/api/profile/confirm-email/__a_token_probe_coincidence.test.ts` (prefix per the brief; deleted
after use, git status proof below) reusing route.test.ts's exact mock-scaffolding shape but with a STATEFUL
fake DB row so multi-step and concurrent scenarios could be executed for real against the actual route.ts +
confirm-token.ts. Three scenarios, all executed, all reproduced as predicted:

- **FINDING (MEDIUM) — "coincidental priorEmail match" after real intervening changes.** The check compares
  VALUES ("is current == the mint-time snapshot"), not EVENTS ("has anything happened since mint"). If the
  live address round-trips back to the exact value it held when an old, unclicked token was minted — via ANY
  number of genuine intervening changes — that old token silently reactivates. Proven two ways: (a) two
  legitimate confirms that net back to the same non-empty address; (b) the realistic, one-step version: an
  old token minted while `digest_email` was unset (`priorEmail=""`), then the reader confirms a different
  address, then clears the field back to empty — proven independently reachable in ONE always-unconditionally
  -permitted step by reading `web/src/app/api/profile/route.ts:296-327` ("let allowed = candidate === \"\";" —
  clearing to empty needs no confirmation, no guard, by explicit design/comment) — at which point the old,
  long-abandoned token silently fires and overwrites the just-cleared field. Bounded by the same 24h TTL and
  same-account-session requirement as the original bug (same severity CLASS as what B already rated LOW), but
  it is a second, un-named path into the same harm, not covered by any B/C test, and not flagged as an
  accepted cost anywhere in the guide or ruling.
- **FINDING (LOW-MEDIUM) — TOCTOU race between two nearly-simultaneous confirm clicks.** `currentDigestEmail`
  (read) and `writeConfirmedDigestEmail` (write) are two separate, non-transactional DB calls. Two different,
  both-legitimately-minted tokens (for two different candidate addresses, both snapshotting the same
  pre-change `current`) fired concurrently (simulated via `Promise.all` over the real GET handler with a
  stateful mock DB, letting Node's real microtask interleaving decide order) BOTH pass the staleness check and
  BOTH write — neither is told `stale_link`, and the final stored value is whichever write's promise settles
  last, non-deterministically. This is a pre-existing architectural pattern (the POST short-circuit path has
  the same read-then-write shape) that this item neither introduced structurally nor was asked to close, and
  the window is a single DB round trip (milliseconds), not the 24h window the item targets — rated LOW-MEDIUM,
  reported as a lead, not a blocker on its own.

Probe file deleted after use; `git status --porcelain` on the directory afterward showed only the two
legitimate modified files (route.test.ts, route.ts) — no trace of the probe. No product file was edited to
run this probe; it only added a new, self-contained temp test file that imports the real, unmodified
route.ts/confirm-token.ts.

## Check 5 (partial, done early because it surfaced a Check-3-relevant defect) — gates: NOT RELIABLY GREEN

`npx vitest run src/lib/email/confirm-token.test.ts` in isolation: **FLAKY**. Re-run 5 times back-to-back:
pass, FAIL, pass, pass, FAIL-on-first-combined-run (exact sequence: pass/fail/pass across 3 consecutive runs
logged; also failed when run combined with the other two touched test files). The one test that fails,
intermittently: `signConfirmToken / verifyConfirmToken — round trip > rejects a token tampered inside the
ciphertext/tag region without parsing the payload as meaningful` (confirm-token.test.ts ~line 174).

ROOT CAUSE, proven arithmetically and then empirically: the test flips ONLY the last base64url character of
the token (`token[token.length-1]`, between 'a' and whatever it already is). Whether that flip changes the
DECODED bytes depends on `blob.length % 3` (base64 groups 3 bytes per 4 chars; a partial trailing group
discards some of the last character's bits during decode). Computed directly
(`node -e` script, byte-exact):
- OLD payload (HEAD, no priorEmail): plaintext 62 bytes -> blob 90 bytes -> `90 % 3 == 0` -> FULL group ->
  every bit of the last char is decoded -> the flip ALWAYS changes the byte -> tamper ALWAYS caught (matches
  the HEAD baseline's "0 failed").
- NEW payload (+`"priorEmail":""`, +16 bytes of JSON): plaintext 78 bytes -> blob 106 bytes -> `106 % 3 == 1`
  -> PARTIAL trailing group -> only the last char's top 2 bits are actually decoded, the bottom 4 (including
  the exact bit 'a'/'b' differ in) are discarded -> whether the flip changes anything now depends on the
  RANDOM IV's resulting last character (25% of the possible last-character values share the same top-2-bits
  as the flip target and produce a byte-identical, undetected "tamper" -> test wrongly asserts `ok:true`
  instead of `ok:false`).

This is a real regression caused by this diff's payload-length change, not a pre-existing flake (proven: at
HEAD's fixed 90-byte blob the failure mode is mathematically impossible; only the new 106-byte blob enters
the vulnerable modulus class). It directly contradicts the implementer's checkpoint ("`npx vitest run
src/lib/email/confirm-token.test.ts` alone: 35/35 passed") and the final gate report ("5569 passed... 0
failed") — both are real but LUCKY individual runs of a now-flaky suite, not a reliable 0-failed gate. My own
first full-suite run this session also showed 0 failed (also luck, ~75% per-run odds); repeated isolated runs
immediately after showed the failure twice more.

This does NOT indicate any live product/security defect — GCM tamper protection genuinely still holds (every
OTHER tamper test, including the new dedicated priorEmail-region midpoint-flip test, perturbs an INTERIOR
character, immune to this trailing-group effect, and passes reliably). It is a test-effectiveness regression:
a named, pre-existing test silently lost the ability to reliably prove what it claims, ~25% of the time,
purely as a side effect of this diff's payload shape change — squarely inside Check 3's "confirm no assertion
lost strength."

Remaining gates (tsc/eslint/build) and full mutation testing (Check 4) still to run — continuing below.

## Check 4 — mutation testing: all three mutations produce the predicted red tests; clean restore proven twice (certutil + PowerShell Get-FileHash)

Baseline hashes read before any mutation (matched C's own reported before/after hashes exactly, confirming
the working tree was in the state C left it): confirm-token.ts
`6ca676ebe7a0aeddb57168f5c5e5860a03db97b2e598ae90e3f0063b51675fa4`; route.ts
`4e074702b2dfa3a9003d034fdda4c7e239c9ef146bc4c2b4e0292cf02ae1d050`.

1. **Skip the current-address comparison** (route.ts's GET, wrapped the comparison in `false &&`): ran
   route.test.ts -> **3 red** (the exact item scenario, the short-circuit variant, and the
   re-request-after-supersession test's final assertion) / 27 passed — identical to C's reported break.
   Restored; sha256 after = `4e074702b2dfa3a9003d034fdda4c7e239c9ef146bc4c2b4e0292cf02ae1d050` (certutil) and
   `4E074702B2DFA3A9003D034FDDA4C7E239C9EF146BC4C2B4E0292CF02AE1D050` (PowerShell `Get-FileHash`) — identical
   to baseline via two independent tools.
2. **Accept an old-shape token** (confirm-token.ts, wrapped the `typeof priorEmail !== "string"` shape check
   in `false &&`): ran confirm-token.test.ts -> **2 red** (the old-shape-rejected test and the
   wrong-type-rejected test) / 33 passed — identical to C's reported break. Restored; sha256 after =
   `6ca676ebe7a0aeddb57168f5c5e5860a03db97b2e598ae90e3f0063b51675fa4`, matching baseline via both tools.
3. **Treat a failed live-address read as "unchanged" (write anyway)** — required by this review's checklist,
   NOT one of the two mutations C's own checkpoint reports. Changed route.ts's GET so a failed
   `currentDigestEmail` read skips straight past the staleness check (proceeds toward the write) instead of
   redirecting `invalid_link`. Ran route.test.ts -> **1 red** (the dedicated "a live digest_email read
   failure falls back to..." test) / 29 passed. A real guard exists and is tested — this mutation does NOT
   surface a finding (the checklist's fallback clause, "if none does, that is a finding," does not apply).
   Restored; sha256 after matches baseline via both tools (shown above).

Line endings unaffected throughout (`git ls-files --eol`): page.tsx is `w/crlf`, the other five touched files
(including both mutated ones) are `w/lf` — same split C reported, unchanged before/after every mutation.
Byte counts read via PowerShell as a second cross-check (route.ts 13058 bytes, confirm-token.ts 12146 bytes)
consistent with clean restoration.

## Check 5 — gates (complete)

- `npx vitest run` (full suite): **291 passed | 3 skipped (294 files) / 5569 passed | 6 skipped (5575),
  0 failed** on this run — matches the implementer's reported numbers exactly. HOWEVER, see the flaky-test
  finding above/below: this specific full-suite run happened to land in the ~75%-likely "pass" case; repeated
  isolated runs of confirm-token.test.ts during this same session produced the failure twice more (see Check
  2/3 above). The suite is not reliably 0-failed as currently written.
- `npx tsc --noEmit`: 0 errors (no output) — matches baseline.
- `npx eslint .`: **0 errors / 151 warnings** — matches baseline exactly (same warning set, spot-checked, no
  new warnings from the 6 changed files).
- `npm run build`: compiled successfully, TypeScript pass finished, all pages generated, `/api/profile/
  confirm-email` present in the route table, the same pre-existing unrelated Turbopack NFT-trace warning on
  `pdf-text.ts` (not from this item's files). Matches baseline.

## Check 6 — copy + privacy

**Copy.** "Your email settings changed since that link was sent. Request a new confirmation link." Plain,
calm, two short sentences, same voice/ending as the neighboring `invalid_link` entry. Checked against every
path that can actually raise `stale_link` (both in the diff and by execution): in every one of them the live
`digest_email` genuinely differs from both the token's mint-time snapshot and the token's own target, so the
sentence is true whenever it is shown. Caveat tied to the Check 2 finding: the sentence is not shown in EVERY
case a reader might intuitively call "stale" (the coincidental-match bypass silently succeeds instead of
showing this sentence) — that is a under-triggering/coverage gap, not a truthfulness problem with the
sentence's own wording.

**Privacy.** Searched (pattern-based, words only, nothing printed beyond what's reported here): every
`user@domain`-shaped string in the 6-file diff and in all three EMAIL-TOKEN-REPLAY docs (B guide, C
checkpoint, this file) — all resolve to reserved/documentation domains only (example.com, example.test,
example.invalid, example-university.edu, per RFC 2606/6761), none resemble a real address; a direct search
for the user's own real email address in all nine file-locations (six changed files + three docs) — zero
matches. Searched for secret-/key-/token-shaped long strings in the diff and the three docs: every hit is
either a source-code identifier (`secret: string` parameter names, `deriveKey(secret)`), a sha256 hex digest
recorded as mutation-restoration proof, a file path, or one already-labeled fake test string
(`scratch-only-fake-secret-do-not-reuse-9f3e`, from B's guide, explicitly named as non-reusable). No real
secret was read, printed, or used anywhere in this review; `web/.env`/`web/.env.local` were never opened.

## FINDINGS

**HIGH — a pre-existing tamper-detection test became flaky (~25% failure rate), caused by this diff, violating
Check 3 ("no assertion lost strength") and Check 5 (gates not reliably green).**
`confirm-token.test.ts`'s "rejects a token tampered inside the ciphertext/tag region..." test flips only the
LAST base64url character of the token. Whether that flip changes the decoded bytes depends on `blob.length %
3` (base64 packs 3 bytes per 4 chars; a partial trailing group discards some of the last character's bits on
decode). Proven by exact byte-length arithmetic (`node -e`, reproduced twice) and then by repeated execution:
- HEAD's payload (no `priorEmail`): plaintext 62 bytes -> blob 90 bytes -> `90 % 3 == 0` (full group) -> every
  bit of the last char is decoded -> the flip ALWAYS changes the byte -> tamper ALWAYS caught.
- This diff's payload (+`"priorEmail":""`): plaintext 78 bytes -> blob 106 bytes -> `106 % 3 == 1` (partial
  group) -> only the last char's top 2 of 6 bits are actually decoded; the bit 'a'/'b' differ in is discarded
  -> whether the flip is caught now depends on the random IV's resulting last character (~25% of possible
  values share the same top-2-bits as the flip target and produce a byte-identical "tamper" that verifies
  fine).
  Reproduced directly: 5 separate runs of `npx vitest run src/lib/email/confirm-token.test.ts` this session
  -> pass, FAIL, pass, pass (isolated re-runs), and FAIL again when combined with the other two touched test
  files; a full-suite run happened to pass (the ~75% case). This is not a live product/security defect — GCM
  authentication genuinely still protects the whole payload (every OTHER tamper test, including the new
  dedicated priorEmail-region test which flips a MIDPOINT character, passes reliably because interior
  positions are never subject to this trailing-group effect). It is a real, reproducible test-effectiveness
  regression directly caused by the payload growing by 16 bytes, undetected by the implementer (whose
  checkpoint reports "35/35 passed" and "0 failed" — both true only as lucky individual runs of a now-flaky
  file). Not fixed by this reviewer (out of mandate); flagged for the implementer — the fix is narrow (e.g.
  flip an interior byte before encoding, or flip a character not at the very end, mirroring the new
  priorEmail-region test's own technique).

**MEDIUM — "coincidental priorEmail match" bypass: an old, unclicked token can still silently reactivate once
the live address round-trips back to its mint-time snapshot, even though real changes happened in between.**
Proven by execution (temporary probe, deleted after use, git-status-confirmed gone): the check compares
VALUES, not EVENTS. The realistic one-step path: mint a token for A while `digest_email` is unset
(`priorEmail=""`), confirm a different address B, then clear the field back to empty — proven independently,
by reading `web/src/app/api/profile/route.ts:296-327`, to be an ALWAYS-unconditionally-permitted single PUT
(no confirmation needed to clear). At that point the old A token (still within its 24h TTL) silently succeeds
and overwrites the just-cleared field, even though the reader's most recent deliberate actions were "confirm
B" then "clear/stop the digest" — never "set it to A". A non-empty variant (two confirmed addresses netting
back to an earlier value) reproduces the same class without needing the clear-to-empty step. Bounded by the
same 24h TTL and same-account-session requirement as the original bug (same harm CEILING as what B already
rated LOW/self-inflicted), and neither B's guide nor C's checkpoint names this as an accepted cost anywhere —
it is a second, untested, unflagged path to the same harm the item was supposed to close.

**LOW-MEDIUM — TOCTOU race between two nearly-simultaneous confirm clicks: neither is told `stale_link`, and
the final value is non-deterministic.** Proven by execution (same temporary probe, stateful mock DB, real
`Promise.all` interleaving over the actual GET handler): `currentDigestEmail` (read) and
`writeConfirmedDigestEmail` (write) are two separate, non-transactional calls. Two different, both-legitimate
tokens minted against the same pre-change `current` and clicked without awaiting between them both pass the
staleness check and both write; the loser's own redirect still claims `digest_email_confirmed=1`. Pre-existing
architectural pattern (POST's short-circuit path has the same shape); window is a single DB round trip, not
the 24h window this item targets. Reported as a lead, not a blocker by itself.

## Mutation proof summary

All three mutations (2 from the guide/ruling + 1 from this review's own checklist) produced exactly the
predicted red tests, and all three were restored with byte-identical sha256 (cross-checked via certutil AND
PowerShell `Get-FileHash`) and unchanged line endings. No product file was left in a mutated state.

## Gates summary

vitest: 5569 passed + 6 skipped / 0 failed on the run recorded above, but demonstrably NOT reliable — the
same file failed twice more under repeated isolated execution this session (HIGH finding above). tsc: 0
errors. eslint: 0 errors / 151 warnings. build: OK. All match the baseline/implementer's numbers on any single
green run; the vitest number is not dependable run-to-run because of the HIGH finding.

## Scenario checklist (Check 2) — result for each named scenario

- A requested -> B requested and confirmed -> old A link clicked -> `stale_link`, nothing written: **PASS**
  (C's test, read + executed).
- Account-email short-circuit variant: **PASS** (C's test, read + executed).
- Same link opened twice: **PASS** (C's test, read + executed).
- Ordinary first confirmation: **PASS** (C's test, read + executed).
- Re-requesting a superseded address, then confirming the new link: **PASS** (C's test, read + executed).
- Expired-and-would-be-stale link reports the generic invalid/expired outcome, never `stale_link`: **PASS**
  (C's test, read + executed; there is no separate user-facing "expired" flag — malformed/tampered/expired
  all collapse to `invalid_link` by design, confirmed by reading `verifyConfirmToken` and the GET handler).
- New-bypass hunt (coincidental priorEmail match; empty-priorEmail case; race between two tabs): **hole
  reopened in two new, narrow ways** — see MEDIUM and LOW-MEDIUM findings above, both proven by independent
  execution, neither previously tested or named as an accepted cost.

## VERDICT

**FAILED_REVIEW.**

Reasoning: Check 1 (ruling compliance) passes on the letter of §1bn, and the specific, named replay scenario
from the item's own problem statement is genuinely closed. But two of this review's explicitly-required checks
turn up real, reproducible problems: Check 3/5 found a HIGH-confidence, execution-proven test regression (a
security-relevant tamper-detection test is now flaky, ~25% failure rate, directly caused by this diff, and the
implementer's own "0 failed" gate report is not reliable as a result) — the review brief requires "confirm no
assertion lost strength" and this assertion demonstrably did. Check 2's bypass hunt (explicitly requested in
the brief, down to naming this exact scenario shape) found a MEDIUM, execution-proven second path back into
the harm this item exists to close, reachable in one always-permitted step. Per the brief, a blocked or failing
check is never inferred as a pass; both are reported with full execution proof above for the implementer to
fix and the next fresh A to re-check.

Report path: docs/jev-abc/EMAIL-TOKEN-REPLAY-A-20260930T063542Z.md (this file).

---

## RE-CHECK (round 2) — STATUS: IN_PROGRESS

Scope per the coordinator: re-check C's round-2 fix against ABC-JEV-INTEGRATION.md §1bn point 7 (AMENDMENT:
7a fix the flaky tamper test; 7b the round-trip bypass is now an ACCEPTED COST with a required tripwire; 7c
the race stays a lead, out of scope) and docs/jev-abc/EMAIL-TOKEN-REPLAY-C-20260930T062416Z.md's "Round 2"
section (read in full). Same reviewer, same repo state rules (no commit/push/stash/branch; throwaway keys
only; temp output in docs/jev-abc/ or the scratchpad only).

### Diff scope check — confirmed round 2 touched only what §1bn.7d authorized

Compared the current `git diff HEAD` against the exact round-1 diff text already captured in this same
report/session: `route.ts`, `page.tsx`, and `page.test.tsx` are **byte-identical** to round 1 (re-diffed and
visually/textually compared line-for-line — no residual change). `confirm-token.ts` is also byte-identical to
round 1's post-fix state (its round-2 mutation, described in C's checkpoint, was restored — confirmed by
matching sha256 `6ca676ebe7a0aeddb57168f5c5e5860a03db97b2e598ae90e3f0063b51675fa4`, same as round 1's own
after-hash). Only `confirm-token.test.ts` (+22 lines net vs. round 1: the tamper test's mechanism) and
`route.test.ts` (+36 lines net vs. round 1: one new tripwire test) actually changed. This matches §1bn.7d's
authorized scope exactly — nothing else was touched.

### (1) Determinism — CONFIRMED, both empirically and by exhaustive arithmetic

Ran `npx vitest run src/lib/email/confirm-token.test.ts` **30 times** (exceeds the requested 20), fresh
process each time: **30/30 runs — "Tests 35 passed (35)", 0 failures, every single run.**

Read the new mechanism (confirm-token.test.ts's fixed test): it now decodes the token's base64url blob to
raw bytes, XORs the LAST byte (inside the 16-byte GCM tag) with `0xff`, and re-encodes — no longer a
post-encoding base64 CHARACTER flip. Verified by execution, not just read, that this is unconditionally
deterministic regardless of blob length:
- `b XOR 0xFF != b` for **all 256 possible byte values** (exhaustive check, a byte can never equal its own
  bitwise complement) — so the byte-level change is always real.
- Round-tripped a XOR'd-last-byte buffer through `Buffer.toString("base64url")` -> `Buffer.from(..., 
  "base64url")` for **121 different blob lengths (20 to 140 bytes, spanning all three `length % 3` classes** 
  that caused the OLD bug): in every case the re-decoded bytes exactly equal the tampered buffer (never the
  original) — i.e., there is no "discarded bits" ambiguity at all when a full byte buffer is what gets
  encoded, unlike flipping one already-encoded character. This is why the fix is genuinely length-independent,
  not just lucky for today's specific 106-byte blob.
- Also reconfirmed by direct arithmetic that HEAD's blob (90 bytes) was `%3==0` and this diff's blob (106
  bytes) is `%3==1` — the exact split that caused the original ~25% flake — but since the NEW technique never
  relies on base64 character alignment at all, this split is now irrelevant to it.

### (2) Still catches real tampering — CONFIRMED by my own independent mutation, restored with sha256 proof

Read C's own mutation (catch-block returns a fabricated `{ok:true,...}` directly). For independent
verification I constructed a **different** mutation myself (not copy-pasting C's): changed
`verifyConfirmToken`'s catch block so that, on a GCM auth-tag failure, instead of returning
`{ok:false,reason:"tampered"}` it **fabricates a plausible plaintext JSON string and falls through** as if
decryption had actually succeeded (simulates "the auth check fired but was ignored" rather than C's "the
check plainly returned success").
- sha256 before: `6ca676ebe7a0aeddb57168f5c5e5860a03db97b2e598ae90e3f0063b51675fa4`.
- Ran confirm-token.test.ts: **5 tests went red — 30/35 passed** — the exact same 5 as C reported: the just-
  fixed ciphertext/tag-region test (first in the list), the IV-region flip, the IV-swap test, the
  wrong-secret test, and the dedicated priorEmail-region midpoint-flip test. Confirms the fixed test is
  genuinely load-bearing (still depends on real GCM authentication), not vacuously green.
- Restored the exact original catch block. sha256 after: `6ca676ebe7a0aeddb57168f5c5e5860a03db97b2e598ae90e3f0063b51675fa4`
  — **identical**, confirmed by both `certutil` and PowerShell `Get-FileHash` (two independent tools, both
  produced the same 64-hex-char digest, case difference only). Line endings unchanged
  (`git ls-files --eol`: still `w/lf`). Ran the file once more post-restore: 35/35 passed clean.

### (3) Tripwire pins exactly the round-trip case, with the ruled comment — CONFIRMED

Read the new route.test.ts test in full. It reconstructs precisely the scenario this reviewer's round-1 probe
proved: mint A while nothing is stored (`priorEmail=""`) -> mint+confirm B -> simulate the field being
cleared via PUT (`digest_email: ""`, proven independently in round 1 by reading
`web/src/app/api/profile/route.ts:296-327` to be an always-unconditionally-permitted write) -> click the old,
never-superseded-by-value A link -> asserts `digest_email_confirmed=1` AND `mocks.upsert` was called with
`{user_id:"user-1", digest_email:"a@example.test"}` — i.e. it pins the WRITE actually happening, the exact
accepted-cost behavior, not a weaker or different case. The test's inline comment reads verbatim: "accepted
cost, §1bn.7b — pins today's behaviour so a change is a conscious decision" — matches the ruling's required
"comment naming this ruling" and C's own round-2 plan word for word. Ran in isolation: **PASS** (confirmed
above in the route.test.ts 31/31 run).

### (4) No other test changed strength — CONFIRMED

Full diff re-read end to end (both test files). Outside the two authorized changes (the deterministic tamper
mechanism; the one new tripwire test), every other test in both files is textually unchanged from round 1
(same `priorEmail` argument threading already reviewed and passed round 1). No assertion was loosened,
removed, or altered in scope.

### (5) Gates — all 4, from web/, one at a time

- `npx vitest run` (full suite): **291 passed | 3 skipped (294 files) / 5570 passed | 6 skipped, 0 failed** —
  run twice back-to-back, identical both times. (Round 1 baseline for this item's own tests was 5569; +1 for
  the new tripwire, 0 regressions.) Combined with the 30/30 isolated confirm-token.test.ts runs above, the
  HIGH flakiness finding from round 1 is resolved, not just luckily absent.
- `npx tsc --noEmit`: 0 errors (no output).
- `npx eslint .`: **0 errors / 151 warnings** — same warning set as baseline, no new warnings.
- `npm run build`: **succeeded on the first attempt** (exit clean, full "Route (app)" table incl.
  `/api/profile/confirm-email`, same pre-existing unrelated Turbopack NFT-trace warning on `pdf-text.ts`) —
  no font-fetch failure this run, so no retry was needed. (C's checkpoint separately reported one transient,
  diff-unrelated font-fetch failure on their first attempt, then two clean reproductions — consistent with
  ordinary network flakiness in a step this diff never touches; not reproduced on my run, nothing to reconcile.)

### (6) Privacy — CONFIRMED clean

Searched (patterns only, described in words, nothing sensitive printed): every email-shaped string in the
current full diff — all still on reserved documentation domains (example.com/.test), identical set to round
1, no new addresses introduced by round 2's changes; a direct search for the user's real email address across
all six changed files and the C checkpoint's round-2 section — zero matches; a search for secret/key-shaped
long strings introduced by round 2 — none found (the only "new" string of that shape is the test's own
fabricated `"mutated@example.com"` placeholder used transiently in my own restored mutation, not committed
anywhere). No real secret read, printed, or used; `.env`/`.env.local` never opened.

### Repo cleanliness

`git status --porcelain` (excluding node_modules) at the end: only the same 6 product/test files + the
pre-existing `ABC-JEV-INTEGRATION.md` modification (not touched by me) + the three pre-existing/own
EMAIL-TOKEN-REPLAY docs. No mutation residue, no stray probe files, no commit/push/stash/branch operation.

### RE-CHECK VERDICT

**VERIFIED.**

Both of round 1's blocking/flagged items are resolved by binding ruling + execution-confirmed fix:
- §1bn.7a (HIGH, flaky tamper test): fixed with a provably length-independent, deterministic mechanism;
  30/30 isolated runs clean, exhaustive arithmetic proof across 121 blob lengths and all 256 byte values,
  and my own independently-constructed mutation reproduces C's exact "still load-bearing" result, cleanly
  restored (sha256-verified via two tools).
- §1bn.7b (round-trip bypass): the manager reclassified this from a review finding to an ACCEPTED COST,
  conditioned on exactly one tripwire test pinning today's behavior with a ruling-referencing comment — C
  delivered exactly that, verified to pin the correct scenario with the exact required comment.
- §1bn.7c (TOCTOU race): explicitly a lead, correctly left untouched.

All 4 gates pass cleanly (vitest 5570/0 failed x2, tsc 0, eslint 0/151, build OK on first attempt); no other
test's assertion changed strength; privacy clean; repo left clean.

Report path: docs/jev-abc/EMAIL-TOKEN-REPLAY-A-20260930T063542Z.md (this file).
