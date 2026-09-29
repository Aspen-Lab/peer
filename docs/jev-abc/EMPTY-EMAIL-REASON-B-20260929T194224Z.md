# EMPTY-EMAIL-REASON — Investigator (B) Guide

STATUS: COMPLETE

Branch: Jev-integration-and-sorting-filtering-enhancement
HEAD at start and throughout: c72d1b5a64abf37a6fab5b425f0b6c24ff9adc5d (no product
file was touched; only this guide and one deleted temporary probe file).

Role: B (investigator). Read-only on product code. Writes: this file, and a
temporary probe test file under `web/src/lib/email/` prefixed
`__b_email_probe_`, deleted at the end (git-status proof in §2.4).

Every file:line citation below was read directly from the working tree at
this HEAD. Where a citation in the source EMPTY-STATE-REASON-B guide
(`docs/jev-abc/EMPTY-STATE-REASON-B-20260929T113729Z.md`, written against an
older commit) has since moved, this guide gives the current line and says so
— do not carry the old numbers forward.

## Progress log

1. Read ABC-JEV-INTEGRATION.md §0-§3, §1bb + its CORRECTION, §1bf
   (DIGEST-CATCHUP), §1bh, web/AGENTS.md, docs/PRODUCT_DIRECTION.md — DONE.
2. Read EMPTY-STATE-REASON-B's own guide in full (the direct predecessor to
   this item) — DONE. Its 12-path enumeration and 4-code waterfall are
   reused below, re-verified against current line numbers.
3. Read the digest template, the dispatcher, the pipeline's
   `computeEmptyReasonCode`/`FeedMeta.emptyReasonCode`, `copy.ts`,
   `empty-reason.ts`, `send-test-email/route.ts`, `test-digest/route.ts`,
   `digest-retry.ts`, `send-digest.ts`, and the relevant test files — DONE.
4. Task 1 (enumeration) — DONE, §1 below.
5. Task 2 (proof by execution) — DONE, §2 below. Probe file written, run
   scoped to itself only, all assertions passed, then deleted.
6. Task 3 (options) — DONE, §3 below.
7. Task 4 (parity / never-guess rule) — DONE, §4 below.
8. Task 5 (tests + POLICY) — DONE, §5 below.

---

## §1. Enumeration — every way a digest (scheduled or test) ends with zero papers

### 1.0 Two different categories — keep them separate

**Category X — no email is sent at all.** The reader is skipped or the run
fails before any content is rendered. There is nothing to put a reason
sentence into, because no email exists. Not this item's problem, but listed
for completeness so the manager can see what is deliberately excluded.

**Category Y — an email IS sent (or would be, by a test send), and its body
has zero papers.** This is the actual problem: today it always renders
`"No items matched your topics today. Try adjusting your signals."`
regardless of cause. This item is about Category Y only.

### 1.1 Category X — reader skipped before any pipeline call (dispatch only)

All in `web/src/app/api/jobs/dispatch-digests/route.ts`, all tallied in the
JSON response's `skipped_reasons`/`failed_reasons` (never seen by the reader
at all):

| Reason code (wire) | Where | Meaning |
|---|---|---|
| `before_chosen_hour` | route.ts:403-407 | reader's local hour hasn't reached their chosen send hour yet, same local date |
| `frequency_skip` | route.ts:408-412 | `digest_frequency` (weekdays/weekly) doesn't admit today |
| `intent_required` | route.ts:413-417 | no project/challenge/topic ever declared |
| `deferred_time_budget` | route.ts:427-430 | run is past its ~240s wall-clock budget (DIGEST-CATCHUP §1bf.3); reader stays due next run |
| `recent_delivery` | route.ts:441-444 | a `briefing_deliveries` row in the last 6h |
| `already_delivered_today` | route.ts:491-494 | flag-off path only; a delivery already on today's local date in the reader's timezone (DIGEST-CATCHUP same-date guard, §1bf.1) |
| `delivery_check_error` | route.ts:483-487 | the 26h-lookback read itself failed — fails CLOSED, reader stays due (§1bf.9 AMENDMENT) |
| `already_claimed` / `local_date_unavailable` / `claim_error` | route.ts:558-587 | flag-on (`PEER_DIGEST_DEDUPE=on`) path only — not live in production (§1bf.1 says this flag "is NOT required and is not asked of the user now") |
| `pipeline_error` | route.ts:681-684 | `runFeedPipeline` itself threw (a source adapter threw synchronously, a scoring bug, etc.) — caught per-reader, loop continues |

