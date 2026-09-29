# GOOGLE-SIGNIN — A (reviewer) checkpoint

STATUS: VERIFIED_OFFLINE_BOUNDED

Item: GOOGLE-SIGNIN (ABC-JEV-INTEGRATION.md §1ad, rulings §1ai). Repo
`D:/local files on this PC/Github/Peer/peer`, branch
`Jev-integration-and-sorting-filtering-enhancement`. Role: A (reviewer) — fresh
agent, implemented nothing in this item. Reviewed: B's guide
(`docs/jev-abc/GOOGLE-SIGNIN-B-20260928T025655Z.md`, STATUS COMPLETE) and C's
checkpoint (`docs/jev-abc/GOOGLE-SIGNIN-C-20260928T030602Z.md`, STATUS
IMPLEMENTED_PENDING_REVIEW).

No edit made outside this checkpoint file (two required mutations applied and
restored byte-identically, proven below). No git command that changes
anything. No real sign-in attempted, no live data written, no deploy. `web/.env`
/ `web/.env.local` never opened. `peer-followup` never touched.

---

## Snapshot (SHA256 + git status --porcelain, before and after review — identical)

```
97f3c229ce3d6e6f621dd38359a4d8e440f463cd6354ac0249e28cc81a1e3363  web/src/components/account/use-auth-user.ts        (M)
96e922f36db74dae8fc1bd6c9948bc60a59d6efe300e0f391516fec56456eeba  web/src/components/account/use-auth-user.test.ts   (??)
9f21a70cc0c4ba152c7f2b67a16c0f8804bb4cfc208f8d7a3a4b090b1d40109a  web/src/components/account/account-section.tsx     (M)
cb19c8ed194f6c40aee10bf9eefdc99e84693493a78b007df4b54ff4f3fcff1e  web/src/components/account/account-section.test.tsx(??)
005f56d62aa1a88cd60a5ba88891a2654dc86ca9dd3c6eacae2118cfe7f27e56  web/src/app/privacy/page.tsx                        (M)
e105c841e69df3e710d2de8d39cba89c56b96a657a42bf19efafc08ae1d079f5  web/src/app/api/profile/route.test.ts               (M)
3123c1ba35eb46c178063a48699fb3f8aede9c0b72bda48d3c6a57e8f484b1f5  docs/JEV-RELEASE-READINESS.md                       (M)
```

Re-hashed after all checks (including both required mutations, restored) —
every value above is unchanged. `web/.env.example` also confirmed untouched
(`git status --porcelain` blank) and contains no Google-named entry — matches
the guide's "no `.env.example` change" claim.

Confirmed via `git status --porcelain` at review time that a concurrent
SIGNIN-MERGE session has `web/src/store/feed.ts`, `web/src/store/feed.test.ts`,
`web/src/components/feed-sync.tsx`, `web/src/components/profile-sync.tsx`,
`web/src/app/api/profile/route.ts`, plus new `web/src/lib/profile/merge.ts`
(+`.test.ts`) and `feed-sync.test.ts`/`profile-sync.test.tsx` in flight — none
of these are in this item's file list; judged out of scope per instruction,
see Gates below.

---

## Checks

**1. `signInWithGoogle()` shape — PASS.**
`web/src/components/account/use-auth-user.ts:82-92`. Calls
`supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo:
`${origin}/auth/callback`, queryParams: { prompt: "select_account" } } })` —
same origin-derived `redirectTo` construction as `signInWithGitHub`, same
`/auth/callback`. `prompt: "select_account"` is a real, documented Google
parameter (verified live against
https://developers.google.com/identity/protocols/oauth2/web-server: values
`none`/`consent`/`select_account` confirmed, quote matches). `signInWithGitHub`
(lines 64-71) is unchanged — still only `provider: "github"` +
`redirectTo`, no `scopes` option added (correct per P2 finding, see Check 3).
Both functions guard `if (!supabase) return;` before any call — no-op when
Supabase is unconfigured, confirmed both by reading the source and by running
the tests (`use-auth-user.test.ts`, both "resolves without calling anything
when Supabase is not configured" cases pass).

**2. Account section UI — PASS, verified in the running app, not just the source.**
Read `account-section.tsx` in full: signed-out branch renders GitHub button
first, Google button second, both `buttonVariants({ tone: "surface", size:
"md" })`, both `disabled={busy}` (one shared boolean, not two flags — see
mutation proof in Check 7), both native `<button type="button">` with visible
text (no icon-only control, no extra `aria-label` needed), both icon `<svg>`s
`aria-hidden`. Sentence reads "Sign in with GitHub or Google to sync saves and
reads across your devices." Signed-in branch untouched (one avatar, one email
line, one sign-out form — confirmed unchanged by diff-reading and by the
"additive only" test passing).

