# GOOGLE-SIGNIN — C checkpoint

STATUS: IMPLEMENTED_PENDING_REVIEW

Item: GOOGLE-SIGNIN (ABC-JEV-INTEGRATION.md §1ad, rulings §1ai). Repo
`D:/local files on this PC/Github/Peer/peer`, branch
`Jev-integration-and-sorting-filtering-enhancement`. Role: C (implementer).
Guide: `docs/jev-abc/GOOGLE-SIGNIN-B-20260928T025655Z.md` (STATUS: COMPLETE).

No live sign-in, no live OAuth call, no database, no deploy, no push made or
attempted. No secret read, written, or viewed; `web/.env` / `web/.env.local`
never opened. No file belonging to TAB-ICON-THEME, HOME-READING-LAYOUT, or
SIGNIN-MERGE touched.

---

## Plan (guide §7, adjusted for manager rulings §1ai)

1. Baseline gates (below).
2. RED tests: `use-auth-user.test.ts`, `account-section.test.tsx` (new),
   extend `api/profile/route.test.ts`.
3. `signInWithGoogle()` in `use-auth-user.ts`.
4. Two-button `account-section.tsx` + `GoogleMark` (P6: official multicolor G).
5. `privacy/page.tsx` copy.
6. `docs/JEV-RELEASE-READINESS.md` Part 1 line.
7. GREEN gates.
8. This checkpoint → IMPLEMENTED_PENDING_REVIEW with the user's one-time setup
   steps.

## P2 finding — recorded ahead of the rest per the ruling's own request

Ruling §1ai P2: "C checks by reading the installed auth-js/Supabase docs
whether the GitHub provider already requests the email scope; if it does
NOT, add the minimal `scopes: "user:email"` to signInWithGitHub... If it
already does, change nothing and say so."

The installed `@supabase/auth-js` (`web/node_modules/@supabase/auth-js`) is
the browser/client SDK only — it sends whatever `scopes` string the caller
passes and has no knowledge of any provider's server-side default, so it
cannot answer this by itself (confirms guide §2's own note that linking/
provider behavior is server-side). The server is Supabase's hosted Auth
service, whose source is public: `github.com/supabase/auth`
(formerly GoTrue). Read directly (not community-sourced):
`https://raw.githubusercontent.com/supabase/auth/master/internal/api/provider/github.go`,
fetched twice independently (once via a fetch tool, once via a direct `curl`
of the raw file, both returning byte-identical content) — quoting the exact
function:

```go
oauthScopes := []string{
    "user:email",
}

if scopes != "" {
    oauthScopes = append(oauthScopes, strings.Split(scopes, ",")...)
}
```

**Finding: yes, it already does.** `NewGithubProvider` unconditionally seeds
the scope list with `user:email` before appending anything Peer's own
`scopes` option would add — this is hardcoded in Supabase's Auth server,
independent of what any client (Peer included) sends. Ruling: **no change to
`signInWithGitHub()`.** `use-auth-user.ts` is left exactly as-is for the
GitHub path.

Incidental, same-file evidence bearing on guide §3 Case 2/P3 (not this
item's scope to act on — P2 said document either way, P3 said caveat only,
no code — recorded only because it surfaced while answering P2, and because
it is more authoritative than the community threads the guide could cite):
`GetUserData` in the same file calls `GET /user/emails` (the endpoint
`user:email` scope exists to unlock — it returns every address on the
account, public or not, each with the provider's own `verified`/`primary`
flags), not the `GET /user` endpoint's public-profile `email` field (which is
genuinely null for a private email, the guide's own citation). Supabase's
server also forwards GitHub's real per-address `verified` flag rather than
marking every email verified unconditionally. This means Case 2 (private
GitHub email defeating linking) is narrower in practice than the community
threads suggested — a private email still reaches Supabase via this
endpoint as long as the GitHub account has at least one address there at
all. This does not change any ruling (P2/P3 stand as decided); noted for the
record only.

## Baseline gates (before any edit)

1. `npx vitest run` — **1 file failed | 266 passed | 3 skipped (270 files)**;
   **20 tests failed | 4861 passed | 6 skipped (4887 total)**. All 20
   failures are in `src/lib/tab-icon.test.ts` (`TypeError:
   document.querySelectorAll is not a function` inside `paintTabIcon`/
   `startTabIconSync`, `src/lib/tab-icon.ts`) — TAB-ICON-THEME's own
   untracked, in-progress file (parallel writer; not in my file list; not
   touched). Re-ran that one file alone: identical 20 failed/17 passed —
   confirmed isolated, not an interaction with anything else in the suite.
   Attributed, not fixed.
