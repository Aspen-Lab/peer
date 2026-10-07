# Jev on the reader's own key: the plan and the owner's decisions

> Jev is a bring-your-own-key option on `remove-paid-tier-restore-byok`. This file is investigator B2's study of
> `origin/main` a127ad62 (the line numbers below are on that commit, not on this branch: C1 and C2 moved many of them),
> with the owner's and manager's decisions of 2026-10-06 recorded first. Where a decision and the plan below disagree,
> the decision wins. J7 (the paired evaluation, section 3.4) is not part of this PR; the owner runs it later with real labels.

## Decisions (2026-10-06)

- **Owner.** Every company-API path is cut. Jev is NOT deleted: it is an option the reader turns on by applying for a Jev
  key and pasting it in, like a model key. Without a key the feed screens without Jev. The product says what the key turns on.
- **The claim.** No number anywhere. The repository has no measurement of Jev's effect, and its binding rule
  (`ABC-JEV-INTEGRATION.md:94`) forbids a claim without paired measurements. `lib/decisions/jev-claim.ts` holds
  `JEV_MEASURED_GAIN = null`; in the null branch `jevGainSentence()` renders exactly "How much this improves your list is
  not yet measured."; a test pins that sentence and forbids a digit in it. The filled branch is implemented and tested with a
  fake value and never filled here. No adjective of size and no price or cents estimate in any rendered string about Jev;
  "Jev bills your own account for what it reads." is the whole money sentence.
- **D1 (where to apply).** One constant, `JEV_SIGNUP_URL` in `components/profile/jev-setup.tsx`, set to
  `https://docs.typesafe.ai/` until the owner supplies the sign-up page. Button: "Get a Jev key".
- **D2.** J4 ships with the null branch. No J7 in this PR.
- **D3 (both keys).** Jev owns the order; the reader's model key still writes the reasons (section 2.5, point 3).
- **D4 (caps).** No daily counts (they are company-budget concepts). Bounds: the hourly `requireAiRequest("paper-feed", 60)`
  limit, at most 50 candidates per fresh build, the decision cache, stop at the first `unauthorized`, and stop after 3
  consecutive `rate_limited` / `overloaded`.
- **D5 (kill switch).** None. The key is the switch.
- **D6 (backup file).** `exportProfileDocument` strips `jevApiKey` and `feedAiApiKey` (and every other
  `CREDENTIAL_LIKE_FIELDS` entry); a restore already cannot install them, so a backup must not carry them.
- **D7.** Jev is independent of the feed's "AI search" pill; the two switches are the two keys.
- **J3 is in.** Jev decisions reorder the reader's papers (demote-only, `unknown` neutral, the bounded `applyRerankOrder`
  boost, Jev order used only when at least 60 % of the shortlist was answered, a 20 s race deadline with partial results,
  `export const maxDuration` on the feed route), with `meta.jevScreening`; J5 shows it in the Profile row.
- **Local dev (risk 9).** An `InMemoryDecisionCache` is used when `isLocalDevRuntime()`.
- **`20260924000400_private_decisions.sql`** stays and must be applied in production. `PrivateDecisionCache` stays fail-soft.
- **`lib/decisions/gemini-fallback.ts` is a company-funded path and is deleted in J2** with `PEER_JEV_GEMINI_FALLBACK*`, the
  `jev-gemini:` counter prefix and their tests. The edge function and its parity test go too.
- **Superseded documents.** `docs/JEV-RELEASE-READINESS.md` and `ABC-JEV-INTEGRATION.md` carry a banner; their text is history.

---

# Jev as a bring-your-own-key option: map and plan (investigator B2)

Read-only. Nothing in `/home/user/peer`, the worktree or any branch was edited, staged, committed or switched.
Ground truth: `origin/main` = `a127ad62` (after `git fetch origin main`). Every `file:line` below is on that commit,
checked with `grep -n` in `scratchpad/byok/mirror/` (a `git archive` of it) unless it says otherwise. Paths are under
`web/` unless they start with `docs/` or `ABC-`. No key or secret value is quoted anywhere in this file; the few
test names that mention a fixture key are cited by name only.

Corrections to B-plan (`B-plan.md`) that matter here:
* the smoke runner lives at `web/src/lib/evaluation/jev-smoke/` (not `src/evaluation/`);
* `docs/JEV-RELEASE-READINESS.md` says Jev "still has zero live calls" (line 313). That sentence predates
  `docs/jev-abc/JEV-SMOKE-A-20260928T023832Z.md`, which made 4 live calls (section 3);
* `logDecisionUsage` is a console line, not a ledger (1.6);
* the Jev rubric asks at most four questions per paper, not five (1.4).

---------------------------------------------------------------------------------------------------

## 0. Answers in one screen

1. **Shadow or live? Shadow only. No mode, flag or code path lets a Jev decision change what the reader sees.**
   `shadow.ts:1-8` says so in its header; `runJevShadow` returns counts only (`ShadowRunSummary`, 144-167), and the one
   caller discards even that (`feed/route.ts:525-547`). The decisions go to `private_decisions` and the only reader of that
   table is `shadow.ts` itself (`cache.get`, line 323, to skip a repeat call). `combineDecisionAnswers` (`combine.ts:76`) has
   **no non-test caller**. There is no `PEER_JEV_ENFORCE` or similar: the ten `PEER_JEV_*` names are broker, transport,
   shadow, caps and fallback switches (1.3). "Enforced" decisions are a planned later phase that was never built
   (`ABC-JEV-INTEGRATION.md:1020`; `docs/jev-abc/P3-B-20260924T0525Z.md:111,348`).
2. **Making it live is a medium change, not a small one and not a large one**: about 6 production files and ~250 lines of
   new code, because it can reuse the slot Tier-2 already uses (`aiOrder` in the cached pool, replayed by
   `applyRerankOrder`), so the pool schema and the read path do not change. The real costs are a latency budget
   (the call moves from after the response into it) and the numbers that decide how hard Jev moves a paper (2.5, 3.4).
3. **How much better: no number exists, and a ratified rule forbids inventing one.** `ABC-JEV-INTEGRATION.md:94`
   (BINDING, 2026-09-21): "No claim that Jev improves HR quality or cuts total costs by a specified percentage without
   paired measurements." The only live Jev evidence in the repo is 4 synthetic calls that returned contract-valid
   answers in 174-668 ms. Section 3 has the honest sentence and the one small evaluation that would earn a number.
4. **Plan for C3**: eight commits J0-J7 (section 4). J2 is a valid stopping point (company key gone, Jev dark); J3 is
   where Jev goes live; the copy (J4) comes after the behaviour; the evaluation harness (J7) is what lets the claim
   constant carry a number.

---------------------------------------------------------------------------------------------------

## 1. How Jev is wired today

### 1.1 The run, step by step (all on origin/main)

