STATUS: VERIFIED

# EMAIL-TOKEN-PRIVACY — Agent A Independent Review

Branch: Jev-integration-and-sorting-filtering-enhancement, HEAD 79347013 (change under review is UNCOMMITTED).
Reviewer: Agent A. Started 2026-09-28T23:07:26Z.

Inputs read: ABC-JEV-INTEGRATION.md §1as (binding rulings), docs/jev-abc/EMAIL-TOKEN-PRIVACY-B-20260928T220245Z.md (guide), docs/jev-abc/EMAIL-TOKEN-PRIVACY-C-20260928T224725Z.md (C checkpoint). Note: `git status` also shows ABC-JEV-INTEGRATION.md itself as modified (untracked-diff, 2 lines) — this is the manager's state file, not part of C's implementation; not reviewed as "the change" but noted for the privacy sweep.

## Check 1 — crypto primitives (AES-256-GCM, HKDF, IV, tag verification, expiry/uid order, no 2nd HMAC, no new dep, no DB change)

VERIFIED. Read web/src/lib/email/confirm-token.ts in full.
- `createCipheriv("aes-256-gcm", key, iv)` / `createDecipheriv("aes-256-gcm", key, iv)` — L142, L201. Correct algorithm.
- Key: `hkdfSync("sha256", Buffer.from(secret,"utf8"), Buffer.alloc(0), HKDF_CONTEXT_LABEL, 32)` — L105-111, fixed label `"peer:digest-email-confirm:v2"` (L91), 32 bytes = AES-256 key size.
- IV: `randomBytes(IV_LENGTH)` with `IV_LENGTH = 12` (96-bit, GCM standard) — L92, L141, fresh per call (no memoization/caching).
- Tag verified: `decipher.setAuthTag(tag)` called BEFORE `decipher.update()`/`.final()` (L201-203) — correct Node order; any failure (bad tag, wrong secret, swapped IV) throws, caught and returned as `{ok:false, reason:"tampered"}` (L204-209) BEFORE JSON.parse ever runs.
- Expiry/uid checked only after decrypt succeeds AND shape-checked (L211-230) — order matches the ruling ("checked after decryption").
- No second HMAC anywhere in the file (grepped — only `createCipheriv`/`createDecipheriv`, no `createHmac`).
- No new dependency: only `node:crypto` (built-in), already imported by the old version.
- No DB change: confirmed — this module has no DB calls; `confirm-email/route.ts`'s DB calls (upsert `profiles.digest_email`) are unchanged from before.
Token shape matches the ruling's literal text ("version prefix + base64url(iv | ciphertext | tag)" — ONE blob): `` `${TOKEN_VERSION_PREFIX}${blob.toString("base64url")}` `` where `blob = iv|ciphertext|tag` concatenated (L148-149), not the guide's 3-segment sketch. C recorded this as a deliberate deviation from the guide (not the ruling) — confirmed correct: the ruling's own text is the one-blob shape, so this is not a deviation from binding law, just from B's illustrative sketch.

## Check 2 — legacy/garbage tokens land on honest "expired or invalid" state

VERIFIED by reading (live HTTP checks pending — see check 9).
- `verifyConfirmToken` rejects ANY token not starting with `"v2."` as `{ok:false, reason:"malformed"}` (confirm-token.ts L182-184) — this catches both a legacy-shaped token (old base64url-JSON+HMAC never starts with "v2.") and pure garbage uniformly, with no dual-format parser (matches ruling point 2: "no readable-address parser is kept").
- `confirm-email/route.ts` GET (L250-255): `if (!result.ok) return profileRedirect(req, "digest_email_confirm=invalid_link")` — malformed/tampered/expired ALL collapse to the same `invalid_link` redirect. No branch distinguishes them to the reader.
- Client (`web/src/app/profile/page.tsx` L1592-1597): `invalid_link` maps to the message "That confirmation link didn't work. Request a new one." — this is the honest generic message, not a crash, not an address.
- No crash path: confirm-token.test.ts explicitly tests `expect(() => verifyConfirmToken(...)).not.toThrow()` for garbage base64url input (L239-241) and for a tampered legacy token (L287).

