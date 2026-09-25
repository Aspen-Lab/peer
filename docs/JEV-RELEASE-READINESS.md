# Jev / retrieval campaign — release readiness

**What this document is:** a plain-language explanation of where this project stands,
followed by a precise technical appendix for whoever does the actual switching-on work.

**What this document is not:** proof that anything has been tested with real users or
real data. Nothing in this campaign has made a single live call to any outside AI or
search service yet. Every number, every "it works," and every test result described
below comes from offline checks only — code read carefully, and run against fake or
recorded data, never real traffic. Anywhere this document says something passed a check,
it means "passed an offline check," never "proven in the real world."

---

## Part 1 — Plain language

### The big picture

This project is adding a set of new abilities to Peer: better ways to find papers,
a smarter (but paid) AI reviewer called Jev that double-checks whether a paper really
matches what you're working on, a memory system so the dashboard never shows you the
same paper twice, and a way to catch up on papers you missed if you didn't check in for
a few days.

None of this is turned on yet. Every new ability sits behind its own on/off switch,
and every switch defaults to off — meaning Peer behaves exactly as it does today unless
someone deliberately flips a switch. This is deliberate and it is the whole safety
strategy: nothing changes by accident, and anything that does get switched on can be
switched back off without losing anything important.

Think of it like renovating a house room by room while people still live in it. Each
room gets finished, checked, and only then does someone turn the lights on in that room.
Nobody turns on every light in the house at once.

### What changed since the last version of this document

Two big things happened since this document was last written.

