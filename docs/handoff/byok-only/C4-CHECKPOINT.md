# C4 checkpoint: A's findings landed

Branch `remove-paid-tier-restore-byok`, from A's review `90c39027`. Every commit below is pushed. Nothing here made a real model call,
a real Jev call or a real network call, touched reader data, or printed, logged or committed a key value: every key in a test, a
mutation and a guard run is an invented sentinel, and no key-shaped string appears in this file. `npm run build` was **not** run
(the worktree's `web/node_modules` is a symlink and Turbopack will not build through it); the Vercel preview is the build gate and
stays red by design until the owner removes `GOOGLE_API_KEY` (and now anything else the guard names, see the checklist delta).

A's verdict was NOT READY on one BLOCKING finding (B-1, a test gap, no live leak), five SHOULD-FIX and eighteen NOTEs. This round
lands B-1, SF-1 to SF-5, N1, N4, N8(b)(d)(e), N9, N10, N11 and N18, and records the manager's rulings on the rest (below).

## The commits

| # | Hash | Message | Finding |
|---|---|---|---|
| K1 | `6c5657a7` | test: watch every console method for the Jev key (B-1) | B-1 |
| K2 | `6d6e58ff` | copy: say what Jev does with a paper it cannot judge (SF-1) | SF-1 |
| K3 | `324d6526` | fix: APP_VERSION is 0.45.0, and a test keeps it equal to the changelog (SF-2) | SF-2 |
| K4 | `648bd717` | fix: a reader's Gemini key is held by nothing after its request (SF-3) | SF-3 |
| K5 | `b1a8de0a` | copy: tell a signed-out reader a saved Jev key is not used yet (SF-4) | SF-4 |
| K6 | `3fdd3b9a` | fix: no company credential is read for the jobs sources, and the guard says so (SF-5, N9, N10) | SF-5, N9, N10 |
| K7 | `0d288a1b` | feat(feed): stop re-sending a Jev key Jev has rejected (N1) | N1 |
| K8 | `80794848` | fix(jev): a key must be printable ASCII, so a bad paste is caught in the browser (N8e) | N8(e) |
| K9 | `38c5cc59` | copy: the small corrections from the branch review (N4, N8b, N8d, N11, N18) | N4, N8(b), N8(d), N11, N18 |
| - | (this commit) | docs(handoff): C4 checkpoint — A's findings landed | |

## Gate numbers

Baseline, re-run by me at `90c39027` before touching anything (it equals A's number at `918e6103`): `tsc` 0; lint 0 errors /
**151** warnings; `TZ=America/Chicago npm test` **5529 passed, 8 skipped** (281 files + 3 skipped).

| After | tsc | lint (errors / warnings) | tests |
|---|---|---|---|
| K1 | 0 | 0 / 151 | full: **5547 passed, 8 skipped** (282 files + 3 skipped) |
| K2 | 0 | 0 / 151 | touched (components/profile, lib/decisions, app/welcome, app/privacy, app/profile, ui-vocabulary): 20 files, 408 passed |
| K3 | 0 | 0 / 151 | `version.test.ts` 3 passed |
| K4 | 0 | 0 / 151 | touched (lib/llm, app/privacy, lib/security): 9 files, 122 passed |
| K5 | 0 | 0 / 151 | touched (components, app/profile, app/welcome, ui-vocabulary): 26 files, 312 passed |
| K6 | 0 | 0 / 151 | full: **5620 passed, 8 skipped** (285 files + 3 skipped) |
| K7 | 0 | 0 / 151 | touched (store, components, app/profile, app/welcome): 34 files, 568 passed |
| K8 | 0 | 0 / 151 | touched (lib/decisions, components, app, store, lib/evaluation): 89 files + 2 skipped, 1444 passed + 2 skipped |
| K9 | 0 | 0 / 151 | full: **5651 passed, 8 skipped** (285 files + 3 skipped) |

Test count **5529 -> 5651 (+122)**, skipped unchanged at 8. Lint never moved from 151 warnings. The full suite was required after K1, K6
and K9 and was run then; the other commits ran the touched suites. Cases added per commit (counted from the diffs; their sum is
exactly the difference between the measured full runs): K1 +18, K2 +1, K3 +3, K4 +7, K5 +13, K6 +49, K7 +10, K8 +15, K9 +6. No test
was deleted except scan 3's old "accepted" case (replaced by a stricter one: zero, not three), and no surviving assertion was weakened: where a pinned line changed (SF-1's sentence, the key-shape hint, the two privacy
sentences) the replacement pins the new text in full.

Tests first, honestly: the new run-time and structural cases that pin *new* behaviour were run red before the code (K3, K4, K5, K6, K7,
K8 and the copy lines of K2 and K9). The cases that pin *existing* behaviour (K1's scan on the real tree, K2's `apply` case, K9's
exact-blend case) are green on arrival by design; their evidence that they bite is the mutation column.

## What each finding became

| Finding | What landed |
|---|---|
| **B-1** | `web/src/test-support/console-capture.ts` (`captureConsole()`): spies `log`, `info`, `debug`, `warn` and `error`, renders objects, arrays and errors in depth (not "[object Object]"), records in call order, restores (safe twice, and after `vi.restoreAllMocks()`), and `text()` still answers after restore. Used in the five sentinel tests (`route.jev`, `screen`, `pipeline.jev`, `jev-direct-client`, `jev-client`). Plus **scan 9** in `spend-scans.test.ts`: no `console.<method>(...)` call under `lib/decisions/` or `app/api/feed/` names `api[_-]?key` (case-insensitive, so `apiKey`, `jevApiKey`, `API_KEY` all count; comments stripped; balanced parentheses, so a multi-line or nested call is read whole), and no use of `console` as a value (an alias would walk round the scan). The scanner is tested on planted sources so it cannot go blind. |
| **SF-1** | Code unchanged (an unjudged paper still contributes the neutral midpoint). The sentence is now "A paper Jev cannot judge counts as neutral: Jev neither lifts nor lowers it, though papers Jev rates well can move ahead of it." in `jev-setup.tsx` (`WHAT_A_KEY_ADDS`, so Profile and Welcome), `CHANGELOG.md` v0.45.0, the `apply.ts` header and the pinned test line; the stale line in `apply.test.ts`'s header comment was corrected too. One new `apply.test.ts` case pins it on six papers (arithmetic in the test): an unjudged paper ends behind a well-rated paper that was locally below it, ahead of weakly rated ones, and ahead of a demoted one that was locally above it. |
| **SF-2** | `APP_VERSION` is `"0.45.0"`. `lib/version.test.ts`: the first `## vX.Y.Z` heading of `public/CHANGELOG.md` equals `APP_VERSION` (matcher pinned on planted text). |
| **SF-3** | `apiClients` deleted from `gemini.ts`; `getApiKeyClient` returns `new GoogleGenAI({ apiKey })`. The /privacy sentence is unchanged and now literally true. New file `gemini.key-handling.test.ts` (a separate file, so `gemini.test.ts` is untouched): the SDK stand-in records constructor options; each call builds a client with exactly the key it was given, two calls build two, two providers with the same key do not share one, an empty key builds none; plus a source scan that `gemini.ts` holds no module-level `Map`/`WeakMap`/`Set` used with a key-named argument and no `[apiKey]` index (matcher tested on planted sources). The remaining module-level `clients` map is the Vertex client keyed by *location*, local development only. No sibling provider has such a map (checked). |
| **SF-4** | `JevSetup` now reads `useSyncGate((s) => s.authOutcome)`. For `signed-out` with a usable key saved it shows one line, "Sign in to use it: Jev screens only for a signed-in reader." Nothing for `signed-in`, `unconfigured` or `unknown`, nor with no key. No "Tier N", no "BYOK". Both states are tested as rendered output: see "Choices" for the container/view split. |
| **SF-5, N9** | The `\|\| process.env.X` half is gone from `jsearch.ts`, `adzuna.ts`, `usajobs.ts` (the `USAJOBS_USER_AGENT` half too); a missing credential means `enabled()` is false and `fetch()` returns `[]` with no call and no throw. Tests per adapter (a new `usajobs.test.ts`, cases added to `adzuna.test.ts` and `jsearch.test.ts`): disabled and silent with the company names set in the environment, both halves needed, the request's own credentials are what reaches the wire. Scan 3's "accepted" case now says zero: no production file reads any of `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `USAJOBS_API_KEY`, `USAJOBS_USER_AGENT`, `RAPIDAPI_KEY`, and the three adapters still exist and read `query.apiKeys` (so a rename cannot make it vacuous). Guard: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `USAJOBS_API_KEY` and `GEMINI_API_KEY` joined `FORBIDDEN_ON_VERCEL`, each with a comment line, plus one explanatory output line for the job-source names. |
| **N10** | The guard now requires the browser-side Supabase key. See "Choices": it is a one-of pair, in a new constant. |
| **N1** | `paperFeedRequestBody` omits `jevApiKey` while `useJevScreeningStore.getState().report?.status === "rejected"`. `updateJevApiKey` already clears the report when the key changes, so editing the key (or removing it and putting it back) sends the key again. Tests: a rejected report suppresses the field and changes nothing else in the request; every other status (and no report) still sends; a changed key sends again through the real store action; remove-and-re-add sends again; signed-out still sends nothing. **This bounds the per-load rebuild A section 3.3 costed**: a pool whose key Jev refused is not cached, so a wrong key used to rebuild the pool on every load, and for a reader with a model key as well, re-run the model rerank on their own account every load. Now it costs one rebuild: the next load carries no key, the server builds and caches the keyless pool once, and loads after that are cache hits. |
| **N8(e)** | `parseJevApiKey` accepts only printable ASCII (0x21 to 0x7E) after trimming. I checked the premise offline: the platform `Headers` refuses a non-Latin-1 value with a `TypeError`, and `callJev`'s `catch` maps any throw from `fetch` to `network_error`, so such a paste really did become "Jev did not answer" for a day. Tests: every printable character accepted; smart quotes, a zero-width space inside and at the end (which neither `trim()` nor `\s` catches), a Latin-1 letter, Greek, CJK, an emoji, a full-width digit and an en dash refused. The field's line now reads "That does not look like a key. It must be one string of letters, digits and punctuation, with no spaces or line breaks." so it is true of a paste with no space in it; the shared-rule comment is rewritten. |
| **N4** | The `pipeline.ts` comment now says "at most the calls already in flight, up to four" (and that the browser stops re-sending a refused key). |
| **N8(d)** | A comment above `WHAT_A_KEY_ADDS` cites `docs/jev-abc/P3-B-20260924T0525Z.md` lines 48 and 88 (I read both lines: they are the vendor's models page as fetched 2026-09-24). The sentence is unchanged. A test checks the citation: the note exists and says "English primary" on line 48 and "English is primary/best-accuracy" on line 88. |
| **N8(b)** | Landed, as two clauses inside the existing two sentences (no new sentence): Jev receives the project, challenge, topics, methods and exclusions "and the word meanings you selected"; Peer keeps "the paper's id, the question, the answer, how sure Jev was, which Jev model answered, and how many tokens and how much time the call took". Each is checked against the code in the privacy test (the `senses` field of the wire state, the fields of the stored payload). See "Premises" for why the second clause is longer than the brief's. |
| **N11** | `welcome/page.tsx`: "and remains limited by Peer's daily search schedule" removed; it now reads "Tavily web scouting uses its own separate search key." (a Tavily key field is on that step, so that part is true); a test keeps "search schedule" out. `README.md`: `GOOGLE_API_KEY` removed from the local-development provider list; the Jev paragraph says the key is kept in the browser and never synced, travels in the paper request body only, and is never stored or logged by the server. `RAPIDAPI_KEY` went in K6, not K9 (see "Premises"). |
| **N18** | One `apply.test.ts` case pins 0.5 / 0.5 by value: both constants equal 0.5, and on three papers answered at one `project_help` level a one-level difference in Jev's answer does not move a paper past a locally better one while a two-level difference does. A weight change now fails the unit test. |
| **N17** | No code change. **Correction to C3's checkpoint** (its premise 6 and "Local development" note said a self-hosted runtime without Supabase keeps its model key and loses only Jev): a self-hosted `next start` with no Supabase gets **503 on every AI route**, the feed POST included, exactly as on `main` (`requireAiRequest` answers 503 through `deployedRuntimeNeedsAuth()` before it looks at a key). Also from A section 3.4: the local Jev branch is reachable in `next dev` with Supabase configured, not only without it; safe, a developer's own machine. |

## Mutations (each applied to a clean tree, run, then edited back; sha256 identical before and after)

| Commit | Mutation | Result | sha256 of the file restored |
|---|---|---|---|
| K1 | **A's C4 exactly**: `console.info(options.apiKey);` inserted before `logAttempt(result, latencyMs);` in `screen.ts`, full suite | **RED**: 3 failed / 5544 passed (5555) in 3 files: `route.jev.test.ts` (the no-log-line case), `screen.test.ts` (the key-never-leaves case), `spend-scans.test.ts` (scan 9). On the unfixed tree the same mutation left the suite green. | `src/lib/decisions/screen.ts` `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` (equal to A's) |
| K1 | the same with `console.debug` (asked for once) | RED, the same 3 cases | same hash |
| K1 | extra: `const copied = options.apiKey; console.debug(copied);` | RED in 2 files (`route.jev`, `screen.test`); scan 9 cannot see it (the call names no key) and says so; the run-time layer alone holds | same hash |
| K2 | `apply.ts`: an unjudged paper counts as the best (`: 1`) | RED: 3 failed in `apply.test.ts` (the new case and two existing) | `src/lib/decisions/apply.ts` `3958013f8a0ea9e6b9fe2944bf98a1d41b6a04191878edb47f257e05d5bba0d0` |
| K2 | the same, as the worst (`: 0`) | RED: the same 3 | same hash |
| K3 | `CHANGELOG.md` top heading `v0.45.0` -> `v0.46.0` (the drift the test exists for) | RED: 1 failed in `version.test.ts` | `public/CHANGELOG.md` `d33d323799d7d6eb7fe498b87f9fe02c86dd16ea89241e40cc85b5b2ff2849eb` |
| K4 | `gemini.ts`: the keyed `apiClients` map and its get/set put back | RED: 4 failed in `gemini.key-handling.test.ts` (3 behaviour cases and the source scan) | `src/lib/llm/providers/gemini.ts` `5f6a4f3fe361e40314acffa626028fa697f69836943d5eb6457e372593f9b77b` (before K4: `675ea628...b8e`) |
| K5 | `jevSignInNote`: `=== "signed-out"` -> `!== "signed-in"` | RED: 3 failed in `jev-setup.test.tsx` (unconfigured, unknown, and the rendered "still checking" case) | `src/components/profile/jev-setup.tsx` `675bf160e06d17d4300af6177a188c33fba18f4dbfbdbcf3a6446aae7e8faba4` |
| K6 | `jsearch.ts`: `\|\| process.env.JSEARCH_API_KEY` revived | RED: 3 failed (`jsearch.test.ts`, and scan 3 twice: the per-name case and the empty accepted list) | `src/lib/jobs/sources/jsearch.ts` `520983b2abd3d143c521136e7616543400de91f3752d00910a56818c2d4cff82` |
| K6 | the guard without `JSEARCH_API_KEY` in `FORBIDDEN_ON_VERCEL` | RED: 4 failed in the guard test (the list pin, the name case, the all-armed case, the job-source line) | `scripts/assert-byok-production-env.mjs` `56a5faac2095a11b6a5f42e0b4b84238d3de10c88de582dcb84d52089525e70a` |
| K6 | the guard without the required publishable/anon pair | RED: 5 failed in the guard test | same hash as the row above |
| K7 | `store/feed.ts`: suppress on `unavailable` instead of `rejected` | RED: 5 failed in `feed-request-body.test.ts` | `src/store/feed.ts` `97511b90e8b04b0b8550c111e311df849d01d4d291703c32a191e9166bab1082` |
| K8 | `jev-key.ts`: the old rule "anything but whitespace and controls" put back | RED: 11 failed (`jev-key.test.ts`, and the field-hint case in `jev-setup.test.tsx`) | `src/lib/decisions/jev-key.ts` `6214298014198cf8dc7da97d191f631844c8973a69b7554c787b92d4a23aed47` |
| K9 | `apply.ts`: `JEV_LOCAL_WEIGHT` 0.5 -> 0.6 | RED: 1 failed (the exact-blend case, in `apply.test.ts` itself; this is A's C19 gap) | `apply.ts` `3958013f...0d0` (unchanged since K2) |
| K9 | `apply.ts`: the formula hard-coded as `0.8 * localRank + 0.2 * jev` (the constants still read 0.5) | RED: 3 failed in `apply.test.ts` (the exact-blend case and two others): the behavioural half bites on its own | same hash |

Every mutation was edited back (a reverse replacement; no `git checkout`, `git restore` or `git reset` was used) and `git status` was
clean of the mutated file afterwards. No mutation used a real key or added an outbound call.

## The build guard, by hand (`VERCEL=1 node scripts/assert-byok-production-env.mjs`, K6)

Run from an empty environment (`env -i`, only `PATH`), with invented dummy values; the output was searched for the sentinel after
each run (**0 occurrences in every run**) and only names appeared.

| Run | Exit | Names in the output |
|---|---|---|
| the two original required names + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 0, silent | none |
| the two original required names + `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead (older spelling) | 0, silent | none |
| the two original required names, no publishable/anon key | 1 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)` |
| the same with a blank publishable key | 1 | the same |
| each of `GEMINI_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `USAJOBS_API_KEY` alone (pair satisfied) | 1 each | that name only |
| `USAJOBS_USER_AGENT` alone (an address, not a credential) | 0 | none |
| `GEMINI_API_KEY`, `ADZUNA_APP_ID`, `JSEARCH_API_KEY` set but blank | 0 | none |
| no `VERCEL`, all five armed, nothing required | 0 | none |
| all five armed at once | 1 | the five names, plus "Job-source keys are the reader's too: ..." |

