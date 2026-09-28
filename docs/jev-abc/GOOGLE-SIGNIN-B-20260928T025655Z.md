# GOOGLE-SIGNIN — B investigation guide

STATUS: COMPLETE

Item: GOOGLE-SIGNIN (ABC-JEV-INTEGRATION.md §1ad, plus a coordinator relay
received mid-task — quoted in full in §0 below). Repo `D:/local files on this
PC/Github/Peer/peer`, branch `Jev-integration-and-sorting-filtering-enhancement`,
HEAD 0107eaa3. Role: B (investigator) — no code/test/config edits made; this
file is the only artifact produced. Read-only investigation only; no live
OAuth call was made; only public documentation pages were fetched.

---

## §0. Binding requirement (recorded verbatim in substance, top of file per instruction)

Source: the user in chat, relayed by the coordinator mid-task, restating and
sharpening ABC-JEV-INTEGRATION.md §1ad's own "same email = same account"
line:

> If a person's GitHub account and Google account use the SAME email address,
> Peer must treat them as ONE account — same saved profile, reading history,
> daily-email settings — never two separate Peer accounts. This is a design
> requirement, not a POLICY option.

Required of this guide: (1) confirm from Supabase's own docs whether
automatic identity linking by verified email already does this, and every
condition under which it does NOT; (2) for each such case, say exactly what
Peer does today and what the user must configure in the Supabase dashboard to
prevent a duplicate; (3) RED tests for whatever part is Peer's own code (no
code path creates a second `profiles` row for the same user id; the Daily
email default address is the linked account's email); (4) if automatic
linking cannot guarantee "one account" in some case, say so plainly and
recommend the smallest safe fix, not a paper-over.

§3 below is the answer. Short version: **Supabase's automatic linking, left
at its default dashboard setting, already satisfies this for the case that
matters (a real Gmail/Google address matching a real, exposed GitHub email).
It structurally cannot satisfy it when the two providers report genuinely
different email addresses for the same person — no account-linking feature
can read minds — and Peer has no UI today for a user to manually declare
"these are the same person."** Peer's own code (`profiles` table, every API
route) is already provider-blind and keys everything off the session's
`user.id`/`user.email`, never a client-supplied value, so it cannot itself
create a second row by accident; the RED tests in §5 lock that down and cover
the two things that are genuinely new (the Google button, the metadata
fallback chain).

---

## §1. Current auth flow — every file that touches sign-in (search scope: `web/src` full tree, `grep -ri "github"` and `grep -rn "user_metadata\|userAvatar\|userName(\|signInWith"`, both over all of `web/src`, no matches excluded)

| File | Function/export | Role |
|---|---|---|
| `web/src/components/account/use-auth-user.ts` | `useAuthUser()`, `userName()`, `userAvatar()`, `signInWithGitHub()` | Auth state hook + the only two profile-field readers + the only sign-in call today |
| `web/src/components/account/account-section.tsx` | `AccountSection`, `Avatar`, `GitHubMark` | The one and only sign-in/out UI in the app (confirmed below) |
| `web/src/app/auth/callback/route.ts` | `GET` | OAuth callback — provider-agnostic (`exchangeCodeForSession(code)`, no provider check anywhere in the file) |
| `web/src/app/auth/signout/route.ts` | `POST` | `supabase.auth.signOut()` — provider-agnostic |
| `web/src/app/auth/error/page.tsx` | — | Generic "that didn't go through" page, no provider-specific copy |
| `web/src/lib/supabase/client.ts` | `createClient()`, `supabase` | Browser client singleton — provider-agnostic |
| `web/src/lib/supabase/server.ts` | `createClient()` | Server client (cookie-based) — provider-agnostic |
| `web/src/lib/supabase/middleware.ts` | `updateSession()` | Session refresh, called from `proxy.ts` — provider-agnostic |
| `web/src/lib/supabase/admin.ts` | `createAdminClient()` | Service-role client, unrelated to sign-in UI |
| `web/src/proxy.ts` | `proxy()` | Just calls `updateSession` on every non-asset route — provider-agnostic |
| `web/src/components/shell/masthead.tsx` | uses `useAuthUser`, `userAvatar`, `Avatar` | Renders the signed-in avatar in the top nav — provider-agnostic, reads through the same two helpers |
| `web/src/app/profile/page.tsx` | `EmailSettings()`, `AccountSection` usage | Daily-email default address; see §4 |
| `web/src/app/privacy/page.tsx` | `SECTIONS` array, line 27 | **GitHub-specific copy** — the only place in the whole app that says "GitHub" to a user with normative language (see §6) |

