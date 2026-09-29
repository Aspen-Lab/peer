STATUS: COMPLETE — original 5 tasks AND the FOLLOW-UP (manager's ping-pong hypothesis) both complete; see "FOLLOW-UP" section near the end for a design revision that supersedes part of the original Task 4/5 recommendation

# ACCOUNT-SESSION-SYNC — B investigation guide

Investigator: B (read-only on product code). Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD 47c4a1db at start. All findings below are either (a) confirmed by reading the shipped code and the installed library source, or (b) confirmed by EXECUTION — either a real unauthenticated HTTP GET to the three public hosts named in the brief, or a temporary probe test under `web/src/`, prefixed `__b_account_probe_`, run with `npx vitest run <file>` and deleted immediately after. No probe file remains (verified with `git status` after deletion — see the end of this document). No network call was made beyond the three plain GETs. No product file was edited.

User report (2026-09-29, paraphrased in the work-item brief):
1. Opening the browser and going to peer.homes shows signed-out, even though the reader signed in with Google before. Expectation: the site remembers the sign-in next time.
2. Signing in with the same Google account on a different computer did not bring over settings (including the display name) changed on the first computer.
Hypothesis given: both might share one cause (a browser silently signed out, so its changes stayed local). **Finding: this hypothesis is NOT confirmed.** The two problems have different, independently-confirmed mechanisms (see the summary at the end). They could still compound each other in one specific scenario (noted under Problem 1), but I found no evidence that one *causes* the other.

---

## Task 1 — Session persistence

STATUS: COMPLETE

### Where the session lives

Cookies, not `localStorage`. Confirmed by reading the installed `@supabase/ssr` (`web/node_modules/@supabase/ssr`, v0.10.2, used with `@supabase/supabase-js` v2.104.0):
- `web/src/lib/supabase/client.ts` — browser client, `createBrowserClient(url, key)`, no options. `@supabase/ssr`'s `createStorageFromOptions` (dist/main/cookies.js) falls back to the plain `document.cookie` API for storage when no `cookies` option is given in a browser context — so the singleton `supabase` client used by `useAuthUser` and everything else in the browser stores the session in cookies.
- `web/src/lib/supabase/server.ts` — server client for Server Components/route handlers, cookies via `next/headers`' `cookies()`.
- `web/src/lib/supabase/middleware.ts` — the request-scoped client used by the refresh step (see below), cookies via the request/response cookie jars.
- `web/src/lib/supabase/admin.ts` — not part of the session path (service-role client for server-only privileged reads; not reviewed further, out of scope for this report).

### Cookie attributes (read + proven by execution)

None of the three call sites above pass a `cookieOptions` override (confirmed by grep across `web/src` for `cookieOptions`/`domain:` — no matches outside unrelated files). That means every cookie this app writes gets `@supabase/ssr`'s own `DEFAULT_COOKIE_OPTIONS` (`web/node_modules/@supabase/ssr/dist/main/utils/constants.js`), which a probe test imported and asserted directly:

```
path: "/"
sameSite: "lax"
httpOnly: false
maxAge: 400 * 24 * 60 * 60   // 400 days
```

No `domain` key at all — confirmed by the same probe (`Object.prototype.hasOwnProperty.call(DEFAULT_COOKIE_OPTIONS, "domain")` is `false`). That makes the cookie **host-only**: a browser will only ever send it back to the exact host that set it, never to a sibling or parent host. This matters for the host-fragmentation finding below.

**Conclusion: by default, a signed-in session is built to survive a browser restart for 400 days.** This rules out "the cookie itself expires when the browser closes" as an explanation from the code side — nothing in this app shortens it.

### Refresh mechanism

There is no file literally named `middleware.ts` at the project root — **this Next.js version (16.2.3) renamed that convention to `proxy.ts`** (confirmed by reading `web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`: *"The `middleware` file convention is deprecated and has been renamed to `proxy`"*). `web/src/proxy.ts` exists, is correctly named/placed (`web/src/proxy.ts`, alongside `web/src/app`), exports a named `proxy` function and a `config.matcher`, exactly matching the current doc's contract. **This is not the classic "missing middleware" bug — the refresh step is present and correctly wired.**

```
web/src/proxy.ts        -> calls updateSession(request)
web/src/lib/supabase/middleware.ts -> updateSession(): creates a request-scoped
                                        Supabase client, calls
                                        `await supabase.auth.getUser()`
                                        ("Must touch user() to trigger a
                                        refresh if the access token is near
                                        expiry" — the file's own comment),
                                        writes any refreshed cookies onto
                                        the response.
```

`config.matcher` excludes only `_next/static`, `_next/image`, `favicon.ico`, `icon.svg`, `logo.png`, icon variants, and common static-asset extensions — every real page and API route is matched. Proven by execution (probe): the matcher regex, copied verbatim from `proxy.ts`, was tested against `/`, `/profile`, `/api/profile`, `/auth/callback`, `/papers/abc123` (all matched -> refreshed) and `/_next/static/chunk.js`, `/favicon.ico`, `/icon.svg`, `/logo.png`, `/foo.png` (all excluded, as intended).

Also proven by execution (probe, with `@supabase/ssr` mocked so nothing touched the network): calling the real `updateSession()` from `web/src/lib/supabase/middleware.ts` with a constructed `NextRequest` called the mocked `auth.getUser()` exactly once, and returned a real `NextResponse` with a working `cookies` jar. A second probe case confirmed `updateSession()` cleanly skips the Supabase call when `NEXT_PUBLIC_SUPABASE_URL`/key are absent (the documented self-hosted, no-Supabase path), rather than throwing.

Client-side, `web/src/components/account/use-auth-user.ts`'s `useAuthUser()` calls `supabase.auth.getUser()` on mount and subscribes to `onAuthStateChange`; `createBrowserClient`'s defaults (read from `web/node_modules/@supabase/ssr/dist/main/createBrowserClient.js`) are `autoRefreshToken: true`, `detectSessionInUrl: true`, `persistSession: true` in a browser context — the standard, correct set for a browser SPA session. Server-side, `createServerClient`'s defaults are `autoRefreshToken: false`, `persistSession: true`, `skipAutoInitialize: true` — also correct (the server doesn't need its own refresh timer; `proxy.ts` already refreshes on every request before any Server Component runs).