## Check 7 — Mutations (done early, out of numeric order, since it needed dedicated focus)

All 6 required mutations performed on the real files, run against the narrowest relevant test file, confirmed RED, reverted by editing back, restore proven by SHA-256 hash match against a pre-mutation baseline hash. None BLOCKED — the permission system allowed every edit/command.

| # | Mutation | File | Result | Restore hash match |
|---|---|---|---|---|
| 1 | `signConfirmToken` skips encryption, returns plain base64url(JSON) | confirm-token.ts | RED — 6/28 tests failed (all round-trip tests; `verifyConfirmToken`'s real AES-GCM tag check rejects the non-ciphertext blob) | Confirmed (`780e6201...` both before/after) |
| 2 | Hardcoded IV (`Buffer.alloc(12,7)`) instead of `randomBytes(12)` | confirm-token.ts | RED — 1/28 ("fresh random IV per call" uniqueness test: `first` === `second`) | Confirmed |
| 3 | Bypass GCM auth-tag check (stub `setAuthTag`, drop `.final()`) | confirm-token.ts | RED — 4/28 (IV-tamper, IV-swap, wrong-secret tests: tampered input now decrypts into garbage instead of throwing) | Confirmed |
| 4 | Accept legacy-shaped tokens (`!startsWith("v2.")` → `ok:true`) instead of malformed | confirm-token.ts | RED — 4/28 (both legacy tests + 2 malformed-prefix tests) | Confirmed; 28/28 pass after revert |
| 5 | Raw provider error text added back into dispatch-digests JSON response | dispatch-digests/route.ts | RED — 1/22 ("never appears in the JSON response" test caught `owner@example.test` verbatim in `JSON.stringify(body)`) | Confirmed (`f6d888de...`); 64/64 pass across all 3 dependent suites after revert |
| 6 | Workflow reverted to `jq . body.json \|\| cat body.json` | .github/workflows/digest-cron.yml | RED — 3/6 (`digest-cron-workflow.test.ts`: whole-body-print check, filter-count check, dispatch-filter-shape check) | Confirmed (`f10f08d3...`); 6/6 pass after revert |

Every mutation independently proves the test suite would catch a regression in that specific property. No mutation was silently absorbed (i.e., every one turned at least one test red, several turned multiple). No mutation was BLOCKED — the permission system allowed every edit and every test command.

## Check 3 — no address anywhere on the path (re-walked myself, not trusting C)

VERIFIED. Read (in full, independently): confirm-token.ts, confirm-email/route.ts, confirm-email-template.ts, dispatch-digests/route.ts, prepare-dashboards/route.ts, digest-cron.yml, send-failure.ts, digest-retry.ts; grepped send-test-email/route.ts and api/profile/route.ts (unchanged, not in the diff).
- Token creation (confirm-token.ts): ciphertext only, no address recoverable without the secret (proven structurally by check 1, proven empirically by mutation 1).
- The email's link (confirm-email-template.ts L86, L94, plaintext L50): embeds `confirmUrl` — now an opaque "v2." blob, no address inside it. Unchanged file, correctly not touched (the leak was entirely in the token's encoding, never in the template).
- The GET (`confirm-email/route.ts` L229): reads `token` only, never decodes/logs it before verification.
- The redirects (`profileRedirect`, 7 call sites): grepped every literal query string — `signin_required`, `invalid_link` (×3 sites), `unavailable`, `wrong_account`, `digest_email_confirmed=1`. None contains "@". Confirmed both by reading the source and by the new regression test (`route.test.ts`'s allow-list scan, which itself passes: `npx vitest run` confirmed clean, see check 8).
- `send-test-email` (P9, guide) and `api/profile/route.ts` (P10/P11, guide): grepped `console\.` — only one call in send-test-email (L221), unchanged, already routes through `describeSendFailureForLog` per B's prior finding; zero in api/profile/route.ts. Neither is part of this diff, so B's original clean verdict stands, independently re-confirmed by my own grep rather than re-trusting the text.
- Every `console.*` call in the CHANGED files: exactly 2 — `confirm-email/route.ts` L209 (`describeSendFailureForLog`, redacted) and `dispatch-digests/route.ts` L63 (`logJobIssue`, wraps `redactEmailAddresses`). `prepare-dashboards/route.ts` and `confirm-token.ts` have **zero** direct console calls of their own (`grep -n "console\." ...` on each returns nothing) — every log line in prepare-dashboards goes through the imported `logJobIssue`, confirmed by grep, not assumed.
- Generated token itself: confirm-token.test.ts's dedicated test (L148-165) asserts the token (and its `encodeURIComponent` form) contains none of: raw address, `encodeURIComponent(address)`, local-part, domain, `base64`, `base64url` of the address — 28/28 pass (check 8).

## Check 4 — job responses: counts + fixed codes only, no raw text, no per-reader user_id lists; judge the digest-retry.ts deviation

VERIFIED, with one accepted (compliant) precision trade-off.
- `dispatch-digests/route.ts` final response object (L558-573): `ran_at`, 3×`*_count` + `*_reasons` (Record<code,number>) pairs, `emails_sent_count`. No array of `{user_id,...}` anywhere — confirmed by reading and by mutation 5 (adding one raw-text field back turned a test red immediately).
- `prepare-dashboards/route.ts`'s `PrepareCyclePhaseReport` (L126-145): same shape — counts/tallies/enum fields only. `report.prepare.error`/`.drain_error` (and the outer catch's `admin_unavailable` `error`) are single orchestration-crash strings (Supabase/RPC/config failures), explicitly out of this ruling's scope per its own text ("no raw provider error text" = the email provider, Resend; "no per-reader user_id lists") — not per-reader, not email-provider text. Structurally still safe: the workflow's own jq filter for the prepare job (see check 5) does not select `error`/`drain_error` at all, so even though the route's raw JSON response could carry a DB/RPC message, nothing derived from it reaches the public log.
- **digest-retry.ts deviation, judged:** `ConflictOutcome`'s `{kind:"failed", error: string}` shape carries no `errorCode`. Both callers (`dispatch-digests/route.ts` L477, `prepare-dashboards/route.ts` L358) call `classifySendFailure({error: outcome.error})` — since `errorCode` is `undefined`, `classifySendFailure` (send-failure.ts L42: `if (result.errorCode !== "validation_error") return "send_failed"`) always returns the generic `"send_failed"`, never the more specific `"sender_not_verified"`, for this one retry path. **Ruling text requires "counts and fixed reason codes only — no raw provider error text and no per-reader user_id lists."** A generic-but-fixed code satisfies this literally: still a closed vocabulary, still zero raw text in the response (the raw `outcome.error` only reaches `logJobIssue`, which redacts it — verified at both call sites). Verdict: **compliant**, not a privacy defect — rated LOW/informational: a real but minor loss of operational precision (an operator reading the public counts-only summary can't tell "sender not verified" from "generic failure" for a retried send specifically; the same operator CAN still get the fully-redacted detail from the private server log). C flagged this transparently rather than silently deciding it.

