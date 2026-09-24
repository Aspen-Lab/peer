// P5-S2 (Round 3) — pure evaluation metric instruments for §3e's three-arm
// comparison (baseline / hybrid+deterministic-ranking / hybrid+Jev).
//
// ABC-JEV-INTEGRATION.md §4, "P5 B guide COMPLETE ... pinned metric
// definitions" (2026-09-24T11:57:44Z), ruling (5) and (6) — binding:
//   - judged-relevant = label >= 1 (a parameter on precisionAtK, default 1).
//   - "ranking quality" = nDCG@10: gain 2^rel-1, discount log2(rank+1) with
//     rank starting at 1, ideal order = that project's judged labels sorted
//     descending; unjudged items contribute gain 0 and are reported
//     separately (a top-k unjudged count); mean over projects with a
//     bootstrap 95% interval.
//   - "recall in judged candidate set" (never corpus-wide): the denominator
//     is every judged-relevant item for the project, whether or not the
//     ranking ever retrieved it — NOT limited to what's in `rankedIds`.
//   - metric code lives in this NEW pure module rather than extending
//     web/src/lib/scoring/channel-comparison.ts in place, because the
//     three-arm comparison's math must not depend on channel concepts
//     (ruling 6) — channel-comparison.ts is untouched by this slice.
//
// Every function here is pure, synchronous, and never throws on malformed
// input — an empty/degenerate input degrades to an explicit typed
// "undefined"/"insufficient" result, never NaN, never a thrown exception.
// No network call, no clock read, no randomness except bootstrapInterval's
// own seeded, fully deterministic PRNG (documented at its definition).
//
// This module is evaluation tooling only, per its assignment: nothing in
// production code imports it yet.

// ─────────────────────────────── precision@k ──────────────────────────────

export interface PrecisionAtKResult {
  /** relevantCount / k — the NOMINAL k, even when fewer than k items were ranked. */
  readonly precision: number;
  readonly relevantCount: number;
  /** min(k, rankedIds.length) — how many ranked items actually existed to judge. */
  readonly consideredCount: number;
  /** Echoes the k given, unclamped, for caller transparency. */
  readonly k: number;
  /** Items within the considered window with no entry in `labels` at all. */
  readonly unjudgedCount: number;
}

/**
 * Precision at k over a ranking. `labels` maps item id -> a relevance grade;
 * "judged-relevant" means `label >= relevantThreshold` (default 1, per the
 * pinned definition). An item absent from `labels` is unjudged: it is never
 * silently treated as relevant, and is counted separately in
 * `unjudgedCount`. Per the pinned definition, the denominator is always the
 * NOMINAL `k` — a ranking shorter than k is not rescored against its own
 * shorter length (that would reward incomplete rankings); `consideredCount`
 * reports how many items actually existed so a caller can tell the two
 * cases apart. `k <= 0` (or non-finite) degrades to a zeroed result rather
 * than dividing by zero or producing NaN.
 */
export function precisionAtK(
  rankedIds: readonly string[],
  labels: ReadonlyMap<string, number>,
  k: number,
  relevantThreshold = 1,
): PrecisionAtKResult {
  const safeK = Number.isFinite(k) && k > 0 ? Math.floor(k) : 0;
  const consideredCount = Math.min(safeK, rankedIds.length);
  let relevantCount = 0;
  let unjudgedCount = 0;
  for (let i = 0; i < consideredCount; i++) {
    const label = labels.get(rankedIds[i]);
    if (label === undefined) {
      unjudgedCount++;
    } else if (label >= relevantThreshold) {
      relevantCount++;
    }
  }
  const precision = safeK > 0 ? relevantCount / safeK : 0;
  return { precision, relevantCount, consideredCount, k, unjudgedCount };
}

// ───────────────────────── recall in judged candidate set ─────────────────

export type RecallResult =
  | {
      readonly status: "ok";
      readonly recall: number;
      readonly relevantRetrieved: number;
      readonly totalJudgedRelevant: number;
      readonly k?: number;
    }
  | { readonly status: "undefined"; readonly reason: string };