```
POST /api/feed                                   app/api/feed/route.ts:712
  requireEntitledAiRequest("paper-feed", 60)     :739   hourly per-reader limit, sign-in gate (allowAnonymous)
  entitledTier / aiProvider / aiTier             :743-756
  paperCacheScope = privatePaperScope(...)       :758-  (signed-in only; ownerId)
  shadowEntitled = effectivePlan !== "free"      :798   <- C1/N4 replaces this with the signed-in test
  jevTransport  = resolveJevTransport()          :799   flag.ts:159-170
  if ( jevShadowEnabled()                        :801   env PEER_JEV_SHADOW === "on"
       && jevTransport !== "disabled"            :802   direct key set, or broker configured
       && paperCacheScope && gate.user.id === ownerId       :803-805
       && shadowEntitled && aiTier >= 2 && intent )         :806-808
     onFreshShortlist = buildJevShadowHook({...})  :812   route.ts:558-569, wraps after()
  runLedgerAwareFeed(..., onFreshShortlist)      :858   -> runFeedPipeline -> getOrBuildCachedPool
        buildPaperPool(...)                      pipeline.ts:581   ONLY on a pool-cache miss (build callback, :1924)
           tier1Ranked / rankedForJudgment       :912 / :921
           onFreshShortlist(top 50)              :936-948   synchronous call, try/catch, return value ignored
           applyTier2Rerank(...)                 :959       the only thing that reorders papers (reader's model key)
  response is sent
  after(() => runJevShadowSafely(...))           route.ts:563   runs after the response
     runJevShadow(...)                           decisions/shadow.ts:271
        per candidate (<=50, concurrency 4, 45 s deadline):
          cache.get(deriveDecisionCacheKey(...)) shadow.ts:323   PrivateDecisionCache -> private_decisions
          hit  -> count it, logCacheHit()
          miss -> dispatchJevCall(...)           jev-dispatch.ts:85  "direct" | "broker" | "disabled"
                    direct : callJevDirect       jev-direct-client.ts:206   reads env JEV_API_KEY
                    broker : callJevViaBroker    broker-client.ts:166       -> Supabase edge function
                 both: entitled gate, then reserveJevCall (per-user then global daily counter), then callJev (HTTP)
          ok   -> optional Gemini fallback (never reachable), cache.set(...), logDecisionUsage(...)
```

Nothing after `after()` has a path back to the reader's response: the summary is dropped, and the pool that was already
built and cached contains no Jev field (`CachedPaperPool`, `opportunities/pool-cache.ts:85-91`: `aiOrder`, `aiReasons`
only).

### 1.2 The 14 `lib/decisions/*` files (the whole Jev set is 25 production files incl. `vitest.jev-smoke.config.ts`, and 19 test files; B-plan 6.0 Q1)

| File | Lines | Role | In the BYOK design |
|---|---:|---|---|
| `types.ts` | 92 | `DecisionRequest`, `DecisionAnswer`, `DecisionResult` | keep |
| `rubric.ts` | 224 | `JEV_MODEL_ID = "jev-1.13.0"` (:39), 5 fixed question specs, `DIMENSION_WEIGHTS` (:182), `selectQuestionsForRequest` (:207) | keep |
| `jev-contract.ts` | 398 | `buildJevRequest` (what leaves Peer), `validateJevResponse` (6 rules), truncation | keep |
| `jev-client.ts` | 173 | `callJev`: one HTTP call to `https://api.typesafe.ai/v1/systemone` (:29), 15 s timeout (:31), retries 429/529 twice (:34-36), key only as a parameter | keep (header comment says "shared with the edge function": edit) |
| `combine.ts` | 103 | `combineDecisionAnswers` -> `[0,1]`, unknown = neutral 0.5 | keep; becomes live (no caller today) |
| `decision-cache.ts` | 89 | `deriveDecisionCacheKey` (owner, intent, paper content, provider, model, rubric; no date, no key), `InMemoryDecisionCache` | keep |
| `private-decision-cache.ts` | 108 | `PrivateDecisionCache` over table `private_decisions`, service-role client, fail-soft | keep |
| `paper-content-hash.ts` | 51 | content hash for the cache key | keep |
| `jev-direct-client.ts` | 238 | `callJevDirect`: env key, entitled gate, reservation, `callJev` | rewrite to ~60 lines: key is a parameter |
| `shadow.ts` | 456 | `runJevShadow`: the per-candidate loop | rewrite (return decisions, deadline, 401 stop) |
| `jev-dispatch.ts` | 118 | picks direct or broker | delete |
| `broker-client.ts` | 215 | `callJevViaBroker`, `jevBrokerEnabled` | delete |
| `flag.ts` | 241 | shadow flag, transport switch, caps, Gemini fallback config | delete |
| `gemini-fallback.ts` | 371 | company-funded Gemini answers for `unknown` dimensions; never reachable (`mintGeminiFallbackProviderCapability` has no production caller) | delete |

Plus `security/jev-broker-auth.ts` (99; `reserveJevCall`, `jev:<owner>:<day>` and `jev:all:<day>` counters) -> delete;
`supabase/functions/jev-broker/*` (6 files, 1207 lines; 887 of them byte-parity copies of kept files) -> delete;
`evaluation/jev-smoke/*` + `vitest.jev-smoke.config.ts` -> keep (rename the env var, 4.2 J2).

### 1.3 Flags and caps (every `PEER_JEV_*` name read in `src`, `supabase`, `scripts`)

| Name | Read at | Meaning today | After |
|---|---|---|---|
| `PEER_JEV_SHADOW` | `flag.ts:28-30` | literal `on` lets `route.ts` schedule the background run | delete |
| `PEER_JEV_TRANSPORT` | `flag.ts:125-128,159-170` | force `direct` or `broker`; cannot fabricate its prerequisite | delete |
| `JEV_API_KEY` | `jev-direct-client.ts:192-199` (the only reader; `spend-scans.test.ts:306-333` scan 7 enforces "exactly this file"); edge function `index.ts:241` | the **company's** Jev key | delete; ban on Vercel |
| `PEER_JEV_BROKER`, `_BROKER_URL`, `_BROKER_SECRET` | `broker-client.ts:99-101`; `flag.ts:76-87` | broker path on, and its URL and bearer secret | delete |
| `PEER_JEV_PER_USER_DAILY_CAP` (50), `PEER_JEV_GLOBAL_DAILY_CAP` (2000) | `flag.ts:24-25,84-85,106-111`; edge `index.ts:57-58,133-134` | count-based **company budget** in `usage_counters` keys `jev:*` / `jev-edge:*` | delete (see D4) |
| `PEER_JEV_GEMINI_FALLBACK` (+ two caps, 10 and 200, `MAX_GEMINI_FALLBACK_PER_RUN = 5`) | `flag.ts:192-241` | bounded Gemini decision fallback; inert, no capability is ever minted (`.env.example:263`) | delete |

No variable turns Jev on for the reader's result. `.env.example:180-277` documents all of them.

### 1.4 What "screening without Jev" consists of today

There is **no rubric on the non-Jev path**. `rubric.ts` is Jev-only (five fixed questions; `selectQuestionsForRequest`
asks `core_vs_background` and `project_help` always, `sense_match` only when the reader selected a sense,
`method_outcome_match` only when `intent.methods` is non-empty; `population_match` is **never** asked, `shadow.ts:179`
hard-codes `intentSpecifiesPopulation: false`). So a Jev run asks 2 to 4 questions per paper.

The non-Jev path, in order (`feed/pipeline.ts`):
1. retrieval from OpenAlex, Semantic Scholar, arXiv, DBLP, PubMed, then `dedupItems`, `dropStale` (:581-905);
2. `scorePaperCandidates` (:910; `scoring/combine.ts`): keyword match with abbreviation and subject-tag admission and
   the required-tag gate T1-T4 (`combine.ts:30-50`), TF-IDF, recency, source weight, the sense-context gate that
   **demotes** a wrong-sense paper instead of dropping it (`keyword.ts` `senseContextGate`), preference ledger applied
   at read time (:2054);
3. `applyTier1Rerank` (`feed/rerank.ts`): overlap with must-include / nice-to-have / avoid, method penalty, review and
   avoid demotion with a 0.25 floor (:60-75), per-topic and per-author diversification; applied at every tier on the read
   path (:2063), only at tier >= 1 inside the build (:912);
4. optional RRF fusion across channels, flag `PEER_RANK_FUSION`, default off (:917-921);
5. Tier-2 rerank: one `generateJsonText` call on the **reader's model key** ranking the top 50 and writing reasons for
   the top 20 (`tier2-rerank.ts:80-158`); stored in the pool as `aiOrder` / `aiReasons` and replayed free on a cache
   hit by `applyRerankOrder` (:30-58, boost `0.12 - index*0.002`, ordered ids first, the rest behind them);
