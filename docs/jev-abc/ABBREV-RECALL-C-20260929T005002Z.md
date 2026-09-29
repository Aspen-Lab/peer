STATUS: IMPLEMENTED_PENDING_REVIEW

# ABBREV-RECALL — implementation (agent C)

Implementer: agent C, ABC loop. Branch Jev-integration-and-sorting-filtering-enhancement, HEAD 026e6ae7.
Started: 2026-09-29T00:50:02Z.
Ruling: ABC-JEV-INTEGRATION.md §1av. Guide: docs/jev-abc/ABBREV-RECALL-B-20260929T004152Z.md.

## Plan (written before editing)

1. Baseline gates from web/ (vitest, tsc, eslint, build) — record numbers before any edit.
2. Capture HEAD (pre-fix) `compileSearchBrief` output for the fixtures I will pin, via a temporary
   throwaway test file inside web/src/lib/feed/ (deleted before the real edit lands — not part of
   the diff): zero-topic tight-focus lane, and tight-focus-with-topics lane. (1-tag/3-tag fixtures
   don't need HEAD capture — their post-fix property is checked directly: tag position < adapter
   cap, and "all tags before any project phrase".)
3. Edit web/src/lib/feed/profile-compiler.ts `projectQueries`'s `baseQueries`: reorder to
   `[...exactSenseQueries, ...topics, ...projectTerms, ...topic×method combos, ...topic×projectTerm combos]`.
   No other logic changes (focusQueries ternary, slice cap, exploratory extras, zero-topic tight
   lane untouched). Verify the `compileSearchBrief` learned-terms `.slice(0, 7)` still leaves
   Required tags ahead of the adapters' MAX_QUERIES cut for realistic sense-count profiles.
4. Bump PAPER_CACHE_KEY_VERSION 10 -> 11 in web/src/lib/opportunities/pool-cache.ts, add a v11
   comment paragraph in the same style as v7-v10, update pool-cache.test.ts's v10 comment mention.
5. Tests in profile-compiler.test.ts:
   - rewrite the test that asserts the OLD project-first order (ABBREV-RECALL comment).
   - add: 1-tag + project text -> tag within first 2 and first 3 generated queries.
   - add: 3-tag + project text -> all 3 tags before any project-only phrase.
   - add: zero-topic tight lane pinned to the HEAD-captured value (must be byte-identical).
   - add: tight-focus-with-topics pinned to the HEAD-captured value (must be byte-identical).
   - confirm P1 sense tests (rest of the file) still pass unmodified.
6. Mutation proof: temporarily put `...topics` back after `...projectTerms` (recreate the
   regression), run the new tests, confirm at least one goes red, record which, then restore the
   fix and prove restoration via sha256 of the file.
7. Gates again from web/ (vitest, tsc, eslint, build) — compare against baseline.
8. Finalize checkpoint STATUS, hand back report.

## Log

### Baseline gates (before any edit)

Ran vitest/eslint/build in parallel first, which raced with each other (one flaky vitest timeout
in pdf-text.test.ts, one transient tsc error reading `.next/types/validator.ts` while `next build`
was mid-write). Re-ran tsc alone (after build finished) and vitest alone (uncontended) to get a
clean read — both matched the expected baseline exactly:

- `npx vitest run`: 284 files (281 passed + 3 skipped) / 5119 tests (5113 passed + 6 skipped). MATCHES.
- `npx tsc --noEmit`: 0 errors. MATCHES.
- `npx eslint .`: 0 errors, 151 warnings. MATCHES.
- `npm run build`: compiled successfully, exit 0. MATCHES.

### HEAD (pre-fix) query captures — via temporary scratch test, deleted after use

Fixture text (BATTERY_PROJECT_TEXT, reused from sense-context.test.ts / the B guide):
"PhD research on solid-state battery materials, focused on lithium and sodium-ion cathode and
electrolyte interfaces for electric-vehicle batteries. Improving ionic conductivity and
interfacial stability between solid electrolytes and electrode materials while suppressing
dendrite growth."