2. `npx tsc --noEmit` — clean, 0 errors, no output.
3. `npx eslint .` — **0 errors, 150 warnings.** This item's own instructions
   cite a "149-warning baseline" — it is now 150 before I have changed
   anything. The one new warning is `src/lib/tab-icon.ts:78` ("Unused
   eslint-disable directive") — again TAB-ICON-THEME's own untracked file.
   Baseline shift attributed to that parallel work, not to GOOGLE-SIGNIN.
4. `npm run build` — succeeded, all routes compiled/prerendered, 0 errors.
   One pre-existing Turbopack warning (NFT trace note on `next.config.ts` /
   `src/lib/papers/pdf-text.ts` / `api/papers/upload/route.ts`), unrelated to
   this item, present before any edit.

## RED → GREEN, per file

**`web/src/components/account/use-auth-user.test.ts` (new, 7 tests).** Before
`signInWithGoogle()` existed: 2 failed (`TypeError: signInWithGoogle is not a
function`), 5 already passed unchanged (the two `signInWithGitHub` tests and
all three `userName`/`userAvatar` Google-shaped-user tests — confirms guide
§2's "no code change needed" claim for the fallback chain, empirically, not
just by inspection). After adding `signInWithGoogle()`: 7/7 pass.

**`web/src/components/account/account-section.test.tsx` (new, 8 tests).**
Before the two-button UI: 4 failed (both-buttons-present, updated sentence,
2-buttons-with-accessible-names, shared-disabled-source), 3 already passed
(unconfigured/loading render nothing, signed-in branch unchanged — proves
"additive only" before any change). One of my own first test drafts was
itself wrong, not the source: a "no button is disabled" check used
`not.toMatch(/\bdisabled\b/)` against the full class list, which false-
positives on Tailwind's own `disabled:opacity-55`/`disabled:cursor-wait`
variant classes. Fixed to check the literal `disabled=""` attribute string,
and — since a static render can't click, so it can't observe `busy` flip to
`true` — added a second test that reads the component's own source (the same
technique `src/components/plan/pro-plan-summary.test.tsx` already uses) and
asserts `disabled={busy}` appears verbatim exactly twice inside the
signed-out branch, proving both buttons key off the one shared variable
rather than two independent flags. After the two-button UI + shared `busy`:
8/8 pass.

