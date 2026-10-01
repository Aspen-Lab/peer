# PROFILE-LISTS — A review (PROFILE-UNSYNCED-FIELDS §1bp.2/§1bp.3 + LIST-REMOVAL-SYNC §1bq)

STATUS: VERIFIED (completed 2026-09-30T10:23:17Z, `date -u`)

Reviewer: A (fresh, independent). Repo: D:/local files on this PC/Github/Peer/peer
Branch: Jev-integration-and-sorting-filtering-enhancement, HEAD aee9f7fb.
Change under review: UNCOMMITTED, 9 files under web/src.
Started: 2026-09-30T09:55:53Z (`date -u`). See "STATUS: VERIFIED" section at
the bottom for the full verdict, and "FINDINGS" for the two POLICY items.

I did not write this change. I measure it against ABC-JEV-INTEGRATION.md
§1bk (whole), §1bp, §1bq (binding rulings, already read in full) and try hard
to break it. I do not edit product code/tests and do not decide policy.

## Plan

1. Read rulings §1bk/§1bp/§1bq (DONE), the implementer's checkpoint
   docs/jev-abc/PROFILE-LISTS-C-20260930T092001Z.md (DONE, read as unverified
   claims), the two B guides (DONE), and the full diff of all 9 files.
2. Read the actual diffs of the 5 product files and 5 test files in full via
   `git diff`.
3. Set up the read-only resolver hook in the scratchpad (copy pusf-hook.mjs
   to a-pl-hook.mjs) and write my own execution scripts to run the real
   functions for scenarios (a)-(k), independent of the implementer's and
   investigators' own scripts (I may reuse lrs-q3-lostupdate.mjs and
   pusf-staleness.mjs as starting points per the brief, but must exercise
   the actual working-tree code myself).
4. Check the staleness invariant (§1bp.2) by grepping every write site of
   each intent input myself.
5. Check the device-only hint lines (§1bp.3) verbatim in the page source.
6. Diff every test file against HEAD; judge the changed singleValueSnapshot
   assertion; reproduce >= 3 mutations myself with sha256 before/after.
7. Code-comment accuracy pass + look for anything the rulings did not
   foresee.
8. Run gates: vitest, tsc, eslint, build.
9. Privacy scan of changed files + checkpoint.
10. Write final verdict, scenario table, ranked findings.

## Progress log

- [x] Rulings read (§1bk, §1bp, §1bq)
- [x] Implementer checkpoint + both B guides read
- [x] Full diffs read (all 5 product files, all 4 test file diffs — route.test.ts
      was read as part of CHECK 4 below; profile.test.ts diff also read)
- [x] Execution scenarios (a)-(k) — see CHECK 1 below
- [x] Staleness invariant grep — see CHECK 2 below
- [x] Device-only lines check — see CHECK 3 below
- [x] Test diff / mutation reproduction (4 mutations, exceeds "at least 3") — see CHECK 4 below
- [x] Comment accuracy / unforeseen-case pass — see CHECK 5 below
- [x] Gates — see CHECK 6 below, all 4 green
- [x] Privacy scan — see CHECK 7 below, clean
- [x] Final verdict — VERIFIED, see bottom of this doc

(Checked in as I go; STATUS honest at every moment.)

---

## CHECK 1 — Multi-device simulation through the real functions

Method: `<scratchpad>/a-pl-hook.mjs` (copy of `<scratchpad>/pusf-hook.mjs`),
`<scratchpad>/a-harness.mjs` (account simulated ONLY through the real
`profilePatchToRow`/`profileRowToProfile`), and 6 scenario scripts:
`a-scen-main.mjs` (a,b,c,h,k), `a-scen-ij.mjs` (i,j), `a-scen-de.mjs` (d,e),
`a-scen-f-concurrency.mjs` + `a-scen-f-followup.mjs` (f), `a-scen-g-accountswitch.mjs` (g).
All ran clean (asserts passed) against the REAL `planReconcile`,
`mergeProfileAtSignIn`, `threeWayMergeList`, `pullMergeAndPush`,
`nextSyncBaselines`, `remoteProfilePayload`, `profilePatchToRow`,
`profileRowToProfile`, and — for computer 1 in (a)-(c) and all of (d)/(e)/(f) —
the REAL `useProfileStore` singleton and its real setters
(`updateTopics`/`updateSoftTopics`/`followTerm`). All values CONSTRUCTION,
fictional (`construction-*` prefixed). Two of my own first-draft test
constructions were themselves flawed and gave a false red; both diagnosed,
fixed, and are recorded below because the diagnosis is itself evidence about
the system, not just my script.