Opened `http://localhost:3000/profile` in my own background browser tab
(confirmed signed-out first — no session), scrolled to the Account section,
screenshotted in both themes:
- **Light:** white "surface"-tone buttons with a thin border. GitHub button:
  dark octocat + "Sign in with GitHub". Google button: Google's actual
  four-colour "G" (blue/green/yellow/red) + "Sign in with Google", same size
  and alignment as the GitHub button — reads as one calm family, not a
  competing CTA.
- **Dark:** same layout; GitHub's mark inverts to light (it uses
  `currentColor`, confirmed in source) matching the surrounding text; Google's
  mark stays the identical four colours (its SVG uses fixed hex fills
  `#4285F4`/`#34A853`/`#FBBC05`/`#EA4335` — Google's own brand colours, not
  `currentColor`) — correct, since Google's own branding rules require the
  mark unmodified regardless of surrounding theme, the same way GitHub's own
  octocat mark is used unmodified today.
- Getting the dark screenshot required forcing `document.documentElement
  .dataset.mode = 'dark'` via read-only JS inspection in my own tab: emulating
  an OS-level dark preference through the browser tool (`prefers-color-scheme:
  dark` confirmed `true` via `matchMedia`) did not by itself flip the
  rendered theme even though the page's own `data-mode` was `"system"`. This
  is a theming-system observation orthogonal to GOOGLE-SIGNIN (this item added
  no theme code) and is flagged only for whoever owns TAB-ICON-THEME/general
  theming, not scored against this item.

Confirmed by grep (`Sign in with`, `signInWithGitHub`, `signInWithGoogle`
across `web/src`) that account-section.tsx/.test.tsx remain the only files
with sign-in UI text or call sites — no duplicate or stale sign-in surface was
introduced by any concurrent agent's work.

**3. Same-email = one account — PASS, with the same honest limits B/C already named, independently re-verified.**
Re-fetched https://supabase.com/docs/guides/auth/auth-identity-linking live:
confirms automatic linking triggers when a new-provider sign-in's email
matches an existing user, confirms unverified emails are never auto-linked
("insecure practice... pre-account takeover attacks" — same substance B
quoted), and confirms the docs name no dashboard setting that disables
automatic linking (only a setting to *enable* manual linking exists). Read
`web/supabase/schema.sql` myself: line 7, `public.profiles(user_id uuid
primary key references auth.users(id) on delete cascade)` — one profile row
per Supabase user id, a Postgres primary key, not app logic; a linked identity
reuses the same `auth.users` row, so it lands on the same profile row
automatically. This matches B's and C's claims exactly.

Independently re-fetched (via `curl`, byte-for-byte, sha256
`5634e7205fc1e2970fdc84e3551e641e288fa1aa7d005f6d802bd7ecb5754768`)
`github.com/supabase/auth`'s `internal/api/provider/github.go` myself, not
trusting C's quote: confirms `oauthScopes := []string{"user:email"}` is
unconditionally seeded before any caller-supplied scopes are appended — P2's
"no change to signInWithGitHub()" ruling is correctly justified; GitHub's
`user:email` scope is already requested server-side regardless of what Peer
sends. Also independently confirms C's incidental finding: `GetUserData` calls
both `/user` (name/avatar) and `/user/emails`, and for every email returned
sets `Email{Email: e.Email, Verified: e.Verified, Primary: e.Primary}` —
GitHub's own real per-address `verified` flag is forwarded, not hardcoded
true. This is new, better evidence than the community threads B cited for
P3 — it suggests the "always marked verified" community report may be stale
or about a different code path — but does not change any ruling: P3 stays a
documented caveat, no code required, exactly as §1ai ruled.

