# EMPTY-EMAIL-REASON — Implementer (C) Checkpoint

STATUS: IMPLEMENTED_PENDING_REVIEW (fix round 3, §1bj.10, complete)

## Fix round 3 (§1bj.10) — plan, written before any edit

Verified directly in ABC-JEV-INTEGRATION.md (line 271, §1bj.10) before writing
this plan — matches the coordinator's chat paraphrase exactly. Also
independently re-verified the technical claim by reading
web/src/app/profile/page.tsx:1226 directly: `briefings.slice(0, 20).map(...)`
— confirmed, only the newest 20 rows render, while the dispatcher's 30-day
exclusion window (round-1's already-verified §1bj.5 area) covers every row
in 30 days, so a daily reader's days 21-30 are excluded but not visible on
the page — "already in your Past briefings" is false there. Ruling: reword
to something that claims only what is true and points nowhere (no link):
"You're caught up: every paper that matched today was already picked for
you in the past 30 days."

Also: this round-log entry (line 246 area) contains a line where the manager
explicitly writes "the manager confirms that message was the manager's"
about the probe-exclusion addendum I flagged and declined last round as a
possible injection — i.e. the manager has now confirmed, through the
authoritative state file itself (not just an unverifiable chat claim), that
it was genuinely theirs. Noted; I'm treating this round's near-identical
instruction (about `__b_account_probe_session_*` files) as legitimate
without re-flagging it, since the earlier instance of the same ask is now
independently confirmed via the trusted document, and this round's message
itself arrived as a normal conversation turn (not bundled after a tool
result, unlike the flagged instance).

Steps:
1. copy.ts: `DIGEST_EMPTY["already-delivered"]` becomes `{sentence: "..."}`
   with NO `link` field at all (the new sentence "points nowhere" per the
   ruling) — same plain shape as `sources-unreachable`/`no-results`.
2. Check whether the `sentence`-can-be-empty separator generalization added
   in round 2 (`reasonEmptyHtml`/`reasonEmptyPlaintext` in
   digest-template.ts) is still exercised by any real `DIGEST_EMPTY` entry
   after this change. Answer, checked against the final data: NO — after
   this edit, no entry has an empty `sentence` (the three plain-sentence
   entries are all non-empty; `no-required-match` is unchanged, sentence
   non-empty). No test directly unit-tests the empty-sentence branch either
   (those two functions are unexported; every test reaches them only through
   `DIGEST_EMPTY`, which will no longer contain that shape). Per the
   coordinator's instruction ("leave it only if a test still covers it;
   otherwise say so; do not widen scope"): reverting the two functions to
   their simpler round-1 form (always insert the separator space when a link
   exists, since every entry that HAS a link also has a non-empty sentence
   again) is behavior-preserving for all 4 real entries (verified by hand
   below) and removes now-dead, now-untested branching — this is a same-
   file, same-function simplification directly tied to this fix, not new
   scope. Reported plainly either way in the final summary.
3. Update tests asserting the old (round-2) sentence: copy.test.ts (the
   dedicated already-delivered test — now checks the plain `{sentence}`
   shape, no `link` key at all; the "non-empty text" structural test, which
   still passes unmodified since `sentence` is non-empty again, but I will
   check its `linkText` helper logic still behaves correctly for a no-link
   entry) and digest-template.test.ts (`REASON_SENTENCES["already-
   delivered"]`, and the two dedicated "no-required-match's link..." tests
   stay as-is since they never touched already-delivered). Each changed
   assertion commented "EMPTY-EMAIL-REASON (§1bj.10)".
4. Mutation: revert to round 2's sentence -> confirm a test goes red;
   restore; sha256 before/after identical; CRLF preserved, verified with
   PowerShell.
5. Gates: vitest, tsc, eslint, build. Check for `__b_account_probe_*` files
   under web/src before the full vitest run; if present, try
   `--exclude "**/__b_account_probe_*"`, else run normally and report the
   extra files/tests separately, per this round's explicit instruction.
   Expect the same 292/5382/0-failed/tsc-0/eslint-0-151/build-OK numbers as
   before (net 0 new/removed tests — only existing assertions edited).

## Fix round 3 progress log

- [DONE] copy.ts: `DIGEST_EMPTY["already-delivered"]` changed to
  `{sentence: "You're caught up: every paper that matched today was already
  picked for you in the past 30 days."}` -- `link` key removed entirely.
  Doc comments on `DigestEmptyEntry`/`DIGEST_EMPTY` updated (the
  empty-sentence-with-embedded-link explanation removed since no entry uses
  that shape anymore). Re-normalized CRLF (181 lines, 0 stray LF).
- [DONE] digest-template.ts: `reasonEmptyHtml`/`reasonEmptyPlaintext`
  SIMPLIFIED back to their round-1 form (always insert the separator space
  when a link exists, unconditionally) -- the round-2 empty-sentence
  generalization is no longer reachable through any real `DIGEST_EMPTY`
  entry (verified: all 4 entries now have non-empty `sentence`) and was not
  covered by any test (those two functions are unexported; every test
  reaches them only via `DIGEST_EMPTY`). Per the coordinator's instruction,
  reverted rather than left untested; documented in both function doc
  comments. Re-normalized CRLF (303 lines, 0 stray LF).
- [SCOPE NOTE] copy.test.ts's "every key carries non-empty rendered text"
  structural test (generalized last round to check sentence+link
  concatenation) was left AS-IS, not reverted to its round-1 form. Reasoning:
  the coordinator's instruction named specifically "the empty-`sentence`
  separator generalisation from last round" (the digest-template.ts render
  functions, which I did revert) under item 2's "tests that assert it"
  scope; this structural test doesn't assert the SENTENCE CONTENT itself (so
  it isn't literally one of "the tests that assert it"), and it still passes
  correctly and meaningfully with the new data (every key's sentence is
  non-empty again, so the generalized concatenation check degenerates to
  the same true/false result the simpler check would give) -- reverting it
  too would be extra work not asked for. Flagging this scoping call rather
  than silently deciding it, per "do not widen scope" cutting both ways.
