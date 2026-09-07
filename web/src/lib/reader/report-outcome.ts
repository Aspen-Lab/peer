// What a report means once it has arrived. The wire's `noLlm` flag says "no
// model wrote this"; whether that is an absence or a failure depends on what
// the server said it was doing. At Tier 0 no model was asked, so the empty
// report is the honest nothing and the page shows no model layer. After a
// `tier1` / `tier2` mode event the server had a provider and asked it, so an
// empty report back means the model was asked and could not finish — the
// page owes the reader that sentence, not a blank that reads as "nothing to
// show". The JSON fallback carries no mode, so the reader's own key stands in
// for it: with a key configured, the server had a provider.

export type ReportOutcome =
  /** A model-written report to render. */
  | "shown"
  /** No model layer: nothing was asked, nothing is missing. */
  | "absent"
  /** The model was asked and could not finish. */
  | "failed";

/**
 * `asked` is whether a model was asked at all: the stream's mode was not
 * `tier0`, or, on the JSON path, the reader has a provider configured.
 */
export function reportOutcome(
  report: { noLlm?: boolean } | null,
  asked: boolean,
): ReportOutcome {
  if (report && !report.noLlm) return "shown";
  return asked ? "failed" : "absent";
}
