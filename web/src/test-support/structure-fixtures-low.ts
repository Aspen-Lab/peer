// An invented paper whose draft is wrong only where the rules were unsure (P12-94; companion of `structure-fixtures.ts`).
//
// The review corrects a part only if the rules were unsure of it (confidence `low`); that happens in two places: the
// paper's opening text when nothing places it, and the closing that rule set B splits out of the last results row.
// `inventedPaper(FIVE_PARTS)` is wrong in parts the rules were sure of, so a review of it is refused whole. This paper is
// wrong in both low parts, and in three ways that cover the review's three operations:
//   - the unplaced opening "Overview" (draft: one `setup` part, `low`, tagged `default`, paragraphs 0 to 7) is five method
//     paragraphs and three setup paragraphs: a `split` at 5 (setup) and a `set_role` of part 0 (method);
//   - the closing the rules cut at the paragraph that restates the abstract (part 2, `low`, `interpretation`, 14 to 16)
//     starts one paragraph late, the paragraph before it being interpretation too: a `move_start` of part 2 to 13.
// Nothing here is a real paper.
import { inventedPaper, type InventedRow } from "./structure-fixtures";

/** The abstract as the record holds it: the closing's echo. Two pieces, as the request carries them. */
export const LOW_ABSTRACT_PARTS = ["Mussel populations decline sharply", "under persistent warming, according to the survey."] as const;
export const LOW_ABSTRACT = LOW_ABSTRACT_PARTS.join("\n\n");
/** What a request's `paper` carries for the abstract (`summaryIntro`, `summaryResultDiscussion`). */
export const LOW_ABSTRACT_FIELDS = { summaryIntro: LOW_ABSTRACT_PARTS[0], summaryResultDiscussion: LOW_ABSTRACT_PARTS[1] } as const;

export const LOW_ROWS: readonly InventedRow[] = [
  { heading: "Overview", canonical: "body", truth: [["method", 5], ["setup", 3]] },
  { heading: "2 Results", canonical: "results", truth: [["evidence", 5], ["interpretation", 4]] },
  { heading: "References", canonical: "references", truth: [["apparatus", 3]] },
];

/** The summary paragraph (ordinal 14): it names its role in its first words, as every paragraph does, and restates the abstract. */
export const LOW_PARAGRAPHS: Record<number, string> = {
  14: "Invented interpretation paragraph 14 about gull colonies. In summary, mussel populations decline sharply under persistent warming across the survey.",
};

/**
 * The paper: 20 paragraphs; draft `0-7 setup low | 8-13 evidence high | 14-16 interpretation low | 17-19 apparatus high`; truth
 * `0-4 method | 5-7 setup | 8-12 evidence | 13-16 interpretation | 17-19 apparatus`.
 */
export function lowPaper(rows: readonly InventedRow[] = LOW_ROWS, paragraphs: Record<number, string> = {}) {
  return inventedPaper(rows, { abstract: LOW_ABSTRACT, paragraphs: { ...LOW_PARAGRAPHS, ...paragraphs } });
}