**`web/src/app/api/profile/route.test.ts` (extended, +2 tests, 22 → 24).**
Added under a new describe block per handler direction: (a) GET maps a
profile identically for a session user carrying Google-shaped
`user_metadata`/`app_metadata` (full_name, avatar_url, picture, provider
fields) — the shared mock's `.eq()` ignores its arguments like every other
test in this file already does, so this proves "nothing crashes or diverts
on this shape," not the `.eq` argument itself; (b) PUT upserts under the
session's real `user.id` even with a Google-shaped session AND a request
body that tries to smuggle `user_id`/`provider` fields — this one DOES
inspect the actual upsert argument, so it is the direct proof for the
write path. Both pass; all 22 pre-existing tests in the file still pass
unchanged (protective re-run, guide RED #11).

**A concurrent, external change landed in this same file mid-session, not
mine:** a SIGNIN-MERGE session (§1aj, fixing the §1ah root-cause 409-on-every-
save bug) rewrote the "feed_intent schema unavailable" test and the matching
branch in `route.ts` itself while I was working — the old hard-409 became a
strip-and-retry, mirroring the digest_email/preference_ledger branches
already in that function. Confirmed by reading the diff: coherent, well-
documented, consistent with ABC-JEV-INTEGRATION.md §1ah/§1aj, and orthogonal
to both my new tests (neither sends `feedIntent`) and every other pre-
existing test in the file (all still green). Not reverted, not touched,
per the standing instruction to take a live change to a shared file as
current state rather than undo it. Flagged here only for the record.

## Final gates (after all edits, from `web/`)

1. `npx vitest run` — **270 files passed | 3 skipped (273), 0 failed**;
   **4901 tests passed | 6 skipped (4907), 0 failed.** The baseline's 20
   `tab-icon.test.ts` failures are gone — TAB-ICON-THEME fixed their own file
   in parallel during this session; I did not touch it. File/test-count rose
   by more than my own +2 files/+17 tests because HOME-READING-LAYOUT and
   SIGNIN-MERGE also landed work concurrently (confirmed via `git status`:
   `web/src/app/page.tsx` + new `page.test.tsx`, `web/src/app/api/profile/
   route.ts`, both outside my file list). Full suite green.
2. `npx tsc --noEmit` — clean, 0 errors.
3. `npx eslint .` — **0 errors, 149 warnings — back to the documented
   baseline exactly** (the +1 from my own baseline run was TAB-ICON-THEME's
   transient warning, gone once they fixed their file; my own additions
   introduced zero new warnings).
4. `npm run build` — succeeded, 0 errors, every route compiled/prerendered
   including `/privacy` and `/profile`. Same one pre-existing, unrelated
   Turbopack NFT-trace warning as baseline.

## Files changed (mine only)

- `web/src/components/account/use-auth-user.ts` — added `signInWithGoogle()`.
  `userName()`/`userAvatar()`/`signInWithGitHub()` untouched (P1, P2).
- `web/src/components/account/use-auth-user.test.ts` — new, 7 tests.
- `web/src/components/account/account-section.tsx` — two-button signed-out
  branch in a `flex flex-wrap gap-2` row, shared `busy` disables both,
  updated sentence, new `GoogleMark` (P6).
- `web/src/components/account/account-section.test.tsx` — new, 8 tests.
- `web/src/app/api/profile/route.test.ts` — extended, +2 tests (see above;
  file also carries an unrelated concurrent SIGNIN-MERGE change).
- `web/src/app/privacy/page.tsx` — label "If you sign in with GitHub" →
  "If you sign in"; first sentence now names both OAuth providers instead of
  only GitHub. Deliberately NOT changed: the "Last changed 2026-09-17" date
  at the bottom — bumping it without a matching changelog entry (out of this
  item's file list, and I don't know that file's own conventions well enough
  to extend it safely) would make the page contradict its own "changes to
  this page ship in the changelog" sentence; left for whoever owns that
  process. Deliberately NOT added: an identity-linking/same-email explanation
  on this page — out of the guide's and the manager's actual instruction for
  this file ("name both sign-in providers accurately"); that explanation is
  the release-readiness doc's job (below), not the privacy page's.
- `docs/JEV-RELEASE-READINESS.md` — one Part 1 paragraph appended to "What
  changed since the last version of this document" (after "Jev's password
  changed rooms," before "What's safe today"): Google sign-in exists, same
  email = one account automatically, different emails = two accounts until a
  future "connect" feature, points at this checkpoint's setup steps below. No
  backticks, no PEER_/JEV_/OPENALEX_ literals, no .ts/.sql, matching Part 1's
  own style throughout.

## POLICY items carried forward, not resolved by C (manager's call, §1ai)

- **P1** (metadata robustness fallback to `identities[0]?.identity_data`):
  not built — no test showed a gap; the three Google-shaped-user tests in
  `use-auth-user.test.ts` are the evidence this stays true.
- **P2**: resolved this round — see the finding above. No code change.
- **P3** (GitHub's `email_verified` trustworthiness): documented as a caveat
  only, per the ruling; my own incidental finding above (Supabase does
  forward GitHub's real per-address `verified` flag) is additional evidence
  for the manager, not a resolution — still the manager's call.
- **P4** (a "connect another sign-in method" feature for genuinely different
  emails): not built, per the ruling. This is the one real gap in "same
  person = one account" and is named as such in both the privacy-page-
  adjacent copy and the release-readiness paragraph above.
- **P5** (the one live cross-provider check): not done by C, per the ruling
  — needs the user's real Supabase project. Steps below, last item.
- **P6** (icon choice): built — Google's official multi-colour "G" mark,
  unmodified, 13×13 to match `GitHubMark`'s box.

## THE USER'S ONE-TIME SETUP

Nothing above works until you do this once. No secret, key, or value from
these steps belongs in this repository — they live only in Google's and
Supabase's own dashboards.

1. Open Google Cloud Console. If it asks you to create a project, create one
   (any name).
2. Go to the OAuth consent screen setup. Fill in only the required basics:
   an app name and a support email address. Peer only ever asks Google for a
   person's name, email and avatar — Google's own rules exempt an app asking
   for only this much from its usual "unverified app" warning, so you do not
   need to click "Publish" or go through Google's review for this to work for
   real users.
3. Create a credential: "Clients" → "Create Client" → type **Web
   application**.
4. Add exactly one "Authorized redirect URI" — not your own site's address,
   but your Supabase project's own callback address. Supabase shows you the
   exact value to paste on the page in the next step, so you do not have to
   build it yourself. This one address covers both your local testing and
   the live site.
5. Click Create. Copy the Client ID and Client Secret Google shows you — you
   paste these once, in the next step, and nowhere else.
6. Go to your Supabase project's dashboard → Authentication → Providers →
   Google. Turn the provider on. Paste the Client ID and Client Secret from
   step 5. Save.
7. One thing to double-check, not a new step: Supabase's Authentication → URL
   Configuration → Redirect URLs should already include your local address
   from setting up GitHub sign-in, plus your live site's address. This list
   is shared by every provider, so Google needs no separate entry there. If
   GitHub sign-in already works for you today, this needs nothing further.
8. Test it: open the app's profile page, click "Sign in with Google," sign in
   with your own Google account. Confirm you land back on the same page,
   signed in, with your name and photo showing.
9. Optional, but the one thing only you can check (POLICY P5 above): sign
   out, sign in with GitHub using an email that matches your Google account,
   sign out again, then sign in with Google. Confirm your saved profile and
   email settings are still there rather than starting blank — that is the
   "same person, one account" promise actually holding for your own two
   accounts.

Sources: Google Cloud project basics
(https://support.google.com/cloud/answer/6158849); the "Testing" status
exemption for basic scopes
(https://support.google.com/cloud/answer/15549945); creating a Web
application OAuth client
(https://developers.google.com/identity/protocols/oauth2/web-server);
Supabase's own Google sign-in guide
(https://supabase.com/docs/guides/auth/social-login/auth-google); Supabase's
identity-linking behavior
(https://supabase.com/docs/guides/auth/auth-identity-linking).
