# EMAIL-SETTINGS — A checkpoint (reviewer)

STATUS: VERIFIED_OFFLINE_BOUNDED

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD a82ffe54 + uncommitted
C work. Role: A (reviewer) per `ABC-JEV-INTEGRATION.md` §2 — no production edits made
(4 temporary mutations, each restored byte-identically and SHA256-verified below); no
live Resend call; no live DB; no dev server; nothing in `peer-followup` touched or read;
never opened `web/.env` or `web/.env.local`.

## Snapshot — SHA256 (start of review == end of review, unchanged)

```
0fd9bd6de76eca2c9037939a09856e07d68f2cb0a7ee1057aa98cce498f57ea8  web/src/lib/email/confirm-token.ts
f32cd6b9ad8bd68b552a7bda158d6df2821eae3fa0aa8a6e65370aa6241dfb0c  web/src/lib/email/confirm-token.test.ts
e386c4e75292545c3e3a26b76a89148260f2cdce4e24005d42292d794c2e34b4  web/src/lib/email/confirm-email-template.ts
140da034a4250250c3b6bb804ce9440bb1175d03bffc9ea1e7a40d4cf783dbf0  web/src/lib/email/confirm-email-template.test.ts
6ed9c665177aa763cdeb46796fe930b37251a08c7998b7ff0d358d625beda3ad  web/src/app/api/profile/confirm-email/route.ts
88dd81b0f431c5799bd920f48a747116ad8b147ce2850100edf53ce237d6e188  web/src/app/api/profile/confirm-email/route.test.ts
8d6945ff4cd89c496f95253bd9d1ac39c288612374a678505e09f14192e338a9  web/src/app/api/profile/send-test-email/route.ts
6bfc6d3d4f0fc623857b76fe1557a42dc249451c8201ec0ba1b456b1e6c4fada  web/src/app/api/profile/send-test-email/route.test.ts
5782b02c2bb59b174d365424e1fe67f13d76179f14386d0b45bbe2fc49057595  web/src/app/api/profile/route.ts
59c4d6e21d0dd8d7392da33663b09580c8adf23695d19e44a524804bcf12a69c  web/src/app/api/profile/route.test.ts
ddfdbdbce204eab1472b2318f86db35bf7e114c0c8b9ec818c673512cce58864  web/src/app/profile/page.tsx
80e112cc34666fc0462a463033e4f5075835fee7912ff0dbb37873f77e4d5e0b  web/src/app/profile/page.test.tsx
d07aeec27de7a3157ad0b273ef837592944de39862201a789afa6154c290dd60  web/src/lib/usage/counters.ts
04829b639aaba0085a804146ee188bb16c9270da4c26429fe37c069f31f70f38  web/src/lib/usage/counters.test.ts
b0dcb968fd52de36199d14d551e00d98330bf427f9fc6d855cf7a891b6e90078  web/.env.example
5e08c30e0de08b05fc439186a75824734810305578edd6fd916aa060ce2e1a3c  docs/JEV-RELEASE-READINESS.md
```

`git status --porcelain` before and after this review are identical: same 9 modified
paths (`ABC-JEV-INTEGRATION.md`, `docs/JEV-RELEASE-READINESS.md`, `web/.env.example`,
`web/src/app/api/profile/route.{ts,test.ts}`, `web/src/app/profile/page.{tsx,test.tsx}`,
`web/src/lib/usage/counters.{ts,test.ts}`) and same untracked new files (the two
`docs/jev-abc/EMAIL-SETTINGS-{B,C}-*.md` guides, `node_modules/`, the two new route
directories, the two new `confirm-*` lib files + tests).

## Read

- `ABC-JEV-INTEGRATION.md` §1y point 2 (lines 237-243) and §1z (lines 229-236), via Grep.
- `docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md` (guide, all of it).
- `docs/jev-abc/EMAIL-SETTINGS-C-20260926T145833Z.md` (checkpoint, all of it, including
  its 5 declared deviations and its process note about `confirm-email/route.ts` being
  implementation-first).
