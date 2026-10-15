# BACKLOG-05 — the paper fixtures carry ids, pages and paragraph breaks

Role: C. Ruling: the §5 BACKLOG-05 row (manager finding in the P1-01 probe). Acceptance: none directly; it strengthens §3d 5 and the P3 gist tests. Fixtures and tests only, plus one script.

Why: the three committed `web/src/lib/papers/__fixtures__/*.doc.json` (arxiv-2609.02113, arxiv-2609.02697, zenodo-W7208807247) carry no section `id` / `page` and no blank lines inside a section's `text` (one paragraph per section), so paragraph-level features — map lines, route paragraph hits, the P3 gists — are exercised only by documents built inside tests.

Setup: pull; read `lib/papers/html-text.ts` (`ExtractedDocument`), `lib/papers/pdf-text.ts` (`extractPdfTextFromPath`), `lib/papers/full-text.ts` (how a document is fetched and extracted for an arXiv id and for a Zenodo record), the tests that load the fixtures (`evidence.test.ts`, `full-text.test.ts`, `reading-map.test.ts`, `reading-markdown.test.ts`, `reading.test.ts`, `upload-store.test.ts`), the `.paper.json` siblings (the paper records), and `web/scripts/` for the house style of a script.

What to build:

1. **A re-runnable script** `web/scripts/regenerate-paper-fixtures.mjs` (or `.ts` run with `npx tsx`) that, for each fixture, fetches the public source the way `full-text.ts` does (the arXiv PDF by id; the Zenodo record's file) through the current extractors and writes the `.doc.json` in the exact `ExtractedDocument` shape with `id`, `page` where the source is a PDF, and `\n\n` paragraph breaks inside `text`. The raw PDFs stay uncommitted; only the extracted documents are.
2. **Regenerate the three fixtures in place.** Every test that pinned a number or a string from the old fixtures (section counts, word counts, minutes, opening strings, evidence positions) is updated to the new value, each with a one-line comment saying why it changed; no assertion is loosened to a range or removed. If a regenerated fixture breaks an assertion that encodes a product rule rather than a number, stop and report it as a finding instead of changing the rule.
3. **One new assertion per fixture** in `reading-map.test.ts`: every section carries an `id`, and at least one section has two or more paragraphs.
4. Public papers only; nothing per-user anywhere.

If the environment's network forbids fetching the sources (the proxy may), set the row to BLOCKED with the exact error in the checkpoint and commit only the script and the checkpoint.

Commit `test(reader): paper fixtures carry ids, pages and paragraph breaks (BACKLOG-05)`; checkpoint `docs/reading-helper-abc/BACKLOG-05-C-<UTC>.md`; the four gates; push; one-paragraph report.