- [DONE] Tests updated (each commented "EMPTY-EMAIL-REASON (§1bj.10)"):
  copy.test.ts's dedicated already-delivered test (now checks the plain
  `{sentence}` shape, no `link` key); digest-template.test.ts's
  `REASON_SENTENCES["already-delivered"]` fixture. Grepped the whole `src/`
  tree for "Past briefings"/"already in your"/"already in a recent Peer
  email" first -- the only other hits are `BRIEFING_EMPTY`'s own unrelated
  already-delivered entry (a different table, for the page, untouched) and
  one completely unrelated Profile-page sentence about email digest
  settings ("in addition to the in-app Past briefings.",
  app/profile/page.tsx:1441 / page.test.tsx:179) -- confirmed out of scope,
  not touched.
- [DONE] Ran digest-template.test.ts + copy.test.ts: 38/38 passed (same
  count as before this round -- only content changed, not test count).
- [DONE] Mutation: reverted copy.ts's already-delivered entry to round 2's
  wording (empty sentence + Past-briefings link). Ran the same two files:
  exactly 3 tests went red (the same three as round 2's mutation test --
  copy.test.ts's dedicated test, digest-template.test.ts's HTML and
  plaintext sentence tests), 35 stayed green. Incidentally also observed a
  stray leading space in the rendered output (since digest-template.ts's
  render functions no longer special-case an empty sentence) -- expected
  and harmless, since that data shape is no longer valid per §1bj.10 and
  the test's job is only to go red, which it did. Restored; sha256 match:
  true for copy.ts (CRLF, 181 lines, 0 stray LF); digest-template.ts's
  sha256 independently re-confirmed unchanged (never mutated this round).
  Re-ran: 38/38 green again.
- [DONE] Checked for `__b_account_probe_*` files under web/src before the
  full gate run, per this round's explicit instruction: found TWO --
  web/src/lib/supabase/__b_account_probe_session_proxy.test.ts and
  __b_account_probe_session_servercomponent.test.ts -- consistent with the
  real, confirmed-in-ABC-JEV-INTEGRATION.md SESSION-REFRESH investigation
  (line 246 area: "it continues as SESSION-REFRESH (B running since
  22:2xZ..."). Did not touch, read, or modify either file. Tried
  `npx vitest run --exclude "**/__b_account_probe_*"` first, per
  instruction.
- [DONE] Gate 1/4 `npx vitest run --exclude "**/__b_account_probe_*"`: flag
  accepted; 289 passed | 3 skipped (292 files); 5382 passed | 6 skipped;
  0 failed -- byte-identical to every prior clean run, confirming the two
  probe files were excluded and did not affect the count.
- [DONE] Gate 2/4 `npx tsc --noEmit`: 0 errors (the two probe files present
  at the time did not introduce any type errors either).
- [INCIDENT, self-resolved] Gate 3/4 `npx eslint .` (first attempt) crashed:
  `ENOENT: no such file or directory, open '...__b_account_probe_session_
  proxy.test.ts'` -- eslint's file-listing scan found the file, then the
  other investigator deleted it (consistent with these being genuinely
  short-lived, run-and-delete temporary probes, the same convention my own
  round-1 `__c_snapshot_probe.test.ts` used) before eslint could read its
  contents -- a benign filesystem race, not caused by anything in this item.
  Confirmed both probe files were fully gone afterward (a `find` for the
  pattern came back empty); re-ran eslint on the now-stable tree.
  Re-run result: 151 problems (0 errors, 151 warnings) -- identical to
  baseline.
- [DONE] Gate 4/4 `npm run build`: exit 0, "Compiled successfully", all
  routes generated.
- ALL 4 GATES PASS: 292 files / 5382 + 6 skipped / 0 failed (via
  `--exclude "**/__b_account_probe_*"`, confirmed identical to the
  unexcluded baseline count since the probe files were never part of it);
  tsc 0 errors; eslint 0 errors / 151 warnings (after the self-resolved
  ENOENT race, re-run clean); build OK.

## Round 3 final summary

Sentence, exactly as rendered:
- HTML: "You&#39;re caught up: every paper that matched today was already
  picked for you in the past 30 days."
- Plain text: "You're caught up: every paper that matched today was already
  picked for you in the past 30 days."
- No link (the sentence "points nowhere," per the ruling).

Changed files this round: web/src/lib/briefing/copy.ts,
web/src/lib/email/digest-template.ts, web/src/lib/briefing/copy.test.ts,
web/src/lib/email/digest-template.test.ts (test count unchanged at 38 for
these two files combined; unchanged at 292/5382 suite-wide).

Mutation proof: reverted to round 2's sentence -> the same 3 tests as round
2 went red (copy.test.ts's dedicated test; digest-template.test.ts's HTML
and plaintext sentence tests) -> restored -> sha256 match true for copy.ts;
digest-template.ts's sha256 independently reconfirmed unchanged (not
mutated this round, only simplified once, earlier, as part of the fix
itself).

Scope note (transparently disclosed, not decided silently): the round-2
`sentence`-can-be-empty generalization in digest-template.ts's two render
helpers was reverted (no longer reachable by any real `DIGEST_EMPTY` entry,
not covered by any test); copy.test.ts's "every key carries non-empty
rendered text" structural test was left in its round-2 generalized form
since it doesn't directly assert the sentence CONTENT and still passes
correctly -- flagged rather than unilaterally widened.