6. `applyJournalBoost`, the delivered-paper exclusion, `slice(0, topN)` (:2070-2110).

A reader with no key at all gets 1-4 and 6: the Tier-0 reading, which `docs/PRODUCT_DIRECTION.md` requires to stay useful
("Reliability through degradation"). Jev would sit where step 5 sits.

### 1.5 What the broker edge function adds beyond the direct client, and what the reader's key needs of it

`supabase/functions/jev-broker/index.ts` (251 lines, never run: header 15-22 "RUNTIME VERIFICATION IS BLOCKED... has
never actually been run"; `ABC-JEV-INTEGRATION.md:3189` lists its deployment as a user action no one recorded):
* **hides the company key** from Vercel (`Deno.env.get("JEV_API_KEY")`, :241), the reason it was built (B-plan P3-B
  DESIGN 0.1). The owner reversed that on 2026-09-26 (`ABC-JEV-INTEGRATION.md:236`, JEV-DIRECT) and the direct client has
  been the default transport since;
* a **second, independent pair of caps** (`jev-edge:` counters, :125-166) so a leaked `PEER_JEV_BROKER_SECRET` cannot
  spend unbounded (§1p.I defence in depth);
* a constant-time check of that bearer secret (:83-96, :173-179) and an owner-exists lookup (:200-203, existence only;
  the entitlement check was never added, :205-235 explains why);
* **no cache**: the decision cache is entirely on the Next side. The edge function holds no reader data.

With the **reader's own key** none of it earns its keep: there is no company key to hide, the caps and the secret exist
to protect the company's money, the owner check duplicates `requireAiRequest`, and a broker would mean sending the
reader's key to a second service, one more place for it to leak. Delete the function, its four parity copies, its
counter keys, and tell the owner to run `supabase functions list` and delete `jev-broker` plus the `JEV_API_KEY` and
`PEER_JEV_BROKER_SECRET` secrets if they were ever set (a deployed function is not removed by deleting the folder).
`tsconfig.json:37-38` and `eslint.config.mjs:30-31` carry excludes for `supabase/functions`; remove them with it.

### 1.6 The ledger, the log and the cache: who do they belong to?

* **`logDecisionUsage`** (`llm/usage-log.ts:119-129`): one `console.log` line, `[decision] typesafe/jev-1.13.0 cache=...
  status=... in=... out=... NNms`. No table, no user id, no key. It is **not** the company ledger (that is
  `recordUsageEvent`, lines 68-82 of the same file, which C2/F1 removes). Keep it: it is the only cost and latency
  evidence a live run leaves in the Vercel logs. Dependency for C2: its F1 must leave `logDecisionUsage` and the
  `DecisionUsageLog` type in place.
* **`private_decisions`** (`migrations/20260924000400_private_decisions.sql`): `(owner_id, scope_key)` primary key,
  `payload jsonb` = `{paperId, answers[], usage, modelId}`, RLS owner-read, service-role write. The key hash includes the
  owner, the intent, the paper content, provider `typesafe`, model `jev-1.13.0` and the rubric version, **not** whose key
  paid. It is per reader, holds no paper text and no credential: **keep, no change**. Note it has no retention job
  (only `created_at`), so the privacy copy must say decisions are kept with the account.
* **Production state I cannot verify from the repo**: the migration header says "authored only; it is not applied by this
  campaign" and `ABC-JEV-INTEGRATION.md:3256` (2026-09-28) says the production shadow "still needs PEER_JEV_SHADOW=on +
  JEV_API_KEY in Vercel + the private_decisions migration". If it was never applied, `PrivateDecisionCache` degrades to a
  miss on every read and a silent no-op on every write (:164-196), so every fresh build would call Jev for all 50
  candidates on the reader's key. The owner must run `select to_regclass('public.private_decisions')` and apply the
  migration before the feature ships.

---------------------------------------------------------------------------------------------------

## 2. The BYOK pattern to copy, and the Jev equivalent

### 2.1 How the reader's model key travels today (every touchpoint, origin/main)

| Step | Where |
|---|---|
| fields | `types/index.ts:555-556` `feedAiProvider: UserAiProvider`, `feedAiApiKey?: string`; defaults `:622-623` (`"default"`, `""`) |
| store | `store/profile.ts:206-207` (types), `:744-753` `updateFeedAiProvider` (blank key when provider is `default`), `updateFeedAiApiKey` (trim, blank -> `undefined`); persisted with the profile in browser storage (no `partialize` exclusion) |
| UI | `components/profile/ai-setup.tsx`: `AiKeyFields` (:132-231: provider `<select>`, `SecretInput`, registration link), `AiProviderGuide` (:284-431), `ApiKeyHelp` (:437-533); used by `app/welcome/page.tsx:450-463` (step `ai`) and `app/profile/page.tsx:2092-2107` (`EditRow label="AI provider"`) |
| never synced | `components/profile-sync.tsx:172-189` `remoteProfilePayload` destructures and `void`s `feedAiProvider`, `feedAiApiKey` (and Tavily, Adzuna, USAJobs); proven by `profile-sync.test.tsx:139` (full key set pinned) and `:210-235` (redaction) |
| never restored from a backup | `lib/profile/merge.ts:495-514` `CREDENTIAL_LIKE_FIELDS` + `stripCredentialFields`; `merge.test.ts:608-636` |
| the request | `store/feed.ts:785,794-795,829-834` `paperFeedRequestBody`: `llmOverride: {provider, apiKey}` only when `aiPaperSearchEnabled && aiMode === "byok"`; the report route does the same in `components/reader/use-model-report.ts:230-241` and the digest in `app/page.tsx:203-210` |
| the server | `app/api/feed/route.ts:672-710` `parseLlmOverride` (five provider ids, non-empty strings) -> `llmOverride` (:738) -> `resolveProvider(llmOverride, ...)` (:750-753) -> `hasUsableProviderOverride` / `resolveUserProvider` (`llm/providers/registry.ts:57` and `:69`; in `resolveProvider` the reader's key wins over every other source) |
| rate limit | `security/ai-request.ts:155-175` `rateKey("paper-feed", user.id, now)` in `usage_counters`, 60 per UTC hour, fails open |
| copy | `/privacy` section "Your own model key" (`app/privacy/page.tsx:42-47`): stays in the browser, excluded from sync "the one line that does it is a `void feedAiApiKey`"; `ApiKeyHelp` (:506-509): "Peer stores it only in this browser and sends it only when calling your selected AI provider" |
| build guard | the model key needs no ban of its own: `GOOGLE_API_KEY` is moved to FORBIDDEN by C1/N6; the five env provider names are already banned (`scripts/assert-byok-production-env.mjs:79-99`) |
| tests | `vitest.setup.ts:32-41` deletes `GOOGLE_API_KEY` and `TAVILY_API_KEY` from `process.env` at import and before every test |

The key is relayed through Peer's server on every request in the POST body and is never stored: the feed route has no
`console.*` call at all (checked), and `callJev` is already proven not to leak its key (`jev-client.test.ts`, the leak
cases; `jev-direct-client.test.ts` mirrors them).

### 2.2 How the Tavily key travelled when it was a reader's key (the template the owner named)

* Local-only fields `tavilyEnabled` + `tavilyApiKey` (`types/index.ts:544-545`), never synced (`profile-sync.tsx:172-183`),
  stripped on restore (`merge.ts:496`).
* UI: `components/profile/connector-panel.tsx` (113 lines). Three parts that the Jev row should copy: a one-sentence
  "what it is" ending "Optional - Peer works without it." (:66-69); a switch plus `SecretInput` with a
  `Tavily API key (tvly-...)` placeholder (:71-95); a micro-line and a link button, **"Sign up free (1,000 searches/mo),
  copy the key from your dashboard."** and **"Get a Tavily key"** (:97-110, `buttonVariants({tone:"accentSoft"})`).
  Mounted only on the welcome `connectors` step (`app/welcome/page.tsx:496`), whose copy is stale (it talks about Events
  and Jobs, which have no route on main). The history: commit `5b27c68d` (2026-07-20) "Multi-API connector UI:
  Tavily/Adzuna/USAJobs BYOK dropdown + onboarding step".
* The request: `searchConnectors.tavily.{enabled,apiKey}` in the body, parsed by `route.ts:638-662`
  `parseSearchConnectors`; today `paperFeedRequestBody` deliberately sends none (`store/feed.ts:825-831`).
* The ban: `TAVILY_API_KEY` is in `FORBIDDEN_ON_VERCEL` (`assert-byok-production-env.mjs:95-97`), put there by `e65250e5`
  (2026-09-07) with the rule "A Vercel project that still carries TAVILY_API_KEY will now fail the build." and the
  precedent that the guard names variables and never prints a value (R-GUARD-2, lines 11-16).

### 2.3 The Jev equivalent, end to end

**Profile field.** `jevApiKey?: string` in `UserProfile` (`types/index.ts`, next to 556), default `""`. No `jevEnabled`
switch: the key is the switch (user-declared intent over configuration; remove the key to turn it off). Updater
`updateJevApiKey(value)` in `store/profile.ts` (copy of 751-753: trim, blank -> `undefined`). A confirmed sign-out resets
the local profile to `defaultProfile` (`store/profile.ts:837-858` `logOut`, called from `profile-sync.tsx:879-887` only for a confirmed sign-out; an involuntary session loss keeps local data), which clears it with the other keys. It must **not** be
added to the remote-merge block at `store/profile.ts:813-816`: a server row must never be able to set it.

**Never synced, never restored, never logged.**
* `remoteProfilePayload` (`profile-sync.tsx:172-189`): destructure and `void jevApiKey`.
* `CREDENTIAL_LIKE_FIELDS` (`merge.ts:495-502`): add `"jevApiKey"` (the comment says "six", the test says "all six").
* Tests that enumerate the profile key set will fail until the new field is classified: `profile-sync.test.tsx:139`
  and `:211`, `lib/profile/merge.test.ts:609`.
* The profile **backup file** (`exportProfileDocument`, `store/profile.ts:391`) serialises the whole profile, so it already
  contains `feedAiApiKey` and would contain `jevApiKey`. That is existing behaviour for the model key; decision D6.

**Request body.** One top-level string, `jevApiKey`, sent by `paperFeedRequestBody` (`store/feed.ts:759-866`) only when
the reader is signed in (the C1 `auth` parameter replaces `entitlement`) and the trimmed key is non-empty. Not sent by the
digest, report or figure routes: they never use Jev. Never part of `FeedRequest` (`feed/types.ts:35-48`) or any cache
key: the route builds a closure that holds it (below), so it cannot reach `derivePoolCacheKey`, `createTrustedPaperCacheScope`,
`prepareBatch`, the rollover store or `private_decisions`.

**Server, per request** (`app/api/feed/route.ts`, POST, next to :738):
```
const jevApiKey = parseJevApiKey(body.jevApiKey);   // string, trimmed, 1..512 chars, no whitespace or control characters
...
if (jevApiKey !== undefined && paperCacheScope !== undefined
    && gate.user?.id === paperCacheScope.ownerId && Boolean(intent)) {
  jevScreen = buildJevScreen({ ownerId, apiKey: jevApiKey, intent, senseConcepts: intent.selectedSenseConcepts });
}
```
No env key, no broker, no `entitled` flag, no `aiTier >= 2` condition (a reader with a Jev key and no model key still gets
Jev; the model-key and Jev-key switches are independent), no flag. `callJevDirect(request, { apiKey, fetchImpl?, timeoutMs? })`
is the direct client with the reader's key as a parameter: no `process.env`, no reservation. The rule "sign-in stays
required" (Q2) holds: no scope, no Jev.

**No key.** `jevScreen` is `undefined`; the pipeline is exactly today's (a test proves the built pool and the response are
deep-equal with the hook absent). No error, no `meta` field, no hint anywhere except the setup copy (the Profile row and
the welcome block). A reader who removes the key returns to the non-Jev pool of the day (the pool key differs, 2.4).

**Rate limit.** `requireAiRequest("paper-feed", 60)` is unchanged: 60 feed requests per reader per UTC hour. It is the bound
on what a runaway client can spend on the reader's own key: at most 60 fresh builds x 50 calls x ~2,000 input tokens x
$0.042 per million is about $0.25 an hour (an estimate from the vendor's published price, 3). Plus the existing ceilings
that stay: 50 candidates per fresh build (`MAX_SHADOW_CANDIDATES`, `shadow.ts:73`), one fresh build per (owner, intent,
day) because of the pool cache, and the decision cache. New: stop the run at the first `unauthorized` (a wrong key must
not cost 50 failed calls per build) and after 3 consecutive `rate_limited`/`overloaded` (D4 offers a per-reader daily
count as an alternative).

**Privacy entry** (exact text in 4.3, J4). The page says it is "written from the code" and must change in the same commit as
the behaviour (`privacy/page.tsx:3-6`). It is silent about Jev today.

**Build guard.** Add `JEV_API_KEY` and `PEER_JEV_BROKER_SECRET` to `FORBIDDEN_ON_VERCEL`
(`assert-byok-production-env.mjs:79-99`), rewrite the comment at 66-77 (it currently says the key "is ALLOWED and SILENT",
manager ruling §1ab P1), and flip the two tests that assert exactly that (`assert-byok-production-env.test.ts:289-305`:
"no longer bans JEV_API_KEY ... builds cleanly" and "stays silent") into "fails the build and prints the name, never the
value". The other `PEER_JEV_*` names are inert once nothing reads them; do not fail a build over them.

**vitest.setup.** Add `JEV_API_KEY` to `SPENDABLE_KEYS_FORBIDDEN_IN_TESTS` (`vitest.setup.ts:32-35`, unconditional, like
`GOOGLE_API_KEY`). Keep the smoke tooling (it is the evaluation harness, 3.4) but give it a **different variable name**,
`JEV_SMOKE_API_KEY`, so no file anywhere reads `JEV_API_KEY`: rename in `vitest.env-allowlist.ts:98`,
`vitest.setup.ts:95-115` (`JEV_SMOKE_KEYS_FORBIDDEN_UNLESS_OPTED_IN`), `evaluation/jev-smoke/gate.ts`, `runner.ts`,
`test-support/env-isolation.test.ts:180-232`. The runner passes the value to `callJevDirect` as `apiKey`.

**Scan 7** (`spend-scans.test.ts:306-333`) becomes "no source file reads `process.env.JEV_API_KEY`" (empty list), keeping
its "rewritten, never deleted" status.

### 2.4 What is deleted and what stays

| Delete (J2) | Why |
|---|---|
| `broker-client.ts`, `jev-dispatch.ts`, `flag.ts`, `gemini-fallback.ts`, `security/jev-broker-auth.ts`, `supabase/functions/jev-broker/*` (2,251 production lines) | company transport, company caps, company-funded fallback |
| tests: `broker-client` 26, `broker-counter-keys` 8, `broker-parity` 5, `flag` 38, `gemini-fallback` 23, `jev-dispatch` 8 = 108 cases, 1,608 lines | subjects deleted (static `it(` counts) |
| `PEER_JEV_*` and `JEV_API_KEY` in `.env.example:180-277`; `tsconfig.json:37-38` and `eslint.config.mjs:30-31` excludes | |
| `feed/route.ts`: `JevShadowHookInput`, `runJevShadowSafely`, `buildJevShadowHook` (:499-570), the gate (:779-820), imports :47-54, `after` from the `next/server` import (:1) | replaced in J3 by the key-in-hand version |

| Keep | Note |
|---|---|
| `types.ts`, `rubric.ts`, `jev-contract.ts`, `jev-client.ts`, `combine.ts`, `decision-cache.ts`, `private-decision-cache.ts`, `paper-content-hash.ts` | the contract, the rubric, the combiner, the per-reader cache |
| `logDecisionUsage` | console only |
| migration `20260924000400_private_decisions.sql` + rollback | per-reader cache; apply it in production |
| `evaluation/jev-smoke/*`, `vitest.jev-smoke.config.ts`, `npm run test:jev-smoke` | env var renamed (2.3) |
| the hourly limit, the sign-in gate, `usage_counters` | shared infrastructure (B-plan 0.3) |

Pool-cache fixture (needed in J3): `derivePoolCacheKey` (`opportunities/pool-cache.ts:468-497`) hashes
`aiTier: input.aiTier` and `JSON.stringify` omits `undefined`. A Jev reader without a model key sends `aiTier: 0`, the same
pool key as a reader without Jev, so adding a key mid-day would otherwise reuse the non-Jev pool until tomorrow. Add an
optional `jevScreening?: true` to `PoolCacheKeyInput`, hashed **only when true**: every existing key stays byte-identical.

### 2.5 What it takes to make Jev actually change the screening

Smallest live path that reuses what exists (recommended):
1. `shadow.ts` -> `screen.ts` (`git mv`): after the cache check keep the hit's decision, and return
   `{ decisions: Map<paperId, DecisionResult>, summary }`; enforce the hard deadline with a race so partial decisions are
   usable; stop on the first `unauthorized`. (`shadow.ts:271-455`, about +40 lines.)
2. New `decisions/apply.ts`: `jevOrderedIds(shortlist, decisions)` -> best-first ids, from `combineDecisionAnswers`
   (`combine.ts:76`) blended with the item's local score; **demote, never drop**: a paper with an explicit mismatch
   (`sense_match = different_sense`, `core_vs_background = background` with high confidence) is left out of the ordered
   list, so `applyRerankOrder` (`tier2-rerank.ts:30-58`) puts it behind the ordered ones; `unknown` answers stay neutral
   (`combine.ts:21-22,63`), as the plan requires ("insufficient information is kept, not thrown away",
   `docs/JEV-RETRIEVAL-PLAN.zh-CN.md:145`). About 80 lines plus tests.
3. `pipeline.ts`: replace the `onFreshShortlist` fire-and-forget (:936-948) with an **awaited** `jevScreen(shortlist)`
   wrapped in try/catch; write the result into `aiOrder`, so the cached pool, `getOrBuildCachedPool` (:1919-1930) and the
   read-time replay `applyRerankOrder(tier1Ranked, pool.aiOrder, pool.aiReasons)` (:2066) work **unchanged**. If the reader
   also has a model key, still call `applyTier2Rerank` on the Jev-ordered list but keep Jev's `orderedIds` and Tier-2's
   `reasons` (3 lines): no regression for readers with both keys. Jev ordering is used only when it answered at least
   60% of the shortlist; otherwise today's path.
4. `pool-cache.ts`: the optional `jevScreening` key field above.
5. `route.ts`: the closure (2.3), `maxDuration` pinned (the readiness doc recommends it, `docs/JEV-RELEASE-READINESS.md:598,773`),
   and `meta.jevScreening` (below).
6. `FeedMeta` (`feed/types.ts`): optional `jevScreening?: { status: "applied" | "partial" | "unavailable" | "rejected";
   screened: number; of: number }`, present only when a key was sent, so a bad or rejected key is visible in the Profile
   row instead of silently ignored.

The strength of the effect is bounded by `applyRerankOrder`: ordered ids first, boost `0.12 - index*0.002` on a [0,1]
score, the same influence Tier-2 has today. That is a deliberately conservative first setting.

Latency: the call moves into the request. 50 candidates, concurrency 4, 4 live samples at 174-668 ms
(`JEV-SMOKE-A`) puts a typical run at a few seconds, but the worst case is 15 s x 3 attempts + 2 s of backoff per call
(`jev-client.ts:31-36`) and `DEFAULT_DEADLINE_MS = 45_000` is checked only between candidates (`shadow.ts:80,422`). So a
hard race deadline (suggest 20 s) with partial results is part of the change; the feed route sets no `maxDuration` today
and `apiFetch` has no client timeout (`store/feed.ts:573`). For comparison Tier-2 is already an awaited LLM call inside
the same request (`pipeline.ts:959-963`).

Where it cannot reach: the cron-built paths run at tier 0 with no key (browser-only secret): `jobs/dispatch-digests`
(email) and `jobs/prepare-dashboards` never use Jev, and a prepared batch is served unchanged on the reader's first visit
(`docs/JEV-RELEASE-READINESS.md:1169`, P8). With `PEER_DASHBOARD_LEDGER=on` the first request of the day mints and freezes
the day's batch (`route.ts:272-350`), so a key added after that takes effect the next day. The copy says "your next
briefing".

Larger alternative, not recommended: read decisions from `private_decisions` at read time and blend per request. That
needs a new pool field, a Supabase read per candidate per request, and a replay rule; it buys nothing the `aiOrder` path
does not.

---------------------------------------------------------------------------------------------------

## 3. "How much better"

### 3.1 Every Jev-related number in the repository

| Number | Source | What it measured | Supports "N% better"? |
|---|---|---|---|
| 4 of 4 calls `status: "ok"` (contract-valid), latency 668 / 175 / 174 / 247 ms, model `jev-1.13.0` on every call | `docs/jev-abc/JEV-SMOKE-A-20260928T023832Z.md` (run once, 2026-09-28, synthetic inputs, ceiling 10) | the direct transport works and the response validates | No. Not a quality measurement. The runner records no answers and no token counts (the doc says so) |
| worst-case spend bound about $0.0054 for those 4 calls | same | an upper bound from the 32k request ceiling, not a measured cost | No |
| $0.042 per million input tokens, output free; 1,200 requests/minute; 64k context with 32k for state + longest question; "English is primary/best-accuracy; other languages including CJK are handled but not equally well" | `docs/jev-abc/P3-B-20260924T0525Z.md` JEV CONTRACT table (docs.typesafe.ai, fetched 2026-09-24) | vendor documentation | No. Price, limits and a language caveat, not accuracy |
| $0.95-1.58 per month for 10 readers; 40% fewer Jev calls with 20 of 50 cached | `docs/JEV-RETRIEVAL-PLAN.zh-CN.md:151-165` | arithmetic on the vendor price, assuming 50 papers a day, 30 days, 1,500-2,500 tokens a paper, no cache; the doc says "不是实际测量结果" (not a measurement) and "不能现在保证比旧系统节省某个百分比" | No: cost, not quality, and an estimate |
| confidences 0.86, 0.79, 0.81, ... | `decisions/__fixtures__/jev-happy-path-response.json` | a hand-written test fixture | No. Do not quote |
| "No cost number, no accuracy number, and no speed number for the product itself is a measurement yet"; "No fabricated uplift or savings number was found anywhere" (item 18) | `docs/JEV-RELEASE-READINESS.md:327-330,1173` | the repository's own audit statement | the opposite: it says none exists |
| s2-keyword 15/15 = 1.000, openalex-keyword 14/18, openalex-semantic 12/14, topic 6/7 relevant in the judged set; 32 of 40 sampled papers labelled relevant | `docs/jev-abc/LIVE-EVAL-4-LABELS-A-20260928T024806Z.md` | **retrieval channels**, labelled by the owner on 2026-09-27; Jev not involved | No. Not about Jev. Useful only because it shows labelled data and the instruments exist |
| 4/27 -> 17/27 qualifying with the tag-anchored floors | `scoring/combine.ts:30-40`, `docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md` | the **non-Jev** required-tag gate | No. It is a baseline fact: the local screening has been tuned on real pools, so Jev's marginal gain over it is exactly what is unmeasured |

### 3.2 Verdict

**None of them supports "with a Jev key the screening is N% better", or even "better".** The repository's own binding rule
(`ABC-JEV-INTEGRATION.md:94`) and its readiness audit say the same. The owner's 2026-10-06 request ("much better and how
much") conflicts with that rule; the owner may change the rule, but a number cannot be written until it is measured, and
an estimate from vendor pricing or a fixture is not a measurement.

### 3.3 The sentence the copy can honestly carry now

> A Jev key adds a second pass. For each of the 50 best candidates Jev answers up to four fixed questions about the paper
> and Peer moves papers up or down on the answers: the part of screening that reads what a paper is about, not which words
> it contains. We have not measured how much better the result is, so we state no number.

Mechanism and honesty, no adjective that implies a size. Put the claim in one place so it can change with evidence:
`decisions/jev-claim.ts` exports `JEV_MEASURED_GAIN: null | { papers: number; projects: number; metric: "ndcg@10" |
"precision@10"; without: number; with: number; ciLow: number; ciHigh: number; reportPath: string }` and
`jevGainSentence()`. While it is `null` the sentence above renders; when filled it renders "In our test of {papers}
papers across {projects} projects, the top ten held {with} relevant papers with Jev against {without} without (95%
interval {ciLow} to {ciHigh})." A test pins both branches and forbids a number in the null branch. Never invent the
fill: it must come from the report in section 3.4.

### 3.4 One small evaluation that would earn a number (J7)

* **Question:** with the same candidates, does the shipped Jev ordering put more relevant papers in the top 10 than the shipped
  non-Jev ordering?
* **Inputs:** the saved candidate lists (`rankedForJudgment`, top 30-50) of 4 real projects (the owner's, plus 3 of the HR /
  statistics / materials cases the plan names, `docs/JEV-RELEASE-READINESS.md:1070-1090`), about 100-150 (project, paper)
  pairs. Freeze them as JSON; no re-fetching.
* **Arms:** A = the shipped non-Jev order; B = A + `jevOrderedIds` exactly as shipped. Blend weights and the 60% coverage
  rule fixed **before** labelling; tune on one project, measure on the other three (disjoint by project, as the readiness
  doc requires).
* **Labels:** the owner (a second labeller if available) grades 0/1/2 on a blinded sheet with the arm hidden and the pairs
  shuffled: `evaluation/live-channels/blinded-sheet.ts` (`buildBlindedSheet` :100, `ingestLabels` :176). Ground truth is
  never produced by Jev.
* **Metrics:** `precisionAtK`, `ndcgAtK`, `bootstrapInterval`, `perProjectBreakdown` (`evaluation/metrics.ts:55,173,264,363`),
  paired difference B minus A per project with a 95% interval and the sample counts; plus relevant papers pushed **out** of
  the top 10 (the harm count), unknown rate, p50/p95 latency, and `usage.input_tokens` per call (the smoke runner dropped
  it; add it) so the cost sentence is measured too.
* **Cost and effort:** about 150 Jev calls, roughly one cent at the published price; an hour or two of labelling. The 40
  existing owner labels (`web/output/live-eval/20260925T055826Z/`, gitignored, on the owner's machine) are retrieval labels
  for synthetic starter profiles and are too few and too skewed (32 of 40 relevant) to decide this alone.
* **Decision rule, written down first:** publish a number only if the 95% interval of the paired difference excludes zero;
  otherwise the copy keeps the "not measured" sentence or says "no measurable difference in our test".
* **Existing harness to extend:** `evaluation/jev-smoke/runner.ts` (calls `callJevDirect`, writes `output/jev-smoke/<ts>/`,
  ceiling 10: lift for the eval) with `JEV_SMOKE_API_KEY` (2.3).

---------------------------------------------------------------------------------------------------

## 4. Plan for C3 (one item on `remove-paid-tier-restore-byok`, after C1 and C2)

### 4.1 Decisions the owner must take (the implementer cannot)

* **D1. Where the reader applies for a Jev key.** The repo knows only `api.typesafe.ai` and `docs.typesafe.ai`; the sandbox
  blocks `docs.typesafe.ai` (checked), so I could not verify a sign-up path. The link target in `jev-setup.tsx` is a
  constant the owner supplies; until then link the docs host.
* **D2. The claim.** Ship the "not measured" sentence (3.3) and earn a number via J7, or run J7 before J4 so the copy can carry it.
  Recommended: J4 with the null branch now, J7 right after, then fill the constant.
* **D3. Both keys.** Recommended: Jev owns the order, the reader's model key still writes the reasons (2.5 point 3).
* **D4. Caps.** Recommended: delete both daily counts (company budget concepts) and rely on the hourly limit + 50 per build +
  stop-on-401. Alternative: keep a per-reader daily count (say 300 calls) as a wallet guard; costs a counter key and a test.
* **D5. Kill switch.** Recommended: none (the key is the switch; degradation is built in; revert is a deploy). Alternative:
  `PEER_JEV_SCREENING=off`.
* **D6. Backup file.** Whether the profile export should strip `jevApiKey` (and, while there, `feedAiApiKey`).
* **D7.** Jev independent of the feed's "AI search" pill (recommended), or ANDed like the model key.

### 4.2 Ordered commits (each its own commit with a pathspec, gates after each)

Gates per commit: `npx tsc --noEmit`, `npm run lint` (warnings never above the C2 count), `npx vitest run <touched>`; full
`TZ=America/Chicago npm test` after J2, J3 and J6; `VERCEL=1 node scripts/assert-byok-production-env.mjs` with a dummy
`JEV_API_KEY` (must exit 1, print the name, not the value) and without. One mutation of your own per commit from J2 on,
restored byte-identical (sha256). Re-read `route.ts`, `ai-request.ts` and `assert-byok-production-env.mjs` at the start:
C1/N4 and N6 have already moved the lines quoted here.

| # | Commit | Files | Tests: add / rewrite / delete |
|---|---|---|---|
| **J0** | `docs(handoff): Jev as a reader's key` | `docs/handoff/byok-only/JEV-PLAN.md` (this file + decisions D1-D7); banner "SUPERSEDED 2026-10-06 - Jev runs on the reader's own key; see docs/handoff/byok-only/JEV-PLAN.md" on top of `docs/JEV-RELEASE-READINESS.md` and `ABC-JEV-INTEGRATION.md` (do not rewrite) | none |
| **J1** | `feat(profile): a Jev key, kept in the browser` | `types/index.ts` (field + default); `store/profile.ts` (`updateJevApiKey`, interface :206); `components/profile-sync.tsx` (`void jevApiKey`, :172-189); `lib/profile/merge.ts` (`CREDENTIAL_LIKE_FIELDS`, comment "six" -> seven); `store/feed.ts` (`paperFeedRequestBody` adds `jevApiKey` when signed in and non-blank). No UI yet | **add** (tests first): `store/feed-request-body.test.ts` (sent when signed in; absent when signed out, blank or whitespace; never inside `llmOverride`); `profile-sync.test.tsx` (redaction case gains the jev key; the full key-set pin at :139); `merge.test.ts:609` ("all seven", restore never installs it); `store/profile.test.ts` (updater trims, blank -> undefined; a remote profile cannot set it) |
| **J2** | `refactor(jev): the reader's key replaces the company key` | `decisions/jev-direct-client.ts` (`apiKey` option; delete `readJevApiKey`, `jevDirectConfigured`, `entitled`, reservation; move the result type here); `decisions/shadow.ts` (call `callJevDirect({apiKey})`; delete `entitled`, `transport`, `broker*`, `perUserCap`, `globalCap`, `store`, the Gemini fallback and its `source` tag; keep everything else so its tests stay as history); delete `broker-client`, `jev-dispatch`, `flag`, `gemini-fallback`, `security/jev-broker-auth`, `supabase/functions/jev-broker/*` (+ tsconfig/eslint excludes); `app/api/feed/route.ts` (delete the hook, helpers, gate, imports; the **route calls Jev nowhere** after this commit, so this is a valid stopping point: no company key, no Jev); `.env.example` Jev group; `scripts/assert-byok-production-env.mjs` (ban `JEV_API_KEY`, `PEER_JEV_BROKER_SECRET`; rewrite comment 66-77); `vitest.setup.ts` (+`JEV_API_KEY`), `vitest.env-allowlist.ts`, `evaluation/jev-smoke/{gate,runner}.ts`, `vitest.jev-smoke.config.ts` (rename `JEV_SMOKE_API_KEY`) | **delete** (subject deleted): `broker-client` 26, `broker-counter-keys` 8, `broker-parity` 5, `flag` 38, `gemini-fallback` 23, `jev-dispatch` 8. **rewrite** (premise changed by the owner, say so in the checkpoint): `jev-direct-client.test.ts` (28: keep the leak cases, the fault table and "never throws"; drop env/entitled/reservation cases), `shadow.test.ts` (35: keep cache hit/miss, deadline, concurrency clamp, never-throws, status counts; drop broker and fallback cases), `assert-byok-production-env.test.ts:289-305` (the two "JEV_API_KEY allowed and silent" cases become "fails and prints the name, never the value"), `spend-scans.test.ts` scan 7 (no reader at all), `test-support/env-isolation.test.ts:180-232` (new name), `app/api/feed/route.test.ts:1606-1827` (the "Jev shadow wiring" block: 8 `it` + a 7-row `it.each`, the end of the file -> "the route never schedules Jev with no key": absent hook, response identical), `lib/llm/usage-log.test.ts` (unchanged unless it names the env). **add**: `registry.test.ts`-style case: with a dummy `JEV_API_KEY` in the environment `callJevDirect` still returns `network_error` for a blank `apiKey` and never reads it |
| **J3** | `feat(feed): Jev decisions reorder the reader's papers` | `decisions/shadow.ts` -> `screen.ts` (`git mv`; return decisions, race deadline 20 s, stop on first `unauthorized`, 3 consecutive 429/529); new `decisions/apply.ts`; `lib/feed/pipeline.ts` (replace `onFreshShortlist` with awaited `jevScreen`, write `aiOrder`, compose with Tier-2 as in 2.5, coverage rule); `lib/opportunities/pool-cache.ts` (optional `jevScreening` in the key); `lib/feed/types.ts` (`FeedMeta.jevScreening`); `app/api/feed/route.ts` (`parseJevApiKey`, the closure, `export const maxDuration`, `meta`); `combine.ts` unchanged (now live) | **tests first**: `apply.test.ts` (mismatch is demoted not dropped; `unknown` is neutral; deterministic; a paper with no decision keeps its place); `screen.test.ts` (partial results at the deadline; 401 stops after one call; cache hits return their decision); `pipeline.jev.test.ts` (Jev order lands in `aiOrder`; cache hit replays it with no call; no key -> byte-identical pool and response; Jev failure -> Tier-1/Tier-2 result, no throw; both keys -> Jev order + Tier-2 reasons); `pool-cache.test.ts` (key unchanged when `jevScreening` is absent: pin an existing key; changes when true); `route.test.ts` (sign-in required; owner mismatch -> no hook; the key never appears in the pool-cache `set` payload, the ledger `prepareBatch` args, the rollover upsert, the response body or any console spy: use a sentinel). **rewrite** `pipeline.shadow.test.ts` (6), the `onFreshShortlist` assertions in `dispatch-digests/route.test.ts`, `test-digest/route.test.ts`, `paper-daily-cache.test.ts:419`, `pipeline.rrf.test.ts:280` (rename; cron paths still pass no Jev). Mutation: change the coverage rule or drop the demotion and see the order test fail |
| **J4** | `copy: paper screening with your own Jev key` | new `components/profile/jev-setup.tsx` (`JevKeyField`: `SecretInput`, status dot, helper line, link button; copy of `connector-panel.tsx:58-110`); `app/profile/page.tsx` (new `EditRow label="Paper screening"` after the "AI provider" row, :2092-2107); `app/welcome/page.tsx` (a block under the model-key fields in the `ai` step, :448-470; **no new wizard step**, `STEP_META` and `isStepDone("ai")` unchanged); `app/privacy/page.tsx` (4.3); `lib/decisions/jev-claim.ts`; `web/public/CHANGELOG.md` entry | `jev-claim.test.ts`; `profile/page.test.tsx` and welcome tests where they pin copy; privacy copy pinned by a test that also asserts "written from the code" claims (key in browser, not synced); `ui-vocabulary.test.ts` stays green (no "Tier N", no "BYOK"; "Jev" and "key" only); a component test that the field never renders the key in the DOM text and uses `type=password` via `SecretInput` |
| **J5** | `feat(feed): say what Jev did` (optional, small) | render `meta.jevScreening` in the Profile row (one line; none when no key) | one test per status |
| **J6** | `test: Jev final sweep` | grep gate (4.5); docs banners done in J0; remove stale references (`docs/handoff/SUPABASE-MIGRATION-HANDOFF.md` if it lists the function) | full `npm test`; `git grep` gate |
| **J7** | `feat(evaluation): paired Jev screening eval` (can follow the PR) | `evaluation/jev-smoke/` extended or a sibling `jev-eval/` (3.4); record `usage.input_tokens`; `docs/handoff/byok-only/JEV-EVAL.md` report; then fill `JEV_MEASURED_GAIN` | harness unit tests with injected fakes; no live call in the default suite |

### 4.3 Copy (exact; no "Tier N", no "BYOK")

**Profile row "Paper screening"** (`app/profile/page.tsx`, after "AI provider"):

> Without a key, Peer screens each day's papers with fixed scoring: your topics, your project text, how new a paper is and
> where it was published. That works with no setup.
>
> A Jev key adds a second pass. For each of the 50 best candidates Jev answers up to four fixed questions about the paper:
> is it the meaning of your word, is it core to your project or only background, does it match your method, would it help
> your project. Peer moves papers up or down on the answers. A paper Jev cannot judge stays where it was. Jev reads English
> best.
>
> We have not measured how much better the result is, so we state no number. *(rendered from `jevGainSentence()`)*
>
> Jev bills your own account for what it reads. At its published price, screening 50 papers a day is an estimated 10 to 16
> US cents a month. *(an estimate; confirm with measured tokens from J7 before keeping the cents)*
>
> Optional. Applies to your next briefing. Peer keeps the key in this browser, never in your account; its server passes the
> key to Jev while it screens your papers and does not store or log it.

Field label "Jev API key", placeholder "Jev API key", link button "Apply for a Jev key" (D1), status when saved "Jev key
saved on this device." and, from J5, "Last briefing: 50 of 50 papers screened by Jev." / "Jev did not answer; this briefing
was screened without it." / "Jev rejected the key."

**Welcome `ai` step block** (under the model-key fields): kicker "Better paper screening (optional)" with the first two
paragraphs above and the field; `AiProviderGuide`'s sentence "Peer stores it only in this browser and sends it only when
calling your selected AI provider" (`ai-setup.tsx:506-509`) stays about the model key.

**/privacy** (`app/privacy/page.tsx`): new section **"Your own Jev key"** after "Your own model key" (lines 42-47):
1. "If you add a Jev key, it stays in your browser and is excluded from everything Peer syncs, the same way as a model
   key. Each time Peer builds your briefing its server passes the key to Jev, and does not store or log it."
2. "Jev, made by TypeSafe, receives the title, abstract and venue of up to 50 candidate papers, together with the project,
   challenge, topics, methods and exclusions you wrote, and bills your own account. Peer keeps Jev's answers for each paper
   against your account (the question, the answer and how sure Jev was), with no paper text and no key, until the account
   is removed."
and one sentence appended to "Who else sees a request" (:59-61): "Jev sees those papers and your project text only if you
add a Jev key yourself." Update "Last changed" (:81).

**/changelog** (`web/public/CHANGELOG.md`): one entry, "Paper screening with your own Jev key"; say plainly that it is
optional and that no improvement has been measured.

### 4.4 Interaction with C1/N4 and C2

* **N4** (`shadowEntitled`): after C1 the line reads the signed-in test (`gate.user !== null` or N4's equivalent) and the
  comments no longer say "paid plan". In J2 that whole gate is deleted, so J2 must start by finding it by symbol
  (`shadowEntitled`, `buildJevShadowHook`), not by line. N4 changes the shape of `gate` (`{ user }`), which J3's condition
  uses (`gate.user?.id === paperCacheScope.ownerId`).
* `entitled: boolean` fields (`broker-client.ts:83`, `jev-direct-client.ts:180`, `jev-dispatch.ts:61`, `shadow.ts:86`,
  `route.ts:499-` `JevShadowHookInput`) all disappear in J2; there is nothing for the plan type to decide.
* **C1/N6** moves `GOOGLE_API_KEY` to FORBIDDEN and edits the same guard file; J2 adds `JEV_API_KEY` and
  `PEER_JEV_BROKER_SECRET` beside it and rewrites only the Jev comment block (lines 66-77).
* **C1/N4** rewrites spend-scans 4-6; J2 touches only scan 7.
* **C2/F1** must keep `logDecisionUsage` and `DecisionUsageLog`; **C2/F2** deletes `usage/company-budget.ts`, the only
  other importer of `isCjkHeavy`, `LATIN_CHARS_PER_TOKEN`, `CJK_CHARS_PER_TOKEN` from `jev-contract.ts` (`company-budget.ts:87`):
  harmless, they stay exported; **C2/F3** trims `usage/counters.ts:111-190` (deep-report and forced-rebuild keys) and
  keeps `breakerTripped`, `endOfUtcDay`, `rateKey`: J2 no longer imports the first two. **C2/F4** may add `jev:%` and
  `jev-edge:%` to its obsolete-counter-row delete (cosmetic).
* The three `.env.example` hunks (C1 5-11, C2 308-324, J2 180-277) do not overlap.

### 4.5 Gate after J6

```
git grep -nE "JEV_API_KEY|PEER_JEV_|jev-broker|resolveJevTransport|jevShadowEnabled|callJevViaBroker|dispatchJevCall|reserveJevCall|geminiFallback" -- web/src web/scripts web/supabase web/.env.example web/vitest*.ts web/tsconfig.json web/eslint.config.mjs
```
returns only: the build guard's ban list, `vitest.setup.ts`'s strip, and the tests that assert both. And
`git grep -n "process.env.JEV" -- web/src` returns nothing (the smoke name is read only through the allow-list file).

### 4.6 Risks, ranked

1. **An unmeasured "much better" on screen.** Certain unless handled: the owner asked for it, the repo has no number, and
   `ABC-JEV-INTEGRATION.md:94` forbids it. Mitigation: 3.3 copy, the claim constant with a null branch pinned by a test, J7
   before any number. Impact: product trust, and a binding rule.
2. **Going live on 4 synthetic calls.** The pipeline has never run against a real reader; the combiner weights
   (`rubric.ts:182-188`) and the blend are unvalidated; `jev-1.13.0` is pinned and a vendor retirement would make every call
   `invalid_response` (model mismatch, `jev-contract.ts` rule 2) and silently fall back. A bad blend would make a reader's
   screening **worse** than the non-Jev one with nothing to show it. Mitigation: demote-only plus the bounded
   `applyRerankOrder` boost, `unknown` neutral, the coverage rule, `meta.jevScreening` (J5), the paired evaluation (J7).
3. **Latency in the request path.** 50 calls inside the feed POST; worst case far above the typical few seconds; no
   `maxDuration`, no client timeout. Mitigation: race deadline with partial use, stop on first 401 and on repeated 429/529,
   pinned `maxDuration`, and a test with a hanging fetch.
4. **The key leaking through a cache.** A new secret in the request body next to `FeedRequest`, the pool cache, the ledger
   payload, the rollover store, `private_decisions`, the backup file (D6) and logs. Mitigation: the closure design (the key
   is never in `FeedRequest`), sentinel tests on every payload, scan 7 turned into "no reader of `JEV_API_KEY`".
5. **Production state the repo cannot show**: `private_decisions` may never have been applied (every build would re-ask Jev
   for all 50, on the reader's key); `JEV_API_KEY` / `PEER_JEV_*` may be set on Vercel (the guard will fail the build, same
   as `GOOGLE_API_KEY` and `TAVILY_API_KEY`); `jev-broker` may be deployed with secrets. Owner checklist: remove those
   variables, `select to_regclass('public.private_decisions')` and apply `20260924000400`, `supabase functions list`.
6. **The frozen and prepared batch.** With `PEER_DASHBOARD_LEDGER=on` the day's batch is minted once and a cron-prepared
   batch is built at tier 0; Jev never touches either. A reader who pastes a key at noon sees no change until tomorrow.
   Copy says "your next briefing"; J5 shows what happened.
7. **A guard flip and test rewrites that look like weakening.** `assert-byok-production-env.test.ts:289-305` asserts the
   opposite of what J2 needs; `shadow.test.ts` (917 lines) and the `route.test.ts` Jev block are rewritten. Mitigation:
   say in the checkpoint that the owner's decision changed the premise, port every case that still holds, one mutation
   per commit.
8. **Cost surprise.** Jev bills the reader; the cents estimate rests on an assumed token count. Worst case from a
   runaway client is about $0.25 an hour (bounded by the 60-per-hour limit). Mitigation: label it an estimate, measure
   tokens in J7, D4.
9. **No developer path to try it locally.** `requireEntitledAiRequest` returns `user: null` in `next dev`, so the
   `gate.user.id === ownerId` condition never holds. Mitigation: unit tests with injected fetch; the smoke runner
   (`JEV_SMOKE_API_KEY`) for a live call; or allow an `InMemoryDecisionCache` when `isLocalDevRuntime()` (small).
10. **Merge with PR #32 and the worker on `main`.** Sequential on one branch, so low; the PR touches `profile/page.tsx`
    and `privacy/page.tsx` that J4 also edits (B-plan section 7).

---------------------------------------------------------------------------------------------------

## 5. Report

`/tmp/claude-0/-home-user-peer/9602921a-6ac5-5952-88ce-8364fcd8f733/scratchpad/byok/B2-jev-plan.md`. **Shadow or live:
shadow only** (runs in `after()`, returns counts, writes a per-reader cache nothing reads; `combine.ts` has no caller; no
live switch exists). Making it live is a medium change (about 6 production files, reusing the Tier-2 `aiOrder` slot and its
replay). **Best measured number: none for the effect**; the only Jev numbers are 4 of 4 synthetic calls contract-valid at
174-668 ms, and a binding repo rule forbids a percentage claim without paired measurements, so the copy carries an honest
"not measured" sentence from a claim constant and a one-day paired evaluation (about 100-150 labelled pairs, about a cent of
Jev) earns the number. **Three biggest risks:** (1) an unmeasured "much better" on screen against a ratified rule; (2)
shipping a live reorder validated only by 4 synthetic calls, with unvalidated blend weights and no way for the reader to see
it work; (3) a synchronous 50-call stage inside the feed request, plus the reader's key crossing request bodies next to
the caches (and unknowns in production: `private_decisions` unapplied, `JEV_API_KEY` on Vercel).
