/**
 * What Peer may say about how much a Jev key improves a reader's list: today,
 * nothing about size.
 *
 * The repository has NO measurement of Jev's effect. Its only live Jev evidence
 * is four synthetic calls that returned contract-valid answers in a fraction of a
 * second (`docs/jev-abc/JEV-SMOKE-A-20260928T023832Z.md`), which says the wire
 * contract works and nothing about quality, and its binding rule
 * (`ABC-JEV-INTEGRATION.md:94`) forbids a claim that Jev improves the result by
 * a specified amount without paired measurements. So the claim lives in ONE
 * place, here, and it is `null`:
 *
 *  - while `JEV_MEASURED_GAIN` is `null`, every screen that talks about the
 *    improvement renders `jevGainSentence()`, which is exactly
 *    "How much this improves your list is not yet measured." It contains no
 *    digit, no adjective of size and no price;
 *  - the filled branch exists and is tested with a made-up value
 *    (`jev-claim.test.ts`), but it is NEVER filled by a code change that has no
 *    report behind it. Filling it needs a measured result and the path of the
 *    report that holds it (`reportPath`), checked in with the change. A paired
 *    evaluation (the same candidates, with and without Jev's order, labelled
 *    blind by the reader's own judgement, with a 95% interval on the difference)
 *    is what would earn the numbers; it has not been run.
 */

export interface JevMeasuredGain {
  /** How many (project, paper) pairs were labelled. */
  papers: number;
  /** How many projects they came from. */
  projects: number;
  metric: "ndcg@10" | "precision@10";
  /** The metric without Jev's order (the shipped keyless order). */
  without: number;
  /** The same metric with Jev's order. */
  with: number;
  /** The 95% interval on the difference (with minus without). */
  ciLow: number;
  ciHigh: number;
  /** Where the report that holds these numbers lives in the repository. */
  reportPath: string;
}

/** `null` until a measured result exists. Do not fill this without a report. */
export const JEV_MEASURED_GAIN: JevMeasuredGain | null = null;

/** The one sentence rendered while nothing is measured. Pinned word for word by a test. */
export const JEV_GAIN_NOT_MEASURED_SENTENCE = "How much this improves your list is not yet measured.";

const METRIC_LABEL: Record<JevMeasuredGain["metric"], string> = {
  "ndcg@10": "nDCG at 10",
  "precision@10": "precision at 10",
};

/** The sentence about the improvement: the not-measured sentence, or, when a measurement is filled in, what was measured. */
export function jevGainSentence(gain: JevMeasuredGain | null = JEV_MEASURED_GAIN): string {
  if (gain === null) return JEV_GAIN_NOT_MEASURED_SENTENCE;
  return (
    `In our test of ${gain.papers} papers across ${gain.projects} projects, ` +
    `${METRIC_LABEL[gain.metric]} was ${gain.with} with Jev against ${gain.without} without ` +
    `(95% interval for the difference ${gain.ciLow} to ${gain.ciHigh}).`
  );
}