**Confirmed by direct grep — nothing else assumes GitHub:**
- `grep -rn "signInWithGitHub" web/src` → exactly 2 hits: the definition in `use-auth-user.ts` and the one call site in `account-section.tsx`. There is no floating pill, no second sign-in button, no onboarding-wizard sign-in step anywhere (`web/src/app/welcome/page.tsx` has zero sign-in references).
- `grep -rln "Sign in with" web/src` → exactly 1 file: `account-section.tsx`.
- No test file exists today for either `use-auth-user.ts` or `account-section.tsx` (`Glob **/*auth*.test.*` and `**/account*.test.*` under `web/src` both return nothing). This is genuinely new test coverage, not a modification of an existing suite.

**`privacy/page.tsx` is not a functional blocker but is factually incomplete once Google exists.** Its own header comment (lines 1-6) says the page is "written from the code" and must change "in the same commit" as the thing it describes. Line 27's label is literally `"If you sign in with GitHub"` and line 29 says `"Signing in is GitHub OAuth through Supabase."` — both become false the moment a Google button exists. See §6/§8.

---

## §2. Google via the installed supabase-js — confirmed from `web/node_modules`, not assumed

Installed versions (read from `web/node_modules/@supabase/*/package.json`):
`@supabase/supabase-js` 2.104.0, `@supabase/auth-js` 2.104.0 (the client
supabase-js re-exports), `@supabase/ssr` 0.10.2.

`web/node_modules/@supabase/auth-js/dist/module/lib/types.d.ts`:
- Line 8: `Provider` union already includes `'google'` (and `'github'`) — no
  supabase-js upgrade needed.
- Lines 554-569, `SignInWithOAuthCredentials`: `{ provider: Provider; options?:
  { redirectTo?: string; scopes?: string; queryParams?: { [key: string]:
  string }; skipBrowserRedirect?: boolean } }` — **the exact same shape
  `signInWithGitHub()` already uses.** `signInWithGoogle()` is a straight copy
  with `provider: "google"`.
- `GoTrueClient.d.ts` lines ~2064-2109 also expose `getUserIdentities()`,
  `linkIdentity()`, `unlinkIdentity()` — the *manual*-linking API (requires
  the user already signed in to call it). Not used by this design; noted
  because §3's "smallest safe fix" for the one real gap references it.
- `auth-js/CHANGELOG.md` has no entries mentioning identity linking at all —
  linking behavior is server-side (GoTrue, the hosted Supabase Auth service),
  not shipped in this client package, so the client changelog is silent on it
  by construction. This is why §3 is sourced from Supabase's hosted-docs site
  and GitHub discussions, not from anything in `node_modules`.

**Google's `user_metadata` vs GitHub's** (needed so `userName()`/`userAvatar()`
in `use-auth-user.ts` keep working):

`userName()` today: `user_metadata?.name` → `user_metadata?.user_name` →
`email` prefix → `"You"`. `userAvatar()` today: `user_metadata?.avatar_url` →
`null`.

