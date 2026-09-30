STATUS: COMPLETE

# DISLIKE-CHANNEL — investigation (agent B)

Investigator: agent B, ABC loop. Read-only on every repo product file (no
product file edited; only this doc, under docs/jev-abc/, and scratchpad
scripts under `<scratchpad>/`). Branch
Jev-integration-and-sorting-filtering-enhancement, HEAD 490d67b3.
Started: 2026-09-30T08:39:33Z.

Binding background: ABC-JEV-INTEGRATION.md §1at (SCORE-ZERO rulings) and its
CORRECTION (2026-09-29T03:3xZ); §5 row DISLIKE-CHANNEL. The CORRECTION
already established, by execution: in every real request a reader's own
dislike reaches `profile.exclusions` (combine.ts ~:195, hard drop, runs
first), so `negativePenalty` (×0.15) and `legacyDislikePenalty` (×0.65) are
unreachable for reader dislikes. This item's job is broader: enumerate every
production UI entry point for "less of this," trace each to what it actually
changes and for how long, re-prove the dead/live question by my own
execution (not just cite the CORRECTION), check the daily email path, check
the AGENTS.md "don't overreact to one signal" rule with a constructed case,
and lay out options with cache/test implications. POLICY calls go to the
manager, not decided here.

## Plan

1. Read AGENTS.md, docs/PRODUCT_DIRECTION.md, web/AGENTS.md, ABC-JEV-INTEGRATION.md
   §1at + CORRECTION + §5 DISLIKE-CHANNEL row, SCORE-ZERO A/B/C docs. DONE
   (see above; feedback-loop rule quoted below).
2. Grep the app for every production "less of this" UI entry point (thumbs
   down, "Not interested", "Less like this", "dislike", "avoid", "hide") —
   list each with verbatim visible label and screen.
3. Trace each entry point through its store action (store/feed.ts,
   store/profile.ts, web/src/lib/preferences/) to what it writes.
4. Trace how a feed request is built from that state (exclusions,
   negativeTopics, dislikedTopics, the ledger) for both the browser feed and
   the daily email's request builder
   (web/src/app/api/jobs/dispatch-digests/route.ts).
5. Re-derive, by executing the real scoring functions through the read-only
   resolver hook (copied to `<scratchpad>/dch-hook.mjs`), whether
   negativePenalty / legacyDislikePenalty can fire in any real request —
   confirming or correcting the CORRECTION's claim independently.
6. Construct one concrete "overreaction" case per the AGENTS.md rule (one
   dislike → what else disappears) and run it for real.
7. Write options (delete / repurpose / comment), smallest first, with cache
   (PAPER_CACHE_KEY_VERSION) and test implications, POLICY items flagged.
8. Severity in plain words. Finish with entry-point table, verdict, options,
   POLICY list, search-scope note. STATUS: COMPLETE.

Relevant rule already on file (docs/PRODUCT_DIRECTION.md, "Feedback Loop"):
explicit feedback listed includes "Not interested" and "Like or dislike";
"Ranking updates should be gradual. Use moving averages or similar smoothing
so one click does not overcorrect the profile." AGENTS.md, "Decision
priorities": "Feedback should tune future retrieval gradually, not overreact
to one signal."

## Progress log

- 2026-09-30T08:39:33Z — doc created, plan above, starting step 2 (UI grep).
- 2026-09-30T08:53:34Z — Q1 entry-point trace done (reading + grep, exhaustive
  search scope recorded below). Q2 and Q3 proven by real execution through
  the resolver hook (scripts + output recorded below). Q4/Q5 drafted. Writing
  full sections now.

---

# Q1 — every production "less of this" entry point, traced to what it changes

## Method

Grepped `web/src` for `thumbs|Not interested|Less like this|Dislike|dislike|
avoid|Hide|hide|Remove|remove` and for every store-level identifier those
hits led to (`notInterestedPaper`, `moreLikePaper`, `dislikedTopics`,
`negativeTopics`, `exclusions`), then found every non-test call site with
`grep -rn "notInterestedPaper\|moreLikePaper" web/src --include=*.tsx
--include=*.ts | grep -v ".test."`. Cross-checked against
`web/src/lib/keys/help.ts` and `web/src/lib/reader/reader-keys.ts` (the two
files the app's own Help sheet reads its labels from, so nothing here is a
guessed label). No event/job "dislike" surface exists in the current
UI — `notInterestedPaper`/`moreLikePaper` are paper-only; events/jobs have
their own `notInterestedEvent`-shaped actions not requested by this item
(out of scope: DISLIKE-CHANNEL's brief and the ABC-JEV-INTEGRATION.md ledger
row both say "reader's own dislikes" for papers, and the JEV branch is
papers-only per `peer-papers-only-pivot-and-followup-branch` — not re-stated
here, just consistent with it).

## Entry points (7 production call sites, all papers, all funnel into ONE store action)

