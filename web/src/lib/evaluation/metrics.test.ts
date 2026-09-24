import { describe, expect, it } from "vitest";
import {
  bootstrapInterval,
  ndcgAtK,
  perProjectBreakdown,
  precisionAtK,
  recallInJudgedSet,
} from "./metrics";

// P5-S2 (Round 3) — pure evaluation metric instruments for §3e's three-arm
// comparison, per ABC-JEV-INTEGRATION.md §4's pinned metric definitions
// (Round 3, "P5 B guide COMPLETE", ruling 5, 2026-09-24T11:57:44Z) and
// docs/jev-abc/P5-B-20260924T114729Z.md §3. Every expected number below is
// computed by hand in the comment right above its assertion — this file is
// the arithmetic proof, not just a smoke test.
//
// Shared constant used in several hand computations: log2(3) = 1.5849625007211562
// (so 1/log2(3) = log_3(2) = 0.6309297535714573). Verified two independent
// ways in the implementer's own working notes; Math.log2(3) in the actual
// code computes this at runtime, this constant only predicts the expected
// test value.

describe("precisionAtK", () => {
  it("counts relevant (label >= 1) vs unjudged separately, full window", () => {
    // rankedIds: a,b,c,d,e — labels: a=2,b=0,c=1,e=1 (d absent = unjudged).
    // k=5, default threshold=1. Window = all 5.
    // a:2>=1 relevant. b:0 not relevant. c:1>=1 relevant. d: unjudged.
    // e:1>=1 relevant. relevantCount=3, unjudgedCount=1, consideredCount=5.
    // precision = 3/5 = 0.6.
    const labels = new Map([
      ["a", 2],
      ["b", 0],
      ["c", 1],
      ["e", 1],
    ]);
    const result = precisionAtK(["a", "b", "c", "d", "e"], labels, 5);
    expect(result).toEqual({
      precision: 0.6,
      relevantCount: 3,
      consideredCount: 5,
      k: 5,
      unjudgedCount: 1,
    });
  });

  it("divides by the nominal k, not by the shorter actual ranking length", () => {
    // Only 3 items ranked but k=10. consideredCount = min(10,3) = 3.
    // labels: a=1(relevant), b=0(not), c=2(relevant) -> relevantCount=2.
    // precision = 2/10 = 0.2 — NOT 2/3. This is the "fewer than k items"
    // rule: a short ranking is penalized, never rescored against its own length.
    const labels = new Map([
      ["a", 1],
      ["b", 0],
      ["c", 2],
    ]);
    const result = precisionAtK(["a", "b", "c"], labels, 10);
    expect(result).toEqual({
      precision: 0.2,
      relevantCount: 2,
      consideredCount: 3,
      k: 10,
      unjudgedCount: 0,
    });
  });

  it("honors a custom relevantThreshold parameter (default is 1)", () => {
    // threshold=2: a=1 does NOT qualify (1 < 2), b=2 qualifies.
    // relevantCount=1, precision=1/2=0.5.
    const labels = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const result = precisionAtK(["a", "b"], labels, 2, 2);
    expect(result).toEqual({
      precision: 0.5,
      relevantCount: 1,
      consideredCount: 2,
      k: 2,
      unjudgedCount: 0,
    });
  });

  it("degrades k<=0 to a zeroed result, never NaN or a throw", () => {
    const labels = new Map([["a", 2]]);
    const result = precisionAtK(["a"], labels, 0);
    expect(result).toEqual({
      precision: 0,
      relevantCount: 0,
      consideredCount: 0,
      k: 0,
      unjudgedCount: 0,
    });
  });
});

