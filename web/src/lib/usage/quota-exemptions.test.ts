import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ABC-freemium 1-22 / 1-23 · R-QUOTA-3, D4.
 *
 * **Shallow paper reports, ranking, the digest and query generation are
 * unlimited for everyone — metered, never capped.** R-QUOTA-3 was vacuous
 * before this round (there was no counter to violate) and became violable the
 * moment 1-20 landed.
 *
 * It has no code of its own: it is a *placement* rule on 1-20. So it is
 * asserted as a placement — the only modules allowed to consume the deep-report
 * counter are the three deep report routes, and each of the four exempt paths
 * must not import it.
 *
 * **The second half matters as much as the first.** Every exempt path still
 * writes a `usage_events` row through the metering wrapper (1-03); "uncounted"
 * is not "unmetered". Without that stated, a later round could "fix"
 * R-QUOTA-3 by skipping the metering, which would lose the observability D4
 * relies on.
 */

const CONSUMER = "consumeDeepReport";

/** The three deep paths — the only places the counter may be consumed. */
const ALLOWED_CONSUMERS = [
  "src/app/api/papers/report/route.ts",
  "src/app/api/jobs/report/route.ts",
  "src/app/api/events/report/route.ts",
  // The implementation and its own tests.
  "src/lib/usage/deep-report-quota.ts",
];

/**
 * R-QUOTA-3's four exempt paths, each verified as a distinct code path so a
 * reader can see what must stay uncounted.
 */
const EXEMPT = [
  {
    file: "src/lib/feed/tier2-rerank.ts",
    what: "ranking — a Tier-2 rerank of a feed the reader already loaded",
  },
  {
    file: "src/app/api/digest/route.ts",
    what: "the daily digest",
  },
  {
    file: "src/lib/opportunities/query-gen.ts",
    what: "search-query generation inside a pipeline the route authenticated",
  },
];

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

describe("R-QUOTA-3 — what must never be counted", () => {
  it("is consumed only by the three deep report routes", () => {
    const allowed = new Set(ALLOWED_CONSUMERS);
    const found: string[] = [];

    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
      if (allowed.has(rel)) continue;
      if (read(rel).includes(CONSUMER)) found.push(rel);
    }

    expect(found.sort()).toEqual([]);
  });

  for (const { file, what } of EXEMPT) {
    it(`does not count ${what}`, () => {
      expect(read(file)).not.toContain(CONSUMER);
    });
  }

  it("counts the papers DEEP branch only, never the shallow one", () => {
    // The fourth exempt path lives inside a counted file, so it cannot be
    // checked by absence. `generateShallowReport` is the shallow path and is
    // reached from four places; none of them may consume the counter.
    //
    // "Shallow" is not "no LLM" — `generateShallowReport` calls the model when
    // one is available, so it is METERED by 1-03 and UNCOUNTED by 1-20.
    //
    // ── ABC-freemium 3-03 · Ruling 9 points 1-3 — REWRITTEN, NOT DELETED ─────
    //
    // **This assertion is the reason the defect shipped.** It required the one
    // `consumeDeepReport` call to sit BELOW `if (body.deepReport) {` in the
    // file, and it did — while an early `return streamReport(...)` sat above it
    // and took every real request. The assertion was about **position in the
    // file**, and position in the file is not position in the control flow.
    //
    // What it asserts now is the ordering that actually decides the outcome:
    // the counter runs **above** the transport branch, so neither transport can
    // skip it. Reachability itself is proved by driving the route in
    // `papers/report/route.test.ts` — a source scan cannot do that, and Ruling
    // 9 point 3 makes the behaviour test the requirement, with this as its
    // cheap structural companion.
    const source = read("src/app/api/papers/report/route.ts");

    expect(source.match(/consumeDeepReport\(/g) ?? []).toHaveLength(1);

    const consumeAt = source.indexOf("consumeDeepReport(gate.entitlement)");
    const streamBranch = source.indexOf("return streamReport(");
    const deepBranch = source.indexOf("if (body.deepReport) {");
    expect(consumeAt).toBeGreaterThan(-1);
    expect(streamBranch).toBeGreaterThan(-1);
    expect(deepBranch).toBeGreaterThan(-1);

    // The counter is reached before the transport is chosen…
    expect(consumeAt).toBeLessThan(streamBranch);
    // …and before the non-streamed deep branch, which now consumes the
    // decision rather than making a second one.
    expect(consumeAt).toBeLessThan(deepBranch);

    // Still gated on the request being deep: R-QUOTA-3's REAL exemption is a
    // depth, not a transport, and a shallow read must not reach the counter on
    // either path.
    expect(source).toMatch(/body\.deepReport\s*\?\s*await consumeDeepReport\(/);

    // And the shallow generator itself never reaches it. The check is for a
    // CALL, not the bare identifier: `streamReport`'s doc comment sits in this
    // window and names the function in prose, which is documentation of the
    // rule rather than a breach of it.
    const shallowStart = source.indexOf("async function generateShallowReport(");
    const shallowEnd = source.indexOf("function streamReport(");
    expect(source.slice(shallowStart, shallowEnd)).not.toMatch(
      /consumeDeepReport\s*\(/,
    );
  });

  it("never lets the streaming branch make a SECOND counter call", () => {
    // ABC-freemium 3-03 · Ruling 9 point 2 — the failure mode on the other side
    // of this fix. Moving the check up is one way to make both transports
    // count; adding a second call inside `streamReport` is the other, and it
    // charges a reader twice for one report. The route-wide count of 1 above
    // already forbids it; this states the reason so it is not "simplified"
    // away later.
    const source = read("src/app/api/papers/report/route.ts");
    const streamStart = source.indexOf("function streamReport(");
    // Bounded by the route handler, which follows it in the file and is where
    // the one legitimate call lives.
    const streamEnd = source.indexOf("export async function POST(");
    expect(streamStart).toBeGreaterThan(-1);
    expect(streamEnd).toBeGreaterThan(streamStart);
    expect(source.slice(streamStart, streamEnd)).not.toContain(CONSUMER);
  });

  it("keeps every exempt path METERED — uncounted is not unmetered", () => {
    // Each one acquires its provider through `resolveProvider`, which is where
    // 1-03's wrapper is applied. If a later round moved one of these off the
    // registry to dodge the quota, it would lose its usage rows too.
    for (const { file } of EXEMPT) {
      expect(read(file), file).toContain("resolveProvider");
    }
    expect(read("src/app/api/papers/report/route.ts")).toContain(
      "resolveProvider",
    );
  });
});
