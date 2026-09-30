# PROFILE-UNSYNCED-FIELDS — B investigation

STATUS: COMPLETE

Investigator: B (read-only on product code). Repo: D:/local files on this PC/Github/Peer/peer
Branch: Jev-integration-and-sorting-filtering-enhancement, HEAD 490d67b3 at start.
Started: 2026-09-30T07:48:50Z. Completed: 2026-09-30T08:2xZ (real clock).

Scope (from the brief): reviewer §1bk.9(c)(d) flagged `deepReportEnabled`,
`preferredJournals` and `softTopics` as having "no server column, so they
never sync." This investigation checked that claim by execution rather than
inheriting it. **Result: the claim is right for two of the three fields and
wrong for the third.** `softTopics` has no *column of its own*, but it does
reach the account — indirectly, through the `feed_intent` JSONB column —
and a real, separate bug (not the one the reviewer named) can make that
indirect path silently drop or delay an edit. Full detail below.

## Method note

All product-function calls below ran the real, unmodified exports from their
real paths, through `<scratchpad>/pusf-hook.mjs` (a copy of
`<scratchpad>/nascii-hook.mjs`, an earlier B investigation's read-only Node
loader hook in this same campaign). The hook needed two additions beyond the
original copy, both logged inline in the hook file itself: (1) bare
`next/<sub>` package specifiers (`next/server`, `next/headers`) — Node's
strict ESM resolver doesn't probe extensions the way `require.resolve` does,
so the hook now points these at the exact real `.js` file on disk, confirmed
via `node -e "require.resolve('next/server')"`; (2) a `load` hook that
type-strips `.tsx` files with `node:module`'s `stripTypeScriptTypes` —
Node's native TS support does not recognize `.tsx` at all, and
`web/src/components/profile-sync.tsx` (this investigation's target) is one.
Read in full before relying on this: that file contains no actual JSX
markup (`ProfileSync()` returns `null`; every other export is a plain
function) — it is TS wearing a `.tsx` extension by project convention — so
type-stripping alone is correct for it, and the hook only applies this to
`.tsx`/`.jsx` so a file with real JSX would still fail loudly rather than
silently mis-load.

Four scripts, all read-only, none touching `web/`:
`<scratchpad>/pusf-roundtrip.mjs`, `<scratchpad>/pusf-staleness.mjs`,
`<scratchpad>/pusf-dirty-shrink.mjs`, `<scratchpad>/pusf-display-regression.mjs`.
Every profile/row/remote value fed into the real functions is a hand-built
CONSTRUCTION for this script (labeled as such inline), using fictional
values only (`construction-*`-prefixed strings, `construction-user-*` ids).
No person's name, real email, or real credential appears anywhere in this
report or the scripts.

**Files this investigation was told not to rely on** (implementer C is
editing them live): `web/src/lib/feed/profile-compiler.ts`,
`web/src/lib/scoring/term-expand.ts`, `web/src/lib/opportunities/pool-cache.ts`.
None of the four scripts imports any of these, directly or transitively —
confirmed by reading every import in `route.ts`, `profile-sync.tsx`,
`merge.ts`, `store/profile.ts`, `lib/feed/intent.ts`, `lib/feed/senses.ts`
(the only modules the scripts touch). `web/src/lib/feed/pipeline.ts` (which
does import `profile-compiler.ts`) was only read, never executed or
imported by any script, for the one fact cited from it below (whether
`selectedSenseConcepts` reaches scoring) — flagged inline where used.

---

## Question 1 — field enumeration and classification

`UserProfile` (`web/src/types/index.ts:415-563`) has **55 fields**. Classified
by running `remoteProfilePayload` (`profile-sync.tsx`), `profilePatchToRow`/
`profileRowToProfile` (`api/profile/route.ts`), and `mergeProfileAtSignIn`
(`lib/profile/merge.ts`) on constructed profiles — see
`<scratchpad>/pusf-roundtrip.mjs`, full PASS output below. Counts cross-check
exactly against the independent audit already in
`docs/jev-abc/PROFILE-SYNC-A-20260930T023227Z.md` (32 column-backed + 15
no-column = 47 non-credential fields; 47 + 8 credential = 55).

| # | Field | Class | Server column | Reaches account how |
|---|---|---|---|---|
| 1 | displayName | a | display_name | direct |
| 2 | researchTopics | a | research_topics | direct (+ GET can echo a stale feedIntent copy — see Q2) |
| 3 | eventRequiredTopics | c | none | none |
| 4 | eventExploreTopics | c | none | none |
| 5 | jobRequiredTopics | c | none | none |
| 6 | jobExploreTopics | c | none | none |
| 7 | activeSearchInputs | c | none | none (doc comment: "Local v1 selection metadata; profile API persistence remains a separate P1 item") |
| 8 | careerStage | a | career_stage | direct |
| 9 | industryVsAcademia | a | industry_vs_academia | direct |
| 10 | locationPreferences | a | location_preferences | direct |
| 11 | authorisedCountries | a | authorised_countries | direct |
| 12 | preferredMethods | a | preferred_methods | direct (+ stale-echo risk, see Q2) |
| 13 | phdYear | a | phd_year | direct |
| 14 | school | a | school | direct |
| 15 | currentProject | a | current_project | direct (+ stale-echo risk, see Q2) |
| 16 | currentChallenges | a | current_challenges | direct (+ stale-echo risk, see Q2) |
| 17 | **selectedSenseConcepts** | **b** | none | **indirect, via `feed_intent.selectedSenseConcepts`** — proved by execution |
| 18 | feedIntent | a | feed_intent | direct (this field IS the jsonb column) |
| 19 | dislikedTopics | a | disliked_topics | direct (+ stale-echo risk, see Q2) |
| 20 | preferenceLedger | a | preference_ledger | direct (own merge rule, unaffected by this item) |
| 21 | **softTopics** | **b** | none | **indirect, via `feed_intent.preferredConcepts`** — proved by execution |
| 22 | preferredJournals | c | none | none (not part of `NormalizedFeedIntent` either — proved by execution) |
| 23 | feedFocus | a | feed_focus | direct |
| 24 | feedFreshness | a | feed_freshness | direct |
| 25 | paperCount | a | paper_count | direct |
| 26 | feedSourceMix | a | feed_source_mix | direct |
| 27 | feedImportance | a | feed_importance | direct |
| 28 | feedMethodMode | a | feed_method_mode | direct |
| 29 | feedDiscoveryMode | a | feed_discovery_mode | direct |
| 30 | feedAvoidReviews | a | feed_avoid_reviews | direct |
| 31 | feedAvoidOldPapers | a | feed_avoid_old_papers | direct |
| 32 | feedAvoidBroadSurveys | a | feed_avoid_broad_surveys | direct |
| 33 | advisorName | a | lab (legacy name) | direct |
| 34 | advisorAuthorId | e | none | device-only by design — doc comment: "Confirmed once, then permanent. Local-only." |
| 35 | advisorAuthorLabel | e | none | device-only by design — doc comment: "Local-only." |
| 36 | advisorSeedWorkIds | e | none | device-only by design — doc comment: "Local-only." |
| 37 | advisorSeedTexts | e | none | device-only by design — doc comment: "Local-only." |
| 38 | advisorSeedsRefreshedAt | e | none | device-only by design — doc comment: "Local-only." |
| 39 | digestEnabled | a | digest_enabled | direct |
| 40 | digestHourLocal | a | digest_hour_local | direct |
| 41 | digestTimezone | a | digest_timezone | direct |
| 42 | digestChannel | a | digest_channel | direct |
| 43 | digestFrequency | a | digest_frequency | direct |
| 44 | digestEmail | a | digest_email | direct (extra confirm-email guard in the PUT handler) |
| 45 | tavilyEnabled | d | none | never leaves device (bundled with the BYOK credential strip) |
| 46 | tavilyApiKey | d | none | credential, stripped before every push |
| 47 | adzunaAppId | d | none | credential, stripped |
| 48 | adzunaAppKey | d | none | credential, stripped |
| 49 | usajobsApiKey | d | none | credential, stripped |
| 50 | usajobsUserAgent | d | none | never leaves device (bundled with the credential strip) |
| 51 | feedAiProvider | d | none | never leaves device (bundled with the credential strip) |
| 52 | feedAiApiKey | d | none | credential, stripped |
| 53 | **deepReportEnabled** | **c** | none | **none** — not part of `NormalizedFeedIntent` either, proved by execution |
| 54 | colorTheme | a | color_theme | direct |
| 55 | onboardedAt | e | none | device-only by design — doc comment: "Local-only for now... NOT synced to the Supabase profile row... clearing localStorage fully resets it, which keeps local dev testing simple." |

Totals: (a) 32, (b) 2, (c) 7, (d) 8, (e) 6 = 55.

### Proof — the counter-lead is correct for softTopics (and also true, separately, for selectedSenseConcepts)

`<scratchpad>/pusf-roundtrip.mjs`, run through the hook, all assertions PASS:

1. **Device A pushes**: `remoteProfilePayload({...defaultProfile, softTopics:["construction-topic-battery-recycling","construction-topic-solid-electrolyte"], selectedSenseConcepts:[selectedSenseConcept("materials.scanning_electron_microscopy")]})` → the push payload's `feedIntent.preferredConcepts` equals A's live `softTopics` exactly, and `feedIntent.selectedSenseConcepts` carries the real sense object.
2. **Server**: `profilePatchToRow(payload, "construction-user-a")` → the row has **no** `soft_topics` or `selected_sense_concepts` key at all, but `row.feed_intent.preferredConcepts` equals A's `softTopics`. This is the only place either value is actually persisted.
3. **Device B (fresh) pulls**: `profileRowToProfile(storedRow)` → `remote.softTopics` equals A's original list, `remote.selectedSenseConcepts` carries the sense id back — derived entirely from `feed_intent`, never from a dedicated column (there isn't one).
4. **Device B's real sign-in merge**: `mergeProfileAtSignIn({...defaultProfile}, remote, null)` → `patch.softTopics` equals A's list. A's Explore topics really do reach a second, brand-new device.
5. **Contrast**: the identical pipeline run with `preferredJournals`/`deepReportEnabled` instead shows `feedIntent` never carries either key (there is no field for them in `NormalizedFeedIntent` at all — `web/src/lib/feed/intent.ts`'s interface has `project/challenge/requiredConcepts/preferredConcepts/exclusions/methods/selectedSenseConcepts` only), and neither survives a push/pull round trip in any form.

One construction note logged for the manager: my first attempt hand-built the
`selectedSenseConcepts` fixture as a free-form object and it silently
invalidated the *entire* feed-intent card (`parseSelectedSenseConcept`
rejects anything outside a closed, provenance-stamped 5-id catalog in
`web/src/lib/feed/senses.ts`) — masking the softTopics result too, since one
bad field fails the whole card. Fixed by using the real exported
`selectedSenseConcept(...)` factory instead of a hand literal. Recorded here
because it is itself a small, real finding: a hand-rolled `feedIntent` patch
anywhere in this codebase (a backup-restore file, a future admin tool) that
gets one field wrong quietly discards every other field in the same card too.

### (b)/(c) fields — label, screen, server-job read, second-computer behavior

| Field | UI label (verbatim) | Screen | Server jobs read it? | Second computer shows today |
|---|---|---|---|---|
| softTopics | "Explore" | Profile page — "Signals" summary (`page.tsx:452`) and the Required/Explore topic editor (`page.tsx:~1876-1880`) | **Yes** — `digestFeedRequestFromProfile` (`dispatch-digests/route.ts:335-360`, mirrored in `test-digest/route.ts:93-108`) reads `intent.preferredConcepts` into the request the daily email's feed is built from | Correct **most of the time** (the indirect path is live — see below) but can lag or silently drop a same-session edit; see Q2 |
| selectedSenseConcepts | none — no UI label exists | none — no screen | Mechanically yes (`lib/feed/pipeline.ts:1396` reads `req.intent?.selectedSenseConcepts`, read-only citation, not executed by this investigation), but moot: see below | Always empty, on every computer — nothing ever sets it |
| preferredJournals | "Preferred journals" (edit) / "Journals" (summary chip) | Profile page ("Paper radar" section, `page.tsx:2020-2035` and `:453`); also onboarding (`welcome/page.tsx:407`) | **No** — zero matches for `preferredJournals` in `dispatch-digests/route.ts` or `test-digest/route.ts` | Empty — this setting never left the device it was set on |
| deepReportEnabled | "Deep report" | Profile page only (`page.tsx:2103-2127`, toggle `aria-label="Deep report"`) | **No** — zero matches in either digest route | Off (the default) — never left the device it was set on |
| eventRequiredTopics / eventExploreTopics / jobRequiredTopics / jobExploreTopics | none — no UI label exists on the Profile page | none on Profile page; only internal plumbing (`store/profile.ts`'s `promoteSearchInputs`, `welcome/topic-mirroring.ts`) | No | N/A — nothing to show; vestigial from the pre-"papers-only pivot" events/jobs UI |
| activeSearchInputs | none — no UI label; it is a derived internal snapshot, not a setting | none | No | N/A |

Search scope for the "no UI"/"no setter" claims above: `Grep` for each field
name (exact identifier) across `web/src/**/*.tsx` and `web/src/**/*.ts`,
excluding nothing (all matches read, not just a sample). For
`selectedSenseConcepts` specifically: confirmed **zero** production
(non-test) `.tsx` usages anywhere, and confirmed **zero** setter for it in
`store/profile.ts` (searched the whole `ProfileState` interface and its
implementation) — the only production writes are `profileRowToProfile`
(reads it FROM the account) and `remoteProfilePayload`/`profileFeedIntentCard`
(compute it FOR a push); nothing in this codebase today ever gives a live
profile a first value for it.

### The live-database question this classification depends on

`softTopics`'s (b) classification is only true in practice if the
`feed_intent` column actually exists in the database the deployed app talks
to — the migration that adds it
(`web/supabase/migrations/20260922010000_profile_feed_intent.sql`) is
authored in the repo but is not something any agent in this campaign may
apply. Read `ABC-JEV-INTEGRATION.md`'s own log (not executed, no network):
at 2026-09-28T04:25Z the user reported running "the 3-line feed_intent SQL
in the Supabase SQL Editor," and the very next dev-server log line shows
`PUT /api/profile` going from 409 (missing column) to 200 immediately after
— and no later entry in the log reverses this. The most recent related
material (§1bk, dated 2026-09-29T22:2xZ, and the PROFILE-SYNC-A review,
dated 2026-09-30T02:32:27Z — today) discuss `feed_intent` throughout with no
"column missing" caveat anywhere. Stated as: confirmed by reading the
project's own log, not independently verified (I never touched Supabase).

---

## Question 2 — does the indirect path survive the §1bk dirty-field rules?

Two separate questions, both answered by execution, with two different
answers:

### 2a. Can a fresh or stale device SHRINK the account's softTopics via the reconcile push? No — refuted.

`<scratchpad>/pusf-dirty-shrink.mjs`, run through `planReconcile`
(`profile-sync.tsx` — the actual function the real sign-in reconcile calls),
all PASS:

- **Literal brief scenario** — fresh device (`softTopics: []`, never
  synced) signs in against an account holding two real softTopics:
  `plan.merged.softTopics` adopts both (union, remote first); the PUSH
  payload's `feedIntent.preferredConcepts` is the two-item list, **not
  `[]`**. The fresh device's empty Explore list never overwrites the
  account's real one.
- **Stale device** (synced before with an older, shorter softTopics list,
  untouched since) reloads after a *different* device added a topic to the
  account: the stale device's own reconcile push still carries **both**
  topics forward — it does not roll the account back to what this device
  last saw.
- **Mechanism, made visible**: a no-op reload's push payload drops the
  flat `softTopics` key (`listUnionChanged` correctly sees nothing new) but
  **keeps** `feedIntent` in the payload regardless — confirming the real
  protection here is the union happening *before* `feedIntent` gets
  recomputed, not `reconcilePushPayload`'s own filter (which, by
  `profile-sync.tsx`'s own doc comment, deliberately never filters
  `feedIntent` — it "inherits safety" from the already-safe fields it is
  computed from, at the moment it's computed).

### 2b. Can an *already-synced* device silently lose or delay a real edit to softTopics? Yes — confirmed, a real bug, separate from the reviewer's.

The safety in 2a depends entirely on `feedIntent` being recomputed **fresh**
from the live profile at push time. It is not, whenever the profile's own
`feedIntent` field already holds a value: `profileFeedIntentCard`
(`lib/feed/intent.ts:239-244`) re-validates the *existing* `feedIntent`
instead of recomputing it from `softTopics` etc. Reading `store/profile.ts`
in full turned up the one production path that installs a defined
`feedIntent` outside the sign-in reconcile: `hydrateFromRemote`
(`store/profile.ts:726-776`), called from exactly one place —
`web/src/app/profile/page.tsx:1677`, inside the digest-email
confirmation-link redirect handler. No `update*` setter (`updateSoftTopics`
included) ever clears `feedIntent` back to `undefined`.

`<scratchpad>/pusf-staleness.mjs`, run through the real
`useProfileStore`/`remoteProfilePayload`/`profilePatchToRow`, all PASS:

- **Control** (no `hydrateFromRemote` this session): `updateSoftTopics(["construction-control-topic"])` then `remoteProfilePayload` → the push's `feedIntent.preferredConcepts` correctly shows the new topic. Works as expected.
- **Bug, addition**: `hydrateFromRemote({softTopics:["construction-old-topic"], feedIntent:{...preferredConcepts:["construction-old-topic"]}})` (simulating the email-confirm redirect), then `updateSoftTopics(["construction-old-topic","construction-brand-new-topic"])` (the reader adds an Explore topic on the same page load) → the local profile correctly holds both topics, but the push's `feedIntent.preferredConcepts` **still shows only the old one** — confirmed all the way through `profilePatchToRow`, i.e. this is what would actually reach the stored row. The new topic never reaches the account this session.
- **Bug, removal (the sharper case)**: same setup, then `updateSoftTopics([])` (the reader removes their only Explore topic) → the push still carries the OLD topic; the removal never reaches the account at all this session.
- **Self-heal check**: does the reader's own next full reload fix it? Ran the real `mergeProfileAtSignIn` against local (topic removed) + remote (still stale, holding the old topic). Result: **union resurrects the "removed" topic** (`patch.softTopics` comes back with the old topic present) — list union only ever adds, so a removal made during the stale window is not just delayed, it can come back after the reader thought they'd deleted it.
- **Related finding, same root cause, on a field that DOES have its own column**: `<scratchpad>/pusf-display-regression.mjs` reran the same staleness setup on `researchTopics` (which has a real `research_topics` column). The column itself gets the correct, live value — `profilePatchToRow`'s row shows the fresh topic list. But `profileRowToProfile`'s GET always prefers the `feedIntent` snapshot's copy over the raw column whenever a `feedIntent` value exists at all (`currentProject`, `currentChallenges`, `preferredMethods`, `dislikedTopics` read the same way — five (a)-classified fields share this exposure). So the very next GET (this device or another) hands back the **stale** topic list even though the column underneath is already correct. This self-heals the moment any full sign-in reconcile runs (which always resets `feedIntent` to `undefined` and forces a fresh recompute — confirmed by reading `mergeProfileAtSignIn`'s `touchedIntentInputs` logic, which fires on every reconcile that has a remote row at all), so it is a transient display glitch for the five column-backed fields, but it is a real, user-visible "my topic disappeared and came back" moment, and it shares one root cause with the softTopics data-loss bug above.

**This is a different bug from the one §1bk.9(c)(d) flagged.** The
reviewer's finding was "no column, so it never syncs" (Question 1's answer:
wrong for softTopics). This investigation's finding is "the indirect path
that *does* exist can go stale mid-session and silently drop or delay a
real edit" — true regardless of whether a future migration ever gives
softTopics its own column, because the same `feedIntent`-staleness
mechanism would still exist for `project`/`challenge`/`selectedSenseConcepts`
(the parts of `feedIntent` that have no alternate column at all).