None of these reach the email template. Out of scope for this item.

### 1.2 Category Y — the pipeline's own 4-code waterfall (shared by every caller)

This is EMPTY-STATE-REASON's shipped mechanism (ABC-JEV-INTEGRATION.md
§1bb + CORRECTION), and it is **already** exercised by every caller of
`runFeedPipeline`, including the digest paths — nothing about it is
home-page-specific in the code itself. Current locations (re-verified at this
HEAD; the pipeline file has not changed since EMPTY-STATE-REASON shipped):

- `computeEmptyReasonCode(sourceStatus, inWindowCount, scoredCount)` —
  `web/src/lib/feed/pipeline.ts:1092-1101`, NOT exported (module-private).
- Call site, only when `returned.length === 0` —
  `web/src/lib/feed/pipeline.ts:2163-2166`.
- Attached to the response as `meta.emptyReasonCode`, structurally absent
  otherwise — `pipeline.ts:2196-2200`.
- The 4 codes, declared once — `web/src/lib/feed/types.ts:134-138`
  (`FeedEmptyReasonCode`) and the runtime-checkable twin
  `FEED_EMPTY_REASON_CODES` at `types.ts:148-153`.
- The exclusion hard-drop and review-paper filter that fold into
  `no-required-match` have MOVED since the predecessor guide was written:
  now `combine.ts:208` (reader's own exclusions, was cited as `:195`) and
  `combine.ts:411` (review-paper filter, was cited as `:392`) — both still
  inside the same `scoreItems()` whose output is `scored`.

The waterfall, first match wins, called only when `returned.length === 0`:

| Order | Check | Code | Meaning |
|---|---|---|---|
| 1 | `everySourceFailed(sourceStatus)` | `sources-unreachable` | every attempted academic source failed |
| 2 | `inWindow.length === 0` | `no-results` | nothing fetched, or nothing survived the freshness ceiling |
| 3 | `scored.length === 0` | `no-required-match` | nothing cleared the Required gate, the reader's own exclusions, or the review-paper filter |
| 4 | else | `already-delivered` | something scored, but everything was removed by `excludeIds`/`ledgerExclusions` before the final slice |

This part needs **no new code** for the email — it already runs, for free, on
every digest and test-email pipeline call, because `runFeedPipeline` is one
shared function. The gap is entirely that **nothing reads `feed.meta` when
building the email** (see §1.6).

### 1.3 Per-caller reachability — which of the 4 codes can each sender actually produce

Three callers reach `runFeedPipeline` and then (may) call
`sendDigestEmail`/build a digest body. Each passes a different shape of
request, which changes which codes are reachable:

| Caller | File | `excludeIds` passed? | `ledgerExclusions` passed? | `topN` | Reachable codes |
|---|---|---|---|---|---|
| Scheduled dispatch | `dispatch-digests/route.ts:514-534` | yes — `Array.from(seenIds)`, the 30-day `briefing_deliveries` set (route.ts:497-507) | no | `row.paper_count ?? 10` | all 4 |
| Test email (product button, rate-limited 3/day) | `profile/send-test-email/route.ts:199-206` | **no** — field never set | **no** | `typedProfile?.paper_count ?? 10` | `sources-unreachable`, `no-results`, `no-required-match` in the ordinary case; `already-delivered` only through the `topN` edge case below (§1.7) — never through a real exclusion, because none is ever supplied |
| `POST /api/test-digest` (older dev-only smoke route, gated behind `canUseLocalServerProvider()`, test-digest/route.ts:124-126 — effectively unreachable on the deployed site) | `test-digest/route.ts:177-184` | no | no | same as above | same as test-email, for the same reason |

So the **home page and the scheduled dispatch are the only two callers where
`already-delivered` is a real, meaningful signal** (a genuine 30-day-window
or ledger exclusion). For the two test-send paths it is realistically never
true and would need the `topN`-edge-case caveat in §1.7 to ever appear at
all — worth stating plainly to whoever writes the copy, so nobody reads
"already-delivered" in a test-send context as "your last 3 test sends already
covered this."

### 1.4 The dispatcher's own post-pipeline 30-day filter — does it need its own code?

**The manager's pointer said to verify, not inherit, so this was checked by
direct code reading plus execution (§2.1/§2.2). Verdict: no, it does not
need a new code — it is provably a no-op given the code as written today,
though a fragile one.**

`dispatch-digests/route.ts:497-507` reads `briefing_deliveries` for the last
30 days into `const seenIds = new Set<string>(...)`. That exact `seenIds` is
used **twice**, synchronously, with no reassignment and no `await` that could
change it in between:

1. Passed into the pipeline call as `excludeIds: Array.from(seenIds)`
   (route.ts:520) — the pipeline's own `fresh` filter
   (`pipeline.ts:2107-2116`) removes any candidate whose `.id` is in that
   set, **before** `returned = fresh.slice(0, topN)` is computed. So
   `feed.items` (== `returned`) can never contain an id from `seenIds`.
2. Re-applied at route.ts:536:
   `const freshItems = feed.items.filter((i) => !seenIds.has(i.id)).slice(0, targetCount);`

Because step 2 filters the *same* set against a collection that step 1
already guarantees has zero overlap with that set, `freshItems` is always
exactly `feed.items` (the trailing `.slice(0, targetCount)` is also a no-op,
since the pipeline already respects `topN: targetCount`). There is no code
path between the two steps that could add, remove, or resize `seenIds`, and
nothing else filters `feed.items` before `freshItems` is built. This was
proven both by this argument (a proof by construction — no divergence window
exists in the code) and by running the real pipeline on constructed inputs
(§2.1/§2.2): every case where the redundant filter could matter produces an
identical result to `feed.meta.emptyReasonCode`.

**Practical conclusion:** `feed.meta.emptyReasonCode` already accounts for
whatever the email will actually send — the redundant filter is dead weight,
not a second source of unexplained emptiness. **But this is an unenforced
invariant**, not something a type or test currently pins (the route's own
tests mock `runFeedPipeline` directly and never exercise the real exclusion
arithmetic — see §5). A future edit — capping `excludeIds` for performance,
adding a second, stricter post-filter, or changing what feeds `seenIds` in
one place but not the other — could silently reopen exactly the gap the
manager suspected. §5 lists a regression test for this specifically, and §3's
recommendation says what C should do about the redundant filter itself.

### 1.5 The idempotent-retry replay path (flag-gated, not live in production)

`web/src/lib/email/digest-retry.ts`'s `handleConflictingEmailClaim` (the
`PEER_DIGEST_DEDUPE=on` conflict branch, case 3, lines 127-133, function
starts at line 83) replays a
previous attempt by calling `sendDigestEmail` with `items: []` and
`originUrl: ""` **but also** a `render: {subject, html, text}` taken
verbatim from the stored row. `send-digest.ts:81-83`
(`input.render?.subject ?? renderDigestSubject(input.items)`, same pattern
for html/text) means the stored bytes always win when `render` is supplied —
`items`/`originUrl` in that call are unused placeholders. So a retried send
faithfully reproduces whatever the FIRST attempt rendered, including an empty
one — consistent, not a new gap. This path is dormant today: §1bf.1 records
that `PEER_DIGEST_DEDUPE`/the claim RPC "is NOT required and is not asked of
the user now." Noted for completeness; whatever copy this item ships for the
empty case automatically covers this path too, since it replays the exact
same rendered bytes.

