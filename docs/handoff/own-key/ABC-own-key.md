# ABC — own key on peer.homes (workaholic mode)

The manager is the only writer of this file. Plan of record: the owner's answers of 2026-10-25, summarised in §3.

## §1 Header

| field | value |
|---|---|
| HELD BY | manager session (Claude Code desktop, worktree `.claude/worktrees/objective-wu-e8d6fe`) |
| BRANCH | `own-key-on-web` (cut from `origin/main` db0f070a after PR #36 merged; name approved by the owner 2026-10-25). Repository `Aspen-Lab/peer`. No push without the owner's word (AGENTS.md). The owner merges the PR himself (R6). |
| ROUND | 1 scored (A 85.4, B 100.0); round 2 after R1-fixB |
| CURRENT ITEM | R1-fixB running; then round 2 scoring |
| NEXT TURN | on each worker report: verify → land on the branch → refill up to the cap of two groups |
| STOPPED BECAUSE | — |
| TARGET | **97.9 per theme, two consecutive rounds** (the owner, 2026-10-28, R5: "达标线用 97.9，每个主题连续两轮达到就停。") |
| CAP | **at most two subagent groups running at once** (the owner, 2026-10-28: "使用workaholic mode工作，但确保每次最多只有两个subagent group在跑"). A group = one item's A/B/C chain, or one scoring round's blind readers. |
| GATE BASELINE | untouched db0f070a in `own-key-verify` (full `npm ci`): vitest 10681 tests, **35 failed** (25 files: CRLF under `core.autocrlf=true`, Windows backslash paths, reader timing, papers page tests, spend-scans scan 5 count). List: manager scratch `verify-baseline.json`. With the main checkout's stale node_modules (no `server-only`, no `mupdf`): 69 failed + feed suites error at import. |
| CLOCK | `b37a2acb`, session cron `20 * * * *`, read back 2026-10-28 (§6) |

## §2 Rulings

- **R1 (2026-10-28).** The owner caps concurrency at two subagent groups. L1-C and L2-C were stopped before they had edited anything (both worktrees clean); they resume, context intact, when a slot frees. Order of refill: L2 (unblocks L3's mount) → L1 → scoring round 1.
- **R2 (2026-10-28).** Worker models: opus, per the owner's standing subagent-model policy (memory, 2026-08-13), which overrides the skill's smaller-model default.
- **R3 (2026-10-28).** `own-key-verify` holds the only complete `node_modules`; the branch worktree and lanes 1–2 are junctions to it. Do not remove `own-key-verify` before the loop ends.
- **R4 (2026-10-28).** Rendering for scoring uses the dev server with only the public Supabase URL and publishable key (no service-role key) and never signs in locally without the owner's explicit OK (local writes are production writes). Signed-in states are scored from route/unit evidence and static renders of the views.
- **R5 (2026-10-28).** The owner set the stop line: "达标线用 97.9，每个主题连续两轮达到就停。" Every theme at or above 97.9 in two consecutive rounds; a theme that has done so stops being scored, and a later change to its files reopens only the lines it could move.
- **R6 (2026-10-28).** The owner: "分支给我来merge就行，我也有权限" — he merges the PR to `main` himself. The manager flagged once that a merge to `main` auto-deploys peer.homes, which Addendum No. 1 §4.2 (draft) lists among the Operating Roles; the decision is the owner's. The manager still never merges.
- **R7 (2026-10-28), on L3-C's open points.** (a) A key the provider accepts but whose account has no credit (OpenAI/Qwen 429 `insufficient_…`, DeepSeek 402 "Insufficient Balance") is its own outcome `no-credit`, shown as "This key works, but the provider says its account has no credit left." — detected without the word that `no-company-model-copy.test.ts` bans in source (e.g. /insufficient_w+/i, status 402). (b) The provider's own 429 ("The provider is busy right now. Try again in a minute.") and Peer's hourly limit ("Too many checks this hour. Try again later.") get different lines. (c) Peer's own 401 (signed out mid-session) shows "Sign in to check your key." (d) A check cut off at 15 s leaves the provider request to finish; its answer is ignored — accepted. Goes to L3's fix pass together with L3-A's findings.
- **R8 (2026-10-28).** Re-aimed test, accepted: spend-scans scan 5 "reports the guarded count" now sorts the walked list before comparing; the untouched tree failed it on Windows only for directory order (`papers/report` before `papers/[id]`). Same names, same count check; 8 → 9 with `ai/check-key`.
- **R9 (2026-10-28), on L4-C's worry that keys may survive sign-out.** Checked: `shouldClearOnConfirmedSignOut` needs `syncedAccountId !== null`, and `profile-sync.tsx:912` records the owner eagerly at every confirmed sign-in, before the pull. A reader who signs out was signed in on this browser, so the id is set and `logOut()` runs: the dialog's and /privacy's "signing out removes it from this browser" hold. Residual edge, accepted: if the auth check after sign-out fails (network), the 60 s cookie waits for the next load. No change.
- **R10 (2026-10-28).** L4 mutation M3 (drop the "//" / "/\\" prefix check in `safeReturnPath`) left the tests green: an equivalent mutant, because the exact allow-list (`/welcome`, `/profile`) refuses those values anyway; the prefix check stays as defence in depth. M3b (drop the allow-list) → 4 red; M3c (callback forwards `next` unchecked) → 4 red.
- **R11 (2026-10-28).** Turbopack refuses a `node_modules` junction that points outside the project ("Symlink [project]/node_modules is invalid, it points out of the filesystem root"; the dev server exited 1 after 14 s, no orphan left). The branch worktree gets its own `npm ci`; lanes and `own-key-verify` keep their junction / install (tests and tsc are unaffected). The Browser pane twice refused `localhost:3000` while the server was down; retry once after the install, else render-check by HTTP.
- **R12 (2026-10-28), on L3-A (`L3-A-20261028T1725Z.md`, A10 2.0 + A11 0.75 = 2.75).** All seven defects are accepted for L3-fix (`briefs/L3-fix.md`): D1–D3 as R7, with the no-credit detectors widened (Anthropic "credit balance is too low", Qwen `Arrearage`) and run before the status switch; D4 the /privacy Check key paragraph rewritten to name the one log line (`LlmUsage`: provider, model, tokens, time, ok) instead of "keeps nothing"; D5 Anthropic `maxRetries: 0` for the check; D6 "Sign in to check your key." when signed out; D7 an empty 200 is `ok`, and a non-transient provider error gets its own `error` line instead of "Try again". The gate (KeyCheck mounted nowhere) closes in the same pass.
- **R13 (2026-10-28), on L4-A (`L4-A-20261028T1818Z.md`; Theme A 0.5, Theme B 0.75).** All accepted for L4-fix (`briefs/L4-fix.md`): D4 (0.5) keys could survive a sign-out after "Reset profile to defaults" while signed in — fixed twice: the reset re-records the signed-in owner, and a confirmed sign-out always clears the device's API keys even with no owner recorded; D2 singular/plural in the dialog; D1 the Account step's title after sign-in; D3 the resume step for a reader who finished everything; plus director note N1 (AI summary while auth is unknown). R9's "no change" is superseded for the reset path. Not taken: the 375 px wrap of "Continue without signing in" is unverified (no browser at A); the scoring round checks it on the dev server.
- **R14 (2026-10-28), on L2-A (`L2-A-20261028T1822Z.md`; five 0.25 defects, Theme A 1.25).** All accepted. L2-fix (`briefs/L2-fix.md`): D5 + N2 split the signed-out-with-key paper sentence; D1 the paper link shows only when the sentence names a key or a sign-in (this also changes the old no-key PDF-no-text case — ruled); D2 the paper's "Sign in" returns to the paper via `/profile?return=/papers/<id>` (contract with L4-fix item 6: `safeReturnPath` accepts `/papers/<one segment>`, Profile's Account passes a valid `return` as `returnTo`); D3 + N3 + L3-A D6 `AiKeyFields signInNote={false}` on Welcome and KeyCheck's signed-out line only after a 401; D4 the Profile key paragraph drops the account and sign-out sentences where sign-in is unconfigured.
- **R15 (2026-10-28), on L4-fix's deviations.** Accepted: item 4 (a signed-out reader can never finish the AI step, so the rule became "only a brand-new reader starts on Account; everyone else resumes where the wizard opened before"); the kicker stays "Optional"; a double-encoded id is a literal id on Peer's host. NOT accepted: refusing `%2F` in a paper id. dblp ids (`journals/corr/…`) and old arXiv ids (`hep-th/9901001`) contain "/", so those papers would not come back after sign-in. A decoded "/" inside the one segment is safe: the raw value still starts with `/papers/`, holds no literal "/" or "\\" after it, and the callback joins it to its own origin. Queued as L4-fix2: accept a decoded "/" in the segment; keep refusing a literal "/", "\\", control characters, broken escapes, "." and ".."; tests with a dblp id and an old arXiv id.
- **R16 (2026-10-28), on L1-A (`L1-A-20261028T185241Z.md`).** B8, B10, A12 PASS; B9 PASS with D1 0.25: five stale comments still describe Tavily or the `web` adapter (spend-scans scan 3 and 5, `pipeline.ts` ~1112, `jev-step.test.ts` ~114, `api/feed/route.test.ts` ~324). Accepted for L1-fix (comments only). A12's CHANGELOG entry is the manager's.
- **R17 (2026-10-28).** Rubric B3 amended to match R14/R15 (no relaxation of safety): the callback accepts only same-site `/welcome` or `/profile` (with a query) or `/papers/<one encoded id>`, for both the cookie and `next`. All three readers flagged the old wording; all three passed B3, so round 1's numbers are the same under either line.
- **R18 (2026-10-28), round 1 clusters for R1-fixB.** (1) README: the own-key changes and the wizard's Account step (A12 remainder; the CHANGELOG entry landed in 1e4a1a98, the 375 px wrap and the signed-in kicker in R1-fixA); (2) A5 the signed-out Account title "Sign in (optional)." under the kicker "Optional" says it twice → title "Sign in."; (3) A1 the Profile key paragraph reworded without "there, paste it again"; (4) A8 the dialog says "this browser" throughout (the unsynced sentence said "this device"); (5) A9 the reset line says "your API key" for one key.

## §3 Items

| item | scope (owner's word) | lane |
|---|---|---|
| B | remote profile can never set/clear device-only fields ("做") | L1 |
| F | remove Tavily ("清理") | L1 |
| C | sign-in notes beside the model key; paper page sentence for a signed-out reader with a key ("o") | L2 (+ L4 for the Welcome summary) |
| G | Profile note: the key does not follow the account ("在profile页面的ai key下面说明一下") | L2 |
| D | "Check key" button + route + privacy sentences ("做") | L3 |
| A | sign-in in the walkthrough ("加到walk through"); the Account section is already first on Profile | L4 |
| E | sign-out dialog: keys will be deleted, and why — safety ("跳出一个弹框，警告用户key会被删除，并说出原因（安全）") | L4 |

## §4 Ledger

| id | role | status | worktree | evidence |
|---|---|---|---|---|
| L1-C | C | LANDED a235c48a, fa965331, 2b6665a6 | `.claude/worktrees/own-key-lane1` | 9381d8cd hydrate ignores device-only fields, 98a92ef7 Tavily out of the profile (store v9), 6590bfe1 Tavily web source + unread searchConnectors deleted. Manager: tsc 0, eslint 0, affected tests ×3 = 1626 pass / 3 fail (reader-panes, reading-prefs, scan 5 — all baseline); M7 (hydrate installs feedAiApiKey again) → 2 red; M8 (legacy strip forgets tavilyApiKey) → 5 red; restored byte-identical. Lane's own full suite: same 35 as baseline. |
| L1-A | A | DONE | own-key-lane1 (read only) | `L1-A-20261028T185241Z.md`: B8, B10, A12 PASS; B9 D1 0.25 (stale comments) |
| L1-fix | C | LANDED 26accd41 | own-key-lane1 | comments only (diff checked: no non-comment line changed); tsc 0; 190 tests pass |
| R1-fixA | C | LANDED ac19aa7e, 38aeef1c, 25d64586 | own-key-lane4 | tsc 0; eslint 0 errors; ×3 143 pass / 1 baseline; M17 (signed-in kicker back to Optional) → 2 red; 375 px checked in the browser: "Skip sign-in →" on one line |
| R1-fixB | C | RUNNING | own-key-lane4 | `briefs/R1-fixB.md` (R18) |
| L4-fix2 | C | LANDED 4a883c0a | own-key-lane4 | a decoded "/" allowed in a paper return path; M16 (literal "/" allowed) → 4 red |
| R1-score | readers ×3 + director | DONE: A 85.4 / B 100.0 (median); director 89.58 / 97.73 | `own-key-verify` (read only) | pack: notes `R1-pack/` (static renders, live captures, 375 px screenshot, test evidence); full suite 11175 / 34 failed / 0 new |
| L2-C | C | LANDED 68163acd, f6cfe7ce, 43e2a404 | `.claude/worktrees/own-key-lane2` | aeba4d49 note under the key field, 187597a6 AI provider row, 495eeba6 paper page sign-in. Manager: tsc 0, eslint 0 errors (44 warnings, pre-existing), touched tests ×3 = 933 pass / 1 fail (jev-setup, CRLF baseline); M5 (note shown for unknown/unconfigured) → 4 red; M6 (keyNeedsSignIn always false) → 1 red (unit level; the page tests take the flag as input); restored byte-identical. Full suite: 10752 tests, 35 failed, **0 new**. |
| L2-A | A | DONE | own-key-lane2 (read only) | `L2-A-20261028T1822Z.md`: A1–A4 PASS with five 0.25 defects (D1–D5) |
| L2-fix | C | LANDED d94b0a09, e2cdf9e3, 61492242 | `.claude/worktrees/own-key-lane2` | items 1–5. Manager: tsc 0, eslint 0 errors, touched tests ×3 = 552 pass / 1 fail (jev-setup baseline); M14 (signInNote ignored) → 3 red; M15 (link back to the old rule) → 3 red; restored. Deviation accepted: the paper link encodes the id with encodeURIComponent (an id with "/" stays one segment). Noted, not taken: `JEV_SIGN_IN_NOTE` still shows on Welcome for a signed-out reader with a Jev key — scored in round 1. |
| L3-C | C | LANDED 7b68634f, 14961cb2 | `.claude/worktrees/own-key-lane3` | 06e101c8 route + privacy, 1ac28885 KeyCheck. Manager in own-key-verify: tsc 0, eslint 0 on 13 files, touched tests ×3 = 272 pass / 2 fail (both baseline: privacy standing, upload record); M1 provider resolved before the gate → 6 red; M2 key rendered in the status line → 2 red; both restored byte-identical. Full suite: 10790 tests, 34 failed, **0 new** vs baseline, 1 fixed (scan 5, R8). |
| L3-A | A | DONE | own-key-lane3 (read only) | `L3-A-20261028T1725Z.md`: A10 FAIL 2.0, A11 FAIL 0.75, B5 PASS; D1–D7; gate: KeyCheck unmounted |
| L3-fix | C | LANDED 411bf87b, 4721b099, 0b39f6f6 | `.claude/worktrees/own-key-lane3` | items 1–5 of `briefs/L3-fix.md`. Deviations accepted: /privacy "at most one log line" (fetch providers log only when the provider answers); Anthropic's check now logs like the others; provider 408 = unreachable; a confirmed sign-out replaces an earlier result line. Manager: tsc 0, eslint 0 errors (8 old warnings), affected tests ×3 = 622 pass / 3 fail (baseline); M9 (no-credit decision removed) → 8 red; M10 (Anthropic retries back on) → 1 red; M11 (mount removed) → 9 red; restored byte-identical. |
| L4-C | C | LANDED 27c1d03a, 2fc2367b, a6278be9, 395e5cfe, acbc8adf | `.claude/worktrees/own-key-lane4` | 15ec36a6 return path + open redirect, 73eff44d Account step + AI-step sign-in, 780cd45d AI summary, 1285860a sign-out dialog, 5708ad40 reset text. Manager: tsc 0, eslint 0 errors (49 warnings, pre-existing), touched tests ×3 = 334/334; M3 equivalent (R10), M3b → 4 red, M3c → 4 red, M4 (keys ignored in signOutPrompt) → 3 red; all restored byte-identical. Full suite: 10814 tests, 35 failed, **0 new** vs baseline. |
| L4-A | A | DONE | own-key-lane4 (read only) | `L4-A-20261028T1818Z.md`: A6 A7 A9 B2 B3 B4 B6 PASS; D1 0.25 (A5), D2 0.25 (A8), D3 0.25 (B1), D4 0.5 (B7); no open redirect in 50+ attempts |
| L4-fix | C | LANDED 55f67927, b1f54cd4, 9d6113a4, c2b5d969, 87a4d5f2, 62b442ed | `.claude/worktrees/own-key-lane4` | items 1–6. Manager: tsc 0, eslint 0 errors (49 old warnings), touched tests ×3 = 564/564; M12 (sign-out never clears keys) → 4 red; M13 (reset does not re-record the owner) → 3 red; restored byte-identical. |
| L1-A … L4-A | A | QUEUED | — | — |

## §4b Director notes for round 1 (manager, from the static render pack, before any reader)

- Render script: manager scratch `render/round.render.test.tsx` (copied into `own-key-verify/web/src/__render__/`, run, deleted); output `render/out/renders.md`. Static renders cannot show hook-read auth states (zustand serves its initial `unknown` on the server), so signed-out key-field states are captured from the live dev server instead.
- N1 (A7): Welcome AI summary says "Gemini key saved — sign in to use it" while the sign-in check is still `unknown`; a signed-in reader can see it for a moment. Candidate 0.25.
- N2 (A4): "… need the full text and you to sign in." reads awkwardly. Candidate 0.25.
- N3 (A2/A6/A10): a signed-out reader on the Welcome AI step meets three sign-in lines in one block ("Sign in to use your key", "Peer uses your key only while you are signed in.", "Sign in to check your key."). Candidate 0.25.

## §4c Round 1 — director's score at 4a883c0a (written before reading any reader)

- Theme A (12): A5 "Continue without signing in" wraps "in" onto a second line at 375 px (screenshot in `R1-pack/`) 0.25; A5 the signed-in Account step keeps the kicker "Optional" above "You are signed in." 0.25; A6 a signed-out reader with a saved Jev key also sees `JEV_SIGN_IN_NOTE` on the AI step, a third sign-in line 0.25; A12 no CHANGELOG entry at the round commit 0.5 (written since, 1e4a1a98). Σ 1.25 → 100 × 10.75 / 12 = **89.58**.
- Theme B (11): B9 five stale comments (L1-A D1) 0.25. Σ 0.25 → 100 × 10.75 / 11 = **97.73**.
- A2 on Welcome: the note is hidden there by ruling R14 (the block above replaces it); not costed by the director. If a reader costs it, it is ruled under R14 and both numbers are reported.

## §4d Round 1 — readers

- Reader 1 (`R1-reader-1-20261028T190004Z.md`): **A 85.4** (A12 1.0 no CHANGELOG entry — also a narrow breach of pass requirement 2 through the /privacy footer "ship in the changelog"; A1 0.25 "…: there, paste it again."; A5 0.25 375 px wrap; A8 0.25 "this browser" then "this device" in the both-dialog), **B 100.0**. Flag: B3's rubric line says only /welcome or /profile; the code (R14/R15) also accepts `/papers/<id>`.
- Reader 3 (`R1-reader-3-20261028T1900Z.md`): **A 85.4** (A12 1.0; A5 0.25 "OPTIONAL" kicker over "Sign in (optional)." says it twice, and "Optional" over "You are signed in."; A5 0.25 375 px wrap; A9 0.25 the reset line says "your API keys" for a single key), **B 100.0**. Same B3 flag. A2 scored on the live capture.
- Reader 2 (`R1-reader-2-20261028T190043Z.md`): **A 85.4** (A12 1.0 — CHANGELOG and also README: nothing on Check key, the sign-out dialog, needing to sign in to use a key, Tavily removed, and the README's wizard order lacks Account; A5 0.25 Optional twice; A5 0.25 375 px wrap; A1 0.25 borderline "there, paste it again"), **B 100.0**. Pass requirement 2 on the letter (same as reader 1), costed once under A12.
- **Score of record, round 1 (median of three readers): Theme A 85.4, Theme B 100.0.** Director: A 89.58, B 97.73. Theme B: first round at or above 97.9. Theme A: below.

## §5 Log

- 2026-10-28 | db0f070a | manager | branch cut; four lane worktrees; baselines run; four Cs spawned.
- 2026-10-28 | db0f070a | manager | workaholic mode on; cap two groups (R1); L1-C, L2-C paused clean; state file and rubric written.
- 2026-10-28 | f958bdb0 | manager | owner set target 97.9 ×2 per theme (R5).
- 2026-10-28 | cb6e0dd0 | manager | L3-C reported; L2-C resumed into the freed slot; L3 verified in own-key-verify (tsc, eslint, ×3, two mutations); rulings R7, R8.
- 2026-10-28 | 14961cb2 | manager | L3 full suite 0 new failures; L3 landed (cherry-pick 06e101c8→7b68634f, 1ac28885→14961cb2). L3-A waits for a slot.
- 2026-10-28 | 14961cb2 | manager | L4-C reported (5 commits); L1-C resumed into the freed slot; L4 verified (tsc, eslint, ×3, four mutations); rulings R9, R10.
- 2026-10-28 | acbc8adf | manager | L4 full suite 0 new failures; L4 landed (5 cherry-picks).
- 2026-10-28 | acbc8adf | manager | L2-C reported (3 commits); L3-A started in the freed slot; L2 verified (tsc, eslint, ×3, two mutations).
- 2026-10-28 | 43e2a404 | manager | L2 full suite 0 new; L2 landed (3 cherry-picks, clean). Combined tip tsc 0; full suite started.
- 2026-10-28 | 43e2a404 | manager | combined tip (L2+L3+L4) full suite: 10994 tests, 34 failed, **0 new**, 1 fixed (scan 5).
- 2026-10-28 | 43e2a404 | manager | dev server needs a real node_modules (R11); branch worktree npm ci; /welcome Account + AI steps and /privacy render on localhost:3000, no console errors. L3-A reported 2.75; R12; L3-fix started in the freed slot.
- 2026-10-28 | b92851a7 | manager | L1-C reported (3 commits); L4-A started in the freed slot; L1 verified (tsc, eslint, ×3, two mutations); L1 landed by cherry-pick; combined full suite started.
- 2026-10-28 | 2b6665a6 | manager | tip with L1–L4: tsc 0; full suite 11002 tests, 34 failed, **0 new**, 1 fixed (scan 5).
- 2026-10-28 | 0b39f6f6 | manager | L3-fix reported; L2-A started in the freed slot; L3-fix verified (three mutations) and landed; tip full suite started.
- 2026-10-28 | 0b39f6f6 | manager | tip full suite after L3-fix: tsc 0; 11055 tests, 34 failed, **0 new**, 1 fixed (scan 5).
- 2026-10-28 | 982254b9 | manager | render pack for round 1 built (director notes N1–N3). L4-A reported (A 0.5, B 0.75); R13; L4-fix started in the freed slot.
- 2026-10-28 | be28d8f0 | manager | L2-A reported (1.25); R14; item 6 sent to L4-fix; L2-fix started in the freed slot.
- 2026-10-28 | 62b442ed | manager | L4-fix reported (6 commits); L1-A started in the freed slot; L4-fix verified (two mutations) and landed; R15; tip full suite started.
- 2026-10-28 | 62b442ed | manager | tip +L4-fix full suite: 11133 tests, 34 failed, **0 new**. L2-fix reported; L4-fix2 started in the freed slot; L2-fix verified (two mutations) and landed (61492242); tip full suite started.
- 2026-10-28 | 61492242 | manager | tip +L2-fix full suite: tsc 0; 11168 tests, 34 failed, **0 new**. Reader brief `briefs/R1-reader.md` written.
- 2026-10-28 | 84dbc1c6 | manager | L4-fix2 landed (4a883c0a); round-1 pack built; readers ×3 started; L1-A reported (R16); L1-fix started; CHANGELOG entry 1e4a1a98; director's score A 89.58 / B 97.73 (§4c).
- 2026-10-28 | 2eae0788 | manager | round 1 scored A 85.4 / B 100.0; R17, R18; R1-fixA landed; R1-fixB started. Tip full suite: tsc 0; 11180 tests, 34 failed, **0 new**. R1-fixB's C stopped on the usage limit ("resets 4:20pm") before editing anything; resumed by message at 16:41 CDT after three clock ticks.

## §6 Clock

Session cron (CronCreate) `20 * * * *`, session-only, auto-expires after 7 days (2026-11-04). **Read back 2026-10-28: id `b37a2acb`, recurring, "Every hour at :20", next run 12:41 local.** Desktop scheduled tasks: none (listed). Dies if this Claude session exits; re-arm on resume if CronList is empty.

## §7 Resume section

1. Read §1, §2 and the newest §4 rows.
2. Check which workers are still running (agent notifications; `git -C <lane worktree> log db0f070a..HEAD` and `status`).
3. For a finished C: verify in `own-key-verify` (checkout the lane commit detached; tsc, eslint on changed files, the touched tests 3×, one manager mutation per rule, then the full suite compared with the baseline), then cherry-pick onto `own-key-on-web`.
4. Refill up to two groups in R1's order.
5. After all four lanes land: mount `KeyCheck` in `AiKeyFields`, write one CHANGELOG entry, run scoring round 1 (RUBRIC.md).
6. Never push, merge or sign in locally without the owner's word.