POLICY — flagged for the manager, not decided here: whether this staleness
bug is fixed inside this item or spun out as its own follow-up (its root
cause and fix are unrelated to any migration), and which fix shape:
(a) every intent-input setter (`updateSoftTopics`, `updateTopics`,
`updateCurrentProject`, `updateCurrentChallenges`, `updateMethods`, and
`dislikedTopics`'s setter) also sets `feedIntent: undefined` in the same
`set()` call — the same invalidation `mergeProfileAtSignIn`/
`mergeProfileFromBackup` already do via `touchedIntentInputs`, just moved to
the setters; or (b) `hydrateFromRemote` stops installing a defined
`feedIntent` at all (always leave it `undefined` so the next push always
recomputes fresh) — simpler, but loses the `explicit-empty` vs `omitted`
presence distinction for `project`/`challenge` on whatever `hydrateFromRemote`
installs; or (c) something else. B does not design the fix.

---

## Question 3 — sync route recommendation per field, with SQL

Two real migrations already establish the exact, idempotent pattern this
codebase uses for adding a `profiles` column
(`web/supabase/migrations/20260922010000_profile_feed_intent.sql` and
`.../20260904000200_profile_plan.sql`), and why the grant lines are not
optional: `profile_plan.sql` did
`revoke update, insert on public.profiles from anon, authenticated;` and
then dynamically re-granted every column that existed *at that time* —
meaning **any column added by a later migration is unwritable by a signed-in
user until that migration also grants it explicitly**. `profile_feed_intent.sql`
had to do exactly this for `feed_intent`; the same migration file's own
comment states the consequence in so many words: "a future profiles column
that a user may edit needs its own `grant update (col), insert (col) on
public.profiles to authenticated;`" I confirmed this is the live pattern by
reading `web/supabase/schema.sql`'s RLS section directly (lines 37-56):
three policies, all row-scoped (`auth.uid() = user_id`), with no per-column
predicate — so **RLS itself is unaffected by adding a column, automatically,
every time**; only the separate column-grant layer needs a new line.

### softTopics — recommend (i), no migration; the column already effectively exists

It already reaches the account through `feed_intent`, confirmed live in Q1.
No SQL needed. The real gap is the staleness bug in Q2, which is a code fix,
not a schema change — POLICY item above.

### selectedSenseConcepts — recommend (i)/no action right now

Mechanically identical to softTopics, but nothing in the shipped app ever
gives it a value today, so there is nothing to fix. Worth one line for the
manager: whenever a "Sense" disambiguation UI is built, it will inherit
Q2's staleness bug on day one unless that bug is fixed first.

### preferredJournals — recommend (ii), new column

No existing jsonb column is a safe home for it: `feed_intent`'s parser
(`normalizePersistedFeedIntent`) rejects any payload with a key outside its
fixed set (`hasOnlyKeys` check, confirmed by reading), so silently stuffing
`preferredJournals` into it would break every existing feed-intent read;
`preference_ledger` is a different, unrelated concept. `merge.ts` needs
**zero changes** — `preferredJournals` is already listed in `LIST_FIELDS`
(confirmed by reading `merge.ts:56-64`), i.e. the union-merge safety rule
already covers it; it has simply never had a column to union *into*. Only
`route.ts` needs a mapping, plus the migration:

```sql
-- New column: preferred_journals (PROFILE-UNSYNCED-FIELDS)
-- Idempotent; safe to re-run.
alter table public.profiles
  add column if not exists preferred_journals text[] not null default '{}';

comment on column public.profiles.preferred_journals is
  'Journals the user prefers as a primary source; boosts a matching paper''s relevance score (+1/3).';

-- Required: profile_plan.sql revoked table-level write and re-granted only
-- the columns that existed at that time. Without these two lines this new
-- column would exist but be silently unwritable by any signed-in user.
grant update (preferred_journals) on public.profiles to authenticated;
grant insert (preferred_journals) on public.profiles to authenticated;
```

RLS impact: none — the three existing row policies cover every column,
including this new one, automatically (confirmed above).

### deepReportEnabled — recommend (ii), new column, with an ordering requirement

Same reasoning against reusing `feed_intent` (it has no field for this at
all, and the parser would reject an extra key). Unlike `preferredJournals`,
this field is **not** currently in `SINGLE_VALUE_FIELDS`
(`merge.ts:90-117`) — it must be added there in the *same* change that adds
the column, or there is a window where it is a real, writable column that
still gets pushed unconditionally on every load (`remoteProfilePayload`
carries it whenever present; nothing filters it until it's in
`SINGLE_VALUE_FIELDS`) — reproducing, for this one field, exactly the bug
§1bk's AMENDMENT already fixed for the 11 feed knobs. Flagging this
prominently because it is an easy sequencing mistake, not a policy question.

```sql
-- New column: deep_report_enabled (PROFILE-UNSYNCED-FIELDS)
-- Idempotent; safe to re-run.
alter table public.profiles
  add column if not exists deep_report_enabled boolean not null default false;

comment on column public.profiles.deep_report_enabled is
  'Per-user toggle: full HTML/PDF fetch + two-pass LLM paper analysis vs the abstract-only report.';

grant update (deep_report_enabled) on public.profiles to authenticated;
grant insert (deep_report_enabled) on public.profiles to authenticated;
```

RLS impact: none, same reasoning as above.

### eventRequiredTopics / eventExploreTopics / jobRequiredTopics / jobExploreTopics / activeSearchInputs — recommend (iii), device-only, but flag for cleanup

These are not really "device-only by considered decision" the way the
advisor fields are — they read as leftovers from the events/jobs surfaces
the "papers-only pivot" (per project memory) removed. No current screen
lets a reader see or set any of them. POLICY — worth a manager decision
that is genuinely outside this item's scope: are these five fields dead
code to remove (`UserProfile`, `defaultProfile`, `promoteSearchInputs`,
`topic-mirroring.ts`), or reserved for a future events/jobs return? I did
not investigate that tradeoff — flagging the question, not answering it.

### advisorAuthorId / advisorAuthorLabel / advisorSeedWorkIds / advisorSeedTexts / advisorSeedsRefreshedAt / onboardedAt — no change; already correct

All six are device-only **by stated design**, with the design stated in
their own doc comments in `web/src/types/index.ts` (quoted verbatim in the
Q1 table). `onboardedAt`'s own comment even names the future path ("See
web/supabase/ for the optional migration to make this cross-device later")
— a product call, not a defect, and not raised as one here.

---

## Question 4 — extending the §1bk rules, and the tests that pin it

The mechanism generalizes cleanly because `dirtySingleValueFields`,
`singleValueSnapshot`, and `reconcilePushPayload`'s two filter loops all
iterate the exported `SINGLE_VALUE_FIELDS`/`LIST_FIELDS` arrays generically
— confirmed by reading every line of `merge.ts` and `profile-sync.tsx`
again with this specific question in mind. Nothing hard-codes a field
count or name inline outside those two array literals (the same property
the PROFILE-SYNC-A review's mutation #4 already exercised for the 11 feed
knobs: "re-add the feed knobs to the unconditional push, hard-coded 14-field
list instead of the widened `SINGLE_VALUE_FIELDS`" — 5 tests went red).

- **preferredJournals**: add the string to `LIST_FIELDS`'s neighbor
  behavior for free — it is *already* in `LIST_FIELDS` today. No rule
  change. `lastSynced` never touches list fields (by design — union is
  safe regardless of staleness), so nothing new is needed there either.
- **deepReportEnabled**: add the string to `SINGLE_VALUE_FIELDS`. That one
  line gives it, automatically: a `lastSynced` baseline entry (via
  `singleValueSnapshot`, which snapshots "every key in `SINGLE_VALUE_FIELDS`"
  generically); the bootstrap rule (`dirtySingleValueFields`'s
  `defaultProfile[key]` fallback, which already works for any
  `string|number|boolean` field per the type audit the PROFILE-SYNC-A
  review already did); and exclusion from the unconditional-push list.

Tests to add (mirroring the existing, already-shipped test shapes in
`merge.test.ts`/`profile-sync.test.tsx`/`route.test.ts`), each with the
mutation it would catch:

| Test | Mirrors | Mutation it catches |
|---|---|---|
| A fresh device (`deepReportEnabled` at its `defaultProfile` value, `false`) adopts the account's real `true` | `merge.test.ts`'s existing per-field fresh-device cases | Dropping `deepReportEnabled` from `SINGLE_VALUE_FIELDS` (or leaving it permanently non-dirty) — this test goes red exactly the way the review's mutation #1 ("treat every field as dirty" / its inverse) did for the other 25 |
| A device that already agrees with the account does not re-push `deepReportEnabled` | `profile-sync.test.tsx`'s payload-filter tests | `reconcilePushPayload` not filtering it — mirrors mutation #4 in the PROFILE-SYNC-A review exactly |
| `profilePatchToRow`/`profileRowToProfile` round-trip `deepReportEnabled` correctly | `route.test.ts`'s existing per-field pairs | Removing the `if (p.deepReportEnabled !== undefined) row.deep_report_enabled = ...` line |
| `SINGLE_VALUE_FIELDS.length === 26` (was 25) and the enumeration/"N keys" tests updated | The PROFILE-SYNC-A review's own Check 2 programmatic count | An accidental omission from the widened set silently changes the pinned count |
| A stale device's shorter/absent `preferredJournals` list never shrinks the account's longer one | The existing list-union shrink-safety tests (§1bk.8's own ruling: "prove with a test that a stale device cannot shrink or roll back the account's copy") | Reverting `unionStrings` to a plain replace in either direction |
| `profilePatchToRow`/`profileRowToProfile` round-trip `preferredJournals` correctly | `route.test.ts`'s existing per-field pairs | Missing `row.preferred_journals` mapping |
| Whatever the Q2 staleness fix turns out to be: editing `softTopics` after a defined `feedIntent` is already installed still produces a push whose `feedIntent` reflects the new edit | New — this exact scenario is what `<scratchpad>/pusf-staleness.mjs` proved broken | Removing whichever invalidation the fix adds reproduces the exact failure this investigation demonstrated |

---

## Question 5 — severity: feed/email content vs display-only

| Field | Live browser feed | Daily email | Display-only elsewhere |
|---|---|---|---|
| softTopics | Yes — scoring boost, client-built request | **Yes** — `digestFeedRequestFromProfile` reads it | — |
| selectedSenseConcepts | Yes, mechanically (`pipeline.ts`) | Yes, mechanically | Moot — never populated today |
| preferredJournals | Yes — `store/feed.ts:807-808` reads the LOCAL profile to build the live feed request | **No** — confirmed absent from both digest routes | Also shown as a read-only "Journals" chip row |
| deepReportEnabled | Affects one screen's depth (full-text + LLM vs abstract-only report), per device, per session | **No** — confirmed absent from both digest routes | — |
| event/job topics, activeSearchInputs | No current surface reads them for retrieval | No | Effectively inert (vestigial) |

The two headline fields split cleanly: **softTopics is the one that matters
most** — it changes both what the live feed shows and what the daily email
contains, on every device and in the one channel (email) a reader might not
even have open a browser for, which is exactly why Q2's staleness bug is
worth fixing regardless of any migration decision. **preferredJournals and
deepReportEnabled are real but narrower** — each changes what one device's
live session shows, never the email, and never any other device.

---

## Recommendation summary (one line each)

| Field | Class | Recommendation |
|---|---|---|
| softTopics | b | No migration — already reaches the account via `feed_intent`. Fix the staleness bug (Q2) — POLICY: scope/shape |
| selectedSenseConcepts | b | No action now — same mechanism, never populated by any current UI |
| preferredJournals | c | New column + route.ts mapping (SQL above); `merge.ts` needs no change |
| deepReportEnabled | c | New column + route.ts mapping + **required** `SINGLE_VALUE_FIELDS` addition, shipped together (SQL above) |
| eventRequiredTopics/eventExploreTopics/jobRequiredTopics/jobExploreTopics/activeSearchInputs | c | Device-only for now — POLICY: dead code to remove, or reserved? |
| advisorAuthorId/advisorAuthorLabel/advisorSeedWorkIds/advisorSeedTexts/advisorSeedsRefreshedAt/onboardedAt | e | No change — already device-only by stated design |
| 8 credential/BYOK fields | d | No change — correctly, intentionally excluded |

## POLICY list (manager decides)

1. The Q2 staleness bug (softTopics/selectedSenseConcepts/project/challenge
   can go stale mid-session and silently drop, delay, or — for a removal —
   resurrect an edit): fix inside this item, or spin out as its own
   follow-up? Which fix shape — invalidate `feedIntent` in every
   intent-input setter, or stop `hydrateFromRemote` from installing a
   defined `feedIntent` at all, or something else?
2. Whether to actually add `preferred_journals`/`deep_report_enabled`
   columns (this item's main ask), given both are otherwise-working,
   narrower-severity, single-device settings today.
3. Whether `eventRequiredTopics`/`eventExploreTopics`/`jobRequiredTopics`/
   `jobExploreTopics`/`activeSearchInputs` are dead code to remove now that
   the events/jobs UI is gone, or intentionally reserved.
4. If `deep_report_enabled` ships: confirm the implementer adds it to
   `SINGLE_VALUE_FIELDS` in the *same* change as the column + route mapping
   (flagged above as an ordering hazard, not a design choice).

## Search scope, for every "not found"/"no UI" claim above

- `selectedSenseConcepts` has no setter: `Grep "selectedSenseConcepts"` over
  `web/src/store/profile.ts` (whole file read) — zero setter matches; whole
  `ProfileState` interface read line by line.
- `selectedSenseConcepts` has no `.tsx` UI: `Grep "selectedSenseConcepts"`,
  glob `*.tsx`, over `web/src` — only `profile-sync.tsx` (a comment) and its
  own test file matched.
- `eventRequiredTopics`/`eventExploreTopics`/`jobRequiredTopics`/
  `jobExploreTopics`/`activeSearchInputs` have no Profile-page UI:
  `Grep` each name over `web/src/app/profile/page.tsx` in full — zero
  matches for all five.
- `deepReportEnabled`/`preferredJournals` never read server-side for the
  digest: `Grep "deepReport"` / `Grep "preferredJournals\|deepReportEnabled"`
  over `web/src/app/api/jobs/dispatch-digests/route.ts` and
  `web/src/app/api/test-digest/route.ts` in full — zero matches in either
  file for either field.
- No `profiles`-table migration other than the 13 files under
  `web/supabase/migrations/` (`Glob "web/supabase/migrations/*.sql"`) plus
  the base `web/supabase/schema.sql`; no separate RLS-policy file exists
  (`Grep "policy"` over `web/supabase/` matched only `schema.sql` and the
  already-read `rollback/` README, which is explicitly documented as not
  consumed by any migration runner).
