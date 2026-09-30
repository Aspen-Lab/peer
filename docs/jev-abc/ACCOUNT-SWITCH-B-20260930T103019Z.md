STATUS: COMPLETE (2026-09-30T10:47:00Z)

# ACCOUNT-SWITCH — investigation guide (B)

Role: read-only investigator. No product file is changed by this document's
author. All values used in executed scripts are fictional constructions
(`construction-*` prefixed). No network calls. No commit/push/branch
operations. Scripts live only under `<scratchpad>/acs-*.mjs`
(`<scratchpad>` = the session scratchpad directory; never printed as a real
path in this file).

## Plan

1. Read background: AGENTS.md, docs/PRODUCT_DIRECTION.md, ABC-JEV-INTEGRATION.md
   (§1bk, §1bq incl. point 6, §1aj, §1bi, §5 rows ACCOUNT-SWITCH/UPLOAD-OWNER),
   docs/jev-abc/PROFILE-LISTS-A-...md check (g), web/AGENTS.md. — DONE (see
   Background section below).
2. Q1 — Inventory every locally persisted store (grep `persist(`,
   `localStorage`, `indexedDB`); for each: does it reach an account, is it
   cleared on sign-out, what B sees before/after sign-in.
3. Q2 — Prove (a)-(e) by execution through the real functions, using a copy
   of the read-only resolver hook (`<scratchpad>/acs-hook.mjs`) and new
   scripts `<scratchpad>/acs-*.mjs`, reusing the prior investigation's
   harness pattern (`a-harness.mjs`, `a-scen-g-accountswitch.mjs`) as a
   starting point but not importing files that investigation didn't need.
4. Q3 — Design options (i) owner key, (ii) clear-on-sign-out, (iii) both;
   effect on (a)-(e) each; what a reader notices; what could be lost; where
   a confirmed sign-out is detectable client-side.
5. Q4 — Serialization design for the MEDIUM debounce-rearm finding
   (§1bq.6 (b)); tests that pin it.
6. Q5 — Tests for the chosen design + the POLICY list.
7. Q6 — Severity in plain words.
8. Finalize: STATUS: COMPLETE with inventory table, (a)-(e) results, options,
   serialization design, tests, POLICY list, search-scope notes.

Progress is checked in after each question below; STATUS stays honest.

---

## Background (from required reading)

- **§1bk (PROFILE-SYNC)**: introduced per-device `lastSynced` snapshot +
  dirty-field merge (store version 4→5); scope was
  web/src/lib/profile/merge.ts, web/src/components/profile-sync.tsx,
  web/src/store/profile.ts. Did not touch sign-out.
- **§1bq (LIST-REMOVAL-SYNC)**: three-way list merge (version 5→6, base =
  last-synced snapshot); ships with a MEDIUM fix folded in (this item, part
  (b) below) for the debounce self-rearm. Point 6 VERIFIED
  2026-09-30T10:2xZ, committed b5ffc8c1. Its fresh-A check (g) is the direct
  origin of ACCOUNT-SWITCH:
  - (a) HIGH, PRE-EXISTING, privacy → this item. Sign out is a plain form
    POST to /auth/signout; nothing on the device clears the local profile
    or lastSynced. A's unsynced edits (typed within the 700ms debounce) are
    merged and PUSHED into B's account when B signs in on the same
    browser. The three-way merge narrows the OLD leak (A's already-synced
    topics are no longer unioned into B — B's real value wins when not
    dirty) but does not close the unsynced-edit path. Manager's addition,
    UNVERIFIED: preferenceLedger merges by per-key union
    (mergePreferenceLedger in merge.ts) — so A's ledger entries may reach B
    even with NO unsynced edit. This item confirms or refutes that by
    execution.
  - (b) MEDIUM — applyPatch re-arms the 700ms debounce unconditionally (new
    object reference every call), so a successful pullMergeAndPush always
    triggers a follow-up sync attempt — roughly doubling exposure to the
    already-accepted §1bq.3 "third push lands in the gap" window. Folded
    into this item's fix (same file, profile-sync.tsx). Design a
    serialization: never two sync sequences at once; a queued one re-reads
    state and usually finds nothing to push.
  - (c) LOW informational, not actionable here.