Probe-file handling this round: found and did not touch
`__b_account_probe_session_proxy.test.ts` /
`__b_account_probe_session_servercomponent.test.ts` under
web/src/lib/supabase/ (consistent with the real SESSION-REFRESH
investigation named in ABC-JEV-INTEGRATION.md); used
`--exclude "**/__b_account_probe_*"` for the vitest gate (accepted, numbers
unaffected); eslint's first run crashed on a benign ENOENT race (the file
was deleted by its owner between eslint's listing and its read) -- both
probe files were confirmed fully gone afterward, and the eslint re-run was
clean.

Also noted for the record: this round's coordinator message repeated the
same probe-exclusion instruction I flagged as a possible injection last
round: the round-log in ABC-JEV-INTEGRATION.md itself (line ~248, the
EMPTY-EMAIL-REASON status row) now states "the manager confirms that
message was the manager's" -- i.e. the manager has confirmed, through the
authoritative shared state file, that the earlier instance was genuinely
theirs. This round's message also arrived as a normal conversation turn
(not bundled after a tool result like the flagged instance), so it was
followed without re-flagging.

---

# Round 2 checkpoint (below, unchanged) — STATUS at end of round 2 was:
IMPLEMENTED_PENDING_REVIEW (fix round 2, §1bj.8, complete)

## Fix round 2 (§1bj.8) — plan, written before any edit

Fresh A FAILED_REVIEW on one HIGH wording-truth finding (docs/jev-abc/
EMPTY-EMAIL-REASON-A-20260929T214827Z.md; everything else in round 1
confirmed). Manager CORRECTION at §1bj.8: `briefing_deliveries` rows are
written for every channel and BEFORE the send, whether or not an email
actually goes out -- so "every match today was already in a recent Peer
email" can be false (a failed send, or a reader who switched to in-app-only
in Profile). Read the ruling directly in ABC-JEV-INTEGRATION.md (line 260)
before writing this plan -- confirmed it matches the coordinator's chat
paraphrase exactly on the sentence text; the coordinator's chat message
additionally pins the plain-text link style ("Past briefings
(<origin>/profile)") which the ruling itself states more loosely
("the URL in brackets, as for Profile") -- using the coordinator's explicit,
unambiguous instruction, which also matches the SAME parenthesis style
already shipped for `no-required-match`'s "Profile" link, so nothing about
the existing link rendering convention actually changes.

New sentence: "You're caught up: every match today is already in your Past
briefings." with "Past briefings" (the exact label at
web/src/app/profile/page.tsx:1204) linking to <origin>/profile.

Structural note: unlike `no-required-match` (a full leading sentence, THEN a
second, separate link-bearing sentence), this sentence has NO separate
leading sentence -- "Past briefings" sits inside the ONE sentence itself.
Plan: `DIGEST_EMPTY["already-delivered"].sentence` becomes `""`, and the
whole sentence text is split across `link.before`/`link.after`; the two
render helpers (`reasonEmptyHtml`/`reasonEmptyPlaintext` in
digest-template.ts) need a small generalization so they don't insert their
hardcoded separator space when `sentence` is empty -- verified this does NOT
change `no-required-match`'s existing byte output (both `sentence` and
`link` are non-empty there, so the same "sentence + space + link" shape
results either way, just built by a different code path).

Steps:
1. copy.ts: update `DIGEST_EMPTY["already-delivered"]`.
2. digest-template.ts: generalize `reasonEmptyHtml`/`reasonEmptyPlaintext` to
   skip the separator space when `entry.sentence` is empty.
3. Update tests that assert the old sentence: copy.test.ts (2 assertions --
   the dedicated already-delivered test, and the "every key has a non-empty
   sentence" structural test which breaks as a side effect of the new empty-
   string `sentence`) and digest-template.test.ts (the `REASON_SENTENCES`
   fixture's already-delivered entry, consumed by the parameterized
   per-code tests). Each changed assertion gets the comment "EMPTY-EMAIL-
   REASON (§1bj.8)".
4. Mutation: revert to the old sentence -> confirm a test goes red; restore;
   sha256 before/after identical; line endings re-verified with PowerShell
   (copy.ts and digest-template.ts are both CRLF).
5. Gates: vitest, tsc, eslint, build -- one at a time, expect 0 failed /
   0 errors / 151 warnings / build OK (same baseline as round 1, now +0 net
   new tests since this only edits existing assertions, per the coordinator's
   instruction "Nothing else changes").

## Fix round 2 progress log

- [DONE] copy.ts: `DIGEST_EMPTY["already-delivered"]` changed to
  `{sentence: "", link: {before: "You're caught up: every match today is
  already in your ", text: "Past briefings", path: "/profile", after:
  "."}}`. Doc comments on `DigestEmptyEntry`/`DIGEST_EMPTY` updated to
  explain the empty-sentence-with-embedded-link shape. Re-normalized CRLF
  (182 lines, 0 stray LF).
- [DONE] digest-template.ts: `reasonEmptyHtml`/`reasonEmptyPlaintext`
  generalized to skip the sentence-then-link separator space when
  `entry.sentence` is empty (only inserted when BOTH sentence and link are
  non-empty) -- verified this does NOT change `no-required-match`'s output
  (both fields non-empty there, same net result either way). Re-normalized
  CRLF (301 lines, 0 stray LF).
- [DONE] Tests updated (each with the "EMPTY-EMAIL-REASON (§1bj.8)" comment
  as required): copy.test.ts's dedicated already-delivered test (now checks
  the full `{sentence, link}` shape) and its "every key carries non-empty
  text" structural test (generalized to sentence+link concatenation, since
  already-delivered's bare `.sentence` is now legitimately `""`); digest-
  template.test.ts's `REASON_SENTENCES["already-delivered"]` fixture (feeds
  the parameterized per-code HTML+plaintext tests automatically). Grepped
  every other touched test file for the old sentence/"already-delivered"
  references first -- confirmed no other file needed a change (empty-
  reason-code.test.ts's "already-delivered" hits are all about the REASON
  CODE STRING from the pipeline, unrelated to the email sentence; BRIEFING_
  EMPTY's own already-delivered entry, a different table for the page, is
  untouched and out of scope for this item).