- Every new/changed production file in full: `confirm-token.ts`, `confirm-email-template.ts`,
  `confirm-email/route.ts`, `send-test-email/route.ts`, `profile/route.ts` (full file + diff
  against HEAD), `profile/page.tsx` (the new `EmailSettings*`/`digestToggleUpdate` section in
  full, plus enough surrounding context to confirm the auth-guard equivalence below),
  `counters.ts` (full file + diff against HEAD), `web/.env.example` (full file).
- Every new/changed test file in full: `confirm-token.test.ts`, `confirm-email-template.test.ts`,
  `confirm-email/route.test.ts`, `send-test-email/route.test.ts`, `profile/route.test.ts`,
  `page.test.tsx`, `counters.test.ts`.
- Supporting reads to verify specific claims: `send-digest.ts`'s `fromAddress()`, `pipeline.ts`'s
  `runFeedPipeline`/tier handling (no `resolveProvider(` call anywhere in that file),
  `spend-scans.test.ts` (all 3 scans relevant here, in full), `use-auth-user.ts`'s `AuthState`
  union, `account-section.tsx`'s guard, `store/profile.ts`'s six `updateDigest*` setters,
  `profile-sync.tsx` (the autosave/diff-PUT path), `dispatch-digests/route.ts`'s own
  digest-address resolution (lines 446-455), and the relevant slices of
  `docs/JEV-RELEASE-READINESS.md` (Part 1 lines 176-263, Part 2 lines 989-1000 and 1191-1334).

## Checks

### 1. Security of sending — PASS

- `send-test-email/route.ts`: destination is always server-resolved (`digest_email` or
  `user.email`), never client-supplied; no request body is even read. Signed-in check is
  first (401 with no session, before any profile read). `aiTier: 0` is hardcoded into the
  `runFeedPipeline` call; `send-test-email/route.test.ts`'s own shape assertion confirms the
  call object has no `systemSearchAllowed` property at all.
- `confirm-email/route.ts`: sends only to the address the *caller's own session* is
  requesting confirmation for; never reaches another user's row (every DB read/write is
  `.eq("user_id", user.id)`).
- Neither new route contains a literal `resolveProvider(` call — confirmed by grepping the
  whole `web/src` for `resolveProvider` (34 hits); the one hit inside `send-test-email/route.ts`
  is inside a `//` comment ("this route never reaches resolveProvider"), not code.
  `pipeline.ts` itself contains no `resolveProvider(` call either — the tier-gated model call
  lives downstream (tier2-rerank), never reached at `aiTier: 0`, matching the pre-existing
  `test-digest` precedent this item explicitly mirrors.