describe("recallInJudgedSet", () => {
  it("uses every judged-relevant item as the denominator, not just what's in rankedIds", () => {
    // Project's full judged set: a=2,b=1,c=0,d=1,e=2. Judged-relevant
    // (label>=1): a,b,d,e = 4 total. b, d, e never appear in rankedIds at
    // all — they still count in the denominator (a system that never even
    // retrieved them correctly loses recall for them).
    // rankedIds = [x, a, c]; x is not in labels at all (unjudged); a is
    // relevant (2>=1); c is judged but not relevant (0<1).
    // relevantRetrieved = {a} = 1. recall = 1/4 = 0.25.
    const labels = new Map([
      ["a", 2],
      ["b", 1],
      ["c", 0],
      ["d", 1],
      ["e", 2],
    ]);
    const result = recallInJudgedSet(["x", "a", "c"], labels);
    expect(result).toEqual({
      status: "ok",
      recall: 0.25,
      relevantRetrieved: 1,
      totalJudgedRelevant: 4,
      k: undefined,
    });
  });

  it("restricts the numerator (not the denominator) to the top-k when k is given", () => {
    // Same judged-relevant denominator = 4 (a,b,d,e). k=2 -> window=[d,x].
    // d is relevant (2>=1) and IS in the top-2 window: counted.
    // a and b are also relevant but ranked at positions 3/4, outside the
    // k=2 window: NOT counted, even though they'd count with no k cutoff.
    // relevantRetrieved = {d} = 1. recall = 1/4 = 0.25.
    const labels = new Map([
      ["a", 1],
      ["b", 1],
      ["c", 0],
      ["d", 2],
      ["e", 1],
    ]);
    const result = recallInJudgedSet(["d", "x", "a", "b"], labels, 2);
    expect(result).toEqual({
      status: "ok",
      recall: 0.25,
      relevantRetrieved: 1,
      totalJudgedRelevant: 4,
      k: 2,
    });
  });

  it("returns a typed undefined result (never NaN/0) when no judged-relevant items exist", () => {
    const labels = new Map([
      ["a", 0],
      ["b", 0],
    ]);
    const result = recallInJudgedSet(["a", "b"], labels);
    expect(result.status).toBe("undefined");
    if (result.status === "undefined") {
      expect(result.reason).toMatch(/denominator is 0/);
    }
  });
});

describe("ndcgAtK", () => {
  it("computes nDCG@3 by hand: gain 2^rel-1, discount log2(rank+1), ideal = judged labels sorted desc", () => {
    // rankedIds=[a,b,c], gradedLabels: a=2,b=0,c=1. k=3.
    // dcg:
    //   rank1 a: gain=2^2-1=3, discount=log2(2)=1        -> term=3/1=3
    //   rank2 b: gain=2^0-1=0, discount=log2(3)=1.584962... -> term=0
    //   rank3 c: gain=2^1-1=1, discount=log2(4)=2        -> term=1/2=0.5
    //   dcg = 3 + 0 + 0.5 = 3.5
    // ideal order = ALL judged labels {2,0,1} sorted desc = [2,1,0]:
    //   rank1 gain=3, discount=1        -> term=3
    //   rank2 gain=1, discount=log2(3)=1.5849625007211562 -> term=1/1.5849625007211562=0.6309297535714573
    //   rank3 gain=0, discount=2        -> term=0
    //   idealDcg = 3 + 0.6309297535714573 + 0 = 3.6309297535714573
    // ndcg = 3.5 / 3.6309297535714573 ≈ 0.963940 (hand division, verified to ~6dp)
    const gradedLabels = new Map<string, 0 | 1 | 2>([
      ["a", 2],
      ["b", 0],
      ["c", 1],
    ]);
    const result = ndcgAtK(["a", "b", "c"], gradedLabels, 3);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.dcg).toBeCloseTo(3.5, 9);
      expect(result.idealDcg).toBeCloseTo(3.6309297535714573, 9);
      expect(result.ndcg).toBeCloseTo(0.96394, 5);
      expect(result.unjudgedInTopK).toBe(0);
      expect(result.k).toBe(3);
    }
  });

  it("penalizes ranking a lower-relevance item ahead of a higher one, and tallies unjudged separately", () => {
    // rankedIds=[p,q,r], gradedLabels: p=1, r=2 (q absent = unjudged). k=3.
    // dcg:
    //   rank1 p: gain=2^1-1=1, discount=log2(2)=1  -> term=1
    //   rank2 q: unjudged -> gain 0, unjudgedInTopK=1, term=0
    //   rank3 r: gain=2^2-1=3, discount=log2(4)=2  -> term=1.5
    //   dcg = 1 + 0 + 1.5 = 2.5
    // ideal order = judged labels {1,2} sorted desc = [2,1] (q is not a
    // judged label at all, so it never enters the ideal order either):
    //   rank1 gain=3, discount=1                        -> term=3
    //   rank2 gain=1, discount=log2(3)=1.5849625007211562 -> term=0.6309297535714573
    //   idealDcg = 3 + 0.6309297535714573 = 3.6309297535714573
    // ndcg = 2.5 / 3.6309297535714573 ≈ 0.688529 (hand division, verified to ~6dp)
    const gradedLabels = new Map<string, 0 | 1 | 2>([
      ["p", 1],
      ["r", 2],
    ]);
    const result = ndcgAtK(["p", "q", "r"], gradedLabels, 3);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.dcg).toBeCloseTo(2.5, 9);
      expect(result.idealDcg).toBeCloseTo(3.6309297535714573, 9);
      expect(result.ndcg).toBeCloseTo(0.68853, 5);
      expect(result.unjudgedInTopK).toBe(1);
    }
  });

  it("returns a typed undefined result when ideal DCG is 0 (no judged-relevant labels)", () => {
    const gradedLabels = new Map<string, 0 | 1 | 2>([
      ["a", 0],
      ["b", 0],
    ]);
    const result = ndcgAtK(["a", "b"], gradedLabels, 2);
    expect(result.status).toBe("undefined");
    if (result.status === "undefined") {
      expect(result.reason).toMatch(/ideal DCG is 0/);
    }
  });
});

