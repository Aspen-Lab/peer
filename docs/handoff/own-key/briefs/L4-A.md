# Brief L4-A — review lane 4 (sign-in in the walkthrough, coming back after sign-in, the sign-out dialog)

Role: **A, the reviewer.** You read, run and judge. You never edit code, never commit, never branch, never push.

## What to review

- Worktree (read and run here only): `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane4` — detached HEAD; lane 4's five commits sit on top of `db0f070a`: `git log --oneline db0f070a..HEAD`, `git diff db0f070a..HEAD`. `web/node_modules` is a complete install. If the harness blocks you from that path, enter it with EnterWorktree(path); write nothing anywhere except your report file below.
- What lane 4 was asked to build:
  1. An optional "Account" step first in the Welcome wizard (`/welcome`), with "Sign in with GitHub" / "Sign in with Google" and "Continue without signing in"; hidden where sign-in is not configured.
  2. A "Sign in to use your key" block on the wizard's "AI" step for a signed-out reader.
  3. Coming back to the wizard step after OAuth through a short-lived first-party cookie checked by the callback; the callback's `next` parameter checked by the same rule.
  4. The wizard's AI summary for a reader with a saved key who is signed out.
  5. On Profile, "Sign out" opens one dialog when this browser holds an API key (and/or has unsynced changes): which keys go, why (safety), what to do next; "Stay signed in" / confirm.
  6. "Reset profile to defaults" says it removes the API keys too.

## Rules the work must obey

- The existing sign-in must behave as before: the Profile page's Account section, the GitHub and Google OAuth calls, the callback's session exchange.
- A reader's API keys stay in the browser; nothing about them is sent, stored or logged; the dialog never shows any part of a key.
- No open redirect; no new production configuration (Supabase allow-list, Vercel) needed.
- No price, paid tier, trial, upgrade, waitlist, donation or sponsorship wording; no "founder"; no "BYOK" / "Tier N" in rendered text. No new dependency; tests not weakened (lane 4 re-aimed four source-text tests: say whether each re-aim is honest).

## What to do

1. Read the diff in full.
2. Judge, PASS or FAIL with evidence (file:line, a test you ran, or a static render you produced with a throwaway script outside the repo):
   - **A5, A6, A7, A8, A9** — every new sentence: true, plain, right for each state (signed out / signed in / unconfigured / unknown; one key / two keys / none; unsynced or not).
   - **B1** sign-in reachable from the walkthrough; **B2** return after OAuth (cookie written only with a checked `returnTo`, cleared otherwise, read once, cleared on the response); **B3** the callback accepts only `/welcome` or `/profile` (plus a query) for both the cookie and `next` — try to break it (encodings, `@`, `//`, backslashes, `%2F`, unicode, long values, a valid prefix with a different path); **B4** unconfigured sign-in hides the step; `/welcome?step=ai` and the step rail still work; **B6** the dialog: when it appears, Esc / "Stay signed in", the real POST on confirm, the double-submit guard; **B7** after a confirmed sign-out the keys are gone (read `processConfirmedSignOutCookie` and `logOut`).
   - What a returning signed-out reader who has finished every step sees when the wizard reopens (lane 4 says: the Account step). Is that a defect, and how bad?
   - Anything else that would mislead or break a reader.
3. Run, from `web/`: `npx vitest run src/app/auth src/app/welcome src/components/account src/lib/navigation src/app/profile/page.test.tsx src/lib/feed/ui-vocabulary.test.ts src/lib/feed/no-company-model-copy.test.ts`.
4. Cost each defect: 1.0 unusable, 0.5 misleading, 0.25 cosmetic, with the arithmetic per unit.

## Report

Write `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\L4-A-<UTC timestamp>.md` with PASS/FAIL per unit and evidence, every defect with its cost and the smallest fix you would suggest, and anything you could not check (no dev server and no sign-in are allowed: Supabase is the production project). Return one paragraph (under 250 words) naming the file and the defects.
