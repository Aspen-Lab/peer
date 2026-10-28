# Brief L2-A — review lane 2 (what the reader is told beside the model key, and on a paper)

Role: **A, the reviewer.** You read, run and judge. You never edit code, never commit, never branch, never push.

## What to review

- Worktree (read and run here only): `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane2` — detached HEAD; lane 2's three commits sit on top of `db0f070a`: `git log --oneline db0f070a..HEAD`, `git diff db0f070a..HEAD`. `web/node_modules` is a complete install. If the harness blocks you from that path, enter it with EnterWorktree(path); write nothing anywhere except your report file below.
- What lane 2 was asked to build:
  1. Under the model-key field (Profile "AI provider" row and the Welcome wizard's "AI" step), for a confirmed signed-out reader with a company chosen: "Peer uses your key only while you are signed in."
  2. On Profile, for that reader, a line pointing to the Account section at the top of the page; and, always, a plain statement that the key stays in this browser, does not follow the account to another device or browser (because Peer never stores keys on its server), must be pasted again there, and is removed on sign-out.
  3. On a paper page, a reader who has a key but is signed out was told the blocks "need a key"; now they are told the blocks need them to sign in, and the "Add a key" link becomes "Sign in" (to `/profile`). Every other state must read word for word as before.

## Rules the work must obey

- Every sentence must be true of the code: when a model runs (`aiAvailability` in `web/src/lib/feed/ai-tier.ts`), where the key lives (`web/src/store/profile.ts`, `remoteProfilePayload` in `web/src/components/profile-sync.tsx`), what sign-out does (`processConfirmedSignOutCookie`, `logOut`).
- Plain words, the app's own nouns ("Account", "AI provider", "Profile"); no price, paid tier, trial, upgrade, waitlist, donation or sponsorship wording; no "founder"; no "BYOK" / "Tier N" in rendered text. No new dependency; tests not weakened.

## What to do

1. Read the diff in full.
2. Judge, PASS or FAIL with evidence (file:line, a test you ran, or a static render you produced with a throwaway script outside the repo):
   - **A1** the Profile paragraph about where the key lives — true, plain, said once (does it repeat the paragraph above it?).
   - **A2** the note under the key field — exactly when signed out and the field is visible; never while the sign-in check is unanswered; never where sign-in is not configured.
   - **A3** the Profile line pointing to Account.
   - **A4** the paper sentence and link for every state (no key; key + signed in; key + signed out; key + unknown; full text read or not; a PDF with no text) — is anything wrong, missing or misleading? Is `/profile` the right destination, given the Welcome wizard's "AI" step (`/welcome?step=ai`) now also offers sign-in buttons that come back to the step?
   - How the note reads on the Welcome "AI" step next to the "Sign in to use your key" block another lane added (read `web/src/app/welcome/page.tsx` on the branch worktree `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\objective-wu-e8d6fe` if you want to see it; do not run anything there).
   - Anything else that would mislead a reader.
3. Run, from `web/` in the lane 2 worktree: `npx vitest run src/components/profile src/app/profile src/lib/papers/reading src/components/reader/decision-block src/lib/feed/ai-tier src/app/papers/[id]/page.sign-in.test.ts src/lib/navigation src/lib/feed/ui-vocabulary.test.ts src/lib/feed/no-company-model-copy.test.ts`. Known failure on the untouched tree, not lane 2's: `jev-setup.test.tsx` "JevScreeningStatus is mounted …" (Windows line endings).
4. Cost each defect: 1.0 unusable, 0.5 misleading, 0.25 cosmetic, with the arithmetic per unit.

## Report

Write `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\L2-A-<UTC timestamp>.md` with PASS/FAIL per unit and evidence, every defect with its cost and the smallest fix you would suggest, and anything you could not check. Return one paragraph (under 250 words) naming the file and the defects.