/**
 * Recall over the JUDGED CANDIDATE SET, never corpus-wide (§3e, verbatim:
 * "recall in judged candidate set (not claimed corpus-wide recall)"). The
 * denominator is every judged-relevant item for the project (every entry in
 * `labels` with `label >= 1`), whether or not `rankedIds` ever retrieved it
 * — a relevant item the system never surfaced is correctly a recall miss,
 * even though it never appears in `rankedIds` at all. `k`, if given,
 * restricts the NUMERATOR to the top-k of `rankedIds`; omitted, the full
 * ranking is considered (the pinned name has no "@k" suffix, unlike
 * precision@10, so there is no default cutoff here). The relevance
 * threshold is fixed at `label >= 1` — the module's one "judged-relevant"
 * rule; unlike precisionAtK, no source asks for a configurable threshold
 * here. A project with zero judged-relevant items has an undefined — never
 * NaN, never silently 0 — recall; that is reported explicitly rather than
 * guessed at.
 */
export function recallInJudgedSet(
  rankedIds: readonly string[],
  labels: ReadonlyMap<string, number>,
  k?: number,
): RecallResult {
  let totalJudgedRelevant = 0;
  for (const label of labels.values()) {
    if (label >= 1) totalJudgedRelevant++;
  }
  if (totalJudgedRelevant === 0) {
    return {
      status: "undefined",
      reason: "no judged-relevant items exist for this project (denominator is 0)",
    };
  }
  const window = k === undefined ? rankedIds : rankedIds.slice(0, Math.max(0, Math.floor(k)));
  const retrieved = new Set<string>();
  for (const id of window) {
    const label = labels.get(id);
    if (label !== undefined && label >= 1) retrieved.add(id);
  }
  return {
    status: "ok",
    recall: retrieved.size / totalJudgedRelevant,
    relevantRetrieved: retrieved.size,
    totalJudgedRelevant,
    k,
  };
}

// ──────────────────────────────── nDCG@k ───────────────────────────────────

export type NdcgResult =
  | {
      readonly status: "ok";
      readonly ndcg: number;
      readonly dcg: number;
      readonly idealDcg: number;
      readonly k: number;
      /** Items within the top-k with no entry in `gradedLabels` — they contribute gain 0, reported separately. */
      readonly unjudgedInTopK: number;
    }
  | { readonly status: "undefined"; readonly reason: string };

/**
 * nDCG@k per the pinned definition (ABC-JEV-INTEGRATION.md §4, ruling 5):
 * gain = 2^rel - 1, discount = log2(rank + 1) with rank starting at 1 (rank
 * 1 -> discount log2(2) = 1, never log2(1) = 0 — see the mutation note
 * below). Ideal order = that project's judged labels — EVERY entry of
 * `gradedLabels`, not merely the ones that happen to appear in `rankedIds`
 * — sorted descending, cut to k. An item in `rankedIds` absent from
 * `gradedLabels` contributes gain 0 to `dcg` and is tallied in
 * `unjudgedInTopK`, never silently skipped or treated as relevant. An ideal
 * DCG of 0 (no judged-relevant labels for the project) is undefined, never
 * a divide-by-zero NaN.
 *
 * MUTATION NOTE (P5-S2 build step 4): changing the discount to `log2(rank)`
 * (dropping the `+1`) makes the rank-1 discount `log2(1) = 0`. Any fixture
 * with a nonzero gain at rank 1 then divides by zero, and both `dcg` and
 * `idealDcg` become `Infinity`, so `ndcg` becomes `Infinity / Infinity` =
 * `NaN` — every hand-computed nDCG test in metrics.test.ts fails. A fixture
 * whose ideal DCG is legitimately 0 (all-zero labels) instead flips from
 * status "undefined" to status "ok" with ndcg NaN under the same mutation
 * (0/0 = NaN bypasses the `idealDcg === 0` check), which independently
 * fails that test too. This was verified by hand-editing this function,
 * rerunning the suite, and reverting — see the P5-S2 checkpoint's mutation
 * evidence.
 */
