/**
 * How Jev's answers change the order of a reader's papers. Pure and local: this
 * file turns "what Jev said about each paper in the shortlist" into a best-first
 * list of paper ids, which the feed pipeline writes into the cached pool's
 * `aiOrder` slot (the same slot a model key's ranking uses) and replays at read
 * time with `applyRerankOrder` (`feed/tier2-rerank.ts`), which puts the ordered
 * ids first and everything else behind them.
 *
 * THE RULES (each is pinned by `apply.test.ts`):
 *  - **Demote, never drop.** A paper Jev strongly says is a mismatch (a wrong
 *    sense, or only background, answered at high confidence) is left OUT of the
 *    ordered list, so `applyRerankOrder` places it behind the ordered papers.
 *    It stays in the pool; it is never removed.
 *  - **`unknown` is neutral.** An answer flagged unknown (an explicit
 *    "insufficient information", or confidence below the pinned threshold)
 *    contributes the neutral midpoint, whatever value it carries
 *    (`combine.ts`). A paper with no decision at all gets the same neutral
 *    contribution, so it keeps its local place.
 *  - **Local rank still counts.** A paper's position is a blend of where the
 *    local scoring put it and what Jev said, at equal weight, so Jev can move a
 *    paper up or down past its neighbours but cannot reorder the list
 *    wholesale on its own. The two weights are a first setting that has NOT been
 *    measured (the repository has no measurement of Jev's effect); they are named
 *    constants so a later evaluation can change them in one place.
 *  - **Enough answers, or none.** Jev's order is used only when it answered at
 *    least `JEV_MIN_COVERAGE` (60 %) of the shortlist. Below that, or when the
 *    key was rejected, the caller keeps its own order, and the status says so.
 *
 * Nothing here reads the environment, a key, a clock or a network.
 */

import { combineDecisionAnswers } from "./combine";
import type { ScreenCandidate, ScreenResult, JevScreenFn } from "./screen";
import { MAX_SCREEN_CANDIDATES } from "./screen";
import type { DecisionResult } from "./types";

/** Jev's order is used only when it answered at least this share of the shortlist. */
export const JEV_MIN_COVERAGE = 0.6;

/** An answer counts as a strong mismatch only at or above this confidence (the rubric's own "unknown" line is 0.5). */
export const JEV_STRONG_MISMATCH_CONFIDENCE = 0.8;

/** How much the local rank counts in a paper's blended position. Unmeasured first setting. */
export const JEV_LOCAL_WEIGHT = 0.5;
/** How much what Jev said counts in a paper's blended position. Unmeasured first setting. */
export const JEV_DECISION_WEIGHT = 0.5;

/** What Jev did on a build, in the three numbers and one word the Profile row shows. Mirrors `FeedMeta.jevScreening`. */
export interface JevScreeningMeta {
  /**
   * `applied`: every paper was answered and Jev's order is used. `partial`:
   * enough (60 % or more) were answered and Jev's order is used. `unavailable`:
   * too few were answered, so the order is the caller's own. `rejected`: Jev
   * refused the key, so the order is the caller's own.
   */
  status: "applied" | "partial" | "unavailable" | "rejected";
  /** Papers with an answer from Jev (cache hits included). */
  screened: number;
  /** Papers in the shortlist. */
  of: number;
}

export interface JevPlan {
  /** Best-first ids to write into the pool's `aiOrder`, or null when Jev's order is not used. */
  orderedIds: string[] | null;
  meta: JevScreeningMeta;
}

/** True when this decision strongly says the paper is a mismatch for the reader (demote it). */
function isStrongMismatch(decision: DecisionResult): boolean {
  return decision.answers.some(
    (answer) =>
      !answer.unknown &&
      answer.confidence >= JEV_STRONG_MISMATCH_CONFIDENCE &&
      ((answer.questionId === "sense_match" && answer.value === "different_sense") ||
        (answer.questionId === "core_vs_background" && answer.value === "background")),
  );
}

/** A decision is evidence only when it carries at least one answer. */
function hasAnswers(decision: DecisionResult | undefined): decision is DecisionResult {
  return decision !== undefined && decision.answers.length > 0;
}

/**
 * The shortlist's ids, best first, with strong mismatches left out.
 *
 * `shortlist` is in local rank order (index 0 is the locally best paper);
 * `decisions` are keyed by paper id and may cover any subset of it.
 */
export function jevOrderedIds(
  shortlist: ReadonlyArray<{ id: string }>,
  decisions: ReadonlyMap<string, DecisionResult>,
): string[] {
  const last = shortlist.length - 1;
  const ranked: Array<{ id: string; blended: number; index: number }> = [];

  shortlist.forEach((paper, index) => {
    const decision = decisions.get(paper.id);
    if (hasAnswers(decision) && isStrongMismatch(decision)) return; // demoted: not in the ordered list
    // 1 for the locally best paper down to 0 for the locally last one.
    const localRank = last > 0 ? 1 - index / last : 1;
    // An absent or answerless decision combines to the neutral midpoint.
    const jev = combineDecisionAnswers(decision?.answers ?? []).combined;
    ranked.push({
      id: paper.id,
      blended: JEV_LOCAL_WEIGHT * localRank + JEV_DECISION_WEIGHT * jev,
      index,
    });
  });

  // Best blended first; ties keep their local order, so the result is deterministic.
  ranked.sort((a, b) => b.blended - a.blended || a.index - b.index);
  return ranked.map((entry) => entry.id);
}

/**
 * Decides whether Jev's order is used and what to report, from one run's
 * result. `null` when the shortlist is empty (nothing was asked, so nothing is
 * reported).
 */
export function planJevOrdering(
  shortlist: ReadonlyArray<{ id: string }>,
  result: Pick<ScreenResult, "decisions" | "summary">,
): JevPlan | null {
  const of = shortlist.length;
  if (of === 0) return null;

  const screened = shortlist.filter((paper) => hasAnswers(result.decisions.get(paper.id))).length;

  if (result.summary.rejected) {
    return { orderedIds: null, meta: { status: "rejected", screened, of } };
  }
  if (screened / of < JEV_MIN_COVERAGE) {
    return { orderedIds: null, meta: { status: "unavailable", screened, of } };
  }
  return {
    orderedIds: jevOrderedIds(shortlist, result.decisions),
    meta: { status: screened === of ? "applied" : "partial", screened, of },
  };
}

/**
 * Runs the reader's screen function over the top of the pipeline's shortlist
 * and plans the order. Never throws: a screen that throws is "unavailable".
 * Only `id`, `title`, `abstract` and `venue` of each paper leave this function,
 * and at most `MAX_SCREEN_CANDIDATES` papers.
 */
export async function screenShortlist(
  items: ReadonlyArray<{ id: string; title: string; abstract?: string; venue?: string }>,
  screen: JevScreenFn,
): Promise<JevPlan | null> {
  const shortlist = items.slice(0, MAX_SCREEN_CANDIDATES);
  if (shortlist.length === 0) return null;

  const candidates: ScreenCandidate[] = shortlist.map((item) => ({
    id: item.id,
    title: item.title,
    abstract: item.abstract ?? null,
    venue: item.venue,
  }));

  try {
    return planJevOrdering(shortlist, await screen(candidates));
  } catch {
    return { orderedIds: null, meta: { status: "unavailable", screened: 0, of: shortlist.length } };
  }
}
