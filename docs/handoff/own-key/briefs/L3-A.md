# Brief L3-A — review lane 3 ("Check key")

Role: **A, the reviewer.** You read, run and judge. You never edit code, never commit, never branch, never push.

## What to review

- Worktree (read and run here only): `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane3` — detached HEAD; lane 3's two commits sit on top of `db0f070a`: `git log --oneline db0f070a..HEAD`, `git diff db0f070a..HEAD`. `web/node_modules` is a complete install. If the harness blocks you from that path, enter it with EnterWorktree(path); write nothing anywhere except your report file below.
- What lane 3 was asked to build: a "Check key" button under the model-key field, a route `POST /api/ai/check-key`, a smaller Gemini key-check prompt, two new sentences on /privacy under "Your own model key", and their tests.

## Product rules the work must obey (from the owners' agreement and the repo)

- A reader's model key stays in the browser, travels to Peer's server only inside the request it serves, and is never stored on a server, written to a log, or synced to the account.
- Every model-reaching route calls `requireAiRequest` before any provider is resolved.
- /privacy is "written from the code": every sentence must be true of the code, and a change to what is sent or kept changes the page in the same commit.
- No price, paid tier, trial, upgrade, waitlist, donation or sponsorship wording; no "founder"; no "BYOK" / "Tier N" in rendered text; `lib/feed/no-company-model-copy.test.ts` bans words like "quota" and "allowance" in any non-comment source line.
- No new dependency; tests must not be weakened.

## What to do

1. Read the diff in full.
2. Judge each of these, PASS or FAIL with evidence (file:line, a test you ran, or a static render you produced with a throwaway script outside the repo):
   - **A10** the button label, the billing note (no number), every result line the reader can see: are they true, plain, and right for each real situation (a wrong key, a valid key, a provider outage, Peer's own hourly limit, a provider rate limit, an account with no credit, a signed-out reader, a slow provider)?
   - **A11** the two new /privacy sentences and the date: true of the code? anything the code keeps or logs during a check that the page does not say (follow `testConnection` into each provider and the logging helpers)?
   - **B5** disabled rules; 401 for a stranger before any provider is built; the outcome mapping; the provider's error text never reaching the response or a log; the 10-per-hour limit; `Cache-Control: no-store`.
   - Anything else that would mislead or break a reader, or weaken a guard.
3. Run, from `web/`: `npx vitest run src/app/api/ai/check-key src/lib/llm/key-check.test.ts src/components/profile/key-check.test.tsx src/app/privacy src/lib/security/spend-scans.test.ts src/app/api/ai-route-personas.test.ts`. Known failures on the untouched tree, not lane 3's: `privacy/page.standing.test.tsx` (Windows backslash path) and `privacy/page.test.tsx` "a saved upload's record … names the fields".
4. Cost each defect: 1.0 unusable, 0.5 misleading, 0.25 cosmetic. Give the arithmetic per unit.

## Report

Write `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\L3-A-<UTC timestamp>.md` with: PASS/FAIL per unit with evidence, every defect with its cost and the smallest fix you would suggest, and anything you could not check. Return one paragraph (under 250 words) naming the file and the defects. Never paste a key value.
