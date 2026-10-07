import { specificTerms } from "@/lib/papers/reading-map";

/**
 * P5-02 (blueprint P5): the terms of a paper's settled questions that may enter
 * the preference ledger — the reading map's own specific terms (`specificTerms`:
 * `tokenize`'s lower-cased tokens minus the generic and route-stoplist words),
 * one per canonical form across the questions. The reader's own words are the
 * only source. A question in `notForRecommendations` (the reader ticked "Not
 * for recommendations"; compared trimmed and case-folded) contributes nothing;
 * a term another question holds stays. The question's text never leaves here.
 */
export function questionTerms(
  questions: readonly string[],
  notForRecommendations: readonly string[] = [],
): string[] {
  const out = new Set(notForRecommendations.map((q) => q.trim().toLocaleLowerCase()));
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const question of questions) {
    if (out.has(question.trim().toLocaleLowerCase())) continue;
    for (const term of specificTerms(question)) {
      if (seen.has(term)) continue;
      seen.add(term);
      terms.push(term);
    }
  }
  return terms;
}