export function ndcgAtK(
  rankedIds: readonly string[],
  gradedLabels: ReadonlyMap<string, 0 | 1 | 2>,
  k: number,
): NdcgResult {
  const kk = Number.isFinite(k) && k > 0 ? Math.floor(k) : 0;
  const window = rankedIds.slice(0, kk);

  let dcg = 0;
  let unjudgedInTopK = 0;
  for (let i = 0; i < window.length; i++) {
    const rank = i + 1;
    const rel = gradedLabels.get(window[i]);
    if (rel === undefined) {
      unjudgedInTopK++;
      continue;
    }
    dcg += (Math.pow(2, rel) - 1) / Math.log2(rank + 1);
  }

  const idealGains = Array.from(gradedLabels.values())
    .sort((a, b) => b - a)
    .slice(0, kk);
  let idealDcg = 0;
  for (let i = 0; i < idealGains.length; i++) {
    const rank = i + 1;
    idealDcg += (Math.pow(2, idealGains[i]) - 1) / Math.log2(rank + 1);
  }

  if (idealDcg === 0) {
    return {
      status: "undefined",
      reason: "ideal DCG is 0 (no judged-relevant labels for this project)",
    };
  }

  return { status: "ok", ndcg: dcg / idealDcg, dcg, idealDcg, k: kk, unjudgedInTopK };
}

// ────────────────────────────── bootstrap CI ───────────────────────────────

export interface BootstrapOptions {
  readonly iterations: number;
  readonly confidence: number;
  readonly seed: number;
}

export type BootstrapResult =
  | { readonly status: "ok"; readonly mean: number; readonly low: number; readonly high: number; readonly n: number }
  | { readonly status: "insufficient"; readonly n: number; readonly reason: string };

/**
 * mulberry32 — a small, fast, deterministic PRNG (public-domain algorithm,
 * Tommy Ettinger; reimplemented directly here so this module adds no new
 * dependency). NOT cryptographically secure; used only so the same seed
 * always reproduces the same resample sequence. Returns a function producing
 * floats in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampIndex(idx: number, length: number): number {
  return Math.min(Math.max(idx, 0), length - 1);
}

/**
 * Percentile-method bootstrap confidence interval over `values` (e.g. one
 * numeric metric value per project). Resamples `values` WITH replacement
 * `iterations` times using a seeded deterministic PRNG (`mulberry32`,
 * above): the same `seed` always reproduces the same `low`/`high`; a
 * different seed can (and for non-degenerate input, does) produce a
 * different interval — see the determinism tests. `mean` is the plain
 * arithmetic mean of `values` itself (not of the resampled means), so it is
 * identical for every seed given the same input. Fewer than 2 values makes a
 * bootstrap interval meaningless: this returns a typed "insufficient" result
 * rather than a degenerate or misleading interval.
 */
export function bootstrapInterval(values: readonly number[], options: BootstrapOptions): BootstrapResult {
  const n = values.length;
  if (n < 2) {
    return {
      status: "insufficient",
      n,
      reason: "fewer than 2 values; a bootstrap interval is not meaningful",
    };
  }
  const { iterations, confidence, seed } = options;
  // R3-CLEANUP-1 / F-A-P5S2-01: a non-positive or non-integer `iterations`
  // used to either silently return status "ok" with low/high undefined
  // (iterations:0 — the "ok" variant's type declares low/high as `number`,
  // never `number|undefined`) or throw a native RangeError from
  // `new Array(iterations)` (any negative value) — directly contradicting
  // this module's own file-header promise to never throw on malformed
  // input. Guarded the same way as the `values.length < 2` case above.
  if (!Number.isInteger(iterations) || iterations < 1) {
    return {
      status: "insufficient",
      n,
      reason: "iterations must be a positive integer",
    };
  }
  // R3-CLEANUP-1 / F-A-P5S2-01: confidence outside the open interval (0,1)
  // is equally malformed (0 or negative gives a reversed/degenerate
  // percentile window; NaN propagates through clampIndex to an
  // out-of-range array index, again surfacing as a silent `undefined`
  // low/high) — same typed-result treatment, not a throw or a NaN.
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
    return {
      status: "insufficient",
      n,
      reason: "confidence must be a number strictly between 0 and 1",
    };
  }
  const rng = mulberry32(seed);
  const sampleMeans: number[] = new Array(iterations);
  for (let iter = 0; iter < iterations; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.min(n - 1, Math.floor(rng() * n));
      sum += values[idx];
    }
    sampleMeans[iter] = sum / n;
  }
  sampleMeans.sort((a, b) => a - b);

  const alpha = 1 - confidence;
  const lowIdx = clampIndex(Math.floor((alpha / 2) * iterations), iterations);
  const highIdx = clampIndex(Math.ceil((1 - alpha / 2) * iterations) - 1, iterations);

  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  return { status: "ok", mean, low: sampleMeans[lowIdx], high: sampleMeans[highIdx], n };
}