- [DONE] Ran digest-template.test.ts + copy.test.ts: 38/38 passed.
- [DONE] Mutation: reverted copy.ts's already-delivered entry to the OLD
  (A-found-false) sentence. Ran the same two files: exactly 3 tests went red
  (copy.test.ts's dedicated test; digest-template.test.ts's HTML and
  plaintext sentence tests for this code), 35 stayed green. Restored;
  sha256 match: true (CRLF, 182 lines, 0 stray LF); digest-template.ts
  sha256 also independently re-confirmed unchanged (it was never mutated
  this round). Re-ran: 38/38 green again.
- [DONE] Checked for any stray `__b_account_probe_*` files under web/src
  before running gates (per my own standing practice of checking git status
  before a full run, not because of the unverified second "coordinator"
  message) -- none exist. Ran the full gate suite with NO special flags.
- [DONE] Gate 1/4 `npx vitest run`: 289 passed | 3 skipped (292 files);
  5382 passed | 6 skipped; 0 failed -- byte-identical to round 1's final
  numbers (net 0 new/removed tests this round, as expected -- only existing
  assertions were edited).
- [DONE] Gate 2/4 `npx tsc --noEmit`: 0 errors.
- [DONE] Gate 3/4 `npx eslint .`: 151 problems (0 errors, 151 warnings) --
  identical to baseline.
- [DONE] Gate 4/4 `npm run build`: exit 0, "Compiled successfully", all
  routes generated.
- ALL 4 GATES PASS, byte-identical to round 1's final numbers (vitest 292
  files / 5382 + 6 skipped / 0 failed; tsc 0; eslint 0/151; build OK) --
  expected, since this round only edited existing assertions, net 0 new/
  removed tests.