Evidence on Google's shape (Supabase does not publish an authoritative
metadata-shape reference page for this; the two sources below are the best
available and are cited with their real status):
- Supabase's own social-login guide for Google
  (https://supabase.com/docs/guides/auth/social-login/auth-google) — official
  docs, but does not enumerate `user_metadata` field names.
  https://supabase.com/docs/guides/troubleshooting/google-auth-fails-for-some-users-XcFXEu
  (official troubleshooting article) confirms Google's userinfo request needs
  the `email` scope in some Google Workspace configurations, or sign-in can
  fail for that subset of users.
- Community evidence (Supabase's own GitHub discussions, **not** the official
  docs — flagged as such): a normal Google sign-in populates
  `user_metadata.full_name`, `user_metadata.name`, `user_metadata.avatar_url`
  and `user_metadata.picture` together (supabase/discussions #4047, #2167,
  #37797). `userName()`'s first branch (`user_metadata?.name`) and
  `userAvatar()`'s only branch (`user_metadata?.avatar_url`) are therefore
  **already satisfied by Google's normal metadata shape with zero code
  change.**
- The same discussions report a real but apparently inconsistent edge case:
  for some accounts `user_metadata` arrives without those fields, while the
  same data is present under `user.identities[].identity_data`. This is
  reported by multiple independent threads, never by an official Supabase
  doc or changelog — treat as "happens sometimes, cause unconfirmed," not as
  a documented guarantee either way.
- **Conclusion: no change to `userName()`/`userAvatar()` is required.** The
  existing fallback chain (name → user_name → email prefix → "You"; avatar →
  null → `Avatar`'s letter-initial rendering in `account-section.tsx` lines
  86-101) already degrades exactly the same way for a Google user missing
  metadata as it does today for a GitHub user with a private avatar. Making
  the fallback also check `user.identities[0]?.identity_data` would be a
  small robustness improvement, not a requirement — listed as POLICY §9.P1,
  not a C step, because it touches the GitHub path too (out of the smallest-
  change scope) and the failure mode it guards is already handled gracefully.

---

## §3. Same person, two providers — the identity-linking answer (the core question)

**Primary source:** Supabase Auth docs, "Identity Linking,"
https://supabase.com/docs/guides/auth/auth-identity-linking (fetched
2026-09-28; also cross-read against the raw doc source at
https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/auth-identity-linking.mdx).

**What automatic linking does:** when a user signs in with a new OAuth
provider (Google) using an email address that already belongs to an existing
account (GitHub), Supabase Auth links the new identity to the *existing*
`auth.users` row — same `id`, same session-derived user going forward. No
second Supabase user is created; nothing in Peer's own database is touched
differently, because Peer's `profiles` table is keyed 1:1 off `auth.users.id`
(schema evidence below). **This is the default, always-on behavior — there is
no dashboard toggle to turn automatic linking itself off.** The only related
dashboard/self-host setting the docs name is
`GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`, which controls the *different*,
opt-in, already-signed-in `linkIdentity()` API, not automatic linking.

**Condition that must hold:** the docs state plainly that Supabase will not
auto-link to a user whose email address is unverified, explaining that doing
so would be unsafe — it could let someone pre-register a victim's address
before the real owner ever signs in, then inherit their account (paraphrased
from the page above, which frames this exact risk). Verification is read
from the field the OAuth provider itself reports as `email_verified`.

**Case 1 — the common case (works today, no action needed):** the person's
GitHub-reported email and Google-reported email are the textually same
address, and each provider reports it verified. Automatic linking applies;
one Peer account; Case closed by Supabase, nothing for Peer to build.

**Case 2 — GitHub email is private/not exposed to the OAuth app (real,
concrete failure mode).** A community-reported (supabase/auth issue tracker,
not the official docs — flagged) finding: GitHub's `user:email` scope lets
the app *query* email addresses but `GET /user.email` is still `null` for
many users unless they've made an email public; Peer's `signInWithGitHub()`
in `use-auth-user.ts` requests no explicit `scopes` today, i.e. relies on
whatever default Supabase's GitHub provider is configured with. If GitHub
gives Supabase no email at all for a person, there is nothing for automatic
linking to match against — that GitHub sign-in and a later Google sign-in
with the person's real address become, unavoidably, **two separate Peer
accounts.** This is not a bug introduced by adding Google; it is a pre-
existing property of how the GitHub button is configured today, only newly
visible because a second provider now exists to compare against. Smallest
safe fix: **POLICY §9.P2** (see below) — not a required part of this item,
since it changes GitHub's existing behavior, but flagged because it is the
one condition genuinely capable of defeating the user's "one person, one
account" requirement even when both real addresses match.

**Case 3 — GitHub's reported `email_verified` may not be trustworthy.** The
same community thread reports that Supabase's GitHub provider currently marks
every email it returns as verified without actually checking GitHub's own
verification flag — i.e., it does not appear to distinguish a GitHub-verified
address from an unverified one. **Net effect for Peer, stated plainly: this
actually makes linking MORE likely to succeed for GitHub users with a public
email, not less** — the verification gate is satisfied almost automatically
on the GitHub side. The residual risk this raises is theoretical (a GitHub
account with a truly unverified, attacker-controlled address could in
principle be used to pre-claim an email before its real owner signs in with
Google) rather than a gap the user's stated scenario would hit; recorded as
**POLICY §9.P3** for the manager to accept or reject, not fixed by B or
assumed away.

**Case 4 — the two providers genuinely report different email addresses for
the same human** (a work Gmail vs. a personal GitHub email, exactly the "same
person" case the user is actually worried about in the common real-world
sense). **No automatic mechanism can merge these — matching email is the
entire mechanism, by design, and no doc anywhere claims otherwise.** This is
the one case where "automatic linking cannot guarantee one account" is
simply true, stated plainly per the requirement, not papered over. Peer has
zero UI for a signed-in user to explicitly say "also, this is me" (confirmed
in §2: `linkIdentity()`/`getUserIdentities()`/`unlinkIdentity()` are exported
by the installed auth-js but called nowhere in `web/src`). The smallest safe
fix is a *separate, later* feature — a "Connect another sign-in method"
control in `AccountSection` built on `linkIdentity()`, for a signed-in user
only — explicitly out of scope for GOOGLE-SIGNIN's "smallest change" mandate
and listed as **POLICY §9.P4**, not built here.

**What happens to the sign-in attempt when linking conditions are not met**
(e.g. Case 2/4): not stated explicitly by Supabase's docs in the pages
fetched. Structurally, GoTrue must resolve every successful OAuth callback to
*some* authenticated user — the only two documented outcomes are "link to
existing" or "create new" (a plain sign-up); nothing in the docs describes a
third outcome where the sign-in is refused because linking wasn't possible.
This inference is **not confirmed by an explicit sentence in the docs read**
— flagged honestly rather than asserted as fact; recommend the fresh A (with
the manager's authorization, since it needs a real two-provider live test
against the user's own Supabase project — no local Supabase instance exists
in this repo to test against, confirmed: no `supabase/config.toml`, only
`web/supabase/{schema.sql,migrations,functions,rollback}`, i.e. no `supabase
start` CLI project) do one real manual check: sign in with GitHub, sign out,
sign in with Google using the identical email, and confirm the profile/avatar
carried over. This is **POLICY §9.P5** — a one-time manual verification, not
a C-buildable automated test, and not required before shipping the button
(Case 1 is the overwhelmingly common path and needs no fix).

**Recommended default (safe, no dashboard change required):** ship Google
sign-in as designed in §4, rely on Supabase's always-on automatic linking for
Case 1, and record Cases 2-4 exactly as written above in the readiness doc
(§8) so nobody mistakes "we added a Google button" for "we solved account
merging in general" — because the docs do not support that stronger claim.

**Peer's own code guarantee (this part IS fully verifiable locally, and is
already true today):** `web/supabase/schema.sql` line 7:
`public.profiles(user_id uuid primary key references auth.users(id) on
delete cascade)` — one row per Supabase user id, enforced by a Postgres
primary key, not by application code. Lines 60-76: `handle_new_user()`
inserts `(user_id) ... on conflict (user_id) do nothing`, fired by trigger
`on_auth_user_created after insert on auth.users` — this only ever fires once
per *auth.users* row, and a linked identity is not a new `auth.users` row.
Every server route that reads/writes a profile
(`web/src/app/api/profile/route.ts`, `.../send-test-email/route.ts`) derives
`user_id` from `supabase.auth.getUser()` server-side — `route.ts`'s own
header comment: *"we still derive user_id from the session server-side so
clients can't claim someone else's row."* No file anywhere accepts a
client-supplied user id. This is what makes the RED tests in §5 possible:
Peer's side of the guarantee is a code-level invariant, testable without a
live Supabase project; Supabase's side (Cases 1-4 above) is not.