- **docs/jev-abc/PROFILE-LISTS-A-...md check (g)**: proved by execution
  (real planReconcile, real useProfileStore, construction values):
  (g)-1 A signs out with NO unsynced edit, B signs in → SAFE, B's real data
  wins. (g)-2 A signs out WITH an unsynced edit → CONFIRMED LEAK: A's
  unsynced researchTopics/currentProject are merged into what looks like
  B's profile AND pushed into B's real account row. (g)-3 A's synced-then-
  abandoned value vs B's real non-empty value → B's real value wins
  correctly. Root cause read from code (not guessed): the real "Sign out"
  control in account-section.tsx is a plain
  `<form method="POST" action="/auth/signout">` — a full page navigation to
  a server route (app/auth/signout/route.ts) that only calls
  `supabase.auth.signOut()` and redirects. `handleSignOutSubmit` only calls
  `event.preventDefault()` to show an "unsynced changes" warning — it never
  touches `useProfileStore`. `profile-sync.tsx`'s own `onSession(null)`
  (the SIGNED_OUT handler) resets only in-memory refs and
  entitlement/authOutcome — never `profile` or `lastSynced`.
  `useProfileStore.getState().logOut()` DOES clear
  `{profile: defaultProfile, lastSynced: null}` (store/profile.ts ~:810-820)
  but is wired ONLY to the unrelated "Reset profile to defaults" button
  (app/profile/page.tsx:343) — never to sign-out. This item's job: go
  further than (g) — full inventory beyond the profile store (ledger, feed
  store, uploads), scenarios (a)-(e) (a superset of (g)'s 3 sub-cases),
  design options, the serialization fix, tests, POLICY list.
- **§1aj (SIGNIN-MERGE, 2026-09-28, historical)**: at that time, finding (e)
  read "Sign out → feed-sync resetLocal() wipes saved/read;
  'Reset profile to defaults' → logOut() wipes peer-profile" — i.e. the
  FEED store was already cleared on sign-out (via resetLocal, later refined
  by FEED-SYNC-FLAG to clear only the leaving owner's pending keys), while
  the PROFILE store was not. Ruling P6 ("sign-out wiping unsynced data →
  warn-and-ask") was DEFERRED to "the next C that touches
  account-section.tsx" and never picked up since (no later section
  resolves it) — this item's Q3/POLICY addresses it directly. Must verify
  current code still matches this historical reading (code has moved a lot
  since 2026-09-28); done in Q1/Q2 below, not assumed.
- **§1bi/§5 UPLOAD-OWNER** (NOT_STARTED): a separate, not-yet-designed item
  — uploads made while signed out or under another account 404 after
  sign-in because ownedUpload() compares the upload-time owner key with
  the current identity. Explicitly out of scope for a fix here (a future B
  designs it), but this item's inventory (Q1) still covers uploads' owner
  key as data-that-reaches-an-account, per the brief.

---

## Q1 — Inventory

Method: `grep -rn "persist("` and `grep -rln "localStorage\|indexedDB"` over
`web/src` (excluding `*.test.*`), then read each hit. Search scope: every
`.ts`/`.tsx` file under `web/src`; nothing under `web/node_modules`,
`web/supabase`, or outside `web/` was searched (not needed — no client store
lives there).

Four zustand stores use `persist(...)` (confirmed by
`web/src/components/store-hydrator.tsx`, which rehydrates exactly these
four after mount — the canonical list). Several more surfaces use raw
`localStorage.*` directly, outside zustand.

| # | Data | Storage key | Reaches an account? | Cleared on sign-out today? | What B sees (screen) before sign-in | What B sees after sign-in |
|---|---|---|---|---|---|---|
| 1 | Profile store: single-value fields (`currentProject`, `currentChallenges`, `displayName`, `careerStage`, digest\*, feed\* knobs, …) | `peer-profile` (`web/src/store/profile.ts`) | YES — debounced `PUT /api/profile` (`profile-sync.tsx`) → `profilePatchToRow` (`app/api/profile/route.ts`) | NO. Only `logOut()` clears `{profile, lastSynced}`, and it is wired only to the Profile page's "Reset profile to defaults" button (`app/profile/page.tsx`), never to sign-out. `profile-sync.tsx`'s own `onSession(null)` touches only in-memory refs + `entitlement`/`authOutcome`. | The Profile page (and anywhere else the store is read) shows A's own values, indistinguishable from "this device's own signed-out profile" | A's leftover value merges in for any field that is "dirty" (differs from A's own `lastSynced`/bootstrap) — proved in Q2 |
| 2 | Profile store: list fields (`researchTopics`/Required, `softTopics`/Explore, `preferredMethods`, `locationPreferences`, `authorisedCountries`, `dislikedTopics`, `preferredJournals`) | `peer-profile` | YES — same PUT, three-way merge (`threeWayMergeList`) | NO (same as row 1) | Same as row 1 | A's items not yet in B's own last-synced base for that list are "kept" (three-way merge) — proved in Q2 |
| 3 | Profile store: `preferenceLedger` (the "Not interested" / like / lean history, per-concept) | `peer-profile` | YES — same PUT, **unconditional per-key union** (`mergePreferenceLedger`) whenever the account has *any* ledger — not gated by the SINGLE_VALUE_FIELDS "dirty" test at all | NO (same as row 1) | Not directly visible as its own screen (no dedicated ledger UI), but it silently shapes scoring/ranking | A's ledger entries are unioned into B's, **even when A had no unsynced edit of anything else** — proved in Q2 (this is the manager's UNVERIFIED claim from §1bq.6(a)) |
| 4 | Feed store: saved papers/events/jobs, read marks, per-item feedback | `peer-feed` (`web/src/store/feed.ts`) | YES — `/api/saved`, `/api/read`, feedback routes (`feed-sync.tsx`) | **YES.** `feed-sync.tsx`'s `onSession(null, true)` → `sessionStep({signedOut: true})` → `"reset"` → `store.resetLocal()`, which wipes `papers/events/jobs/savedPapers/savedEvents/savedJobs/readItems/readAt/library/paperFeedback/eventFeedback/jobFeedback/...` and `syncedUserId`, synchronously, before any subsequent sign-in's pull/push runs | Nothing — feed store is already empty by the time B's screen renders | Nothing of A's (structurally: `resetLocal` already ran; belt-and-suspenders, `sessionStep` would also force `"reset-then-sync"` if `syncedUserId` ever survived to see a different `userId`) |
| 5 | Feed store: `deliveredLocalByOwner`, `pendingPushByOwner`, `pendingFeedbackPayloadByOwner` (device-scoped memory, deliberately outlives sign-out) | `peer-feed` (same key) | NO — never pushed anywhere itself; it is bookkeeping *about* pushes/deliveries | NO, by design — but already **namespaced per owner id** (a map keyed by `userId`/`"anonymous"`); `resetLocal` clears only the leaving owner's own entry | B's namespace (`[B's id]`) starts empty/untouched regardless of what A's namespace holds | Same — B only ever reads `map[B's id]`, structurally isolated from `map[A's id]` |
| 6 | Uploaded-paper ownership (`ownedUpload`/`uploadOwner`, `web/src/lib/papers/upload-access.ts`) | *not client-persisted* — a SHA-256 hash of `account:<supabase user id>` (signed in) or `browser:<HttpOnly cookie token>` (signed out, local dev only), computed server-side per request and compared against the upload's own stored `ownerKey` | N/A (server-side identity, not browser storage) | N/A — there is nothing in the browser to clear; the hash is recomputed fresh from the CURRENT session on every request | B cannot read A's uploads: B's own request hashes to `account:<B's id>`, a different key, so `ownedUpload` returns `null` for any of A's files | Same — different hash, still refused. **This item's leak mechanism does not reach uploads.** (The separate, already-tracked UPLOAD-OWNER item is about a reader's *own* upload not carrying across their *own* sign-in, not about crossing accounts — out of scope here, per the brief.) |
| 7 | Notes (`web/src/store/notes.ts`) | `peer-notes` | **NO, by design** — the file's own header: "Nothing here is sent to Peer's server... an account never brought these here" | NO, by design (documented, and `/privacy` states it) | B sees A's notes, same as any other device-local content | Same — notes are never part of any sign-in merge at all, so nothing changes at sign-in either |
| 8 | Reading preferences: font scale, "Fit" (`web/src/store/reading-prefs.ts`) | `peer-reading-prefs` | NO — cosmetic only, no server route | NO | B sees A's chosen text size | Unaffected by sign-in |
| 9 | Reading cache: full-text reading blocks per paper (`web/src/components/reader/use-reading.ts`) | `peer-reading-v2` | NO — read-only cache of **public, non-personalized** content ("one document per paper for every reader... carries no profile and no key" — the file's own comment) | NO (12–24h TTL only) | Same public paper text any reader would see | Unaffected |
| 10 | Deep/abstract paper-report cache (`web/src/components/reader/use-model-report.ts`) | `peer-paper-report-v7` (+ legacy keys removed on load) | NO — a read cache of a report the account already received over the network; keyed by paper + a hash that includes the reader's own project text | NO (6h–7d TTL) | Only shows if B's own cache key (paper + B's own project-text hash) happens to collide with a key A wrote — narrow, content-keyed, not account-keyed | Same narrow collision risk |
| 11 | Daily-digest AI bullets cache (`web/src/components/digest/daily-digest.tsx`, `digest-cache-key.ts`) | `peer-digest-cache-v2` | NO — same shape as row 10: a read cache, single slot, keyed by the exact sorted paper-id set + context hash + aiMode/provider (already hardened once for a cross-plan collision, ABC-freemium 1-11) | NO (12h TTL, or key mismatch) | Only if B's exact paper-id set + context happens to match A's — practically never across two different accounts' own topic-driven feeds | Same |
| 12 | Onboarding persona-quiz answers (`web/src/components/persona/quiz.tsx`, `app/welcome/completeness.ts`) | `peer:persona:v1` | Indirectly at most (feeds the welcome-flow completeness UI; any real profile field it sets goes through the ordinary profile setters already covered in rows 1–2) | NO | B sees A's raw quiz answers if B ever revisits `/welcome` | Unaffected by sign-in merge (not itself a merge input) |
| 13 | Recent search box queries (`web/src/components/search/search-starts.tsx`) | `RECENT_KEY` (device-only) | NO | NO | B sees A's recent search text | Unaffected |
| 14 | `useSyncGate` / `useProfileSyncStatus` / `useFeedSyncStatus` (`profile-sync.tsx`, `lib/feed/sync-status.ts`) | *not persisted* — plain in-memory `create()`, no `persist` middleware | N/A | Reset naturally by a full reload; but **survives an in-tab sign-out→sign-in with no reload** (ordinary JS memory) | N/A (booleans/ids only, no personal content) | Relevant to Q3: this is the only signal `account-section.tsx`'s sign-out warning currently reads |

**Bottom line for Q1:** the leak this item was opened for is confined to the
profile store (rows 1–3: single-value fields, list fields, and — newly
confirmed as a distinct path — the preference ledger). The feed store (row
4) already clears itself correctly on sign-out and already carries a
working, tested "whose data is this" mechanism (`syncedUserId` +
`sessionStep`, rows 4–5) that the profile store has no equivalent of. Every
other row is either structurally incapable of crossing accounts (uploads,
row 6) or already disclosed as permanently device-local and never
part of any account (rows 7–13) — real privacy-relevant facts about a
shared device, but not instances of "account A's data reaches account B's
account", which is this item's mandate. Row 7 (notes) is flagged again
under POLICY below because it is the one row where a *human* reusing the
device (not "an account") still reads the previous person's private text.

Search scope for this section's "not found"/"NO" claims: `grep -rn
"persist("` and `grep -rln "localStorage\|indexedDB"` over `web/src`
(excluding `*.test.*`); every matching file was opened and read at the
cited lines. Not searched: `web/node_modules`, anything server-only with no
browser storage (e.g. `upload-access.ts` was read because it defines the
owner-key *concept*, not because it touches browser storage).

---

## Q2 — Proof by execution (a)-(e)

Method: `<scratchpad>/acs-hook.mjs` (byte-identical copy of
`<scratchpad>/pusf-hook.mjs`), run with:
`node --no-warnings --import "data:text/javascript,import{register}from'node:module';import{pathToFileURL}from'node:url';register('./acs-hook.mjs',pathToFileURL('./'));" acs-x.mjs`
from the scratchpad directory. Shared harness `<scratchpad>/acs-harness.mjs`
(modeled on the PROFILE-LISTS review's own `a-harness.mjs`: the "account" is
read/written ONLY through the real `profilePatchToRow`/`profileRowToProfile`
— never reimplemented). Scripts: `acs-smoke.mjs` (harness sanity),
`acs-scen-ab.mjs` ((a) and (b)), `acs-scen-cd.mjs` ((c) and (d)),
`acs-scen-e.mjs` ((e)), `acs-scen-feed.mjs` + `acs-scen-feed-resetlocal.mjs`
(feed-store side of (b)/(e)). All ran clean (every assertion passed) against
the REAL `planReconcile`, `mergeProfileAtSignIn`, `mergePreferenceLedger`,
`threeWayMergeList`, `nextSyncBaselines`, `sessionStep`, the REAL
`useProfileStore`/`useFeedStore` singletons and their real actions
(`updateTopics`, `updateCurrentProject`, `recordPaperPreference`, `logOut`,
`resetLocal`), and `profilePatchToRow`/`profileRowToProfile` as "the
account." All values CONSTRUCTION, fictional (`construction-*` prefixed).
Noise, not a problem: every run prints
`[zustand persist middleware] Unable to update item 'peer-profile', the
given storage is currently unavailable.` — Node has no `localStorage`; the
persist middleware's own storage adapter fails harmlessly and the
in-memory store (what every function under test actually reads/writes)
is unaffected. Filtered out of the transcripts below for readability.

### (a) A signs out WITH an unsynced edit, B signs in

**CONFIRMED — leak, independently reproduced beyond the prior (g)-2 finding.**
Real `updateTopics`/`updateCurrentProject`/`recordPaperPreference` on A's
profile (a Required topic, `currentProject` text, and a preference-ledger
entry — via a real paper's `preferenceSignals`, not a hand-built ledger
object), no push (simulates closing the tab inside the 700ms debounce).
Sign-out touches nothing (confirmed separately in (e)). B signs in with a
real, different account. `planReconcile(A's still-resident local, B's real
remote, A's own lastSynced)`:
```
pushPayload.researchTopics: ['construction-b-real-topic', 'construction-a-UNSYNCED-topic']
pushPayload.currentProject: "construction-a-UNSYNCED-project-text"
pushPayload.preferenceLedger keys: ['construction-a-UNSYNCED-ledger-concept']
```
Applied to B's account row (`acctB.put(pushPayload)`): the row now contains
A's unsynced topic AND A's unsynced ledger entry. Matches PROFILE-LISTS-A's
(g)-2 for topics/project; the ledger leak in this same "has an unsynced
edit" case is new confirmation (that prior check did not exercise the
ledger).

### (b) A signs out FULLY SYNCED (no unsynced edit anywhere), B signs in — does anything of A reach B?

**Split result — this is the most important nuance this item adds beyond
the prior (g)-1 finding.**

- **(b)-i, scalars: SAFE**, confirmed — B's real non-empty `currentProject`
  correctly wins (matches (g)-1/(g)-3).
- **(b)-i, lists: SAFE, and for a more precise reason than assumed going
  in.** A's own already-synced-only topic (`construction-a2-topic`, present
  in A's `lastSynced` base and in A's local, absent from B's real account)
  does **NOT** survive into B's merged list. Traced to the mechanism, not
  just observed: `threeWayMergeList`'s own table classifies "in base, not
  in remote, in local" as **"removed elsewhere, adopt it"** — semantically
  written for two computers on the *same* account, but on a genuinely
  different account B it still produces the safe outcome (B's remote
  lacking the item reads the same as "someone removed it"), because B's
  remote is compared, not A's. This is a fragile-by-coincidence safety, not
  a designed one — worth naming plainly in the design section below.
- **(b)-ii, the preference ledger: LEAKS — CONFIRMS the manager's
  UNVERIFIED §1bq.6(a) claim.** Isolated test: A fully synced (ledger entry
  written to A's account as part of the very first sync — not an unsynced
  edit), zero further local edits of anything else, B's real account has an
  empty ledger. `planReconcile` output:
  ```
  pushPayload keys: [...LIST_FIELDS no-op entries..., 'preferenceLedger', 'deepReportEnabled', 'onboardedAt', 'feedIntent']
  pushPayload.preferenceLedger: {"construction-a3-synced-concept":{...,"negative":1,...}}
  ```
  No other field (`researchTopics`/`currentProject`/`currentChallenges`/
  `displayName`) differs from B's real account in this isolated run — the
  leak is specific to the ledger, not a side effect of something else.
  Applied to B's account row: B's real ledger now contains A's concept.
  **Root cause, read in code (`web/src/lib/profile/merge.ts:415-471`):**
  `mergeProfileAtSignIn` calls `mergePreferenceLedger(remote.ledger,
  local.ledger)` unconditionally whenever `remote` has a `preferenceLedger`
  property at all — there is no `dirty`/three-way check for the ledger the
  way `SINGLE_VALUE_FIELDS`/`LIST_FIELDS` get one; `mergePreferenceLedger`
  itself is a pure per-key union (`{ ...remoteClean, ...(local's entries,
  keeping the newer timestamp on overlap) }`) with no concept of "was this
  device's copy confirmed with ANY particular account."

### (c) A signs out, then A signs back in (same account) — is anything of A's lost?

**CONFIRMED SAFE, by execution — and this is the constraint any fix must
preserve.** Same unsynced-edit setup as (a), but A signs back into A's OWN
account. `planReconcile(A's local, A's own real remote, A's own
lastSynced)` → the unsynced topic and project text both appear in `patch`
(still on A's screen) AND in `pushPayload` (reach A's own account).
Applied: A's own account row now holds A's own previously-unsynced edit.
**This is exactly why "clear the store on sign-out" cannot be adopted
blind** — a naive wipe would delete this same data the instant A signs
back out, before it ever reaches A's own account, turning today's "safe
because nothing is cleared" case into a genuine, self-inflicted data loss.

### (d) A never-signed-in reader edits, then signs in for the first time — must still work

**CONFIRMED — the intended §1bk case is intact.** Fresh device
(`lastSynced: null`, via the real `logOut()` action, then real
`updateTopics`/`updateCurrentProject`). Tested both first-sign-in shapes:
- (d)-1, `remote === null` (brand-new auth user, no profile row at all —
  `mergeProfileAtSignIn`'s early-return branch): the signed-out topic and
  project text are both in `pushPayload`.
- (d)-2, `remote` = a genuinely empty existing row (the more common real
  case, e.g. an OAuth callback auto-creates the auth user first): same
  result, applied end-to-end — the new account's row now holds the
  reader's signed-out edits.

Neither case is touched by anything this item might change about
sign-*out* — both go through the sign-*in* merge only, which stays exactly
as designed. Recorded here because the brief requires proving it still
works, not assuming it.

### (e) does the device show A's data to B on screen, before B signs in?

**CONFIRMED — a real, distinct exposure, independent of (a)-(d).** No React
renderer is available to this investigation (no `@testing-library/react` in
this repo — the same limitation `profile-sync.tsx`'s own test file already
documents) and the hard constraints forbid starting the dev server, so this
is proved the two ways actually available:
1. **By execution:** a direct before/after snapshot of the real store
   across the real sign-out transition (i.e., nothing — there is no
   function to call, which is itself what (a)'s code reading already
   established) shows the store's `profile` is **byte-identical** before
   and after sign-out; A's private topic and project text are still the
   *current* state.
2. **By code citation** (read in full earlier in this investigation, not
   re-guessed here): `web/src/app/profile/page.tsx:166` destructures every
   profile field from `useProfileStore()` unconditionally — no
   `if (signedIn)` guard. Only the Daily-email section specifically
   (`page.tsx:1626`) gates itself on `auth.kind === "signed-in"`.
   Required/Explore topics, project/challenges text, career stage, display
   name etc. render regardless of auth state — which is *correct* for
   Peer's documented signed-out-first design (a signed-out reader has
   their own local profile), but means a second physical person at this
   browser sees A's data rendered as if it were their own, with **no
   click required beyond opening a tab this device already has open**.
   This is a narrower but real problem than (a): it needs no account B at
   all, and no design that only intervenes "on sign-in" (options limited
   to the merge/push path) fixes it — only clearing (or otherwise gating)
   the local data on the sign-out transition itself reaches this case.

### Feed store side of (b)/(e) — confirms Q1's rows 4-5 by execution, not just reading

`acs-scen-feed.mjs` (the real `sessionStep`, pure function): on the real
`SIGNED_OUT` event, `sessionStep` returns `"reset"` unconditionally; once
that reset has run (`syncedUserId` back to `null`), B's sign-in is a plain
`"sync"`, never `"reset-then-sync"` — nothing of A's to carry. Defence in
depth also confirmed: even a *hypothetically* missed reset (`syncedUserId`
still `"A"` when B signs in) resolves to `"reset-then-sync"`, i.e.
self-heals by clearing first rather than syncing B on top of A's leftovers.
`acs-scen-feed-resetlocal.mjs` (the real `useFeedStore.getState()`
actions): seeded a saved paper, a read mark, `syncedUserId`, and a
per-owner pending-push entry; called the real `resetLocal()`; confirmed
`savedPapers`/`readItems`/`syncedUserId` are actually cleared and the
leaving owner's own `pendingPushByOwner` entry is actually cleared — not
merely decided by `sessionStep`, but actually executed. **This is the same
shape as Design option (i) below, already shipped and proven for the feed
store — the profile store has no equivalent field at all** (confirmed by
reading `web/src/store/profile.ts` in full: no owner id anywhere in
`ProfileState`).

---

## Q3 — Design options

A constraint that shapes every option below, read from code (not assumed):
`account-section.tsx`'s own comment on the plain `<form method="POST"
action="/auth/signout">` — **"a real POST, no fetch/JS required for the
sign-out itself to work"** — is a deliberate, pre-existing invariant. Every
option must keep sign-out working with JS disabled/failed; any enhancement
can only be a progressive layer on top via `onSubmit`, never a replacement
for the plain POST.

### Where a confirmed sign-out is detectable client-side (both options need this)

Two points exist, with different guarantees — confirmed by reading, not
assumed:

1. **The `onSubmit` hook** (`account-section.tsx`'s `handleSignOutSubmit`,
   already wired to both `<form>`s). Fires synchronously while the *current*
   page (and its still-valid session) is alive, before the browser unloads
   to navigate to `/auth/signout`. **This is the ONLY point where a flush
   is still possible** — a real, authenticated session to push against.
2. **The next page load's confirmed-signed-out state** — `profile-sync.tsx`'s
   existing `onSession(null)` (reached either via a same-tab
   `onAuthStateChange` `SIGNED_OUT` event, if one fires before unload, or —
   reliably, always — via the fresh `ProfileSync` that mounts on the `/`
   redirect target calling `getUser()` and finding no session). By this
   point **the session is already server-side invalidated** (the POST
   already ran `supabase.auth.signOut()`), so a flush attempted here would
   already 401. This is, however, the reliable point to **clear** local
   state, since it fires even when JS never got a chance to run at
   `onSubmit` (disabled JS, a crash mid-navigation, a non-form sign-out).

Consequence: **a flush, if attempted, must happen at `onSubmit`; a clear
should happen at the existing `onSession(null)` path (reusing the already-
shipped `logOut()` action, not a new one) so it is reliable regardless of
what happened at `onSubmit`.**

### (i) Owner key — smallest

Add one new persisted field to `ProfileState`, `syncedAccountId: string |
null` (mirrors the feed store's already-shipped `syncedUserId` — see Q2's
feed-side proof; same concept, ported to the store that currently lacks
it), in `partialize` alongside `profile`/`lastSynced`, store version 6→7
(migration: a pre-existing blob simply lacks the key, which is exactly "no
owner yet" — no special migration step needed, same "widen, don't rename"
precedent `SINGLE_VALUE_FIELDS` and `lastSynced` itself already used at
§1bk/§1bq). Set it **eagerly**, the moment `onSession` confirms a real
`userId` — mirroring the ALREADY-EXISTING eager-publish pattern this exact
file uses for `authUserId`/`authOutcome` (set before the pull even starts,
P4-S5b-FIX3's own precedent) — not gated on the sync actually succeeding
(its job is "whose data is this," not "is this device caught up").

**Mechanism, smaller than it first looks:** in `onSession`, before today's
existing pull/merge/push logic runs, compare `syncedAccountId` (read from
the store) against `userId`:
- `syncedAccountId === userId`, or `syncedAccountId === null` ("no owner
  yet") → run **today's existing code, completely unchanged**.
- `syncedAccountId !== null && syncedAccountId !== userId` (a genuine
  switch) → call the **already-shipped** `useProfileStore.getState().logOut()`
  **first** (resets `{profile: defaultProfile, entitlement: null,
  lastSynced: null}` — exactly what's needed), THEN fall through to the
  same existing code, which now runs with `local === defaultProfile`. No
  change to `merge.ts` is needed at all: `defaultProfile` is dirty against
  nothing (`dirtySingleValueFields` finds it identical to itself, the
  bootstrap baseline) and every list/ledger field is empty, so the existing
  merge naturally adopts B's real account cleanly — algebraically identical
  to a fresh device's first sign-in (proved already in Q2, scenario (d)).

**Effect on (a)-(e):**
- **(a) FIXED.** Different `syncedAccountId` → `logOut()` runs before any
  merge → B's account never sees A's unsynced edit.
- **(b) FIXED**, and more robustly than today's coincidental list-merge
  safety (Q2's (b)-i note): the owner-key check intercepts BEFORE any
  merge runs, so the "fragile-by-coincidence" `threeWayMergeList` behavior
  is no longer what's protecting a list leak. The ledger leak ((b)-ii) is
  closed the same way — `mergePreferenceLedger` never runs against a
  different account's local ledger at all.
- **(c) UNCHANGED, still safe.** Same account re-entry (`syncedAccountId
  === userId`) takes the untouched existing path — Q2's (c) proof stands.
- **(d) UNCHANGED, still works.** `syncedAccountId === null` on a
  never-signed-in device is exactly "no owner yet" — Q2's (d) proof stands.
- **(e) NOT fixed.** This option only changes what happens *at sign-in*;
  between A's sign-out and B's sign-in (or if B never signs in at all),
  the screen still shows A's leftover data exactly as Q2's (e) found.

**What a reader notices:** nothing, in the common case — B's own account
loads as if this were a fresh device. If A had a genuine unsynced edit and
a *different* account signs in before A ever returns to this browser, that
edit now silently disappears from local storage (overwritten by
`logOut()` then B's own hydrate) with no error shown — see "what could be
lost" below.

**What could be lost:** A's own not-yet-synced edit, if a different
account signs in before A does. This is a data-loss risk, not a privacy
leak (B never sees or receives it) — but it is a real regression against
today's "nothing is ever cleared" behavior for that one narrow case
(shared/multi-user device, A never returns before B signs in). Named
explicitly because option (ii) below can reduce it (flush before clearing).

### (ii) Clear the local profile, sync state, and account-derived feed data on a confirmed sign-out, flushing any pending push first if possible

**Mechanism:** at the `onSubmit` hook (`account-section.tsx`), when the
form is about to submit the real sign-out POST: attempt a single,
time-bounded flush of any unsynced change (both the "already failed"
signal `hasUnsyncedChanges` already tracks, AND — this needs widening, see
POLICY 2 — a live pending edit still sitting inside the 700ms debounce
that was never even attempted yet, today's actual (a)-scenario trigger).
Best-effort: race the flush against a short timeout; either way, let the
real POST proceed afterward (never block sign-out indefinitely — same
"never hang the reader" shape this codebase already uses elsewhere, e.g.
DIGEST-CATCHUP's time budget, UPLOAD's 15s give-up). Separately, at the
already-existing `onSession(null)` path (`profile-sync.tsx`), add one call:
`useProfileStore.getState().logOut()`, reusing the exact function that
already correctly resets `{profile, lastSynced}` together (the comment on
`logOut()` already explains why both must reset together — a stale
`lastSynced` from the previous account would make every default look
"dirty" on the next sign-in, reintroducing a variant of this same bug
through a different door). The feed store needs no equivalent addition —
Q1/Q2 already confirm `resetLocal()` already runs on `SIGNED_OUT` today.

**Effect on (a)-(e):**
- **(a) FIXED**, with a caveat: if the flush succeeds, A's edit reaches
  A's own account before the clear runs — no loss, no leak. If the flush
  fails or times out, the clear still runs (bounded, by design) — the edit
  is lost from the device, but B still never sees it (safe on privacy,
  costly on data — see below).
- **(b) FIXED**, no caveat (nothing was unsynced to begin with, so the
  flush is a no-op either way).
- **(c) CONDITIONALLY safe — a real behavior change from today.** Today
  (c) is unconditionally safe because nothing is ever cleared. Under this
  option alone, (c)'s safety now depends on the flush succeeding: if A
  signs out and back in and the flush failed in between, A's own edit is
  now genuinely lost — **this is the regression this option must not ship
  without the "flush first" half**, proved directly by Q2's (c) scenario
  (which this item's own tests must re-run against the new code, see Q5).
- **(d) unaffected** — this option only touches sign-*out*, not the
  first-sign-in bootstrap.
- **(e) FIXED — the only option that reaches this case.** Once the store
  is actually cleared, the screen shows `defaultProfile` (empty), not A's
  leftovers, regardless of whether B (or anyone) ever signs in.

**What a reader notices:** ideally nothing (a fast, silent flush). A
reader who already has a failed sync sees today's already-shipped warning
("Some changes on this device haven't reached your account yet...") — but
see POLICY 2: that warning's trigger condition needs widening to actually
fire for this item's realistic case (a live pending edit, not yet even
attempted) — today it would stay silent for exactly the scenario (a)
proves.

**What could be lost:** any unsynced edit whose flush attempt fails or
exceeds the time bound — for EVERY sign-out where that happens, not only
when a different account later signs in (a broader/more eager cost than
option (i)'s).

### (iii) Both — recommended

Owner key as the structural, no-data-loss-of-its-own primary defense for
the actual account-reaching leak ((a)/(b)); clear-on-sign-out (flush
first) as defense in depth AND the only fix for the screen-only case (e).
Combining does not remove the clear's own data-loss risk (a failed flush
still loses an edit) — it only means that risk is the *sole* remaining
cost once shipped, with the privacy side fully closed structurally by (i)
regardless of the flush's outcome or timing. This mirrors a pattern the
project already uses elsewhere for an accepted, bounded, disclosed
residual risk (e.g. §1bq.3's "third push lands in the gap," §1bf's
DIGEST-CATCHUP F1) — the manager has already accepted this *shape* of
trade-off before; POLICY 1 below is the same kind of call.

**Effect on (a)-(e): the union of the best individual outcomes above** —
(a)/(b) closed structurally by (i) even if (ii)'s flush fails or is
skipped entirely; (c) protected by (i) (same-account path untouched) with
(ii)'s flush minimizing the *edit-loss* residual; (d) untouched by either;
(e) closed by (ii). Recommended order to build: (i) first (smaller,
self-contained, closes the HIGH privacy finding on its own), then (ii)
(closes (e), reduces (a)'s data-loss residual for the shared-device case).

---

## Q4 — Serialization design (§1bq.6(b) MEDIUM)

**Root cause, confirmed by re-reading the code the prior finding cites**
(not re-executed — PROFILE-LISTS-A already proved this by execution,
scenario (f); re-proving it is not this item's job, designing the fix is):
`mergeProfileAtSignIn`'s `LIST_FIELDS`/`SINGLE_VALUE_FIELDS`/
`preferenceLedger` loops each write `patch[key]` **unconditionally**
whenever `remote` has that key — never diffed against "did this actually
change" — so `patch` is almost always non-empty once an account has any
row at all. `pullMergeAndPush` calls `deps.applyPatch(patch)` whenever
`Object.keys(patch).length > 0` (i.e., almost always), and `applyPatch`
(`listPullDeps`) does `setState((s) => ({ profile: { ...s.profile,
...patch } }))` — a **new object reference every time**, even when no
field's *value* actually changed. `ProfileSync`'s steady-state debounced-
push effect depends on `[profile]` by reference, so it re-fires and
re-arms the 700ms debounce on every successful `pullMergeAndPush` — including
ones it triggered itself. Confirmed also: the plain scalar-only push path
(`pushRemote` + `setLastSynced`) does **not** touch `profile`, so it does
not self-rearm — the overlap risk is confined to `pullMergeAndPush` calls
specifically (both its direct `carriesListChange` trigger and its own
self-triggered follow-up); `onSession`'s own sign-in pull cannot overlap
either (`didInitialPullRef`/`pullInFlightRef` already prevent re-entry, and
the steady-state effect only arms after `didInitialPullRef` is true).

**Design — the smallest serialization: an in-flight guard with a single
coalesced follow-up**, exactly the shape the brief describes ("never two
sync sequences at once; a queued one re-reads state and usually finds
nothing to push"):

```
// New, small, and directly testable with fakes (same DI shape
// PullBeforePushDeps already uses) — lives next to pullMergeAndPush.
let syncInFlight = false;   // module-scope refs in the real component;
let syncQueued = false;     // shown here as plain variables for clarity

async function runSyncSerialized(deps: PullBeforePushDeps) {
  if (syncInFlight) {
    syncQueued = true;      // coalesce: at most ONE extra run, however
    return;                 // many triggers arrive while busy
  }
  syncInFlight = true;
  try {
    do {
      syncQueued = false;
      await pullMergeAndPush(deps);   // unchanged — re-reads live state
    } while (syncQueued);             // via its own readLocal()
  } finally {
    syncInFlight = false;
  }
}
```

Both trigger points in `ProfileSync` (the debounced push effect's
`carriesListChange` branch, and — automatically, since it is the same
effect re-firing — the self-rearm) call `runSyncSerialized` instead of
`pullMergeAndPush` directly. In the common (fast) case, the self-rearm
fires *after* the first call has already finished (`syncInFlight` already
back to `false`), so it just runs once more, finds nothing to push
(matching PROFILE-LISTS-A's own "free in the common case" observation) —
unchanged from today. In the slow case (a round trip exceeding 700ms), the
self-rearm now arrives *while* `syncInFlight` is still true, so it queues
instead of starting a fully independent overlapping second sequence —
closing exactly the widened-exposure window §1bq.6(b) names, without
eliminating the already-accepted, already-disclosed "third device" race
itself (out of scope, per that ruling).

**Why module/ref-scope, not a promise return value:** `ProfileSync`'s
effect is fire-and-forget (`useEffect` cannot `await`), so callers cannot
already be holding a promise to chain against — a shared mutable flag
(held in a `useRef` inside the component, since there is exactly one
mounted `ProfileSync`) is the smallest mechanism that fits the existing
call shape, matching this file's own established pattern of `useRef`
guards (`pullInFlightRef`, `didInitialPullRef`) for the same class of
problem.

**Tests, with fakes** (the same `PullBeforePushDeps` fakes
`pullMergeAndPush` is already designed to accept — no new test
infrastructure needed):
1. **The invariant itself:** a fake `getRemote` that increments an
   `activeCount` on call and decrements on resolution, asserting
   `activeCount` never exceeds 1 across two overlapping trigger calls.
   **Mutation: remove `runSyncSerialized`'s guard (call `pullMergeAndPush`
   directly again) → `activeCount` reaches 2 → red.** This is the primary
   test that pins the fix.
2. **Coalescing finds nothing to push in the common case:** trigger twice
   while the first fake `getRemote` call is still pending; resolve it;
   assert the fake `push` was called at most once total (the queued
   re-run's own `readLocal`/diff finds nothing new, matching "usually
   finds nothing to push"). **Mutation: make the queued run unconditional
   (always push, even with an empty payload) → assert on `push`'s call
   count goes red.**
3. **A genuine edit arriving mid-flight is not dropped:** a fake
   `readLocal` returning different values on successive calls (simulating
   a real edit typed while the first pull is in flight); assert the
   *second* (queued) run's push payload carries the new edit. **Mutation:
   drop the coalesced re-run entirely (`if (syncInFlight) return;` with no
   `syncQueued`) → the edit is silently lost → this test goes red.**
4. **Bounded, not unbounded, coalescing:** three triggers arriving while
   one run is in flight still produce at most ONE extra run (not three) —
   pins "a queued one," singular, not a growing backlog. **Mutation: queue
   a counter instead of a boolean → an extra, unnecessary third run occurs
   → this test's call-count assertion goes red.**

---

## Q5 — Tests for the chosen design (iii, both) + POLICY list

Each test below reuses a Q2 scenario as its assertion base where noted —
the proof scripts already demonstrate today's (pre-fix) behavior; the same
constructions become the regression tests once the fix lands, plus the
paired mutation.

### Owner key (i)

1. **Same-account re-entry unaffected** (re-run Q2 scenario (c) against the
   new code): A signs out with an unsynced edit, signs back into A →
   `patch`/`pushPayload` still carry A's own edit, reaching A's own
   account. **Mutation: remove the "same account / no owner yet → normal
   merge" branch (always treat sign-in as a switch) → this test goes red**
   (A's own edit would wrongly be discarded via an unwanted `logOut()`).
2. **Different-account switch closes the leak** (re-run Q2 scenario (a)):
   A signs out with an unsynced topic + project text + ledger entry, B (a
   different `syncedAccountId`) signs in → NONE of the three reach B's
   pushPayload/account row. **Mutation: remove the owner-key comparison
   entirely (revert to today's code) → this test goes red** — this is
   Q2's own (a) proof, inverted into a regression guard.
3. **Ledger isolation specifically** (re-run Q2 scenario (b)-ii): a
   different account signs in after A's ledger-only, fully-synced state →
   B's ledger stays exactly B's own. **Mutation: gate scalars/lists on the
   owner key but leave `mergePreferenceLedger` unconditional (a partial
   fix) → this test goes red** — guards against exactly the kind of
   incomplete fix this investigation's own manager-flagged claim was
   about.
4. **Bootstrap/first-sign-in unaffected** (re-run Q2 scenario (d), both
   `remote === null` and `remote` = fresh empty row): a never-signed-in
   device's edits still reach a brand-new account. **Mutation: treat
   `syncedAccountId === null` as "a different account" (refuse to merge)
   → this test goes red** — this is the exact regression that would break
   the intended §1bk "signed-out edits" case.
5. **Store migration:** a pre-existing v6 blob (no `syncedAccountId` key
   at all) loads and is treated as "no owner yet," not as a forced switch.
   **Mutation: default a missing field to any non-null sentinel → every
   existing user's very next load is wrongly treated as an account switch
   → this test goes red.**

### Clear-on-sign-out, flush-first (ii)

6. **Confirmed sign-out with nothing unsynced clears local state:** after
   a sign-out with no pending edit, `useProfileStore.getState()` returns
   `{profile: defaultProfile, lastSynced: null, syncedAccountId: null}`.
   **Mutation: remove the `logOut()` call from `onSession(null)` → this
   test goes red** — this is Q2's (e) proof, inverted.
7. **Flush-then-clear ordering, success case:** an unsynced edit + a fake
   push that resolves `true` → the edit reaches the signing-out account's
   OWN row (via the flush) BEFORE local state is cleared. **Mutation:
   clear before attempting the flush → this test goes red** (loses data
   even though the network was fine — the regression named under option
   (ii)'s own "what could be lost").
8. **Flush is bounded, never blocks sign-out:** a fake push that never
   resolves → sign-out still completes (the clear still runs, within the
   chosen timeout). **Mutation: remove the timeout/race → the test hangs
   or exceeds the bound → red.**
9. **(c) re-verified end-to-end under the combined design:** A signs out
   (flush succeeds), signs back into A → nothing lost (same assertion as
   Q2's (c), now against the post-fix code path, since this is precisely
   the scenario a careless "clear unconditionally, immediately" ordering
   would break). **Mutation: skip the flush step, clear immediately on
   every sign-out → this test goes red.**
10. **No-JS fallback preserved:** the `<form>`'s `method`/`action` are
    unchanged and a rejected/hung flush promise does not prevent the real
    POST from eventually firing (structural check, pairs with test 8).

### Serialization (iv, §1bq.6(b)) — see Q4's own 4 tests; not repeated here.

### POLICY — needing a decision, not B's to make

1. **The user-visible question the brief requires: should signing out
   clear this computer's Peer data?** Concretely: should the clear (option
   ii) be unconditional on every confirmed sign-out, or should it stay
   behind the already-shipped "Stay signed in" / "Sign out anyway"
   confirmation (now made *accurate* by actually implementing what its
   copy already claims — "Signing out removes them from this device" is
   currently false for profile data; shipping (ii) makes it true)? This is
   a product call about whether sign-out should behave like "log out of a
   shared computer" (aggressive, no surprises later) versus "pause,
   resumable" (today's actual behavior, undocumented as such).
2. **Widen `hasUnsyncedChanges`'s trigger condition?** Today it only
   reflects an ALREADY-FAILED push (`profilePushFailed`/`feedPushFailed`).
   Scenario (a)'s realistic trigger — an edit sitting inside the live
   700ms debounce, never yet attempted — sets neither flag, so today's
   warning silently does not fire for the case this item is actually
   about. Widening it needs a small new "dirty right now" signal exposed
   from `profile-sync.tsx`; a product call on whether the reader should
   see an extra confirmation click more often (whenever they sign out
   moments after typing something), or whether the flush should stay
   silent and only surface the existing warning on genuine failure.
3. **The flush's time bound.** This guide estimates 1-2s (sign-out is a
   more impatience-sensitive moment than, say, UPLOAD's 15s "Try again"),
   but the exact number is a UX tuning call, not determined here.
4. **Notes (Q1 row 7) are outside this item's mandate** (never reach any
   account, by explicit existing design, disclosed at `/privacy`) but
   remain readable by the next physical person at a shared device
   indefinitely, unrelated to sign-in/out. Whether the project's privacy
   promise should also cover "this device's data must not outlive the
   person who wrote it, on a device other people use" is a broader
   product question (e.g. a device-level "clear my data" affordance) —
   flagged, not designed here.
5. **The (b)-i list-merge safety is fragile-by-coincidence** (Q2). If the
   manager ships (ii) without (i), this coincidental behavior remains the
   *only* thing preventing a list leak whenever a clear/flush is skipped
   or fails partway — worth knowing explicitly before deciding to ship
   (ii) alone.
6. **Retroactive exposure.** If this mechanism has already been hit for a
   real (non-construction) account pair before this fix ships, no client
   code change can retroactively remove data already written to a real
   account row. Whether any server-side audit/remediation is wanted is a
   separate, manager-level question this investigation cannot answer from
   local code alone.

## Q6 — Severity

**Technical rating: HIGH, privacy, pre-existing** (matches §1bq.6(a) and
the PROFILE-LISTS-A finding this item was opened from; this investigation
both confirms it independently and widens it to the preference ledger).

**In plain words:** if two different people sign into Peer, one after the
other, on the *same* browser (a shared or borrowed computer), anything the
first person typed but hadn't yet finished saving — a research topic, a
project description, even a "not interested" click — can end up saved
under the *second* person's account instead of staying private. It only
takes ordinary bad timing (closing the tab right after typing, before the
save that normally happens automatically), not any unusual action by
either person. Separately, and just as important: even if nobody signs in
as anyone else, the first person's information stays sitting on the
screen — visible to the next person who opens that browser — until
someone signs in. Saved papers and reading history do NOT have this
problem; that part already clears itself correctly when someone signs
out. The fix is well understood, small, and closely follows a pattern
already working elsewhere in this codebase for the exact same kind of
problem.

---

## STATUS: COMPLETE (2026-09-30T10:47:00Z)

All six questions answered above, by execution where the brief requires
it (Q2, plus the feed-store side of Q1) and by design/reading where it
asks for a design (Q3-Q6). Nothing under `web/` was created or modified;
no network call; no commit/push/branch/worktree operation; no file
outside `<scratchpad>/` or `docs/jev-abc/` was written; no API key was
read, printed, or written; every value used in every executed script is a
fictional `construction-*` construction; no person's name appears
anywhere in this document.

### (a)-(e) result table

| Scenario | Result |
|---|---|
| (a) A signs out WITH an unsynced edit, B signs in | **LEAK, confirmed.** A's unsynced topic, project text, AND (new in this item) preference-ledger entry all reach B's real account row. |
| (b) A signs out FULLY SYNCED, B signs in | **Split.** Scalars: safe. Lists: safe today, but only by a coincidental side effect of a rule meant for something else (named explicitly above, not to be relied on). Preference ledger: **LEAKS even with zero unsynced edits anywhere else** — confirms the manager's UNVERIFIED §1bq.6(a) claim. |
| (c) A signs out, A signs back in | **Safe today** (nothing is ever cleared, so nothing is lost) — but this safety is exactly what a careless "clear on sign-out" fix would break; any fix must flush before clearing. |
| (d) Never-signed-in reader edits, signs in for the first time | **Still works**, both when the account row does not exist yet and when it exists but is empty. Untouched by anything this item should change. |
| (e) Device shows A's data to B before B signs in (screen only) | **CONFIRMED, a distinct exposure.** The store is byte-identical before/after sign-out; the Profile page renders every field unconditionally (not gated on auth state) — a second person at this browser sees A's data with no sign-in click required at all. Only a clear-on-sign-out design reaches this case. |
| Feed store (saved papers/reads/feedback) | **Not affected by any of the above** — already clears itself correctly on sign-out (`resetLocal`, proven by executing the real action) and already carries a working owner-key mechanism (`syncedUserId` + `sessionStep`, proven by executing the real function) that the profile store has no equivalent of. |

### Recommended design, five lines

1. Add a persisted `syncedAccountId` to the profile store (mirrors the
   feed store's already-shipped `syncedUserId`); on sign-in, a different
   id than last time calls the already-existing `logOut()` before today's
   merge runs — closes (a)/(b) structurally, at the smallest cost.
2. On a confirmed sign-out, attempt one bounded, best-effort flush of any
   unsynced edit (starting at the `onSubmit` hook, the only point a
   session is still valid to push against), then clear local profile
   state via the same `logOut()` — closes (e), the one thing option 1
   cannot reach.
3. Ship both together: option 1 alone already removes all privacy risk;
   option 2 adds the screen-only fix and reduces (but cannot remove) a
   data-loss residual when a flush fails.
4. Serialize `pullMergeAndPush` (an in-flight flag + one coalesced
   follow-up) to close the §1bq.6(b) MEDIUM debounce-rearm finding in the
   same change, same file.
5. Six POLICY questions are the manager's, not designed here — chiefly
   whether the clear should be unconditional or stay behind a (now
   accurate) confirmation, and whether the existing "unsynced changes"
   warning should widen to catch a live pending edit, not only an
   already-failed push.

### Search scope for "not found" / "NO" claims in this guide

- Q1's inventory: `grep -rn "persist("` and `grep -rln
  "localStorage\|indexedDB"` over `web/src` (excluding `*.test.*`); every
  matching file was opened and read at the cited lines. Not searched:
  `web/node_modules`, anything with no browser-storage touchpoint.
- "No other code path clears the profile store on sign-out" (Q2(e)/Q1 row
  1-3): established by reading `web/src/components/profile-sync.tsx` and
  `web/src/components/account/account-section.tsx` in full (every line),
  plus `web/src/app/auth/signout/route.ts` in full (9 lines, the entire
  route), plus grepping `web/src/store/profile.ts` for every call to
  `logOut` — one definition, one call site
  (`web/src/app/profile/page.tsx`'s "Reset profile to defaults" button,
  per the PROFILE-LISTS-A finding this item inherited and did not need to
  re-derive).
- "The Profile page does not gate profile fields on auth state" (Q2(e)):
  `grep -n "useProfileStore\|auth\.kind\|authKind\|useAuthUser"
  web/src/app/profile/page.tsx`, then read the two relevant call sites
  (line 166's unconditional destructure, line 1626's `signedIn`-gated
  email section) directly.
- "Uploads cannot cross accounts" (Q1 row 6): read
  `web/src/lib/papers/upload-access.ts` in full (65 lines).
- Everything executed in Q2/Q4 is proof by running the cited real
  function, not by reading alone; every script and its full transcript
  live under `<scratchpad>/acs-*.mjs` for re-run.