## Check 5 — workflow prints counts only, on success AND failure paths

VERIFIED for the current file (read in full + mutation-tested, see check 7 mutation 6). Both jobs' `if [ -s <file> ]; then jq -c '{...}' ... fi` block runs BEFORE the `if [ "${status}" != "200" ]` failure check, so a non-200 response still only gets the counts-only summary treatment — never the full body — on both success and failure. The `|| echo "(summary unavailable)"` fallback is a fixed string, not the body. No `cat` of either body file anywhere in the file (grepped).
**MEDIUM finding — see ranked findings below:** the prepare job's jq filter is not the only reference for what's "safe" — the dispatch job's own regression test (`digest-cron-workflow.test.ts` L71) explicitly asserts the dispatch filter excludes the substring `".error"`; the equivalent assertion for the **prepare** job's filter (L76-93) is missing — it checks required fields are present and that `"_reasons"`/`"user_id"` are absent, but never checks for `"error"` or `"drain_error"`. Today's actual filter is clean (verified by reading: `{enabled, due_checked, enqueued, enqueue_failed_count, skipped_count, drained, stopped_reason, backlog_likely_remaining}` / `{enabled, candidates_checked, sent_count, failed_count, skipped_count}` — neither lists `error` or `drain_error`), so this is not a live leak, but the regression guard for this specific field is asymmetric between the two jobs and weaker than C's checkpoint claims (see finding).

