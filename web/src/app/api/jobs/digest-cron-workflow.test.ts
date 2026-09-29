import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// EMAIL-TOKEN-PRIVACY (ABC-JEV-INTEGRATION.md §1as, folding in B's P18):
// .github/workflows/digest-cron.yml runs hourly against a now-PUBLIC repo.
// Its old `jq . body.json || cat body.json` printed the FULL response body
// into that public run log — including, before this item's fix,
// `emails_failed[].error` (Resend's raw text, which can name an account
// owner's address) and every reader's `user_id`. The ruling's fix moved
// both routes to a counts-and-fixed-codes-only response (see
// dispatch-digests/route.ts and prepare-dashboards/route.ts); this test
// pins the OTHER half: the workflow itself must never go back to printing
// the whole body, even if a future edit reintroduces a raw `jq .`/`cat`
// fallback. A YAML-parsing test is deliberately avoided (no YAML library is
// a project dependency) — this reads the file as plain text, which is
// sufficient to catch the exact regression shape described above.
function workflowSource(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "..", ".github/workflows/digest-cron.yml"),
    "utf8",
  );
}

describe("EMAIL-TOKEN-PRIVACY: .github/workflows/digest-cron.yml prints counts only, never the raw response body", () => {
  it("the file exists and both jobs are still present (sanity — proves the path above is correct)", () => {
    const source = workflowSource();
    expect(source).toContain("dispatch:");
    expect(source).toContain("prepare:");
    expect(source).toContain("GET /api/jobs/dispatch-digests");
    expect(source).toContain("GET /api/jobs/prepare-dashboards");
  });

  it("never prints the whole JSON body: no bare `jq .` and no `cat` of either response file", () => {
    const source = workflowSource();
    // The old leak shape, byte for byte: `jq . <file> ... || cat <file>`.
    // Neither half may reappear anywhere in the file.
    expect(source).not.toMatch(/jq\s+\.\s+\S*body\.json/);
    expect(source).not.toMatch(/cat\s+\/tmp\/(prepare-)?body\.json/);
  });

  it("both jobs' jq filters select only named fields (a closed object-construction shorthand), never a passthrough `.` or `.[]`", () => {
    const source = workflowSource();
    const jqFilters = [...source.matchAll(/jq -c '([\s\S]*?)' \//g)].map((m) => m[1]);
    expect(jqFilters).toHaveLength(2); // one per job
    for (const filter of jqFilters) {
      // A bare "." or ".[]" anywhere as the WHOLE filter (not inside a
      // `.prepare // {}`-style fallback, which is fine) would republish the
      // entire body. The filters here always wrap every field access in a
      // `{ ... }` object-construction, which is the shape that selects only
      // the named leaves.
      expect(filter.trim()).not.toBe(".");
      expect(filter).toContain("{");
      expect(filter).toContain("}");
    }
  });

  it("the dispatch job's filter selects only the *_count fields, no *_reasons tally and no bare user_id/error text", () => {
    const source = workflowSource();
    const dispatchFilter = source.match(/jq -c '(\{dispatched_count[\s\S]*?\})' \/tmp\/body\.json/)?.[1];
    expect(dispatchFilter).toBeTruthy();
    for (const field of [
      "dispatched_count",
      "skipped_count",
      "failed_count",
      "emails_sent_count",
      "emails_failed_count",
    ]) {
      expect(dispatchFilter).toContain(field);
    }
    for (const forbidden of ["_reasons", "user_id", ".error", "dispatched,", "skipped,", "failed,"]) {
      expect(dispatchFilter).not.toContain(forbidden);
    }
  });

  it("the prepare job's filter selects only count/enum sub-fields of .prepare and .email_retry, no *_reasons tally", () => {
    const source = workflowSource();
    // `[^']*` (not `[\s\S]*?`) is deliberate: a lazy `[\s\S]*?` has no
    // distinctive literal right after "jq -c '" to anchor on (unlike the
    // dispatch filter's regex above, which anchors on "dispatched_count").
    // `.match()` finds the FIRST occurrence of the opening `jq -c '{` in
    // the whole file, which is the DISPATCH job's — and since the dispatch
    // job's own closing is `}' /tmp/body.json` (not "prepare-body.json"),
    // a lazy-but-unanchored `[\s\S]*?` is forced to keep expanding PAST
    // the dispatch job's filter and every comment line in between, all the
    // way to the PREPARE job's own closing quote, silently capturing the
    // whole file span between them (found the hard way: a stray "::error::"
    // annotation in that span made a later `.not.toContain("error")` check
    // fail against an otherwise-clean file). A bash single-quoted argument
    // can never contain a literal `'`, and neither jq filter here does
    // either, so `[^']*` is guaranteed to stop at the TRUE closing quote of
    // whichever `jq -c '...'` it starts matching at — which makes the
    // regex engine's first (dispatch-anchored) attempt fail outright
    // instead of over-matching, and correctly fall through to the
    // prepare job's own occurrence.
    const prepareFilter = source.match(/jq -c '([^']*)' \/tmp\/prepare-body\.json/)?.[1];
    expect(prepareFilter).toBeTruthy();
    for (const field of [
      "due_checked",
      "enqueued",
      "enqueue_failed_count",
      "drained",
      "candidates_checked",
      "sent_count",
      "failed_count",
    ]) {
      expect(prepareFilter).toContain(field);
    }
    // EMAIL-TOKEN-PRIVACY (A review MEDIUM finding, EMAIL-TOKEN-PRIVACY-A-
    // 20260928T230726Z.md check 5): `PrepareCyclePhaseReport.error`/
    // `.drain_error` are real free-text fields on the route's own response
    // (single orchestration-crash messages -- see prepare-dashboards/
    // route.ts). Today's shipped filter doesn't select them, but nothing
    // before this guarded against a future edit adding them back in (e.g.
    // "let's also show the crash reason", as a bare `error` shorthand key
    // or a `.prepare.error`/`.email_retry.error` path expression -- both
    // forms are caught by the bare "error" substring check below, which
    // also subsumes "drain_error"; kept as its own explicit check anyway
    // for a reader's clarity). Mirrors the dispatch job's own forbidden-
    // substring loop immediately above this test.
    for (const forbidden of ["_reasons", "user_id", "error", "drain_error"]) {
      expect(prepareFilter).not.toContain(forbidden);
    }
  });

  it("every non-200 outcome is still treated as a failing step (unchanged by this item)", () => {
    const source = workflowSource();
    const errorBlocks = [...source.matchAll(/if \[ "\$\{status\}" != "200" \][\s\S]{0,120}?exit 1/g)];
    expect(errorBlocks).toHaveLength(2);
  });
});