| # | Screen | Element | Visible label (verbatim) | Calls |
|---|---|---|---|---|
| 1 | Home briefing (feed grid) | Icon button on the card, next to "Like" | `aria-label="Not interested — show less like this"`, `title="Not interested"` | `web/src/components/cards/feed-tile.tsx:273-283` → `notInterestedPaper(paper)` |
| 2 | Home briefing (feed grid) | Swipe left on the card | Reveal label `"Not interested"` (`SwipeableCard leftLabel`) | `feed-tile.tsx:162-167` → `onSwipeLeft={() => notInterestedPaper(paper)}` |
| 3 | Home briefing | Keyboard `x` (card focused) | Help sheet: `"Not interested"` (`web/src/lib/keys/help.ts:39`) | `web/src/components/keyboard.tsx:219-227` → `useFeedStore.getState().notInterestedPaper(paper)` |
| 4 | Saved page | `ActionBar`'s dismiss button on each `PaperCard` | `aria-label`/`title="Dislike — show me less like this"` | `web/src/components/cards/paper-card.tsx:75` (`onDismiss`) → `web/src/components/ui.tsx:340-346` → `notInterestedPaper(paper)` |
| 5 | Paper detail page (`/papers/[id]`) | Footer action button (`DecisionBlock`) | Visible text `"Skip"` (`BUTTON.skip`, `web/src/components/reader/copy.ts:132`), keyboard hint `x` shown on the button itself | `web/src/app/papers/[id]/page.tsx:1112` (`onSkip={skip}`) → `page.tsx:838-845`'s `skip()` → `store.notInterestedPaper(paper)` |
| 6 | Paper detail page | Swipe left on the plate/figure | Reveal label `"Not interested"` (`SWIPE.notInterested`, `copy.ts:141`) | `page.tsx:1068` (`onSwipeLeft={skip}`) → same `skip()` |
| 7 | Paper detail page | Keyboard `x` | Help sheet / on-page legend: `"Not interested, then next"` (short: `"skip"`) — `web/src/lib/reader/reader-keys.ts:39` | Reader-keys registry → same `skip()` |

All seven are the same underlying store action, `notInterestedPaper` in
`web/src/store/feed.ts:2327-2348` (entry points 5-7 go through the page's
own `skip()` wrapper, `page.tsx:838-845`, which calls it and then navigates —
the dismissal itself is identical). There is no separate "Dislike" concept in
the codebase; "Not interested" / "Dislike" / "Skip" are three different
visible spellings the UI uses in three places for the exact same action and
the exact same consequence. The "Like" button (`moreLikePaper`) is the
positive counterpart, not investigated further here except where it shares
code with the negative path.

## What `notInterestedPaper` actually does, traced to the end (by reading + execution)

`store/feed.ts:2327-2348`: synchronously (a) removes the paper from
`papers`/`savedPapers` in the local Zustand store (it disappears from the
screen immediately) and (b) stores a `pendingDismissal` with a 4-second
undo window (`u` key / a toast — `undoDismiss`, `feed.ts:2773`). Nothing
about WHICH topic or term was disliked is recorded yet.

