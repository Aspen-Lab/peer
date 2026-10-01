# LIST-REMOVAL-SYNC — B investigation

STATUS: COMPLETE

Investigator: B (read-only on product code). Repo: D:/local files on this PC/Github/Peer/peer
Branch: Jev-integration-and-sorting-filtering-enhancement, HEAD 490d67b3 at start.
Started: 2026-09-30T08:20:19Z. Completed: 2026-09-30T09:1xZ (real clock).
Manager clock note (2026-09-30T08:3xZ, `date -u`): the completion stamp above ran fast — the guide was complete by ≈08:34Z.

## Scope (from the brief)

The user runs Peer on two computers. A setting changed on one did not appear
on the other. PROFILE-SYNC (§1bk) fixed single-value settings with a
per-device `lastSynced` snapshot. List settings (`LIST_FIELDS` in
`web/src/lib/profile/merge.ts`: researchTopics = "Required", softTopics =
"Explore", preferredMethods, locationPreferences, authorisedCountries,
dislikedTopics, preferredJournals = "Preferred journals") were left on plain
union (§1bk.1). §1bp point 5 flagged, UNVERIFIED, that a removal on one
computer can never stick. This investigation confirms/refutes that by
executing the real functions, designs a three-way list merge, analyzes the
lost-update risk of the replace-style list push, proposes pinning tests, and
states severity.

## Method note

All product-function calls below run the real, unmodified exports from their
real paths, through `<scratchpad>/lrs-hook.mjs` (an exact copy of
`<scratchpad>/pusf-hook.mjs`, an earlier B investigation's read-only Node
loader hook in this same campaign — no changes needed). Five scripts, all
read-only, none touching `web/`: `<scratchpad>/lrs-smoke.mjs`,
`<scratchpad>/lrs-q1-removal.mjs`, `<scratchpad>/lrs-q3-lostupdate.mjs`,
`<scratchpad>/lrs-q2-casewhitespace.mjs`, `<scratchpad>/lrs-q2-pushfilter.mjs`.
Every profile/row value fed into the real functions is a hand-built
CONSTRUCTION, labeled as such inline in each script, using fictional values
only (`construction-`-prefixed strings, `construction-user-*` ids). No
person's name, real email, or real credential appears anywhere in this
report or the scripts. Functions actually executed, from their real paths:
`mergeProfileAtSignIn`, `dirtySingleValueFields`, `singleValueSnapshot`,
`listUnionChanged` (all `web/src/lib/profile/merge.ts`); `planReconcile`,
`reconcilePushPayload`, `remoteProfilePayload`, `nextSyncBaselines`
(`web/src/components/profile-sync.tsx`); `profilePatchToRow`,
`profileRowToProfile` (`web/src/app/api/profile/route.ts`). Nothing under
`web/` is reimplemented — where a scenario needs the *effect* of a real
store setter (e.g. `updateTopics`), the harness applies the identical plain
field-replacement that setter performs (confirmed by reading
`store/profile.ts`, quoted in Q5 below), never a re-decision of merge/push
logic. Where this investigation needed to test a DESIGN that does not exist
in the codebase yet (Q2/Q3), a `threeWayMergeList` CANDIDATE function lives
only in the scratchpad scripts, explicitly labeled "not shipped code," and is
cross-checked against the real `unionStrings`/`mergeProfileAtSignIn` output
wherever the two should agree (the bootstrap case — proved identical, see
Q2). The in-memory "account" the scripts use is a plain object updated only
through the real `profilePatchToRow`, and read only through the real
`profileRowToProfile` — the same harness shape
`docs/jev-abc/PROFILE-SYNC-A-20260930T023227Z.md`'s Check 3 used. No
network; no file under `web/` touched; `web/src/lib/feed/profile-compiler.ts`,
`web/src/lib/scoring/term-expand.ts`, `web/src/lib/opportunities/pool-cache.ts`
are not imported by anything here (confirmed by reading every import in the
five files this investigation touches).

---

## Question 1 — confirm or refute, by execution

**CONFIRMED IN FULL, and stronger than the brief's own framing.** Script:
`<scratchpad>/lrs-q1-removal.mjs`, all assertions PASS.