// ───────────────────────────── per-project breakdown ───────────────────────

export interface ProjectEvalInput {
  readonly projectId: string;
  readonly rankedIds: readonly string[];
  readonly gradedLabels: ReadonlyMap<string, 0 | 1 | 2>;
}

export interface ProjectMetricRow {
  readonly projectId: string;
  /** Total judged items for this project (`gradedLabels.size`) — the evidence size behind every metric on this row. */
  readonly n: number;
  readonly precision: PrecisionAtKResult;
  readonly recall: RecallResult;
  readonly ndcg: NdcgResult;
}

export interface PooledMetricSummary {
  readonly metric: "precision" | "recall" | "ndcg";
  readonly interval: BootstrapResult;
}

export interface PerProjectBreakdown {
  readonly perProject: readonly ProjectMetricRow[];
  readonly pooled: readonly PooledMetricSummary[];
}

export interface PerProjectBreakdownOptions {
  /** Used for precision@k and nDCG@k; default 10 (the pinned "@10" metrics). Recall has no cutoff by default — see recallInJudgedSet. */
  readonly k?: number;
  readonly relevantThreshold?: number;
  readonly bootstrap: BootstrapOptions;
}

/**
 * Per-project metric table PLUS a pooled bootstrap summary — never only the
 * pooled number (the pinned "user-level quality breakdown" rule: "every
 * metric reported per project ... with its n, never only a pooled
 * average"). A project whose recall/nDCG is typed "undefined" (denominator
 * or ideal DCG 0) still gets its own row — it is simply excluded from that
 * metric's pooled bootstrap input (an undefined value cannot be averaged),
 * never silently dropped from the per-project table.
 */
export function perProjectBreakdown(
  projects: readonly ProjectEvalInput[],
  options: PerProjectBreakdownOptions,
): PerProjectBreakdown {
  const k = options.k ?? 10;
  const relevantThreshold = options.relevantThreshold ?? 1;

  const perProject: ProjectMetricRow[] = projects.map((project) => ({
    projectId: project.projectId,
    n: project.gradedLabels.size,
    precision: precisionAtK(project.rankedIds, project.gradedLabels, k, relevantThreshold),
    recall: recallInJudgedSet(project.rankedIds, project.gradedLabels),
    ndcg: ndcgAtK(project.rankedIds, project.gradedLabels, k),
  }));

  function pooledFor(metric: "precision" | "recall" | "ndcg"): PooledMetricSummary {
    const numericValues: number[] = [];
    for (const row of perProject) {
      if (metric === "precision") {
        numericValues.push(row.precision.precision);
      } else if (metric === "recall" && row.recall.status === "ok") {
        numericValues.push(row.recall.recall);
      } else if (metric === "ndcg" && row.ndcg.status === "ok") {
        numericValues.push(row.ndcg.ndcg);
      }
    }
    return { metric, interval: bootstrapInterval(numericValues, options.bootstrap) };
  }

  return {
    perProject,
    pooled: [pooledFor("precision"), pooledFor("recall"), pooledFor("ndcg")],
  };
}
