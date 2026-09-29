STATUS: COMPLETE — all 5 tasks complete. Hypothesis (1) (the proxy drops rotated cookies) is REFUTED by execution. The most likely remaining cause is an unlocked, concurrent-refresh race across separate Supabase client instances (browser tab, proxy, route handlers, prefetches) with no shared lock server-side — structurally proven by execution, not proven to be the actual live trigger (would need the Supabase Auth Logs, which I have no access to). A second, currently-inert-but-real silent-failure mode was also proven by execution in `web/src/lib/supabase/server.ts`. See Task 4 for the full ranked list and Task 5 for fixes/tests/POLICY.

# SESSION-REFRESH — B investigation guide (Problem 1 of ACCOUNT-SESSION-SYNC)

Investigator: B (read-only on product code). Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD 47c4a1db at start. Production: https://peer.homes.

Scope: this item narrows in on the refresh-token mechanics behind Problem 1 ("signed in with Google on Edge, cookie-clearing off, reopened later and signed out"), given new facts from the user's Supabase dashboard: reuse detection for refresh tokens is ON (10 s reuse interval), and no dashboard-level session timeout is set. Manager's leading hypothesis: somewhere a token refresh happens whose rotated tokens never reach the browser's cookies, so the browser later presents an already-rotated (stale) refresh token, which Supabase's reuse detection treats as theft and revokes the whole session.

This guide is written incrementally; STATUS at the top and per-section reflects the true state at every point, not just at the end.

---

## Task 1 — Enumerate every Supabase client creation site

STATUS: COMPLETE — confirmed by reading the shipped code and the installed `@supabase/ssr` (v0.10.2) / `@supabase/auth-js` source under `web/node_modules`, plus the installed Next.js (16.2.3) docs under `web/node_modules/next/dist/docs`.

Four creation sites total. No other file in `web/src` constructs a Supabase client independently — every route handler that needs one imports the shared `web/src/lib/supabase/server.ts` helper (confirmed by grepping every `@supabase/ssr`/`@supabase/supabase-js` import across `web/src`; see file list below).

### 1. Browser client — `web/src/lib/supabase/client.ts:15-28`

`createClient()` (line 15) calls `createBrowserClient(url, key)` with no `cookies` option. Exported singleton `supabase` (lines 23-28), used from `web/src/components/account/use-auth-user.ts:16` (`getUser()` at line 31, `onAuthStateChange` at line 36), `web/src/components/feed-sync.tsx:18`, `web/src/components/profile-sync.tsx:27`.

- Cookie adapter: none passed → `@supabase/ssr`'s `createStorageFromOptions` (`web/node_modules/@supabase/ssr/dist/main/cookies.js:91-106`) falls back to the plain `document.cookie` API — `getAll` parses `document.cookie`, `setAll` does `document.cookie = serialize(name, value, options)` per cookie.
- Can write cookies back: yes, directly and synchronously.
- Can trigger a refresh: yes. `createBrowserClient` defaults `autoRefreshToken: options?.auth?.autoRefreshToken ?? isBrowser()` (`web/node_modules/@supabase/ssr/dist/main/createBrowserClient.js`, ~line 34) — since `client.ts` passes no `auth` option, this is `true` in a real browser. That starts a background ticker (`_autoRefreshTokenTick`, `GoTrueClient.js:4162`) every `AUTO_REFRESH_TICK_DURATION_MS` = 30s (`auth-js/dist/main/lib/constants.js:6`), independent of navigation — the browser tab can refresh the session while just sitting open and idle.
- Also notable: `createBrowserClient` caches a **module-level singleton** (`cachedBrowserClient`, `createBrowserClient.js:8-13`) whenever `isBrowser()` is true — so no matter how many times `createClient()` is called client-side, it is the same one GoTrueClient instance per tab. Cross-tab (not cross-instance-within-a-tab) coordination is the only real concern — see below.
- Locking: refresh calls run inside `_acquireLock` (`GoTrueClient.js:2240-2292`), which in a browser uses `navigatorLock` (`auth-js/dist/main/lib/locks.js`) — the real cross-tab Web Locks API (`navigator.locks.request(...)`, exclusive mode), supported by Edge. So two tabs of the *same* browser cannot both be mid-refresh at once; whichever tab acquires the lock second will, inside `__loadSession()` (`GoTrueClient.js:2315-2322`), **re-read the cookie from storage first** and see the other tab's already-rotated tokens rather than blindly reusing a stale in-memory copy — `__loadSession` never trusts an in-memory cache, it always calls `getItemAsync(this.storage, this.storageKey)` first. This is a real protection and it rules out the plain "two tabs of the same browser race each other" version of hypothesis (4).

