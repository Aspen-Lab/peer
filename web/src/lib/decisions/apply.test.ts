import { describe, expect, it } from "vitest";
import { applyRerankOrder } from "@/lib/feed/tier2-rerank";
import type { ScoredItem } from "@/lib/scoring/types";
import {
  JEV_DECISION_WEIGHT,
  JEV_LOCAL_WEIGHT,
  JEV_MIN_COVERAGE,
  JEV_STRONG_MISMATCH_CONFIDENCE,
  jevOrderedIds,
  planJevOrdering,
  screenShortlist,
} from "./apply";
import type { ScreenCandidate, ScreenResult, ScreenSummary } from "./screen";
import type { DecisionAnswer, DecisionResult } from "./types";

// How Jev's answers change the order of the reader's papers. The rules under
// test: a paper Jev strongly says is a mismatch is DEMOTED, never dropped; an
// `unknown` answer is neutral; a paper with no decision counts as neutral too
// (it is ranked as a middling paper, not left in its slot); Jev's order is used
// only when it answered enough of the shortlist (60 %); and a rejected key
// means no Jev order at all.

function item(id: string, score = 0.5) {
  return { id, title: `Title ${id}`, abstract: `Abstract ${id}`, venue: "Venue", score };
}

function shortlistOf(count: number) {
  return Array.from({ length: count }, (_, i) => item(`p${i}`, 0.9 - i * 0.01));
}

function choice(
  questionId: DecisionAnswer["questionId"],
  value: string,
  confidence = 0.9,
  unknown = false,
): DecisionAnswer {
  return { questionId, kind: "choice", value, confidence, unknown };
}

function score(value: number, confidence = 0.9, unknown = false): DecisionAnswer {
  return { questionId: "project_help", kind: "score", value, confidence, unknown };
}

function decision(id: string, answers: DecisionAnswer[]): DecisionResult {
  return { paperId: id, answers, usage: null, modelId: "jev-1.13.0" };
}

/** A paper Jev likes a lot: core to the project and directly helpful. */
function strong(id: string): DecisionResult {
  return decision(id, [choice("core_vs_background", "core"), score(3)]);
}

/** A paper Jev likes little but does not call a confident mismatch. */
function weak(id: string): DecisionResult {
  return decision(id, [choice("core_vs_background", "core", 0.9), score(0)]);
}

function summaryOf(overrides: Partial<ScreenSummary> = {}): ScreenSummary {
  return {
    totalCandidates: 0,
    attempted: 0,
    cacheHits: 0,
    byStatus: {},
    deadlineExceeded: false,
    rejected: false,
    throttled: false,
    ...overrides,
  };
}

function resultOf(decisions: DecisionResult[], summary: Partial<ScreenSummary> = {}): ScreenResult {
  return {
    decisions: new Map(decisions.map((d) => [d.paperId, d])),
    summary: summaryOf(summary),
  };
}

function mustPlan(shortlist: ReadonlyArray<{ id: string }>, result: ScreenResult) {
  const plan = planJevOrdering(shortlist, result);
  if (!plan) throw new Error("expected a plan for a non-empty shortlist");
  return plan;
}