After 4 seconds (or immediately, if the reader dismisses a second paper
before the first one's window closes — `feed.ts:2329-2330`),
`commitDismiss` (`feed.ts:2857-2911`) fires exactly two things:

1. `useProfileStore.getState().recordPaperPreference(paper, "negative")`
   (`store/profile.ts:505-519`) → `applyPreferenceSignal` on
   `profile.preferenceLedger` (`web/src/lib/preferences/ledger.ts:415-473`).
   **Proven gradual and bounded by real execution** (script
   `<scratchpad>/dch-q1-ledger.mjs`, output below): a paper sharing the
   SAME concept as the disliked paper (matched by a structured concept key,
   `preferenceKey()`, `text:<label>` fallback — not a raw substring against
   the whole pool) gets a score multiplier of **0.8229** after one dismissal,
   **0.7155** after two, and never below **0.4** (`NEGATIVE_PENALTY_MAX =
   0.6`, `ledger.ts:27`) no matter how many repeats — and the effect decays:
   the same one dismissal, read back 60 days later
   (`HALF_LIFE_DAYS = 60`, `ledger.ts:19`), is back up to **0.9005** (almost
   no effect). An unrelated concept is untouched (`penalty = 1`) in every
   scenario. This is exactly the codebase's OWN documented contract for
   this mechanism (`app/profile/page.tsx:1133-1136`: "dismissing eases a
   topic down"; `:1164`: "Weights fade over ~2 months") — and it is the
   ONLY thing any of the 7 entry points above actually feeds.
2. `get().submitFeedback(pending.id, "paper", "notInterested",
   feedbackSnapshotForPaper(paper))` (`feed.ts:2863-2868`) →
   `cloudFeedback` → `POST /api/feedback` (signed-in only; a signed-out
   reader's local removal + ledger update still happen, the cloud POST is
   best-effort/queued — `web/src/app/api/feedback/route.ts:52-59` returns
   401 with no session). The route's own comment: **"Append-only signal
   stream. Future Tier 1/2 re-ranking reads from here."** — i.e. by the
   code's own admission, most of what lands here is not yet acted on.

   The ONE thing that IS read back from this stream today:
   `web/src/lib/preferences/positive-seeds.ts`'s
   `resolveNegativeSeedPaperIds` (`positive-seeds.ts:30-38`, bounded to the
   most recent **10** dismissed papers, latest-event-wins per paper) feeds
   `negativePaperIds` into exactly one retrieval adapter,
   `web/src/lib/sources/semantic-scholar-recommendations.ts:166-175` — a
   hint to the Semantic Scholar Recommendations API's OWN external
   algorithm to steer away from papers similar to the ones just dismissed.
   Signed-in only (needs `feedback_events` rows tied to a `user_id`); one
   of several retrieval channels; bounded to 10; does not touch scoring,
   exclusion, or any other channel.

**Nothing among these 7 entry points, at any point on this trace, ever
writes to `profile.dislikedTopics`.** That field is what feeds the OTHER
three mechanisms (hard exclusion, `negativePenalty`, `legacyDislikePenalty`
— see Q2). Exhaustive search (scope recorded at the end of this doc) found
no production code path from any button, swipe, or key to that field.

## Where `profile.dislikedTopics` (the field Q2/Q3 are about) actually comes from

`dislikedTopics?: string[]` (`web/src/types/index.ts:456`, default `[]` at
`:581`) is:
- Read to build `negativeTopics` for a feed request:
  `web/src/store/feed.ts:740,778`.
- Read/written whole on profile GET/PUT:
  `web/src/app/api/profile/route.ts:83,127` (`row.disliked_topics` ↔
  `p.dislikedTopics`, a straight pass-through of whatever the client PUTs).
- Merged from a REMOTE profile snapshot on sign-in/sync only:
  `web/src/store/profile.ts:741` (`if (remote.dislikedTopics !== undefined)
  merged.dislikedTopics = remote.dislikedTopics`).
- Converted into `NormalizedFeedIntent.exclusions` at three separate
  boundaries, always from this same field, never from anything else:
  `web/src/lib/feed/intent.ts:230` (`raw.exclusions ?? raw.negativeTopics`,
  browser request normalization), `:256` (`profileFeedIntentCard`, server
  reading a stored profile row), and the digest job's own
  `digestFeedRequestFromProfile` (`web/src/app/api/jobs/dispatch-digests/
  route.ts:335-360`, `exclusions: row.disliked_topics`).

**No production store action writes to it.** Full enumeration of
`store/profile.ts`'s `update*`/`set*` actions (32 actions, listed by
grepping every `update[A-Za-z]*:`/`set[A-Za-z]*:` declaration) contains
`updateTopics` (Required), `updateSoftTopics` (Explore),
`updatePreferredJournals`, `updateFeedAvoidReviews/OldPapers/BroadSurveys`
(the system-policy booleans, unrelated to per-item dislikes — these feed
`brief.avoid`, already investigated under SCORE-ZERO) — no
`updateDislikedTopics` or equivalent exists. `web/src/app/profile/page.tsx`
wires exactly three chip editors (`updateTopics`, `updateSoftTopics`,
`updatePreferredJournals` — page.tsx:1878-2026) and the three Avoid
booleans (page.tsx:2050-2066); no fourth "topics to avoid" chip list exists.
`git log --all -S "dislikedTopics" -- web/src/app/profile/page.tsx` returns
**zero commits** — this field has never had a UI in this repository's
history, not "had one, then lost it."

**Conclusion for Q1:** today, a reader has no way to populate
`dislikedTopics`. The three mechanisms it feeds (hard exclusion,
`negativePenalty`, `legacyDislikePenalty`) are not merely "unreachable
because a hard filter runs first" (the §1at CORRECTION's framing) — they
are unreachable because **nothing writes the field they all read**. The
only "less of this" the product actually delivers today is the gradual,
bounded, decaying preference-ledger effect above, plus (signed-in only) a
bounded nudge to one external recommendation channel.

## Per-entry-point answer: what disappears, and for how long

Identical for all 7 (they are the same action): the clicked/swiped/keyed
paper **disappears from the current screen immediately** (undoable for 4s).
**No other paper is affected right away.** After the 4-second window
closes, a same-concept paper shown **later** (a future day's feed) scores
about **18% lower** (×0.8229) than it otherwise would; this compounds
slightly with repeats and fades back to no effect over about two months.
Nothing is ever permanently or completely removed by this path, and no
paper containing merely a shared common word (rather than the same
taxonomy concept) is ever touched by it. Contrast with Q3 below, which is
what WOULD happen on the dead/unreachable channel if it were ever wired to
a UI.

---

# Q2 — can `negativePenalty` / `legacyDislikePenalty` fire in any real request? Proven by execution

## Current source (read in full, `web/src/lib/scoring/combine.ts`)

```
198   const exclusions = profile.exclusions ?? [];
...
207   for (const item of items) {
208     if (exclusions.some((term) => topicMatchesItem(item, term))) continue;
...
271     if ((literalMustTopics.length > 0 || selectedSenseConcepts.length > 0) && kw.score === 0 && !admittedByNonLiteralChannel) continue;
272     passed.push({ item, kw, softKw: ..., tf: ... });
273   }
274   // Pass 2 — only over `passed`, i.e. only items that survived the exclusion filter above.
...
355     const policyPenalty = negativePenalty(item, profile.negativeTopics ?? []);
356     const legacyPenalty = legacyDislikePenalty(item, profile.legacyNegativeTopics ?? [], mustTopics);
```

(line numbers as of HEAD 490d67b3; the §1at CORRECTION's "~195"/"141-145"/
"147-158" refer to the same lines on an earlier HEAD — unrelated code has
been inserted above them since, e.g. REQUIRED-GATE's T4 block).
`negativePenalty` and `legacyDislikePenalty` (defined `combine.ts:141-158`)
are only ever called inside the `passed.forEach` loop (Pass 2) — an item
the `exclusions` filter dropped in Pass 1 never reaches that loop.
`topicMatchesItem` (`combine.ts:119-125`) is the identical function both
the exclusion filter and both penalties use.

`web/src/lib/feed/pipeline.ts:1374-1399` (`scorePaperCandidates`, the sole
place `scoreItems` is called from the real pipeline) wires all three from
the request: `negativeTopics: userNegativeTopics`,
`legacyNegativeTopics: userNegativeTopics` (`userNegativeTopics =
req.negativeTopics ?? []`, line 1380), and separately
`exclusions: req.intent?.exclusions.map((entry) => entry.value)` (line
1395). Every real caller derives `req.negativeTopics` and
`req.intent.exclusions` from the identical source list — re-confirmed on
this HEAD: `web/src/app/api/feed/route.ts:735` (`const negativeTopics =
intent.exclusions.map((exclusion) => exclusion.value)`, then reused at
`:770` and `:837`); `web/src/app/api/jobs/dispatch-digests/route.ts:354`
(`negativeTopics: intent.exclusions.length ? intent.exclusions.map(...) :
undefined`, same `intent` object). So in production `negativeTopics`,
`legacyNegativeTopics`, and `exclusions` are always the same list of
strings — meaning by construction, not luck, an item any of them would
match is always dropped by the line-208 filter before Pass 2 runs.

## Proof by execution (not just reading)

Script `<scratchpad>/dch-q2-q3-exec.mjs`, run via the read-only resolver
hook (`<scratchpad>/dch-hook.mjs`, copied from `<scratchpad>/pusf-hook.mjs`
and extended — see "Resolver hook" section below) against the REAL,
unmodified, exported `scoreItems` from `combine.ts`. Three fictional
papers (CONSTRUCTIONS, no real data): `target` and `victim` both titled
around `"Layered Oxide Cascade ... in Porous ..."` (share the word
"porous"), `control` with no "porous". Profile topic (also a construction):
`"layered oxide cascade"`.

Command:
```
cd <scratchpad>
node --no-warnings --import "data:text/javascript,import{register}from'node:module';import{pathToFileURL}from'node:url';register('./dch-hook.mjs',pathToFileURL('./'));" dch-q2-q3-exec.mjs
```

Real output:

| Scenario | profile fields set | target | victim | control |
|---|---|---|---|---|
| A — baseline | none | 0.5740 | 0.5740 | 0.2990 |
| B — UNREALISTIC (`negativeTopics`+`legacyNegativeTopics` only, no `exclusions`) | `{negativeTopics:["porous"], legacyNegativeTopics:["porous"]}` | 0.0560 | 0.0560 | 0.2990 (untouched) |
| C — REAL shape (all three, matching pipeline.ts's actual wiring) | `{negativeTopics:["porous"], legacyNegativeTopics:["porous"], exclusions:["porous"]}` | **ABSENT** | **ABSENT** | 0.8490 |

**Import-chain disclosure (required by this item's brief):** `combine.ts`
imports `canonicalize`/`termSpecificity` from `./term-expand`
(`combine.ts:22`) — one of the three files C is actively editing/testing in
this same checkout right now (`web/src/lib/scoring/term-expand.ts`, per
this session's git status). This script's exact NUMBERS above (0.5740,
0.2990, 0.0560, 0.8490, the 0.0975 ratio) therefore reflect whatever
`term-expand.ts` currently does on disk at the moment each run executed,
not a frozen/independent baseline — they could shift if C's in-progress
edits change. The STRUCTURAL finding they support (target/victim present
vs. absent across scenarios A/B/C) does **not** depend on `term-expand.ts`:
presence/absence is decided entirely by the boolean substring check at
`combine.ts:208` (`exclusions.some((term) => topicMatchesItem(item,
term))`), which does not call into `term-expand.ts` at all — confirmed by
reading `topicMatchesItem`'s own body (`combine.ts:119-125`), which only
calls `normalizePhrase` (`./tokenize`). `dch-q1-ledger.mjs`
(`preferences/ledger.ts`) and `dch-q1-email.mjs` (`feed/intent.ts`) do not
import any of C's three in-progress files (`profile-compiler.ts`,
`term-expand.ts`, `pool-cache.ts`) at all — checked by reading their
import lists directly.

Scenario B's ratio to baseline is **0.0975**, exactly `0.15 × 0.65` — real,
independent, executed confirmation that when the two penalties CAN fire in
isolation they stack multiplicatively exactly as `combine.ts` defines them.
Scenario C shows they never get the chance in the real request shape: the
target item is gone from `result.items` entirely, not merely scored down —
`negativePenalty`/`legacyDislikePenalty` are not even evaluated for it
(Pass 2 never sees it). Control's score rises in scenario C (0.2990 →
0.8490) only because the `topicality` signal is pool-relative
(`poolPercentile`, `combine.ts:101-117`) and the pool shrank to one
surviving item — an expected, already-documented side effect of removing
candidates from the pool, not a second bug.

## Q2 verdict

**Dead**, confirmed by execution, independently reproducing the §1at
CORRECTION's finding with a fresh construction rather than citing its
numbers. `negativePenalty` and `legacyDislikePenalty` cannot fire on a
reader's own declared dislike in the real browser feed (`api/feed/route.ts`)
or the real daily email (`dispatch-digests/route.ts` — confirmed below,
Q1/email section) in current production code, because (a) nothing writes
`dislikedTopics` from any UI (Q1), and (b) even if it were written, the
identical term always also reaches `exclusions`, which runs first and drops
the item outright (this section). Two independent reasons stack — either
alone is already sufficient for "dead."

---

# Q3 — does any path overreact to one signal? Constructed case, by execution

AGENTS.md, "Decision priorities": "Feedback should tune future retrieval
gradually, not overreact to one signal." `docs/PRODUCT_DIRECTION.md`,
"Feedback Loop": "Ranking updates should be gradual. Use moving averages or
similar smoothing so one click does not overcorrect the profile."

## The reachable channel (Q1's preference ledger): does not overreact

Shown above by execution: one signal moves a same-CONCEPT paper's score by
about 18%, never removes anything, never touches an unrelated concept, and
fades over ~2 months. This matches the rule.

## The unreachable channel (`dislikedTopics` → hard exclusion): would overreact, if it were ever wired to any input

Same script/run as Q2 (`<scratchpad>/dch-q2-q3-exec.mjs`, scenario C,
output above, real execution, not estimated): setting the dislike term to
a single common word taken from the disliked paper's own title
(`"porous"`) does not just remove the disliked `target` paper — it also
removes `victim`, a DIFFERENT, independently on-topic paper (same
baseline score, 0.5740, as `target`) that the constructed reader never saw
or expressed any opinion about, solely because its title also contains the
word "porous". `control`, which shares the Required topic but not that
word, is unaffected. Mechanism: `topicMatchesItem`
(`combine.ts:119-125`) does a plain, case-insensitive **substring** match
of the whole term against `title + abstract + tags` joined — it has no
concept identity, no specificity weighting, and (unlike the ledger) no
decay and no repetition requirement. One match, on one word, in one field,
removes the paper forever (until the term is removed from
`dislikedTopics`), for every future request, for every paper that happens
to contain that substring anywhere in its title, abstract, or tags —
including papers published after the dislike was recorded, that the reader
has never seen.

This is a real property of real, shipped code — `combine.ts:208` and
`topicMatchesItem` are unmodified, current, and (per Q2) already covered by
`admission.test.ts` for the hard-drop behavior in general. It is simply not
reachable by any reader action today (Q1), so it cannot overreact to a
signal a reader has no way to send. **If a future UI feature were ever
wired to write to `dislikedTopics` in this literal, single-term-string
form (the field's only existing shape), it would overreact exactly as
constructed above on day one, with no test currently in the repo that
would catch it** (existing tests exercise the exclusion filter with
distinct, non-overlapping fixture text — see Q4).

## Q3 verdict

No production path overreacts today, because the only reachable path
(the ledger) is already gradual by design and the blunt path
(hard exclusion) is not reachable. The overreaction risk is latent in the
dead channel's mechanism, not currently live. This is exactly the nuance
the §1at CORRECTION asked this item to check rather than assume: "today's
behaviour" does not overreact; the CODE that WOULD run if fed a dislike
does.

---

# Q4 — options, smallest first

POLICY markers below are for the manager; nothing here decides them.

## (a) Delete the dead channels

Remove `negativePenalty`, `legacyDislikePenalty` (`combine.ts:141-158`),
their call sites (`combine.ts:355-360` and the `policyPenalty`/
`legacyPenalty` factors in the `combined` formula, `:389`), the
`negativeTopics`/`legacyNegativeTopics` fields from `ScoringProfile`
(`types.ts:13-14`) and their wiring (`pipeline.ts:1380,1391-1392`).
**Leave `profile.exclusions`/the hard-drop filter untouched** — it is a
separate, working, already-tested mechanism; nothing in this item found a
defect in it, only that nothing feeds it.
- **What the reader would notice:** nothing. Confirmed by this item's own
  Q2 execution — the removed code paths already produce no observable
  difference in any real request.
- **Cache:** `PAPER_CACHE_KEY_VERSION` (currently 20,
  `pool-cache.ts:383` — a direct one-line grep read of a constant
  assignment in a file C is actively editing/testing right now; disclosed
  per this item's constraint; not relied on beyond that single number, and
  not something a "dead code deleted, nothing else changes" edit would
  itself need to touch beyond incrementing it) — a cached `CachedPaperPool.items` is
  `ScoredItem[]`, i.e. it bakes in `score`/`scoreBreakdown` computed under
  the OLD formula. Since the old and new formulas are provably
  numerically identical for every real request (Q2: the removed factors
  are always `1` in practice), a stale cached score is byte-identical to
  what the new code would have produced — **no bump strictly required by
  correctness**, but this loop's own convention (every SCORE-ZERO-adjacent
  change bumped the version even for score-only changes) argues for
  bumping anyway for auditability/rollback safety. POLICY — manager
  decides whether to bump on a change proven score-identical.
- **Tests:** `negative-penalty.test.ts` (currently 3 tests unit-testing
  `negativePenalty` in isolation, explicitly labeled "UNIT-LEVEL ONLY... not
  a claim about production behavior," `negative-penalty.test.ts:19-32`) has
  nothing left to test if the function is deleted — per this item's brief
  ("tests rewritten to the new contract, never deleted"), rewrite it to
  assert the NEW contract instead of deleting it outright: e.g. that
  `ScoringProfile` no longer accepts/uses `negativeTopics`/
  `legacyNegativeTopics` (a type-level or dead-field regression test), or
  repurpose the file to test that a reader's declared dislike is fully
  governed by `profile.exclusions` alone end-to-end (folding its "own
  declared dislike" scenario into an exclusions-focused test, which
  `admission.test.ts` may already cover — C should check for overlap
  before adding). `pipeline.score-zero.test.ts`'s "reader's own declared
  dislike... removes the paper entirely" test (`:224`) is about
  `exclusions`, not the deleted functions — unaffected, stays as is. The
  mutation this option's C round should prove: re-adding either deleted
  penalty factor to `combined` must turn a rewritten test red.

## (b) Repurpose: one dislike demotes gradually, only a stronger/repeated signal excludes

Change `combine.ts`'s Pass-1 exclusion filter (`:208`) so a single
`dislikedTopics` entry no longer `continue`s immediately — instead it
demotes (routes through something like today's dead `negativePenalty`, or
reuses the already-gradual, already-tested preference-ledger mechanism from
Q1) and only excludes once a threshold is crossed (POLICY: what counts as
"stronger or repeated" — a second explicit action on the same term? a
decayed ledger count crossing a fixed value, mirroring
`NEGATIVE_PENALTY_MAX`'s existing shape? a manager call, not this item's).
This is the option that would need a genuine design, not just a wiring
change — it also implicitly requires deciding whether `dislikedTopics`
ever gets a UI at all (today it has none — Q1), since repurposing a dead
field's scoring behavior without also giving it an input is a change with
no reachable effect, same as today.
- **What the reader would notice:** nothing changes until/unless
  `dislikedTopics` also gets a UI (POLICY, larger than this item — Q1
  found no writer for it anywhere). If it does, first use of "dislike"
  would visibly demote rather than remove; repeats would eventually remove.
- **Cache:** same field (`CachedPaperPool.items`, `ScoredItem[]`) bakes in
  scores computed under whichever formula was live when cached — this
  option DOES change real scoring behavior (for any future non-empty
  `dislikedTopics`) so `PAPER_CACHE_KEY_VERSION` should bump. POLICY:
  exact new value is C's/the manager's call at implementation time.
- **Tests:** needs new tests for the threshold logic itself (unit,
  something not in the repo today since the threshold doesn't exist yet):
  one signal demotes and the item still appears; N signals (POLICY: what
  N) exclude; decay interacts correctly with the threshold count. Mutation
  targets: removing the threshold (reverting to instant exclusion on one
  signal) must turn a test red; removing the demotion (going back to no
  effect at all below threshold) must turn a different test red.
- This is the only option that actually satisfies the AGENTS.md rule FOR
  THE CASE WHERE `dislikedTopics` some day gets an input — but it is also
  the only option that requires a real design decision (POLICY) rather
  than a cleanup.

## (c) Leave them, with an honest comment

Minimal: no code deleted, no behavior changed. Add a comment at
`combine.ts:141` (and/or `pipeline.ts:1374`, which already carries a
SCORE-ZERO doc comment that could be extended) stating plainly that
`negativeTopics`/`legacyNegativeTopics` are current dead code for reader
dislikes in production because the identical term always also reaches
`profile.exclusions` first, which is the actual and only live mechanism —
matching what `negative-penalty.test.ts`'s comment already says at the test
level, but currently absent from the product source itself.
- **What the reader would notice:** nothing, ever — this option changes no
  behavior.
- **Cache:** no change, no bump.
- **Tests:** none required; existing `negative-penalty.test.ts` and
  `pipeline.score-zero.test.ts` already describe the situation accurately
  post-CORRECTION. Optionally add one small regression test asserting the
  two fields remain unread by any code path other than
  `negativePenalty`/`legacyDislikePenalty` themselves (a "stay dead, don't
  quietly get wired to something new without a matching test" tripwire) —
  cheap, catches an accidental future re-wiring mistake like the one
  SCORE-ZERO fixed.
- Cheapest option; leaves both a latent overreaction risk (Q3) and dead
  code in place indefinitely. Does not by itself violate AGENTS.md (no
  reader is overreacted to, because nothing is reachable), but does not
  advance the product's stated "Feedback Loop" direction either — Peer's
  own docs (`docs/PRODUCT_DIRECTION.md`, "Explicit feedback": "Save / More
  like this / Not interested / Like or dislike") frame per-item dislike as
  one signal type, but the codebase quietly has TWO separate dislike
  systems (item-level ledger demotion vs. a topic-string hard exclude) that
  don't share an input today — option (c) leaves that split undocumented
  at the design-direction level even after commenting the code.

## POLICY list (manager decides; not this item's call)

1. Does `dislikedTopics` ever get a reader-facing UI at all — and if so,
   what does a reader actually type/click (a whole topic string? a
   per-paper action, like "Not interested" today, routed to a different
   backend)? Every option above is contingent on this.
2. If (b): what threshold counts as "stronger or repeated" — a count, a
   time window, reuse of the ledger's existing decay shape?
3. Should `PAPER_CACHE_KEY_VERSION` bump for a change proven score-identical
   for every real request today (option a), given this loop's own past
   practice of bumping even for score-only changes?
4. Is it acceptable that "Not interested" (grid), "Dislike" (Saved page),
   and "Skip" (paper detail page) are three different visible labels for
   the identical action and consequence (Q1's entry-point table)? Not this
   item's UX call, but noted since it surfaced during the trace.

---

# Q5 — severity, plain terms

Not urgent, not a live defect. Today, every "less of this" button, swipe,
and key a reader can actually use does something sensible: the disliked
paper goes away right now, and similar papers get a modest, fading
markdown-down later — never a hard, permanent removal, never collateral
damage to unrelated papers. That part already follows the "don't overreact"
rule and needs nothing.

The issue is that two scoring mechanisms in the code
(`negativePenalty`, `legacyDislikePenalty`) were built to do something
sharper — and, separately, an entire topic-exclusion system
(`dislikedTopics` → hard drop) exists, is fully wired end to end, and is
completely correctly implemented — but no button anywhere in the product
gives a reader a way to trigger it. It is inert, not broken. The risk is
entirely forward-looking: if anyone (an agent or a person) ever wires a
new UI straight to `dislikedTopics` without reading this investigation
first, they would ship the overreaction shown in Q3 on day one, silently,
because the existing tests around that field are unit-level only and
already say so in their own comments. That is a documentation/process risk
worth closing (Q4's options), not a reader-facing incident.

---

# Resolver hook and scripts (method record)

`<scratchpad>/dch-hook.mjs` — copied verbatim from `<scratchpad>/
pusf-hook.mjs`, then extended with exactly one new case this
investigation's import chain needed that earlier ones did not: `combine.ts`
→ `keyword.ts` imports `./reference-idf.json` as a plain specifier (valid
under this repo's real TS/bundler resolution) which Node's native
strip-only loader refuses without an explicit `type: "json"` import
attribute. The `resolve` hook now also injects that attribute for any
specifier ending in `.json`, and the `load` hook rewrites ONLY the matching
`from "...json"` text (never anything else in the file) to carry
`with { type: "json" }` before the same `stripTypeScriptTypes` primitive
the hook already used runs — full comment and rationale left in the hook
file itself. Every other resolution rule is untouched from
`pusf-hook.mjs`. Confirmed read-only: no file under `web/` was written by
this investigation (checked via `git status` after every run below).

Scripts (all in `<scratchpad>/`, all import ONLY real, unmodified,
already-exported functions — nothing ported or reimplemented from product
code):
- `dch-q2-q3-exec.mjs` — Q2 (dead/live) + Q3 (overreaction), via
  `combine.ts`'s real `scoreItems`. Full output in Q2/Q3 above.
- `dch-q1-ledger.mjs` — Q1's gradual-effect numbers, via
  `preferences/ledger.ts`'s real `applyPreferenceSignal`/
  `scorePreferenceMatch`. Full output in Q1 above.
- `dch-q1-email.mjs` — confirms the daily email's request builder derives
  `intent.exclusions` from `disliked_topics` the same way the browser feed
  does. **Adjusted approach, disclosed:** importing
  `dispatch-digests/route.ts`'s `digestFeedRequestFromProfile` directly
  pulls in an unrelated transitive dependency
  (`opportunities/private-paper-cache.ts`) that uses a TypeScript
  constructor "parameter property," which Node's strip-only loader cannot
  handle (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` — confirmed by running it
  once and hitting exactly that error). `digestFeedRequestFromProfile`
  itself (`dispatch-digests/route.ts:335-360`, quoted in full above) is a
  thin, pure wrapper around the real, exported `normalizeFeedIntent`
  (`web/src/lib/feed/intent.ts`, no such import problem) — this script
  imports and executes THAT real function directly, on the exact "legacy"
  object shape the wrapper builds by copying 5 row fields verbatim (also
  quoted above), so the part of the real code that actually decides
  whether `disliked_topics` reaches `exclusions` is genuinely executed;
  only the wrapper's own trivial field-renaming step (fully quoted from
  the real source, not reimplemented) was not separately re-run. Output
  confirms: `disliked_topics: []` (today's actual default) → `exclusions:
  []`; a constructed `disliked_topics: ["porous"]` → `exclusions:
  [{kind:"exclude-term", value:"porous"}]` — same shape, same mechanism as
  the browser path.

No network call was made by any script. No file under `web/` was read for
its data (only imported as code) except via the constructed fixtures
above, all labeled as constructions with fictional values.

---

# Search scope (for every "not found" / "no production writer" claim above)

- `grep -rn` (case-sensitive and `-i`) across `web/src` (all `.ts`/`.tsx`,
  excluding `node_modules`) for: `thumbs`, `Not interested`, `Less like
  this`, `Dislike`, `dislike`, `avoid`, `Avoid`, `Hide`, `hide`, `Remove`,
  `remove`, `negativeTopics`, `dislikedTopics`, `exclusions`,
  `avoidTopics`, `notInterestedPaper`, `moreLikePaper` — production files
  only (`| grep -v ".test."` where noted).
- Full read of `web/src/components/cards/feed-tile.tsx`,
  `paper-card.tsx`, `swipe-card.tsx`, `paper-plate.tsx`,
  `search-result-card.tsx` (grepped clean of dislike-related text).
- Full read of `web/src/app/papers/[id]/page.tsx`'s action wiring
  (~lines 780-1130), `web/src/components/keyboard.tsx` (full keyboard
  layer), `web/src/lib/reader/reader-keys.ts` (full),
  `web/src/lib/keys/help.ts` (full).
- Full read of `web/src/store/feed.ts`'s `notInterestedPaper`,
  `moreLikePaper`, `undoDismiss`, `commitDismiss`, `submitFeedback`
  (lines ~2300-2920) and `buildFeedRequest`-area code (~lines 700-840).
- Full read of `web/src/store/profile.ts`'s `recordPaperPreference` and
  every `update*`/`set*` action declaration (grepped exhaustively, ~32
  actions enumerated, none named for disliked topics).
- Full read of `web/src/lib/feed/intent.ts` (all 273 lines).
- Full read of `web/src/lib/preferences/ledger.ts`'s
  `applyPreferenceSignal`, `scorePreferenceMatch`, `conceptsFromPaper`,
  `conceptsFromRawItem`, `preferenceKey`, and every named constant
  (`HALF_LIFE_DAYS`, `NEGATIVE_PENALTY_MAX`, `POSITIVE_BOOST_MAX`).
- Full read of `web/src/lib/preferences/positive-seeds.ts`'s header
  comment and negative-seed resolver section (lines 1-180).
- Full read of `web/src/app/api/feedback/route.ts` (all 99 lines).
- Full read of `web/src/app/profile/page.tsx`'s `LearnedPreferences`
  component and every chip-editor wiring site (`updateTopics`,
  `updateSoftTopics`, `updatePreferredJournals`, the three Avoid
  booleans); grepped the whole file for `exclu`/`avoid`/`dislike`.
- Full read of `web/src/components/profile/field-kit.tsx` grepped for
  avoid/dislike-related props (none found).
- Full read of `web/src/components/persona/quiz.tsx` and `result.tsx`
  grepped for avoid/dislike/exclusion text (none found — onboarding does
  not collect a dislike list either).
- `git log --oneline --all -S "dislikedTopics" -- web/src/app/profile/
  page.tsx` — zero commits, run against the FULL history, not just this
  branch.
- Full read of `web/src/lib/scoring/combine.ts` (all 413 lines),
  `web/src/lib/feed/pipeline.ts`'s `scorePaperCandidates` and its doc
  comment (lines ~1357-1400), `web/src/app/api/feed/route.ts`'s
  negativeTopics/exclusions construction (grepped + read in context),
  `web/src/app/api/jobs/dispatch-digests/route.ts`'s
  `digestFeedRequestFromProfile` (full function, lines 313-360) and
  `feedControlsFromRow`/`seedTextsFromRow` immediately above it.
- Existing test coverage located by `grep -rln "exclusions:"` across
  `web/src/lib/scoring` and `web/src/lib/feed` (8 files, incl.
  `admission.test.ts`, `pipeline.score-zero.test.ts`) and by reading
  `negative-penalty.test.ts` (full, 115 lines) and
  `pipeline.score-zero.test.ts`'s two `describe`/`it` headers.
- NOT read in full (out of scope for this item, flagged rather than
  silently skipped): `web/src/lib/scoring/review-policy.ts`,
  `web/src/lib/scoring/rerank.ts`'s full body (only its role re:
  `brief.avoid` was needed, already established by SCORE-ZERO and cited,
  not re-derived here), `web/src/lib/feed/dedup.ts`, and the three files
  C is actively editing (`profile-compiler.ts`, `term-expand.ts` beyond
  the two named exports used, `pool-cache.ts`) — per this item's hard
  constraint, their current behavior was not relied on except where
  unavoidable and disclosed (the term-expand.ts import-chain note above).

---

STATUS: COMPLETE (2026-09-30T08:57:01Z)

## Final summary

**Entry-point table:** 7 production call sites (Q1 table above), all
papers-only, all funnel into the single store action `notInterestedPaper`
(`web/src/store/feed.ts:2327`) under three different visible labels ("Not
interested" — grid + keyboard; "Dislike — show me less like this" — Saved
page; "Skip" — paper detail page).

**Dead-or-live verdict (Q2):** `negativePenalty` and `legacyDislikePenalty`
(`combine.ts:141-158`) are DEAD for reader dislikes in every real request
(browser feed and daily email alike) — proven by fresh, independent
execution (not just citing §1at's CORRECTION) for two compounding reasons:
(1) no production UI writes `profile.dislikedTopics`, the only field that
feeds them (Q1); (2) even if it were written, the identical term always
also reaches `profile.exclusions`, a hard drop that runs first and removes
the item before either penalty is ever evaluated (Q2).

**Overreaction finding (Q3):** the only REACHABLE dislike mechanism (the
preference ledger, fed by all 7 entry points) is already gradual, bounded
(never below ×0.4), concept-scoped, and decaying (~60-day half-life) — it
does not overreact and needs no change. The UNREACHABLE mechanism
(`dislikedTopics` → hard exclusion) WOULD overreact if ever fed an input:
proven by execution that one constructed dislike removes not only the
disliked paper but a second, unrelated, independently on-topic paper that
merely shares one common word with it — permanently, with no decay.

**Options (Q4):** (a) delete the two dead functions, leave `exclusions`
alone, rewrite (never delete) `negative-penalty.test.ts` to the new
contract — cheapest, zero reader-visible change, cache bump optional/
POLICY; (b) repurpose so one signal demotes and only repetition excludes —
the only option that would satisfy AGENTS.md's rule if `dislikedTopics`
ever gets a UI, but needs a real threshold design (POLICY) and new tests;
(c) comment only, no behavior change, cheapest of all, leaves the latent
Q3 risk and the dead code in place.

**POLICY list (manager):** (1) whether `dislikedTopics` ever gets a
reader-facing UI at all, and what it would look like; (2) if option (b),
what "stronger or repeated" means numerically; (3) whether
`PAPER_CACHE_KEY_VERSION` bumps for option (a) despite being score-
identical for every real request; (4) whether three different visible
labels ("Not interested"/"Dislike"/"Skip") for one identical action is
acceptable.

**Severity:** LOW / not urgent. Nothing reader-facing is broken today; the
gap is dead code plus a documentation/process risk for whoever builds on
`dislikedTopics` next without reading this.