---

## §4. Daily-email default address — confirmed provider-agnostic

`web/src/app/profile/page.tsx`, function `EmailSettings()` (line ~1399):
`const accountEmail = auth.kind === "signed-in" ? auth.user.email ?? "" : ""`.
`auth.user` is the Supabase `User` object from `useAuthUser()` — `.email` is
Supabase's own normalized top-level field, populated identically regardless
of which provider signed the user in (it is not read from `user_metadata`).
`handleAddressSubmit()` (same file, ~line 1501-1505): a submitted address
that case-insensitively equals `accountEmail` is treated as *"Already
'confirmed' — no token flow needed"* (comment, quoted fragment) — the exact
"already confirmed" behavior Investigate step 4 asked to confirm.

`web/src/app/api/profile/send-test-email/route.ts`, `POST` (line 153):
`const destination = typedProfile?.digest_email?.trim() || user.email || ""`
— same `user.email`, same fallback. Neither file branches on provider.
**Confirmed: a Google account's email flows through the identical path and is
identically treated as already-confirmed. No change needed here.**

---

## §5. Design — the smallest change

**Files touched (non-test):**
1. `web/src/components/account/use-auth-user.ts` — add one new exported
   function, `signInWithGoogle()`, a copy of `signInWithGitHub()` with
   `provider: "google"` and the same `redirectTo: \`${origin}/auth/callback\``.
   Optional, low-risk addition worth including in the same edit (not a
   separate POLICY item — it changes nothing about GitHub, costs nothing,
   and is a documented real Google parameter): `queryParams: { prompt:
   "select_account" }`, so a person who is signed into more than one Google
   account in the same browser gets Google's account chooser instead of a
   silent, possibly-wrong, auto-pick. Source:
   https://developers.google.com/identity/protocols/oauth2/web-server — the
   `prompt` parameter's documented values are `none`, `consent`,
   `select_account`. No `access_type`/`offline` — Peer never calls Google's
   APIs again after sign-in, so no refresh token is needed; adding it would
   only prompt the user for a permission Peer does not use.
   `userName()`/`userAvatar()` — **unchanged**, per §2.