### 1.6 digest-template.ts's own pre-existing HTML/plaintext parity gap

This predates this item and is not reason-code-specific — it is a plain
inconsistency, confirmed by execution in §2.3:

- `renderDigestHtml` (`digest-template.ts:139-149`) has an explicit empty
  branch: `"No items matched your topics today. Try adjusting your
  signals."` (line 148).
- `renderDigestPlaintext` (`digest-template.ts:67-93`) has **no** empty
  branch at all. For zero items it unconditionally prints
  `"Here are 0 items worth your attention today."` (line 76) and then the
  per-item loop simply appends nothing. A plaintext reader sees a sentence
  that sounds like a typo or a bug, never an explanation.
- `renderDigestSubject` (`digest-template.ts:56-65`) already degrades sanely
  for zero items (`"Your Peer briefing · <date>"`, no item-derived text) —
  fine as is, no change needed.

Whatever this item ships MUST fix this baseline gap as part of the work, not
just add reason codes on top of an already-inconsistent pair — see §4.

### 1.7 Edge case found while proving §1.3: `topN`/`paper_count` of 0 mislabels the cause

`computeEmptyReasonCode` never sees `topN` — only `sourceStatus`,
`inWindow.length`, `scored.length` (`pipeline.ts:1092-1101`). If a candidate
clears the Required gate (`scored.length > 0`) but `topN` is 0, `returned`
is sliced to `[]` regardless, and the waterfall's 4th branch fires:
`already-delivered` — even though nothing was ever actually excluded by
`excludeIds`/`ledgerExclusions`. Proven by execution in §2.2.