### 2. Server client — `web/src/lib/supabase/server.ts:7-32`

`createClient()` calls `createServerClient(url, key, {cookies: {getAll, setAll}})`, cookies via `next/headers`'s `cookies()`. `getAll` at lines 16-18. `setAll` at lines 19-28, wrapped in a try/catch whose comment says "Called from a Server Component — cookies are read-only there... this failure is expected and safe" — it swallows **any** error, not just that one.

Used from, confirmed by grepping every `@/lib/supabase/server` import in `web/src` (excluding `*.test.ts`): `web/src/app/auth/callback/route.ts:5`, `web/src/app/auth/signout/route.ts:2`, and the route handlers `app/api/profile/route.ts`, `app/api/feed/route.ts`, `app/api/feed/archive/route.ts`, `app/api/feed/ack/route.ts`, `app/api/saved/route.ts`, `app/api/read/route.ts`, `app/api/briefings/route.ts`, `app/api/feedback/route.ts`, `app/api/test-digest/route.ts`, `app/api/profile/send-test-email/route.ts`, `app/api/profile/confirm-email/route.ts`, plus three `lib/` helpers (`lib/security/ai-request.ts`, `lib/security/company-spend.ts`, `lib/papers/upload-access.ts`) that are themselves only ever imported from `route.ts` files or other server-only `lib/` modules (confirmed by a second grep for each of those three helpers' own importers — every hit is a `route.ts` or a non-component `.ts` lib file; **none is imported from any `.tsx` file**, i.e. never from a Server Component).

- Can write cookies back: **depends on context.** The installed Next.js docs (`web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, lines 6 and 79-82) state plainly: `cookies()` lets you "read/write outgoing request cookies in Server Functions or Route Handlers," but "Setting cookies is not supported during Server Component rendering." Every real call site of `server.ts`'s `createClient()` in this app is a Route Handler (or a lib helper only called from one) — i.e. **the try/catch's only documented failure case never actually occurs in this app's shipped code today.** This narrows hypothesis (2) considerably: the defensive code is shaped exactly like the classic bug, but nothing in this repo currently drives it down the swallowed-error path.
- Can trigger a refresh: yes, any `getUser()`/etc. call can trip `__loadSession()`'s auto-refresh-if-near-expiry logic (see below).

### 3. Middleware/proxy client — `web/src/lib/supabase/middleware.ts:8-38`

Used only inside `updateSession()`, called from `web/src/proxy.ts:5` on every request matching `proxy.ts`'s `config.matcher` (`proxy.ts:8-13`).

- Cookie adapter: `getAll` reads `request.cookies` (line 20). `setAll` (lines 22-29) writes to **both** `request.cookies` (line 23-24) *and* rebuilds `response = NextResponse.next({ request })` (line 26) before writing the same cookies onto `response.cookies` (line 27-29) — matching the documented `@supabase/ssr`-for-Next.js pattern (reassign the response inside `setAll`, return that same variable at the end).
- Writing to `request.cookies` first is not decorative: the installed Next.js proxy doc (`web/node_modules/next/dist/docs/.../proxy.md`, "Setting Headers" section, lines 386-430) documents that `NextResponse.next({ request: { headers } })` is how you "make [a mutation] available upstream" to the Route Handler/Server Component that runs next for the *same* request — cookies are "regular headers" per the same doc's "Using Cookies" section (line 310). So a rotated cookie written this way should already be visible to whatever runs downstream in the same request, before that downstream code gets a chance to decide for itself whether a refresh is needed.
- Can write cookies back: yes — this is the one client explicitly built to reliably do so, and it is verified by execution in Task 2 below.
- Can trigger a refresh: yes, via `await supabase.auth.getUser()` (line 35).

### 4. Admin client — `web/src/lib/supabase/admin.ts:7-18`

Service-role key, `persistSession: false, autoRefreshToken: false` (lines 15-17) explicit, no `cookies` option at all. Cannot write cookies, cannot trigger a session refresh — not a session-bearing client. Out of scope for this item, unchanged from the prior ACCOUNT-SESSION-SYNC-B investigation's conclusion.

### How `createServerClient` actually flushes cookies (applies to both #2 and #3)

`createServerClient()` itself (`web/node_modules/@supabase/ssr/dist/main/createServerClient.js:46-64`) registers one internal `client.auth.onAuthStateChange(async (event) => {...})` listener that calls `applyServerStorage()` — which is what actually invokes the app-supplied `setAll` — **only** on `SIGNED_IN`/`TOKEN_REFRESHED`/`USER_UPDATED`/`PASSWORD_RECOVERY`/`SIGNED_OUT`/`MFA_CHALLENGE_VERIFIED`, and only when there's something queued to write (batches everything into one `setAll` call per event, per `cookies.js:216-290`).

Every place in `GoTrueClient.js` that fires one of those events (`_callRefreshToken`, lines 3877-3918; `_saveSession`/`_notifyAllSubscribers`, used throughout) is `await`-ed by its caller, all the way up to whatever top-level method the app called (`getUser`, `exchangeCodeForSession`, `signOut`, etc.) — and `_notifyAllSubscribers` itself (lines 3919-3946) does `Promise.all(...)` over every registered listener and awaits it before returning. **Every call site in this app's own code awaits the top-level Supabase call** (`await supabase.auth.getUser()` in `middleware.ts:35` and `use-auth-user.ts:31`; `await supabase.auth.exchangeCodeForSession(code)` in `auth/callback/route.ts:14`; `await supabase.auth.signOut()` in `auth/signout/route.ts:6`). So: **the cookie adapter's `setAll` is guaranteed to have already been called by the time the app's own `await` resolves** — the risk under hypothesis (2)/(3) is not timing/ordering, it is specifically "does that `setAll` call's write actually *persist*," which is a per-adapter question answered above (persists for #3 always; persists for #2 in every context this app actually uses it in; would silently no-op for #2 only in a Server Component, which this app does not currently do).

### When a refresh actually happens

`__loadSession()` (`GoTrueClient.js:2315-2378`) always re-reads the current session from the adapter's storage first (line 2322), and only calls `_callRefreshToken` (the thing that rotates the refresh token and writes cookies) if the access token has under `EXPIRY_MARGIN_MS` left — `EXPIRY_MARGIN_MS = AUTO_REFRESH_TICK_THRESHOLD(3) * AUTO_REFRESH_TICK_DURATION_MS(30000ms) = 90 seconds` (`auth-js/dist/main/lib/constants.js:6,9,13`). Given the dashboard's 3600-second access-token expiry (per the brief), a real rotation happens roughly once per hour of continued use, not on every single `getUser()` call — most `getUser()` calls (including most proxy runs) touch storage, see a still-fresh access token, and return without writing anything.

### The gap: no cross-request lock on the server side

`updateSession()` builds a **brand-new** `createServerClient(...)` (`middleware.ts:17`) on every single invocation — i.e. a fresh GoTrueClient with `refreshingDeferred = null`, no memory of any other in-flight request. `server.ts`'s `createClient()` does the same (`server.ts:10`) for every route handler call. Unlike the browser's cross-tab `navigator.locks` protection (Task 1 §1 above), **there is no equivalent lock across two concurrent requests that both reach the proxy (or a route handler) at nearly the same moment** — e.g. a page navigation plus a fetch it kicks off on mount, or several Next.js Link prefetches firing close together. If the access token is within its last 90 seconds of life when two such requests both land, each independently decides to refresh, with nothing in this repo's code coordinating between them. Measured by execution in Task 2.

---

## Task 2 — Prove by execution: does the proxy's response carry rotated cookies?

STATUS: COMPLETE — **hypothesis (1) is REFUTED.** The proxy correctly returns the response it wrote rotated cookies to, in every request shape tested. A different, real gap was found instead (see below).

Probe: `web/src/lib/supabase/__b_account_probe_session_proxy.test.ts` (6 tests, all passed, deleted after running — see the probe-files list at the end). Runs the real, unmodified `updateSession()` from `web/src/lib/supabase/middleware.ts` and the real `proxy()` from `web/src/proxy.ts`; only `@supabase/ssr`'s `createServerClient` is mocked, standing in for a Supabase auth client that has decided a refresh is needed and rotates the session (the mock calls the app's own `setAll` with new tokens before resolving, mirroring the real library's confirmed-by-reading behavior from Task 1). No network.

Results:
1. A request to `/` (a normal page) — the returned response carries the rotated `sb-access-token`/`sb-refresh-token` cookies. PASS.
2. A request to `/api/profile` (an API route) — same result. PASS.
3. A request to `/auth/callback?code=...` (the OAuth callback path) — same result. PASS.
4. `proxy()` itself (not just `updateSession()`) returns that same response unmodified — no wrapper in `proxy.ts` drops or replaces it. PASS.
5. Control case: when the mock does not rotate (simulating a still-fresh access token), the response carries no session cookies at all — the proxy doesn't accidentally touch cookies on every request, only on an actual refresh. PASS.
6. **The one new, confirmed-by-execution finding this task produced:** two `updateSession()` calls issued back-to-back with `Promise.all` (simulating two requests leaving the browser at nearly the same instant — e.g. a page navigation plus a `fetch()` it kicks off on mount, or two Next.js Link prefetches — both still carrying the same not-yet-rotated cookie), each independently decided to refresh and each returned a **different** rotated cookie pair. Nothing in `updateSession()`/`proxy.ts` de-duplicates or coordinates concurrent requests — this matches the "gap" already identified by reading in Task 1 (`updateSession()` builds a brand-new, unlocked `createServerClient()` per call), now confirmed to actually behave that way rather than just being theoretically possible.

Matcher (which paths skip the proxy): unchanged since the prior ACCOUNT-SESSION-SYNC-B investigation (`web/src/proxy.ts:8-13`, byte-identical `config.matcher` string, confirmed by reading it again this round) — that investigation already proved by execution that `/`, `/profile`, `/api/profile`, `/auth/callback`, and `/papers/abc123`-shaped paths are all matched (refreshed), and only `_next/static`, `_next/image`, `favicon.ico`, `icon.svg`, `logo.png`, other icon variants, and common static-asset extensions are excluded. Not re-executed this round since the code has not changed; citing rather than duplicating. This means hypothesis (3) ("routes excluded by the matcher refresh on their own") has no real targets in this app — every route that creates a session-bearing client (Task 1's enumeration) is inside the matched set.

---

## Task 3 — Server-side refresh paths with non-persisting cookie adapters

STATUS: COMPLETE

Probe: `web/src/lib/supabase/__b_account_probe_session_servercomponent.test.ts` (2 tests, both passed, deleted after running). Runs the real, unmodified `createClient()` from `web/src/lib/supabase/server.ts` against two fake `next/headers`-shaped cookie jars — one whose `set()` succeeds (a Route Handler) and one whose `set()` throws (a Server Component, per the installed Next.js docs' own wording, quoted in Task 1). `@supabase/ssr`'s `createServerClient` is mocked the same way as Task 2, to force a rotation on every call. No network.

Results:
1. **Route-Handler-shaped store:** the rotated `sb-access-token`/`sb-refresh-token` values are found in the fake jar afterward — confirms the happy path this app actually uses (every real caller of `server.ts`, per Task 1's grep) works correctly.
2. **Server-Component-shaped store:** `supabase.auth.getUser()` still resolves normally — `error: null`, a real user comes back — **no exception, no rejected promise.** The fake jar's `set()` was called with the rotated values (`attempted` records it — proving Supabase-side did consider the token rotated), but `getAll()` afterward still shows only the original `OLD-ACCESS`/`OLD-REFRESH` values — **the rotation is completely lost, and nothing anywhere is told.** This is exactly hypothesis (2)'s mechanism, confirmed to be exactly as silent and as dangerous as described, if it is ever exercised.

Whether it is exercised in this app today: **no**, per Task 1's grep — every real call site of `server.ts`'s `createClient()` is a Route Handler (`route.ts`) or a `lib/` helper only ever imported by one, never a Server Component (`.tsx` page/layout). So the try/catch's dangerous branch exists in the code but is not currently reachable from any real request in this app.

Does the proxy guarantee a fresh access token before these run: **yes, by the documented mechanism**, for every request that reaches a Route Handler through the normal Next.js request path. `web/src/lib/supabase/middleware.ts`'s `setAll` writes to `request.cookies` *before* rebuilding the response (`middleware.ts:22-26`), and the installed Next.js proxy doc (`web/node_modules/next/dist/docs/.../proxy.md`, "Setting Headers", lines 386-430) documents that passing the mutated `request` into `NextResponse.next({request})` is what "make[s] \[a mutation\] available upstream" to whatever runs next in the *same* request. Since cookies are "regular headers" per the same doc (line 310), a Route Handler's own `cookies()` call (via `next/headers`) should see the already-rotated value from the proxy's pass, and its own `getUser()`/etc. call should find the access token no longer near-expiry and skip refreshing a second time — meaning `server.ts`'s risky branch would stay cold even if it were reachable, *for requests the proxy actually got to see first*. This guarantee is scoped to the matcher (Task 2) and to a single request's own proxy→handler chain — it says nothing about a *different*, concurrent request (Task 2 finding #6) or about `server.ts` being reached from some future Server Component, which is a real code-shaped risk even though it is inert today.

---

## Task 4 — Ranked causes with evidence

STATUS: COMPLETE

### Ruled out this round, by the new dashboard facts stated in the brief itself

"Time-box user sessions" = never, "Inactivity timeout" = never, "Enforce single session per user" = OFF. All three close out open items from the prior ACCOUNT-SESSION-SYNC-B doc's Task-1/Task-4-addendum lists — none of them can be the cause, per the facts already supplied.

### Ruled out this round, by reading + execution

- **Hypothesis (1)** — the proxy's response doesn't carry the cookies it wrote. **REFUTED** (Task 2, 6/6 tests). `updateSession()`/`proxy.ts` return the correctly-cookied response for page, API, and callback-path requests alike.
- **Hypothesis (3)** — a route excluded by the matcher refreshes on its own with a broken client. **Not applicable.** The matcher (unchanged, previously proven by execution) covers every route that creates a session-bearing client; the only client with a non-cookie adapter (`admin.ts`) never touches user sessions (Task 1).
- **Hypothesis (5)** — the OAuth callback route's cookie writes. **Low likelihood as an ongoing mechanism.** It uses `server.ts`'s adapter in a Route Handler context, proven correct in that context (Task 3, test 1); it also only runs once, at sign-in — it cannot by itself explain a session that goes bad *later*, after working correctly for a while, which is what was reported.

### Ranked remaining causes

**1. (Most likely code-adjacent mechanism — moderate confidence, structurally proven, not proven to be the actual trigger) Concurrent, uncoordinated refreshes racing on the same starting refresh token.**

Mechanism: the browser holds refresh token N. At some moment the access token is within its last 90 seconds of life (`EXPIRY_MARGIN_MS`, Task 1) and **more than one independent request presents token N at nearly the same instant** — any combination of: the browser's own client refreshing via its background ticker (`client.ts`), a page navigation reaching the proxy, a `fetch()` a mounted component kicks off on load (`profile-sync.tsx`/`feed-sync.tsx`/`use-auth-user.ts` all fire on mount), or a Next.js Link prefetch (also proxy-matched). Every one of these is backed by its *own*, separate GoTrueClient instance. Task 1 (reading) established that only same-browser tabs get real cross-instance coordination, via `navigator.locks` (`auth-js/lib/locks.js`); a browser instance racing a server (proxy/route-handler) instance, or two server instances racing each other, have **no shared lock at all** — `updateSession()` and `server.ts`'s `createClient()` both build a brand-new, unlocked client per call (Task 1). Task 2's execution (test 6) confirmed this is not just theoretical: two concurrent `updateSession()` calls sharing a starting cookie each independently rotated to a **different** result.

Why this fits the specific report: reuse detection is ON with only a 10-second reuse interval (brief). If any one of these uncoordinated, concurrent rotations produces a result that never actually lands in the browser's cookie jar — whether because a background/prefetch response's `Set-Cookie` isn't applied the same way a top-level navigation's is, or because a slower response's stale-relative-to-another-rotation cookie overwrites a newer one — the browser is left holding a refresh token that Supabase already considers superseded. That specific token then sits unused in a 400-day cookie (prior investigation) until the browser is reopened, at which point it is presented **far** outside the 10-second grace window, and reuse detection revokes the whole session — exactly "signed in, reopened later, signed out."

What I could not confirm: whether Supabase's server-side grace-window handling of *concurrent* presentations of the same token (as opposed to a single later, stale one) ever actually drops a legitimately-issued rotation the way this theory needs — that behavior lives in Supabase's hosted GoTrue backend, not in this repo, and I made no network calls this round. I also could not reproduce an actual end-to-end "reopen the browser and get revoked" sequence — that would need a live session and is out of scope (no network, no sign-in, per this item's constraints).

**2. (Real, currently-inert structural risk — not today's active cause, but a landmine) `server.ts`'s silently-swallowed cookie-write failure — hypothesis (2)'s exact mechanism.**

Task 3 proved by execution that if `web/src/lib/supabase/server.ts`'s `createClient()` is ever used somewhere `cookies().set()` throws (a Server Component, per the installed Next.js docs), a real token rotation is silently and completely lost — no exception, no rejected promise, nothing logged, `getUser()` returns success regardless. Task 1's grep, however, found every real call site of this function in the shipped app is a Route Handler (or a `lib/` helper only ever imported by one) — never a Server Component. So this mechanism is not firing today, but it would silently reintroduce this exact bug the moment anyone adds a session-checking call to a page/layout Server Component, with no test anywhere positioned to catch it.

**3. (Restated from the prior investigation, still open, lower likelihood for *this specific* report) The `.vercel.app` alias host-fragmentation gap.**

Already confirmed real in `docs/jev-abc/ACCOUNT-SESSION-SYNC-B-20260929T220146Z.md` (Task 1): the session cookie has no `domain` attribute, and `hermes-flax-six.vercel.app` serves the same build as `peer.homes` without redirecting. This explains "signed in on one host, signed out on another host" — it does not by itself explain reuse-detection-driven revocation, and the user's report this time names peer.homes specifically on Edge, not a host switch. Still worth fixing (unchanged recommendation), just ranked lower as the explanation for *this* report specifically.

### What would confirm rank 1

Supabase dashboard → **Authentication → Logs** (sometimes labelled Logs & Reports → Auth logs, or the Logs Explorer filtered to the Auth source) → search/filter around the timestamp the user noticed being signed out. Look for an auth log entry whose event/message indicates a refresh token was already used / reuse was detected, or that a session was revoked for that reason (GoTrue logs these as a distinct error type, separate from an ordinary expired-token error). A matching entry at the right time would confirm reuse detection actually fired (rank 1's proximate trigger); it would not, by itself, show *which* concurrent request presented the stale token first — that part stays inferential from the code. This does not require sharing any secret, key, or token value — only the presence, timestamp, and event type of a log line.

---

## Task 5 — Fix options, tests, POLICY list

STATUS: COMPLETE

### Fix options (code-side — reuse detection stays ON; the fix targets "stop presenting stale tokens," not "stop checking for them")

**A. Coordinate concurrent refreshes so at most one actually reaches Supabase per near-expiry window, for rank-1.**
- A1. Add a short-lived, cross-request marker (e.g. a cookie such as `sb-refresh-lock` written with a few-seconds `maxAge`) that `updateSession()` checks before calling `auth.getUser()`: if a refresh looks already in flight (marker present and fresh), skip triggering a second independent refresh from this request and just pass the existing cookies through, rather than racing. This gives the proxy/server side the same kind of protection `navigator.locks` already gives same-browser tabs (Task 1), without needing new infrastructure — it's a cookie, like everything else in this flow.
- A2. Independent of A1, reduce how many concurrent requests can be in flight at the exact moment a refresh is due: `use-auth-user.ts`, `profile-sync.tsx`, and `feed-sync.tsx` all fire their own request on mount today (Task 1/4). Sequencing or gating these behind a single "auth is ready" signal shrinks the race window generically, regardless of whether A1 ships.
- A3. A shared KV/Edge-Config-backed lock would be more robust than a cookie marker (immune to a client that just doesn't send it back in time) but needs infrastructure this investigation did not verify is already wired up app-wide — flagged, not recommended over A1 without the manager confirming that's available.

**B. Stop silently swallowing cookie-write failures in `server.ts` (closes rank 2).** Today's catch block (`server.ts:24-27`) is unconditional and silent. Since Task 1/3 established this app never legitimately hits the failure case today, the safe change is: log a warning whenever the catch actually fires (e.g. `console.warn` with the route/context), so a future regression (a Server Component gaining a session-refreshing call) is visible in logs instead of invisible. This is a small, low-risk, purely-additive change.

**C. Explicitly not recommended:** disabling "Detect and revoke potentially compromised refresh tokens." It is a real security feature working as designed; the bug (if rank 1 is confirmed) is this app's, not the feature's.

**D. Longer-term, dashboard-only, not scoped here:** raising the Supabase access-token expiry (currently 3600s) would mechanically reduce how often a refresh — and therefore the race window in rank 1 — occurs at all, at the cost of a longer-lived access token if one is ever stolen. A dashboard/security trade-off for the user/manager to weigh, not a code change, and not decided in this guide.

### Tests needed

1. Convert Task 2's probe into permanent coverage for `web/src/lib/supabase/middleware.ts` (currently zero, confirmed again this round, same gap the prior investigation already flagged): rotated cookies reach the response for a page, an `/api/*` route, and the callback path; a control case proves no-refresh writes nothing.
2. Convert Task 3's probe into permanent coverage for `web/src/lib/supabase/server.ts`: the Route-Handler-shaped success case, and (once fix B ships) that the Server-Component-shaped failure case now logs a warning instead of vanishing silently.
3. If fix A1 ships: a regression test that two concurrent `updateSession()` calls sharing a starting refresh token no longer each independently rotate to a different result — this is the direct test for the exact gap Task 2 proved exists today (its test 6 should flip from "both differ" to "coordinated," or be replaced by one that asserts the new coordinated behavior).
4. If fix B ships: a test that the new logging path actually fires on a simulated write failure, so this early-warning mechanism has its own coverage.

### POLICY list for the manager

1. Whether to build fix A (concurrency coordination) now, given rank 1 is confirmed-possible but not confirmed-actual — I recommend checking the Auth Logs (see Task 4) first, since it's free and would turn this from "plausible" into "confirmed" or rule it out; build A2 (reduce redundant mount-time requests) regardless, since it's a small, generically-good change independent of whether it's the cause; hold A1's added complexity (cookie-based lock) for after the logs are checked, unless the manager prefers to ship it defensively now.
2. Whether to ship fix B (log instead of silently swallowing in `server.ts`) now as prevention — I recommend yes; it is small, additive, and closes a real (if currently inert) silent-failure mode for near-zero risk.
3. Whether to pursue fix D (raise access-token expiry) — a dashboard-only security trade-off outside this repo's code; needs the user's/manager's own judgment, no position taken here.
4. What to ask the user to check: Supabase dashboard → Authentication → Logs, around the timestamp they noticed being signed out, for a refresh-token-reuse/session-revoked entry (exact guidance in Task 4). No secret needs to be shared back — only whether such an entry exists and when.
5. This document narrows and supersedes the prior `ACCOUNT-SESSION-SYNC-B` doc's Task-1 line calling refresh-token rotation "low suspicion... noted only for completeness" — with reuse detection confirmed ON and a 10-second window, it is not low-suspicion. Recommend treating this document as the current word on Problem 1's refresh mechanics; that doc's other Problem-1 findings (400-day cookie `maxAge`, the `.vercel.app` alias gap, `proxy.ts`'s existence/correctness) still stand unchanged alongside it.
6. Scope boundary: keep this item's fix inside `web/src/lib/supabase/middleware.ts`, `web/src/lib/supabase/server.ts`, and (for A2) the three mount-time call sites named above. Do not fold in the `.vercel.app` alias fix (a separate, already-queued POLICY item from the prior doc) or any of Problem 2's profile-merge work, which another investigator is handling in parallel in different files.

---

## Probe files (temporary — created, executed, then deleted)

1. `web/src/lib/supabase/__b_account_probe_session_proxy.test.ts` — Task 2: proved the proxy/`updateSession()` carries rotated cookies through for page/API/callback-path requests, and that concurrent requests get no coordination (6 tests, all passed). Deleted.
2. `web/src/lib/supabase/__b_account_probe_session_servercomponent.test.ts` — Task 3: proved `server.ts`'s cookie write succeeds in a Route-Handler-shaped context and is silently lost in a Server-Component-shaped context (2 tests, both passed). Deleted.

Confirmed clean after deletion: `git status --short` shows no `__b_account_probe_session_` file remaining; the only new path introduced by this investigation is this guide itself, `docs/jev-abc/SESSION-REFRESH-B-20260929T222603Z.md`. No product file was edited. No network call was made (none permitted this round). No secrets, `.env`/`.env.local` contents, or API keys were read, printed, or written anywhere — all Supabase URLs/keys used in probes were obvious placeholder strings (`https://example-project.supabase.co`, `test-publishable-key-not-real`).