2. `web/src/components/account/account-section.tsx` — the signed-out branch
   (lines 28-45 today) changes from one button to two, in a
   `flex flex-wrap gap-2` row, same `buttonVariants({ tone: "surface", size:
   "md" })` on both so they read as one calm family, not two competing CTAs:
   - Existing "Sign in with GitHub" button, unchanged, first (keeps existing
     users' muscle memory — smallest visual disruption).
   - New "Sign in with Google" button, same shape, a `GoogleMark` icon
     (`aria-hidden`, matching `GitHubMark`'s pattern exactly) beside the text
     "Sign in with Google".
   - Shared `busy` state must disable **both** buttons once either is
     clicked, not just the one clicked (today's single-button code
     incidentally already does this correctly by having only one button;
     with two, `disabled={busy}` must be applied to both, or a fast double-
     click could fire two concurrent OAuth redirects). This is the one real
     behavioral nuance in an otherwise copy-paste change — call it out to C
     explicitly.
   - Signed-out sentence (line 30-32) changes from *"Sign in with GitHub to
     sync saves and reads across your devices."* to *"Sign in with GitHub or
     Google to sync saves and reads across your devices."* — smallest edit
     that stays accurate; no other copy on the page changes.
   - Accessibility: both are native `<button type="button">` elements with
     visible text content, so each already has a correct accessible name with
     no extra `aria-label` needed (matching the existing GitHub button's
     pattern exactly). Tab/focus order follows DOM order — GitHub first,
     Google second, matching reading order, so no explicit `tabIndex` is
     needed. `GoogleMark`'s `<svg>` needs `aria-hidden` exactly like
     `GitHubMark`'s, so screen readers announce only the button's text once,
     not the icon too.
3. `web/src/app/privacy/page.tsx` — line 27's label and line 29's sentence
   currently name only GitHub; update both to name Google too (e.g. label
   "If you sign in" and body's first sentence naming both OAuth providers).
   Not functionally required for sign-in to work, but the file's own header
   comment commits it to staying accurate "in the same commit" as the thing
   it describes — recommended as part of this item, not deferred.

**Files NOT touched, confirmed safe to leave alone:** `auth/callback/route.ts`,
`auth/signout/route.ts`, `auth/error/page.tsx`, all three `lib/supabase/*.ts`
files, `proxy.ts`, `masthead.tsx`, `schema.sql`/migrations, every profile API
route — all provider-agnostic already (§1, §4).

**No new Next.js API is used.** The change is a supabase-js client call plus
existing JSX/button patterns; nothing here touches routing, middleware
config, or any Next 16-specific surface, so no new citation into
`web/node_modules/next/dist/docs/` is needed (checked: the only Next APIs in
play — `NextRequest`/`NextResponse`/`cookies()` in the callback/signout
routes — are unchanged call sites, already in production use for GitHub).

**No `.env.example` change.** Google's Client ID/Secret are entered directly
into the Supabase dashboard (Authentication → Providers → Google) and read
by Supabase's own hosted Auth service — no Peer source file ever reads a
Google credential, so there is nothing to name in `.env.example` (the file's
own convention, confirmed by reading it in full: every entry there is a name
a Peer source file actually reads via `process.env`).

---

## §6. RED tests to write first (new files — none of this exists today)

All in `web/src/components/account/`, following this repo's own established
convention (confirmed in `web/src/app/profile/page.test.tsx`'s header note
and `web/src/app/api/profile/route.test.ts`): no `@testing-library/react` is
installed; presentational-component tests use `renderToStaticMarkup` plus
string/regex assertions on the output HTML, never simulated clicks; module
mocks use `vi.mock(...)` + `vi.fn()`.

**`web/src/components/account/use-auth-user.test.ts` (new file):**
1. RED: `signInWithGoogle()` calls a mocked `supabase.auth.signInWithOAuth`
   with `{ provider: "google", options: { redirectTo: "<origin>/auth/callback",
   queryParams: { prompt: "select_account" } } }` — mock `@/lib/supabase/client`'s
   `supabase` export, assert the call shape, the way `route.test.ts` mocks
   `@/lib/supabase/server`'s `createClient`.
2. RED: `signInWithGoogle()` resolves without calling anything when
   `supabase` is null (self-hosted/unconfigured) — mirrors the existing guard
   in `signInWithGitHub()`; write the same test for `signInWithGitHub()` too
   while here, since it has zero coverage today (cheap, same file, same
   pattern — not required by this item's scope but nearly free).
3. RED: `userName()` given a fake Google-shaped user (`{ user_metadata: {
   full_name: "A B", name: "A B", avatar_url: "https://...", picture:
   "https://..." }, email: "a@gmail.com" }`) returns `"A B"` — proves the
   existing first branch already serves Google, protecting §2's "no code
   change needed" claim from silently regressing.
4. RED: `userAvatar()` given the same fake user returns the `avatar_url`
   value.
5. RED: `userName()`/`userAvatar()` given a user with `user_metadata: {}` and
   only `email` set fall back to the email prefix and `null` respectively —
   proves the degrade-gracefully path (§2's community-reported missing-
   metadata edge case) never throws or renders blank.

**`web/src/components/account/account-section.test.tsx` (new file):**
6. RED: signed-out render (mock `useAuthUser` to return `{ kind: "signed-out"
   }`) contains both "Sign in with GitHub" and "Sign in with Google" as
   button text, GitHub before Google in document order.
7. RED: the signed-out sentence text includes both "GitHub" and "Google".
8. RED: `unconfigured`/`loading` states still render nothing (`null`) —
   protects the existing self-hosted-mode guard from a future regression
   while touching this file.
9. RED: signed-in render is unchanged — still one avatar, one email line, one
   sign-out form — proves the new buttons are additive only to the signed-out
   branch.

**Peer's-own-code identity-linking guarantee (the manager's explicit ask,
§0.3) — expressed as what is actually testable without a live Supabase
project:**
10. RED, in `web/src/app/api/profile/route.test.ts` (extend existing file,
    same `mocks.createClient` pattern already there): assert the GET/PUT
    handlers use `user.id` from `supabase.auth.getUser()` for the
    `.eq("user_id", ...)` filter regardless of what identity/provider shape
    the mocked user object carries (e.g. run the existing tests' assertions
    again with a Google-shaped `user_metadata`) — proves no branch anywhere
    keys a lookup off provider identity instead of the session's `user.id`.
    This test likely already effectively exists in spirit (the file's header
    comment already states the derive-server-side-not-from-body rule); the
    new value is running it with a Google-shaped user object as evidence,
    not a new mechanism.
11. RED, same file/route family: a client-supplied `user_id` (or any
    provider-flavored field) in the PUT body is ignored — already covered by
    existing tests per the file's own header comment; re-verify it still
    passes unchanged after §5's edits (it does not touch this route, so this
    is a protective re-run, not a new test).

Gate commands (from `web/`, per `ABC-JEV-INTEGRATION.md` §3a and this item's
own instructions):
```
npx vitest run
npx tsc --noEmit
npx eslint .
npm run build
```
Run each as its own command, record exact pass/fail/skip and counts — no
chaining exit statuses, per §3a.

---

## §7. Ordered C steps

1. Confirm fresh baseline: run the four gate commands above on the current
   tree before any edit; record exact counts (§3a: "no fresh baseline was run
   for this docs-only turn" — B's own turn — so C's baseline is the first
   real one for this item).
2. Write RED tests #1-9 (they will fail to compile/import until step 3-4
   exist) in the two new test files named in §6.
3. Add `signInWithGoogle()` to `use-auth-user.ts` (§5.1). Run RED test #1-2 →
   green.
4. Edit `account-section.tsx`: two-button signed-out branch, shared `busy`
   disabling both, updated sentence, `GoogleMark` component (§5.2). Run RED
   test #6-9 → green.
5. Confirm RED test #3-5 pass unchanged (no `use-auth-user.ts` change was
   needed for them per §2 — if any of the three fail, that is new evidence
   contradicting §2's claim and must be resolved, not silenced, before
   proceeding).