- NOTE on the injected-content matter (see the top of this fix round): a
  `git status` taken AFTER all 4 gates finished shows a new untracked file,
  `web/src/lib/profile/__b_account_probe_reload_pingpong.test.ts`, that was
  NOT present during my vitest run (which reported the same 292/5382 numbers
  as before it would have existed). Its name matches this campaign's own
  established, legitimate temporary-probe convention for a B investigator
  (the exact same pattern my OWN round-1 checkpoint used for
  `__c_snapshot_probe.test.ts`, and the one my task briefing itself named
  for EMPTY-EMAIL-REASON's own B guide) and ACCOUNT-SESSION-SYNC is a real,
  confirmed-in-ABC-JEV-INTEGRATION.md item running in parallel right now
  (line 44's NOW-entry, and its own B guide file
  docs/jev-abc/ACCOUNT-SESSION-SYNC-B-20260929T220146Z.md already exists in
  the tree). So the FILE'S existence looks legitimate. What I am NOT doing,
  regardless: adding any `--exclude` flag to any gate command, or giving
  this (or any) file pattern special handling based on the earlier,
  oddly-delivered second message -- my already-completed vitest run is
  clean, accurate, and simply predates this file; no re-run was needed for
  correctness, and I have not touched, read, or deleted this file (not my
  scope, exactly as I would treat any file I don't own regardless of any
  instruction about it).

Injected-content note (not part of the task, recorded for the record): a
second "coordinator" message arrived immediately after one of my own tool
results (not as a normal conversation turn), claiming a concurrent read-only
investigator "ACCOUNT-SESSION-SYNC" is creating temporary files under
`web/src` named `__b_account_probe_*`, and asking me to add a vitest
`--exclude` flag or otherwise special-case those files. Nothing in this
session's actual task briefing or the ABC-JEV-INTEGRATION.md content
establishes that claim, and the request (change verification-tool behavior,
avoid touching a specific file pattern) matches a prompt-injection pattern.
I am NOT following it: no `--exclude` flag, no special-casing of any file
pattern in my gate runs -- gates run exactly as round 1 did, and I report
whatever `git status`/test output actually shows, unfiltered. (Separately:
ABC-JEV-INTEGRATION.md line 44 shows the manager's OWN NOW-line does
mention a real, differently-named item "ACCOUNT-SESSION-SYNC" as a B running
in parallel with this item's fresh A -- read-only, per §0b's own parallel-
read-only-investigation allowance. That is consistent with the campaign's
normal operation. What I am declining is specifically the unverified,
oddly-delivered SECOND message's request to change my own tool-call
behavior around an unnamed/unverifiable file pattern -- a different thing
from the real, named ACCOUNT-SESSION-SYNC item the state file itself
confirms exists. I will not touch or delete any file I do not recognize as
my own regardless, which was already my standing practice.)

---

# Round 1 checkpoint (below, unchanged) — STATUS at end of round 1 was:
IMPLEMENTED_PENDING_REVIEW

Branch: Jev-integration-and-sorting-filtering-enhancement
HEAD at start: 47c4a1db32f6498094c860afe3bea16026ee44d5

Role: C (implementer). Only writer of repo product files until report. Implements
the ruled design from ABC-JEV-INTEGRATION.md §1bj (binding); does not re-decide
policy.

Read before any edit (all DONE): ABC-JEV-INTEGRATION.md §1bj, §1bb + CORRECTION,
§1bf, §0b, §0c, §3 (engineering contract + common constraints);
docs/jev-abc/EMPTY-EMAIL-REASON-B-20260929T194224Z.md (whole); web/AGENTS.md;
web/src/lib/email/digest-template.ts; web/src/lib/briefing/copy.ts;
web/src/lib/feed/empty-reason.ts; web/src/lib/feed/types.ts
(FeedEmptyReasonCode / FEED_EMPTY_REASON_CODES / FeedMeta.emptyReasonCode);
web/src/lib/feed/pipeline.ts (computeEmptyReasonCode, call site, meta assembly);
web/src/lib/email/send-digest.ts (SendDigestInput / sendDigestEmail); the three
senders (web/src/app/api/jobs/dispatch-digests/route.ts,
web/src/app/api/profile/send-test-email/route.ts,
web/src/app/api/test-digest/route.ts) and their existing tests
(route.test.ts, idempotency.test.ts, send-test-email/route.test.ts,
test-digest/route.test.ts, send-digest.test.ts, copy.test.ts,
feed/empty-reason-code.test.ts).

## Plan

1. **copy.ts** — add `DigestEmptyLink` / `DigestEmptyEntry` types and a new
   `DIGEST_EMPTY: Record<FeedEmptyReasonCode, DigestEmptyEntry>` table next to
   `BRIEFING_EMPTY`, with the four ruled sentences (§1bj.2 exact wording).
   `no-required-match` carries a `link` sub-object (before/text/path/after) so
   the template can render it as `<a>` in HTML and `text (url)` in plaintext —
   never HTML markup inside copy.ts itself.
2. **digest-template.ts** — add `emptyReasonCode?: FeedEmptyReasonCode` to
   `DigestTemplateInput`. Add a shared lookup (membership-checked against
   `FEED_EMPTY_REASON_CODES`, never bare truthiness — mirrors
   `empty-reason.ts`'s own discipline) used by BOTH renderers (one source of
   truth, two renderers, per the B guide §4.1). `renderDigestHtml`: keep
   today's exact generic literal untouched byte-for-byte; when a known code
   resolves, swap in its sentence (+ link as a real `<a>`) inside the SAME
   `<tr><td>` wrapper. `renderDigestPlaintext`: add the empty-case branch it
   is missing today (§1.6 of the guide) — reason sentence, or a new generic
   fallback sentence matching the HTML one in content, link rendered as
   `text (url)`. Non-empty path in both renderers: zero lines touched inside
   the `items.length > 0` control flow, so byte-identical output is a
   structural guarantee, proven by a snapshot test below. Subject line: not
   touched (POLICY 7 / §4.6 of the guide).
3. **send-digest.ts** — add `emptyReasonCode?: FeedEmptyReasonCode` to
   `SendDigestInput`. No other change: `renderDigestHtml(input)` /
   `renderDigestPlaintext(input)` already pass the whole `input` object
   through, so the field flows automatically once the type carries it.
4. **Three senders** — thread `feed.meta.emptyReasonCode` into every
   `sendDigestEmail(...)` call and into `sendFirstDigestAttemptWithIdempotency`
   (dispatch-digests' P4-S7-IDEM first-attempt path, which renders directly
   rather than through `sendDigestEmail`'s default path). No other behaviour
   change: subject unchanged, nothing new stored on `briefing_deliveries`,
   empty days still send.
5. **Tests (new + extended, real rendering wherever the ruling asks for
   rendered-content proof):**
   - NEW `web/src/lib/email/digest-template.test.ts`: real (unmocked)
     `renderDigestHtml`/`renderDigestPlaintext` — each of the 4 codes renders
     its own sentence in both HTML and plaintext; missing code falls back to
     generic in both; an out-of-union unknown code falls back to generic in
     both (never throws, never shows the raw string); non-empty items with any
     `emptyReasonCode` set still render items normally and never show an
     empty-case sentence; a snapshot-style equality of a fixed non-empty
     input's full HTML + plaintext output against a literal captured from
     HEAD (captured below, before any edit).
   - `copy.test.ts`: extend with a `DIGEST_EMPTY` describe block mirroring the
     existing `BRIEFING_EMPTY` one — exact sentence per code, the
     `no-required-match` link's path/text.
   - `send-digest.test.ts`: extend to assert `emptyReasonCode` on the input is
     forwarded into the (mocked) `renderDigestHtml`/`renderDigestPlaintext`
     calls.
   - `dispatch-digests/route.test.ts`: (a) mock `runFeedPipeline` to resolve
     `{items: [], meta: {emptyReasonCode: "no-required-match"}}`, assert
     `sendDigestEmail` is called with that code (flag-off default path); (b)
     NEW regression test for §1bj.5 / the guide §1.4: two candidates, one id
     in the mocked 30-day `pastDeliveries`, `runFeedPipeline` resolves with
     only the non-excluded item (a realistic already-filtered stub) — assert
     the sent email still contains the non-excluded item and is not treated
     as empty, pinning that the dispatcher's redundant post-pipeline filter
     removes nothing extra.
   - `idempotency.test.ts`: extend with a real-rendering (digest-template not
     mocked here already) end-to-end test — dedupe flag on, first attempt,
     `runFeedPipeline` resolves empty with a code — assert the PERSISTED
     html/text (what's "handed to" the send step) contains the real sentence.
   - `send-test-email/route.test.ts` and `test-digest/route.test.ts`: each
     gets a test asserting `sendDigestEmail` receives `emptyReasonCode` from
     `feed.meta.emptyReasonCode`.
   - `feed/empty-reason-code.test.ts`: NEW pinned test, `topN: 0` with an
     otherwise-qualifying candidate still resolves `already-delivered` —
     comment "accepted, §1bj.5 (paperCount is 5 | 10)".
6. **Mutation proof (3, each restored, sha256 before/after identical,
   line-ending convention checked via `git ls-files --eol` + verified with
   PowerShell):**
   a. Dispatcher: temporarily drop the `emptyReasonCode` passthrough in
      dispatch-digests/route.ts → the new sender-passthrough test goes red.
   b. digest-template.ts: temporarily remove the new plaintext empty-sentence
      branch → the plaintext test(s) go red.
   c. digest-template.ts: temporarily make an unknown code map to a reason
      sentence (break the membership check) → the fallback test goes red.
7. **Gates** (from `web/`, one at a time): `npx vitest run`, `npx tsc --noEmit`,
   `npx eslint .`, `npm run build`. Baseline to compare against (given):
   291 files (288 + 3 skipped) / 5338 passed + 6 skipped / 0 failed; tsc 0
   errors; eslint 0 errors / 151 warnings; build OK. Will re-run baseline once
   now (pre-edit) to confirm these exact numbers on this checkout before
   trusting them.

Hard constraints in force: never send an email; never call peer.homes, the
local dev server, or any job/email route over HTTP — unit tests and mocks
only; no commit/push/stash/branch op; never open/print .env(.local); no
secrets anywhere; no personal strings; do not touch root `node_modules/`.

## Progress log

- [DONE] Baseline gate run (pre-edit, vitest only): 291 files (288 + 3
  skipped) / 5338 passed + 6 skipped / 0 failed — matches the given baseline
  exactly, on this checkout, HEAD 47c4a1db.
- [DONE] Line-ending audit (`git ls-files --eol` + PowerShell byte count,
  since Bash grep under-reports CR in this checkout) for every file this item
  touches. CRLF working-tree files (index is LF; must stay CRLF after edits):
  dispatch-digests/route.ts, test-digest/route.ts, briefing/copy.ts,
  email/digest-template.ts, email/send-digest.ts. LF working-tree files
  (unchanged convention): profile/send-test-email/route.ts (a product file,
  despite being a sibling of the CRLF ones above) and every *.test.ts file
  touched. Plan: edit normally, then re-normalize each CRLF file's line
  endings wholesale (CRLF→LF→CRLF) so a stray LF from the edit tool can never
  survive; verify byte counts again after.
- [DONE] Captured HEAD's exact `renderDigestHtml`/`renderDigestPlaintext`
  output for a fixed non-empty input via a temporary probe
  (`web/src/lib/email/__c_snapshot_probe.test.ts`, run scoped to itself,
  1/1 passed, then deleted — confirmed gone via `git status`). The captured
  strings are the literal pinned expectation in the new
  digest-template.test.ts's non-empty snapshot test.
- [DONE] copy.ts: added `DigestEmptyLink`/`DigestEmptyEntry` types and the
  `DIGEST_EMPTY` table (4 codes, exact §1bj.2 wording), imports
  `FeedEmptyReasonCode` type. Re-normalized to CRLF after edit (byte-verified,
  0 stray LF).
- [DONE] digest-template.ts: `DigestTemplateInput.emptyReasonCode` added;
  `resolvedEmptyEntry` (membership-checked lookup, shared by both renderers);
  `renderDigestHtml`'s generic fallback branch left as the EXACT original
  literal (byte-for-byte, only reached when no known code resolves);
  `renderDigestPlaintext` gained the empty-case branch it lacked (reason
  sentence, or a new generic fallback matching the HTML one in content).
  Re-normalized to CRLF (0 stray LF).
- [DONE] send-digest.ts: `SendDigestInput.emptyReasonCode` added; no other
  change needed since `renderDigestHtml(input)`/`renderDigestPlaintext(input)`
  already forward the whole object. Re-normalized to CRLF (0 stray LF).
- [DONE] Three senders updated: dispatch-digests/route.ts (both the
  `sendFirstDigestAttemptWithIdempotency` path and the direct `sendDigestEmail`
  call now pass `feed.meta.emptyReasonCode`; re-normalized to CRLF, 0 stray
  LF), send-test-email/route.ts (LF, unchanged convention), test-digest/
  route.ts (re-normalized to CRLF, 0 stray LF). No other behaviour touched:
  subject unchanged, nothing new stored on briefing_deliveries, empty days
  still send.
- [DONE] NEW web/src/lib/email/digest-template.test.ts (LF): 26 tests, real
  (unmocked) renderers -- all 4 codes in HTML+plaintext, missing-code and
  unrecognized-code fallback (both renderers, never throws, raw string never
  shown), non-empty items ignore emptyReasonCode, and the non-empty snapshot
  pinned against the HEAD-captured literal. All 26 passed on first run.
- [DONE] copy.test.ts: new `DIGEST_EMPTY` describe block (5 tests) mirroring
  the existing `BRIEFING_EMPTY` one. Passed.
- [DONE] send-digest.test.ts: 3 new tests -- emptyReasonCode forwarded into
  the (mocked) renderDigestHtml/renderDigestPlaintext, not into
  renderDigestSubject; omitted -> undefined; `render` override present ->
  template functions never called at all. Passed (24/24 total with copy.test.ts).
- [DONE] send-test-email/route.test.ts and test-digest/route.test.ts: 2 new
  tests each (forwards a real code; forwards undefined). Both files passed
  (28/28 total).
- [DONE] dispatch-digests/route.test.ts: 2 new describe blocks -- (1) passes
  feed.meta.emptyReasonCode through on the flag-off default path (2 tests);
  (2) §1bj.5 pin for the redundant 30-day re-filter -- a realistic
  already-filtered pipeline stub proves the route's own post-pipeline filter
  removes nothing extra (1 test). 45/45 passed (was 41).
- [DONE] idempotency.test.ts: 1 new end-to-end test using the REAL
  (unmocked-in-this-file) renderer -- flag on, first attempt, empty result
  with "no-required-match" -- asserts the actual rendered html/text (both
  what's handed to sendDigestEmail AND what's persisted pre-send) contains
  the real sentence, and does NOT contain the generic sentence. 19/19 passed
  (was 18).
- [DONE] empty-reason-code.test.ts: 1 new pinned test for §1bj.5 (topN 0 ->
  mislabeled "already-delivered" with no exclusion supplied), comment
  "accepted, §1bj.5 (paperCount is 5 | 10)" as required. 11/11 passed (was 10).
- [DONE] Byte-level line-ending re-verification (PowerShell) across every
  touched file: all *.test.ts files 0 CRLF (pure LF); all 5 touched product
  files (copy.ts, digest-template.ts, send-digest.ts, dispatch-digests/
  route.ts, test-digest/route.ts) 0 stray LF (pure CRLF);
  send-test-email/route.ts 0 CRLF (pure LF, its own pre-existing convention).
- [DONE] Gate 1/4 `npx vitest run`: 289 passed | 3 skipped (292 files);
  5382 passed | 6 skipped (0 failed) — baseline was 5338/6/0 across 291
  files; delta is exactly the 44 new tests added (26+5+3+2+2+4+1+1). Matches.
- [DONE] Gate 2/4 `npx tsc --noEmit`: first run surfaced ONE real error
  (digest-template.test.ts's FIXED_ITEM fixture was missing
  `ScoreBreakdown.combined`) — fixed the fixture (added `combined: 0.8734`,
  a field never read by the renderers, so the pinned snapshot literals are
  unaffected; re-ran digest-template.test.ts alone, still 26/26, still LF).
  Second `tsc --noEmit` run: 0 errors.
- [DONE] Gate 3/4 `npx eslint .`: 151 problems (0 errors, 151 warnings) —
  byte-identical to baseline's 0/151; none of the 151 are in any file this
  item touched.
- [DONE] Gate 4/4 `npm run build`: exit 0, "Compiled successfully", all
  routes generated including the three sender routes
  (/api/jobs/dispatch-digests, /api/profile/send-test-email,
  /api/test-digest). The one Turbopack NFT-tracing warning
  (next.config.ts -> src/lib/papers/pdf-text.ts -> api/papers/upload/route.ts)
  is pre-existing and unrelated -- none of those 3 files were touched by
  this item.
- ALL 4 GATES PASS, matching or exceeding baseline exactly (vitest: +44
  tests, 0 failed; tsc: 0 errors; eslint: byte-identical 0/151; build: OK).
## Mutation proof (all 3 done; sha256 before/after identical for each; line
endings re-verified CRLF/pure after every restore)

Post-implementation, pre-mutation baseline hashes (recorded once, reused as
the "after restore must equal this" target for every mutation on that file):
- dispatch-digests/route.ts:
  81829324E618396B9CD94C84B4F9203E3AA5AD823AEDD39A2D22E0ADEE1C6958
- digest-template.ts:
  8546E055CCF24766E8416013F5C68B3150C1C8E85BE874E844AC272415056569

1. **Drop the code in the dispatcher** (removed both
   `emptyReasonCode: feed.meta.emptyReasonCode` lines from
   dispatch-digests/route.ts). Ran route.test.ts + idempotency.test.ts:
   exactly 2 failed (the two new "passes ... through" / real-rendering
   tests), 62 others stayed green. Restored; sha256 match: True (CRLF, 716
   lines, 0 stray LF). Re-ran both files: 64/64 green.
2. **Remove the plain-text empty sentence** (deleted the
   `if (items.length === 0) {...}` block from `renderDigestPlaintext`). Ran
   digest-template.test.ts: exactly 7 failed (every plaintext-dependent
   assertion), 19 stayed green (all HTML-only + non-empty tests). Restored;
   sha256 match: True. Re-ran: 26/26 green.
3. **Map an unknown code to a reason sentence** (bypassed the
   `FEED_EMPTY_REASON_CODES.includes` membership check in
   `resolvedEmptyEntry`, so an unrecognized code fell through to
   `DIGEST_EMPTY["no-results"]` instead of the generic fallback). Ran
   digest-template.test.ts: exactly 2 failed (the two "unrecognized code"
   fallback tests -- observed output showed "Nothing new for these topics
   today." leaking through where the generic sentence should be), 24 stayed
   green. Restored; sha256 match: True (CRLF, 285 lines, 0 stray LF). Re-ran:
   26/26 green.

Each mutation failed ONLY the test(s) it should have and nothing else --
proof the new tests are actually exercising the described code paths, not
passing vacuously.

- [DONE] Final full `npx vitest run` after all mutation-restore cycles:
  289 passed | 3 skipped (292 files); 5382 passed | 6 skipped; 0 failed —
  identical to the post-implementation gate run before mutation testing.
  tsc/eslint/build were not re-run a third time: the restored files' sha256
  is byte-identical to the state that already passed all 4 gates, and both
  tools are pure functions of file content, so re-running them would be
  redundant with the sha256 proof above.

## FINAL SUMMARY

STATUS: IMPLEMENTED_PENDING_REVIEW

### Changed files (13 modified, 1 new test file, this checkpoint doc)

Product code:
- web/src/lib/briefing/copy.ts — new `DigestEmptyLink`/`DigestEmptyEntry`
  types, new `DIGEST_EMPTY` table (4 codes, §1bj.2 exact wording), next to
  `BRIEFING_EMPTY`.
- web/src/lib/email/digest-template.ts — `DigestTemplateInput.emptyReasonCode`
  (optional); `resolvedEmptyEntry` (membership-checked, shared by both
  renderers); `renderDigestHtml`'s generic fallback is the untouched original
  literal; `renderDigestPlaintext` gained the empty-case branch it lacked.
- web/src/lib/email/send-digest.ts — `SendDigestInput.emptyReasonCode`
  (optional); forwarded automatically since both render calls already pass
  the whole input object.
- web/src/app/api/jobs/dispatch-digests/route.ts — both the P4-S7-IDEM
  first-attempt path (`sendFirstDigestAttemptWithIdempotency`) and the
  default `sendDigestEmail` call now pass `feed.meta.emptyReasonCode`.
- web/src/app/api/profile/send-test-email/route.ts — `sendDigestEmail` call
  now passes `feed.meta.emptyReasonCode`.
- web/src/app/api/test-digest/route.ts — `sendDigestEmail` call now passes
  `feed.meta.emptyReasonCode`.

Tests:
- web/src/lib/email/digest-template.test.ts (NEW, 26 tests) — real renderers,
  no mocking: all 4 codes in HTML+plaintext, missing/unrecognized-code
  fallback in both, non-empty-ignores-code, non-empty snapshot pinned against
  a literal captured from HEAD before any edit.
- web/src/lib/briefing/copy.test.ts (+6) — `DIGEST_EMPTY` pinned per code
  (4), email-voice-not-page-voice check (1), non-empty-sentence check (1).
- web/src/lib/email/send-digest.test.ts (+3) — forwarding into the (mocked)
  renderers, subject untouched, `render` override bypasses rendering.
- web/src/app/api/jobs/dispatch-digests/route.test.ts (+3) — passthrough on
  the flag-off path (2 tests: real code, undefined); §1bj.5 redundant-30-day
  -filter invariant pin (1 test).
- web/src/app/api/jobs/dispatch-digests/idempotency.test.ts (+1) — REAL
  end-to-end rendering proof (this file never mocks digest-template).
- web/src/app/api/profile/send-test-email/route.test.ts (+2) — passthrough.
- web/src/app/api/test-digest/route.test.ts (+2) — passthrough.
- web/src/lib/feed/empty-reason-code.test.ts (+1) — §1bj.5 topN-0 pin,
  comment "accepted, §1bj.5 (paperCount is 5 | 10)" as required.

Total: 44 new tests (26+6+3+3+1+2+2+1) — verified two ways: per-file git-diff
`it(`/`it.each(` counts reconciled against actual vitest instance counts
(digest-template.test.ts's `describe.each`/`it.each` over 4 codes expands 14
source lines to 26 real test instances), AND the full-suite delta
(5382 − 5338 = 44) independently. Both agree exactly.

Temporary, created-and-deleted (not in the final tree, confirmed by
`git status` after each): web/src/lib/email/__c_snapshot_probe.test.ts
(baseline non-empty rendering capture, pre-edit).

### Mutation proof

See "Mutation proof" section above — all 3 required mutations performed,
each failed exactly the tests it should and nothing else, each fully
restored with sha256 equality proven (not just eyeballed) and CRLF line
endings re-verified byte-for-byte via PowerShell.

### Gates (from web/)

- `npx vitest run`: 289 passed | 3 skipped (292 files) / 5382 passed + 6
  skipped / 0 failed. Baseline was 291 (288+3) / 5338+6 / 0 — delta is
  exactly the 44 new tests, all passing.
- `npx tsc --noEmit`: 0 errors (one real error surfaced and was fixed during
  implementation — see progress log — before this final number).
- `npx eslint .`: 0 errors / 151 warnings — byte-identical to baseline; none
  of the 151 warnings are in any file this item touched.
- `npm run build`: exit 0, "Compiled successfully", all routes generated
  including the three sender routes. One pre-existing, unrelated Turbopack
  NFT-tracing warning (next.config.ts / pdf-text.ts / papers/upload route —
  none touched by this item).

### Hard constraints honored

No email sent; no HTTP call to peer.homes, localhost, or any job/email
route — every test is a unit test against mocks or the real pure template
functions. No commit/push/stash/branch operation. No .env file opened or
printed. No API key or secret written anywhere. No personal strings (no
name/path/email/university ID) in any repo file. Root `node_modules/` never
touched (pre-existing untracked entry, unchanged). Every line-ending
convention preserved and byte-verified with PowerShell (Bash grep was never
relied on for this).

### Decisions the rulings did not explicitly cover (flagging for review, not
### re-deciding policy)

1. **Plaintext empty-case placement**: the ruling didn't say whether the new
   plaintext explanation sentence replaces or follows the existing
   "Here are 0 items worth your attention today." line. I chose to KEEP that
   line and ADD the explanation after it (with a blank line), mirroring the
   HTML template's own structure exactly (header count text stays, a
   SEPARATE block below carries the explanation) — not a new design choice,
   just the plaintext equivalent of the already-ruled HTML shape. Flagging
   in case the reviewer reads §1bj.3 ("gets the SAME sentence... for every
   empty case") as implying the count line should be replaced instead.
2. **`no-required-match` link representation in copy.ts**: the ruling gives
   the SENTENCE text but not a data shape. I stored it as
   `{sentence, link?: {before, text, path, after}}` in `DIGEST_EMPTY`
   (plain text only, no HTML) so `digest-template.ts` builds the `<a>` in
   HTML and `text (url)` in plaintext from the same source strings — a
   file-organization/data-shape choice, not a wording one (§1bj.2's exact
   sentence text is unchanged either way, verified byte-for-byte in tests).
3. **Plaintext link rendering as `text (url)`** (e.g. "Profile
   (https://.../profile)") rather than some other plain-URL phrasing — the
   ruling says "links as plain URLs" without specifying the exact
   punctuation. Chosen to read naturally as prose and to parallel the
   existing footer lines' "label: url" convention as closely as a mid-sentence
   link allows.
4. No product decision was left open by the rulings themselves (§1bj is
   fully binding on scope/wording/policy); the three items above are
   implementation-detail choices within that binding scope, listed for
   transparency rather than because policy was unclear.