describe("bootstrapInterval", () => {
  it("returns an exact interval for a constant array, regardless of seed (fully hand-provable)", () => {
    // Every resample of [5,5,5,5] — with replacement, any combination of
    // indices — always draws four 5s, so every resampled mean is EXACTLY 5,
    // for every iteration, for any seed. Sorted resample means = [5,5,...,5]
    // (50 times); any percentile index therefore reads 5. mean of the
    // original array = (5+5+5+5)/4 = 5. So low=high=mean=5 exactly — this
    // holds independent of the PRNG's actual internal behavior, so it is
    // provable by hand without tracing the RNG bit-by-bit.
    const result = bootstrapInterval([5, 5, 5, 5], { iterations: 50, confidence: 0.95, seed: 42 });
    expect(result).toEqual({ status: "ok", mean: 5, low: 5, high: 5, n: 4 });
  });

  it("is deterministic: the same seed reproduces the exact same interval", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const options = { iterations: 200, confidence: 0.95, seed: 123 };
    const first = bootstrapInterval(values, options);
    const second = bootstrapInterval(values, options);
    expect(first).toEqual(second);
  });

  it("can produce a different interval for a different seed, and always respects analytic bounds", () => {
    // mean is the plain arithmetic mean of the INPUT values, not of any
    // resample, so it is identical and hand-computable regardless of seed:
    // (1+2+...+10)/10 = 55/10 = 5.5, exactly.
    // low/high are bootstrap resample means, each a convex combination of a
    // subset of {1..10} drawn with replacement — so they are ALWAYS bounded
    // within [min,max]=[1,10], and low<=high because the resample means are
    // sorted before the (low<=high) percentile indices are read. These
    // bounds are true by construction, independent of the RNG's exact
    // output, so asserting them is a real hand-provable check rather than a
    // guess at the PRNG's internals.
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const resultA = bootstrapInterval(values, { iterations: 200, confidence: 0.95, seed: 123 });
    const resultB = bootstrapInterval(values, { iterations: 200, confidence: 0.95, seed: 456 });
    expect(resultA.status).toBe("ok");
    expect(resultB.status).toBe("ok");
    if (resultA.status === "ok" && resultB.status === "ok") {
      expect(resultA.mean).toBeCloseTo(5.5, 9);
      expect(resultB.mean).toBeCloseTo(5.5, 9);
      expect(resultA.low).toBeGreaterThanOrEqual(1);
      expect(resultA.high).toBeLessThanOrEqual(10);
      expect(resultA.low).toBeLessThanOrEqual(resultA.high);
      expect(resultB.low).toBeGreaterThanOrEqual(1);
      expect(resultB.high).toBeLessThanOrEqual(10);
      expect(resultB.low).toBeLessThanOrEqual(resultB.high);
      // Different seeds, same non-degenerate input: the two intervals are
      // not required to differ in every conceivable universe, but for a
      // real PRNG over 200 iterations they do here — this is verified by
      // actually running the code (not a hand prediction of the PRNG's
      // bit-level output, which is infeasible to trace by hand reliably).
      const identical = resultA.low === resultB.low && resultA.high === resultB.high;
      expect(identical).toBe(false);
    }
  });

  it("returns a typed insufficient result for fewer than 2 values, never NaN", () => {
    expect(bootstrapInterval([], { iterations: 50, confidence: 0.95, seed: 1 })).toEqual({
      status: "insufficient",
      n: 0,
      reason: expect.stringMatching(/fewer than 2/),
    });
    expect(bootstrapInterval([7], { iterations: 50, confidence: 0.95, seed: 1 })).toEqual({
      status: "insufficient",
      n: 1,
      reason: expect.stringMatching(/fewer than 2/),
    });
  });

  // R3-CLEANUP-1 / F-A-P5S2-01: prior to this fix, iterations:0 returned
  // status "ok" with low/high silently `undefined` (violating the "ok"
  // variant's own type, which declares low/high as `number`, never
  // `number|undefined`), and any negative iterations value threw a native
  // RangeError from `new Array(iterations)` — directly contradicting this
  // module's own file-header promise to never throw on malformed input.
  // This guard mirrors the existing `values.length < 2` pattern above.
  it("returns a typed insufficient result for a non-positive or non-integer iterations, never a throw or undefined low/high (R3-CLEANUP-1 / F-A-P5S2-01)", () => {
    const values = [1, 2, 3];
    expect(bootstrapInterval(values, { iterations: 0, confidence: 0.95, seed: 1 })).toEqual({
      status: "insufficient",
      n: 3,
      reason: expect.stringMatching(/iterations/),
    });
    expect(() => bootstrapInterval(values, { iterations: -1, confidence: 0.95, seed: 1 })).not.toThrow();
    expect(bootstrapInterval(values, { iterations: -1, confidence: 0.95, seed: 1 })).toEqual({
      status: "insufficient",
      n: 3,
      reason: expect.stringMatching(/iterations/),
    });
    expect(bootstrapInterval(values, { iterations: 2.5, confidence: 0.95, seed: 1 })).toEqual({
      status: "insufficient",
      n: 3,
      reason: expect.stringMatching(/iterations/),
    });
    expect(bootstrapInterval(values, { iterations: Number.NaN, confidence: 0.95, seed: 1 })).toEqual({
      status: "insufficient",
      n: 3,
      reason: expect.stringMatching(/iterations/),
    });
  });

  // R3-CLEANUP-1 / F-A-P5S2-01: same guard, for the other malformed option
  // this finding named — confidence outside the open interval (0,1).
  it("returns a typed insufficient result for confidence outside (0,1), never a throw or NaN (R3-CLEANUP-1 / F-A-P5S2-01)", () => {
    const values = [1, 2, 3];
    expect(bootstrapInterval(values, { iterations: 50, confidence: 0, seed: 1 })).toEqual({
      status: "insufficient",
      n: 3,
      reason: expect.stringMatching(/confidence/),
    });
    expect(bootstrapInterval(values, { iterations: 50, confidence: 1, seed: 1 })).toEqual({
      status: "insufficient",
      n: 3,
      reason: expect.stringMatching(/confidence/),
    });
    expect(bootstrapInterval(values, { iterations: 50, confidence: -0.5, seed: 1 })).toEqual({
      status: "insufficient",
      n: 3,
      reason: expect.stringMatching(/confidence/),
    });
    expect(bootstrapInterval(values, { iterations: 50, confidence: Number.NaN, seed: 1 })).toEqual({
      status: "insufficient",
      n: 3,
      reason: expect.stringMatching(/confidence/),
    });
  });
});