6. Extend `api/profile/route.test.ts` with RED test #10 (Google-shaped user
   object through the existing mock pattern); confirm #11's existing
   assertions still pass untouched.
7. Update `privacy/page.tsx` copy (§5.3).
8. Add the one plain-language line to `docs/JEV-RELEASE-READINESS.md` Part 1
   (§8 below — exact location and suggested wording given there).
9. Do **not** touch `.env.example` (§5, no new variable).
10. Run all four gate commands again from `web/`; record exact pass/fail
    counts against the step-1 baseline.
11. Write the C checkpoint: files changed, before/after gate results, the
    §3/§9 POLICY items explicitly carried forward (not silently resolved by
    C), and the one-time user setup steps (§8) copied or linked into the
    checkpoint so the user does not have to find this file.
12. Do not attempt a live two-provider sign-in test (§3, Case-4/P5) — that
    needs the user's real Supabase project and is a manual step for the user
    or a fresh A with explicit authorization, not something C can automate.

File list for C: `web/src/components/account/use-auth-user.ts`,
`web/src/components/account/use-auth-user.test.ts` (new),
`web/src/components/account/account-section.tsx`,
`web/src/components/account/account-section.test.tsx` (new),
`web/src/app/api/profile/route.test.ts` (extend),
`web/src/app/privacy/page.tsx`, `docs/JEV-RELEASE-READINESS.md`.

