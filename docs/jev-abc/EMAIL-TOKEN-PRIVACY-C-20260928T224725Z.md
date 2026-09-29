STATUS: IMPLEMENTED_PENDING_REVIEW

# EMAIL-TOKEN-PRIVACY — C checkpoint (implementer)

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD `c4a83362`. Role: C
(implementer) per `ABC-JEV-INTEGRATION.md` §1as — implementing the rulings, not
re-deciding them. Only writer right now (SENSE-CONTEXT's A2 fix-round finished and
committed before this started, per the brief's process note).

Binding inputs read: `ABC-JEV-INTEGRATION.md` §1as (rulings — this item's law), the
guide `docs/jev-abc/EMAIL-TOKEN-PRIVACY-B-20260928T220245Z.md` (path table §1, design
§3, test plan §4), `web/AGENTS.md` (+ read `web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
— this Next version (16.2.3) changes nothing relevant to this item's edits: no route
signatures change, only response-body construction and one library module's internals).

## Plan (written before any edit)

### Files to change

1. **web/src/lib/email/confirm-token.ts** — replace base64url(JSON)+HMAC with
   AES-256-GCM. Key = `hkdfSync("sha256", secret, "", "peer:digest-email-confirm:v2", 32)`.
   Fresh `randomBytes(12)` IV per token. Token = `"v2." + base64url(iv | ciphertext | tag)`
   — ONE opaque blob, no second segment. Verify: reject anything not starting with
   `"v2."` as malformed (this is also how a legacy token is rejected — no dual-format
   parser, per ruling point 2); decode, structural length check (>= 28 bytes) before
   ever touching crypto; `createDecipheriv` + `setAuthTag` + `update`/`final` in a
   try/catch — any throw = "tampered" (GCM's tag check *is* the integrity check, no
   separate HMAC, per ruling point 1/POLICY 2); then JSON-shape-check the decrypted
   claims (malformed if wrong shape — reachable only via a test that encrypts a bad
   shape with the real key, since an attacker without the key cannot construct a
   validly-authenticated ciphertext at all); then expiry. `signConfirmToken`/
   `verifyConfirmToken`'s function signatures are UNCHANGED (same params/order), so
   every caller (confirm-email/route.ts, its tests) keeps compiling and working
   unchanged. `normalizeEmailAddress`/`isValidEmailFormat`/`getConfirmSecret`/
   `CONFIRM_TOKEN_TTL_MS` untouched.

2. **web/src/app/api/profile/confirm-email/route.ts** — verified by reading: NO change
   needed. It already builds `confirmUrl` from the opaque `token` string only (no
   address anywhere), and every `profileRedirect` call already uses a fixed query key
   (`digest_email_confirm=<code>` / `digest_email_confirmed=1`), never the address.
   The leak was entirely inside the token's own encoding (fixed in confirm-token.ts
   above), not in this route's control flow. This will be double-checked with a new
   regression test (item 4 below) rather than asserted from memory.

3. **web/src/lib/email/send-failure.ts** — reused as-is (its exports already do
   exactly what's needed: `classifySendFailure`, `describeSendFailureForLog`,
   `redactEmailAddresses`). No source change planned. `web/src/lib/email/digest-retry.ts`
   likewise left untouched — `ConflictOutcome`'s "failed" branch has no `errorCode`
   field, so classifying it through `classifySendFailure({error: outcome.error})`
   (errorCode undefined) always yields the generic `"send_failed"` fixed code, never
   `"sender_not_verified"` specifically for a *retried* send. Accepted: still a fixed,
   safe code, and avoids widening a shared module with no dedicated test file outside
   its two callers' own suites. Flagged here rather than silently decided.

4. **web/src/app/api/jobs/dispatch-digests/route.ts** — response reshape. Ruling text:
   "responses carry counts and fixed reason codes only — no raw provider error text
   and no per-reader user_id lists; per-reader detail goes to the server log (private),
   redacted with the existing POLISH-1 helpers." Concretely: remove `dispatched`,
   `skipped`, `failed`, `emails_sent`, `emails_failed` arrays; keep/extend the
   `*_count` fields already present; add `skipped_reasons`, `failed_reasons`,
   `emails_failed_reasons` as `Record<fixed_code, number>` tallies (same shape
   convention `prepare-dashboards/route.ts`'s drain phase already uses for
   `outcomes`). Fixed vocabularies (every free-text/dynamic reason mapped at its push
   site):
   - skip: `hour_mismatch`, `frequency_skip`, `intent_required` (unchanged),
     `recent_delivery`, `already_claimed`, `already_sent`, `retry_expired`,
     `retry_in_progress`.
   - failed: `local_date_unavailable` (unchanged), `claim_error`, `insert_error`,
     `pipeline_error` — each of these previously carried a raw DB/exception message;
     that raw text moves to a `console.warn` line (private server log), redacted via
     `redactEmailAddresses`.
   - emails_failed: `classifySendFailure(result)` output (`sender_not_verified` |
     `send_failed`) plus `no_email` (no address on file at all). Raw provider text
     moves to `console.warn` via `describeSendFailureForLog(result)` (matches the
     existing POLISH-1-EMAIL convention verbatim).
   Top-level orchestration fields NOT touched: none exist here (dispatch-digests has
   no single "did the whole run crash" field distinct from per-row failures).

5. **web/src/app/api/jobs/prepare-dashboards/route.ts** — same pattern applied to
   `PrepareCyclePhaseReport`: `enqueue_failed`, phase-1 `skipped`, phase-3 `sent`,
   `failed`, `skipped` arrays all become counts + fixed-code tallies. Phase 2's own
   `outcomes: Record<string, number>` is ALREADY compliant (no user_id anywhere) —
   left untouched. Phase-1 skip reasons (`due-owners.ts`'s `isOwnerDueForPrepare`)
   are already a closed union (`timezone_unresolved` | `outside_window`) — already
   fixed codes, just move from a `{user_id,reason}[]` array into a tally. Top-level
   `report.prepare.error` / `report.prepare.drain_error` / the outer catch's
   `report.*.error` are single orchestration-crash messages, not per-reader, not
   email-provider text (Supabase/RPC errors) — left AS IS (unaffected by this
   ruling's "no per-reader user_id list" / "no raw PROVIDER [email] error text"
   clauses; changing them would be scope creep against unrelated, already-passing
   tests).

6. **.github/workflows/digest-cron.yml** — both jobs replace `jq . body.json || cat
   body.json` with a counts-only summary: parse just the `*_count` fields (and
   `prepare`/`email_retry` sub-object counts for the second job) with `jq` into a
   one-line `echo`, never print the full body. Keep the existing `set -euo pipefail`,
   secret check, and non-200 failure behaviour unchanged.

### Tests (rewriting existing assertions whose contract changed; adding the guide's §4 cases)

- `confirm-token.test.ts`: full rewrite. Keep every EXISTING behavioural guarantee
  (round trip, re-use, tamper rejected, expiry, TTL boundary, malformed input, default
  TTL) reworded for the new format; the one test that forged a validly-HMAC-signed
  bad-shape payload is reimplemented using the same AES-GCM primitives (local test
  helper, same pattern the old file used for HMAC) so the "decrypt succeeds but shape
  is wrong -> malformed" path stays covered. ADD: tamper-IV-specifically, tamper-tag-
  specifically, truncated/too-short blob, legacy-format (old HMAC scheme) token
  rejected (tampered or not, both collapse to "malformed" now — no dual-parser to
  protect separately), IV uniqueness across two mints of the same input, no-address-
  substring-in-token (plain/base64/base64url/local-part/domain).
- `confirm-email/route.test.ts`: NO existing assertion changes needed (verified above
  — the route's contract didn't change). ADD: redirect query allow-list regression
  test (source-text scan: every `profileRedirect(req, "...")` literal matches a fixed
  set of keys, never contains "@").
- `dispatch-digests/route.test.ts` + `idempotency.test.ts`: rewrite every assertion
  that reads `body.dispatched`/`.skipped`/`.failed`/`.emails_sent`/`.emails_failed` as
  an array to instead check the new `*_count` number and, where the test's point is
  specifically about WHICH reason fired, the new `*_reasons` tally. ADD: a mocked
  Resend failure containing a fake address never appears in the JSON response
  (checks `JSON.stringify(body)` for the fake address substring), a claim/insert DB
  error message never appears in the response either.
- `prepare-dashboards/route.test.ts`: same treatment for `enqueue_failed`/`skipped`/
  `sent`/`failed`.
- New `digest-cron-workflow.test.ts` (under `web/src/app/api/jobs/`): reads the YAML
  file as text (`path.join(process.cwd(), "..", ".github/workflows/digest-cron.yml")`,
  since vitest's cwd is `web/` — confirmed against the existing
  `dispatch-digests/route.test.ts`'s own `process.cwd()` usage) and asserts neither
  job's `run:` step contains `jq . ` piping the WHOLE body or a bare `cat
  /tmp/*.json` fallback that would dump the full response.

### Gates

Baseline (BEFORE any edit) and after, from `web/`: `npx vitest run`, `npx tsc
--noEmit`, `npx eslint .`, `npm run build`. Expected baseline per brief: vitest 282
files (279 + 3 skipped) / 5082 passed + 6 skipped, tsc 0, eslint 0 errors / 151
warnings, build OK.

## Progress log

- **Baseline gates (before any edit), from web/, 2026-09-28T22:48Z–22:5xZ:**
  `npx vitest run` → 279 files passed + 3 skipped (282) / 5082 tests passed + 6
  skipped (5088). `npx tsc --noEmit` → exit 0. `npx eslint .` → 0 errors / 151
  warnings. `npm run build` → compiled successfully, all routes listed incl.
  `/api/jobs/dispatch-digests`, `/api/jobs/prepare-dashboards`,
  `/api/profile/confirm-email`. Matches the brief's expected baseline exactly.
  Proceeding to implement.
- **Step 1 — confirm-token.ts rewritten** (AES-256-GCM, HKDF key, "v2."+blob
  format; no legacy fallback). `confirm-token.test.ts` fully rewritten (28
  tests, all pass) covering round trip, realistic long address + UUID uid,
  re-use, token-format shape, IV uniqueness (two mints of the same input
  differ), no-address-substring-in-token, tamper in ciphertext/tag region,
  tamper in IV region, tampered-IV-swap-same-length, wrong secret, expired,
  TTL boundary, malformed (no prefix, empty, truncated, garbage base64url,
  never throws), decrypt-succeeds-but-bad-shape (proves the post-decrypt
  shape check, using a local test helper that encrypts with the same
  algorithm — an attacker without the secret could never construct this),
  non-JSON plaintext, default TTL, and two "legacy token never accepted"
  tests (well-formed old-HMAC token and a tampered one, both -> malformed,
  never throw). `npx vitest run src/lib/email/confirm-token.test.ts` -> 28/28
  pass.
- **Step 2 — confirm-email/route.ts verified, no source change.** Added two
  regression tests to its existing suite instead: (a) the rendered
  confirmation email's html/text never contains the address in the clear,
  base64, or URL-encoded form; (b) a source-text scan asserting every
  `profileRedirect(req, "...")` call site's literal query string is one of
  the 5 allow-listed keys and never contains "@". `npx vitest run
  src/app/api/profile/confirm-email/route.test.ts` -> 24/24 pass (22
  pre-existing, unchanged, + 2 new) — confirms the route's own contract truly
  did not need to change; the leak was entirely inside the token's encoding.
- **Step 3 — dispatch-digests/route.ts + prepare-dashboards/route.ts reshaped.**
  Every per-reader array (`dispatched`, `skipped`, `failed`, `emails_sent`,
  `emails_failed` in dispatch-digests; `enqueue_failed`, phase-1 `skipped`,
  phase-3 `sent`/`failed`/`skipped` in prepare-dashboards) replaced with
  `*_count` + `*_reasons: Record<fixed_code, number>` tallies (mirrors the
  `outcomes` tally shape `runDrainPhase` already used, which needed no
  change). Fixed codes introduced: `hour_mismatch`, `frequency_skip`,
  `recent_delivery`, `already_claimed`, `already_sent`, `retry_expired`,
  `retry_in_progress`, `retry_skipped_other` (defensive default), `no_email`
  (skip/email-skip side); `local_date_unavailable`, `claim_error`,
  `insert_error`, `pipeline_error`, `enqueue_error`, `retry_error` (failure
  side; raw DB/exception text now goes ONLY to a new private
  `console.warn` line via `logJobIssue`, redacted with
  `send-failure.ts`'s `redactEmailAddresses`); email-send failures reuse
  `classifySendFailure`/`describeSendFailureForLog` unchanged (same as
  POLISH-1-EMAIL). `bumpReason`/`logJobIssue`/`conflictSkipReasonCode`
  exported from dispatch-digests/route.ts and imported by
  prepare-dashboards/route.ts (same cross-file reuse convention this pair of
  files already used for `digestFeedRequestFromProfile` etc.) — no
  duplicated classification logic. `digest-retry.ts` and `send-failure.ts`
  left completely unmodified (see the plan's item 3 note on why
  `ConflictOutcome`'s retry-failure path always classifies to the generic
  `send_failed` code rather than being widened to carry `errorCode`).
  `report.prepare.error`/`.drain_error` (single orchestration-crash
  messages, no user_id, not email-provider text) intentionally left as-is.
  `npx tsc --noEmit` → 0 (only the 3 test files below needed rewriting).
- **Step 4 — all 3 affected test files rewritten** (every stale
  `body.dispatched`/`.skipped`/`.failed`/`.emails_sent`/`.emails_failed` /
  `report.prepare.*`/`report.email_retry.*` array assertion rewritten to the
  new `*_count`/`*_reasons` shape; behavioural intent preserved in every
  case, several now ALSO assert the raw text/address is absent from
  `JSON.stringify(body)`). Added: 4 new tests in dispatch-digests/route.test.ts
  (Resend-sandbox failure -> fixed code + private redacted log line;
  unrecognized failure -> generic code; no-address-on-file -> `no_email`;
  regression guard that the old array keys are structurally ABSENT from the
  response) and 1 in prepare-dashboards/route.test.ts (provider error with a
  fake address never reaches the JSON response). Results: dispatch-digests
  route.test.ts 22/22, idempotency.test.ts 18/18, prepare-dashboards
  route.test.ts 24/24 — all pass.
- **Step 5 — .github/workflows/digest-cron.yml.** Both jobs' `jq . <file>
  2>/dev/null || cat <file>` replaced with a `jq -c '{...named fields...}'`
  one-line counts-only summary (dispatch: the 5 `*_count` fields; prepare:
  `.prepare`'s enabled/due_checked/enqueued/enqueue_failed_count/
  skipped_count/drained/stopped_reason/backlog_likely_remaining and
  `.email_retry`'s enabled/candidates_checked/sent_count/failed_count/
  skipped_count — no `*_reasons` tally, no user_id, no raw error text).
  `set -euo pipefail`, the secret check, and the non-200 -> `exit 1` failure
  behaviour are byte-for-byte unchanged. Validated: parsed with `js-yaml`
  (already a transitive dependency under web/node_modules) — structurally
  valid, both jobs/steps intact. `jq` itself isn't installed in this dev
  environment so the filters weren't executed live; their syntax (object-
  construction shorthand `{a, b}`, the `//` alternative operator) is
  standard jq I'm confident is correct, and a new regression test
  (web/src/app/api/jobs/digest-cron-workflow.test.ts, 6 tests, reads the
  YAML as text — no YAML library needed as a new dependency) pins the
  file's shape: no bare `jq .`/`cat` of either body file, both filters are
  closed field-selections (never `.` or `.[]`), the exact field lists
  present/absent, and the non-200 failure behaviour unchanged. All 6 pass.
- **Step 6 — full gate suite (AFTER), from web/, 2026-09-28T18:0xZ local
  (23:0xZ UTC):** `npx vitest run` -> 280 files passed + 3 skipped (283) /
  5106 tests passed + 6 skipped (5112) (delta vs. baseline: +1 file — the
  new workflow test — and +24 net tests across the rewritten/added suites,
  0 failures). `npx tsc --noEmit` -> exit 0. `npx eslint .` -> 0 errors /
  151 warnings (one transient warning appeared mid-way from an unused
  destructured `domain` in a new test — fixed by not destructuring it;
  final count matches baseline exactly). `npm run build` -> compiled
  successfully, all routes listed incl. `/api/jobs/dispatch-digests`,
  `/api/jobs/prepare-dashboards`, `/api/profile/confirm-email`.
- **Escape-clause check (before declaring done):** grepped every caller of
  `signConfirmToken`/`verifyConfirmToken` — only confirm-email/route.ts
  (already unchanged) and this module's own test file; the other two files
  that import from confirm-token.ts (`api/profile/route.ts`,
  `api/profile/send-test-email/route.ts`) import only
  `normalizeEmailAddress`, untouched by this item. Grepped every reference
  to `DIGEST_EMAIL_CONFIRM_SECRET` — read only inside confirm-token.ts; no
  other use. No database change made or needed. None of the escape
  conditions fired.
- **One implementation-detail deviation from the guide's illustrative
  design, recorded transparently (not a policy escape):** the guide's
  Option A sketch used a two-segment token (`"v2." + base64url(iv) + "." +
  base64url(ct+tag)`); the ruling's own point 1 text says `token = version
  prefix + base64url(iv | ciphertext | tag)` — ONE blob — which is what
  shipped (`"v2." + base64url(iv|ct|tag)`, exactly 2 dot-separated parts
  total, matching the ruling's literal wording over the guide's sketch
  where they differ). Also: `digest-retry.ts`'s `ConflictOutcome` was left
  completely unmodified rather than widening it to carry Resend's
  `errorCode` — its retry-path email failures classify to the generic fixed
  `send_failed` code (via `classifySendFailure({error: outcome.error})`
  with no `errorCode`) rather than the more specific `sender_not_verified`
  a retry could in principle warrant. Still a fixed, safe code; still zero
  raw text in the response. Chosen to avoid touching a shared module with
  no dedicated test file, outside this item's explicitly listed scope.

Done — see STATUS on line 1. Ready for a fresh A.

## Review follow-up (manager relay of docs/jev-abc/EMAIL-TOKEN-PRIVACY-A-20260928T230726Z.md, STATUS: VERIFIED)

A's review VERIFIED the item with one MEDIUM and two LOW findings (no HIGH). Fixed
both actionable ones as the only writer; the third (digest-retry.ts's retry path
classifying to the generic `send_failed` code) was already judged **compliant** by
A itself (check 4) — not a defect, no fix needed, left as is.

**MEDIUM (check 5) — prepare job's workflow regression test didn't guard
`error`/`drain_error`.** `web/src/app/api/jobs/digest-cron-workflow.test.ts`'s
prepare-filter test now also asserts `not.toContain("error")` /
`not.toContain("drain_error")` (bare-substring form — catches a bare `error`
object-shorthand key AND a `.prepare.error`/`.email_retry.error` path expression;
"drain_error" kept as its own explicit check for a reader's clarity even though it's
subsumed by the bare "error" check). **While making this fix I found and fixed a
real bug it exposed:** the `prepareFilter` capture regex (`/jq -c '(\{[\s\S]*?\})'
\/tmp\/prepare-body\.json/`) had no distinctive anchor right after `jq -c '`, so
`.match()`'s first attempt started at the DISPATCH job's own `jq -c '{` (the first
such text in the file) and, since dispatch's own closing (`}' /tmp/body.json`)
doesn't satisfy the "prepare-body.json" suffix, the lazy `[\s\S]*?` was forced to
keep expanding PAST dispatch's filter and every comment line in between, all the
way to the prepare job's true closing quote — silently capturing the ENTIRE
intervening file span (including a `::error::CRON_SECRET...` annotation) as
"the prepare filter". The old, narrower assertions (`_reasons`/`user_id` absent)
happened to still pass against this wrong, oversized string, masking the bug; my
new broader "error" check finally caught it (failed against the CORRECT file with
a `not.toContain` mismatch on unrelated text). Fixed by changing the capture to
`[^']*` (a bash single-quoted argument can never contain a literal `'`, and neither
jq filter here does either, so this reliably stops at the TRUE closing quote of
whichever `jq -c '...'` match attempt is in progress, making the wrong
dispatch-anchored attempt fail cleanly instead of over-matching, and correctly
falling through to the prepare job's own occurrence). Verified the fix captures
exactly the intended filter text (printed via a standalone Node check).
**Proved the guard bites, mutation-tested, hash-verified restore:**
1. Baseline hash of `.github/workflows/digest-cron.yml`:
   `f10f08d3a4759e42e0feba94620c672734be7692f95699911f46b890bc95b9b9` (matches the
   hash A's own review cites for its mutation-6 restore — confirms the file was
   untouched since A reviewed it).
2. Mutated: added `, error` to the prepare job's `.prepare` sub-object field list
   (`{enabled, ..., backlog_likely_remaining, error}`) — exactly the "let's also
   show the crash reason" scenario the finding described.
3. Ran `npx vitest run src/app/api/jobs/digest-cron-workflow.test.ts` — RED: exactly
   1/6 failed (the prepare-filter test), 5/6 still green; failure message showed
   the reintroduced `error` field verbatim, proving the assertion is what caught it.
4. Restored the YAML by editing the line back to its original text.
5. Re-hashed: `f10f08d3a4759e42e0feba94620c672734be7692f95699911f46b890bc95b9b9` —
   **identical to the step-1 baseline**, byte-for-byte restore confirmed.
6. Re-ran the test file: 6/6 green again.

**LOW (check 6) — inconsistent EMAIL-TOKEN-PRIVACY marker-comment coverage.**
Added a marker comment to every mechanically-rewritten (array → count/tally)
assertion site that lacked one, comments only, no assertion logic touched:
`dispatch-digests/idempotency.test.ts` (8 sites), `dispatch-digests/route.test.ts`
(7 sites), `prepare-dashboards/route.test.ts` (5 sites). Sites inside a
describe/it block whose own TITLE already says "EMAIL-TOKEN-PRIVACY" (the 4 new
tests in dispatch-digests/route.test.ts's dedicated describe block, and
prepare-dashboards/route.test.ts's one `it("EMAIL-TOKEN-PRIVACY: ...")` test) were
left as is — already unambiguously traceable via their own name, adding an
identical inline comment immediately below would be pure noise. Marker-comment
counts (`grep -c "EMAIL-TOKEN-PRIVACY"`): dispatch-digests/route.test.ts 4->10,
idempotency.test.ts 2->9, prepare-dashboards/route.test.ts 3->8. Did NOT touch
confirm-token.test.ts (a full-file rewrite for the crypto format, not an
array->count mechanical conversion — the finding's own named category) or
confirm-email/route.test.ts (zero rewritten assertions exist there, verified in
the original C pass — nothing to mark).

**LOW (check 4) — digest-retry.ts generic-code deviation: no fix, already judged
compliant by A.** Left as is; A's own verdict: "compliant, not a privacy defect
... rated LOW/informational". Recorded here only so a later reader sees it was
considered, not missed.

**Gates re-run from web/ after both fixes (comments + 2 new assertions in one
existing test; no build required per the manager's request):**
`npx vitest run` -> 280 files passed + 3 skipped (283) / 5106 tests passed + 6
skipped (5112), 0 failed -- unchanged from the prior AFTER numbers (no new `it()`
blocks were added, only comments and two assertions inside an existing test).
`npx tsc --noEmit` -> exit 0. `npx eslint .` -> 0 errors / 151 warnings -- matches
baseline exactly.

No BLOCKED, no escape. Every standing constraint held: no state-changing git, no
.env* file opened, no external call, dev server untouched, the one temporary
mutation to the workflow file was restored and hash-verified before this section
was written.

STATUS: IMPLEMENTED_PENDING_REVIEW