- ZERO_TOPIC_TIGHT (topics: [], project: fixture, focus: tight):
  `[fulltext, "research", "solid-state", "battery", "materials", "focused"]`
- TIGHT_WITH_TOPIC (topics: ["LCO"], project: fixture, focus: tight):
  `["LCO", "LCO " + fulltext, "LCO research", "LCO solid-state"]`
- BALANCED_ONE_TAG (topics: ["LCO"], project: fixture, default focus) — matches B's guide §2 table
  exactly: `[fulltext, "research", "solid-state", "battery", "materials", "focused", "LCO",
  "LCO " + fulltext, "LCO research", "LCO solid-state"]` — tag buried at index 6 of 10.
- BALANCED_THREE_TAGS (topics: ["LCO","LFP","solid-state batteries"], project: fixture, default
  focus): `[fulltext, "research", "solid-state", "battery", "materials", "focused", "LCO", "LFP",
  "solid-state batteries", "LCO " + fulltext]` — all 3 tags buried at indices 6-8 of 10, after
  every project phrase.

These confirm B's finding by direct execution and give exact pinned values for the "unchanged
versus HEAD" tests. Scratch file deleted immediately after this capture; never part of the diff.

### Implementation

1. web/src/lib/feed/profile-compiler.ts `projectQueries`'s `baseQueries`: reordered to
   `[...exactSenseQueries, ...topics, ...projectTerms, ...topic×method combos, ...topic×projectTerm
   combos]` (was `[...projectTerms, ...exactSenseQueries, ...topics, ...combos]`). Only the
   concatenation order changed; no query's text changed, `focusQueries` ternary/slice cap/
   exploratory extras/zero-topic tight lane untouched.
   Learned-terms path check (compileSearchBrief's `.slice(0, learned.length ? 7 : 15)`): with the
   new order, exact-sense queries + topics sit at the FRONT of `projectQueries(...)`'s already-
   capped output, ahead of project phrases, same as they were ahead of the adapters' own cut. The
   sense catalog (senses.ts) has 5 entries total (deduped by senseId), so exactSenseQueries.length
   is bounded at 5; for the learned-path 7-slot cut to clip a Required tag would need
   exactSenseQueries.length + topics.length > 7 — e.g. 3+ selected senses stacked with 5+ Required
   tags on a signed-in learned-terms request. Not reachable by any existing fixture/test in the
   repo (checked: upload-concepts.test.ts's learned-path case uses 1 topic, 0 senses — tag survives
   trivially). Even where reachable, the adapters' own MAX_QUERIES (2-3) is always the tighter
   constraint in any profile with <=6-7 tags, so this slice is not the binding bottleneck ABBREV-
   RECALL is fixing. Not changed; flagged here per the ruling's explicit "check" instruction rather
   than silently assumed fine.
2. web/src/lib/opportunities/pool-cache.ts: PAPER_CACHE_KEY_VERSION 10 -> 11, new v11 comment
   paragraph in the same style as v7-v10. web/src/lib/opportunities/pool-cache.test.ts: updated the
   "papers is now v10 (...)" comment to v11/ABBREV-RECALL (kept the v5/v6/v7/v8/v9 trail). No other
   file references a hardcoded v9/v10 papers-version literal (grepped); the "old must be rejected"
   literals in paper-daily-cache.test.ts (v5) and private-paper-cache.test.ts (v5, v6) are untouched
   on purpose.
3. profile-compiler.test.ts:
   - Rewrote the test that asserted `generatedQueries[0]` was the project fulltext (the OLD,
     regressed order) — now asserts the tag leads, with an ABBREV-RECALL comment; also renamed it
     and the describe block ("project-first" -> "tag-first") since the old name stated the very
     contract this fix reverses. Project text is still asserted present (via toContain).
   - Added 4 new tests in a new "ABBREV-RECALL" describe block: 1-tag-within-cap, 3-tags-before-
     any-project-phrase, and two HEAD-pinned byte-identical guards (zero-topic tight lane,
     tight-focus-with-topic).
   - The other 6 pre-existing tests (sense-only queries, tight-focus senses+topic, zero-topic
     project/challenge in tight, topic-filtered tight) needed no change — traced by hand and
     confirmed by running the suite: none of them depend on the projectTerms/topics relative order
     (either both project fields are empty, or tight-focus's own filter+prepend logic makes the
     underlying baseQueries order irrelevant when the project text doesn't literally contain the
     topic string, which is true of every one of their fixtures).
   - `npx vitest run src/lib/feed/profile-compiler.test.ts`: 11/11 passed.
4. Ran the pool-cache-adjacent suite (pool-cache.test.ts, private-paper-cache.test.ts,
   channel-candidate-cache.test.ts, paper-daily-cache.test.ts) after the version bump: 49/49 passed.

### Mutation proof

sha256 of web/src/lib/feed/profile-compiler.ts (fixed, before mutation):
`b1f4fb0128d32acab0bb66b9aa416b793565df69ca8f26cd19d02981c5f64181`

Mutated `baseQueries` back to `[...exactSenseQueries, ...projectTerms, ...topics, ...combos]` (put
`...topics` after the project phrases again, exactly the ticket's instruction). Ran
profile-compiler.test.ts: **3 of 11 went red** — the rewritten tag-first test (`generatedQueries[0]`
was the project fulltext again, not the tag), the 1-tag-within-cap test (tag pushed to index 6, not
in slice(0,2)/slice(0,3)), and the 3-tags-before-any-project-phrase test (tag index 6 not < 0). The
2 HEAD-pinned byte-identical guards correctly stayed green (they don't exercise the topics-vs-
projectTerms interaction — topics=[] in one, and tight-focus's filter+prepend makes it order-
invariant when the project text doesn't literally contain the tag in the other) — expected, they
are mutation-orthogonal pins, not this mutation's detector. The other 6 P1 sense tests stayed green
too, for the same reason.

Reverted the mutation (back to `[...exactSenseQueries, ...topics, ...projectTerms, ...combos]`).
sha256 after revert: `b1f4fb0128d32acab0bb66b9aa416b793565df69ca8f26cd19d02981c5f64181` — **identical**
to the pre-mutation hash; restoration proven byte-for-byte. Re-ran profile-compiler.test.ts: 11/11
passed again.

### AFTER gates (full suite, post-fix)

Same contention issue as the baseline: running vitest+eslint+build together produced the same one
flaky pdf-text.test.ts 5000ms timeout (unrelated file, resource contention only). Re-ran vitest
alone and tsc alone (after build) for clean reads:

- `npx vitest run`: 284 files (281 passed + 3 skipped) / 5123 tests (5117 passed + 6 skipped).
  5117 = baseline's 5113 + the 4 new ABBREV-RECALL tests added to profile-compiler.test.ts. MATCHES
  (net of the intentional new tests).
- `npx tsc --noEmit`: 0 errors. MATCHES baseline.
- `npx eslint .`: 0 errors, 151 warnings. MATCHES baseline exactly.
- `npm run build`: compiled successfully, exit 0. MATCHES baseline.

### Diff summary

4 files changed: web/src/lib/feed/profile-compiler.ts (+10/-2, the reorder + comment),
web/src/lib/feed/profile-compiler.test.ts (+90/-4, rewritten test + 4 new tests),
web/src/lib/opportunities/pool-cache.ts (+13/-4, version bump + comment),
web/src/lib/opportunities/pool-cache.test.ts (+5/-5, comment update only). `git status` shows
nothing else touched (ABC-JEV-INTEGRATION.md's pre-existing modification and the two untracked B
guides are not mine).

STATUS: IMPLEMENTED_PENDING_REVIEW