The guard tests were extended the same way (names only; every forbidden name alone, blank, and all armed at once, each named exactly
once; the pair; a blank key not counting).

## Premises of the brief that were false or incomplete in the code (the owner's substance was built anyway)

1. **K6(c): "the publishable/anon Supabase name" is two names.** `hasSupabaseAuthConfig()` (in `ai-request.ts` and in the feed route),
   all three Supabase clients and the README accept `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` **or** `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   Requiring either single name would have failed a deployment that sets the other, and I cannot see which one the Vercel project
   uses. So it is a required one-of group, in a new constant `REQUIRED_ONE_OF_ON_VERCEL`, not an entry of `REQUIRED_ON_VERCEL`: the
   guard test pins that list and reads it with a regex that a nested array would cut short. The message names both spellings.
2. **N8(b), "how many tokens the answer took" is imprecise.** The stored `usage` is input tokens, output tokens (always 0: Jev's
   output is uncosted) and latency, and the payload also holds the model id. The tokens are the call's input, not the answer's. The
   clause lists what is stored: "the paper's id, the question, the answer, how sure Jev was, which Jev model answered, and how many
   tokens and how much time the call took". Still inside one sentence; the brief's other clause, "the word meanings you selected", is
   used as given (the wire state's `senses` come from `intent.selectedSenseConcepts`).
3. **N11: `RAPIDAPI_KEY` left the README in K6, not K9.** The Jobs paragraph that named it, and named the other job keys as
   environment settings, became false the moment K6 deleted the reads, so it was rewritten in K6 (it now says the credentials come
   from the request, none is read from the environment, the build fails on four of the names, and that **no route serves the jobs
   feed today**; I checked: `api/jobs/*` are the three cron routes and no non-test file imports `lib/jobs/pipeline`). K9 did
   `GOOGLE_API_KEY` and the Jev line. Two stale comments (`jobs/types.ts`, `jobs/sources/index.ts`) said "env keys"; they were fixed
   in K6.
4. **K5 as a test.** The repo's component tests use `renderToStaticMarkup`, which shows a zustand store's *initial* state, so a test
   cannot set "signed out with a key saved" through the stores (the existing Jev tests pin the store wiring from the source for that
   reason). I followed the repo's own pattern (`AccountSectionView`, `EmailSettingsView`): `JevSetup` is now a thin container that
   reads the three stores and renders `JevSetupView`, which takes `jevApiKey`, `onChange`, `report` and `authOutcome` as props, so
   both states are rendered and asserted; the wiring of the container is pinned in the source as before.
5. **K1's scan is a superset of the brief's.** It matches `api[_-]?key` case-insensitively (the brief named `apiKey` and
   `jevApiKey`) and also fails on an aliased `console`. The only production console call under the two folders today is
   `jev-contract.ts`'s truncation line, which names no key.
6. **Under A's C4, `pipeline.jev.test.ts` does not go red** and the brief did not say it would: that test passes a screen *closure* and
   never runs `screen.ts`. The mutation is caught where `screen.ts` runs (`screen.test.ts`, `route.jev.test.ts`) and by scan 9. The
   helper is in that test regardless, for any key the closure's owner might write.

## Choices beyond the brief (look at these in review)

- **The SF-4 note is shown in the Welcome block as well as on the Profile row.** The brief says "in `JevSetup`"; a reader can paste a
  key in the wizard before signing in, and the same sentence is true there. It appears once, only for a signed-out reader with a usable
  key.
- **`USAJOBS_USER_AGENT` is no longer read, and it is not on the forbidden list.** It is the reader's registered address, not a
  credential, so the guard does not refuse it; it is inert on a deployment, like the other `PEER_JEV_*` names.
- **A key that was rejected is not retried by pasting the same value again.** `updateJevApiKey` leaves the report alone when the new
  value equals the old one, so a reader whose key was refused for a reason fixed on Jev's side (an account not yet active) has to edit
  the key, or remove it and add it back, to try again. Both paths are tested. Say so if you want a visible way to retry (a button, or
  clearing the report after some hours); I did not add one.
- **Scan 3 now also names `RAPIDAPI_KEY`** (README named it once; nothing reads it).

## Not landed (the manager's rulings, for the record)

N2 (a TTL for `unavailable` pools; later). N3 (nothing to do). N5 (keep both guards; the equivalent mutant C21 stays equivalent).
N6 (reasons for Tier 2's own top 20 versus Jev's order; a design question for the owner after J7). N7 (Resend, OpenAlex, Semantic
Scholar: the owner's decision, asked in chat; checklist item 13). N8(a) ("the 50 best candidates" is an upper bound) and N8(c)
(`screened` counts cache hits): copy precision left for the owner. N12 (the provider cost estimates in `ai-setup.tsx` are pre-existing
vendor prices; the owner decides). N13 (applied history, pinned). N14 (low). N15 (aborting late in-flight calls needs an abort signal
through `callJev`; a later change). N16 (pre-existing provider error logs; not a Jev path). N8(b)'s "the key reaches the server on every
load" clause was not in the brief's quoted wording and is not on the page; the two clauses the brief quoted are.

## The owner's checklist: what A's section 5 gains and loses

- **Item 1 (remove from Vercel, every environment) gains names, and the build now enforces them:** `GEMINI_API_KEY`, `ADZUNA_APP_ID`,
  `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `USAJOBS_API_KEY`. If any is set the preview and the deploy fail, naming it. It also gains a
  **requirement**: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set in every environment, or the
  build fails (before, it built and answered 503 on every AI route). Check both before redeploying the preview.
- **Item 2 (inert names) loses** the four job-source credentials (they moved to item 1, since the build refuses them now). It keeps
  `USAJOBS_USER_AGENT`, `PEER_ENTITLEMENT_MODE`, `PEER_DEV_ENTITLEMENT`, `PEER_COMPANY_SPEND_CAP` and the other `PEER_JEV_*`.
- **Item 3 (revoke the company keys) gains** any Gemini key set under `GEMINI_API_KEY` and any of the four job-source keys that were
  ever set (JSearch bills per request): removing a variable does not revoke the credential.
- **Item 8 (bump `APP_VERSION`) is done (K3) and drops out.** **Item 9 is done** (B-1 in K1, SF-1 in K2, SF-3 in K4, SF-4 in K5): it
  drops out. SF-2 and SF-5 are done.
- **Item 12 (the Build Command must run `prebuild`) matters more:** the guard now carries the Supabase-pair requirement and five more
  refusals, and runs only if `prebuild` does.
- **Items 4, 5, 6 and 7 (the `private_decisions` check, the two migrations, `supabase functions delete jev-broker`) are unchanged and
  are now the only blocking items besides item 1.** Items 10, 11, 13, 14, 15 and 17 are unchanged. Item 15's v0.45.0 text changed
  (SF-1) but needs nothing from the owner.
- **Item 16 (PR #32) gains overlaps:** K9 edits `app/privacy/page.tsx` (two clauses inside the Jev section) and `app/welcome/page.tsx`
  (one clause), both also edited by that PR; K4 edits `lib/llm/providers/gemini.ts` (4 lines added, 7 removed: the map and the body of
  `getApiKeyClient`; the new tests are in a new file so `gemini.test.ts` is untouched); K6 rewrote scan 3 in
  `lib/security/spend-scans.test.ts` and K1 added scan 9 there (the PR also edits that file; its scan 5 list is separate). The Gemini
  hunk is the one most likely to conflict.
- **New, informational:** the same-key retry limit above.

## Environment notes

- Logs, hash files and the offline `Headers` probe are in the session scratchpad (`byok/c4logs`), not in the repository.
- I created no branch, merged, rebased, amended or force-pushed nothing, and never used `git checkout -- <file>`, `git restore` or
  `git reset`; every commit used a pathspec (new files `git add`ed by name). One commit attempt (K4) was refused by git because a new
  file had not been `git add`ed yet; it changed nothing, and the commit was redone after adding it. I never touched `/home/user/peer`.
- `web/node_modules` in the worktree is a symlink into the main checkout, so tool caches land there; no source file was touched
  outside the worktree.