## Check 6 — tests: none deleted/weakened; comment coverage

Test-count comparison (HEAD vs. working tree, `grep -c '  it('` per file — see raw counts below): every file is flat or grew, **none shrank**:
| File | HEAD | Now |
|---|---|---|
| confirm-token.test.ts | 17 | 28 |
| confirm-email/route.test.ts | 22 | 24 |
| dispatch-digests/route.test.ts | 18 | 22 |
| dispatch-digests/idempotency.test.ts | 18 | 18 |
| prepare-dashboards/route.test.ts | 19 | 20 |

Matches C's own claimed deltas exactly (+11/+2/+4/+0/+1). Read every diff hunk for all 5 files: every rewritten assertion checks equivalent-or-stronger content (array-of-objects → count/tally covering the same fact, frequently with an ADDED `not.toContain(rawText)`/`not.toHaveProperty` check) — no weakening found anywhere.
**LOW finding:** the brief's own instruction ("every rewritten assertion is... commented EMAIL-TOKEN-PRIVACY") is not fully true. Occurrence counts of the literal string "EMAIL-TOKEN-PRIVACY" per file: idempotency.test.ts=2, dispatch-digests/route.test.ts=4, prepare-dashboards/route.test.ts=3, confirm-email/route.test.ts=3, confirm-token.test.ts=6 — against far more rewritten sites in each (e.g. idempotency.test.ts alone has at least 8 distinct rewritten `expect(body.skipped/failed/emails_sent...)` sites, only 2 carry the marker comment). The substance is fine (no weakening, contract genuinely changed at every site), but traceability is inconsistent — most purely-mechanical shape conversions (array → count) were left uncommented, while sites with a subtler point (raw text now absent, generic-code-not-specific-code) got the marker.

## Check 8 — full gates from web/

All four match C's reported numbers exactly, independently re-run by me just now:
- `npx vitest run` → **280 files passed + 3 skipped (283) / 5106 tests passed + 6 skipped (5112) / 0 failed.**
- `npx tsc --noEmit` → **exit 0.**
- `npx eslint .` → **0 errors / 151 warnings.**
- `npm run build` → **"✓ Compiled successfully in 6.8s"**, all routes listed incl. `/api/jobs/dispatch-digests`, `/api/jobs/prepare-dashboards`, `/api/profile/confirm-email`.

## Check 9 — reality check, local dev server (never started/stopped/restarted; confirmed already running: `GET /` → 200)