**This branch now includes all of Peer's newest work from the main line of
development.** Nothing was lost in the process — a careful, independent check re-read
every rule this project depends on after joining the two together, and confirmed all of
them still hold. Joining the two together also meant the first decision below ("who pays
for AI calls") got made: Peer's own infrastructure now covers some AI costs, the same
way the rest of Peer already works. What that costs and risks is explained under that
decision below.

**A real bug slipped through, and a person caught it — not an automated check.** Right
after joining the two lines of work together, someone opened Peer and looked at the
sample paper list on the home screen, and saw the same paper listed twice — three
separate times, in a list of only ten papers. The cause: some papers are hosted in more
than one place online, and each hosting site hands that paper its own tracking number,
so the system was treating each copy as a totally different paper.

A first fix was written, but it turned out to be too broad — checked by a second,
independent person, it would also have merged some genuinely different papers together
in rare cases. A second, narrower fix went back to comparing tracking numbers, but only
to catch those rare cases, not to block the normal one. It passed its own tests, but the
same kind of second, independent check found a gap anyway: comparing tracking numbers
only works when both papers involved actually have one of the same kind. A paper with no
tracking number at all — which is common, since "no tracking number" is exactly why the
system has to fall back to matching by title and author in the first place — slipped
straight through that gap, and the original mistake could still happen in a new shape.

Two rounds of fixing the same spot and finding a new version of the same problem is this
project's own signal to stop patching and change approach. So a third fix took a
different angle entirely: instead of ever comparing tracking numbers, it now requires
every paper in a suspected group to be checked directly against every OTHER paper in
that group — not just its nearest neighbor — before they're allowed to combine into one.
If even one of those direct checks fails, the whole group stays separate. This closes
the gap without needing a tracking number at all, and it passes its own tests. This
time, the same kind of second, independent check did happen: a different checker built
more than forty fresh test cases of their own, covering shapes of the problem nobody
had tried before, and every single one came back correct. A separate, whole-project
re-check of the finished result, run through the real system rather than a list of
test cases, also confirmed the original three-copies-of-one-paper mistake is gone.

Two honest limits are worth knowing, both accepted on purpose rather than left as
undiscovered bugs. First, a small group of papers where the checks don't all connect
to each other directly is now shown as separate entries rather than guessed into one —
better to show a few too many than to hide one that turns out to be genuinely
different. Second, two truly different papers by the same author, with the exact same
long title, published back to back in two calendar years, can still merge into one;
this is considered rare and low-stakes enough to accept rather than chase further.

### What's safe today

Every switch, when off, leaves Peer working exactly like it does right now — this has
been checked for each one individually. A few storage changes (new places to keep data)
have been written and carefully read over, but none of them have actually been applied
to the real database yet. Turning on a storage change is always a separate, deliberate
step from turning on the feature that uses it.

The one place a specific order is already spelled out is the "don't show me the same
paper twice" memory: the storage for it has to be turned on first, and only afterward
does the on/off switch for actually using it get flipped. For every other switch, no one
has written down a required order yet — this document proposes a reasonable one, but you
get the final say on the order when the time comes.

### What needs your decision

One of six original choices has now been made — joining the two lines of work together
counted as choosing it, and it's recorded below. Five are still waiting on you. None of
them are technical — they're about risk, cost, and privacy trade-offs that only you can
weigh:

1. **Who pays for AI calls, and how — NOW DECIDED.** You chose to let Peer's own
   infrastructure cover some AI costs under a new shared spending limit, the same way
   the rest of Peer already works, rather than keep the older, stricter rule. What this
   buys you: a few abilities that would otherwise have quietly turned off stay on. What
   it costs: today that shared spending limit only actually puts a ceiling on two
   specific expensive actions — a full in-depth report, and a costly full rebuild of
   your results. Everything else that calls on an AI — a quick re-ranking of your
   papers, a short summary, a background double-check — is watched and written down, but
   has no overall dollar limit or call-count ceiling of its own yet. That gap is the
   single biggest open cost risk in Peer today, worth knowing even though the decision
   itself is already made. This same choice also decides whether a backup AI opinion —
   one that only ever runs quietly in the background, never something you see directly —
   can ever switch on at all, since it's built to only spend Peer's own money, never
   yours; making that part actually able to run still needs its own separate wiring work
   first.
2. **Should email and the in-app dashboard share one "already shown" memory**, or stay
   fully separate, as they do today? Right now if a paper shows up in your email, it can
   still show up on the dashboard too.
3. **Who or what is allowed to trigger the scheduled email digest** (and also a
   "get things ready a bit before you check in" helper, which has now actually been
   built and tested — it just isn't switched on) **on a timer.** Nobody has wired up an
   automatic trigger yet, on purpose — this is a production change nobody should make
   without asking you first.
4. **How much real, paid use of outside search and AI services to authorize**, and for
   what scope. Nothing has made a real paid call yet. This same decision also tells us
   whether one specific paper-search service still works without a paid key at all — we
   genuinely don't know right now, and checking requires making one real request.
5. **Whether a failed digest email should be automatically retried later.** A safe,
   one-time retry already exists in the code. Turning that into an automatic recurring
   sweep would itself be a new scheduled job, so it needs the same sign-off as decision 3.
6. **Who reviews and labels the ~200 test papers** used to measure whether the new
   ranking is actually better. The rule is: two people who did not write any of Peer's
   search or ranking code, working independently, plus a named tie-breaker for when they
   disagree. We need you to say who those people are.

### What has NOT been tested live

Nothing. To be specific: no real call has been made to Semantic Scholar, OpenAlex, or
Jev by this campaign. No comparison between "old Peer" and "new Peer" has been run on
real papers. No cost number, no accuracy number, and no speed number in this project is
a measurement — every number you may see quoted elsewhere is an estimate, clearly
labeled as such, never a result. The plan for how that testing will eventually happen is
in the technical appendix, but the test itself has not started, and the pass/fail bar
for it has not even been set yet.

### A safety net that's already in place

For every new storage the project might add to the database, someone has already
written the "undo" instructions — a script that would remove it again. These undo
scripts are not wired up to run automatically by anything, ever. They exist purely so
that if the project ever needs to back out of a storage change, the instructions are
ready, reviewed, and waiting for a person to run them by hand, after a separate,
explicit decision about what to do with any data that would be lost. Two of the seven
undo scripts would destroy something that cannot be recomputed — one holds a research
interest you typed in yourself, and one exists specifically to remember every paper
you've already been shown, so a promise ("we'll never show you the same paper twice")
isn't quietly broken. Both are marked as needing an exported backup before anyone ever
runs them, and nobody is planning to run any of them without asking you first.

### Two things found while preparing this document

**A storage space that never gets cleaned up.** Peer keeps a private, per-person cache
of paper picks so it doesn't have to redo expensive work on every visit. Nobody has
written a rule for how long to keep that cache around, so today it would simply grow
forever. This isn't a privacy problem — it's private to each person already — but it is
a cost and tidiness problem, and deciding how long to keep it is the kind of call that
needs your sign-off, not something the code should quietly decide by itself. This same
storage space now also holds a second kind of cache, for a handful of experimental
recommendation methods (see the next paragraph), which makes this decision matter more,
not less.

**A few recommendation methods now have the safety net they were waiting for, and it's
been fully checked.** Four of the newer ways Peer can find papers for you (three based
on papers you've liked or saved, one based on topics you seem interested in) used to
have no memory between visits — every single time you open or refresh Peer, they would
redo their work from scratch. That's slow, wasteful, and could run up costs quickly if
switched on. The safety cache that fixes this has now been built, and a second person
who didn't write it has finished checking it: it does what it's supposed to, including
correctly skipping a call — rather than quietly guessing — when its own storage has a
real outage. One small, accepted exception was found and written down, not fixed: a
rare, older, mostly-retired way of loading your dashboard can still let one of these
four make a live call once a day, but even then it can never sneak a brand-new paper
into a list you've already been shown, only refresh something already there. One of the
four — the one based on topics you seem interested in — used to do nothing at all even
if you switched it on, because it had no topics to search with yet; that gap is now
closed too (it reads topics from your own reading history). All four are still switched
off by default — being fully checked isn't the same as being switched on; that's still
its own separate step.

**A minor timing bug — now fixed and double-checked.** If you open Peer in two tabs at
once, or click refresh twice quickly, Peer used to do the expensive work twice instead
of once and reusing the first result. That's fixed now: two tabs, or two fast clicks,
share one answer instead of paying for the work twice. A related, smaller idea — a short
"please wait a bit before refreshing again" pause — has also now been built, as part of
a bigger "get your results ready a little before you sit down to read" feature. Neither
piece is switched on yet, because nothing currently tells either one when it's allowed
to run — that's decision 3 above.

**Two more abilities got built this round, both still switched off.** A backup AI
opinion can now quietly double-check Jev's judgment in the background when Jev itself
sounds unsure, without ever changing what you see. It can't actually run yet, though —
by design, it's only allowed to spend Peer's own money, never yours, and the actual
wiring that would let it spend anything at all still needs to be built (see decision 1
above — the underlying "who pays" question is now decided, but that wiring is separate,
not-yet-started work). Separately, a new way of blending results from Peer's different
search methods into one fair ranking has been built, switched off by default. Whoever
reviewed it found two small accuracy gaps — nothing broken or unsafe, just not as sharp
as it should be — and both are now fixed, with a second, independent person confirming
the fix works. It's still kept switched off on purpose: a planned round of measuring how
well it actually performs against real papers needs to happen first, and that hasn't
started yet.

### Bottom line

Nothing ships itself. Every switch stays off until a person turns it on, in an order
this document proposes but you get to confirm. The riskiest step by far — letting Jev
make real, paid decisions about your papers — sits at the very end of a long chain of
smaller, safer, reversible steps, and needs your explicit go-ahead on cost and scope
before anyone flips it.

---

## Part 2 — Technical appendix

All line numbers and file states below were confirmed by a fresh grep of `web/src` and
`web/supabase/functions` at the time this document was written (2026-09-24). This
codebase has several concurrent writers; re-grep symbol names before relying on an exact
line number in a live edit. All rollout ordering in Section 2 is **PROPOSED** — see that
section's own note.

### 0. Scope and status of this document

- Covers rollout order, rollback (flag-level and SQL-level), the evaluation plan,
  secrets placement, the acceptance-matrix snapshot, and the open user decisions for the
  Jev/retrieval integration campaign (`ABC-JEV-INTEGRATION.md`).
- Originally written by P5-S1 C from `docs/jev-abc/P5-B-20260924T114729Z.md` (the C
  guide) and the binding rulings in `ABC-JEV-INTEGRATION.md` §4's newest entries, which
  override the guide where they differ. Updated by P5-S3 C (this pass, 2026-09-24) to
  fold in everything that landed after P5-S1's fresh independent review: newly-built
  flags (`PEER_RANK_FUSION`, `PEER_JEV_GEMINI_FALLBACK`), a newly-reviewed one
  (`PEER_JEV_SHADOW`), a previously-undocumented one (`OPENALEX_EMAIL`), the now-fixed
  refresh/coalescing bug, the now-built (still fully disconnected) "get results ready
  ahead of time" queue, new pre-flip conditions, and citations switched from line
  numbers to function names because this branch has several concurrent writers and line
  numbers were going stale within the same session.
- Does not itself authorize anything. No flag is flipped, no migration is applied, no
  secret is set, and no SQL in `web/supabase/rollback/` is run as a result of this
  document existing.
- **Updated again by P5-S4 C (this pass, 2026-09-24) — final status update for this
  round.** Since P5-S3: this branch's uncommitted work was locally merged with
  `origin/main` (§0b); a fresh A independently VERIFIED both RRF pre-flip fixes
  (`docs/jev-abc/P2-S6-FIX-A-*`) and the channel-candidate-cache outage-handling
  precondition (`docs/jev-abc/P2-S4cd-A-*`, `docs/jev-abc/P2-S4d-FIX-A-*`); a live smoke
  check of the merged app found a duplicate-paper regression, now fixed once, found too
  wide, and re-fixed (§2b) — **Corrected (was stale): a second fix attempt also failed
  its own independent review, in a new shape, and a third, structural fix followed —
  that fix has since been independently reviewed and VERIFIED
  (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`); see §2b for the full three-round
  account.** USER decision 1 is now resolved, leaving 5 open (§8). This pass upgrades
  acceptance-matrix rows only where a fresh A recorded VERIFIED, never on an
  implementer's own say-so.
- **Updated again by P5-S5 (final status sync, this pass, 2026-09-24).** Since P5-S4:
  the duplicate-paper version rule (§2b) went through one more failed independent
  review (`docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md`, FAILED_REVIEW — the
  narrower, id-based fix still let through chains and hubs where a bridging paper had
  no id at all, or an id of a different kind) before a third, structural rule — every
  paper in a suspected group is checked directly against every other paper in it,
  never comparing ids at all — was implemented and this time independently VERIFIED
  from 41 freshly-built adversarial test cases with zero mismatches
  (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`). A comment-only documentation
  drift the same review found in two unrelated files was fixed and independently
  verified too (`R3-CLEANUP-4`, VERIFIED_OFFLINE_BOUNDED per
  `docs/jev-abc/P4-S9-A-20260924T230835Z.md`). Separately, a full end-of-round
  re-measurement of all 18 acceptance items ran independently in two parts
  (`docs/jev-abc/FINAL-A-P1-20260924T2230Z.md`,
  `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md`) and surfaced one genuine gap this
  document had not yet named: no route let a signed-in reader look back at an
  already-sent day's papers ("archive access"). That was built and independently
  VERIFIED the same round (`docs/jev-abc/P4-S9-A-20260924T230835Z.md`), alongside two
  small factual fixes to this document that same review found. This pass folds all of
  the above into §2b, the acceptance matrix (§6), the gates (§7), and Part 1's
  plain-language account of the duplicate-paper bug. **Overall release gate: NOT
  MET.** Nothing in this campaign has been verified against a real database, a live
  outside AI/search provider, or an actual end-to-end browser run — every result
  anywhere in this document remains an offline-only check, and five of the six user
  decisions (§8) are still open.

### 0b. The merge with origin/main — local only, not pushed (new this pass, P5-S4)

Since P5-S3, this branch's uncommitted work was snapshotted as three local `wip:`
commits and merged with `origin/main` (`git merge`, not rebase) into one local merge
commit `6f518512` (second parent exactly `origin/main` @ `640c55ec`). **Not pushed, no
PR, no deploy** — authorized by the user in `ABC-JEV-INTEGRATION.md` §1s, which this
section summarizes; §1s is the binding text if the two ever disagree.

**Verified independently, not taken on the merge implementer's word.**
`docs/jev-abc/MERGE-A-20260924T203103Z.md` (VERIFIED_OFFLINE_BOUNDED) re-ran all 4 gates
from scratch on the merge commit (`tsc` 0 errors; `eslint` 0 errors/149 warnings;
`vitest` 4467/4467; `build` succeeded) and independently re-derived — from the merged
source directly, not from any guide's summary — that every one of main's binding rules
survived: every route that reaches an AI model requires proof of who is asking and why
(a `ProviderContext`); exactly 6 routes gate on that proof; a full in-depth ("deep")
report is counted exactly once, with its own regression test that fails if a second
counting point is ever added; a total search failure is reported honestly, never
silently returned as an empty result; the cache that remembers a reader's built paper
list now also accounts for uploaded-paper interests and runs on the right cycle (weekly
for some surfaces, daily for others); and every one of this campaign's own guarantees
(the delivery ledger, the channel cache's outage handling, RRF's flag-off state, the Jev
broker's caps and secret handling, the prepare-job queue staying unwired) still holds.
Five places where the automatic merge tool silently produced something subtly wrong
were found and fixed before anyone signed off (e.g., a check that would have run twice
instead of once; an onboarding message that would have shown twice) — independently
confirmed fixed, and a fresh sweep for more of the same 3 bug patterns found none.

**USER decision 1 is resolved, in main's favour (§1s.2, restated in §8 below).** Main's
company-funded AI rules are kept in place of this branch's own, stricter, keys-only
rule. **The recorded risk is not hypothetical anymore — it is now live, and belongs at
the top of any list for the user:** main's rule caps only two specific expensive
actions — a full in-depth report, and a forced full rebuild of a reader's results — with
**no general spending ceiling** on anything else that reaches a model (ordinary feed
re-ranking, short reports, query generation, figure matching). MERGE-A restates this as
its own NEW FINDING 1, independent of the original UPSTREAM-02 finding that first
surfaced it.

**First-visit product ruling (raised by the merge, decided by the manager, reported to
the user, who may override it):** a visitor who has declared no project, challenge, or
topic at all sees main's starter sample list with its own setup banner — never a screen
that blocks them until they type something. A visitor who has declared even just a
rough project or challenge (not full keywords) always sees their own briefing, never the
generic sample — this preserves the "no dummy-keyword requirement" guarantee (acceptance
item 1) while keeping main's sample-feed behaviour for a truly blank visitor.

**One real bug the merge produced, caught by a human smoke check, not by any of the
4467 automated tests: the duplicate-paper regression.** See §2b for the full account.
**Corrected (was stale):** it took two more rounds and a structural rewrite to close
every shape of the problem, and that final fix has since been independently reviewed
and VERIFIED (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`).

**Process note (not a product issue, included only because the brief for this pass
asked it be recorded if at all):** while smoke-checking the merged app, a preview tool
briefly started a development server in the sibling `peer-followup` worktree instead of
this repository, because it resolved launch configuration from the session's original
project root. No source file was changed by the incident (only that other worktree's
own build cache); it was not killed, to avoid disrupting that other, unrelated session;
this session was corrected to always start this repo's own server explicitly from now
on. Recorded here for completeness, not because it affects anything in this document.

### 1. Flag inventory — fresh grep, P5-S3 session (2026-09-24); re-confirmed post-merge by MERGE-A, not independently re-grepped by P5-S4

Grep commands run: `grep -rnE "process\.env\.(PEER_|OPENALEX_|JEV_)[A-Z0-9_]*" web/src
--include="*.ts" --include="*.tsx"`, a broader token sweep
(`grep -rhoE "\b(PEER|OPENALEX|JEV)_[A-Z0-9_]*\b" web/src --include="*.ts" --include="*.tsx"
| sort -u`) to catch anything the narrower grep would miss, and
`grep -rn "Deno\.env\.get" web/supabase/functions`.

**Citations below are by function name, not line number.** `web/src/lib/feed/pipeline.ts`
in particular is being actively edited by a concurrent writer as this document is
written — this session watched its own line numbers shift between two greps taken
seconds apart. Re-grep the function name if you need an exact line.

| Flag / name | Default when unset | Accepted value | Where read | Status |
|---|---|---|---|---|
| `PEER_DASHBOARD_LEDGER` | Off (today's behavior) | literal `"on"` only | function `dashboardLedgerEnabled()`, `web/src/lib/dashboard/ledger-flag.ts` | Built, code-reviewed offline. **Pre-flip HARD THRESHOLD (new):** if this ever ships turned off in production (the batchless path, which is the real one today), an "unattributed pending delivery" reconcile — merging a not-yet-attributed pending delivery into the right owner's bucket once that owner becomes known within the same visit — must be built first. See §2 Group A1. |
| `PEER_DIGEST_DEDUPE` | Off (old 6-hour window) | literal `"on"` only | function `isDigestDedupeEnabled()`, `web/src/app/api/jobs/dispatch-digests/route.ts` | Built, code-reviewed offline. (Its cited line number has moved twice since this document was first written — this is exactly why it's now cited by function name instead.) |
| `PEER_JEV_BROKER` | Off | literal `"on"` only | function `jevBrokerEnabled()`, `web/src/lib/decisions/broker-client.ts` | Built; nothing calls it in production yet |
| `PEER_JEV_BROKER_URL` | unset | server URL string (secret-adjacent) | function `readJevShadowConfig()`, `web/src/lib/decisions/flag.ts` | Built |
| `PEER_JEV_BROKER_SECRET` | unset | credential string | Next: function `readJevShadowConfig()`, `flag.ts`; Edge: the request handler in `web/supabase/functions/jev-broker/index.ts` | Built |
| `PEER_JEV_PER_USER_DAILY_CAP` | 50/day (constant `DEFAULT_JEV_PER_USER_DAILY_CAP`, `flag.ts`) | integer | Next: function `readJevShadowConfig()`, `flag.ts`; Edge: function `envNumber()`, `jev-broker/index.ts` | Built — **see §4 caution: must be set to the same number on both sides** |
| `PEER_JEV_GLOBAL_DAILY_CAP` | 2000/day (constant `DEFAULT_JEV_GLOBAL_DAILY_CAP`, `flag.ts`) | integer | same as above | Built — same caution |
| `PEER_JEV_SHADOW` | Off | literal `"on"` only | function `jevShadowEnabled()`, `web/src/lib/decisions/flag.ts` | Built. **Now has its own independent fresh review** (it did not, as of the last version of this document) — offline-verified: eligibility gate, cache wiring, and a privacy probe (8 sentinel strings never reach a log line) all checked. **New recommendation:** the feed route sets no explicit `maxDuration` today; the platform default is 300 s and the shadow's own worst-case run is ~60 s, which fits, but the two numbers were never explicitly pinned against each other in code. Set an explicit `maxDuration` on the feed route before turning this on. See §2 Group B7. |
| `PEER_JEV_GEMINI_FALLBACK` | Off | literal `"on"` only | function `geminiFallbackEnabled()`, `web/src/lib/decisions/flag.ts` | **Now built** (was "not built yet" in the prior version of this document). Code-reviewed offline. Structurally inert regardless of this flag's value: nothing anywhere in the codebase mints or injects the company-funded capability this feature requires, so it cannot fire even when "on" — see §2 Group B8 and user decision 1. |
| `PEER_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP` | 10/day (constant `DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP`, `flag.ts`) — **PROPOSED, not sourced from any vendor number** | integer | function `readGeminiFallbackConfig()`, `flag.ts` | Built. A separate, code-level (not env-configurable) ceiling of at most 5 calls per shadow run also applies — that number is a manager ruling, not a proposed default. |
| `PEER_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP` | 200/day (constant `DEFAULT_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP`, `flag.ts`) — **PROPOSED** | integer | function `readGeminiFallbackConfig()`, `flag.ts` | Built |
| `PEER_RANK_FUSION` | Off | literal `"on"` only | function `rankFusionEnabled()`, `web/src/lib/feed/pipeline.ts` | Built — this is the hybrid-retrieval-ranking (RRF) feature. The flag-off state (nothing changes) is code-reviewed offline. Flag-on found 2 accuracy gaps in review; **both fixes now VERIFIED** by a fresh, independent review (`docs/jev-abc/P2-S6-FIX-A-20260924T153735Z.md`, VERIFIED_OFFLINE_BOUNDED — reproduced RED-before/GREEN-after, both required mutations independently re-run, flag-off path re-confirmed byte-identical). **Still ships off in production** — a separate, deliberate gate (the §5 evaluation must inform the production default, per §1p.B(1)), not an unresolved defect. See §2 Group A6. |
| `PEER_CHANNEL_OPENALEX_SEMANTIC` | Off | literal `"on"` only | function `channelOpenAlexSemanticEnabled()`, `pipeline.ts` | Built, code-reviewed offline |
| `PEER_CHANNEL_OPENALEX_TOPIC` | Off | literal `"on"` only | function `channelOpenAlexTopicEnabled()`, `pipeline.ts`; topic ids now resolved by function `topPositiveOpenAlexTopicIds()`, `web/src/lib/preferences/topic-seeds.ts` | No longer a guaranteed no-op — wired to a real source of topic ids (pulled from the reader's own liked/saved papers via the delivery ledger). **Now independently VERIFIED** (`docs/jev-abc/P2-S4cd-A-20260924T152147Z.md`, VERIFIED_OFFLINE_BOUNDED), with one disclosed, accepted, low-severity open item — see §2 Group A4. **Same precondition as the 3 rows below, now also VERIFIED — see §2 Group A4.** |
| `PEER_CHANNEL_S2_RECOMMENDATIONS` | Off | literal `"on"` only | function `channelS2RecommendationsEnabled()`, `web/src/lib/preferences/positive-seeds.ts` | Built, code-reviewed offline. The per-owner daily channel-candidate cache this needs (§2 Group A4) is built and **now independently VERIFIED**, including its outage-handling tri-state (`docs/jev-abc/P2-S4cd-A-20260924T152147Z.md`, `docs/jev-abc/P2-S4d-FIX-A-20260924T164212Z.md`, both VERIFIED_OFFLINE_BOUNDED). The "both-sides" conflict rule (a paper id present in both the positive and negative seed lists is now sent as neither) is implemented and verified. |
| `PEER_CHANNEL_OPENALEX_SEED_SIMILARITY` | Off | literal `"on"` only | function `channelOpenAlexSeedSimilarityEnabled()`, `positive-seeds.ts` | Same as above. **Same precondition, now verified.** |
| `PEER_CHANNEL_POSITIVE_SEED_CITATIONS` | Off | literal `"on"` only | function `channelPositiveSeedCitationsEnabled()`, `positive-seeds.ts` | Same as above. **Same precondition, now verified.** |
| `OPENALEX_API_KEY` | Unset = keyless | server secret | function `openAlexAuthHeaders()` — defined separately in each of 4 files: `sources/openalex.ts`, `sources/openalex-semantic.ts`, `sources/openalex-topic.ts`, `affiliation/openalex.ts` | Sent as an `Authorization: Bearer` header, never a URL parameter, at all 4 sites |
| `OPENALEX_EMAIL` | `"peer@example.com"` | any contact-address string — not a secret | module-level constant (commonly named `MAILTO`) at 9 call sites: `api/papers/search/route.ts`, `api/topics/suggest/route.ts`, `affiliation/openalex.ts`, `figures/extract.ts`, `papers/fetch-by-id.ts`, `papers/source-links.ts`, `sources/openalex-semantic.ts`, `sources/openalex-topic.ts`, `sources/openalex.ts` | **New row — was previously undocumented (P5-S1 finding).** Pre-existing behavior, unchanged; only the documentation was missing. |
| `PEER_ENTITLEMENT_MODE` | one-tier (beta) | exactly `"tiered"` restores the free/trial/paid split | function `entitlementMode()`, `entitlement/resolve.ts` | Pre-existing, load-bearing for the Jev broker's entitlement gate |
| `PEER_DEV_ENTITLEMENT` | free + synthesized dev user | local-dev only | function `devEntitlement()`, `entitlement/resolve.ts` | Pre-existing; gated by a runtime check (`isLocalDevRuntime()`), not the production build guard — a stale code comment names the wrong mechanism, harmless |
| `PEER_DIGEST_PROVIDER` | unset | provider id string | function `resolveLocalServerProvider()`, `llm/providers/registry.ts` | Pre-existing, unrelated to this campaign |
| `PEER_REPORT_MODEL_TIER` | "large" | `"small"` switches tier | function `reportModelTier()`, `llm/provider-models.ts` | Pre-existing, unrelated |
| `PEER_FEED_AI_TIER` | 0 | integer | function `feedTierFromEnv()`, `feed/pipeline.ts` | Pre-existing, unrelated |
| `PEER_RUN_LIVE_EVENTS_BENCHMARK` | off | exactly `"1"` | function `canRunLiveEventsBenchmark()`, `events/benchmark-live-gate.ts` | Pre-existing, unrelated; live/opt-in benchmark only |
| `PEER_PROFILE_SNAPSHOT_PATH` | a default fixture path | file path | `events/benchmark.test.ts` — **test-only, not read by any production file** | Pre-existing, unrelated |
| `PEER_PRIVATE_UPLOAD_DIR` | unset | absolute path | function `hostedUploadsEnabled()` and constant `UPLOAD_DIR`, `papers/upload-access.ts` / `papers/upload-store.ts` | Pre-existing, unrelated |
| `PEER_UPLOADS_ENABLED` | `false` | exactly `"true"` | function `hostedUploadsEnabled()`, `papers/upload-access.ts` | Pre-existing, unrelated |
| `JEV_API_KEY` | unset | the real Jev provider credential | Edge only, inside the request handler in `jev-broker/index.ts` | Never read on the Next/Vercel side at all (confirmed by this session's own grep of `web/src` — zero hits) |

**Corrections/confirmations versus the prior version of this document:**
`PEER_JEV_SHADOW` now has an independent fresh review (it did not before) — see its row
above. `PEER_JEV_GEMINI_FALLBACK` and `PEER_RANK_FUSION` are both now built, each with
its own independent fresh review of the flag-off state; `PEER_RANK_FUSION`'s flag-on
path additionally has 2 known gaps with fixes in progress (not yet written). The
per-owner daily cache for the four read-time recommendation channels (internal name:
channel-candidate cache, `web/src/lib/opportunities/channel-candidate-cache.ts`) is now
built; its own independent review is in progress, not yet verified — do not treat its
precondition (§2 Group A4) as satisfied until that review lands. `OPENALEX_EMAIL` is
added as its own row (previously undocumented). The stale `PEER_DIGEST_DEDUPE` line
citation is fixed by switching every citation in this table to function names instead
of line numbers, which is now this table's permanent convention.

**Corrections/confirmations versus the prior (P5-S3) version, made this pass (P5-S4):**
`PEER_RANK_FUSION`'s 2 flag-on accuracy gaps are no longer "in progress" — both fixes
landed and were independently VERIFIED (`docs/jev-abc/P2-S6-FIX-A-*`); the flag still
ships off, now solely because of the separate §1p.B(1) evaluation gate, not because
anything is still broken. The per-owner daily channel-candidate cache's independent
review also landed and is now VERIFIED (`docs/jev-abc/P2-S4cd-A-*`,
`docs/jev-abc/P2-S4d-FIX-A-*`) — treat the §2 Group A4 precondition as satisfied. The
3-way-duplicated year/first-author helper P2-S6-FIX-A flagged as a non-blocking
follow-up has an implementation consolidating it into one shared, exported helper
(`docs/jev-abc/DEDUP-FIX2-C-*`, bundled with the version-rule fix in §2b) — itself not
yet independently reviewed, so treat that specific cleanup as done-but-unverified, not
closed. Everything else in this table was re-confirmed, not re-derived from scratch:
this branch's uncommitted work was merged with `origin/main` since P5-S3 (§0b), and a
fresh, independent post-merge review (`docs/jev-abc/MERGE-A-20260924T203103Z.md`)
re-read every function named in this table directly from the merged source and found
all of them unchanged in behavior (some shifted line numbers, which is exactly why this
table cites function names only).

### 2. Rollout runbook — PROPOSED, not sourced

**Everything in this section is a proposal, not an instruction.** Only one flag
(`PEER_DASHBOARD_LEDGER`) has an explicit order written down anywhere in this campaign's
source material; every other ordering below is this document's own reasonable
generalization from that one precedent, built because no cross-flag database dependency
forces any particular order. **The user confirms the actual order at rollout time** — a
manager or implementer should not treat the table below as authorization to proceed.

Every flag in this campaign accepts only the literal string `"on"` — never `"true"`,
`"1"`, or any other truthy-looking value — and defaults to today's exact behavior when
unset.

#### Group A — additive, independent of the Jev broker, lowest blast radius

| # | Flag | Preconditions (ALL must hold) | Stop signal |
|---|---|---|---|
| A1 | `PEER_DASHBOARD_LEDGER` | (1) The dashboard-delivery-ledger migration applied. (2) User has separately authorized applying that migration. **This is the one flag with a sourced order** — flip only after the migration apply is authorized and done. **(3) New HARD THRESHOLD:** if production ever launches with this flag left **off** (the batchless path — today's real, default path), an "unattributed pending delivery" reconcile must be built first: a pending delivery that arrived before the reader's identity was known must be merged into the right owner's bucket once that owner becomes known within the same visit. This is a design requirement, not something already authorized to build. | Any response that serves a freshly-built pool while the ledger can't be read — must fail closed (503), never silently fall back to an unguarded pool. |
| A2 | `PEER_DIGEST_DEDUPE` | The briefing-deliveries-dedupe migration applied. (PROPOSED — modeled on A1, not itself sourced.) | A duplicate send on retry, or an old pre-migration row blocking a legitimate new claim. |
| A3 | `OPENALEX_API_KEY` | User decision 4 (live-call authorization) resolved enough to know whether this is optional or effectively mandatory. Not a rollout flag — a secret whose mere presence changes behavior for every OpenAlex call site. | N/A — low risk either way; the open question is timing, not safety. |
| A4 | The 4 read-time recommendation channels: `PEER_CHANNEL_S2_RECOMMENDATIONS`, `PEER_CHANNEL_OPENALEX_SEED_SIMILARITY`, `PEER_CHANNEL_POSITIVE_SEED_CITATIONS`, `PEER_CHANNEL_OPENALEX_TOPIC` | **Precondition status UPDATED this pass (P5-S4): now VERIFIED.** The per-owner daily channel-candidate cache (design name: P2-S4d) that all four need is built (`web/src/lib/opportunities/channel-candidate-cache.ts`) and its independent review has landed: `docs/jev-abc/P2-S4cd-A-20260924T152147Z.md` (VERIFIED_OFFLINE_BOUNDED for the topic-id resolution, the advisor-citation channel, the cache itself, and the S2 both-sides rule) and `docs/jev-abc/P2-S4d-FIX-A-20260924T164212Z.md` (VERIFIED_OFFLINE_BOUNDED for the specific fix this precondition needed — a genuine storage outage is now correctly told apart from an ordinary first-time miss, so an outage degrades to "skip this channel, say so truthfully" instead of silently fetching live on every request). Reason the precondition existed (manager finding F-M-P2-02, confirmed by direct code read): before this cache, these channels "are never cached... they simply re-run and re-report on every request" — with any of them on, every page open or refresh in the normal (non-ledger) mode fired all enabled channels fresh, unbounded by anything except ordinary request volume. `PEER_CHANNEL_OPENALEX_TOPIC` is no longer a guaranteed no-op (see §1) — it now shares this same precondition, also verified. Also implemented and verified: the "both-sides" conflict rule (a paper id in both the positive and negative seed lists is sent as neither); a related, smaller gap (the same 200-row seed-history window can in theory be exhausted by roughly 200 toggles on one paper) is an ACCEPTED COST, not a blocker — it degrades to fewer seeds, never to a wrong one. **One disclosed, accepted, low-severity open item from the fresh review (not a blocker):** in the older, non-default "frozen batch" delivery mode, a narrow legacy-only code path (batches saved before a since-added storage column existed) can still let the topic channel make one live call per owner per day, bounded by this same cache — but it structurally cannot let a new paper appear inside an already-frozen list, only refresh an already-shown entry's own content. Recorded as an open item, not fixed, because fixing it would either widen an already-legacy-only path or touch a file outside this precondition's own scope. | Any of the four channels observed firing live calls on a simple page reopen once "on," or a genuinely new paper appearing inside an already-frozen batch — either would mean this precondition's own guarantee has broken. |
| A5 | `PEER_CHANNEL_OPENALEX_SEMANTIC` | None beyond code; already code-reviewed offline. | Any live comparison being treated as authoritative before user decision 4. |
| A6 | `PEER_RANK_FUSION` (hybrid retrieval ranking / RRF) | Not part of the original guide — added when the feature was first built. Ships flag-off by design. Before ever turning this on in production: (1) **both pre-flip fixes are now DONE and independently VERIFIED** (`docs/jev-abc/P2-S6-FIX-A-20260924T153735Z.md`, VERIFIED_OFFLINE_BOUNDED — both fixes reproduced RED-before/GREEN-after, both required mutations independently re-run, flag-off path re-confirmed byte-identical to today's behavior); (2) the Section 5 evaluation should still inform the production default, per §1p.B(1) — this is the one remaining, deliberate gate, not an unresolved defect. Fixes that landed: (a) the fused-ranking candidates now carry the same publication-year/first-author-surname information the plain de-duplication path uses, so a pair that de-duplication merges into one paper is credited to both search channels in the fused ranking, not silently only one; (b) the fused-ranking result now survives being served from the same-day cache, not only a freshly-built response — a same-day cache read no longer loses that ranking's supporting detail. **Non-blocking follow-up recommendation from the same fresh review:** it flagged the small year/first-author helper as duplicated a third time across three files (non-blocking — the three copies were byte-identical and could not disagree on any input). A later, same-day implementation pass (`docs/jev-abc/DEDUP-FIX2-C-20260924T212607Z.md`, bundled with the version-rule fix in §2b) consolidated all three into one shared, exported helper. **Corrected (was stale):** this consolidation is R3-CLEANUP-3, independently VERIFIED_OFFLINE_BOUNDED (byte-identical to the three old copies it replaced) per `docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md` — confirmed even though that same review round separately FAILED the version-matching logic bundled alongside it; see §2b for that logic's own, later, separately-verified history. | Any user-visible fused ranking before the §1p.B(1) evaluation sign-off; a same-day cache read that silently drops the fused-ranking detail. |

#### Group B — the Jev path (strictly sequential; each step gated on the previous being clean)

| # | Step | Preconditions | Stop signal |
|---|---|---|---|
| B1 | Resolve user decision 1 (company-funded AI option) far enough to know where the database foundation holding the eventual Jev key will live. **SATISFIED this pass (§0b/§8): decision 1 is resolved, in main's favour; the foundation is confirmed a Supabase server-side secret (§1r).** This does not by itself complete any later step — B2 (actually applying the private-decisions migration) is still undone; this campaign still has no real database to apply it to. | — | Designing B2+ around an unresolved foundation choice — no longer applicable; B2 itself remains blocked on the absence of a real database, unrelated to decision 1. |
| B2 | Apply the private-decisions migration. | B1. | Any write path to that table that isn't the service role. |
| B3 | Deploy the Jev broker Edge Function; set its secrets, **including explicit values (not the code defaults) for both daily-cap numbers.** | B1, B2. This is the first time this function will actually run anywhere — no Edge runtime has been available to this campaign at all. | **The two-sided cap mismatch risk:** the Edge side and the Next side each read their own daily-cap numbers independently; nothing in the code forces them to match. **Ruling: set the same number on both sides; if they ever drift, the lower one silently wins** (each side only enforces its own copy). Record the exact numbers used on both sides in the same change. |
| B4 | Set the broker secret as a Next/Vercel server variable (same value as B3). | B3. | A value that differs from the Edge side — every call will fail authentication. |
| B5 | Turn on `PEER_JEV_BROKER`. | B4. Confirm the route wiring that actually calls this path has landed and passed an independent review — otherwise this flag has no observable effect yet, which is safe but proves nothing. | Any caller reaching the broker before that wiring has an independent review. |
| B6 | One bounded, explicitly user-approved-spend smoke test of a real Jev call, end to end. | B5, user decision 4 (scope, volume, budget), and a separately approved spend ceiling. This is the first live verification of anything in this campaign. | Any live call attempted without an explicit, dated, in-chat spend approval naming the ceiling. |
| B7 | Turn on `PEER_JEV_SHADOW`. | B6 passed clean. `PEER_JEV_SHADOW`'s own code now HAS an independent fresh review (this was still outstanding in the prior version of this document — now closed: eligibility gate, cache wiring, and a privacy probe with a planted-leak control all checked offline). **New precondition added this pass:** set an explicit `maxDuration` on the feed route first — it has none today; the platform default is 300 s and the shadow's own worst-case run is ~60 s, comfortably inside that default, but the two numbers were never pinned against each other in code, only reasoned about after the fact. Its own eligibility gate (all of: broker on, signed-in owner matches the cache-scope owner, paid plan, AI tier ≥ 2, a structured intent present, broker URL+secret configured) is a structural filter, not an adjustable rollout percentage — the safe "how many users" number is however many real users currently satisfy every one of those conditions, which should be estimated (read-only) before flipping, since that number IS the blast radius. | Any evidence the shadow hook is awaited by the main request path, or that it fires on a cache hit or a retry. |
| B8 | `PEER_JEV_GEMINI_FALLBACK` (the background-only backup opinion, invisible to the reader, that can weigh in when Jev itself is unsure) | **Now built** (was "not built" in the prior version of this document): its own flag, daily caps, validation, and a hard per-run ceiling of 5 calls are all code-reviewed offline. Structurally inert regardless of rollout step: it only ever runs on an injected, company-funded capability, and nothing anywhere mints or injects one today — so there is no live rollout step to take yet. Unblocking this requires (1) user decision 1 resolved toward the company-funded option, and (2) that capability actually being wired up (a follow-on implementation step, not authorized by decision 1 alone). Its daily-cap numbers are PROPOSED, not sourced from any vendor figure — confirm before any live rollout. | Any live Gemini call before both the capability exists and decision 1 has been made. |

**Known code-level cost bug (F-B-P4S8-01) — now FIXED and independently verified.**
Signed-in users on a cold cache used to not get deduplicated — two tabs, or a fast
double-click of refresh, would independently rebuild the whole paper pool twice,
doubling source fetches and, if the gates above are open, doubling both paid-AI calls
and Jev-shadow schedules. The fix (keying in-flight de-duplication off the pool's own
identifier — owner id plus a hash of the full intent — instead of an internal object
reference) has landed and was independently proven against the real pipeline under true
concurrent requests, both same-owner (coalesces to 1 fetch) and different-owner/different
-intent (never share a flight). This is not itself gated by any flag — it is always on —
but it lowers the real cost of turning any of the flags above on.

**The related "get results ready ahead of time" feature — also now built, still fully
disconnected.** A 15-minute cooldown between manual refreshes, plus a durable queue that
would let Peer prepare a reader's results shortly before they're expected to check in,
have both been built and independently code-reviewed offline (see acceptance 13/14/15 in
§6): due-time and retry/backoff math, the cooldown check itself, and a job-queue
repository with both an in-memory and a real-database-backed implementation all exist and
pass their offline tests. **Nothing calls any of it.** It is not reachable from any route
today, so it has no effect at all, on or off. Turning it into something real needs (1)
user decision 3 (who/what may trigger this kind of scheduled background work), and (2) a
proof that the queue behaves correctly under real concurrent database access (two workers
racing to claim the same job, a crash mid-job, a real retry) — that proof needs an actual
database, which this campaign does not have. The lead time (45 minutes before a reader's
expected check-in) and the retry/backoff timing are PROPOSED, not sourced from any
external requirement; only the 15-minute cooldown length itself is sourced (from the
original engineering plan).

### 2b. Version rule for duplicate-paper detection — new this pass (P5-S4)

**STATUS: VERIFIED_OFFLINE_BOUNDED.** This is the THIRD implementation of this rule
(see the two-round failure history below). A fresh, independent reviewer built 41 of
their own test cases from scratch (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`) —
none reused from the implementer's own or either prior reviewer's checkpoints —
spanning every combination this campaign's brief required (tracking-number shape,
title shape, author shape, year gap, and paper-group shape, including chains, hubs and
cliques) and ran them against the real code: zero mismatches against the ruling
anywhere, no false merges, no false splits beyond the accepted costs stated below.
Both required deliberate breakages of the fix (removing the pairwise check entirely;
loosening "every" to "some") broke exactly the tests they were meant to break,
confirming the tests genuinely exercise the fix rather than passing by coincidence.
Every claim below reflects this independently-confirmed status; see "Independent
review, now complete" below for the full account.

**What triggered this.** After the local merge with `origin/main` (§0b) landed, a
manual smoke check of the running app on the merged code — not any of the 4467
automated tests, all of which stayed green — found the home page's starter sample list
showing the same paper three separate times, each time under a different repository
copy with a different DOI (a common pattern: a hosting site such as Zenodo mints a new
DOI per version of a paper). `docs/jev-abc/MERGE-A-20260924T203103Z.md` independently
confirmed this gap existed in the merged code before any fix and was not caught by the
merge's own from-scratch gate run.

**The rule, as it stands now (third and, independently verified, final form).** Two paper
records are VERSIONS of one work — and merge into one, carrying every version's
DOIs/ids as aliases so none of them can resurface later — only when ALL of: their
titles normalize to exactly equal text, they share a title alias of at least 4 tokens
of length ≥3, their first authors' surnames match, and their publication years are
within ±1 of each other ("directly satisfies the version rule," below). Two records
that meet all four conditions merge even when their DOIs or other ids differ — ids are
never part of this specific test. On top of the four conditions, when three or more
already-clustered GROUPS of records are chained together by these pairwise matches (for
example A matches B, and B matches C, but A and C were never checked against each
other directly), the WHOLE chain is now allowed to merge into one work only if EVERY
record in it, compared against EVERY OTHER record in a different group, ALSO directly
satisfies the same four conditions — not just its immediate neighbor in the chain. If
even one such pairwise comparison fails anywhere in the chain, NONE of the groups in it
merge; every one stays its own separate paper. Ids play no role anywhere in this
decision, direct pair or chain. Both records stay separate whenever first-author
surnames differ, either side has no listed authors, or the shared title is
short/generic (no qualifying title alias).

**Why THREE implementation rounds were needed — this project's own "stop and change
approach" rule fired.** The first attempt
(`docs/jev-abc/DEDUP-FIX-C-20260924T203339Z.md`) simply deleted the old id-conflict
check outright, relying only on the four conditions above. A fresh, independent review
(`docs/jev-abc/DEDUP-FIX-A-20260924T205613Z.md`) reproduced the original bug as fixed,
but FAILED that implementation as too wide, with two concrete adversarial
reproductions: a chain of 3+ papers each only one year apart from its immediate
neighbor could merge its two ENDS despite them never directly satisfying the four
conditions against each other ("transitivity"); and one paper strongly matching two
different candidates by id could pull an otherwise-unrelated third paper into the same
merged group ("hub"). The second attempt
(`docs/jev-abc/DEDUP-FIX2-C-20260924T212607Z.md`) reinstated a narrower version of the
old id-based check: two groups were kept apart only when a specific pair between them
shared an id TYPE (say, both had a DOI) with different values, and that pair did not
itself pass the four conditions. A SECOND fresh independent review
(`docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md`) found this still went wrong whenever
the paper responsible for the chain or hub problem had no id at all, or had an id of a
different kind than the papers it was being compared against — which is the ORDINARY
case for a paper that only ever matches on title and author to begin with (if it had a
matching id, it would already have merged in an earlier, simpler step). Two rounds in a
row failing the same slot in two different shapes is this project's own signal to stop
patching one case at a time; the manager ruled a structural replacement instead (the
"chain must fully agree, not just its neighbors" rule described above), independent of
ids entirely, implemented in this third round
(`docs/jev-abc/DEDUP-FIX3-C-20260924T220641Z.md`).

**Where this rule reaches.** `dedup.ts`, the hybrid-ranking (RRF) clustering in
`pipeline.ts`, and the channel-comparison harness in `channel-comparison.ts` all
import one shared implementation from `feed/paper-identity.ts` rather than keeping three
separate, independently-maintained copies (consolidated as `R3-CLEANUP-3`, VERIFIED
last round — untouched by this round's change). This means dashboard-delivery identity,
de-duplication, and RRF clustering cannot silently disagree about which records are the
same paper.

**What the implementer's account claims, now independently reproduced:** RED before
the fix (13 adversarial-shape tests — the full set from both prior independent
reviews, plus permutation and "false-split guard" coverage — 7 failing exactly as the
structural-rule ruling predicted, all in the shapes the id-based approach could never
see: a chain or hub with no id at all, or with an id of the wrong kind) → GREEN after
(46 of 46 in the two directly-affected files; 564 of 564 across the full focused suite,
which is the prior round's own 554 plus these 10 net-new tests); two required
mutations each broke exactly the tests they were meant to break, with the second one
cleanly isolating only the hub-shaped tests for a structural reason (a chain's groups
only ever have one record each, so "some" and "every" ask the same question there — the
mutation could only show a difference where a group has more than one record, which is
exactly the hub shape). The independent reviewer's own gate run (a cold session, not
copied) reproduced the 564/564 focused and 4481/4481 full counts exactly, `tsc` clean,
`eslint` 0 errors/149 warnings (see §7 for exact numbers); its own separately-built
41-fixture harness then ran both required mutations again from its own scratch code
and got the same qualitative result — every "stays separate" test breaks when the
pairwise check is removed, and only the hub-shaped tests break when "every" is loosened
to "some" — independently confirming the structural explanation above rather than
merely trusting it.

**Independent review, now complete: this third round passed.** Per this campaign's
own rule, nothing implemented by C counts as done until a separate, independent A has
reproduced it from scratch — that has now happened
(`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`, VERIFIED_OFFLINE_BOUNDED). The two
PRIOR rounds' own review cycles are exactly why this document was being this careful:
both times, an implementation that looked complete and gate-clean turned out to have a
real, reproducible gap once an independent reviewer built their own adversarial
fixtures rather than trusting the implementer's own tests. This third round is the
first of the three to come back clean on that same kind of fresh, independently-built
adversarial pass — 41 fixtures, none reused from any prior checkpoint, zero
mismatches. A comment-only documentation drift the same review found in two unrelated
files (stale wording still describing the SECOND round's mechanism as current) has
also been fixed and independently verified (`R3-CLEANUP-4`, VERIFIED_OFFLINE_BOUNDED,
per `docs/jev-abc/P4-S9-A-20260924T230835Z.md`).

**Accepted costs, set by the manager's own ruling, not decided unilaterally by any
implementer — restated for the structural rule, unchanged in substance from the prior
round's own accepted costs:**
- A chain or cluster of papers where even one pairwise comparison between two of its
  records fails now shows every record in it as a SEPARATE, near-duplicate-looking
  entry, rather than guessing which ones truly belong together. This trades a small
  amount of visible near-duplication for never silently deleting a paper that turns out
  to be genuinely different — the same "ambiguous weak component" cost the original
  clustering rule already accepted (§1p.G(3)), now reached by a clearer, id-independent
  rule.
- Two distinct works by the same author, sharing an identical long title, published in
  consecutive calendar years (for example, an annual report or a recurring
  lecture-note series) will still merge under this rule, because as a direct pair (not
  a longer chain) they satisfy the four conditions on their own. Accepted because the
  alternative reintroduces the original visible-duplicate bug, and because Peer's own
  freshness window rarely puts two full years of the same recurring series into one
  day's results anyway.
- "Version merges spanning different calendar years" remains a named, tracked category
  for whoever next reviews retrieval quality, not a silent side effect.

**Independent reviewer's own tallies, from its own fixture set
(`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`):** 8 ambiguous weak components
(chains/hubs correctly kept split) and 1 calendar-year-spanning merge (the accepted
cost above, correctly merged) — both counts are from deliberately constructed test
fixtures, not observed real data. Checked against the 3 real duplicate pairs from the
original smoke check specifically: 0 ambiguous components and 0 calendar-year-spanning
merges — each was a clean, unblocked direct pair, one week apart, the same calendar
year.

**Informational finding from the same review, not a defect in this fix:** an accented
letter and its plain equivalent (for example, a title spelled with "é" versus one
spelled with a plain "e") do not currently normalize to the same text before
comparison — the existing cleanup step turns the accented character into a blank space
rather than converting it to its plain form. Two records for the literal same paper
could therefore fail to link if one source's copy is accented and another's is not.
This sits in a different, pre-existing, unrelated piece of code that this rule did not
touch and does not change — recorded here for whoever next reviews retrieval quality,
not treated as a blocker.

### 3. Rollback

#### 3.1 Flag-off behavior

| Flag | Turning it off | Data left behind |
|---|---|---|
| `PEER_DASHBOARD_LEDGER` | Reverts to pre-ledger exclusion behavior exactly | Ledger tables untouched, become inert (no delete path exists) |
| `PEER_DIGEST_DEDUPE` | Reverts to the old 6-hour-window check | Additive column/index/function harmless, never read by the old path |
| `PEER_JEV_BROKER` | Broker never attempted | No persisted state of its own. **Also sufficient to stop the shadow hook** — the shadow flag's own eligibility gate requires the broker flag to be on as one of its conditions, so no separate step is needed to disable shadow first during an incident. |
| `PEER_JEV_SHADOW` | Hook stops being supplied to the pipeline; the visible feed response is unchanged even while on, by construction | Already-written decision-cache rows and cost-log lines stay (regenerable, non-guarantee-bearing) |
| `PEER_JEV_GEMINI_FALLBACK` | Shadow runs Jev only, exactly as if this flag never existed — same construction as `PEER_JEV_SHADOW` above | Any already-written fallback-sourced answers stay (regenerable, non-guarantee-bearing, same as above) |
| The 5 channel flags | Pool-cache entries simply stop including that channel's candidates | No persisted state of their own |
| `PEER_RANK_FUSION` | Reverts to the plain, pre-fusion ranking exactly, by construction | The optional fused-ranking provenance field on a cached pool is simply absent again; old and new cached pools both stay valid either way |

#### 3.2 Rollback SQL — one authored file per migration

**Seven files now exist** at `web/supabase/rollback/*_rollback.sql` (was six as of the
last version of this document — a 7th migration, `20260924000600_dashboard_prepare_jobs.sql`,
landed since, for the offline-only "get results ready ahead of time" job queue described
in §2, and it has its own rollback file), one per file currently in
`web/supabase/migrations/2026092*.sql`, plus `web/supabase/rollback/README.md`
explaining the folder's convention. **None of these seven files is ever applied
automatically by anything** — confirmed by this session's own gate sweep (§7). Each
file's header states, verbatim: it is not a migration and is never applied
automatically; which forward migration it reverses; exactly what it destroys; whether
that data is regenerable or guarantee-bearing; and the drop order (reverse of the
forward migration's own dependency order).

Ranked highest caution first (see the README for the full reasoning):

1. `20260924000000_dashboard_delivery_ledger_rollback.sql` — breaks the "never
   resurfaces" guarantee retroactively for every user; the ledger table has no
   expiry column by design. Never run without an export.
2. `20260922010000_profile_feed_intent_rollback.sql` — destroys user-typed research
   intent, not system-computed state. Never run without an export.
3. `20260924000300_briefing_deliveries_dedupe_rollback.sql` — touches an
   already-applied, already-live production table.
4. `20260922000000_private_paper_pools_rollback.sql`, `20260924000400_private_decisions_rollback.sql`,
   `20260924000500_dashboard_rollover_rollback.sql`, `20260924000600_dashboard_prepare_jobs_rollback.sql`
   — all four regenerable/cache-or-queue-like, still covered by the same "never without a
   backup" rule as a blanket policy. The newest of the four (the job-queue table) is
   lowest-stakes of all seven: by design nothing in it is a record of anything that
   already happened, only a scheduling note for work not yet done, and nothing triggers
   that queue at all yet (§2) — so today there is nothing live for this rollback to
   actually interrupt.

**Open item folded into this document (manager addition):** `private_paper_pools` has no
retention or cleanup policy at all today — rows accumulate indefinitely. This applies
today to its existing per-owner daily paper-pool cache rows, and will also apply, once
built, to a second dataset planned to share the same table (a per-owner daily cache of
the read-time recommendation channels from §2 Group A4, under a distinct key prefix).
Deciding a retention period is itself a separately-approved-retention-plan decision —
i.e., a user decision, adjacent to but not one of the 6 tallied in §8 — and nothing may
delete rows from that table until it is made. See
`20260922000000_private_paper_pools_rollback.sql`'s own header and
`web/supabase/rollback/README.md`'s "Known open item" section for the full detail.

A migration-to-rollback parity test (`web/src/lib/release/rollback-parity.test.ts`)
mechanically checks that every campaign migration has a matching rollback file carrying
the required header phrase, so a future migration added without a rollback design fails
the test suite rather than silently shipping unreviewed. RED confirmed before the
rollback files existed (14 of 15 assertions failed); GREEN confirmed after (15 of 15
passed) — see §7.

### 4. Secrets placement (names only — values are never in this document or any source it draws from)

| Secret | Vercel/Next server env | Supabase Edge secret | Forbidden on Vercel by the BYOK production guard? | `NEXT_PUBLIC_`? |
|---|---|---|---|---|
| `JEV_API_KEY` | Never | Yes — the only place it lives | **Yes**, on the deny-list | Never |
| `PEER_JEV_BROKER_SECRET` | Yes — Next authenticates its own call to the broker with it | Yes — the broker verifies it | No — correctly absent from the deny-list, Next genuinely needs this one | Never |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | N/A (separate, pre-existing Next-side vars) | Yes — platform-provided | N/A | Never |
| `OPENALEX_API_KEY` | Yes | No | No | Never |
| `PEER_JEV_PER_USER_DAILY_CAP` / `PEER_JEV_GLOBAL_DAILY_CAP` | **Corrected (was self-contradictory — see §1's row above, which was always right):** read on the Next side by function `readJevShadowConfig()`, `web/src/lib/decisions/flag.ts` — the SAME function §1's flag-inventory table cites. The narrower true statement this row used to overstate: `web/src/lib/decisions/broker-client.ts`'s `BrokerClientOptions` receives the two ALREADY-RESOLVED numbers only as plain function parameters — it does not read `process.env` a second time itself. | Yes | N/A — caps, not credentials | Never |
| 12 operator-AI provider names (Google/Anthropic/OpenAI/Qwen/DashScope/DeepSeek families, plus the digest-provider override) | Forbidden in production/preview (BYOK-only policy) | N/A — not part of this campaign | **Yes**, all 12 | Never |

### 5. Evaluation plan

**No dataset, no threshold numbers, and no held-out result exist anywhere in this
campaign as of this writing.** This section describes a plan, not a measurement.

**Dataset:** an independently labeled pilot of about 200 project-paper pairs across
HR/organizational topics, statistics, and a materials-science control group — explicitly
"a pilot, not a universal quality certificate." Tuning and held-out sets must be disjoint
**by project** (if any pair from a project is used for tuning, no pair from that same
project may appear in the held-out set, even a different paper). Label provenance and
adjudication of disagreements must be recorded. Ground truth may never be generated by
the same model being evaluated (rules out using Jev, or any single AI under test, to
label its own evaluation set).

**Labelling protocol (ruled, not left open):** two independent domain labellers plus a
named tie-breaker, none of whom wrote any of Peer's retrieval or ranking code. Who they
are is user decision 6 (§8).

**Three comparison arms**, on the same source snapshot where feasible: (a) unchanged
baseline; (b) hybrid retrieval plus deterministic ranking; (c) hybrid plus Jev. Source
ablations: Semantic-Scholar-only / OpenAlex-only / union, keyword-vs-seed, and counts of
uniquely relevant papers per source — vendor claims may never substitute for these.
Arm (b) needs the hybrid-ranking feature (flag name `PEER_RANK_FUSION`, now built —
see §1/§2 — with its flag-off state code-reviewed offline and, as of this pass (P5-S4),
both pre-flip accuracy fixes landed and independently VERIFIED,
`docs/jev-abc/P2-S6-FIX-A-20260924T153735Z.md`) code-complete and force-enabled for the
pilot's own test traffic only — this does not require or wait for that flag's
production default to flip, which is this evaluation's conclusion, not its
precondition. The two pre-flip fixes have now landed, closing the contamination risk
this paragraph previously flagged. Separately: the duplicate-paper version rule (§2b)
that this arm's own de-duplication step relies on has since been independently
reviewed and VERIFIED (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`), closing the
risk this paragraph previously flagged for that rule too — this arm's de-duplication
step no longer needs to be treated as provisional on that account.

**Named metrics, with pinned definitions where the source campaign didn't already fix
one** (pinning is a manager ruling, made before any held-out data exists, changeable only
before a held-out result is seen):

- Recall in the judged candidate set (explicitly not a corpus-wide recall claim).
- Precision@10.
- **Ranking quality = nDCG@10**, computed with graded labels 0/1/2, gain
  <code>2^rel − 1</code>, discount <code>log2(rank + 1)</code>, ideal ordering taken from
  that project's own judged labels, mean over projects with a bootstrap 95% interval.
- False-negative technical-sense cases (the 5 finite adversarial sense categories already
  exist offline; the pilot-scale labeled version does not yet).
- Unknown rate (needs live Jev decisions — blocked on user decision 4).
- New-discovery vs. never-shown-rollover share.
- **Lifetime dashboard duplicate count** = per owner, the number of papers in a served
  dashboard batch whose identity (its canonical key, or any of its known aliases) matches
  a paper in an earlier served batch for the same owner. Target: 0. Measurable only in
  the ledger-mode path (the non-ledger path keeps no server-side delivery record to check
  against).
- Per-active-user cost, cache hits, source failures, p50/p95 readiness.
- **User-level quality breakdown** = every metric above reported per project (and per
  user, when a user has more than one project), each with its sample size — never only a
  single pooled average across everyone.

Report sample counts and uncertainty alongside every number — never only a percentage
uplift.

**Pre-registration rule — currently OPEN, no numbers set:** before any experimental
rollout, the manager must set a quality non-inferiority tolerance and a per-user budget
ceiling from baseline evidence, and record both **before** seeing any held-out result.
Leaving these thresholds unresolved keeps the production gate open, regardless of how
good the code looks. All actual billed experiments additionally need an approved spend
ceiling and safely configured credentials — a user saying "I have a key" is not evidence
that a live call has happened.

**Structural target (quoted in full):** "0/18 unexplained functional gaps, no new
deterministic test regressions, zero observed cross-user leak in adversarial tests, and
independently checked real pipeline cases."

**Metric code lives in a new, dedicated module** (evaluation-only — separate from the
existing channel-comparison harness, which measures overlap/uniqueness between retrieval
channels, a different and narrower thing than the three-arm comparison above). That
module is a different work item (P5-S2), running in parallel with this document.

### 6. Acceptance matrix snapshot (18 items)

Source: the 18-item frozen list in `ABC-JEV-INTEGRATION.md` §3d. Status column reflects
the most recent independent check found on disk as of this writing; a blocked or
in-flight item is never counted as passed. This is a snapshot, not a live query — several
items changed status within the hours before this document was written, and more will
change after it.

| # | Short description | Status | As of / source |
|---|---|---|---|
| 1 | Project/challenge preserved, no dummy-keyword requirement | Passed offline check | 2026-09-24, P1 baseline; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 2 | Domain senses/aliases kept separate (HR conflict, conflict-of-interest text, software conflict, statistical/material meaning) | Passed offline check | 2026-09-24, P1 baseline; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 3 | License ledger and visible attributions; no unapproved dictionary import | **Corrected (was stale — this read as a flat failure; the mechanism itself passes):** the license ledger, source allow-list, and checksum/verification mechanism are independently VERIFIED offline (26/26 tests). Zero real licensed vocabulary is imported — correctly so, since this campaign is explicitly forbidden from fetching one without further user authorization; that is the intended state, not a failure. | 2026-09-24, P1; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 4 | All 5 candidate channels demonstrated; live comparison honestly reported | Partial — the topic-based channel's wiring to a real source of topic ids, the advisor-citation channel, the per-owner daily cache, and the S2 both-sides conflict rule are now independently VERIFIED offline (one disclosed, accepted, low-severity open item — see §2 Group A4); live comparison itself still blocked on user decision 4 | 2026-09-24, P2 baseline; updated P5-S3 from P2-S4c+d C; updated P5-S4 from P2-S4cd fresh A + P2-S4d-FIX fresh A; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 5 | A zero-literal-match positive result survives every path; exclusions still work | Passed offline check | 2026-09-24, P2; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 6 | Duplicate-paper detection preserves origin and handles edge cases safely | **Corrected (was stale — this read as a failing, in-progress review; it has since passed):** Passed offline check. A live smoke check of the merged code (not any automated test) found 3 duplicated pairs in a real 10-paper list; two narrower, id-based fixes each failed their own independent review in a new shape (first: merged genuinely different papers in rare chain/hub cases; second: still missed chains and hubs where a bridging paper had no id at all, or an id of a different kind). A third, structural fix — checking every paper in a suspected group directly against every other paper in it, never comparing ids at all — closed the whole class and was independently VERIFIED from 41 freshly-built adversarial test cases, zero mismatches found. See §2b for the full three-round account. | 2026-09-24, P2 baseline (offline-only fixtures); regression found and fixed across three rounds (`docs/jev-abc/DEDUP-FIX-C-*`, `DEDUP-FIX-A-*`, `DEDUP-FIX2-C-*`, `DEDUP-FIX2-A-*`, `DEDUP-FIX3-C-*`); independently VERIFIED `docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`; re-confirmed in the end-of-round re-measurement `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 7 | Hybrid ranking (RRF) deterministic, balanced, capped, diverse | Passed offline check — the feature is built; its flag-off state (nothing changes) is independently verified offline; the ranking computation is code-reviewed and its shipped shape is deterministic/capped as designed; the 2 accuracy gaps review found are now both fixed and independently VERIFIED (`docs/jev-abc/P2-S6-FIX-A-20260924T153735Z.md`). Flag stays off in production pending the separate §1p.B(1) evaluation sign-off — a deliberate gate, not an unresolved defect | 2026-09-24, P2 baseline; updated P5-S3 from P2-S6 fresh A; updated P5-S4 from P2-S6-FIX fresh A ("acceptance 7 PASS offline as implemented"); re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 8 | Same public request reuses retrieval; different scopes never collide | **Partial** — the within-process reuse/coalescing mechanism and collision-freedom (including across differing senses, filters, and private scopes) are independently VERIFIED offline; the clause requiring the SAME public request across different users/processes to reuse retrieval needs the shared public retrieval cache, which stays BLOCKED per §1k (built but deliberately unwired) | 2026-09-24, P2; refined by the end-of-round re-measurement and manager reading, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md`, `ABC-JEV-INTEGRATION.md` §4 2026-09-24T22:44:41Z |
| 9 | Personal data fully isolated between users, including adversarial two-user tests | **Blocked** — offline mechanics pass; the real two-user database proof needs a database this campaign does not have | 2026-09-24, P0; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 10 | Jev's data format, typed unknowns, score checks, version pinning, fault handling | Passed offline check (no live Jev call has ever been made) | 2026-09-24, P3; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 11 | Unchanged input reuses cache; changed input invalidates only the right layer | **Partial** — the cache-key invalidation rule itself (owner+project+intent+content+provider+model+rubric, no date/clock in the key) is independently VERIFIED offline and is wired into the shadow-decision runner; nothing reaches it live yet because the Jev shadow and broker flags both stay off by default, not because the wiring is incomplete. A separate cache layer for full report content was not independently re-verified this round — open item, not a failure | 2026-09-24, P3; refined by the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 12 | Company keys never reach the client or logs; spend limits are atomic and can't be doubled | **Corrected (was stale — an unqualified pass overstated this): Partial.** The Jev/broker path itself passes offline: ordered atomic per-user/global daily-call reservation (the double-counting bug above is fixed and independently verified), the company AI key never reaches the client or logs, and the Edge side uses its own separate counter namespace. But main's GENERAL company-funded AI (ordinary feed re-ranking, short reports, query generation, figure matching — not just Jev) has only a per-hour request-count limit that fails open on an outage, not a dollar or call-count ceiling — so "atomic budgets prevent overspend" holds for the Jev/broker path specifically, not campaign-wide. The Edge Function's own entitlement/tier check is also still absent (accepted cost, §1p.I, with a hard threshold before company-funded Jev may be enabled anywhere live). | 2026-09-24 (Jev-path fix verified 11:52 UTC); re-scoped by the end-of-round re-measurement and manager reading, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 13 | A durable delivery queue survives duplicate sends, two workers, crashes, timeouts | Partial — an offline job-queue engine (due-time math, retry/backoff, a memory-backed and a real-database-backed repository, fencing against stale data) is now built and independently code-reviewed; nothing in the app calls it yet, so it changes nothing live today; proof under real concurrent database access (two workers racing for the same job, a crash mid-job) remains blocked — this campaign has no database to test against; the trigger itself is a separate open user decision | 2026-09-24, updated P5-S3 from P4-S8b fresh A; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 14 | Scheduled feed ready ahead of your reading time; time-zone-safe; honest status | Partial — the time-zone math for the existing scheduled email remains proven correct; the engine for having results ready a bit early (see item 13) is now built and offline-verified but connected to nothing live yet | 2026-09-24, updated P5-S3 from P4-S8b fresh A; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 15 | Manual refresh doesn't waste work; cooldowns and budgets work; just opening the app never triggers AI calls | Partial, most of the way closed — opening the app / checking status never triggers an AI call (confirmed, unchanged); the double-work-on-concurrent-refresh bug (see §2) is now fixed and independently proven under real concurrent requests; a manual-refresh cooldown is now built and offline-verified but not wired to any live refresh path yet — that wiring arrives together with item 13's queue, gated on the same trigger decision | 2026-09-24, updated P5-S3 from P4-S8a + P4-S8b fresh A's; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 16 | Only never-before-shown papers compete the next day, across ~20 named edge cases | Partial — the core mechanism passes offline with two small, accepted, documented trade-offs. **Corrected (was stale):** the two "signed in with no batch yet" edge cases are no longer being worked on — both are now fixed and independently verified; what remains is one narrow, named, accepted gap with its own hard threshold before any batchless-mode launch (see the `PEER_DASHBOARD_LEDGER` row in §1). **New this pass:** explicit access to a past day's already-sent batch ("archive") is now built and independently offline-verified, sitting behind the same `PEER_DASHBOARD_LEDGER` switch as the rest of this item — it only ever reads a batch that was already sent to that person, in the exact order it was sent, and never re-picks, re-sends, or records anything. It never mints a batch and never marks one as acknowledged. Where in the product a person would actually reach this (a page, a button, a settings entry) is still an open decision, not settled by this pass. | 2026-09-24, P4 baseline; edge-case fix independently VERIFIED (P4-S5b-FIX3, 14:23 UTC); archive access built + offline-verified this pass (P4-S9); independently VERIFIED, `docs/jev-abc/P4-S9-A-20260924T230835Z.md` |
| 17 | Pool and daily-brief size limits respected; brief vs. deep report kept separate; the no-AI-keys mode still works | Passed offline check | 2026-09-24, P4; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 18 | Paired quality/cost evidence, multilingual cases, an independent reviewer, a tested rollback, no invented numbers | **Corrected (was stale — labelled "Not started," which undersold real, verified progress): Partial.** The metric instruments themselves — precision/recall/nDCG, a bootstrap confidence interval (with a guard fix independently verified), and a lifetime-duplicate-count auditor reusing the exact same identity check the live exclusion path uses — are built and independently VERIFIED offline. Multilingual handling is confirmed at the underlying data-truncation layer. Rollback files and their 1:1 match with migrations are confirmed. But the actual deliverable — a paired comparison of the three arms on real project data, with real labels — has genuinely not started: no dataset, no labellers named, no pre-registered quality/budget thresholds, and no held-out result exist anywhere in this campaign yet. No fabricated uplift or savings number was found anywhere. | 2026-09-24 — this document; re-scoped by the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |

### 7. Gates run this round (`web/`, all times UTC)

- `npx vitest run src/lib/release/rollback-parity.test.ts` before the rollback files
  existed: **14 failed / 1 passed** (RED, as expected — only the directory-sanity canary
  test could pass with nothing on disk yet).
- Same command after all 6 rollback files + README landed: **15 passed / 0 failed**
  (GREEN).
- Full gate results (FULL `vitest run`, `tsc --noEmit`, `lint`) and the
  `rollback`-reference grep sweep are recorded in this item's checkpoint file
  (`docs/jev-abc/P5-S1-C-*.md`) rather than duplicated here, since they reflect the
  state of the whole branch, not only this document's own files, and this branch has
  several other concurrent writers whose own gate counts change independently.
- **P5-S3 re-ran the same gates fresh** from `web/`, 2026-09-24:
  `rollback-parity.test.ts` **17 passed / 0 failed** (now 17, not 15 — the 7th
  migration/rollback pair added since P5-S1); FULL `vitest run` **212 passed | 1 skipped
  test files (213), 4069 passed | 1 skipped tests (4070), 0 failed**; `tsc --noEmit`
  **exit 0, 0 errors**; `npm run lint` **exit 0, 0 errors, 2 warnings** (same
  pre-existing unused-var warnings noted before, unrelated to this campaign). Exact
  counts and commands are in that pass's own checkpoint,
  `docs/jev-abc/P5-S3-C-20260924T153429Z.md`.
- **P5-S4 (this final-status pass) re-ran the same gates fresh** from `web/`, on the
  merge commit `6f518512` with DEDUP-FIX2 C's uncommitted changes on top (the working
  tree at the time of this pass), 2026-09-24T21:49–21:50Z: `rollback-parity.test.ts`
  **17 passed / 0 failed** (unchanged — still 7 migration/rollback pairs, confirmed
  unaffected by the merge); FULL `npx vitest run --exclude "**/benchmark.test.ts"`
  **246 passed test files (246), 4471 passed tests (4471), 0 failed** (run twice for
  exit-code confirmation, byte-identical counts both times, exit 0 both times — matches
  `docs/jev-abc/DEDUP-FIX2-C-20260924T212607Z.md`'s and
  `docs/jev-abc/MERGE-A-20260924T203103Z.md`'s own claimed counts exactly, confirming no
  drift); `npx tsc --noEmit` **exit 0, 0 errors**; `npx eslint .` **exit 0, 0 errors,
  149 warnings** (same pre-existing warnings noted throughout this campaign, unrelated).
  Plain-language mechanical grep on Part 1 (this pass's own additions included) and a
  secrets grep over both target files were also run this pass — exact commands, counts,
  and this pass's own checkpoint: `docs/jev-abc/P5-S4-C-20260924T214335Z.md`.
- **This round's final gate numbers, from the last fresh, independent gate run**
  (`docs/jev-abc/P4-S9-A-20260924T230835Z.md`, 2026-09-24T23:19:32Z–23:21:19Z, from
  `web/`): `npx vitest run --exclude "**/benchmark.test.ts"` **247 passed test files
  (247), 4514 passed tests (4514), 0 failed**; `npx tsc --noEmit` **exit 0, 0
  errors**; `npx eslint .` **exit 0, 0 errors, 149 warnings** (the same pre-existing
  baseline noted throughout this campaign); `npm run build` **exit 0**, with
  `ƒ /api/feed/archive` present in the route table. The manager independently
  re-ran two of these gates once more after that, 2026-09-24T23:23:37Z–23:23:55Z:
  `npx tsc --noEmit` **exit 0**; `npx vitest run` with no exclude flag (so the
  normally-skipped live-events benchmark file is included too) — **247 passed test
  files + 1 skipped, 4514 passed tests + 1 skipped, 0 failed** (the 1 skipped
  file/test is that opt-in live benchmark, which skips itself outside its own
  explicit opt-in flag — not a new gap). **This pass (P5-S5) is doc-only and did not
  itself run any test/build command** — the numbers above are cited from the sources
  named, not re-executed here.

### 8. User decisions — 5 still open; #1 now RESOLVED

1. **Company-funded AI option — RESOLVED this pass (§0b/§1s), in main's favour.** The
   user authorized merging `origin/main`, which adopts main's company-funded AI rules
   (every model-reaching route requires a `ProviderContext`; `requireEntitledAiRequest`
   gates 6 routes; deep reports counted once via `consumeDeepReport`) in place of the
   Jev branch's own stricter, keys-only rule. **The recorded risk stands and is restated
   here because it is now live, not hypothetical:** main's rule caps only two specific
   expensive actions — deep reports and forced full rebuilds — with **no general LLM
   spend cap** on anything else that reaches a model (feed re-ranking, short reports,
   query generation, figure matching). This is now the single largest open billing
   exposure in the merged system (independently restated as NEW FINDING 1 in
   `docs/jev-abc/MERGE-A-20260924T203103Z.md`). **Now also un-gates (but does not by
   itself complete) the background-only backup opinion**
   (`PEER_JEV_GEMINI_FALLBACK`, §1/§2 Group B8): that feature is built, off, and
   structurally inert until the company-funded capability it depends on is actually
   wired up — a separate, not-yet-started implementation step, not something this
   resolution alone finishes.
2. **Cross-channel dedupe policy.** Should email and dashboard delivery share one
   "already shown" record, or stay fully independent as today?
3. **Who/what triggers the scheduled digest send** — and now also the already-built
   "prepare results ahead of time" job queue and its 15-minute manual-refresh cooldown
   (§2): both exist in code and pass their offline tests, but neither is connected to
   anything, specifically because this decision has not been made. A production
   scheduling change nobody but the user may authorize.
4. **Live call authorization** — exact scope, volume, and budget for real calls to
   Semantic Scholar, OpenAlex, and Jev. Also answers whether one specific paper-search
   service still works without a paid key. Unblocks acceptance items 4 and 18 and the
   entire evaluation pilot in §5.
5. **Automatic email-retry sweep.** A safe one-time retry exists in the code today; a
   recurring automatic sweep would be a new schedule, needing the same authorization as
   decision 3.
6. **Who labels the ~200-pair pilot** — two independent domain labellers plus a named
   tie-breaker, none of whom wrote Peer's retrieval or ranking code (§5).

**Adjacent, not separately tallied in the 6 numbered items above (5 open + #1
resolved):** the `private_paper_pools` retention period (§3.2) is functionally the same
kind of decision (a separately approved retention/backup plan under the campaign's
evaluation-and-release rules) but was raised after the 6 above were already counted, so
it is recorded here rather than renumbering.
Semantic Scholar's own commercial-use confirmation is treated as folded into decision 4
(both gate "live Semantic Scholar use") and is likewise not separately tallied.