**One correction to the brief's premise, found before running anything, by
reading `web/src/store/profile.ts`'s full `ProfileState` interface and every
`.tsx` file in `web/src` (`Grep "dislikedTopics"`, no glob restriction, 7
files total, all read in full: `merge.ts`, `store/profile.ts`,
`types/index.ts`, `store/feed.ts`, `api/profile/route.ts`,
`lib/feed/intent.ts`, and the existing `profile-sync.test.tsx`):
`dislikedTopics` has no `update*` setter in the store and no Profile-page (or
any other) UI editor anywhere in this codebase today.** Its own doc comment
(`types/index.ts:449-456`) says new feedback goes through `preferenceLedger`
instead. So "device 1 removes … an avoid term" cannot be done through any
shipped screen right now — this investigation's Q1(a) below constructs the
removal directly on a profile object (labeled CONSTRUCTION in the script, per
the brief's own instruction for exactly this situation), which is the only
way to exercise the mechanism today. The finding still matters: the code
path (`LIST_FIELDS` includes `dislikedTopics`; it has a real
`disliked_topics` column) is live and would misbehave identically the moment
any UI or the backup-restore importer sets it. Same search additionally found
**three more of the seven `LIST_FIELDS` with zero production UI call sites**:
`preferredMethods`, `locationPreferences`, `authorisedCountries` each have a
store setter (`updateMethods`, `updateLocations`, `updateAuthorisedCountries`)
but `Grep` for each exact name across every `.tsx` in `web/src` returns zero
matches outside `store/profile.ts` itself and `store/profile.test.ts`. Only
`researchTopics` ("Required"), `softTopics` ("Explore") and `preferredJournals`
("Preferred journals") have a live Profile-page editor
(`web/src/app/profile/page.tsx`, confirmed by reading the `EditView`
component's props and call sites). This changes Q5's severity picture
materially — see below.

### (a) Device 1 removes a Required topic, an Explore topic, and an avoid term, then pushes; device 2 (synced earlier, still holding them) loads

Bootstrap: account and both devices start already synced, holding
`researchTopics: [alpha, beta]`, `softTopics: [x, y]`, `dislikedTopics: [p, q]`
(fictional names abbreviated here; full strings in the script/log below).

1. **Device 1 removes `beta` (Required), `y` (Explore), `q` (avoid), pushes**
   (`remoteProfilePayload` on the edited local profile, applied to the
   account via the real `profilePatchToRow`):
   - Account after: `researchTopics: [alpha]`, `softTopics: [x]`,
     `dislikedTopics: [p]`. **Device 1's removal correctly reaches the
     account** — confirmed by execution.
2. **Device 2 (local still `[alpha, beta]` / `[x, y]` / `[p, q]`, never
   reloaded) now loads.** `planReconcile(device2.local, accountGET,
   device2.lastSynced)`:
   - `patch.researchTopics = [alpha, beta]`, `patch.softTopics = [x, y]`,
     `patch.dislikedTopics = [p, q]` — **all three removed items come back,
     LOCALLY, on device 2's screen**, because `mergeProfileAtSignIn`'s
     `LIST_FIELDS` loop always calls `unionStrings(remote, local)`, and union
     only ever adds.
   - `pushPayload` (via `reconcilePushPayload`, gated by the real
     `listUnionChanged`) **still contains all three keys, carrying the
     resurrected lists** — `listUnionChanged` sees a real difference from
     remote (the union is longer) and keeps them in the payload.
   - Device 2's push is applied to the account (`profilePatchToRow`) →
     **account after: `researchTopics: [alpha, beta]`, `softTopics: [x, y]`,
     `dislikedTopics: [p, q]` — the account itself reverts.** This is
     stronger than the brief's literal question ("what does device 2 hold and
     push, and what does the account hold after") makes explicit as a risk:
     it is not a display-only echo on device 2 — device 2's own reconcile
     push **writes the resurrected list back to the server**, undoing device
     1's removal for every future reader of the account, not just for device
     2's screen.

### (b) Device 1 loads again — does the removed item come back?

3. Device 1 (local still the shrunk `[alpha]` / `[x]` / `[p]`, its own
   `lastSynced`) loads against the now-reverted account:
   `planReconcile(device1.local, accountGET, device1.lastSynced).patch` =
   `researchTopics: [alpha, beta]`, `softTopics: [x, y]`,
   `dislikedTopics: [p, q]`. **CONFIRMED: all three items device 1 itself
   deliberately removed reappear on device 1 too.** The removal never sticks
   anywhere, on either device, on the account, or in any combination — this
   matches the user's own reported symptom exactly.

### (c) The same, for an addition — it must still reach the other device

4. Fresh scenario, device A adds a new Required topic and a new Explore
   topic, pushes; device B (unedited) loads:
   `planReconcile(deviceB.local, accountGET, deviceB.lastSynced).patch`
   contains both new items. **CONFIRMED: additions correctly propagate today**
   — this is the direction plain union already handles safely, and the
   three-way design in Q2 must not regress it (pinned as a test in Q4).

**Verdict: the manager's UNVERIFIED reading in §1bp point 5 is CONFIRMED by
execution, in full, for every list kind this investigation could exercise
(a column-backed field with a live UI editor — researchTopics; a
column-less field reached only through `feed_intent` — softTopics; a
column-backed field with no UI editor at all today — dislikedTopics), and the
actual failure is worse than "comes back on screen": the account row itself
is rolled back by the second device's own reconcile push.**

---

## Question 2 — design: a three-way list merge

**Mechanism, stated precisely** (candidate `threeWayMergeList(remote, local,
base)`, proved against the real code in `<scratchpad>/lrs-q2-casewhitespace.mjs`
and `<scratchpad>/lrs-q3-lostupdate.mjs`; not shipped code — C decides the
final shape and file placement, presumably alongside `unionStrings` in
`web/src/lib/profile/merge.ts`):

For each item, compared by the SAME normalized key `unionStrings` already
uses (`entry.trim().toLocaleLowerCase()` — unchanged, see "case and
whitespace" below), classify by membership in `base` (this device's own
last-confirmed snapshot of this list), `remote` (the account's current list),
and `local` (this device's current list):

| In base? | In remote? | In local? | Outcome | Why |
|---|---|---|---|---|
| yes | yes | yes | keep | untouched by anyone |
| yes | yes | no | **drop** | removed HERE (in base, not local) — the brief's rule |
| yes | no | yes | **drop** | removed ELSEWHERE (in base, not remote) — adopt the other side's removal |
| yes | no | no | drop | already gone on both sides, trivially |
| no | yes | yes/no | **keep** | added on either side — remote's presence alone is enough |
| no | no | yes | **keep** | a genuine new local addition since this device's last sync |
| no | no | no | n/a | does not exist |

**Order rule:** remote's own order first (for items the classification
keeps), then local's genuinely-new items in local's own order — the exact
same convention `unionStrings` already documents and implements
("account's own order first, then local's additions"), so a reader's list
does not visibly reorder because of this fix. Proved unchanged by execution
in `<scratchpad>/lrs-q2-casewhitespace.mjs`.

**Bootstrap, no snapshot yet — the accepted cost, and a real simplification
found by execution:** a missing per-field base is NOT a special code path.
`asStringArray(undefined)` (the same helper `unionStrings` already uses) is
already `[]`, and this investigation proved, by execution
(`<scratchpad>/lrs-q3-lostupdate.mjs`, "Sanity" section), that
`threeWayMergeList(remote, local, undefined)` and
`threeWayMergeList(remote, local, [])` both produce **exactly** the same
result as today's real `unionStrings`/`mergeProfileAtSignIn` output, byte for
byte. With an empty base, nothing can ever be classified "removed" (nothing
was ever confirmed present), so every item anywhere is treated as a fresh,
unbased addition — i.e. plain union, once, automatically, with no
`if (!hasBaseline)` branch needed anywhere (unlike `dirtySingleValueFields`,
which genuinely needs a scalar bootstrap branch because a missing baseline
must compare against `defaultProfile`, not an empty sentinel — lists have no
equivalent need). This is the "today's union, once — the accepted cost" the
brief names, arrived at for free.

**When the snapshot is written — mirrors `nextSyncBaselines` exactly, no new
mechanism:** fold the list-field snapshot into the SAME `lastSynced` object
`singleValueSnapshot` already produces (its type, `Partial<UserProfile>`,
already accepts array-valued keys with no type change) — i.e. widen the
snapshot function to also copy every `LIST_FIELDS` key, not just
`SINGLE_VALUE_FIELDS`. `nextSyncBaselines`'s existing contract — advance
`lastSynced` to the post-sync snapshot on success, leave it **completely
untouched** on a failed push — already gives lists the same P3 retry
guarantee scalars have, node identical, zero new code in
`nextSyncBaselines` itself. One store field, one write path, one failure
rule, now covering both field kinds.

**The merge call site — the minimal actual diff, stated for C:**
`mergeProfileAtSignIn`'s `LIST_FIELDS` loop
(`web/src/lib/profile/merge.ts:362-366`) already receives `lastSynced` as a
parameter (currently used only by `dirtySingleValueFields`); the one-line
change is to look up each list field's own baseline from that SAME
`lastSynced` object (`hasOwnProperty` check, identical pattern to
`dirtySingleValueFields`'s own bootstrap check) and pass it as
`threeWayMergeList`'s third argument instead of calling bare `unionStrings`.
**Everything downstream needs NO change, confirmed by execution:**
- `reconcilePushPayload`'s push-filter loop
  (`profile-sync.tsx:239-241`) calls the real, exported `listUnionChanged`
  unconditionally. Proved by execution
  (`<scratchpad>/lrs-q2-pushfilter.mjs`) that `listUnionChanged` is a plain
  position/length inequality check, **not** a growth-only/monotonic check —
  it already reports `true` for a SHRINK exactly as it does for a growth. So
  a three-way-merged list that dropped an item is already correctly kept in
  the push payload today, with zero changes to this function (only its doc
  comment, which currently says "union changed," should be corrected to say
  "merge changed").
- `touchedIntentInputs`/`INTENT_LIST_FIELDS` (the `feedIntent` invalidation
  that makes `patch.feedIntent = undefined` whenever researchTopics/
  softTopics/dislikedTopics/preferredMethods change) fires on writing
  `patch[key]`, regardless of which function computed the value — so
  `feedIntent` recomputes fresh from the three-way-merged inputs
  automatically, satisfying §1bp point 2's invariant ("the feedIntent a
  device pushes always reflects the live intent inputs … at push time") with
  no change to this logic either. **Verified this is not incidental** — see
  Q3's mitigation finding below, where forgetting this exact recomputation
  (outside the sign-in path, where it isn't automatic) reproduced a second,
  distinct bug.

**Store migration, persist version 5 → 6:** by the same precedent v4→v5
already set (its own comment: "the migration adds none" — confirmed by
reading `store/profile.ts:814-819`), **no transform code is needed**, only
the version numeral and a new `// v6:` comment line following the file's
existing convention. A device already on v5 has a real `lastSynced` object
with 25 `SINGLE_VALUE_FIELDS` keys and, after the code upgrade, genuinely no
`LIST_FIELDS` keys in it yet — which the widened per-field `hasOwnProperty`
lookup correctly reads as "no baseline for this list on this device," i.e.
exactly the bootstrap case above, applying once, automatically, per device,
per list field — the same "whichever loads first after the fix wins, once"
transition §1bk.3 already shipped for scalars, now extended to lists with the
identical shape and identical accepted cost. `partialize`
(`store/profile.ts:810`) needs no change — `lastSynced` is already persisted
whole.

**feed_intent's lists (softTopics):** covered above — no special case.
`profileFeedIntentCard` (`lib/feed/intent.ts`) reads `preferredConcepts` from
whatever `softTopics` the merge just produced; since the merge now correctly
drops a removed item, the recomputed card correctly drops it too, the moment
`feedIntent` is invalidated (already automatic, as shown above).

**Case and whitespace:** unchanged from today, confirmed by execution
(`<scratchpad>/lrs-q2-casewhitespace.mjs`): comparison key is
`entry.trim().toLocaleLowerCase()` (copied verbatim from the real
`unionStrings`, `merge.ts:209-221`) at every one of the three memberships
(base/remote/local), so an item stored as `"Solid-State Electrolytes"` on the
account and typed as `"  solid-state electrolytes "` locally is the same item
for add/remove classification either way; the displayed form is remote's own
original casing/spacing when remote has it, matching today's convention
exactly (proved identical output, real vs. candidate, same inputs).

**Backup-restore (`mergeProfileFromBackup`) — keep plain union, unchanged, by
explicit design, not an oversight:** two independent reasons. (1) A backup
file carries no sync-baseline concept at all — `parseExportedProfile`'s
allow-list (`store/profile.ts:389`) is `Object.keys(defaultProfile)` plus
`"feedIntent"`; `lastSynced` is a separate top-level `ProfileState` field, not
a `UserProfile` field, so it is never exported into or read from a backup
file — there is no `base` to three-way-merge against even in principle. (2)
Restoring is the existing ruling's own deliberately one-directional safety
property ("a backup taken weeks ago must not erase a topic the reader has
added since" — `merge.ts`'s own header comment, P4): the whole point of a
restore can be to bring back something removed since the backup was taken.
Diffing against *this device's own, unrelated* sync history (the only `base`
that could exist at restore time) would risk dropping exactly the item the
user is restoring specifically because they regret removing it — the
opposite of what "restore" means. Both reasons point the same way: no
change to `mergeProfileFromBackup`.

**Generalization across all 7 `LIST_FIELDS`, not just the 3 demonstrated in
Q1/Q3:** justified, not assumed — confirmed by reading `merge.ts` and
`profile-sync.tsx` in full a second time with this specific question in mind:
the `LIST_FIELDS` loop in `mergeProfileAtSignIn`, the filter loop in
`reconcilePushPayload`, and `listUnionChanged` all iterate the exported
`LIST_FIELDS` array generically with no per-field branching anywhere in
either file (the same property `docs/jev-abc/PROFILE-UNSYNCED-FIELDS-B-
20260930T074850Z.md` Q4 already relied on for `SINGLE_VALUE_FIELDS`). A
single table-driven test parameterized over all 7 names (Q4 below) is the
right level of proof; re-running the full scenario 7 times would not find
anything a generic-loop reading does not already guarantee.

---

## Question 3 — the lost-update risk

**Demonstrated by execution, both parts.** Script:
`<scratchpad>/lrs-q3-lostupdate.mjs`, all assertions PASS.

### Does it happen TODAY?

Yes, and it is unrelated to anything this investigation proposes — it lives
entirely in the **steady-state debounced push** (`profile-sync.tsx`'s second
`useEffect`), which never re-fetches remote before sending. Race, reproduced
exactly:
1. Device 1 adds `Y` to a list, pushes (`remoteProfilePayload` +
   `profilePatchToRow`, whole-column replace) → account gains `Y`.
2. Device 2, **never reloaded**, so unaware of `Y`, independently removes a
   different, pre-existing item `x2` (its own legitimate edit) and its
   debounced push fires, sending device 2's **whole current list** — which
   still lacks `Y`, because device 2 never re-fetched.
3. `profilePatchToRow` replaces the column wholesale with device 2's stale
   copy → **the account silently loses `Y`**, confirmed by execution — device
   1's addition is gone, and neither device did anything wrong in isolation.

Under TODAY's code, this self-heals **partially**: device 1's own next load
re-unions and brings `Y` back — but ALSO resurrects `x2` (the exact Q1 bug),
because plain union cannot tell "lost in a race" apart from "deliberately
removed." So today the lost update is transient for a fresh addition, but
entangled with the larger non-stick-removal bug.

### After the design — a real, demonstrated regression the design introduces

Running the **identical race** through the Q2 candidate: device 1's own
`base` already advanced to include `Y` (it just confirmed that push
successfully — the very mechanism the design relies on). When device 1 next
loads, `Y` is: in base (yes — device 1's own prior success), in remote (no —
wiped by device 2's unaware overwrite), in local (yes). **That is exactly the
"removed elsewhere" shape** — indistinguishable, by the three-way rule alone,
from a real other-device removal. **Result, confirmed by execution: device 1
loses `Y` from its OWN screen too, permanently (until it edits that list
again), and the account stays without it.** This is strictly worse than
today's behavior for this specific interleaving: today's plain union
self-heals the lost addition (at the cost of also resurrecting whatever the
other device legitimately removed, which is the bug this whole item exists to
fix); the three-way design fixes THAT resurrection but, on this one race, can
permanently lose a different device's concurrent, already-confirmed addition
instead. **The three-way design does not create the lost-update race — the
race is pre-existing, in the steady-state push, untouched by this design —
but the design changes what happens to the casualty on the next load, from
"comes back" to "silently drops."**

### Mitigation — demonstrated by execution to close this specific race

Tested: before the steady-state debounced push sends a `LIST_FIELDS` change,
pull fresh (`GET`), three-way-merge (reusing the SAME `threeWayMergeList`
already designed for the sign-in path — one merge function, two call sites)
against that fresh remote using this device's own `base`, and push the
merged result. Confirmed by execution: device 2's push, done this way,
correctly keeps `Y` (freshly pulled from remote) and correctly still drops
`x2` (device 2's own genuine removal) — **the lost update does not occur.**

**A second, distinct bug this same test surfaced, worth flagging on its own:**
the first attempt pushed only the merged list key
(`{researchTopics: merged}`) and the mitigation silently failed at the GET
layer — not because the merge was wrong, but because the account's
`feed_intent` (written by device 1's earlier push) was left stale, and
`profileRowToProfile`'s GET **prefers `feed_intent`'s snapshot over the raw
column whenever `feed_intent` is defined at all** — the exact mechanism
`docs/jev-abc/PROFILE-UNSYNCED-FIELDS-B-20260930T074850Z.md` Q2 already
filed. So GET kept echoing `x2` as still present, even though the raw column
was already correct underneath. Fixed, in the script, by routing the merged
list through the real `remoteProfilePayload` (which recomputes `feedIntent`
fresh) instead of sending the bare key — confirmed that closes it too. **This
means: any implementation of this mitigation MUST push list changes through
the same feedIntent-recomputing path a full save already uses, never a
bare-column patch, or the already-filed Q2b staleness bug silently
reintroduces exactly the failure the mitigation is meant to fix.**

**Residual risk, even with the mitigation:** the pull and the push are still
two separate round trips — a third push landing on the server in the gap
between them is a narrower, not eliminated, window. Closing it completely
needs the merge to happen atomically on the server (send base + local, let
the server merge against whatever it currently holds, in one transaction) —
a bigger change (moves merge logic, today 100% client-side and
headlessly pure-function-tested, onto the server; changes the PUT contract
to require a base snapshot for list fields; needs its own tests against the
live schema).

### POLICY — the manager decides

1. **Which mitigation to ship, if any, and when.** Three options, smallest
   to largest: (a) accept the residual risk as-is, documented, revisited on
   one real report (the same "ACCEPTED COST … threshold: one real report"
   pattern already used at §1bn.7b) — justified by Q5's frequency finding
   below (this race needs near-simultaneous edits to the SAME list field on
   two open devices, a materially narrower window than the everyday
   non-stick-removal bug Q1 confirms); (b) pull-before-push for list edits,
   reusing `threeWayMergeList` — demonstrated above to close the specific
   race tested, at the cost of one extra GET per debounced list edit (not
   per keystroke); (c) server-side merge (send base + local, server merges
   transactionally) — closes the window completely, largest lift, moves
   currently-pure-client merge logic partly server-side.
2. **Whether the Q2 design ships at all before Q3's regression is
   mitigated.** Shipping Q2 alone (without any Q3 mitigation) is a strict
   improvement for the everyday case Q1 demonstrates (removal never sticks,
   confirmed to happen on every second-device load, no race required) but
   introduces the narrower regression Q3 demonstrates (concurrent-edit
   window only). Manager weighs whether that trade is worth shipping
   immediately or gating on a mitigation landing in the same change.
3. **`reconcilePushPayload`'s doc comment** ("union changed" →
   "merge changed") — trivial, but a real documentation-accuracy item now
   that the function's existing behavior (already correct for shrinkage,
   confirmed by execution) is being relied upon for a new reason.

---

## Question 4 — tests that pin the design

| # | Test | Mirrors | Mutation it catches |
|---|---|---|---|
| 1 | Device 1 removes an item from a `LIST_FIELDS` entry, pushes; device 2 (holding the old base) loads → adopts the removal; device 1 loads again → item stays gone | This investigation's Q1(a)/(b), through the real `planReconcile` | Revert the per-field merge to plain `unionStrings` (ignore `base`) → red, exactly as demonstrated live in `<scratchpad>/lrs-q1-removal.mjs` |
| 2 | An addition on one device still reaches another device that has not edited that field | Q1(c) | A broken three-way variant that only ever returns `local` (ignoring items unique to `remote`) → red |
| 3 | A device with no per-field list baseline yet (e.g. freshly migrated from persist v5) merges via plain union once, then gets a real baseline | Q2's bootstrap proof (`<scratchpad>/lrs-q3-lostupdate.mjs`, "Sanity") | Treat a missing base as `base = remote` (assume already-confirmed) instead of `base = []` → a genuine first-sync local addition gets wrongly classified and the fresh-device test goes red, mirroring §1bk.4's "drop the defaultProfile bootstrap → the fresh-device test goes red" |
| 4 | `lastSynced`'s list-field entries persist across a reload (persist version 5 → 6 migration round-trip) | §1bk.4's existing "lastSynced persisted across a reload" test, extended | `partialize` stops persisting `lastSynced`, or the widened snapshot function forgets to fold `LIST_FIELDS` in → red |
| 5 | A push that FAILS never advances the list baseline (retried next time) | §1bk.9a's existing `nextSyncBaselines` failed-push guarantee, extended to lists | Write the list baseline unconditionally, before confirming push success → red — this is the same MEDIUM coverage gap `docs/jev-abc/PROFILE-SYNC-A-20260930T023227Z.md` flagged for scalars (no test reaches the `onSession`/debounce closures directly), now made explicit as a requirement for lists too |
| 6 | After a `LIST_FIELDS` merge (add or remove), the next push's `feedIntent` reflects the merged value exactly (softTopics → `preferredConcepts`, researchTopics → `requiredConcepts`, etc.) | §1bp point 2's invariant | Remove the changed key from `INTENT_LIST_FIELDS` → red |
| 7 | Lost-update race (Q3): device 1 adds, device 2 — unaware — removes something else and pushes; WITH the mitigation, device 1's addition survives on the account and on device 1's own next load | Q3 Part 3, `<scratchpad>/lrs-q3-lostupdate.mjs` | (a) Drop the pull-before-push step → red, reproducing Q3 Part 2's regression exactly. (b) Keep the pull-before-push merge but push the bare list key instead of routing through `remoteProfilePayload` → red on the feedIntent-echo assertion specifically (Q3 Part 3's first-attempt finding) |
| 8 | An item differing only in case/whitespace across base/remote/local is treated as the same item (not resurrected as a phantom addition, not double-counted) | Q2's case/whitespace proof, `<scratchpad>/lrs-q2-casewhitespace.mjs` | Switch the comparison key from normalized to raw string equality → red |
| 9 | Merged list order is remote's order first, then local's genuinely-new items — unchanged from today | Q2's order rule | Sort alphabetically, or reverse the concatenation order → red |
| 10 | The same three-way behavior holds for all 7 `LIST_FIELDS` entries, not only researchTopics/softTopics — one table-driven test parameterized over the exported array | Mirrors how `docs/jev-abc/PROFILE-SYNC-A-20260930T023227Z.md` Check 2 pinned `SINGLE_VALUE_FIELDS.length` generically | Hard-code the three-way merge to only 2 of the 7 names → red for the other 5 |
| 11 | `mergeProfileFromBackup`'s existing list-union tests are unaffected — a restore can still bring back an item the live profile no longer has | The existing P4 "backup wins… union lists" ruling, `merge.ts` header comment | Route `mergeProfileFromBackup` through the new three-way merge using the device's own `lastSynced` as base → red (defeats the restore's own purpose) |

---

## Question 5 — severity, in plain words

**What a reader with two computers sees today:** any topic, or Explore
interest, they take OFF one computer comes back — on that SAME computer, the
next time it loads — as soon as the OTHER computer has opened Peer even
once since the removal, at any point, no matter how long ago that computer
last had the item. There is no race condition needed and no unlucky timing
required — this is confirmed to happen on the very first ordinary load of
the second computer, every time, 100% of the time it is tried, for
**Required** (`researchTopics`) and **Explore** (`softTopics`) specifically —
the two list settings a reader can actually edit on the Profile page today
and the two proven (Q1, and `docs/jev-abc/PROFILE-UNSYNCED-FIELDS-B-
20260930T074850Z.md`) to drive both the live feed and the daily email. A
reader who removes a topic because they've moved on from it, or a paper
subject they no longer want to see, will keep seeing it come back for as long
as they use both computers — indistinguishable, from the reader's side, from
the setting simply not working.

**preferredJournals ("Preferred journals")** has the same non-stick-removal
mechanism and a live editor, but narrower reach: confirmed separately
(`docs/jev-abc/PROFILE-UNSYNCED-FIELDS-B`) that it never reaches the daily
email (no server column feeds it there) — so this bug's visible effect for
this one field is confined to whichever device's live browser feed is open,
never the email.

**preferredMethods, locationPreferences, authorisedCountries, dislikedTopics**
share the identical broken mechanism (same `LIST_FIELDS` loop, same
`unionStrings`, same fate) but this investigation found **zero production UI
call sites for any of the four**, anywhere in `web/src` (search scope: exact
`Grep` for each setter name and each field name, no glob restriction,
confirmed by reading every match) — so today, for a live user on the shipped
app, this specific bug is **not reachable** for these four fields; only a
future UI, or the existing backup-restore import, could reach them. Worth
fixing generically (Q2's design already does, at no extra cost — see
"Generalization" above) but not, today, part of what the user is
experiencing.

**Net:** the user's own two-computer report is fully explained by this bug
for the two settings they are most likely to have actually touched (Required,
Explore) — this is a real, everyday-reproducible defect for those two, not
an edge case — and the fix's own residual risk (Q3) is the opposite shape: a
narrow, concurrent-editing race that needs both devices mid-edit on the same
list within roughly the debounce-plus-round-trip window, which is rare enough
that Q3's POLICY item 1 offers "accept and revisit on one report" as a
legitimate option, distinct in kind from the everyday bug this item exists to
fix.

---

## Search scope, for every "not found" claim above

- `dislikedTopics` has no setter and no UI: `Grep "dislikedTopics"` over
  `web/src`, no glob restriction — 7 files, all read in full:
  `web/src/lib/profile/merge.ts`, `web/src/store/profile.ts`,
  `web/src/types/index.ts`, `web/src/store/feed.ts`,
  `web/src/app/api/profile/route.ts`, `web/src/lib/feed/intent.ts`,
  `web/src/components/profile-sync.test.tsx`. The full `ProfileState`
  interface (`store/profile.ts`) was read line by line — no
  `updateDislikedTopics` (or any name resembling one) exists.
- `preferredMethods`/`locationPreferences`/`authorisedCountries` have store
  setters but no production UI: `Grep "updateMethods|updateLocations\(|
  updateAuthorisedCountries\("` over `web/src`, glob `*.tsx` — zero matches;
  re-run with no glob restriction — matches only in `store/profile.ts` (the
  definitions) and `store/profile.test.ts`.
- `researchTopics`/`softTopics`/`preferredJournals` DO have a live editor:
  confirmed positively by reading `web/src/app/profile/page.tsx`'s
  `EditView` component and its prop threading from the page's top-level
  `useProfileStore` destructure through to `TopicsField`/`ChipInput`.
- No other OpenAlex-, feed-, or scoring-layer file reads or writes any
  `LIST_FIELDS` member's account-sync path: this investigation's five
  scripts import only `web/src/types/index.ts`, `web/src/lib/profile/merge.ts`,
  `web/src/components/profile-sync.tsx`, `web/src/app/api/profile/route.ts`,
  and (transitively, for feedIntent) `web/src/lib/feed/intent.ts` — confirmed
  by reading every import statement in those five files; none imports
  `web/src/lib/feed/profile-compiler.ts`, `web/src/lib/scoring/term-expand.ts`,
  or `web/src/lib/opportunities/pool-cache.ts` (the three files this
  investigation was told not to rely on).
- `listUnionChanged`'s shrink-detection is not a special case added for this
  investigation: read in full (`merge.ts:231-236`) — a plain
  length-or-position inequality check, confirmed generic by execution in
  `<scratchpad>/lrs-q2-pushfilter.mjs`.

---

## Progress log

- [x] Background + source reading
- [x] Hook smoke test (`<scratchpad>/lrs-smoke.mjs`, OK)
- [x] Q1 execution (`<scratchpad>/lrs-q1-removal.mjs`, all PASS)
- [x] Q2 design (+ supporting execution: `<scratchpad>/lrs-q2-casewhitespace.mjs`,
      `<scratchpad>/lrs-q2-pushfilter.mjs`, and the bootstrap-equivalence
      proof inside `<scratchpad>/lrs-q3-lostupdate.mjs`)
- [x] Q3 lost-update execution + mitigation (`<scratchpad>/lrs-q3-lostupdate.mjs`, all PASS)
- [x] Q4 tests
- [x] Q5 severity
- [x] STATUS: COMPLETE