2 of the allowed ≤3 signed-out requests used (headers-only, no body dumped, no cookies sent):
1. `GET /api/profile/confirm-email?token=<legacy-shaped-but-unsigned-token>` → `HTTP/1.1 307`, `location: http://localhost:3000/profile?digest_email_confirm=signin_required`.
2. `GET /api/profile/confirm-email?token=<garbage>` → identical: `HTTP/1.1 307`, same `location`.
Both match the code exactly: `GET`'s FIRST check is `if (!user) return profileRedirect(..., "signin_required")` — signed-out short-circuits before the token is ever parsed, for ANY token content. No crash, no token/address echoed in the `Location` header either time. This also confirms the realistic path a reader hits when clicking a confirmation link in a fresh/incognito browser tab: they see "Sign in, then open the link again" (client-side message, `profile/page.tsx` L1593), never token content, never a stack trace. (The malformed/tampered/expired-specific "invalid_link" branch is downstream of the auth check and could only be reached signed-in, which I did not do — prohibited action; that branch's behavior is instead verified by static reading, check 2, and by confirm-token.test.ts's direct unit coverage of `verifyConfirmToken`, check 8.)

## Check 10 — privacy sweep (changed + new files, including this review)

Swept every changed/new file (10 diffed + 2 new + this review) plus ABC-JEV-INTEGRATION.md for three categories of personal string: the user's real email address, the user's real name and OS/git-account identifiers, and absolute `C:\Users\...`/scratchpad paths. **Zero matches on all three sweeps** (`grep -niE` exit code 1 = no match, for every pattern). No `.env`/`.env.local` file was opened by me at any point. No real secret or real address appears anywhere I read or wrote. Test fixtures use only `@example.com`/`@example.test` (RFC 2606 reserved, not real domains) — consistent with the standing constraint.

---

## Ranked findings

**MEDIUM — prepare job's workflow regression test doesn't guard `error`/`drain_error` fields (check 5).** `digest-cron-workflow.test.ts`'s dispatch-job test explicitly forbids the substring `".error"` in that job's jq filter (L71); the prepare-job test (L76-93) checks required fields present and `"_reasons"`/`"user_id"` absent, but has no equivalent check for `"error"`/`"drain_error"`. Today's shipped `.github/workflows/digest-cron.yml` prepare filter is clean (verified by direct reading — neither field is selected), so nothing leaks right now. But `PrepareCyclePhaseReport.error`/`.drain_error` are real fields on the route's response carrying free-text Supabase/RPC messages, and C's checkpoint claims the workflow test pins "the exact field lists present/absent" for both jobs — that claim is not accurate for this one dimension on the prepare job. A future edit adding `error`/`drain_error` to the prepare job's jq filter (a plausible, easy mistake — "let's also show the crash reason") would silently start printing free-text error strings into the now-public GitHub Actions log every hour, and nothing in this test suite would catch it. Fix is small: add `expect(prepareFilter).not.toContain(".error")` / `.not.toContain("drain_error")` mirroring the dispatch job's own pattern.

**LOW — inconsistent "EMAIL-TOKEN-PRIVACY" comment coverage on rewritten test assertions (check 6).** Substance is fine (no test weakened; every rewrite is a real, equivalent-or-stronger contract change — verified by reading every diff hunk in all 5 modified test files). But the brief's traceability instruction ("every rewritten assertion is... commented EMAIL-TOKEN-PRIVACY") isn't fully met: most purely-mechanical array→count/tally conversions carry no marker comment at all (e.g. idempotency.test.ts has ≥8 rewritten sites, only 2 commented). Cosmetic/traceability only.

**LOW / informational — digest-retry.ts retry-path failures always classify to the generic `send_failed` code, never `sender_not_verified` (check 4).** C's own declared, transparent deviation. Fully ruling-compliant (fixed code, zero raw text in the response; the private server log still gets the full redacted detail via `logJobIssue`). Costs only operational precision on the public counts summary for one specific retry path, nothing privacy-relevant.

No HIGH findings. Every crypto property, every legacy/garbage-token path, every job-response shape, and the workflow's current print behavior were independently verified — by direct reading, by 6/6 mutation tests that each turned at least one test red and were then hash-verified restored, by an independent full run of all four gates (numbers match C exactly), and by 2 live signed-out HTTP requests against the running dev server that matched the code exactly.

STATUS: VERIFIED


