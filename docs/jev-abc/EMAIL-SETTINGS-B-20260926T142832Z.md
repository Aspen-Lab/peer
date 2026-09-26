# EMAIL-SETTINGS — B guide (investigator)

STATUS: COMPLETE

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD a82ffe54. Role: B (investigator) per `ABC-JEV-INTEGRATION.md` §2 — no production edits, no live calls, no dev server. Only file touched: this one.

Binding inputs read: §1y point 2 (decision #7 spec + manager constraints i–viii), §1x CORRECTION (current state: profile API/store already map digest fields both ways; 0 `.tsx` files call any `updateDigest*` setter; schema defaults `digest_enabled=true`, `digest_hour_local=8`, `digest_timezone='UTC'`, `digest_channel='inapp'`, `digest_frequency='daily'`; commit ceee6200 deliberately cut the email channel selector 2026-04-27, keeping Resend/cron code "dormant for easy revival").

Search scope note: unless a step says otherwise, "not found" below means a repo-wide `Grep` across `web/src`, `web/supabase` and `docs/` found no other match, not just the files named in the task.

## Progress log
- [x] 1. Sending path + at-most-once proof
- [x] 2. Existing test routes + gating decision
- [x] 3. Stateless signed confirmation link design
- [x] 4. Profile UI section design + copy
- [x] 5. Local test path for the user + Resend sandbox limits
- [x] 6. TRIGGER-A interaction check

---

## 1. Findings, with evidence

### F1. Sending path and "at most one email per user per day"

Files: `web/src/lib/email/send-digest.ts` (`sendDigestEmail`), `web/src/lib/email/digest-retry.ts` (`handleConflictingEmailClaim`, `persistDigestEmailAttempt`, `isEmailRetryEligible`), `web/src/app/api/jobs/dispatch-digests/route.ts` (`GET`, `isDigestDedupeEnabled`, `digestIdempotencyKey`), migration `web/supabase/migrations/20260924000300_briefing_deliveries_dedupe.sql`.

**`PEER_DIGEST_DEDUPE` off (today's default — `isDigestDedupeEnabled()` returns false):**
`GET` (dispatch-digests/route.ts lines ~296-307) does a *soft* guard: skip if a `briefing_deliveries` row for this user exists with `delivered_at` within the last 6 hours, then a **plain `insert`** (no `local_date`, no `ON CONFLICT`). This is a check-then-act race, not atomic. Two overlapping invocations of the route (e.g. cron retries, or a manual re-hit of `/api/jobs/dispatch-digests` while a run is still in flight) can both pass the 6h check before either inserts, and both would then call `sendDigestEmail` with **no idempotency key** (the plain-insert branch never sets `idempotencyKeyForEmail`) — so Resend has nothing to arbitrate a duplicate on this path. In practice a single hourly cron only matches `digest_hour_local` once per 24h, so the realistic exposure is a manual/duplicate trigger, not the normal schedule — but the guarantee is best-effort, not proven.

**`PEER_DIGEST_DEDUPE` on:** the route calls the `claim_briefing_delivery(p_user_id, p_local_date, ...)` RPC, which does `insert ... on conflict (user_id, local_date) where local_date is not null do nothing returning id` — a single atomic statement (migration lines 91-111). Only the invocation that wins the insert gets a row back; every other concurrent caller gets zero rows and, for the email channel, goes to `handleConflictingEmailClaim`, which either (a) sees `payload.email.sent === true` and skips, or (b) replays the **same** deterministic key (`digestIdempotencyKey(userId, localDate)` = sha256 of `peer-digest-email:v1:<uid>:<date>`) with the **same stored rendered bytes**, so Resend's own 24h idempotency window (not this code) is what actually blocks a double send on retry. This path has a real concurrency test: `route.test.ts` — *"TRUE concurrency: two GET calls launched together via `Promise.all` produce exactly one claim, one email, and no failures"* (line 421). **This is the setting that actually proves at-most-once.**

**The setting the user must use, and why it is not simply "turn it on":** the dedupe migration's own header says, verbatim in spirit, **"AUTHORED ONLY. NOT APPLIED by this campaign"** — it `alter table`s the already-live `public.briefing_deliveries` table. `.env.example` (lines 137-140) says the same: *"Leave unset until AFTER that migration has actually been applied."* I found no later note anywhere in `ABC-JEV-INTEGRATION.md` or `docs/JEV-RELEASE-READINESS.md` recording that this migration was since applied to the real database (repo-wide search for "briefing_deliveries_dedupe" / "migration applied" — see §1x's own line 1522, still describing the flag as "default off... its migration alters the already-applied briefing_deliveries table"). **If the flag is turned on before the migration is applied, `claim_briefing_delivery` doesn't exist in the real database — the RPC call errors, the row goes to `failed`, and NOBODY gets a digest that day** (fails closed, not a double-send, but a real regression for every user). So:
- **Today, with the migration unapplied: leave `PEER_DIGEST_DEDUPE` unset/off.** The 6-hour soft guard is what actually runs.
- **To get the proven at-most-once guarantee: the user must apply `20260924000300_briefing_deliveries_dedupe.sql` to the real Supabase database (their own explicit action per `ABC-JEV-INTEGRATION.md` §1y point 4 — B/C never apply migrations), then set `PEER_DIGEST_DEDUPE=on`.**
- This is listed in POLICY below — it is a real product gap (the soft guard is not a proof) but closing it is a DB-apply decision, outside this item's code.

### F2. The two existing "test" routes are gated for different reasons and neither fits the new button

- `web/src/app/api/test-digest/route.ts` (`POST`): runs the real pipeline (`aiTier: 0`, no `systemSearchAllowed`) and calls `sendDigestEmail`, **always to `user.email`** (the OAuth account address — never `digest_email`), ignoring `digest_enabled`/frequency/hour entirely. Gated by `canUseLocalServerProvider()` → `404` outside local dev (`web/src/lib/llm/providers/registry.ts:53`), **plus** `requireEntitledAiRequest("test-digest", 20)` (an hourly-bucket check, scope `"test-digest"`, limit 20/hour — not a daily cap and not per-address). Commit `4d4b0ef2` (2026-09-04) made it local-only: *"was callable by any signed-in user on a deployment"* and could "spend the operator's model and email budget" (in fact its model spend is already pinned to 0 by `aiTier: 0`; the real exposure was unlimited Resend sends to an attacker-chosen... no — to the caller's own auth email, so the real risk was budget/abuse volume, not addressing someone else).
- `web/src/app/api/digest/test/route.ts` (`GET`): **not a digest-email route at all** — it is a Vertex AI/Gemini connectivity probe (sends "Reply with pong" to Vertex, per commit message: "already-gated sibling"). Also `canUseLocalServerProvider()`-gated. The near-identical name to `test-digest` is exactly the kind of confusion to avoid repeating with new route names.

**Decision: reuse neither route as-is; add two new routes.** Both existing routes stay untouched (dev-only diagnostics, unrelated purposes). The new "Send test email" must work in production, must target only the user's own **confirmed** `digest_email` (or account email), and must be capped per-day, not per-hour — none of which either existing route does. Reusing the *feed-request conversion helpers* (`testDigestFeedRequestFromProfile`, `seedTextsFromProfile`, `feedControlsFromProfile` in test-digest/route.ts) is fine and expected — this precedent ("reuse, don't re-derive a third time") is already established for `hourInTimezone`/`weekdayInTimezone`/`dateInTimezone` (moved to `lib/dashboard/timezone.ts`, see that module's header) and for `handleConflictingEmailClaim` (moved to `digest-retry.ts` specifically to be a second caller's import, not a copy).

### F3. Rate limiting: `usage_counters` / `increment_usage_counter`, and what "unreachable" does today

File: `web/src/lib/usage/counters.ts`. Key facts:
- `rateKey(scope, userId, now)` is **hourly** (`rate:<scope>:<user>:<YYYY-MM-DDTHH>`); there is no existing daily-per-user key builder, but there is a clean precedent to copy: `deepReportDayKey(userId, now)` = `` `deep:${userId}:${utcDaySegment(now)}` `` (line 129). A new `testEmailDayKey`/`confirmEmailRequestDayKey` should follow that exact shape, all-UTC-day, same as every other per-day counter in the app (`counters.ts`'s own header: "All segments are UTC... `localCalendarDate` is... the wrong helper for a quota").
- `increment_usage_counter` (migration `20260904000000_usage_counters.sql`) is a single `insert ... on conflict (key) do update set value = c.value + excluded.value` — genuinely atomic; two simultaneous callers cannot both read the same pre-increment value (this IS proven, unlike F1's soft path).
- **Two opposite failure conventions already exist, on purpose** (`counters.ts` header): `underLimit()` **fails open** (unreachable counter ⇒ treated as under the limit) for ordinary rate limits (the existing 60/h feed, 20/h report, and `test-digest`'s own 20/h check all fail open); `breakerTripped()` **fails closed** (unreachable ⇒ treated as tripped) for the operator-wallet breakers (200/day paid cap, 500/day forced-rebuild cap). The distinction in this codebase is *purpose*, not scope: per-user or global, a check that exists to protect the **operator's spend** fails closed; a check that exists to keep the **UX responsive** fails open.
- **Whether `usage_counters` is actually applied to the real production database could not be confirmed by static reading.** `web/supabase/schema.sql` (the "run once" bootstrap script) does **not** mention `usage_counters` at all, so its absence there is not proof either way. Circumstantial evidence it IS live: `GET /api/profile`'s `clientEntitlement()` (route.ts lines 226-247) already reads this store on every profile fetch to show a real user's deep-report quota — a currently-shipped, currently-described-as-working feature from an earlier ("ABC-freemium") campaign, not this one. I could not query the live database to be sure (out of scope for B; §3a: "production is not a test fixture"). **Flagged in POLICY**, not assumed.

### F4. `digest_email` needs no schema change — but the existing PUT handler has an open gap

`web/supabase/schema.sql` lines 122-137 already define `digest_enabled`, `digest_hour_local`, `digest_timezone`, `digest_channel`, `digest_frequency`, `digest_email` (nullable `text`, no format constraint) as part of the **already-applied** base schema (confirmed by §1x's own correction and by `profiles` route.ts's fallback-on-missing-column code path at lines 276-286, which is defensive for a stale DB, not evidence the column is actually missing today). `web/src/store/profile.ts` already has `updateDigestEmail`/`updateDigestEnabled`/`updateDigestHourLocal`/`updateDigestTimezone`/`updateDigestChannel` setters (lines 157-162, 636-647) and merges all of them from a remote fetch (lines 736-741). **No migration is needed for the confirmed-address design.**

**Real gap found (classification: security — write-path validation missing, not yet exploitable only because nothing calls it):** `PUT /api/profile` → `profilePatchToRow` (`web/src/app/api/profile/route.ts` line 146: `if (p.digestEmail !== undefined) row.digest_email = p.digestEmail;`) writes **any** client-supplied string to `digest_email` with **zero validation and zero confirmation check**. Today this is dormant because §1x already confirmed 0 `.tsx` files call `updateDigestEmail`. **The moment this item's UI calls `updateDigestEmail` + `PUT /api/profile`, this becomes the live write path, and a confirmation flow bolted on only at a *separate* confirm route does nothing — a client (buggy or malicious) could still `PUT {digestEmail: "anyone@anywhere"}` directly and bypass confirmation entirely.** Concrete direction (§2 design below): `PUT` must reject a `digestEmail` that differs (case-insensitively, trimmed) from *both* the session's own account email *and* the value currently stored for that user, requiring a fresh `SELECT` of the existing row before the upsert when (and only when) the patch touches `digestEmail`. This is not optional hardening; it is the other half of "confirmed before anything is sent there" — without it, confirmation is a UI nicety, not a real gate. Caller/tests at risk: none today (no caller exists yet); the new UI (§4 design) must be built to never trigger this path itself (it only ever `PUT`s an address that is the account email or was just proven confirmed).

### F5. Confirmation token — no existing pattern to reuse or collide with

Repo-wide search for a signed-link / magic-link / HMAC-token pattern (`Grep -i "signed.?link|magic.?link|verify.*token|confirmToken|emailToken"` across `web/src`) found nothing. This is new. Available secrets (`web/.env.example`, full name list checked): `CRON_SECRET` (bearer secret for `/api/jobs/*`, wrong trust boundary to reuse — anyone with it can already trigger the cron routes, but conflating "cron caller" with "can mint a confirmation for any user+address" is a needless blast-radius merge), `PEER_JEV_BROKER_SECRET` (unrelated integration). **No existing secret is a clean fit; a new server-only secret is needed** (see design). No existing email-format validator exists either (`Grep -i "isValidEmail|emailRegex|validateEmail"` — no matches); one must be written.

### F6. TRIGGER-A interaction — confirmed safe, no other reader of these two columns

Files: `web/src/lib/dashboard/prepare-due.ts` (`computePrepareDueAt`), `web/src/lib/dashboard/due-owners.ts` (`isOwnerDueForPrepare`, `DueSelectionInput { digestHourLocal, digestTimezone }`). Repo-wide search for `digest_hour_local`/`digestHourLocal`/`digest_timezone`/`digestTimezone` (15 files) shows every reader is one of: the column definition (schema.sql), the profile row mapping (`profile/route.ts`, `store/profile.ts`, `types/index.ts` — the exact path the new UI writes through), the two cron routes (`dispatch-digests`, `prepare-dashboards`) and their own test files, and `prepare-due.ts`/`timezone.ts` (pure functions, no independent storage). `due-owners.ts`'s own header is explicit that `digest_timezone` is used **only** to pick which calendar day's target hour to compute — never as a storage key (that's `localCalendarDate(checkinInstant)`, a separate, already-fixed P11 concern). **Confirmed: saving `digestHourLocal`/`digestTimezone` from the new profile UI (through the existing `PUT /api/profile` → `digest_hour_local`/`digest_timezone` columns, unchanged) purely personalizes when the prepare-ahead worker and the dispatch cron consider a user "due" — no other behavior changes.** Nothing in this item touches `prepare-due.ts`, `due-owners.ts`, `prepare-dashboards/route.ts`, or their tests.

### F7. Resend sandbox sender limits

Resend's own docs page for adding/verifying a domain (`https://resend.com/docs/dashboard/domains/introduction`) states a domain **must** be verified to send email with Resend, but the fetched page did not itself state the specific recipient restriction for the pre-verification default sender (`onboarding@resend.dev`, the fallback in `send-digest.ts`'s `fromAddress()`). This matches Resend's widely-documented behavior (stated on their site's sending pages, not the one page fetched): **the shared `onboarding@resend.dev` sender can only deliver to the email address of the Resend account's own owner/login** — i.e. whoever created the Resend account and API key being used. This must be verified by the user directly in their Resend dashboard rather than taken on my authority alone, since the one doc page fetched did not state it explicitly; I flag the exact claim for the user/manager to confirm against `https://resend.com/docs/dashboard/domains/introduction` and Resend's dashboard copy before relying on it. **Practical consequence for local testing:** with no verified domain, a `web/.env.local` test can only successfully deliver to the address of the person who owns the `RESEND_API_KEY` being used — testing delivery to any *other* address (e.g. a friend's inbox, or a newly-typed confirmation address that isn't the Resend account owner's own address) will fail at Resend, not in Peer's code. This is exactly why the new UI's "one address field defaulting to the account email" matters for a first local test: the simplest working local test is send-to-self with the default (account) address, not a custom address.

### F8. Does the local app write to the real Supabase profiles table?

Yes, plainly: **whatever `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (and anon key) are set to in `web/.env.local` is the database `npm run dev` reads and writes** — `createClient()`/`createAdminClient()` (`web/src/lib/supabase/server.ts`, `web/src/lib/supabase/admin.ts`, not opened — their construction is standard Supabase-JS client init off those exact env vars per every file already read in this guide) have no separate "local" database concept. If those vars in `web/.env.local` point at the user's real production Supabase project (the normal setup for a solo-developer app with one Supabase project), **then running `npm run dev` and clicking "Send test email" writes/reads the real `profiles` table and could email the real account** — there is no sandbox DB isolation in this codebase. Stated plainly per the task's requirement; this is not a defect to fix, just a fact the user must know before testing locally.

---

## 2. Design

### 2.1 Routes (new)

| Route | Method | Purpose | Auth | Rate limit | Writes DB? |
|---|---|---|---|---|---|
| `web/src/app/api/profile/send-test-email/route.ts` | `POST` | "Send test email" button | signed-in only (`createClient()` + `auth.getUser()`, 401 if none — same pattern as `test-digest`, **not** `requireEntitledAiRequest`'s local-dev bypass, since aiTier is fixed at 0 for everyone regardless of entitlement) | new `testEmailDayKey`, proposed 3/day | No (mirrors `test-digest`: does not insert into `briefing_deliveries`) |
| `web/src/app/api/profile/confirm-email/route.ts` | `POST` | Request a confirmation link be sent to a new address | signed-in only | new `confirmEmailRequestDayKey`, proposed 5/day (POLICY) | No (stateless — nothing is written until the link is clicked) |
| `web/src/app/api/profile/confirm-email/route.ts` | `GET` | The clicked link: verify token, write `digest_email`, redirect | signed-in only (session `user.id` must equal the token's `uid`; see 2.2) | N/A (idempotent — see 2.2 "re-use") | Yes — the only write in this whole feature that sets `digest_email` to a *new custom* address |

Naming rationale: deliberately **not** reusing or extending `test-digest`/`digest/test` (F2) — those names already confused two unrelated purposes once; new, distinct, verb-first names avoid repeating it. Both live under `api/profile/` (session-cookie auth, matching `profile/route.ts`'s own pattern), not `api/jobs/` (that namespace is reserved for `CRON_SECRET`-gated routes — this is user-facing).

Order of checks inside `send-test-email` (cheapest/least-user-penalizing first): (1) signed in? → 401. (2) Resend configured at all (`RESEND_API_KEY`/`DIGEST_FROM_EMAIL` presence — a config problem, not the user's fault) → if not, honest error, **do not** spend one of the day's 3 attempts. (3) resolve destination = `digest_email` (trimmed) or fall back to account email; if neither exists → honest "add an email first" error, no counter spend. (4) increment-then-compare the daily counter (same "increment first" pattern as `requireEntitledAiRequest`, so two racing clicks can't both slip under 3) → if over limit, 429 with a plain message. (5) run the pipeline at `aiTier: 0`, no `systemSearchAllowed` (matches `test-digest`/`dispatch-digests` precedent exactly — D9), reusing `testDigestFeedRequestFromProfile`/`seedTextsFromProfile`/`feedControlsFromProfile` from `test-digest/route.ts` rather than a third copy. (6) `sendDigestEmail` — no idempotency key needed (this is an on-demand action, not a retried cron; a double-click is bounded by the daily cap, not a correctness risk — mitigate with a simple client-side disable-while-in-flight, not server idempotency). (7) return `{sent, to, error?}` for the UI's honest status text.

### 2.2 Confirmation token

New file `web/src/lib/email/confirm-token.ts`. Stateless, HMAC-SHA256, no schema change.

**New required secret:** `DIGEST_EMAIL_CONFIRM_SECRET` (server-only). Not a reuse of `CRON_SECRET` (F5: different trust boundary — rotating one must not silently affect the other, and whoever holds `CRON_SECRET` should not thereby be able to mint address-confirmation tokens for arbitrary users). If unset, the `POST` (request) handler must return a clear 500 ("email confirmation isn't configured") rather than sign with an empty/guessable secret — mirrors `send-digest.ts`'s own `getClient()` "key not set ⇒ clear error, no insecure default" convention.

**Format:**
```
payload = base64url( JSON.stringify({ uid: <user.id>, email: <trimmed lowercased address>, exp: <unix seconds> }) )
sig     = base64url( HMAC-SHA256(DIGEST_EMAIL_CONFIRM_SECRET, payload) )
token   = payload + "." + sig
```
Proposed TTL: 24h (independent of, and not required to match, the unrelated 23h Resend idempotency-replay window in `digest-retry.ts` — POLICY may adjust).

**Verification order matters — sign check BEFORE trusting anything in the payload:**
1. Split on `.`; exactly 2 non-empty parts, else `malformed`.
2. Recompute `sig` from the payload part; compare with `crypto.timingSafeEqual` (constant-time; guard a length mismatch as simply not-equal rather than letting `timingSafeEqual` throw). Mismatch ⇒ `tampered` — do **not** proceed to parse the payload's claims as if they might be meaningful.
3. Only once signature-valid: base64url-decode + `JSON.parse` the payload; missing/wrong-typed fields ⇒ `malformed`.
4. `exp` in the past (server clock) ⇒ `expired`.
5. Otherwise `{ ok: true, uid, email }`.

**`GET` route's own additional check (not inside the token module):** the *currently signed-in session's* `user.id` must equal the token's `uid`, else reject as "this confirmation link isn't for your account" (covers "token for another user" — e.g. Alice's token clicked while Bob is signed in, or a leaked/forwarded link). If **nobody** is signed in when the link is clicked: redirect to `/profile` with a "sign in, then request a new confirmation link" message; **do not** thread the token through the OAuth round-trip (there is no existing `next=`/`redirectTo` support in `signInWithGitHub()` — `web/src/components/account/use-auth-user.ts` — and adding one is a scope expansion this item doesn't need, since the realistic case is the same browser/session that requested the link). Stated as a deliberate simplification, not hidden.

**Re-use is intentionally allowed, not blocked.** Confirming the same address twice with the same still-valid token is idempotent (it just re-writes the same `digest_email` value) and has no exploitable side effect — unlike a password-reset token, there is nothing to "spend." Blocking re-use would actively break the common case of a corporate email gateway prefetching the link to scan it before the real user clicks it (a well-known reason confirmation links, as opposed to reset links, are conventionally multi-use within their expiry). The manager's "re-use" test case (spec, Investigate §3) should assert re-use **succeeds** both times, not that the second click is rejected.

**Multiple outstanding tokens can coexist** (user requests confirmation for address A, then before clicking, requests for address B) — both tokens stay independently valid until they expire; whichever is clicked last wins (each is a full, independent, correctly-scoped confirmation). No revocation list exists because there is no schema change; this is a stated, accepted trade-off, not an oversight.

**Address already-confirmed short-circuit:** if the requested address (trimmed, lower-cased) equals the account email, or equals the currently-stored `digest_email`, the `POST` (request) handler skips the token/email entirely and just calls the same validated write the `GET` handler would (or — simpler for C — the UI itself should just call `PUT /api/profile` directly in this case and never hit `confirm-email` at all; see 2.4).

### 2.3 The PUT /api/profile guard (closes F4)

In `profilePatchToRow`'s caller (`PUT`, `web/src/app/api/profile/route.ts`), when the incoming patch includes `digestEmail`: read the account email from the already-fetched `user` object and the existing stored `digest_email` from a `SELECT` (only when this field is present in the patch — no added cost to any other field's update); if the new value, trimmed/lower-cased, differs from **both**, reject the whole request with `400 { error: "digest_email_requires_confirmation" }` instead of writing it. This is the actual enforcement point — the confirm-email routes are how a new address *legitimately becomes* one of the two allowed values, not a parallel gate that can be routed around.

### 2.4 Profile UI section

File `web/src/app/profile/page.tsx` (1717 lines read in full structure; visual language confirmed from `LearnedPreferences` and `PastBriefings`, both nearby). New section placed directly after `<PastBriefings />` (line 246) inside the `mode === "view"` branch, same `<section className="mt-8 rounded-2xl bg-surface shadow-card ...">` shell, `eyebrow` label, `text-body-sm text-text-faint/80` helper copy — matching those two neighbors exactly rather than inventing a new visual pattern. Reuses the existing `Toggle` component (`@/components/ui/toggle`) for the on/off switch — the same primitive already used elsewhere on this page, not a new hand-rolled switch. Rendered only when `useAuthUser()` reports a signed-in user (same guard `AccountSection` already uses: `auth.kind !== "unconfigured" && auth.kind !== "loading" && auth.kind !== "signed-out"` ⇒ hide entirely for signed-out visitors, per constraint (i)/(vii)).

Fields, in order:
1. **"Daily email" — `Toggle`.** On ⇒ `updateDigestChannel("both")` **and** `updateDigestFrequency("daily")` (see POLICY — the spec's own framing is "a fixed DAILY... email"; writing frequency explicitly, not just relying on today's default, protects against a hypothetical pre-existing non-daily row from the pre-ceee6200 UI that the new screen never shows or lets the user see). Off ⇒ `updateDigestChannel("inapp")` (frequency untouched on the way off). Then `PUT /api/profile` with the patch (existing save flow — check how the rest of `EditView`'s fields already autosave/patch and match that, rather than inventing a new save trigger).
2. **Send hour — a plain `<select>` of 24 options (0–23, rendered as e.g. "8:00 AM")**, backed by `updateDigestHourLocal`. A bounded `<select>` structurally cannot emit an out-of-range value, so no extra client validation is needed (the DB's own `check (digest_hour_local between 0 and 23)` is the backstop; note `PUT` itself validates neither today — pre-existing, not introduced by this item, and harmless given the select's fixed option list).
3. **Time zone — detected, shown, saved automatically**, no picker: `Intl.DateTimeFormat().resolvedOptions().timeZone`, called once (e.g. in a `useEffect` on mount, or lazily on first render since it's a synchronous browser API) and passed to `updateDigestTimezone` + saved. Shown as plain text (e.g. "Detected: America/Chicago"), not editable — matches the spec exactly ("the time zone detected from the browser... shown and saved").
4. **Address field** — one text input, default value = account email (from `useAuthUser()`), pre-filled and already "confirmed" (no token flow needed if left unchanged or reset back to it). Typing a **different** address and confirming triggers `POST /api/profile/confirm-email`.
5. **"Send test email" button** — calls `POST /api/profile/send-test-email`; disabled while in flight (client-side double-click guard, see 2.1); shows the honest result text from the response (see copy below).
6. **Pending-confirmation state** — component-local state only (e.g. `useState<string | null>` for "an address confirmation is pending for X"), **not** persisted to the store or the DB (F5/2.2: nothing can be persisted here without a schema change, and none is wanted). A page reload silently loses this banner — stated plainly as a known, accepted rough edge of the stateless design, not hidden. Cleared either by the user cancelling, or by the confirm-email `GET` redirect landing back on `/profile?digest_email_confirmed=1` (read via `useSearchParams`, then a fresh `GET /api/profile` picks up the now-confirmed `digest_email`, then strip the query param).

**Proposed copy** (plain, calm, per constraint vii):
- Section eyebrow: "Daily email"
- Helper text (toggle off): "Get your daily paper briefing by email, in addition to the in-app Past briefings."
- Helper text (toggle on): "Sending daily at {hour}:00 ({timezone}) to {address}."
- Hour label: "Send time"
- Address label: "Send to"
- Address helper (unchanged from account email): "Uses your account email."
- Address helper (pending): "Check {address} for a confirmation link. Until you click it, nothing is sent there."
- Confirmed banner (one-time, after redirect): "Confirmed — daily emails will go to {address}."
- Test button: "Send test email"
- Test button result (success): "Sent just now to {address}."
- Test button result (failure): "Couldn't send: {honest short reason}." (never a raw stack trace/internal error string — map to plain text)
- Test button result (rate-limited): "You've used today's 3 test sends. Try again tomorrow."
- Test button result (no address yet): "Add an email above first."

### 2.5 Store / API changes summary

- `web/src/store/profile.ts`: **no new setters needed** — all six already exist (F4). Only the page component's local pending-confirmation state is new, not a store field.
- `web/src/app/api/profile/route.ts`: add the F4/2.3 guard to `PUT`. `GET`/`profileRowToProfile` unchanged (already maps `digest_email` → `digestEmail`).
- `web/src/lib/usage/counters.ts`: add `testEmailDayKey(userId, now)` and `confirmEmailRequestDayKey(userId, now)`, exact shape of `deepReportDayKey`.
- New: `web/src/lib/email/confirm-token.ts` (sign/verify + email validate/normalize — reused by both the request and verify sides, and by the profile-page client for its own format check before submitting).
- New: a small confirmation-email content template (subject/html/text), following `digest-template.ts`'s existing conventions (table-based, inline-styled, reuse its `esc()` escaping and brand palette) — proposed as a new sibling file rather than growing `digest-template.ts` with an unrelated template; sent via the **existing, unmodified** `sendDigestEmail({ to, items: [], originUrl: "", render: {...} })` call shape — the same "empty items + `render` override" trick `handleConflictingEmailClaim` already uses, so **no change to `send-digest.ts` at all**.
- New: `web/src/app/api/profile/send-test-email/route.ts`, `web/src/app/api/profile/confirm-email/route.ts`.
- `web/src/app/profile/page.tsx`: new section (2.4).
- **Untouched, verified safe:** `test-digest/route.ts`, `digest/test/route.ts`, `dispatch-digests/route.ts`, `digest-retry.ts`, `send-digest.ts`, `prepare-due.ts`, `due-owners.ts`, `prepare-dashboards/route.ts`, `digest-template.ts` (only added to, via a new sibling file, not edited).

---

## 3. Tests first (RED list — write these before the fix, per C's own contract)

1. **Auth.** `POST /api/profile/send-test-email` and both methods of `/api/profile/confirm-email` return 401 with no Supabase session. (Mirrors `test-digest/route.test.ts`'s existing auth test shape.)
2. **Validation of one well-formed address.** `POST /api/profile/confirm-email` with a syntactically invalid address ⇒ 400; with one well-formed address ⇒ sends the confirmation email (mocked `sendDigestEmail`) and returns a generic "sent" response that doesn't leak whether the address exists elsewhere.
3. **Token tamper.** Flip one character in the signature half of a valid token ⇒ `GET` rejects, no DB write.
4. **Token expiry.** A token whose `exp` is in the past (inject via a pinned `now`, not real sleep) ⇒ rejected, no DB write.
5. **Token for another user.** A valid, unexpired token minted for user A, `GET`-ed while session user is B ⇒ rejected, no DB write, and critically: B's own `digest_email` is not touched either.
6. **Token re-use.** The same valid token `GET`-ed twice ⇒ **both succeed**, same resulting `digest_email`, second call is a no-op write, not an error (see 2.2's reasoning — do not accidentally test for single-use).
7. **Pending state.** After a successful `POST /api/profile/confirm-email`, the profile page shows the pending banner with the requested address; a subsequent `GET /api/profile` still reports the *old* (or absent) `digest_email` until the link is clicked (proves nothing was written by the request step).
8. **Rate limit — normal case.** 4th `POST /api/profile/send-test-email` in the same UTC day (with a stubbed clock/counter) ⇒ 429, honest retry message; first 3 succeed.
9. **Rate limit — counter store unreachable.** Stub `getCounterStore()` (or its `increment`) to return `{ value: 0, ok: false }` and assert the **POLICY-chosen** behavior explicitly (see POLICY #2) — either "still sends (fails open, consistent with the rest of the app)" or "refuses with a clear 'try again shortly' (fails closed, protecting the send budget)". Write the test for whichever the manager picks; do not leave this un-asserted.
10. **At-most-once-per-day (existing behavior, not new code).** Re-run (do not rewrite) `dispatch-digests/route.test.ts`'s and `idempotency.test.ts`'s existing `PEER_DIGEST_DEDUPE` on/off and true-concurrency suites unchanged, and confirm they still pass after this item's changes — this item must not touch `dispatch-digests/route.ts`'s dedupe logic at all. If any of them go red, STOP — that is a sign this item leaked into the cron path, which it must not.
11. **BYOK/Tier-0 untouched.** A test asserting `send-test-email`'s call into `runFeedPipeline` is made with `aiTier: 0` and no `systemSearchAllowed` key present at all (mock-call-shape assertion, same style as `route.test.ts`'s *"calls runFeedPipeline with a single argument... structurally cannot carry onFreshShortlist"*).
12. **Signed-out sees nothing.** A render test of the new profile section with `useAuthUser()` mocked to `signed-out`/`unconfigured`/`loading` ⇒ the whole section is absent from the DOM (not just visually hidden).
13. **The 'both'/'inapp' mapping.** Toggling on calls `updateDigestChannel("both")` and `updateDigestFrequency("daily")` (POLICY #6); toggling off calls `updateDigestChannel("inapp")` and leaves frequency alone. A store-level or component-level test, whichever this codebase's existing `EditView` field tests already use as their pattern.
14. **F4 guard.** `PUT /api/profile` with a `digestEmail` that is neither the account email nor the currently-stored value ⇒ 400 `digest_email_requires_confirmation`, and the row is unchanged; with a value equal to either ⇒ succeeds exactly as today.

---

## 4. Ordered C steps

1. Baseline: from `web/`, run `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`; record exact pass/fail counts before touching anything (§3a).
2. Add `web/src/lib/usage/counters.ts`: `testEmailDayKey`, `confirmEmailRequestDayKey` (+ tests).
3. Add `web/src/lib/email/confirm-token.ts`: sign/verify + email validate/normalize (+ RED tests #3–#6 first, then make them pass).
4. Add the confirmation-email content template (new sibling file to `digest-template.ts`).
5. Add `web/src/app/api/profile/confirm-email/route.ts` (`POST` then `GET`) (+ RED tests #1, #2, #5–#7).
6. Add `web/src/app/api/profile/send-test-email/route.ts`, reusing `test-digest/route.ts`'s exported conversion helpers (+ RED tests #1, #8, #9, #11).
7. Add the F4 guard to `PUT /api/profile` (+ RED test #14). Run `profile/route.test.ts` in full afterward — confirm no existing case regresses.
8. Wire `web/src/app/profile/page.tsx`: new section, copy from §2.4, confirmation redirect handling (+ RED tests #12, #13).
9. Confirm (do not modify) `dispatch-digests/route.test.ts` and `idempotency.test.ts` still pass unchanged (RED test #10 is really "stays green").
10. Full gate: `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` from `web/`. Record exact results.
11. Write the C checkpoint per §2's required output shape (files changed, before/after test counts, remaining gaps, exact resume action).

File list (new): `web/src/app/api/profile/send-test-email/route.ts`, `web/src/app/api/profile/send-test-email/route.test.ts`, `web/src/app/api/profile/confirm-email/route.ts`, `web/src/app/api/profile/confirm-email/route.test.ts`, `web/src/lib/email/confirm-token.ts`, `web/src/lib/email/confirm-token.test.ts`, a new confirmation-email template file + test.
File list (modified): `web/src/lib/usage/counters.ts` (+ test additions), `web/src/app/api/profile/route.ts` (+ test additions), `web/src/app/profile/page.tsx`, `web/.env.example`, `docs/JEV-RELEASE-READINESS.md`.

---

## 5. Docs to update

- `docs/JEV-RELEASE-READINESS.md`: decision #7 row → "built" once C lands it (per task instruction); also note there, next to the existing `PEER_DIGEST_DEDUPE` row (line ~502), that the flag still needs the migration applied before it can be turned on — do not let a reader think this item alone makes `PEER_DIGEST_DEDUPE=on` safe.
- `web/.env.example`: add **`RESEND_API_KEY`** and **`DIGEST_FROM_EMAIL`** — currently used by `send-digest.ts` but **not documented anywhere in `.env.example`** today (checked; genuinely absent). Add **`DIGEST_EMAIL_CONFIRM_SECRET`** (new, §2.2) with a comment explaining it's independent of `CRON_SECRET` and what an empty value does (500, not an insecure default). State plainly in all three comments: these are what a local "test fire" needs in `web/.env.local`, and (per F7) an unverified Resend sender can only deliver to the Resend account owner's own address.

---

## 6. Gates

From `web/`, each run and recorded separately (not chained to hide a failure), per §3a:
```
npx vitest run
npx tsc --noEmit
npx eslint .
npm run build
```

---

## 7. POLICY — manager decides

1. **`PEER_DIGEST_DEDUPE`:** confirmed the flag must stay off until the user applies `20260924000300_briefing_deliveries_dedupe.sql` to production (their own explicit DB action, §1y point 4). This item does not change that migration's status. Manager/user decides when (if ever, before this item ships) to apply it.
2. **Fail-open vs fail-closed for the two new daily counters** (test-email 3/day, confirm-email-request N/day) when `usage_counters` is unreachable. Every existing *rate limit* in this codebase fails open (F3); every existing *wallet breaker* fails closed. This item's counters exist to protect send budget/abuse, which argues for fail-closed, but that is an inconsistency with the rest of the app's rate-limit convention worth a deliberate ruling rather than a silent pick. **B's recommendation: fail closed for both new counters** (protecting the email-send budget matches the reason `test-digest` was gated local-only in the first place — F2), but flagged for confirmation since it's a real precedent change.
3. **Whether `usage_counters`/`increment_usage_counter` is actually applied in the real production Supabase today** could not be confirmed statically (F3). Recommend a 30-second live check (does the already-shipped deep-report quota display on the profile page show a real non-zero used-count in production today?) before relying on the daily caps actually enforcing anything live.
4. **Exact daily caps:** test-email = 3 is given (§1y point 2.iv); confirm-email-request = 5/day is B's own proposal (this address-confirmation send reaches an *arbitrary* address the user types, not only their own — a bigger abuse surface than the test-email send, and worth its own explicit cap and number, not an assumed reuse of "3").
5. **Confirmation token TTL** — proposed 24h, independent of the unrelated 23h Resend idempotency-replay window already in `digest-retry.ts`. Confirm or adjust.
6. **Force `digest_frequency = 'daily'` on toggle-ON, not just `digest_channel = 'both'`.** The manager's spec (§1y point 2.vi) named only channel; B recommends also writing frequency explicitly so the "fixed DAILY" product promise holds even for a hypothetical pre-existing non-daily row from the pre-ceee6200 UI, which the new screen never shows. Confirm or override.
7. **New secret name `DIGEST_EMAIL_CONFIRM_SECRET`** (vs. any other name, or, if the manager prefers, reusing `CRON_SECRET` despite the trust-boundary argument against it in F5/§2.2). Confirm naming.
8. **New route paths** `/api/profile/send-test-email` and `/api/profile/confirm-email` — confirm naming, given this codebase's own history of confusing near-identical route names (`test-digest` vs `digest/test`, F2).
9. **No-session-at-link-click behavior:** confirmed dropped/redirected-to-sign-in rather than threaded through OAuth (§2.2) — confirm this scope boundary is acceptable, or ask for the OAuth-carry-through version (bigger change, touches `use-auth-user.ts`'s `signInWithGitHub`).
10. **Email format validation strictness** — B proposes a pragmatic (not full RFC 5322) regex, written once and shared between the confirm-email-request route and the profile page's own client-side check. Confirm this is sufficient.
11. **F7's Resend sandbox-sender claim** (only the Resend account owner's own address is deliverable pre-domain-verification) should be re-confirmed by the user directly against their own Resend dashboard/docs before the local-test instructions in `.env.example` are finalized — the one doc page fetched during this investigation did not state the limit explicitly, only implied it via the domain-verification requirement.
