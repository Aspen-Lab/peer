# Brief L4-fix — the sign-out promise always holds; the wizard reads right after sign-in

Role: **C, the implementer** (lane 4's own C, resumed). Ruling R13 in `docs/handoff/own-key/ABC-own-key.md` decides everything below. Reviewer evidence: `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\L4-A-20261028T1818Z.md`.

## Where

- Worktree `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane4`, now checked out (detached) at the branch tip, which holds all four lanes and lane 3's fix. Your earlier commits are in it (27c1d03a, 2fc2367b, a6278be9, 395e5cfe, acbc8adf). `web/node_modules` is a complete install. Enter it with EnterWorktree(path) if writes are blocked.
- Yours for this pass: `web/src/components/account/account-section.tsx`(+test), `web/src/app/welcome/{page.tsx,completeness.ts,summary.ts,account-step.tsx}`(+tests), `web/src/app/profile/page.tsx` (the reset block only), and, for item 1b only, `web/src/components/profile-sync.tsx` (`processConfirmedSignOutCookie` and its helpers) and `web/src/store/profile.ts` (one new action) with their tests.
- Not yours: `components/profile/ai-setup.tsx`, `components/profile/key-check.tsx`, `lib/papers/reading.ts`, `app/privacy/*` (another pass owns them).

## Rules

Same as before: commit on the detached HEAD, never push or branch, both trailers on every commit (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `Co-authored-by: peter14531453 <274981268+peter14531453@users.noreply.github.com>`), no dev server, no sign-in, no new dependency, tests land with the change, no banned wording. Gates per commit from `web/`: `npx tsc --noEmit`, `npx eslint <changed>`, `npx vitest run <affected>`. Baseline failures you will see and must leave: `privacy/page.standing.test.tsx`, `privacy/page.test.tsx` "a saved upload's record …", `jev-setup.test.tsx` "JevScreeningStatus is mounted …", `store/reader-panes.test.ts`, `store/reading-prefs.test.ts`.

## Items

1. **Keys never survive a confirmed sign-out** (A's D4, 0.5). Today "Confirm reset" on Profile calls `logOut()`, which also nulls `syncedAccountId` while the reader stays signed in; a sign-out in the same visit then skips `logOut()` (`shouldClearOnConfirmedSignOut` needs an owner) and the key the dialog promised to remove stays — and the next account on this browser inherits it.
   a. In "Confirm reset", when the reader is signed in, record the account again right after `logOut()` (`setSyncedAccountId(authUserId)` from `useSyncGate`), so "signed in ⇒ owner recorded" always holds.
   b. Belt and braces: on a confirmed sign-out (the `peer_signed_out` cookie path), always clear this browser's API keys — model provider back to "default", model key and Jev key blank, the Jev screening report cleared — even when no owner is recorded. Add one store action for it (e.g. `clearDeviceKeys()`), call it from `processConfirmedSignOutCookie` whenever the cookie is present and the outcome is confirmed signed out; leave the rest of the "clear only when an owner is recorded" rule exactly as it is. Tests for both, including the reviewer's sequence (reset → paste a key → sign out → the key is gone; a second account signing in does not inherit it).
2. **Singular and plural in the dialog** (D2, 0.25). One key: title "Sign out and remove your key?", "… paste it again.", "If it stayed …", confirm button "Sign out and remove key". Two keys keep today's plural wording. Never print a key.
3. **The Account step after sign-in** (D1, 0.25). Signed in, the step's title and subtitle change: title "You are signed in.", subtitle "Your topics, saved papers and settings now follow your account. Your API keys stay in this browser." (drop the now-redundant body line "You are signed in." if it would repeat). Signed out and unknown stay as they are.
4. **Resume step** (D3, 0.25). When every step other than Account is done and the reader is signed out, opening `/welcome` without `?step=` resumes where it did before this work (the last step), not on Account. A new reader still starts on Account. Test both.
5. **AI summary while the sign-in check is unanswered** (director note N1, 0.25). With a key saved and auth `unknown`, the Welcome AI summary must not tell the reader to sign in: show "<Provider> key saved". `signed-out` keeps "… key saved — sign in to use it"; `signed-in` and `unconfigured` keep "… key connected".

## Report back (under ~350 words, never paste a key value)

Commits (short hash + subject), files, tests added, every command with pass/fail counts and which failures are baseline, the final strings, and any deviation with its reason.
