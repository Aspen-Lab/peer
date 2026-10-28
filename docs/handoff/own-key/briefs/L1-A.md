# Brief L1-A — review lane 1 (device-only fields stay device-only; Tavily removed)

Role: **A, the reviewer.** You read, run and judge. You never edit code, never commit, never branch, never push.

## What to review

- Worktree (read and run here only): `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane1` — detached HEAD; lane 1's three commits sit on top of `db0f070a`: `git log --oneline db0f070a..HEAD`, `git diff db0f070a..HEAD`. `web/node_modules` is a complete install. If the harness blocks you from that path, enter it with EnterWorktree(path); write nothing anywhere except your report file below.
- What lane 1 was asked to do:
  1. A profile pulled from the account (`hydrateFromRemote` in `web/src/store/profile.ts`) can never set or clear the model provider, the model key, the Jev key or the (old) Tavily fields — they are device-only, and the server never stores them.
  2. Remove Tavily (a web-search provider no screen offered any more) from the profile type, the store (persist version 8 → 9 so old saved blobs are migrated), the sync payload, backups, the feed route and the sources — while old saved values and old backup files that still carry `tavilyApiKey` are stripped by name, and the build guard still bans `TAVILY_API_KEY` on Vercel.

## Rules the work must obey

- A reader's keys stay in the browser: never sent to the account, never in a backup file, never logged.
- The privacy page (`web/src/app/privacy/page.tsx`) must stay true; the line quoting `void feedAiApiKey` must survive.
- The build guard (`web/scripts/assert-byok-production-env.mjs`) and the spend scans must not be weakened. No new dependency; tests not weakened (lane 1 changed the store's version pin in three tests and rewrote several Tavily tests: say whether each change is honest).
- No behaviour a reader relies on may change: Tier 0 (no key) briefings, the Sources choices on Profile (Balanced / Preprints / Published / Code), the feed for a signed-out reader.

## What to do

1. Read the diff in full.
2. Judge, PASS or FAIL with evidence (file:line, a test you ran, or a throwaway script outside the repo):
   - **B8** a remote profile can neither set nor clear the model provider, the model key or the Jev key.
   - **B9** Tavily gone from profile, store, sync, sources and feed route; a v8 blob, a v7 blob and an old backup file carrying `tavilyApiKey` come out without it; the build guard still bans `TAVILY_API_KEY`.
   - **B10** Tier 0 unchanged: the pipeline now filters source ids without an adapter (`isRegisteredSource`) — can that drop or change anything a reader gets (a saved profile with `feedSourceMix: "web"`, the feed's source-status metadata the page may show)? Follow it through `web/src/app/api/feed/route.ts` and `web/src/lib/feed/pipeline.ts`.
   - **A12** README says what changed in plain words.
   - Stale comments or tests that still describe Tavily as present (lane 1 says `spend-scans.test.ts` scan 3's and scan 5's comments still name `web-search.ts`).
   - Anything else that would lose a reader's data on upgrade (the v9 migration runs once on every existing browser: check it keeps every other field).
3. Run, from `web/`: `npx vitest run src/store src/lib/profile src/components/profile-sync.test.tsx src/lib/sources src/lib/feed src/app/api/feed src/lib/opportunities src/lib/no-opportunity-sources.test.ts src/test-support src/scripts src/lib/security/spend-scans.test.ts`. Known failures on the untouched tree, not lane 1's: `store/reader-panes.test.ts`, `store/reading-prefs.test.ts` (one each), `spend-scans` scan 5 "reports the guarded count" (Windows directory order; fixed on the branch by lane 3).
4. Cost each defect: 1.0 unusable, 0.5 misleading, 0.25 cosmetic, with the arithmetic per unit.

## Report

Write `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\L1-A-<UTC timestamp>.md` with PASS/FAIL per unit and evidence, every defect with its cost and the smallest fix you would suggest, and anything you could not check. Return one paragraph (under 250 words) naming the file and the defects.
