# EMAIL-SETTINGS — C checkpoint (implementer)

STATUS: IMPLEMENTED_PENDING_REVIEW

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD a82ffe54. Role: C
(implementer) per `ABC-JEV-INTEGRATION.md` §1z/§1y point 2 and the guide
`docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md`. No git command that changed
anything (read-only `git status`/`git diff` only — the manager commits); no live
Resend call, no live DB write/migration, no dev server started; nothing in
`peer-followup` touched; no email address logged anywhere.

## Read (all done, listed once, not repeated below)

- Guide `docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md` — all of it.
- `ABC-JEV-INTEGRATION.md` §1z (manager rulings on B's POLICY list) and §1y point 2
  (user's spec + constraints i-viii), via Grep for "### §1y." / "### §1z." (file is
  4,000+ lines).
- `web/AGENTS.md` → `web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`,
  `02-guides/redirecting.md`, `03-api-reference/04-functions/redirect.md` (Next 16;
  route handlers use plain Request/Response + `NextResponse.redirect(new URL(path, req.url))`;
  `redirect()` from `next/navigation` is a Server-Component/render-time construct, not
  what a `GET` route handler doing a client-visible browser redirect wants).
- Codebase (read in full or in relevant part): `web/src/app/api/profile/route.ts`,
  `web/src/app/api/test-digest/route.ts` (+ its `route.test.ts`), `web/src/lib/usage/counters.ts`
  (+ `counters.test.ts`), `web/src/lib/email/send-digest.ts`, `web/src/lib/email/digest-retry.ts`,
  `web/src/lib/email/digest-template.ts`, `web/src/lib/security/ai-request.ts`,
  `web/src/lib/llm/providers/registry.ts`, `web/src/app/profile/page.tsx` (full structure,
  1717 lines, incl. `PastBriefings`/`LearnedPreferences`/`EditView`/`Toggle` usage),
  `web/src/store/profile.ts` (all six `updateDigest*` setters already existed, per F4 — no
  store changes needed), `web/src/components/profile-sync.tsx` (debounced diff-PUT
  autosave — the new UI only calls store setters; `ProfileSync`, untouched, pushes them),
  `web/src/components/account/use-auth-user.ts` + `account-section.tsx` (signed-in guard
  pattern), `web/src/types/index.ts` (digest* fields + defaults), `web/supabase/schema.sql`
  (digest columns, no format/length constraint on `digest_email` at the DB level),
  `web/src/test-support/route-harness.ts`, `web/src/app/api/profile/route.test.ts`,
  `web/src/lib/usage/counters.test.ts`, `web/src/app/api/test-digest/route.test.ts`,
  `web/src/app/profile/page.test.tsx` (**this repo has no `@testing-library/react` and no
  test anywhere simulates a click** — its own header comment says so; component tests use
  `renderToStaticMarkup` on exported, prop-driven pieces only), `web/src/app/api/jobs/dispatch-digests/route.test.ts`
  + `idempotency.test.ts` (run, not edited), `web/.env.example`, `docs/JEV-RELEASE-READINESS.md`
  (Part 1 plain-language rules + §4/§8), `web/package.json` (confirmed: no
  `@testing-library/react`, vitest 4.1.8).
- Confirmed `node:crypto` (`createHmac`, `timingSafeEqual`) is the established HMAC /
  timing-safe-compare pattern in this repo (`api/jobs/purge-uploads/route.ts`,
  `api/admin/uploads/block/route.ts` both do a length-guard + `timingSafeEqual` on a
  bearer secret); Node v24 here supports `Buffer.toString("base64url")` natively (checked
  directly).

## What was built (§4 guide steps, all done)

1. Baseline gate run, before any edit: `npx vitest run` → **257 passed | 2 skipped (259
   files), 4686 passed | 5 skipped (4691 tests)**; `npx tsc --noEmit` → 0 errors;
   `npx eslint .` → **0 errors, 149 warnings**; `npm run build` → success. Matches the
   task brief's stated baseline exactly.
2. `web/src/lib/usage/counters.ts`: added `testEmailDayKey(userId, now)` and
   `confirmEmailRequestDayKey(userId, now)`, exact `` `prefix:${userId}:${utcDaySegment(now)}` ``
   shape as `deepReportDayKey`. Both are meant to be checked with `breakerTripped` (FAILS
   CLOSED), never `underLimit` — §1z P1. Tests added inline in `counters.test.ts`'s existing
   "counter keys" case (RED confirmed — `TypeError: testEmailDayKey is not a function` —
   then GREEN).
3. `web/src/lib/email/confirm-token.ts` (new): `getConfirmSecret()`,
   `normalizeEmailAddress()`, `isValidEmailFormat()` (pragmatic pattern, <=254 chars, no
   commas/whitespace — P9), `signConfirmToken()`/`verifyConfirmToken()` (HMAC-SHA256,
   base64url payload+signature, sign-check BEFORE parsing the payload's claims, guarded
   length check before `timingSafeEqual`, 24h default TTL — §2.2/§1z P4). Re-use is a
   structural property (the function is pure, no single-use state), not a special case.
   `confirm-token.test.ts` (new, 17 tests): RED confirmed (module didn't exist) → GREEN.
4. `web/src/lib/email/confirm-email-template.ts` (new sibling file — `digest-template.ts`
   itself has ZERO edits, per guide 2.5's explicit parenthetical; a small local `esc()` +
   brand-palette constant are deliberately duplicated rather than imported). Subject/html/
   plaintext for the confirmation email, sent via `sendDigestEmail`'s existing
   `{ items: [], render: {...} }` override shape (`send-digest.ts` — zero edits).
   `confirm-email-template.test.ts` (new, 6 tests): RED → GREEN.
5. `web/src/app/api/profile/confirm-email/route.ts` (new): `POST` (request a confirmation
   for a new address — short-circuits straight to a write with no token/email for the
   account's own address or the already-stored one; otherwise checks the secret, then the
   5/day fail-closed counter, then signs+emails); `GET` (the clicked link — verifies,
   checks the signed-in user's id against the token's `uid`, writes `digest_email`,
   redirects to `/profile` with an honest, address-free outcome flag). `route.test.ts`
   (new, 18 tests, written together with the implementation rather than strict RED-first —
   see Process note below) covers auth, P9 validation, the already-confirmed
   short-circuit, the P6 secret-unset case, the 5/day fail-closed cap, and token
   tamper/expiry/wrong-user/re-use/missing-token — all pass.
6. `web/src/app/api/profile/send-test-email/route.ts` (new): auth → Resend-configured
   check → resolve destination (`digest_email` or account email) → 3/day fail-closed
   counter → run the feed pipeline at `aiTier: 0` (reusing the already-exported
   `testDigestFeedRequestFromProfile`) → `sendDigestEmail`. Never inserts into
   `briefing_deliveries`. `route.test.ts` (new, 9 tests, true RED-first: confirmed
   `Cannot find module` before writing the route) covers auth, Resend-unconfigured,
   destination resolution + fallback + no-address, the Tier-0/no-`systemSearchAllowed`
   shape assertion, and the 3/day cap including the "counter store unreachable → refuses"
   case (fails CLOSED, proven with a fake store, not just the real one running out).
7. F4 guard added to `PUT /api/profile` (`web/src/app/api/profile/route.ts`): when the
   patch touches `digestEmail`, a fresh `SELECT digest_email` runs (only then — no added
   cost to any other field's update) and the value is accepted only if it normalizes to
   the account email or the stored value; otherwise `400 { error:
   "digest_email_requires_confirmation" }`, no write. Clearing to `""` is always allowed
   (a deliberate, documented choice — see Deviations). Six new tests added to
   `route.test.ts` (true RED-first: 4 genuinely failed against the pre-guard behaviour,
   2 were regression/documentation tests that already passed) — all 22 tests in the file
   (16 pre-existing + 6 new) pass.
8. Profile page UI (`web/src/app/profile/page.tsx`): `digestToggleUpdate(next)` (pure —
   ON sets `{channel:'both', frequency:'daily'}` per §1z P5, OFF sets `{channel:'inapp'}`),
   `EmailSettingsView` (presentational, every value a prop, renders `null` outright when
   `signedIn` is false), `EmailSettings` (the hook-wired wrapper actually rendered on the
   page, right after `<PastBriefings />`) handling the toggle, the 24h-format hour select,
   automatic browser-timezone detection+save, the address field (short-circuits to a
   direct store update for the account's own address, otherwise calls
   `POST /api/profile/confirm-email`), the confirm-redirect flags via `useSearchParams`
   (stripped via `router.replace` after handling), and "Send test email" via
   `POST /api/profile/send-test-email` with honest per-outcome copy. 9 new tests in
   `page.test.tsx` (true RED-first): the toggle mapping (2) and `EmailSettingsView`'s
   signed-out-renders-nothing gate plus six content checks (7) — all pass. No
   `@testing-library/react`/click-simulation was introduced; every new render test uses
   `renderToStaticMarkup` on the presentational component only, matching this repo's own
   established convention (see that file's own header comment, expanded).
9. Confirmed unchanged and green: `web/src/app/api/jobs/dispatch-digests/route.test.ts`
   (36 tests total for both files together) — `git status`/`diff --stat` on
   `src/app/api/jobs/`, `src/lib/email/send-digest.ts`, `src/lib/email/digest-template.ts`,
   `src/lib/dashboard/` shows zero changes.
10. Docs: `web/.env.example` (RESEND_API_KEY, DIGEST_FROM_EMAIL,
    DIGEST_EMAIL_CONFIRM_SECRET — names + purpose, no values, matching the file's own
    per-var comment-block convention); `docs/JEV-RELEASE-READINESS.md` — decision #7 in
    both Part 1 (plain language: built, default-off per person, the once-per-day soft-check
    caveat in plain words, the two-piece activation need) and Part 2 §8 (technical: full
    file/route list, the caps and their fail-closed direction, the secret, the
    unchanged-dedupe-status note, ordered activation steps) — plus the "X still open"
    counts corrected in both Part 1's intro paragraph and Part 2 §8's header/tally line
    (4 decided of 7 now, was 3; #7 moves from open to resolved).
11. Full gate, final state (see Gate numbers below).

## Tests added — count

| File | New tests |
|---|---|
| `web/src/lib/usage/counters.test.ts` | 0 new `it`s (2 new assertions inside an existing one) |
| `web/src/lib/email/confirm-token.test.ts` | 17 (new file) |
| `web/src/lib/email/confirm-email-template.test.ts` | 6 (new file) |
| `web/src/app/api/profile/confirm-email/route.test.ts` | 18 (new file) |
| `web/src/app/api/profile/send-test-email/route.test.ts` | 9 (new file) |
| `web/src/app/api/profile/route.test.ts` | 6 (added to existing file) |
| `web/src/app/profile/page.test.tsx` | 9 (added to existing file) |
| **Total new `it` blocks** | **65** |

Matches the observed jump in the full suite: 4686 → 4751 passed (+65), 5 skipped
unchanged, 257 → 261 passed files (+4 new files), 2 skipped unchanged.

## Gate numbers — final, from `web/`

- `npx vitest run` → **261 passed | 2 skipped (263 files), 4751 passed | 5 skipped (4756
  tests)**. (Baseline was 257/2/259 files, 4686/5/4691 tests — net +4 files, +65 tests,
  zero regressions, zero new skips.)
- `npx tsc --noEmit` → **0 errors** (baseline: 0 errors).
- `npx eslint .` → **0 errors, 149 warnings** — **unchanged from the 149-warning
  baseline.** (It transiently rose to 152 after the first UI draft — three off-Latent's-
  scale Tailwind spacing utilities, `mb-1.5`/`mt-0.5`/`mt-1.5`, all introduced by this
  item's own new markup — fixed to `mb-2`/`mt-1`/`mt-2` per the rule's own suggested
  replacements before finishing, restoring the exact baseline count.)
- `npm run build` → **success**, both new routes appear correctly in the route manifest
  as dynamic (`ƒ /api/profile/confirm-email`, `ƒ /api/profile/send-test-email`).

## Full file list

**New:**
- `web/src/lib/email/confirm-token.ts` + `confirm-token.test.ts`
- `web/src/lib/email/confirm-email-template.ts` + `confirm-email-template.test.ts`
- `web/src/app/api/profile/confirm-email/route.ts` + `route.test.ts`
- `web/src/app/api/profile/send-test-email/route.ts` + `route.test.ts`

**Modified:**
- `web/src/lib/usage/counters.ts` (+ `counters.test.ts`)
- `web/src/app/api/profile/route.ts` (+ `route.test.ts`) — F4 guard
- `web/src/app/profile/page.tsx` (+ `page.test.tsx`) — new section
- `web/.env.example`
- `docs/JEV-RELEASE-READINESS.md`

**Explicitly verified untouched (git diff/status clean):** `web/src/app/api/test-digest/route.ts`
(and its test), `web/src/app/api/digest/test/route.ts`, `web/src/app/api/jobs/dispatch-digests/route.ts`
(and both its test files), `web/src/lib/email/digest-retry.ts`, `web/src/lib/email/send-digest.ts`,
`web/src/lib/email/digest-template.ts`, `web/src/lib/dashboard/prepare-due.ts`,
`web/src/lib/dashboard/due-owners.ts`, `web/src/app/api/jobs/prepare-dashboards/route.ts`,
`web/src/store/profile.ts` (all six setters pre-existed, F4 — no store edit needed),
`web/src/components/profile-sync.tsx`.

## Deviations from the guide — flagged for A, not POLICY stops

Nothing here hit the escape clause (no schema change, no dedupe-path edit, no shape the
rulings didn't cover) — these are implementation judgment calls made where the guide's
own text was ambiguous, silent, or (in one case) internally in tension with itself, and
each is a deliberate, reasoned choice rather than an oversight. Flagging all of them
explicitly so A checks them, not because I believe any is wrong.

1. **`test-digest/route.ts` reuse (F2/§2.5) — decided NOT to export its private
   helpers, so that file has ZERO edits.** The guide's F2/§2.5 say to reuse
   `testDigestFeedRequestFromProfile`, `seedTextsFromProfile`, and
   `feedControlsFromProfile` — only the first is actually `export`ed in the real file;
   the other two are private. §2.5's own file list marks `test-digest/route.ts` as
   "Untouched, verified safe" with **no** parenthetical exception (contrast
   `digest-template.ts`, which explicitly got one: "only added to... not edited"). Given
   that asymmetry, I read "Untouched" literally for `test-digest/route.ts` and re-derived
   small local equivalents of the two private helpers inside `send-test-email/route.ts`
   (~15 lines) instead of adding two `export` keywords. This also matches an existing
   in-codebase precedent: `profile/route.ts` and `test-digest/route.ts` already each keep
   their own private copy of `isMissingFeedIntentColumn` rather than sharing one, so a
   third private copy is not a new pattern. Net effect is behaviourally identical; only
   the DRY-ness differs from what F2 suggested. `test-digest/route.test.ts` was re-run
   unchanged and stays green (9/9).
2. **`GET /api/profile/confirm-email` redirects rather than returning a bare 401 when
   nobody is signed in — a real conflict in this item's own inputs, resolved in favour of
   the more detailed, more specific design.** The guide's RED list item 1 says "both
   methods... return 401 with no Supabase session." But the guide's own §2.2 design and
   the manager's ruling (§1z P8) both separately say a browser-clicked link with nobody
   signed in must show "a calm 'sign in, then open the link again' page" — and a bare
   JSON 401 is not a page; a redirect (3xx + `Location`) is the only way a browser
   actually navigates anywhere on this method, so the two directives cannot both be
   satisfied literally for `GET`. I followed §2.2/P8 (the more recent, more specific,
   more deliberately-reasoned text) for `GET`, and the RED list's plain 401 for `POST`
   (no conflict there — POST is a `fetch()` call from the UI, not a browser navigation,
   so a JSON 401 is exactly right). Documented in the route file's own header comment
   too, quoting both sides, so this is visible without reading this checkpoint.
3. **Confirmation-link redirect outcomes are a short, opaque `digest_email_confirm=<code>`
   query flag** (`signin_required` / `wrong_account` / `invalid_link` / `unavailable`),
   **never the email address itself** — consistent with "never log an email address"
   (constraint vii) and the general rule against putting personal data in a query string.
   The profile page reads it once, shows a plain-language message, and strips it via
   `router.replace`.
4. **`PUT /api/profile`'s new guard treats an empty-string `digestEmail` (clearing the
   field) as always allowed**, bypassing the account-email/stored-value check entirely
   for that one value. Neither the guide nor the §1z rulings mention clearing; forbidding
   it would make the address field impossible to blank out once a custom address is
   stored. No schema change, no interaction with the dedupe path.
5. **Response shape for the two new routes is a small ad hoc JSON contract**
   (`{ sent, to, reason, error }` for send-test-email; `{ ok, confirmed, error }` for
   confirm-email's `POST`), not specified verbatim anywhere in the guide beyond the
   status codes and the user-facing copy strings. Chosen to let the UI show the exact
   copy from guide §2.4 without guessing from an HTTP status alone (e.g. distinguishing
   "no address yet" from "rate limited" both being reachable at different status codes,
   `400`/`429`, but both needing their own exact sentence).
6. **Docs scope.** `docs/JEV-RELEASE-READINESS.md`'s Part 2 §1 flag-inventory table and
   §4 secrets-placement table were left untouched — the task's explicit doc asks were
   `.env.example` and decision #7 (built/caveat/activation), which are done in full; adding
   `DIGEST_EMAIL_CONFIRM_SECRET`/`RESEND_API_KEY`/`DIGEST_FROM_EMAIL` rows to §4's secrets
   table as well would be a reasonable follow-up but was not explicitly requested and
   risked scope creep into a large, carefully-cross-referenced table. Flagged in case A or
   the manager wants it added.

## Process note (honesty, not hidden)

For `confirm-email/route.ts` specifically, the implementation and its test file were
written in that order (design informed by the full guide + rulings, then a comprehensive
test suite against it) rather than true RED-first. Every other new file in this task
(`counters.ts`'s additions, `confirm-token.ts`, `confirm-email-template.ts`,
`send-test-email/route.ts`, the `profile/route.ts` F4 guard, and the profile-page UI) was
genuine RED-then-GREEN: a failing test observed first (either a real assertion failure or
a "cannot find module"/"is not a function" error), then the implementation, then GREEN
confirmed. The confirm-email route's 18 tests are comprehensive and all independently
pass against the real implementation (not tautological), but I want A to know the actual
sequence rather than imply a RED run that did not happen for that one file.

## THE USER'S LOCAL TEST

Add to your own `web/.env.local` (never shown to any agent, never committed):

```
RESEND_API_KEY=<your Resend API key>
DIGEST_FROM_EMAIL=Peer <onboarding@resend.dev>
DIGEST_EMAIL_CONFIRM_SECRET=<any long random string you make up>
```

- **`RESEND_API_KEY`** — required to send anything at all. Get it from your own Resend
  dashboard (resend.com).
- **`DIGEST_FROM_EMAIL`** — optional. The value above (`Peer <onboarding@resend.dev>`) is
  Resend's own no-setup sandbox sender and needs no domain verification — but per
  Resend's documented sandbox limits (confirm this in your own Resend dashboard, per §1z
  P10), it can typically only deliver to the email address of whoever owns that
  `RESEND_API_KEY` — i.e., your own Resend login email. That is exactly why the simplest
  first local test is "send to yourself with the default address" (see below), not a
  custom one.
- **`DIGEST_EMAIL_CONFIRM_SECRET`** — optional for the FIRST test. Only needed if you want
  to confirm an address other than your Peer account's own sign-in email. Any long random
  string works; nothing reads its value beyond checking it is non-empty and using it to
  sign/verify.

**Starting the app:** from `D:/local files on this PC/Github/Peer/peer/web`, run
`npm run dev` (the repo's `.claude/launch.json` already pins this to port 3000; the
manager starts this for you, not this agent — no dev server was started to build this
item).

**Click path once the app is running and you're signed in:**
1. Open `http://localhost:3000/profile`.
2. Scroll to the new "Daily email" section (right after "Past briefings").
3. Flip the toggle on — the section will show a "Sending daily at [hour] ([your
   detected time zone]) to [your account email]" sentence, since the address field
   defaults to your own sign-in email (already "confirmed" — no link needed).
4. Click **"Send test email"**. With only `RESEND_API_KEY` set (no `DIGEST_FROM_EMAIL`,
   no `DIGEST_EMAIL_CONFIRM_SECRET`), this should say "Sent just now to
   [your account email]." and a real email should land in that inbox within a few
   seconds (check spam, since the sandbox sender is unverified).
5. To test the confirmation-link flow: type a DIFFERENT address into the "Send to" field
   and click "Confirm address" (this needs `DIGEST_EMAIL_CONFIRM_SECRET` set, and per the
   Resend sandbox limit above, the confirmation email will only actually arrive if that
   different address is the one your `RESEND_API_KEY` account owns — otherwise the
   button/link will say it worked but Resend itself will silently not deliver it, which
   is a Resend-account fact, not a bug in this build).
6. You can click "Send test email" up to 3 times per UTC day before it says "You've used
   today's 3 test sends. Try again tomorrow." — this is expected, not a fault.

Nothing above writes to `briefing_deliveries`, applies any migration, or changes the
scheduled once-an-hour digest job's own behavior.