### (a)/(b) removal sticks on both devices and the account — PASS
Bootstrap: account + 2 devices synced holding Required=[alpha,beta],
Explore=[x,y]. Computer 1 removes beta+y via the REAL `updateTopics`/
`updateSoftTopics` setters, debounced push routes through `pullMergeAndPush`
(list field changed) → account loses beta,y. Computer 2 (unedited, still
holding both) loads via `planReconcile` → ADOPTS the removal
(`patch.researchTopics=[alpha]`, `patch.softTopics=[x]`), its own reconcile
push does NOT re-carry either key (nothing new to say) → account unchanged.
Computer 1 loads again → both items stay gone, push is a true no-op for
researchTopics/softTopics specifically (see note below on the OTHER,
harmless keys that are never truly empty). VERDICT: PASS, matches §1bq
exactly and reproduces the user's own two-computer symptom being fixed.

Note (not a bug, pre-existing, already disclosed by the implementer's own
Part 2 note): `pushPayload` for a "nothing changed" load is never literally
`{}` — `eventRequiredTopics`/`eventExploreTopics`/`jobRequiredTopics`/
`jobExploreTopics`/`deepReportEnabled`/`onboardedAt`/`feedIntent` ride along
unconditionally because they have no server column at all
(`profilePatchToRow` silently drops them) and `reconcilePushPayload` only
filters `SINGLE_VALUE_FIELDS`/`LIST_FIELDS` members. This means
`pullMergeAndPush`'s `"synced-no-push-needed"` status is effectively
unreachable with a realistic profile — exactly what the implementer's own
Part 2 checkpoint already discloses ("NOT reachable with a real
defaultProfile-shaped profile"). Confirmed independently; not new.

### (c) addition reaches the other device — PASS
Device 2 adds gamma, pushes (via `planReconcile`, real push payload) →
account gains it → computer 1's next load receives it. Confirmed.

### (h) "no information" rule — PASS
Explore on an account with NO feed_intent card, and Preferred journals on an
account with NO column, both verified UNCHANGED across 3 consecutive loads
(`planReconcile` never puts `softTopics`/`preferredJournals` in `patch` when
remote lacks real information for them — §1bq.2's gate holds).

### (i) persist v5→v6 transition — PASS
`migrateProfileStore(persisted, 5)` adds NO transform to `lastSynced`
(confirmed: output `lastSynced` is content-identical to the input, no
`researchTopics` key). Proved the mechanism this implies: with a v5-shaped
`lastSynced` (single-value keys only, no list keys), `mergeProfileAtSignIn`'s
per-field `hasBase` check is false for every list field → `threeWayMergeList`
degenerates to plain union exactly once (account-order-first, then local's
addition) — then the post-sync `lastSynced` (via the widened
`singleValueSnapshot`) has a real list baseline, and the device's NEXT load is
a genuine three-way merge (a subsequent removal sticks, not re-unioned).
Both halves proved by execution.

### (j) backup restore still unions — PASS
`mergeProfileFromBackup` (unchanged code, still plain `unionStrings`) brings
back a topic removed since the backup was taken. Also proved a case NOT
explicitly in the implementer's own test suite: after the restore, the
device's next debounced push (carries a list change) is routed through
`pullMergeAndPush`'s THREE-WAY merge — and the restored item survives that
too, because relative to `base`/`remote` (neither of which ever had it
confirmed-then-removed in THIS device's own sync history) it looks exactly
like "a genuine new local addition," which the three-way rule always keeps.
Confirmed by execution, not just by reading.

### (k) §1bk.8 — a stale, unedited device never shrinks the account — PASS
First attempt used an unrealistic test construction (a bare
`.put({researchTopics:[...]})` to simulate "another device's addition" —
this bypasses `remoteProfilePayload`'s feedIntent recomputation, which
real code never does; it reproduced the ALREADY-KNOWN, ALREADY-DOCUMENTED
"GET prefers feed_intent's snapshot over the raw column" mechanism
(PROFILE-UNSYNCED-FIELDS-B Q2) purely as an artifact of my own shortcut, not
a defect in the diff). Fixed by pushing "device B"'s addition the real way
(through `planReconcile`/`reconcilePushPayload`, which always recomputes
`feedIntent`) — after the fix, the stale device correctly adopts the
account's growth and never shrinks it.

### (d) pull fails — PASS
`getRemote` fails → `push()` is NEVER called (spy-verified) → push-failed
status set → account untouched. Retry (same pending edit, working deps)
succeeds, status clears, account gets the edit.

### (e) edit during GET / edit during PUT — PASS
Deferred (controllable) promises for both gates. An edit typed while the GET
is in flight is captured (readLocal runs AFTER the GET resolves, in the same
synchronous step as applyPatch — confirmed, not just read from a comment) and
reaches the account. An edit typed while the PUT is in flight is correctly
NOT part of that in-flight push's payload, survives on the local profile
(`setBaselines` never touches `profile`), and reaches the account on the
natural next cycle — not lost.

### (f) CONCURRENCY — the central finding of this review; see "Findings" below
`applyPatch` inside `pullMergeAndPush` always creates a NEW `profile` object
(`{...s.profile, ...patch}`), which — read together with `ProfileSync`'s
Effect 2 dependency array `[profile]` — means EVERY successful
`pullMergeAndPush` unconditionally re-triggers the debounced-push effect
again, arming a second, self-triggered `pullMergeAndPush` call. Proved by
execution, in both completion orders, with fully controllable fake promises:

- Two-call self-overlap ALONE (no third device): SAFE in both orders — both
  calls converge to the same correct result; `lastSynced` matches the
  account either way. (f)-1, (f)-2: PASS.
- Three-way interaction — a genuinely independent third device's push
  landing in the gap of a SLOW, still-pending `pullMergeAndPush` call (call
  A), while THIS device's own self-triggered second call (call B) has
  ALREADY correctly pulled fresh and merged the third device's concurrent
  addition: when call A's stale, late-landing PUT finally resolves, it
  OVERWRITES the account and SILENTLY DROPS the third device's addition —
  even though call B had already fixed it. Reproduced by execution,
  (f)-3. This IS the already-disclosed, already-accepted residual risk
  (§1bq.3 POLICY item 1 / the guide's Q3 "residual risk" section: "a third
  push landing in the gap... is a narrower, not eliminated, window") — not a
  new, undisclosed defect. See "Findings" for the one thing my execution
  adds beyond what was already disclosed.
- Follow-up: device 1's OWN next sync cycle self-heals (re-adds the dropped
  item, since its local store — unlike the account — was never corrupted).
  If, instead, the OTHER device (the one that made the addition) reloads
  BEFORE device 1's self-heal, it adopts the false "removed elsewhere"
  reading and drops the item from ITS OWN copy too — at that point the item
  survives only in device 1's own browser tab until device 1's next sync.
  Both proved by execution.

### (g) ACCOUNT SWITCH — the second major finding; see "Findings" below
Code reading (not guessed): the REAL "Sign out" control
(`account-section.tsx`) is a plain `<form method="POST"
action="/auth/signout">` — a full page navigation to a server route
(`app/auth/signout/route.ts`) that only calls `supabase.auth.signOut()` and
redirects; `handleSignOutSubmit` only ever calls `event.preventDefault()` to
show an "unsynced changes" warning, never touches `useProfileStore`.
`profile-sync.tsx`'s own `onSession(null)` (the `SIGNED_OUT` handler) resets
only in-memory refs and `entitlement`/`authOutcome` — never `profile` or
`lastSynced`. `useProfileStore.getState().logOut()` DOES clear
`{profile: defaultProfile, lastSynced: null}` (store/profile.ts ~:810-820)
but is wired ONLY to the unrelated "Reset profile to defaults" button on the
Profile page (`app/profile/page.tsx:343`) — never to sign-out. A
PRE-EXISTING test (`store/profile.test.ts`, NOT part of this diff) even
carries a comment asserting "logOut() also clears lastSynced, so a LATER
SIGN-IN starts from the bootstrap rule" — which is true of `logOut()` in
isolation but false as a description of what actually happens on sign-out,
since sign-out never calls it.

Proved by execution (3 sub-cases, real `planReconcile`):
- (g)-1 A signs out with NO unsynced edits, B signs in: SAFE — B's real data
  correctly wins (A's untouched leftovers are "not dirty" / already
  "in base" so the merge discards them in B's favor). Nothing leaks.
- (g)-2 A signs out WITH an unsynced edit (an entirely ordinary timing — type
  a topic, close the tab before the 700ms debounce fires): CONFIRMED — A's
  unsynced Required topic AND A's unsynced `currentProject` text both get
  merged into what looks like B's own profile, and BOTH get PUSHED into
  B's real account (`pushPayload.researchTopics`/`pushPayload.currentProject`
  both carry A's leftover data). Verified the account row is actually
  written.
- (g)-3 A leftover vs B's real (non-empty) value: B's real value correctly
  wins (not dirty, remote non-empty) — the danger is specifically A's
  UNSYNCED edits, not A's already-synced-then-abandoned data.

This is PRE-EXISTING (predates this diff — the mechanism is
`dirtySingleValueFields`/`mergeSingleValue`/plain-union, none of which this
diff touches) — NOT a regression introduced by PROFILE-LISTS. See "Findings"
for severity and framing.

**Scenario table (a)-(k): ALL PASS** (system behaves per §1bk/§1bp/§1bq in
every scenario the ruling actually governs; (f) and (g) surface findings
about risk the ruling either already accepted (f) or never addressed (g) —
neither is a case of the diff failing to implement what it was told to do).

---

## CHECK 2 — the staleness invariant (§1bp.2), grepped myself

Grepped `web/src/store/profile.ts` for every `set((s) =>`/`set({` call site
(56 setters total) and cross-referenced against the 7 fields
(`researchTopics`, `softTopics`, `preferredMethods`, `currentProject`,
`currentChallenges`, `dislikedTopics`, `selectedSenseConcepts`). Confirmed:
- `dislikedTopics`: zero setters anywhere in the file (grep for the exact
  name across the whole `ProfileState` interface + implementation) — nothing
  to guard.
- `selectedSenseConcepts`: zero occurrences anywhere in store/profile.ts.
- The only 6 set-call-sites touching the other 5 fields are exactly the 6
  the implementer's checkpoint claims: `updateTopics`, `updateSoftTopics`,
  `updateMethods`, `updateCurrentProject`, `updateCurrentChallenges`,
  `followTerm` — every one of them now sets `feedIntent: undefined` in the
  SAME `set()`. `leanOnTerm` (a different, easily-confused setter) only
  touches `preferenceLedger`, correctly excluded. `promoteSearchInputs`
  (called from `completeOnboarding`/hydration) only READS
  researchTopics/softTopics to populate `activeSearchInputs`, never writes
  them — correctly excluded. `hydrateFromRemote` writes these fields too but
  is explicitly exempted by the ruling ("may keep installing the server's
  card") and does not need the invalidation (it's about to install a
  server-fresh `feedIntent` from the SAME row in the SAME `set()` call).
- Grepped `welcome/topic-mirroring.ts` and every other `.ts`/`.tsx` file
  under `web/src` for a setter I might have missed (e.g. a hand-rolled
  `useProfileStore.setState(...)` outside profile.ts itself that writes one
  of these 7 fields directly) — `restore-backup.tsx` is the only such call
  site (`useProfileStore.setState((s) => ({ profile: {...s.profile,
  ...patch} }))`), and `patch` comes from `mergeProfileFromBackup`, which
  ALREADY sets `feedIntent: undefined` itself when it touches an
  intent-input field (confirmed in merge.ts, `touchedIntentInputs`) — so
  this path is covered by the merge function itself, not a setter gap.
- The table-driven test (`store/profile.test.ts`) enumerates exactly these
  6 cases + the `followTerm` no-op case; MUTATION 4 above (drop the clear
  from `updateSoftTopics`) reddened exactly the table-driven case for that
  setter plus both route.test.ts integration tests, confirming the guard
  actually catches a regression, not just documents intent.

**VERDICT: PASS. No miss found.**

---

## CHECK 3 — device-only lines (§1bp.3)

Read `web/src/app/profile/page.tsx`'s diff directly: the sentence
`Saved on this device only.` appears verbatim, twice — once next to
"Preferred journals" (`<p className="mt-2 px-1 text-micro leading-snug
text-text-faint/70">`, inside that field's own `<div>`, after its existing
hint paragraph) and once next to the "Deep report" Toggle (`<p
className="text-micro leading-relaxed text-text-faint">`, replacing the
sibling's previous CONDITIONAL "Sign in first" hint's unconditional slot).
Both reuse the page's PRE-EXISTING hint utility classes (`text-micro
leading-snug text-text-faint/70` and `text-micro leading-relaxed
text-text-faint` respectively — both idioms already used elsewhere on this
same page before this diff) — no new component, no new className pattern.
`page.test.tsx`'s new source-text describe pins: the exact string appears
EXACTLY TWICE, and each occurrence is reachable from its own field's call
site (`"Preferred journals"` / `aria-label="Deep report"`) before the next
`<EditRow>` starts. Matches the ruling's exact wording ("Saved on this
device only.") and exact field pairing.

**VERDICT: PASS.**

---

## CHECK 4 — tests: diff vs HEAD, the changed assertion, mutation reproduction

Diffed all 5 test files against HEAD (`git diff`, read in full for each —
merge.test.ts +153/-5, profile-sync.test.tsx +208, store/profile.test.ts
+138, page.test.tsx +38, route.test.ts +77). No pre-existing test deleted or
weakened in any of the 5 files — every change is either a pure addition or
the one documented, deliberate change below.

**The one changed assertion** (`merge.test.ts`, `singleValueSnapshot`
describe): was `expect(snap).not.toHaveProperty("researchTopics")`, now
`expect(snap.researchTopics).toEqual(["x"])`. Judged: this is the NEW
CONTRACT, not a weakened check — §1bq.1 explicitly REQUIRES
`singleValueSnapshot` to widen and fold in `LIST_FIELDS` (the whole point of
the per-device list baseline), so the OLD assertion is now definitionally
false under the ruling, and the new one is strictly MORE specific (an exact
value, not just non-presence). Comment tag present
("LIST-REMOVAL-SYNC (§1bq.1) — CHANGED: ..."), as required. A second,
NEW test in the same describe separately proves the general case (all 7
LIST_FIELDS keys captured verbatim, not just researchTopics).

**Mutation reproduction — 4 done myself (exceeds "at least 3"), independently,
via the Edit tool (never `git checkout`), sha256 before/after every cycle,
`git ls-files --eol` re-checked at the end:**

| # | File | Mutation | My result | Implementer's claimed result | Match |
|---|---|---|---|---|---|
| 1 | merge.ts | `threeWayMergeList` call → back to bare `unionStrings` | exactly 3 red: merge.test.ts "device 2 ... adopts the removal", profile-sync.test.tsx "WITH the mitigation" + "long-open-tab" | same 3 | EXACT |
| 2 | merge.ts | drop `if (!Array.isArray(remote[key])) continue;` | exactly 1 red: the softTopics-no-card test (preferredJournals test stays green — protected by the pre-existing hasOwnProperty check alone) | same | EXACT |
| 3 | profile-sync.tsx | `deps.push(pushPayload)` → `deps.push({researchTopics: merged.researchTopics})` (bare list key) | exactly 1 red: "WITH the mitigation", specifically on the `feedIntent?.requiredConcepts` assertion | same | EXACT |
| 4 | store/profile.ts | drop `feedIntent: undefined` from `updateSoftTopics` | exactly 3 red: the table-driven `updateSoftTopics` case + both route.test.ts addition/removal integration tests | same | EXACT |

sha256 before/after, every file, every cycle — all byte-identical:
merge.ts `56a1f916183239071e3534dc7b69f7944576d5d083a192154cac690a87f65e44`;
profile-sync.tsx `427b420d8f92026140804c1d4bea4e053d320a6097f22af8740d82047804d530`;
store/profile.ts `f3a7c37d983386fcfc9c029fe2709fc2b5213ff5d96528b4a5fbf0f2758890a9`.
The first two ALSO exactly match the implementer's own checkpoint-reported
hashes (case-insensitive) — independent confirmation the working tree I am
reviewing is the exact same content the implementer worked with and reported
on, not a diverged copy. `git ls-files --eol` unchanged throughout: merge.ts
`w/lf`; profile-sync.tsx, store/profile.ts `w/crlf` (matches the pre-mutation
snapshot taken at the very start of this review).

**VERDICT: PASS.**

---

## CHECK 5 — code-comment accuracy + unforeseen ordinary-valid-case pass

Spot-checked the load-bearing factual claims in the diff's own comments
against the ACTUAL source (not just trusted the comment):
- `profileFeedIntentCard` (`web/src/lib/feed/intent.ts:239-244`): confirmed
  by reading — `if (source.feedIntent !== undefined) { ...re-validate the
  EXISTING card... }`, only falling through to recompute-from-flat-fields
  when `feedIntent` is undefined. This is the load-bearing fact the entire
  §1bp.2 fix depends on; verified true, not just asserted.
- `listUnionChanged`'s "already reports true for a shrink" claim
  (`merge.ts`): read the function body directly — plain position/length
  inequality, no growth-only assumption anywhere. True.
- `reconcilePushPayload`'s "feedIntent inherits safety, left unconditional"
  claim: consistent with `remoteProfilePayload`'s own `profileFeedIntentCard`
  call recomputing it fresh from whatever fields are already in `merged` —
  verified by execution throughout CHECK 1.
- The route.ts null-mapping table in the implementer's own checkpoint (which
  field goes "no information" and why): independently re-derived by reading
  `route.ts`'s `ProfileRow`/`profileRowToProfile`/`profilePatchToRow` myself
  — matches exactly.

**Extra ordinary-valid-case, not explicitly in the guide's or implementer's
test list:** a reader clears a list field to genuinely empty (`[]`), not to
be confused with "no information" (`undefined`/absent). Proved by execution
(`<scratchpad>/a-scen-extra-emptyall.mjs`): `Array.isArray([])` is `true`, so
a real, confirmed empty list correctly takes part in the merge (does NOT hit
the §1bq.2 "no information" skip) and a stale device correctly adopts an
account that was genuinely cleared to zero, rather than treating the empty
array as "nothing to say" and resurrecting its own stale copy. PASS.

No comment found that overstates, understates, or misdescribes what the code
actually does.

---

## CHECK 6 — gates

All 4 run from `web/`, fresh, no retry needed (no network font fetch or
other flake encountered):

| Gate | My result | Implementer's claim | Match |
|---|---|---|---|
| `npx vitest run` | 294 files (291 passed + 3 skipped) / 5664 passed + 6 skipped / 0 failed | same | EXACT |
| `npx tsc --noEmit` | 0 errors | 0 errors | EXACT |
| `npx eslint .` | 0 errors / 151 warnings; independently confirmed 0 of those 151 warnings are in any of the 9 changed files | 0 errors / 151 warnings | EXACT |
| `npm run build` | compiled successfully, full route list generated (incl. `/api/profile`, `/profile`), no errors | compiled successfully, same route list | MATCH |

Baseline cross-check: HEAD (aee9f7fb, before this uncommitted change) —
not independently re-run at HEAD by me (would require stashing the diff,
which is a prohibited operation under this review's hard constraints); the
brief's stated baseline is 5625 passed, and 5664 − 5625 = 39, matching the
implementer's own claimed net new-test count (10 Part 1 + 26 Part 2 net + 3
Part 3 = 39) exactly, which is at least internally consistent.

**VERDICT: PASS, all 4 gates green, first attempt.**

---

## CHECK 7 — privacy scan

Scanned the 9 changed files + the implementer's checkpoint
(`docs/jev-abc/PROFILE-LISTS-C-20260930T092001Z.md`) for email-shaped
strings, Windows user-profile-path-shaped strings, and secret-shaped strings
(`sk-`/`sk_`/`AKIA`/`Bearer `/JWT-shaped). Counts only, per the hard
constraint — text never reproduced:

- The 9 changed files: 23 email-shaped strings (all `@example.test`/
  `@example.edu`-style test fixtures or one generic `@gmail.com` placeholder
  already used as a fixture elsewhere in this suite — none is a real
  address), 0 Windows-user-path-shaped strings, 0 secret-shaped strings.
- The checkpoint doc: 0 email-shaped strings, 0 Windows-user-path-shaped
  strings, 0 secret-shaped strings.

**VERDICT: PASS. No personal or secret-shaped string found in either scan.**

(Incident, disclosed: an earlier gate-verification command in this session
was blocked by the sandbox's own destructive-command safety check before it
executed at all — it referenced a ROOT-LEVEL path, `/tmp_eslint_full.txt`,
which this review's own hard constraints forbid touching; a `ls`-only,
read-only follow-up confirmed the command never actually ran — the file's
timestamp was untouched from days before this session, and no file under
`web/` or anywhere else was created, modified, or deleted by it. Per the
"do not retry the same change... by any other route" instruction, this was
not retried; the equivalent check was instead redone correctly, output
written to `<scratchpad>/a-eslint-recheck.txt`.)

---

## FINDINGS, ranked by severity

### HIGH — (g) ACCOUNT SWITCH on a shared device can push one account's unsynced private data into another account. PRE-EXISTING, not introduced by this diff. POLICY — manager decides.

Proved by execution (CHECK 1, scenario g). The real "Sign out" control is a
plain HTML form POST to a server route that redirects — no client-side code
on that path (nor `profile-sync.tsx`'s own `SIGNED_OUT` handler) ever clears
`useProfileStore`'s `profile`/`lastSynced`. The ONE function that does clear
both, `logOut()`, is wired only to the unrelated "Reset profile to
defaults" button. Result: if a reader signs out of account A while ANY
edit (a topic typed, project text changed) has not yet reached the account
— an entirely ordinary timing, not a rare edge case — and a DIFFERENT
account B signs in on the same browser afterward, A's unsynced edit is
merged into what looks like B's own profile and genuinely PUSHED into B's
real account (verified: `pushPayload.researchTopics`/`pushPayload.
currentProject` both carried A's leftover data into B's account row in my
execution). If A had no unsynced edit at the moment of switching, the switch
is safe (B's real data correctly wins) — the danger is specifically an
unsynced edit riding across the account boundary.

This is entirely outside the three binding rulings under review (§1bk/
§1bp/§1bq say nothing about sign-out or account switching) and the
mechanism predates this diff — neither `dirtySingleValueFields`/
`mergeSingleValue` (single-value fields) nor the list-merge logic touched by
this diff is what allows it; plain union would leak identically. Not a
reason to fail this specific review, but too serious to sit in an appendix:
POLICY — the manager decides whether/when to fix (the shape that occurred
to me, not a recommendation: clear `lastSynced` — and arguably `profile` —
on the confirmed `SIGNED_OUT` transition in `profile-sync.tsx`'s own
`onSession(null)`, not only in the unrelated `logOut()`).

### MEDIUM — (f) the pull-before-push mitigation's own `applyPatch` unconditionally re-arms a second, self-triggered attempt; this widens (does not create) the ALREADY-DISCLOSED, ALREADY-ACCEPTED residual "third push lands in the gap" risk. POLICY — manager decides.

Proved by execution (CHECK 1, scenario f), in both completion orders. Two
self-overlapping `pullMergeAndPush` calls on their own (no third device)
converge safely every time — not a bug. The disclosed risk (§1bq.3 POLICY
item 1 / the guide's own Q3 "residual risk": a third device's push landing
between one attempt's own pull and its push) is real and reproducible,
confirmed directly — this is not new information, the ruling already named
it and explicitly chose to accept a narrowed-not-eliminated window. What my
execution adds: because `applyPatch` always produces a new `profile` object
reference regardless of whether the merge actually changed anything, and
`ProfileSync`'s debounced-push effect depends on that same reference,
**every** successful `pullMergeAndPush` unconditionally triggers a follow-up
attempt — meaning a single list edit incurs the disclosed gap-risk window
roughly TWICE (more if a round trip is slow enough to overlap further), not
ONCE as the guide's "one extra GET per debounced list edit" framing
suggests. In the common (fast-network) case this follow-up is free (finds
nothing new, no network call at all — verified). It only becomes a second
real round trip, and a second exposure to the disclosed gap risk, when a
round trip exceeds the 700 ms debounce — plausible on a real network, not a
contrived case. Also verified: this device's OWN next sync cycle self-heals
a loss from this race in the common case; a PERMANENT loss requires the
OTHER device (the one whose addition was dropped) to reload before this
device's self-heal AND this device to never sync again afterward — a
narrow, compounding coincidence, consistent with the guide's own "needs
near-simultaneous edits... a materially narrower window" framing. Not a
reason to fail this review (the ruling explicitly authorized accepting this
class of risk); flagged because the actual frequency is worth the manager
knowing precisely, not assumed.

### LOW — two pre-existing system properties surfaced while building my own test harness, neither a defect in this diff

1. `pullMergeAndPush`'s `pushPayload` (and the sign-in reconcile's, unchanged
   by this diff) is never literally `{}` for a realistic profile — several
   no-server-column fields (`eventRequiredTopics`, `deepReportEnabled`,
   `onboardedAt`, etc.) ride along unconditionally and are silently dropped
   server-side. Already disclosed by the implementer's own Part 2 checkpoint
   note; confirmed independently; harmless (no data reaches any column).
2. `profileRowToProfile`'s GET prefers a stored `feed_intent` snapshot over
   the raw column whenever a card exists at all (the pre-existing Q2b
   mechanism) — so any FUTURE code that writes a list field directly to the
   account without going through `remoteProfilePayload` (a "bare list key"
   write) would silently desync the GET from the raw column. Confirmed by
   execution as an artifact of my own first-draft test harness for scenario
   (k), not a defect in the reviewed diff — every real push path this diff
   touches (`pullMergeAndPush`, the store setters, `mergeProfileFromBackup`'s
   caller) is careful to always go through `remoteProfilePayload`, and the
   implementer's own mutation #4 test (bare list key) exists specifically to
   guard against ever regressing this. Worth a one-line lead for whoever
   next touches this area, not a fix owed here.

No finding rises to a lost, silently-dropped edit or a resurrected removal
CAUSED BY this diff's own implementation of §1bp.2/§1bp.3/§1bq. Every
scenario the three rulings actually govern (a-e, h-k, and the ordinary parts
of f) passes.

---

## Scenario table (a)-(k)

| # | Scenario | Result |
|---|---|---|
| a | Removal of a Required + an Explore topic sticks on the account | PASS |
| b | ...and on both computers after their next load | PASS |
| c | An addition on either device reaches the other | PASS |
| d | A failed pull never pushes blind; push-failed set; retry succeeds | PASS |
| e | Edit during the GET not overwritten; edit during the PUT not lost | PASS |
| f | Concurrency: overlapping debounced pushes | PASS (self-overlap alone is safe); CONFIRMS the already-disclosed, already-accepted 3-device gap risk, with a frequency refinement — MEDIUM POLICY finding, not a fail |
| g | Account switch (sign out A, sign in B) | FAILS in the general sense the check asks about (A's unsynced data can reach B) — but this is PRE-EXISTING, outside §1bk/§1bp/§1bq's scope, not caused by this diff — HIGH POLICY finding, not a reason to fail THIS diff's review |
| h | "No information" ≠ empty: Preferred journals / cardless Explore survive repeated loads | PASS |
| i | persist v5→v6: union once, then three-way | PASS |
| j | Backup restore still unions (and survives a subsequent three-way push) | PASS |
| k | A stale, unedited device never shrinks the account (§1bk.8) | PASS |

---

## STATUS: VERIFIED

All three binding rulings (§1bp.2, §1bp.3, §1bq — the whole of §1bk.8's
"never shrink" guarantee extended to lists) are correctly, faithfully
implemented, independently verified by execution against the REAL functions
(not the implementer's own scripts) in every scenario those rulings
actually govern. 4 independent mutation reproductions (exceeding the
required 3) matched the implementer's claimed red-test-sets EXACTLY. No
pre-existing test deleted or weakened; the one changed assertion is the
correct, deliberate new contract. All 4 gates green on the first attempt,
matching the implementer's reported numbers exactly. Privacy scan clean.

Two findings are reported prominently because they are real and the brief
asked me to hunt for exactly this class of risk, NOT because they are
failures of this diff to do what it was told: (g) HIGH, a serious,
PRE-EXISTING, out-of-scope account-switch data leak; (f) MEDIUM, a
refinement of an ALREADY-DISCLOSED, ALREADY-ACCEPTED residual risk this
same ruling explicitly chose to accept rather than eliminate. Both are
flagged POLICY — manager decides; I did not change any product file or test
(all mutations were made and byte-exact-restored solely as proof, verified
by sha256 and `git ls-files --eol` before and after).

Gate numbers: vitest 294 files (291+3 skipped) / 5664 passed + 6 skipped / 0
failed; tsc 0 errors; eslint 0 errors / 151 warnings; build OK. All match
the implementer's checkpoint exactly.