I also checked for an accidental/unconditional sign-out call anywhere in the app: there is exactly one, `web/src/app/auth/signout/route.ts`, reached only by the explicit "Sign out" form `POST /auth/signout` in `account-section.tsx`. No code path signs the reader out as a side effect of anything else.

### What the site shows on a fresh start

`AuthState` has four values (`web/src/components/account/use-auth-user.ts`): `unconfigured` (no Supabase at all), `loading` (client exists, hasn't asked yet — renders identically to `unconfigured`, i.e. nothing, so server and hydrating client agree), `signed-out`, `signed-in`. This is a normal, brief loading flash while `getUser()` resolves, not a bug.

### Host check — confirmed by real, unauthenticated GETs (the three allowed in the brief)

```
https://peer.homes/            -> 200 OK   (Vercel edge cache HIT, this deployment)
https://www.peer.homes/        -> 307 Temporary Redirect -> https://peer.homes/
http://peer.homes/             -> 308 Permanent Redirect -> https://peer.homes/
https://hermes-flax-six.vercel.app/ -> 200 OK, DIRECTLY — same ETag and
                                        Content-Length as peer.homes (same
                                        build), but NO redirect to peer.homes.
```

**This is the one part of task 1 I can call a confirmed, real gap, not just a hypothesis:** `www.peer.homes` and plain `http://` both correctly redirect to the canonical `https://peer.homes/`. The Vercel-assigned alias `hermes-flax-six.vercel.app` does **not** — it serves the exact same site on a second, independent host. Because the session cookie is host-only (no `domain` attribute, confirmed above), a session set on one of these two hosts is invisible on the other.

Why this can matter for sign-in specifically: `web/src/components/account/use-auth-user.ts`'s `signInWithGoogle`/`signInWithGitHub` build `redirectTo` from `window.location.origin` — i.e., **whichever host the browser is actually on when the button is clicked** is the host the entire OAuth round trip returns to, and therefore the host the cookie lands on. If a reader ever reaches the site via the `.vercel.app` alias (an old bookmark, a shared link, a search result before the custom domain was indexed) and signs in there, and later types `peer.homes` directly, the two hosts would show different sign-in states — matching complaint 1 exactly.

I could **not** fully confirm this is what happened to the user, for one reason I could not verify: Supabase's OAuth redirect step only honors a `redirectTo` that matches the project's **Redirect URLs allow-list** (a Supabase dashboard setting); if a URL isn't on that list, Supabase's documented behavior is to fall back to the configured **Site URL** instead. `ABC-JEV-INTEGRATION.md` §1's log records that allow-list as (at least) `https://peer.homes/**` and `http://localhost:3000/**` as of 2026-09-28 — if that is still accurate and the `.vercel.app` alias is not on it, a sign-in attempt started from the alias would likely still land back on `https://peer.homes/auth/callback` regardless of where it started, which would defeat my hypothesis for the *sign-in* path specifically (though the alias would still be reachable and signed-out fine, which is its own smaller issue). **I have no access to the Supabase dashboard and could not re-check this list myself** — flagged for the user under Task 4.

Regardless of whether it explains this specific report, the missing alias redirect is a confirmed, real fact about the live site and a generically bad situation for any cookie-based session (and, separately, it is hard-coded as the ultimate fallback for `SITE_URL` in `web/src/lib/site.ts` — used for links inside digest/confirmation emails — if `NEXT_PUBLIC_SITE_URL` and Vercel's own `VERCEL_PROJECT_PRODUCTION_URL` were ever both unset; the current Vercel Production config, per the ABC-JEV-INTEGRATION.md log, does set `NEXT_PUBLIC_SITE_URL`, so this fallback is very unlikely to be active today — noted for completeness, not raised as an active bug).

### What I could not verify (Supabase dashboard / Google console — the user's own steps)

- **Authentication → Sessions → "Time-box user sessions" / "Inactivity timeout."** These are real Supabase Auth (GoTrue) settings that, if enabled, invalidate a session server-side well before the cookie's own 400-day expiry — completely independent of anything in this repo's code. I cannot see the dashboard. If either is set to something short, it would fully explain complaint 1 on its own, no code change needed (or possible) here.
- **Authentication → URL Configuration → Redirect URLs** — whether the `.vercel.app` alias is on the allow-list (see above).
- Refresh-token rotation behavior itself (GoTrue rotates the refresh token on each use, with a short reuse-detection grace window) is standard Supabase server-side behavior, not a per-project setting I could find exposed in this repo; low suspicion for a single-browser, non-concurrent case like this report, noted only for completeness.
- Ordinary browser behavior — "clear cookies on exit," a private/incognito window, an extension that wipes site data — is outside the application entirely and outside anything I can check. Worth asking the user directly, since it is the simplest possible explanation and the in-app mechanism checks out clean.

---

## Task 2 — Cross-device settings sync

STATUS: COMPLETE — root cause CONFIRMED BY EXECUTION

### Which settings sync, which stay on the device

Everything in `UserProfile` (`web/src/types/index.ts`) syncs to the `profiles` table **except**:
- The six credential-like fields — `tavilyApiKey`, `adzunaAppId`, `adzunaAppKey`, `usajobsApiKey`, `usajobsUserAgent`, `feedAiApiKey` — structurally stripped before every push (`remoteProfilePayload` in `web/src/components/profile-sync.tsx`) and never read back from a remote row (`profileRowToProfile` in `web/src/app/api/profile/route.ts` has no column mapping for any of them). Confirmed never left the device.
- `onboardedAt` — explicitly documented in `web/src/types/index.ts` as "Local-only for now... NOT synced to the Supabase profile row," by design (so a fresh browser re-shows onboarding).
- Saved papers / reading history / feedback sync through a **separate** mechanism (`web/src/components/feed-sync.tsx` + `web/src/store/feed.ts`), not `profile-sync.tsx`. That path is list/record-union based end to end (per FEED-SYNC-FLAG and OUTBOX-RETRY, both already VERIFIED in this campaign) and does not share the defect below — I did not find a matching bug there, and did not re-derive what those two already-closed items proved.

### When a signed-in device pulls the account's profile

On sign-in, and on **every fresh full page load** (`web/src/components/profile-sync.tsx`'s `ProfileSync` component is mounted once near the root; its `didInitialPullRef` resets on every new mount, i.e. every hard page load/new tab, and gates the pull+merge+push body to run exactly once per mount). **Not** on window focus or tab-visibility change (confirmed: no `focus`/`visibilitychange` listener anywhere in `profile-sync.tsx` or `feed-sync.tsx`), and not polled. Practically: a device that stays open and signed in will never see another device's changes until it reloads.

### How the pull merges — and the confirmed defect

`web/src/lib/profile/merge.ts`'s `mergeProfileAtSignIn(local, remote)` (called from `profile-sync.tsx`, replacing an older, already-fixed "install if defined" `hydrateFromRemote` — see SIGNIN-MERGE, §1aj, already VERIFIED) implements the ruling correctly for two of its three field classes:
- **List fields** (`researchTopics`, `softTopics`, `preferredMethods`, `locationPreferences`, `authorisedCountries`, `dislikedTopics`, `preferredJournals`): union, remote's own order first, then local's new entries, case-insensitively deduped. Correct — confirmed by the existing `merge.test.ts` suite and re-confirmed in my own probe.
- **`preferenceLedger`**: per-key union, newer timestamp wins on overlap, else local. Correct.
- **Single-value fields** (`currentProject`, `currentChallenges`, `displayName`, `careerStage`, `industryVsAcademia`, `school`, `phdYear`, `advisorName`, `colorTheme`, `digestHourLocal`, `digestTimezone`, `digestChannel`, `digestFrequency`, `digestEmail`): the rule is "non-empty beats empty; on a genuine conflict (both sides real and different), local wins once — the person is actively using this browser." **This is where the bug is.** `mergeSingleValue`'s `isEmptyValue` only treats `undefined`, `null`, and blank strings as "empty." It has no way to tell "a human genuinely set this on this device" apart from "this device has simply never been touched and is still showing the factory default" — and `web/src/types/index.ts`'s `defaultProfile` ships **non-empty, real-looking** factory values for 8 of these 14 fields:

  ```
  displayName:        "Peer Member"
  careerStage:         "PhD Year 3"
  industryVsAcademia:  "both"
  phdYear:              3
  colorTheme:          "system:ember"
  digestHourLocal:      8
  digestChannel:       "inapp"
  digestFrequency:     "daily"
  ```
  (`currentProject`, `currentChallenges`, `school`, `advisorName` are correctly `undefined` by default — not affected. `digestEmail` defaults to `""` — not affected. `digestTimezone` defaults to the browser's own real IANA zone — mechanically hits the same code path, but "keep this device's own timezone rather than adopt a different device's" is arguably the right outcome for that one field specifically, so I have not listed it as broken.)

**Proven by execution** (temporary probe, `web/src/lib/profile/__b_account_probe_cross_device.test.ts`, deleted after running): simulated a brand-new "device B" (`local = { ...defaultProfile }`, completely untouched) merging against a simulated "device A" that had genuinely changed and successfully pushed a real name and settings. Result — `mergeProfileAtSignIn`'s returned patch:

| Field | Account's real value (device A) | Patch device B actually computes | Expected |
|---|---|---|---|
| displayName | "Alice Chen" | **"Peer Member"** | "Alice Chen" |
| careerStage | "Postdoc" | **"PhD Year 3"** | "Postdoc" |
| industryVsAcademia | "academia" | **"both"** | "academia" |
| phdYear | 5 | **3** | 5 |
| colorTheme | "dark:rose" | **"system:ember"** | "dark:rose" |
| digestHourLocal | 19 | **8** | 19 |
| digestChannel | "email" | **"inapp"** | "email" |
| digestFrequency | "weekly" | **"daily"** | "weekly" |
| digestEmail (control) | "alice@example.edu" | "alice@example.edu" (correct) | — |
| researchTopics (control) | ["battery materials"] | ["battery materials"] (correct) | — |

A second probe case confirmed the reverse is intentionally fine: once device B's own human really has changed `displayName` locally to something else, "local wins once" is the correct, intended outcome — the defect is specifically "untouched factory default vs. a real remote value," not the conflict rule itself.

**This is not merely a one-way "fails to pull" bug — it actively overwrites the account.** Confirmed by reading `profile-sync.tsx`'s `onSession()` together with the PUT route:
1. After computing the (wrong) patch above, `onSession()` applies it to the local store, then unconditionally reconciles: `const shouldPush = remote ? true : hasAnySignal(local);` — `remote` is truthy any time the account has ever saved anything, so this is `true` on effectively every second-device sign-in.
2. The push sends `remoteProfilePayload(useProfileStore.getState().profile)` — the **entire current profile**, not a diff (unlike the later steady-state debounced push in the same file, which does diff). Every one of the 8 fields above is present and defined in that payload.
3. `web/src/app/api/profile/route.ts`'s `profilePatchToRow` writes every field present in the body (`if (p.displayName !== undefined) row.display_name = p.displayName;`, etc.) via an `upsert`.
4. Net effect: device B's factory-default values for those 8 fields get written back onto the **account row**, overwriting whatever device A had genuinely set.

This is not strictly a one-way, permanent corruption — whichever device happens to load or reload *most recently* re-stamps the shared account with its own local state for these 8 fields, so reopening device A afterward would push its still-correct local values back over the top again. But from the user's point of view — someone who set their name and a few settings on one computer, then opened a second, brand-new computer — this reads exactly as "my changes vanished," which is exactly what was reported.

**The product's own UI already half-recognizes this exact problem**, which is useful precedent for the fix: `web/src/app/profile/page.tsx` and `web/src/app/welcome/page.tsx` each independently define `const DEFAULT_NAME = "Peer Member";` and use it purely for display — `profile.displayName === DEFAULT_NAME ? "" : profile.displayName` — specifically so the placeholder doesn't show as if it were a real, entered name in the input field. That sentinel logic exists in two UI files but has no equivalent in `lib/profile/merge.ts`, and no equivalent exists at all for the other 7 affected fields.

**Existing test coverage has a matching blind spot.** Every "genuine conflict, local wins" case in `web/src/lib/profile/merge.test.ts` uses a field whose factory default is empty/`undefined` (`currentProject`, `school`) with a hand-picked non-empty local value standing in for "a real edit" — never the actual untouched `defaultProfile` object — so the suite has never exercised "fresh device vs. a real remote change," and would not have caught this.

### What happens to a change made while the browser is silently signed out

Not reachable as literally stated — `PUT /api/profile` requires a session (`if (!user) return 401`, confirmed in `route.ts`), so a genuinely signed-out browser cannot push anything at all; a change made then simply stays local-only (by design — Tier 0 works fully signed out). The relevant version of this question is: a change made on a device **whose local storage was reset** (not just its cookie) — e.g. the browser's site data was cleared, not just cookies — would look, to `ProfileSync`, exactly like the "brand-new device B" scenario above the next time that device signs in, because its local profile is back to `defaultProfile`. This is the one place complaint 1 and complaint 2 could genuinely connect: *if* whatever makes the browser "forget" the sign-in also clears `localStorage` (not just the cookie) on the same device, re-signing in there would silently reset the account's name/settings back to factory defaults via the exact mechanism above — even though it's "the same computer" from the user's point of view. I want to be precise about the status of this link: **I have not confirmed that this is what happens** (I cannot observe the user's actual browser behavior), so I am presenting it as a plausible connecting scenario, not a finding.

---

## Task 3 — Can the reader tell they're signed out, or that a save failed?

STATUS: COMPLETE

**Signed out:** visible in exactly two places, both requiring the reader to actively look:
1. `web/src/components/account/account-section.tsx` — on the `/profile` page only, the Account section renders "Sign in with GitHub or Google to sync saves and reads across your devices." plus the two sign-in buttons in place of the avatar/name/email/Sign-out row. This is clear once seen.
2. `web/src/components/shell/masthead.tsx` — the Profile nav icon shows the reader's real avatar image only when signed in (`auth.kind === "signed-in"`) and only while on/near that page; otherwise a generic icon. This is a subtle swap, not an announcement.

There is **no site-wide indicator** — no banner, toast, or notice anywhere else in the app — telling the reader their session ended. Someone who signs in once and then only ever uses the home feed would never be told if the session silently expired; they would simply, quietly get the same experience a signed-out (Tier 0) reader gets, with no prompt to notice or re-sign in.

**Failed save:** `web/src/app/profile/page.tsx`'s `SyncStatusNotice` renders a real, visible, `role="alert"` line — "Couldn't save to your account — your changes are kept on this device." — driven by `useProfileSyncStatus`/`useFeedSyncStatus`'s `pushFailed` flags (`profile-sync.tsx`, `lib/feed/sync-status.ts`). This is honest and works, but only for a genuine network/HTTP failure, and only on the `/profile` page.

**Important gap this surfaces:** the Task 2 bug above does **not** trigger this notice at all, because the PUT that overwrites the account with factory defaults *succeeds* — the server has no way to know "Peer Member" is a placeholder rather than a deliberate save. The one case most likely to silently erase a reader's setting is exactly the case with no warning of any kind.

---

## Task 4 — Options per problem, with recommendation

STATUS: COMPLETE

### Problem 1 — "not signed in when I reopen the browser"

| Option | What the reader sees | Cost | Needs the user |
|---|---|---|---|
| A. Redirect the `.vercel.app` alias to `https://peer.homes` — either a Vercel dashboard domain-redirect setting for that alias, or a small host check added at the top of `proxy.ts` (must match the *one specific* alias hostname, never a `*.vercel.app` wildcard, or it would break preview deployments) | A sign-in reached via the alias now round-trips to `peer.homes`; a session begun there becomes visible on `peer.homes` too | Low (code) / zero (if Vercel exposes the toggle) | Check whether Vercel's Domains page exposes a redirect toggle for the auto-assigned alias — I could not check this |
| B. Check Supabase → Authentication → Sessions for "Time-box user sessions" / "Inactivity timeout" | If set, raising/disabling it stops forced sign-outs on return; if already off, rules this theory out entirely | Zero (no code possible here) | Yes — I cannot see this dashboard at all |
| C. Ask the user directly whether their browser clears cookies/site data on close, or whether they were in a private/incognito window | Immediately confirms or rules out the simplest explanation | Zero | Yes — a two-line question |

**Recommendation:** ask C first (cheapest, and the in-app session mechanism checked out clean, so this is the most likely explanation left standing); do A regardless of what C/B turn up, since it is a confirmed real gap with no downside and it also closes one path into Problem 2; ask the user to check B in parallel since there is no way for me or the manager to see it otherwise.

### Problem 2 — "my settings/name from one computer weren't on the other"

| Option | What the reader sees | Cost |
|---|---|---|
| A. Make the merge default-aware — give `mergeProfileAtSignIn` a way to treat "local value equals `defaultProfile`'s own value for that field" as empty (no real local signal), for the 8 affected fields, the same direction `isEmptyValue` already treats blank/`undefined`. Generalizes the exact insight the UI's own `DEFAULT_NAME` sentinel already encodes, in one place instead of copy-pasted | Signing in on a new, untouched device correctly shows the name/settings chosen on the first device | Moderate — a real change to a data-integrity-sensitive module; needs the same care/tests as the original SIGNIN-MERGE work (§1aj) |
| B. Stop auto-pushing on every sign-in/reload; only push when the reader made a real local edit this session (an explicit dirty flag), never merely as a side effect of loading the page | Stops the account from being overwritten by a fresh device, but a new device would still *show* the placeholder locally until it next actually pulls correctly — partial mitigation, best paired with A, not a substitute for it | Moderate — changes the "reconcile the account" push timing SIGNIN-MERGE's P1 ruling relied on |
| C. Remove the non-empty placeholders from `defaultProfile` itself (`displayName`, `careerStage`, `industryVsAcademia`, `phdYear`, `colorTheme`, `digestHourLocal`, `digestChannel`, `digestFrequency` all become genuinely unset/`undefined`), and move "Peer Member" / "PhD Year 3" / etc. to display-only fallback text — matching how `currentProject`/`school` already work correctly | Most structurally clean; removes this whole *class* of "default looks like a real edit" bug everywhere those fields are read, not only at this one merge boundary | Highest — touches every reader of these fields (onboarding forms, the welcome-completeness check, digest email templates, and anywhere else `defaultProfile.<field>` is compared against something real; I did not enumerate every such site) |

**Recommendation:** A now — it is small, targeted, and fixes the reported bug directly at its one real source. Queue C as a separate, larger follow-up item (own B guide) rather than folding it into this item's scope, since it is a structurally bigger change with a wider blast radius I have not fully mapped. B is optional extra hardening, not required if A ships.

---

## Task 5 — Tests the fixes need, and POLICY list

STATUS: COMPLETE

### Tests needed

1. `web/src/lib/profile/merge.test.ts` — one case per affected field (`displayName`, `careerStage`, `industryVsAcademia`, `phdYear`, `colorTheme`, `digestHourLocal`, `digestChannel`, `digestFrequency`): `local = { ...defaultProfile }` (untouched) merged against a real, different remote value — assert the patch takes the remote's real value, not the default. (This generalizes the temporary probe that proved the bug.)
2. A control case confirming a genuinely human-edited local value (different from both the default and the remote value) still wins once, unchanged — guards against overcorrecting to "remote always wins."
3. An integration-level test on `profile-sync.tsx`'s `onSession` flow proving that after a corrected merge, what gets **pushed** to the server for these fields matches what the merge just decided (not the pre-merge/default local state) — proves the account-overwrite path is actually closed, not just the pure-function boundary.
4. `web/src/lib/supabase/middleware.ts` currently has **zero test coverage** (confirmed — no existing `*middleware*test*`/`*proxy*test*` file anywhere in `web/src`). Worth adding permanently: `updateSession()` calls `auth.getUser()` on a matched request, and is skipped cleanly when the Supabase env vars are absent. (The probe I wrote and deleted for this investigation is a ready template.)
5. If Problem 1's Option A (host redirect) is built: a test that the *specific* known alias host redirects to the canonical host, while an arbitrary other `*.vercel.app` shape (a preview-deployment URL) does **not** redirect — protects preview deployments from an over-broad wildcard.

### POLICY list for the manager

1. Which fix for Problem 2 ships now: Option A (default-aware merge) alone, or A+B together? I recommend A alone for this item; B only if the manager wants extra belt-and-suspenders on the push side.
2. Should Option C (remove `defaultProfile`'s non-empty placeholders entirely) be queued as its own follow-up item outside this item's scope, given its wider, only-partially-mapped blast radius? I recommend yes, queue it separately.
3. Host canonicalization for the `.vercel.app` alias (Problem 1 Option A): code-level redirect in `proxy.ts`, a Vercel dashboard domain-redirect setting, or both? I could not check whether Vercel's dashboard exposes a redirect toggle for the auto-assigned alias — needs either the user's own look or a manager with Vercel-dashboard/tool access.
4. Two plain questions for the user, cheapest first: (a) does their browser clear cookies/site data automatically, or were they in a private/incognito window when they noticed this; (b) will they check Supabase → Authentication → Sessions for a session-lifetime/inactivity-timeout setting and report what they find, and separately confirm what's currently in Authentication → URL Configuration → Redirect URLs.
5. Whether to add a site-wide (not just `/profile`-page) signed-out indicator — today nothing outside `/profile` tells a reader their session ended. This directly answers "can the reader tell" in a way the user may want acted on, but it is a UX addition, not a bug fix, and is outside this item's confirmed-defect scope — recommend a separate decision.
6. Scope boundary: keep the Problem-2 fix inside `lib/profile/merge.ts` + its caller in `profile-sync.tsx`, matching SIGNIN-MERGE's existing file ownership (§1aj) — do not fold in the larger Option-C `defaultProfile` refactor without its own B guide, consistent with this campaign's one-phase-per-role-turn rule (§0b).

---

## Probe files (temporary — created, executed, then deleted)

1. `web/src/lib/profile/__b_account_probe_cross_device.test.ts` — proved the Task 2 root cause by execution (2 tests, both passed). Deleted.
2. `web/src/lib/supabase/__b_account_probe_session.test.ts` — proved Task 1's cookie defaults, `proxy.ts` matcher coverage, and `updateSession()`'s refresh call by execution (4 tests, all passed). Deleted.

Confirmed clean after deletion: `git status --short` shows no `__b_account_probe_` file remaining; the only new path introduced by this investigation is this guide itself, `docs/jev-abc/ACCOUNT-SESSION-SYNC-B-20260929T220146Z.md`. No other file in the working tree was touched.

---

## FOLLOW-UP — is the bug wider than factory defaults? (manager's ping-pong hypothesis)

STATUS: IN_PROGRESS

Manager's reading to check, not inherit: `mergeProfileAtSignIn` runs behind `didInitialPullRef` in `profile-sync.tsx`, a plain in-memory `useRef` that resets on every full page load (not just true first sign-in) — so "local wins once" may really mean "local wins on every reload," letting a stale-but-real value on one device overwrite a newer real edit made elsewhere, ping-ponging the account. Checking this by execution below, same constraints as before (read-only, temporary `__b_account_probe_`-prefixed probes deleted at the end, no full suite, **no network at all this round**).

### 1. Prove or refute

STATUS: COMPLETE — **manager's reading CONFIRMED by execution, and the real bug is wider than what I reported in the original 5 tasks**

**Does anything persist "this device has already done its sign-in merge"? No — confirmed by reading.** `didInitialPullRef` (`profile-sync.tsx`) is a plain `useRef(false)`, pure in-memory React state scoped to one mounted `ProfileSync` component instance. `ProfileSync` is documented as "Mount once, near the root" — under Next.js App Router, a root-level component like this stays mounted across client-side navigation (Link clicks) and only remounts on a genuine full page load (hard reload, new tab, typing the URL, browser restart). So `didInitialPullRef.current` really does reset — and the merge-then-push body in `onSession` really does run again — on every full page load of an already-signed-in device, not only on a true first sign-in. Nothing anywhere (not in the zustand `persist` config for the profile store — confirmed by reading its `partialize`/`version`/`migrate` block, which persists only `{ profile }` under localStorage key `peer-profile` — and not in any other store) records "this device already reconciled with the account once." This part is a code-reading/React-semantics finding, not something provable with a `vitest` unit test in a repo with no DOM-rendering test harness (confirmed absent — same limitation every prior B/A in this campaign has noted); I have stated exactly what is read-based versus execution-based rather than blur the two.

**What actually happens as a result — proved by execution**, temporary probe `web/src/lib/profile/__b_account_probe_reload_pingpong.test.ts` (3 tests, all passed, deleted after running), using the real shipped `mergeProfileAtSignIn` with realistic (non-default) values on both sides, specifically to isolate this from the already-known factory-default bug:

- Device A edits `displayName` "Alice" → "Alice V2" and `digestChannel` "email" → "sms", pushes successfully. Account now holds "Alice V2"/"sms".
- Device B synced "Alice"/"email" at some point in the past and has not edited anything itself since (a completely realistic, ordinary device — not fresh, not default-only).
- Device B reloads. `mergeProfileAtSignIn(deviceBStaleLocal, accountAfterDeviceAEdit)` returns `patch.displayName = "Alice"` and `patch.digestChannel = "email"` — **B's stale, superseded values, not A's newer edit.**
- Per the already-confirmed push logic (Task 2, unchanged by this follow-up): this patch is not just a display glitch — `onSession` pushes it straight back to the server, so the account regresses to "Alice"/"email", discarding A's edit.
- A third probe case confirmed this is not a one-time allowance: calling the merge twice in a row against an unchanged stale local, with the remote having moved twice ("Alice V2" then "Alice V3"), returns the stale local value BOTH times — there is no state anywhere that makes a second reload behave differently from the first. "Local wins once" is a per-call rule, not a per-account, per-lifetime rule.

**Conclusion: the manager's reading is correct, and supersedes my original Task-2 recommendation.** My original Option A ("compare local against `defaultProfile`") only catches the case where local is an *untouched factory default* — it does nothing for device B's scenario above, since `"Alice"` is a real value a human entered, not a default. The bug's true shape is "local wins on every merge call, with no memory of which values were ever actually confirmed with the account," and factory defaults are simply the most easily and most universally reproduced special case of it (every brand-new device hits that one deterministically; the staleness case needs two devices and an intervening edit, but is no less real).

### 2. Fix design, measured against the 5 scenarios

STATUS: COMPLETE

Candidate (the manager's): per-field "dirty since last successful push." Measured by execution with a prototype reimplementation in a temporary probe (web/src/lib/profile/__b_account_probe_dirty_design.test.ts, 7 tests, all passed, deleted after running — merge.ts was NOT edited; this is measurement only, real wiring is a C task). Design as measured:

- Persist, per device, a "lastSynced" snapshot of the single-value fields this device's own most recent successful sign-in-merge-or-push cycle actually confirmed with the account. This must be persisted state (localStorage, alongside `profile`), not an in-memory `useRef` — the whole bug is that today's equivalent (`lastPushedRef`) is a ref and resets on reload; reusing that same mechanism without persisting it would just move the bug, not fix it.
- A field is dirty on this device when: `lastSynced` has an entry for it and the current local value differs from that entry (scenario b — a stale device correctly yields to a newer account value instead of ping-ponging); OR `lastSynced` has no entry for it yet (this device has never confirmed a value for this field with any account) and the local value differs from `defaultProfile`'s own value for that field (the bootstrap rule — this is what correctly covers a truly fresh device, scenario a, and a device with real signed-out edits that has never synced before, scenario c; without this fallback, a genuinely first-time device would look "not dirty" for having no sync history, and its real signed-out edits would never reach the account at all, breaking SIGNIN-MERGE's original P1 intent).
- Merge rule per single-value field: dirty means local wins (a real pending edit this device made, not yet confirmed); not dirty means the account's value wins outright if the account has one, else keep local (nothing anywhere has a value yet). Factory defaults never win a "conflict" on their own merit under this rule — they either lose to a real account value (not dirty) or, at the bootstrap moment, are never classified as dirty in the first place.
- After every successful merge+push cycle, `lastSynced` is overwritten with the FULL resulting single-value snapshot (not just the fields that were dirty) — this is what lets the NEXT load correctly recognize "nothing changed here since" for every field, dirty or not.
- List fields and `preferenceLedger`: unchanged — union is already safe regardless of staleness (it only ever adds, never drops), so dirty-tracking is not needed there. Pre-existing, already-disclosed limitation, unaffected by this fix: union can still re-add an item a person explicitly removed on one device if a stale device that still has it locally reloads — the same trade-off SIGNIN-MERGE's own rulings and FEED-SYNC-FLAG already named for lists ("a push can only ever ADD... un-save on another device no longer propagates"). Out of this follow-up's scope; flagged, not solved here.

Measured outcomes, all 5 requested scenarios, all confirmed by execution:

| Scenario | Outcome under the candidate design | Confirmed |
|---|---|---|
| (a) fresh device (factory defaults) signs in | Takes the account's real value | PASS |
| (b) stale device (real, previously-synced values) reloads after another device's edit | Takes the NEWER account value — ping-pong is fixed | PASS |
| (c) edits made while signed out, then sign-in | Bootstrap rule (no sync history yet) still recognizes the real edit as dirty, reaches the account — original P1 intent preserved | PASS |
| (d) two devices edit different fields | Each field takes whichever side actually changed it; no collision, both land on the account | PASS |
| (e) two devices edit the SAME field, neither having seen the other's edit | Whichever device's sync completes LAST wins (last-write-wins) — stated plainly: this is the same resolution the existing steady-state debounced PUT already gives for any concurrently-edited field; not a regression, and a full conflict-free merge (e.g. CRDT-style, or per-field timestamps) is disproportionate to a scalar preference field | PASS |

Implementation cost, for the manager's sizing: this touches the profile store's `persist` `partialize` (add the new snapshot, bump `version`, add a `migrate` step — the store already has this exact extension point, currently at `version: 4`), every one of the ~14 `update*` setters for the affected fields (each must also record its field as dirty relative to the new baseline), and the merge boundary itself (`lib/profile/merge.ts` + its caller in `profile-sync.tsx`). Larger than the original Option A, but still scoped to the same two files SIGNIN-MERGE already owns, plus the store's setters.

### 3. The transition — what happens on each device's first load of the fixed code

STATUS: COMPLETE — measured by execution (2 more cases in the same probe file, 7/7 total passed)

This falls out of the design above for free, with no separate migration code needed — because `lastSynced` does not exist until the fix ships, every device's first post-fix load has no entry for any field, which is exactly the bootstrap rule already defined above (compare against `defaultProfile`). Measured directly:

- Recovery case (confirmed): the account currently holds a bug-corrupted factory default (today's already-confirmed Task 2 outcome); a device that still holds the real value bootstraps, is classified dirty (its value differs from the default), and correctly restores the real value to the account. A fresh/default-only device loading afterward, against the now-restored account, correctly does not disturb it.
- What CAN still be lost (stated plainly, as asked): if two devices each hold a different, genuinely real (non-default) value for the same field that was never reconciled before the fix ships — e.g. both were edited independently while the old bug was silently ping-ponging the account — the transition resolves it exactly like ongoing scenario (e): whichever device happens to load first during the rollout window pushes its value, and whichever loads second (still with no `lastSynced` of its own yet either) sees its own real, differing value, is also correctly classified dirty by the same rule, and overwrites the first. This is a one-time event, not a recurring one — once both devices have completed one post-fix sync, each has a `lastSynced` baseline and scenario (b)'s protection takes over permanently; the field will never ping-pong again after that. But the specific value that does not happen to load last during that window is lost at the transition, exactly once, the same way it already gets lost on every single reload today. Net effect: the transition cannot make this specific edge case worse than today, and it caps a currently-unbounded, repeating loss down to at most one occurrence per field, fleet-wide.
- If the account's current value for a field is already corrupted AND no device anywhere still holds the real value locally either (e.g. every device's local storage has separately been reset since), the true original value is already gone before this fix can run — nothing can recover data no device still holds. Worth saying plainly rather than implying the fix is a full undo.
- A sharper transition (e.g. per-field edit timestamps, so a genuine most-recently-edited value could be identified instead of most-recently-loaded) would remove even the one-time loss above, but needs a schema change beyond this item's proportional scope (the profile table has no per-field `updated_at`, unlike `preferenceLedger` entries, which already carry timestamps) — flagged as a possible later enhancement, not recommended now.

### 4. Problem 1 addendum

STATUS: COMPLETE

Added to the Task 1 "what I could not verify" list: Supabase → Authentication → Sessions → "Single session per user" (if enabled, signing in on a second device ends the first device's session — this would produce exactly the "I open my browser and I'm not signed in, even though I signed in before" report, with no code bug involved at all, the moment the user's own report of signing in on a second computer is considered). I cannot see this setting; only the user can check it, alongside the inactivity-timeout and Redirect-URLs items already listed.

### 5. Updated POLICY list and tests

STATUS: COMPLETE

POLICY list — supersedes item 1 of the original list; items 2 through 6 of the original list stand unchanged:

1. (Revised) Ship the dirty-since-last-sync design (section 2 above) as the Problem-2 fix, not the narrower default-comparison-only design from my original report — the narrower version does not fix the newly-confirmed stale-device ping-pong (scenario b) and would leave a real, reproducible data-loss path open.
1a. Accept the one-time transition trade-off in section 3 (a same-field conflict between two devices that were never reconciled before the fix ships resolves by last-load-wins, exactly once) as the cost of shipping now, versus building per-field timestamps first (larger, separate item) to remove even that one-time case.
2. (unchanged) Queue the bigger `defaultProfile`-placeholder-removal option as its own separate follow-up item.
3. (unchanged) Decide host-canonicalization approach for the `.vercel.app` alias.
4. (unchanged, now with one addition) Ask the user: (a) private window / cookie-clearing behavior; (b) check Supabase Authentication → Sessions for inactivity-timeout AND "Single session per user", and the Redirect URLs allow-list.
5. (unchanged) Whether to add a site-wide signed-out indicator.
6. (unchanged) Keep the fix scoped to `lib/profile/merge.ts`, its caller in `profile-sync.tsx`, and the profile store's `persist` config + `update*` setters — do not fold in the Option-C `defaultProfile` refactor or per-field timestamps without their own B guide.

Tests needed (revises/extends the original Task-5 list; items 1-2 there are superseded by the finer-grained set below, items 3-5 there still stand):

1. Unit tests on the merge boundary for exactly the 5 measured scenarios (a) through (e) above, generalized from the probe, for each of the 8 originally-affected fields plus at least one list field as a contrast case.
2. A persistence round-trip test: `lastSynced` survives a simulated store rehydration (the zustand `persist`/`migrate` path), the same way `profile` itself is already tested to survive it.
3. A test that every one of the ~14 affected `update*` setters marks its own field dirty and no other field — a single setter incorrectly marking a sibling field dirty would silently reintroduce this bug for that sibling.
4. A transition-specific test: simulate a fleet of 2-3 devices with no `lastSynced` at all (the exact post-deploy state) against an account holding a corrupted default, and assert the sequence converges to a real (non-default) value and then stops changing once every device has synced once.
5. (from the original list, unchanged) The `profile-sync.tsx`/`middleware.ts` integration and coverage items already listed there.

## Probe files (temporary — created, executed, then deleted) — FOLLOW-UP round

3. `web/src/lib/profile/__b_account_probe_reload_pingpong.test.ts` — proved the manager's reading by execution (3 tests, all passed). Deleted.
4. `web/src/lib/profile/__b_account_probe_dirty_design.test.ts` — measured the candidate fix against all 5 requested scenarios plus 2 transition cases (7 tests, all passed). Deleted.

No network call was made this round (none permitted). No product file was edited this round either.