`FeedControls.paperCount` is typed `5 | 10` at the TypeScript level
(`web/src/lib/feed/profile-compiler.ts:16`), and the UI is presumed to only
ever write 5 or 10 — but that is a compile-time promise about the code that
*writes* the column, not a runtime constraint on the `profiles.paper_count`
column itself, and none of the three callers clamp `row.paper_count`/
`typedProfile?.paper_count` to a minimum before passing it as `topN` (each
only defaults a `null`/`undefined` to 10 — `?? 10` — never a 0). No evidence
was found that any live UI path can currently write 0, so this is reported as
a **latent risk in the shared waterfall function**, not a proven live bug —
and it is not specific to email: the home page inherits the exact same risk
already, since `computeEmptyReasonCode` is the one function both callers
share. Out of this item's fix scope (fixing `computeEmptyReasonCode` itself
is a product-pipeline change, not a copy/template change), but worth a
one-line flag to the manager (§5 POLICY) since reusing the code's output
verbatim in a second surface (email) doubles the blast radius of this one
latent mislabel if it is ever hit.

---

## §2. Proof by execution

Temporary probe file (deleted — see §2.4):
`web/src/lib/email/__b_email_probe_dispatch_reason.test.ts`

Built on the exact same fixture/mocking conventions as the already-shipped
`web/src/lib/feed/empty-reason-code.test.ts` (mock `bySourceId.openalex.fetch`
directly, stub Supabase env vars empty, `MemoryPoolCache`, a real
`createTrustedPaperCacheScope`) — this is the codebase's own established
"exercise the real pipeline with zero network" pattern, reused rather than
invented. Run scoped to itself only:
`npx vitest run src/lib/email/__b_email_probe_dispatch_reason.test.ts` from
`web/`. No dev server, no HTTP call, no `sendDigestEmail`/Resend import at
all (the probe never sends anything, satisfying the "never send an email"
constraint structurally, not just by not calling `.send()`).

### 2.1 PROBE A — the dispatcher's redundant 30-day filter, partial overlap

Two textually distinct matching papers (see the methodology note below on
why two *different* `matchingPaper` fixtures were needed), one in
`seenIds`. Ran the real `runFeedPipeline` with
`excludeIds: Array.from(seenIds)`, then reproduced route.ts:536's exact
expression against the real result.

Result: `feed.items` contained only the non-excluded paper;
`feed.meta.emptyReasonCode` was `undefined` (correctly, non-empty); the
route's redundant filter (`freshItems`) produced an **identical** array —
removed nothing beyond what the pipeline already had. PASSED.

### 2.2 PROBE A — full overlap, and the `topN`-0 mislabel

Both papers in `seenIds`: `feed.items` was `[]`,
`feed.meta.emptyReasonCode === "already-delivered"`, and the route's
redundant filter agreed (`[]`, nothing further to explain) — confirms §1.4's
conclusion on a genuinely empty case, not just a non-empty one. PASSED.

Test-email call shape (no `excludeIds` field at all) with one matching paper
and `topN: 10`: non-empty, no `emptyReasonCode`. PASSED (sanity).

Same call shape, `topN: 0`: `feed.items` was `[]` and
`feed.meta.emptyReasonCode === "already-delivered"` — reproduced §1.7's
mislabel with a real pipeline run, no exclusion mechanism supplied anywhere
in the call. PASSED (this is the proof, not just the sanity check).

### 2.3 PROBE C — template parity

`renderDigestHtml({items: [], ...})` contains `"No items matched your
topics today"`. `renderDigestPlaintext({items: [], ...})` contains none of
that sentence, none of `"matched your topics"`, `"adjusting"`, or
`"signals"` — only the bare `"Here are 0 items worth your attention
today."`. `renderDigestSubject([])` still reads
`"Your Peer briefing · <date>"`. All PASSED, confirming §1.6 by execution,
not just by reading.

### 2.4 Methodology note, and cleanup proof