---

## §8. The user's one-time setup (plain numbered steps, non-programmer)

Sources cited inline; fetched 2026-09-28.

1. Open Google Cloud Console. If asked to create a project, create one (any
   name) — Google's own docs:
   https://support.google.com/cloud/answer/6158849.
2. Go to the OAuth consent screen setup ("Google Auth Platform" →
   "Audience"/consent screen). Fill in only the required basics: app name, a
   support email address. Peer only ever asks for a person's name, email and
   avatar (Google calls this the "basic" scope set — `email`/`profile`) —
   **Google's own docs confirm apps that request only these basic scopes are
   exempt from the usual "unverified app" warning screen, the 100-test-user
   cap, and the 7-day token expiry** that otherwise apply while an app is in
   "Testing" status (source:
   https://support.google.com/cloud/answer/15549945). Practically: there is
   no need to click "Publish App" or go through Google's verification review
   for this to work for real users signing in with Peer.
3. Create the credential: "Google Auth Platform" → "Clients" → "Create
   Client" → type **Web application**
   (https://developers.google.com/identity/protocols/oauth2/web-server).
4. In "Authorized redirect URIs," add exactly one URL — the Supabase
   project's own callback, not anything on Peer's own domain:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`. Find the exact
   value pre-filled for you on the Supabase dashboard's Google provider
   settings page in the next step (Supabase shows it to you there rather
   than you having to build it yourself). This single URL covers both local
   testing and the live site — it is Google talking to Supabase, never to
   `localhost:3000` or the live domain directly (source:
   https://supabase.com/docs/guides/auth/social-login/auth-google).
5. Click Create. Copy the **Client ID** and **Client Secret** Google shows
   you — you will paste these once, in the next step, and nowhere else.
6. Go to your Supabase project's dashboard → **Authentication → Providers →
   Google**. Turn the provider on. Paste the Client ID and Client Secret from
   step 5 into their fields. Save.
7. One thing to double-check, not a new step: Supabase → **Authentication →
   URL Configuration → Redirect URLs** should already list
   `http://localhost:3000/**` (added while setting up GitHub sign-in, per
   ABC-JEV-INTEGRATION.md §1ad's manager diagnosis) plus the live site's
   address. This list is shared by every provider — Google does not need its
   own separate entry here. If GitHub sign-in already works on both
   localhost and the live site today, this step needs nothing further.
8. Test it: open the app, go to the profile page, click "Sign in with
   Google," sign in with your own Google account. Confirm you land back on
   the same page signed in, with your name/photo showing.
9. If you want to personally verify the "same person, one account" behavior
   (§3, recommended but optional): sign out, sign in with GitHub using an
   email that matches your Google account, sign out again, sign in with
   Google — confirm your saved profile and Daily-email setting are still
   there rather than starting blank. This is the one thing nobody but you,
   with your real Supabase project, can check.

No secret, key, or value from any of these steps belongs in any file in this
repository — they live only in the Supabase dashboard (step 6). This guide
records no value from your setup, per this item's rules.

---

## §9. POLICY — manager decides

- **P1 (metadata robustness, low priority):** make `userName()`/`userAvatar()`
  also fall back to `user.identities[0]?.identity_data` when `user_metadata`
  itself is missing `name`/`avatar_url` (§2's community-reported edge case).
  Touches the GitHub path too (shared helpers), so it is a deliberate
  broadening beyond "add Google," not a required part of this item. Current
  behavior without this fix: graceful degrade to initial-letter avatar / email-
  prefix name, same as an existing GitHub user with a private avatar — never
  broken, just less personalized in a reportedly rare case.
- **P2 (GitHub email-scope hardening, out of this item's scope):** if the
  manager wants Case 2 (§3) closed rather than merely documented, add an
  explicit `scopes` option to the *existing* `signInWithGitHub()` call so
  Supabase is more likely to receive a real address even for a user whose
  GitHub email is private. This changes GitHub's existing, already-shipped
  behavior — needs its own sign-off, not bundled into GOOGLE-SIGNIN.
- **P3 (accept or reject a documented-but-unverified GoTrue behavior):**
  community reports (not the official docs) say Supabase's GitHub provider
  marks every returned email `email_verified: true` unconditionally. Net
  effect here is permissive (linking succeeds more often), with a
  theoretical pre-claim risk the manager may want recorded as an accepted
  cost, per this item's own precedent for named-and-accepted trade-offs
  elsewhere in the spec (e.g. §1w P6/P7 "accepted cost" pattern).
- **P4 (a real "same person, different emails" fix — separate feature):**
  build a signed-in-only "Connect another sign-in method" control using the
  installed `linkIdentity()`/`getUserIdentities()` APIs (§2, confirmed
  present, confirmed unused anywhere in `web/src` today). This is the only
  mechanism that can ever merge two accounts whose provider-reported emails
  genuinely differ (§3 Case 4) — automatic linking cannot, by design. Not
  part of GOOGLE-SIGNIN's "smallest change" mandate; recommend a new item if
  the manager wants it.
- **P5 (one manual live verification, not a C task):** a fresh A (or the
  user) manually confirms real cross-provider linking against the user's own
  Supabase project once Google is wired up (§3, §8 step 9) — no local
  Supabase instance exists in this repo to automate this, and the docs read
  do not state explicitly what happens when linking conditions are not met,
  only what happens when they are.
- **P6 (icon choice, cosmetic):** whether `GoogleMark` uses Google's official
  4-color "G" glyph (the common real-world convention for "Sign in with
  Google" buttons, sitting fine next to a monochrome GitHub mark) or a
  monochrome outline matching `GitHubMark`'s `currentColor` style exactly.
  Either is a small, reversible, C-level call; listed here only because the
  spec asked for "same visual language" and a color glyph is a visible,
  if minor, break from that literal phrase.

---

STATUS: COMPLETE. Every numbered Investigate item (1-7) in the task is
answered above with file/function evidence or an explicit "not found in the
docs read" flag where that is the honest answer. No code, test, or config
file was created or modified by this guide; no live OAuth call was made;
only public documentation pages were fetched (all URLs cited inline); no
secret was written anywhere in this file.