- `spend-scans.test.ts` (scan 4 "no argument-less resolveProvider() call", scan 5 "every
  spending route carries requireEntitledAiRequest, guarded count == 6") is part of the full
  suite and passed; the guarded-route count stayed at exactly 6, meaning the two new routes
  were correctly not flagged as spend-capable (neither matches `canSpend()`'s
  `resolveProvider(`/`GoogleGenAI`/`systemSearchAllowed` patterns).
- No email address is logged anywhere: grepped `confirm-token.ts`, `confirm-email/route.ts`,
  `send-test-email/route.ts`, `profile/route.ts`, and `profile/page.tsx` for
  `console.(log|warn|error|info)` — zero matches in all five files.

### 2. PUT /api/profile guard — PASS

- Confirmed by reading + diff: a `digestEmail` that normalizes to neither the account email
  nor the currently-stored value is rejected `400 { error: "digest_email_requires_confirmation" }`,
  no upsert call made. Mutation-tested (see §10 below) — provably load-bearing.
- C's deviation ("" clearing always allowed) — judged safe, not just asserted safe: traced
  every place that reads `digest_email` afterward.
  - `send-test-email/route.ts`: `digest_email?.trim() || user.email || ""` — empty string is
    falsy, falls back to account email.
  - `confirm-email/route.ts`'s own stored-value check: `existing.value ? normalize(...) : null`
    — an empty string is falsy, so a cleared value normalizes to `null`, not a stray "" that
    could ever accidentally equal a future candidate.
  - **The real scheduled cron** (`dispatch-digests/route.ts`, lines 449-454, pre-existing,
    untouched by this item): `const customEmail = row.digest_email?.trim(); let to = customEmail
    || null; if (!to) { ...fall back to the account's OAuth email via getUserById }` — the
    *exact same* fallback convention, already in production before this item existed.
  - **Answer to "what does the system send to after clearing": the account's own sign-in
    email, on every path that reads the field** (test button, confirmation-request
    short-circuit comparison, and the real scheduled digest) — clearing is not a dangling or
    inconsistent state, it uniformly means "use my account email," which is also the
    already-existing behavior of the one path C did not touch.

### 3. Confirmation token — PASS

- HMAC-SHA256 over a JSON payload of `{uid, email, exp}` (not raw string concatenation —
  no delimiter-ambiguity risk). Verification order is sign-check-before-parse (confirmed by
  reading, and by a dedicated test using a validly-signed-but-malformed payload).
- Tamper / expired / other-user's-token / malformed all confirmed, via both the existing
  test suite and independent mutation testing (§10), to write nothing to the DB.
- Re-use: same token verified twice returns identical `{ok:true,...}` both times (function is
  pure, no single-use state) — tested directly and at the route level (two `GET`s, `upsert`
  called twice, same value both times — a correctness property, not a vulnerability, per the
  manager's own ruling P4).
- `DIGEST_EMAIL_CONFIRM_SECRET` unset: confirming a *different* address returns honest `500`
  (POST) / redirects to `unavailable` (GET), while the account's own email still confirms via
  the short-circuit (tested explicitly for both routes and both methods).
- Not signed in at GET: redirects to `/profile?digest_email_confirm=signin_required`, no read
  or write attempted before the auth check.
- Timing-safe comparison: `timingSafeEqualStrings` guards a length mismatch *before* calling
  `timingSafeEqual` (which throws on differing lengths) — correct, and matches the two
  existing bearer-secret comparisons elsewhere in the codebase this module cites as precedent.

### 4. Rate limits — PASS

- Test email 3/day and confirmation-request 5/day both key through
  `getCounterStore().increment(...)` (i.e. `increment_usage_counter`) and both gate on
  `breakerTripped` — confirmed fail **CLOSED** by reading and by mutation testing (§10):
  an unreachable counter store refuses (429) rather than sending.
- `git diff` on `counters.ts` shows **only two new exported functions added**
  (`testEmailDayKey`, `confirmEmailRequestDayKey`) — zero bytes of any existing function
  (`rateKey`, `underLimit`, `breakerTripped`, `deepReportDayKey`, `deepReportMonthKey`,
  `InMemoryCounterStore`, `SupabaseCounterStore`, `getCounterStore`, etc.) were touched. Every
  existing rate limit's fail-open behavior is provably unaltered by this item.

### 5. Mapping — PASS

- `digestToggleUpdate(true)` → `{channel:"both", frequency:"daily"}`;
  `digestToggleUpdate(false)` → `{channel:"inapp"}` (frequency left alone) — pure function,
  directly tested, matches §1z P5 exactly.
- Send hour: a bounded `<select>` of exactly 24 options (0-23), structurally cannot emit an
  out-of-range value. Time zone: `Intl.DateTimeFormat().resolvedOptions().timeZone`, detected
  once and auto-saved via `updateDigestTimezone`, guarded to only run `if (signedIn)`.
- One well-formed address only: `isValidEmailFormat` tested for missing `@`/dot, whitespace,
  comma-lists, length boundary (254/255). Verified structurally (not just by the given test
  cases) that because **neither** character class in the pattern permits `@`, it is
  mathematically impossible for any string matching the whole anchored pattern to contain a
  second real address, regardless of what separator (comma, semicolon, space) joins them —
  the "one address only" property holds beyond the specific cases the guide asked for.

### 6. UI — PASS

- Signed-out visitors see no controls. Verified this is not merely "the same guard by
  convention" but **the same condition by construction**: `use-auth-user.ts`'s `AuthState`
  union has exactly four members (`unconfigured`, `loading`, `signed-out`, `signed-in`), so
  `signedIn = auth.kind === "signed-in"` (this feature's guard) and
  `auth.kind !== "unconfigured" && auth.kind !== "loading" && auth.kind !== "signed-out"`
  (`AccountSection`'s existing guard) are logically equivalent, not coincidentally similar —
  there is no fifth state (e.g. an error state) that could make them diverge.
  `EmailSettingsView` returns `null` when `!signedIn`, and a test asserts
  `renderToStaticMarkup(...) === ""` (empty output, not just visually hidden).
- Pending-confirmation state, and honest status text for sent / rate-limited / no-address /
  unavailable / couldn't-send, all present and asserted verbatim in `page.test.tsx`.
- Visual language: the new section reuses the same `<section className="mt-8 rounded-2xl
  bg-surface shadow-card ...">` shell, `eyebrow` label class, and the existing `Toggle`
  component, matching `PastBriefings`/`LearnedPreferences` immediately above it.

### 7. Dedupe path untouched — PASS

`git status` confirms zero changes to `dispatch-digests/route.ts` (or its two test files),
`digest-retry.ts`, `send-digest.ts`, `digest-template.ts`, `prepare-due.ts`, `due-owners.ts`,
`prepare-dashboards/route.ts`, `store/profile.ts`, or `profile-sync.tsx`. The full `npx vitest
run` (see §11) passed 100% (0 failed), which includes `dispatch-digests/route.test.ts`'s true-
concurrency case and `idempotency.test.ts` — both green, unchanged.

### 8. Docs — PASS

- `.env.example` documents `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`, `DIGEST_EMAIL_CONFIRM_SECRET`
  by name and purpose only, no values.
- `JEV-RELEASE-READINESS.md` Part 1 (plain language, lines 176-253) states decision #7 as
  built, "nothing changes for anyone until they personally switch it on", the §1z once-per-day
  caveat in the exact required plain-language shape (normal schedule = once a day; a second
  same-day email only via a manual re-trigger or a same-day send-time change, until the
  dedupe migration is applied and its flag is on), and the two-step activation account.
  Grepped Part 1 (lines 19-360) for backticks, `PEER_`/`JEV_`/`OPENALEX_` literals, and
  `.ts`/`.sql` mentions — **zero matches**, i.e. genuinely clean.
- C's deviation 5/6 (Part 2 §1 flag-inventory and §4 secrets-placement tables not updated):
  read both. §4's table was never an exhaustive secrets registry — it already omits
  `CRON_SECRET`, `UNPAYWALL_EMAIL`, `OPENALEX_EMAIL` and others, curated instead to the
  Jev-broker/company-spend secrets relevant to those specific items. §1 is a *flag*
  inventory, and this item introduces no new on/off flag (only new secrets and two new
  routes) — there is nothing that belongs in §1 in the first place. **Judgment: this
  deviation does not leave the document inaccurate**, only non-exhaustive in a way consistent
  with its pre-existing scope.

### 9. The user's local-test section — PASS

- `.env.local` names (`RESEND_API_KEY`, `DIGEST_FROM_EMAIL`, `DIGEST_EMAIL_CONFIRM_SECRET`)
  match exactly what the code reads (confirmed against `confirm-token.ts`'s
  `getConfirmSecret()` and `send-digest.ts`'s `fromAddress()`/`getClient()`).
- Sandbox from-address: C's suggested value `Peer <onboarding@resend.dev>` is **character-for-
  character** `send-digest.ts`'s own built-in fallback when `DIGEST_FROM_EMAIL` is unset —
  confirmed by reading `fromAddress()`. (This makes the line technically redundant for a first
  test, but not wrong — C's checkpoint correctly calls it optional.)
- Optional-ness is correctly stated: `DIGEST_FROM_EMAIL` optional (matches the code's own
  fallback), `DIGEST_EMAIL_CONFIRM_SECRET` optional for the first test (matches the P6
  short-circuit — the account's own email needs no secret).
- Click path matches the UI actually built: toggle → the exact "Sending daily at HH:MM (tz)
  to address" sentence exists verbatim in `EmailSettingsView`; "Send test email" and "Confirm
  address" button labels exist verbatim.

### 10. Mutations — 4 performed (one more than the minimum), each made a targeted test fail, each restored and SHA256-verified byte-identical

| # | File | Mutation | Test result before restore | Restored, hash matches |
|---|---|---|---|---|
| 1 | `web/src/lib/email/confirm-token.ts` | Skipped the HMAC tamper check (`if (false)` instead of the real comparison) | 3 failed: `confirm-token.test.ts` "rejects a tampered signature", "rejects a token...different secret"; `confirm-email/route.test.ts` "tampered signature: rejected, no DB write" (this one flipped from redirecting to `invalid_link` to actually **writing** `digest_email_confirmed=1`) | Yes — `0fd9bd6d...` |
| 2 | `web/src/app/api/profile/route.ts` | Disabled the F4 guard's rejection (`if (!allowed && false)`) | 1 failed: "rejects a value that is neither the account email nor the stored value" (200 instead of 400) | Yes — `5782b02c...` |
| 3 | `web/src/app/api/profile/send-test-email/route.ts` | Disabled the `breakerTripped` check (`if (false && breakerTripped(...))`) | 2 failed: "the 4th send-test-email...is refused", "an unreachable counter store REFUSES..." (both 200 instead of 429 — proves the fail-closed behavior is real, not decorative) | Yes — `8d6945ff...` |
| 4 | `web/src/app/api/profile/confirm-email/route.ts` (required to be in this file) | Disabled the wrong-user check (`if (false)` in place of `if (result.uid !== user.id)`) | 1 failed: "token minted for a DIFFERENT user...rejected" (a token minted for user A got silently honored and would have written into user B's row while B was signed in) | Yes — `6ed9c665...` |

Final re-hash of all 16 in-scope files, and `git status --porcelain`, both match the
review's opening snapshot exactly (see above) — no residual changes anywhere.

### 11. Gates, from `web/` — all four match C's claimed numbers exactly

```
npx vitest run     → 261 passed | 2 skipped (263 files), 4751 passed | 5 skipped (4756 tests)
npx tsc --noEmit    → 0 errors
npx eslint .        → 149 problems (0 errors, 149 warnings)
npm run build       → success; ƒ /api/profile/confirm-email and ƒ /api/profile/send-test-email
                      both listed as dynamic routes in the build's route manifest
```

## Verdict

**STATUS: VERIFIED_OFFLINE_BOUNDED**

All 11 checks PASS. No findings. Four independent mutations (one required inside
`confirm-email/route.ts`, three more across the other security-bearing files) each proved a
specific guarantee is real rather than decorative — HMAC tamper detection, the PUT-path
confirmation guard, the fail-closed rate limits, and the wrong-user token check — and each
was restored and verified byte-identical by SHA256. All four required gates reproduce C's
claimed exact counts. C's five declared deviations were each independently judged rather than
taken on trust: the "" clearing behavior was traced through every downstream reader
(including the pre-existing, untouched scheduled cron) and found consistently safe; the
docs-table omission was checked against that table's actual pre-existing scope and found not
to make the document inaccurate. "Offline bounded" because, per the task's hard rules, no
live Resend call, database, or dev server was used — the Resend sandbox-sender claim in the
user's local-test section (§1z P10) still needs the user's own confirmation in their Resend
dashboard, as both B and C already flagged.