Cases where two Peer accounts would still appear, stated plainly (matching
the paragraph added to the readiness doc): (a) the person's GitHub and Google
accounts report two genuinely different email addresses — no automatic
mechanism can merge these, and Peer has no "connect another sign-in method"
control yet (confirmed by grep: `linkIdentity`/`getUserIdentities` are
exported by the installed auth-js package but called nowhere in `web/src`);
(b) the residual, narrower case of a GitHub account with no email on file via
`/user/emails` at all (rare — the endpoint returns private addresses too, not
just the public-profile field). Both are already named honestly in the
readiness-doc paragraph and left as POLICY P4/P5 for the manager, not silently
assumed solved.

**4. Privacy page copy — PASS.**
`web/src/app/privacy/page.tsx`: line 27 label now "If you sign in" (was
"If you sign in with GitHub"); line 29 "Signing in is GitHub or Google OAuth
through Supabase. Peer receives the account id and email address the provider
returns, and stores them in its own database." Accurate for both providers.
No other section on the page names a specific provider, so nothing else
needed changing. The "Last changed" date/changelog line was deliberately left
alone by C, which is honest (bumping a date with no changelog entry would
itself be inaccurate) — not this item's problem to fix.

**5. Readiness-doc paragraph — PASS.**
`docs/JEV-RELEASE-READINESS.md` lines 116-129 ("You can now sign in with
Google, not just GitHub...") accurately reflects the actual behavior verified
in Checks 1-3: automatic same-email merge, no button yet for genuinely
different emails, one-time setup needed, pointer to the walkthrough. Ran a
targeted grep over Part 1 only (lines 19-385, the boundary confirmed by
locating "## Part 2 — Technical appendix" at line 386): zero backticks, zero
`PEER_`/`JEV_`/`OPENALEX_` literals, zero `.ts`/`.sql` occurrences anywhere in
Part 1 — plain-language rule holds for the whole part, not just the new
paragraph.

**6. User's one-time setup steps — PASS, checked against live current docs, not memory.**
Re-fetched three more live sources specifically to check the setup walkthrough
in the C checkpoint:
- https://supabase.com/docs/guides/auth/social-login/auth-google — confirms
  the Authorized redirect URI is the Supabase project's own callback (its
  docs' own example: `.../auth/v1/callback`), never the app's own domain, and
  confirms the Client ID/Secret are entered on the Supabase dashboard's Google
  provider page, not in app code.
- https://support.google.com/cloud/answer/15549945 — confirms, close to a
  word-for-word match of the checkpoint's own quote, that apps requesting only
  `email`/`profile`/`openid` scopes are exempt from the unverified-app
  warning, the 100-test-user cap, and the 7-day token expiry that otherwise
  apply in "Testing" status — i.e., the claim that a user does not need to
  click "Publish" or go through Google's verification review for this to work
  for real users is accurate for Peer's scope (name/email/avatar only).
- https://developers.google.com/identity/protocols/oauth2/web-server —
  confirms "Web application" is the correct OAuth client type for this flow,
  and confirms the `prompt` parameter values used in code.
No secret-handling problem: every step keeps the Client ID/Secret inside
Google's and Supabase's own dashboards; confirmed no Google-named variable
exists in `.env.example` (Check, above).

**7. Tests + mutation proof — PASS.**
Ran the three files together (`use-auth-user.test.ts`,
`account-section.test.tsx`, `api/profile/route.test.ts`) unmodified: **3
files passed, 40 tests passed, 0 failed.**
Mutation A — changed `provider: "google"` to a wrong string in
`use-auth-user.ts`: exactly one test failed (`signInWithGoogle > calls
signInWithOAuth with the google provider...`), clean diff showing the
provider mismatch, the other 6 tests in that file stayed green. Restored;
SHA256 confirmed identical to the original snapshot.
Mutation B — removed `disabled={busy}` from the Google button in
`account-section.tsx`: exactly one test failed (`both sign-in buttons read
the SAME disabled={busy} expression, not two independent flags`), the other 7
tests in that file stayed green. Restored; SHA256 confirmed identical to the
original snapshot.
Both mutations hit precisely the assertion they were designed to test, not an
unrelated one — the test suite's specificity is real, not accidental.

**8. Gates, from `web/` — PASS for this item's own files; unrelated failures attributed, not scored against GOOGLE-SIGNIN.**

1. `npx vitest run` — **2 files failed | 270 passed | 3 skipped (275); 4 tests
   failed | 4926 passed | 6 skipped (4936).** All 4 failures are in
   `src/store/feed.test.ts` and `src/store/feed-opportunity-pool.test.ts`,
   both named in their own test descriptions as SIGNIN-MERGE §1aj work; `git
   status --porcelain` confirms `feed.ts`/`feed.test.ts` are `M` right now
   (actively being edited) and neither file is in this item's file list.
   Re-running just those two files alone produced a *different* failure count
   (2 failed, not 4) seconds later — the file's content is changing between
   runs, direct evidence of a live concurrent editor, not a stable regression
   this item could have caused. My own three files, run alone, are 3/3 files
   and 40/40 tests green (above).
2. `npx tsc --noEmit` — **4 errors**, all in `src/lib/profile/merge.test.ts`
   (untracked, new SIGNIN-MERGE file) and `src/store/feed.test.ts` (`M`,
   SIGNIN-MERGE) — zero errors in any GOOGLE-SIGNIN file.
3. `npx eslint .` — **0 errors, 149 warnings** — exactly matches C's claimed
   final baseline (150 at C's own pre-edit baseline, attributed there to a
   transient TAB-ICON-THEME warning; back to 149 now).
4. `npm run build` — **succeeded, 0 errors**, every route compiled/prerendered
   including `/privacy` and `/profile` (both static). One pre-existing,
   unrelated Turbopack NFT-trace warning on `next.config.ts` /
   `src/lib/papers/pdf-text.ts` / `api/papers/upload/route.ts` — present
   before this item existed, not caused by it.

---

## Findings (one line each)

- Check 1 (signInWithGoogle shape, signInWithGitHub unchanged, no-op guard): PASS.
- Check 2 (two buttons, shared busy, a11y, copy, Google branding, signed-in unchanged — verified live in browser, light + dark): PASS.
- Check 3 (same-email = one account; cases that still split; independently re-verified GoTrue source + Supabase docs): PASS.
- Check 4 (privacy page copy accurate for both providers): PASS.
- Check 5 (readiness-doc paragraph accurate; Part 1 stays plain, grep-verified over the correct line range): PASS.
- Check 6 (user setup steps correct against live Supabase + Google Cloud docs, re-fetched independently): PASS.
- Check 7 (tests run; 2 mutations both turned exactly the intended assertion red; byte-identical restore proven by SHA256): PASS.
- Check 8 gate numbers: vitest 2 files/4 tests failed (both attributed to concurrent SIGNIN-MERGE files, not this item; this item's own 3 files are 40/40 green); tsc 4 errors (all attributed, same reason, zero in this item's files); eslint 0 errors/149 warnings (matches C's claimed baseline exactly); build succeeded, 0 errors.
- Non-blocking observation, out of this item's scope: emulating an OS dark-color-scheme preference did not flip the profile page's rendered theme even with `data-mode="system"` and `matchMedia` reporting dark — a theming-system question for whoever owns TAB-ICON-THEME/general theming, not a GOOGLE-SIGNIN defect (this item touched no theme code).
- No live two-provider sign-in test was performed (correctly out of scope per the task's own rules and P5 — needs the user's real Supabase project); this remains the one thing only the user can confirm, per B/C's own honest flagging.

## Verdict

**VERIFIED_OFFLINE_BOUNDED.** Every check above passes on this item's own
files with independent, re-fetched evidence (not just re-reading B/C's
citations). The only gate failures present right now belong to a concurrent
SIGNIN-MERGE session's in-progress files, confirmed by git status and by
reproducing a different failure count seconds apart — not this item's fault
and not fixable from within this item's scope. No live cross-provider sign-in
was attempted, per the task's own rules; that one check remains the user's or
a later fresh A's to do once the account exists for real.