First run of PROBE A's "partial overlap" case failed: two `matchingPaper(id)`
calls with *different* ids but the *same* title/abstract were merged into
ONE surviving candidate by the pipeline's own real dedup logic (title-based
identity in `dedup.ts`) — not a bug, but it meant the fixture needed a second,
textually distinct `matchingPaper2` helper to actually test two independent
candidates. Recorded here because it is itself a small piece of independent
confirmation that dedup ran for real (a mock that always "passed" would not
have caught this) and so the next reader of this guide doesn't repeat the
same fixture mistake. The plaintext-parity test also initially over-asserted
(`not.toContain("today")`, which also matched the header date and the count
sentence) — narrowed to the specific empty-case phrases. Final file: 7 tests,
all green, shown in full below then deleted.

```
$ npx vitest run src/lib/email/__b_email_probe_dispatch_reason.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

Cleanup — probe file deleted and confirmed gone from the working tree:

```
$ rm "web/src/lib/email/__b_email_probe_dispatch_reason.test.ts"
$ git status --porcelain=v1 -- web/src/lib/email/
   (no output — nothing left under web/src/lib/email/)
```

(Full `git status` at the end of this investigation, including the
pre-existing concurrent UPLOAD-404 investigator's own guide file and the
pre-existing `ABC-JEV-INTEGRATION.md` modification neither of which is
mine, is in §6.)

---

## §3. Options for what an empty-day email should do

All three real senders (dispatch, test-email, test-digest) go through the
same two template functions, so whatever is decided here is one change, not
three.

### Option (a) — reuse the four codes and the home page's exact sentences

Thread `feed.meta.emptyReasonCode` into `DigestTemplateInput`, look it up in
the SAME `BRIEFING_EMPTY` table (`web/src/lib/briefing/copy.ts:57-86`) the
home page already uses, verbatim.

- **What the reader sees:** e.g. "You're caught up on these topics. Every
  match for today was already in your feed. Check back after it refreshes,
  or widen your topics." — in an email.
- **Cost:** lowest implementation cost — one shared copy source, zero new
  strings, automatically stays in sync with any future home-page wording
  change.
- **Real problem found:** two of the four lines are written in page voice,
  not email voice. `"Refresh to try again"` (sources-unreachable) and
  `"...Check back after it refreshes..."` (already-delivered) both assume a
  page with a Refresh button the reader is looking at right now. An email
  has no such button — the closest equivalent is the existing "Open in
  browser" footer link (`digest-template.ts:196`), already present on every
  digest regardless of empty/non-empty. Read literally in an inbox, "Refresh
  to try again" is a dangling instruction.
- **Also inaccurate for one code:** "already-delivered"'s web meaning is
  "shown to you on this device/session, or (signed-in, ledger on)
  ever" — a **different, and for the ledger case much longer-lived**,
  exclusion source than the dispatcher's own 30-day `briefing_deliveries`
  window (§1.4). The web copy "was already in your feed" is true either way,
  but doesn't say *when* — fine on a page you're looking at right now, a bit
  vaguer in an email that arrives once a day.
- **Product decision?** Wording is always a product call, but the *shape* of
  this option (reuse the codes, do not invent a 5th) is not — it follows
  directly from §1bb.6's existing ruling to keep the set small and fixed.

### Option (b) — different, email-specific wording for the same four codes

Same `emptyReasonCode` plumbing as (a), but a **second** small copy table
(e.g. `DIGEST_EMPTY` next to `BRIEFING_EMPTY` in `copy.ts`, or colocated in
`digest-template.ts`) written in email voice and dropping the
"Refresh"/"Check back" imperatives in favor of what an email can actually
promise ("Peer will keep checking — no action needed" / "Your next briefing
will look again automatically").

- **What the reader sees:** a sentence that reads naturally in an inbox and
  is honest about the timeframe ("already delivered" → "sent to you
  recently" language, sidestepping the 30-day-vs-ledger distinction rather
  than getting it wrong).
- **Cost:** one extra small copy table (4 short strings) to keep in sync by
  hand with the home page's four if either is ever revised — a real but
  small maintenance cost, mitigated by keeping both tables next to each
  other and keyed by the same `FeedEmptyReasonCode` type so a missing key is
  a compile error, not a silent gap.
- **This is the one real product/wording decision** in this list — the
  MANAGER or user should pick the actual sentences, same as §1bb.1's POLICY
  1 did for the home page.

### Option (c) — never send a scheduled email on an empty day

Skip the `sendDigestEmail` call (and, for the flag-on path, the retry
machinery) whenever `freshItems.length === 0`, but this needs three
follow-on decisions spelled out, exactly as the task asks:

- **The `briefing_deliveries` row:** today, EVERY dispatched reader gets a
  row inserted regardless of item count (`route.ts:620-627` flag-off,
  outside the `isEmailChannel` block; the claim RPC likewise, flag-on) —
  `dispatchedCount += 1` happens unconditionally too (`route.ts:636`, before
  the email block at 641). Recommend **keeping the row** (`item_ids: []`)
  and only skipping the send call, mirroring the existing, already-shipped
  in-app-only-channel case (`digest_channel: "inapp"` already writes a row
  and never emails, today, unconditionally). Skipping the row entirely
  instead would un-mark "delivered today," which feeds two other guards:
  - **DIGEST-CATCHUP's same-date guard** (§1bf.1,
    `hasDeliveryOnLocalDate`/`already_delivered_today`,
    `route.ts:293-306`, called from `route.ts:491`) reads exactly
    this table. No row ⇒ the reader is NOT marked done for today ⇒ a LATER
    run the same local day (the whole point of DIGEST-CATCHUP) reprocesses
    them. Worked through by hand: this does not create a double SEND
    (nothing was sent the first time, so a later real send is the first and
    only send that day — genuinely the "catch up once new papers appear"
    behavior DIGEST-CATCHUP was built for, not a regression of it). But it
    does mean a structurally-always-empty reader (an over-narrow Required
    topic, say) gets re-fetched from every source, every hourly tick, all
    day, forever — a real, unbounded cost regression versus today, where
    the row already caps this at once per local day regardless of content.
  - **The 6-hour `recent_delivery` guard** (`route.ts:433-444`) reads the
    same table with a shorter window; same argument, same conclusion.
  - **Past briefings** (`web/src/app/api/briefings/route.ts`, reads
    `briefing_deliveries` directly, rendered by
    `web/src/app/profile/page.tsx:1213-1252`) would show a **gap** for that
    date instead of an explicit "nothing" entry — arguably fine, arguably
    worse (a reader checking history can't tell "Peer was off" from "Peer
    found nothing," which is exactly the ambiguity this whole item exists
    to remove, just relocated to a different screen). Today it already
    shows a 0-item row with no special handling (`page.tsx:1226-1246`: falls
    back to a bare "0 items" line) — a pre-existing, out-of-scope-here
    rough edge either way.
- **What the reader sees:** nothing, on an empty day. No confusing generic
  line, but also no signal that Peer is alive and looking — indistinguishable
  from the service being broken, credentials expiring, or the reader having
  been silently unsubscribed.
- **Cost:** the row-keeping variant is a small, contained change (one
  condition around the existing `sendDigestEmail` call, same shape as the
  existing `isEmailChannel` gate) with no DIGEST-CATCHUP interaction. The
  row-skipping variant is not recommended (cost regression above) but is
  documented since the task asked for it explicitly.
- **This is a product decision**, and per `docs/PRODUCT_DIRECTION.md`'s own
  framing — Peer as "a calm daily forecast... useful enough to check every
  morning" — leans against silence: a forecast that says "clear skies today"
  is still useful; a forecast that simply doesn't arrive reads as broken, not
  calm. That framing is this investigator's basis for the recommendation
  below, not a final call.

### Option (d) — anything else found

No fourth mechanism was found beyond wording/suppression choices on the
existing four codes. Two things considered and set aside:

- **A 5th, dispatch-specific code** for the post-pipeline 30-day filter —
  not needed; §1.4 proved it is a no-op today. Adding one anyway would be
  inventing a distinction the code cannot actually observe, which is exactly
  what `docs/PRODUCT_DIRECTION.md` and this item's own §1bb precedent both
  rule out ("never a guess").
- **Showing counts** ("3 papers were filtered by your Required topics") —
  ruled out by the identical, still-binding §1bb.2 POLICY ruling
  ("no counts on screen; no fifth code") — the email is not a special case
  that should reopen that decision.

### Recommendation

**Option (b), narrowly** — reuse the four codes and the waterfall (zero new
pipeline code, §1.2), but give the email its OWN short copy table rather than
importing the page's button-voiced sentences verbatim, specifically to drop
the page-only imperatives ("Refresh", "Check back after it refreshes") and to
word "already-delivered" in a way that doesn't overclaim continuity with the
web page's own (different-scoped) exclusion. Combine with fixing §1.6's
baseline HTML/plaintext parity gap in the same change (not optional — see
§4). Leave §3(c) (suppressing the send) as a separate, explicit product
decision for the user — this investigator's read of `docs/PRODUCT_DIRECTION.md`
leans against it, but it is the user's call, not a technical one.

---

## §4. Parity rule and the never-guess rule, made concrete for C

1. **One source of truth per code, two renderers.** Both
   `renderDigestHtml` and `renderDigestPlaintext` must read the SAME small
   copy table (whichever option is chosen) keyed by the SAME
   `FeedEmptyReasonCode` union already declared once in
   `web/src/lib/feed/types.ts:134-138` — never two independently-maintained
   string literals. This is exactly how `copy.ts`'s `NOTHING_NEW_TITLE`/
   `NOTHING_NEW_LINE` constants already avoid drift between two callers
   (`copy.ts:28-30`) — same pattern, reused.
2. **Fix §1.6 first, structurally.** `renderDigestPlaintext` currently has
   no empty-case branch at all (`digest-template.ts:67-93`) — it needs one,
   symmetric with `renderDigestHtml`'s existing `items.length === 0 ? ... :
   ""` branch (`digest-template.ts:146-149`), before any reason-code text is
   layered on top. A reason-coded HTML email next to an unchanged, still-buggy
   plaintext part would be a regression of trust in the fix, not a completion
   of it.
3. **`DigestTemplateInput` gains one optional field**
   (`digest-template.ts:50-54`), e.g. `emptyReasonCode?: FeedEmptyReasonCode`,
   populated by each of the three callers from `feed.meta.emptyReasonCode`
   — structurally optional/absent, mirroring how `FeedMeta.emptyReasonCode`
   itself is only ever present when resolved (`pipeline.ts:2196-2200`).
4. **Never guess.** When `items.length === 0` and `emptyReasonCode` is
   absent, OR present but not one of the four known literals (an older
   caller, a future server talking to code that hasn't shipped a 5th string
   yet, or vice versa), both renderers fall back to TODAY's existing generic
   sentence — never a default guess dressed up as a specific reason. This is
   the exact discipline `empty-reason.ts:66-69` already applies on the
   client (`FEED_EMPTY_REASON_CODES.includes(...)`, not a bare truthiness
   check) — the email side should check membership in
   `FEED_EMPTY_REASON_CODES` (`types.ts:148-153`) the same way, not just
   `if (emptyReasonCode)`.
5. **Never invent a count or a specific paper reference** in the empty-case
   email copy — same §1bb.2 boundary the home page obeys, unchanged by this
   item.
6. **Subject line stays generic.** `renderDigestSubject` already degrades
   safely for zero items (§1.6) — no reason-code branching needed there;
   changing the subject per-reason risks it reading as clickbait-different
   from the body on days the body is short.

---

## §5. Tests the fix needs, and the POLICY list for the manager

### 5.1 Tests (template-level, no network — mirrors this guide's own probe)

1. `renderDigestHtml`/`renderDigestPlaintext`, one test per code
   (`sources-unreachable`/`no-results`/`no-required-match`/
   `already-delivered`) with `items: []` and that `emptyReasonCode`: each
   produces its OWN distinct sentence, and the SAME sentence's substance
   appears in both the HTML and the plaintext output (a parity assertion,
   not just "each renders something").
2. `items: []` with `emptyReasonCode` absent → both renderers fall back to
   today's exact current generic sentence (regression pin).
3. `items: []` with `emptyReasonCode` set to a value outside
   `FEED_EMPTY_REASON_CODES` (simulate an unrecognized/future code) → falls
   back to generic, never throws, never shows the unrecognized raw string.
4. `items.length > 0` with any `emptyReasonCode` value set (a
   should-never-happen combination) → item rows render normally and the
   empty-case sentence never appears — proves the check is
   `items.length === 0 && ...`, not `emptyReasonCode` alone.
5. **Route-level, one per real sender:** `dispatch-digests/route.ts`,
   `send-test-email/route.ts` — mock `runFeedPipeline` to resolve
   `{items: [], meta: {emptyReasonCode: "no-required-match"}}` (matching the
   existing mocking style already used throughout `route.test.ts`, e.g. line
   254) and assert the HTML/text actually handed to `sendDigestEmail`
   contains the `no-required-match` sentence — today's suite only asserts
   `sendDigestEmail` was CALLED with `items: []` (route.test.ts:262-280 and
   similar), never what was rendered from it; this is a real, currently
   uncovered gap this item must close.
6. **Regression pin for §1.4** (the dispatcher's redundant filter): a
   route-level test with TWO candidates, ONE in the 30-day `seenIds`, mocking
   the DB layer so `pastDeliveries` returns one id and `runFeedPipeline`
   resolves with both the excluded and non-excluded item already correctly
   filtered (i.e. a realistic pipeline stub, not just `items: []`) → assert
   the email sent contains the non-excluded paper AND that this is not
   treated as an empty send. A mutation-style companion: if someone changes
   route.ts:536 to filter against a DIFFERENT set than the one passed to
   `excludeIds`, this test should be the one that turns red — currently
   nothing would catch that.
7. `topN: 0` (or the DB-level equivalent) with a real qualifying candidate →
   confirms §1.7's `already-delivered` mislabel still occurs (pins today's
   known behavior so a future partial fix is a deliberate, visible change,
   not silent) — record as an ACCEPTED, named risk if the manager doesn't
   want it fixed now; do not silently leave it unpinned.
8. Non-empty regression: an ordinary non-empty digest (real items) renders
   byte-identical HTML/plaintext to before this item, for both callers.

### 5.2 POLICY — manager decides

1. **Option choice (§3):** (a) verbatim home-page copy, (b) email-specific
   copy on the same four codes [recommended], (c) suppress the send
   entirely on an empty day, or a combination (e.g. (b) now, revisit (c)
   later as its own item). If (c) in any form: also decide row-keep vs
   row-skip (§3, "the `briefing_deliveries` row") — row-keep is recommended.
2. **Exact wording** of the four email sentences, if (b) is chosen — drafts
   only above; not this investigator's call, same posture EMPTY-STATE-REASON-B
   took for the home page (§1bb.1 POLICY 1).
3. **Where the new copy table lives** if (b): a sibling to `BRIEFING_EMPTY`
   in `copy.ts`, or colocated in `digest-template.ts` itself (the module
   that will actually consume it) — a file-organization call, not a
   behavior one.
4. **Whether to persist `emptyReasonCode` on the `briefing_deliveries` row**
   (so "Past briefings" could later show why a day was empty) — mirrors
   EMPTY-STATE-REASON's own deferred "(b) full coverage" option (that
   guide's §3); recommend **not now**, same reasoning (real migration cost,
   no proven need yet) — flagged here only so it isn't silently forgotten.
5. **The §1.7 `topN`/`paper_count`-0 mislabel** — fix now inside
   `computeEmptyReasonCode` (a shared pipeline change, touches the home page
   too, technically outside this item's stated scope), fix later as its own
   item, or accept as a named, tested (§5.1.7) risk given no evidence it is
   currently reachable through any live UI path. Recommend: accept and pin,
   revisit if a `paper_count` of 0 is ever actually observed.
6. **The dispatcher's redundant 30-day filter (§1.4)** — since it is proven
   dead code today, options: leave it (defense-in-depth, now backed by the
   §5.1.6 regression test so it can never silently diverge again unnoticed),
   or simplify it away (delete `route.ts:536`'s filter/slice, since
   `feed.items` already equals it) and lean entirely on the pipeline's own
   guarantee. Recommend **leave it, but add the §5.1.6 test** — removing a
   working safety net to simplify code is a smaller win than making sure it
   can never silently stop doing its job.
7. **Digest subject line** — confirmed no change needed (§1.6, §4.6); listed
   only so the manager can explicitly close this sub-question rather than
   wonder if it was missed.

---

## §6. Final state

```
$ git status --porcelain=v1
 M ABC-JEV-INTEGRATION.md                                  <- pre-existing, not mine
?? docs/jev-abc/EMPTY-EMAIL-REASON-B-20260929T194224Z.md    <- this guide
?? docs/jev-abc/UPLOAD-404-B-20260929T194224Z.md            <- the concurrent B, not mine
?? node_modules/                                            <- pre-existing, not mine
```

No product file was ever modified. The one temporary probe file
(`web/src/lib/email/__b_email_probe_dispatch_reason.test.ts`) was created,
run (7/7 passed), and deleted — confirmed absent above. No email was sent, no
HTTP route was called, no dev server or `peer.homes` was touched, `.env`/
`.env.local` were never opened.