describe("jevOrderedIds", () => {
  it("is deterministic: the same shortlist and decisions give the same order every time", () => {
    const shortlist = shortlistOf(8);
    const decisions = new Map(
      shortlist.map((s, i) => [s.id, i % 2 === 0 ? strong(s.id) : weak(s.id)] as const),
    );
    const first = jevOrderedIds(shortlist, decisions);
    for (let run = 0; run < 5; run += 1) {
      expect(jevOrderedIds(shortlist, decisions)).toEqual(first);
    }
  });

  it("with no decision at all, every paper keeps its local place", () => {
    const shortlist = shortlistOf(6);
    expect(jevOrderedIds(shortlist, new Map())).toEqual(shortlist.map((s) => s.id));
  });

  it("a paper with no decision keeps its place among papers Jev judged neutral", () => {
    // p2 has no decision; p0, p1, p3, p4 have an all-neutral decision (no answers
    // carrying evidence: every answer is unknown). Nothing should move.
    const shortlist = shortlistOf(5);
    const neutral = (id: string) =>
      decision(id, [choice("core_vs_background", "core", 0.2, true), score(3, 0.2, true)]);
    const decisions = new Map(
      ["p0", "p1", "p3", "p4"].map((id) => [id, neutral(id)] as const),
    );
    expect(jevOrderedIds(shortlist, decisions)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("a paper Jev cannot judge counts as neutral: behind the papers Jev rates well, ahead of the ones it rates weakly and of the demoted", () => {
    // The sentence the Profile and the changelog print: "A paper Jev cannot judge
    // counts as neutral: Jev neither lifts nor lowers it, though papers Jev rates
    // well can move ahead of it." Six papers, local order p0..p5. With the 0.5 / 0.5
    // blend the neutral paper's position is 0.5 * its local rank + 0.5 * 0.5:
    //   p0 strong, local first            1.00
    //   p4 strong, locally BELOW p2       0.60   -> moves ahead of the unjudged p2
    //   p2 NO DECISION                    0.55
    //   p3 weak (combined 0.42)           0.41   -> stays behind p2: not lifted
    //   p5 weak                           0.21
    //   p1 confident wrong sense          demoted, out of the ordered list
    // A paper left in its slot would not move behind p4; one ranked as the best
    // would stay ahead of it; one ranked as the worst would fall behind p3.
    const shortlist = shortlistOf(6);
    const wrongSense = decision("p1", [choice("sense_match", "different_sense", 0.95), score(3)]);
    const decisions = new Map([
      ["p0", strong("p0")],
      ["p1", wrongSense],
      ["p3", weak("p3")],
      ["p4", strong("p4")],
      ["p5", weak("p5")],
    ]);

    const ordered = jevOrderedIds(shortlist, decisions);
    expect(ordered).toEqual(["p0", "p4", "p2", "p3", "p5"]);

    // And as the reader sees it, after the demoted paper is put behind the rest.
    const items = shortlist.map((s) => ({ ...s, abstract: s.abstract }) as unknown as ScoredItem);
    expect(applyRerankOrder(items, ordered).map((r) => r.id)).toEqual(["p0", "p4", "p2", "p3", "p5", "p1"]);
  });

  it("pins the 0.5 / 0.5 blend by its values: a one-level difference in Jev's answer does not move a paper past a locally better one, a two-level difference does", () => {
    // N18 of the branch review: until now only the end-to-end order tests would
    // notice a change of weights. The two weights are unmeasured first settings
    // (named constants so a later evaluation changes them in one place), and this
    // is the unit test that fails when they change.
    expect(JEV_LOCAL_WEIGHT).toBe(0.5);
    expect(JEV_DECISION_WEIGHT).toBe(0.5);

    // Three papers, local ranks 1, 0.5 and 0. Each answer is project_help alone,
    // so a paper's Jev value is its level / 3 (0, 1/3, 2/3 or 1); p2 has none.
    const shortlist = shortlistOf(3);
    const level = (id: string, value: number) => decision(id, [score(value)]);

    // One level apart (1/3 vs 2/3): p0 = 0.5*1 + 0.5*(1/3) = 0.667 beats
    // p1 = 0.5*0.5 + 0.5*(2/3) = 0.583. The better local rank holds.
    expect(jevOrderedIds(shortlist, new Map([["p0", level("p0", 1)], ["p1", level("p1", 2)]]))).toEqual(["p0", "p1", "p2"]);

    // Two levels apart (0 vs 2/3): p0 = 0.5*1 + 0 = 0.5 falls behind
    // p1 = 0.583. Jev's answer is strong enough to move a paper up one place.
    expect(jevOrderedIds(shortlist, new Map([["p0", level("p0", 0)], ["p1", level("p1", 2)]]))).toEqual(["p1", "p0", "p2"]);
  });

  it("an unknown answer is neutral: it counts the same as no answer, whatever value it carries", () => {
    const shortlist = shortlistOf(4);
    // p1's unknown answers claim the best possible values; they must not lift it.
    const lyingUnknown = decision("p1", [
      choice("core_vs_background", "core", 0.1, true),
      score(3, 0.1, true),
    ]);
    // p2's unknown answers claim the worst possible values; they must not sink it.
    const darkUnknown = decision("p2", [
      choice("core_vs_background", "background", 0.1, true),
      score(0, 0.1, true),
    ]);
    const withUnknowns = jevOrderedIds(shortlist, new Map([["p1", lyingUnknown], ["p2", darkUnknown]]));
    expect(withUnknowns).toEqual(["p0", "p1", "p2", "p3"]);
    expect(withUnknowns).toEqual(jevOrderedIds(shortlist, new Map()));
  });

  it("Jev can lift a paper above one the local score placed higher", () => {
    const shortlist = shortlistOf(5);
    // p1 is a strong match; p0 (local first) is judged weakly helpful.
    const decisions = new Map([
      ["p0", weak("p0")],
      ["p1", strong("p1")],
    ]);
    const order = jevOrderedIds(shortlist, decisions);
    expect(order.indexOf("p1")).toBeLessThan(order.indexOf("p0"));
  });

  it("a confident wrong-sense answer demotes the paper: it is left out of the ordered list", () => {
    const shortlist = shortlistOf(5);
    const wrongSense = decision("p0", [
      choice("sense_match", "different_sense", JEV_STRONG_MISMATCH_CONFIDENCE),
      choice("core_vs_background", "core"),
      score(3),
    ]);
    const order = jevOrderedIds(shortlist, new Map([["p0", wrongSense]]));
    expect(order).not.toContain("p0");
    expect(order).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("a confident 'only background' answer demotes the paper", () => {
    const shortlist = shortlistOf(4);
    const background = decision("p1", [choice("core_vs_background", "background", 0.95), score(1)]);
    expect(jevOrderedIds(shortlist, new Map([["p1", background]]))).not.toContain("p1");
  });

  it.each([
    ["wrong sense at 0.79", decision("p0", [choice("sense_match", "different_sense", 0.79), score(2)])],
    ["background at 0.7", decision("p0", [choice("core_vs_background", "background", 0.7), score(2)])],
    ["wrong sense flagged unknown", decision("p0", [choice("sense_match", "different_sense", 0.99, true), score(2)])],
    ["background flagged unknown", decision("p0", [choice("core_vs_background", "background", 0.99, true), score(2)])],
  ])("does not demote on %s", (_label, d) => {
    const shortlist = shortlistOf(4);
    expect(jevOrderedIds(shortlist, new Map([["p0", d]]))).toContain("p0");
  });

  it("demote, never drop: after applyRerankOrder a demoted paper is still in the list, behind every ordered one", () => {
    const shortlist = shortlistOf(5);
    const items = shortlist.map((s) => ({ ...s, abstract: s.abstract }) as unknown as ScoredItem);
    const wrongSense = decision("p0", [
      choice("sense_match", "different_sense", 0.95),
      score(3),
    ]);
    const ordered = jevOrderedIds(shortlist, new Map([["p0", wrongSense]]));

    const result = applyRerankOrder(items, ordered);

    expect(result.map((r) => r.id).sort()).toEqual(shortlist.map((s) => s.id).sort());
    expect(result.at(-1)?.id).toBe("p0");
    expect(result).toHaveLength(shortlist.length);
  });

  it("only ever returns ids from the shortlist, each at most once; decisions for other papers are ignored", () => {
    const shortlist = shortlistOf(4);
    const decisions = new Map([
      ["p1", strong("p1")],
      ["not-in-the-shortlist", strong("not-in-the-shortlist")],
    ]);
    const order = jevOrderedIds(shortlist, decisions);
    expect(new Set(order).size).toBe(order.length);
    expect(order.every((id) => shortlist.some((s) => s.id === id))).toBe(true);
    expect(order).not.toContain("not-in-the-shortlist");
  });

  it("answers an empty list for an empty shortlist", () => {
    expect(jevOrderedIds([], new Map())).toEqual([]);
  });

  it("a one-paper shortlist is that paper (or nothing, when it is demoted)", () => {
    const shortlist = shortlistOf(1);
    expect(jevOrderedIds(shortlist, new Map([["p0", strong("p0")]]))).toEqual(["p0"]);
    const wrong = decision("p0", [choice("sense_match", "different_sense", 0.95)]);
    expect(jevOrderedIds(shortlist, new Map([["p0", wrong]]))).toEqual([]);
  });

  it("local rank still matters: with equal Jev answers the local order stands", () => {
    const shortlist = shortlistOf(6);
    const decisions = new Map(shortlist.map((s) => [s.id, strong(s.id)] as const));
    expect(jevOrderedIds(shortlist, decisions)).toEqual(shortlist.map((s) => s.id));
  });
});

describe("planJevOrdering — when Jev's order is used, and what is reported", () => {
  it("every paper answered: the order is used and the status is applied", () => {
    const shortlist = shortlistOf(5);
    const result = resultOf(shortlist.map((s) => strong(s.id)));
    const plan = mustPlan(shortlist, result);
    expect(plan.meta).toEqual({ status: "applied", screened: 5, of: 5 });
    expect(plan.orderedIds).not.toBeNull();
  });

  it("uses Jev's order when exactly 60 % were answered, and calls it partial", () => {
    expect(JEV_MIN_COVERAGE).toBe(0.6);
    const shortlist = shortlistOf(5);
    const result = resultOf(["p0", "p1", "p2"].map((id) => strong(id)));
    const plan = mustPlan(shortlist, result);
    expect(plan.meta).toEqual({ status: "partial", screened: 3, of: 5 });
    expect(plan.orderedIds).not.toBeNull();
  });

  it("does not use Jev's order below 60 %: unavailable, and the order is the caller's own", () => {
    const shortlist = shortlistOf(5);
    const result = resultOf(["p0", "p1"].map((id) => strong(id)));
    const plan = mustPlan(shortlist, result);
    expect(plan.meta).toEqual({ status: "unavailable", screened: 2, of: 5 });
    expect(plan.orderedIds).toBeNull();
  });

  it("nothing answered: unavailable, zero screened", () => {
    const shortlist = shortlistOf(4);
    const plan = mustPlan(shortlist, resultOf([], { attempted: 4, byStatus: { network_error: 4 } }));
    expect(plan.meta).toEqual({ status: "unavailable", screened: 0, of: 4 });
    expect(plan.orderedIds).toBeNull();
  });

  it("a decision with no answers is not a screened paper", () => {
    const shortlist = shortlistOf(4);
    const empty = (id: string) => decision(id, []);
    const plan = mustPlan(shortlist, resultOf(shortlist.map((s) => empty(s.id))));
    expect(plan.meta).toEqual({ status: "unavailable", screened: 0, of: 4 });
    expect(plan.orderedIds).toBeNull();
  });

  it("a rejected key never uses Jev's order, even when most decisions came from the cache", () => {
    const shortlist = shortlistOf(5);
    const result = resultOf(["p0", "p1", "p2", "p3"].map((id) => strong(id)), { rejected: true });
    const plan = mustPlan(shortlist, result);
    expect(plan.meta).toEqual({ status: "rejected", screened: 4, of: 5 });
    expect(plan.orderedIds).toBeNull();
  });

  it("counts only papers that are in the shortlist", () => {
    const shortlist = shortlistOf(3);
    const result = resultOf([strong("p0"), strong("p1"), strong("elsewhere-1"), strong("elsewhere-2")]);
    const plan = mustPlan(shortlist, result);
    expect(plan.meta.screened).toBe(2);
    expect(plan.meta.of).toBe(3);
  });

  it("an empty shortlist has nothing to report", () => {
    expect(planJevOrdering([], resultOf([]))).toBeNull();
  });
});

describe("screenShortlist — never throws and never leaks what it was given", () => {
  it("hands the screen function only the minimal paper fields, in shortlist order, at most 50", async () => {
    const seen: Array<ReadonlyArray<ScreenCandidate>> = [];
    const screen = async (candidates: ReadonlyArray<ScreenCandidate>) => {
      seen.push(candidates);
      return resultOf([]);
    };
    const items = Array.from({ length: 60 }, (_, i) => ({
      ...item(`p${i}`),
      authors: ["A. Researcher"],
      url: "https://example.org/x",
      relevanceReason: "a local reason",
    }));

    await screenShortlist(items as unknown as ScoredItem[], screen);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(50);
    expect(Object.keys(seen[0][0]).sort()).toEqual(["abstract", "id", "title", "venue"]);
    expect(seen[0].map((c) => c.id)).toEqual(items.slice(0, 50).map((i) => i.id));
  });

  it("a screen function that throws gives an unavailable plan with no order", async () => {
    const shortlist = shortlistOf(4);
    const plan = await screenShortlist(shortlist as unknown as ScoredItem[], async () => {
      throw new Error("boom");
    });
    expect(plan?.meta).toEqual({ status: "unavailable", screened: 0, of: 4 });
    expect(plan?.orderedIds).toBeNull();
  });

  it("an empty shortlist never calls the screen function", async () => {
    let calls = 0;
    const plan = await screenShortlist([], async () => {
      calls += 1;
      return resultOf([]);
    });
    expect(plan).toBeNull();
    expect(calls).toBe(0);
  });

  it("a paper without an abstract is sent with a null abstract", async () => {
    const seen: Array<ReadonlyArray<ScreenCandidate>> = [];
    await screenShortlist(
      [{ id: "p0", title: "T", score: 0.5 }] as unknown as ScoredItem[],
      async (candidates) => {
        seen.push(candidates);
        return resultOf([]);
      },
    );
    expect(seen[0][0].abstract).toBeNull();
  });
});