describe("perProjectBreakdown", () => {
  it("reports every metric per project with its n, and pools only the defined values", () => {
    // Project A: reuses the ndcgAtK fixture 1 above (a=2,b=0,c=1, k=3).
    //   precision@3 (threshold 1): a,c relevant (2 of 3) -> 2/3 = 0.666...
    //   recall (no k cutoff, denominator = judged-relevant {a,c} = 2):
    //     window = full [a,b,c] -> retrieved {a,c} = 2 -> recall = 2/2 = 1.0
    //   ndcg@3 = 0.963940 (from the fixture above)
    //   n = gradedLabels.size = 3
    const projectA = {
      projectId: "A",
      rankedIds: ["a", "b", "c"],
      gradedLabels: new Map<string, 0 | 1 | 2>([
        ["a", 2],
        ["b", 0],
        ["c", 1],
      ]),
    };
    // Project B: reuses the ndcgAtK fixture 2 above (p=1, r=2, q unjudged, k=3).
    //   precision@3: p relevant(1>=1), q unjudged, r relevant(2>=1) -> 2/3 = 0.666...
    //   recall (denominator = judged-relevant {p,r} = 2): window=[p,q,r],
    //     retrieved {p,r} = 2 -> recall = 2/2 = 1.0
    //   ndcg@3 = 0.688529 (from the fixture above)
    //   n = gradedLabels.size = 2
    const projectB = {
      projectId: "B",
      rankedIds: ["p", "q", "r"],
      gradedLabels: new Map<string, 0 | 1 | 2>([
        ["p", 1],
        ["r", 2],
      ]),
    };
    // Project C: a single judged-not-relevant item, z=0.
    //   precision@3: z not relevant(0<1), window size min(3,1)=1 -> 0/3 = 0
    //   recall: totalJudgedRelevant among {z:0} = 0 -> status "undefined"
    //   ndcg@3: idealGains=[0] -> idealDcg=0 -> status "undefined"
    //   n = 1
    const projectC = {
      projectId: "C",
      rankedIds: ["z"],
      gradedLabels: new Map<string, 0 | 1 | 2>([["z", 0]]),
    };

    const breakdown = perProjectBreakdown([projectA, projectB, projectC], {
      k: 3,
      bootstrap: { iterations: 100, confidence: 0.95, seed: 7 },
    });

    expect(breakdown.perProject).toHaveLength(3);
    const [rowA, rowB, rowC] = breakdown.perProject;

    expect(rowA.n).toBe(3);
    expect(rowA.precision.precision).toBeCloseTo(2 / 3, 9);
    expect(rowA.recall).toMatchObject({ status: "ok", recall: 1 });
    expect(rowA.ndcg.status).toBe("ok");
    if (rowA.ndcg.status === "ok") expect(rowA.ndcg.ndcg).toBeCloseTo(0.96394, 5);

    expect(rowB.n).toBe(2);
    expect(rowB.precision.precision).toBeCloseTo(2 / 3, 9);
    expect(rowB.recall).toMatchObject({ status: "ok", recall: 1 });
    expect(rowB.ndcg.status).toBe("ok");
    if (rowB.ndcg.status === "ok") expect(rowB.ndcg.ndcg).toBeCloseTo(0.68853, 5);

    expect(rowC.n).toBe(1);
    expect(rowC.precision.precision).toBeCloseTo(0, 9);
    expect(rowC.recall.status).toBe("undefined");
    expect(rowC.ndcg.status).toBe("undefined");

    // Pooled: precision pools all 3 (2/3, 2/3, 0) -- mean = (2/3+2/3+0)/3 = (4/3)/3 = 4/9 ≈ 0.444444.
    // recall pools only A and B (C is undefined, excluded) -- both are
    // EXACTLY 1, so like the constant-array bootstrap fixture, every
    // resample mean is exactly 1 regardless of seed: mean=low=high=1 exactly.
    // ndcg pools only A and B (C is undefined, excluded) -- mean =
    // (0.963940 + 0.688529)/2 ≈ 0.826235 (hand sum of the two fixtures above).
    const pooledByMetric = Object.fromEntries(breakdown.pooled.map((p) => [p.metric, p.interval]));

    expect(pooledByMetric.precision.status).toBe("ok");
    if (pooledByMetric.precision.status === "ok") {
      expect(pooledByMetric.precision.mean).toBeCloseTo(4 / 9, 9);
      expect(pooledByMetric.precision.n).toBe(3);
      expect(pooledByMetric.precision.low).toBeGreaterThanOrEqual(0);
      expect(pooledByMetric.precision.high).toBeLessThanOrEqual(2 / 3 + 1e-9);
    }

    expect(pooledByMetric.recall).toEqual({ status: "ok", mean: 1, low: 1, high: 1, n: 2 });

    expect(pooledByMetric.ndcg.status).toBe("ok");
    if (pooledByMetric.ndcg.status === "ok") {
      expect(pooledByMetric.ndcg.n).toBe(2);
      expect(pooledByMetric.ndcg.mean).toBeCloseTo(0.826235, 4);
      expect(pooledByMetric.ndcg.low).toBeGreaterThanOrEqual(0.6885);
      expect(pooledByMetric.ndcg.high).toBeLessThanOrEqual(0.964);
    }
  });
});
