import { singularize } from "./term-expand";

const STOPWORDS = new Set([
  "the", "a", "an", "of", "is", "are", "was", "were", "be", "been", "being",
  "and", "or", "but", "for", "nor", "so", "yet", "to", "from", "in", "on",
  "at", "by", "with", "as", "into", "onto", "upon", "over", "under",
  "this", "that", "these", "those", "it", "its", "their", "there",
  "we", "our", "you", "your", "they", "them", "he", "she", "him", "her",
  "have", "has", "had", "do", "does", "did", "can", "could", "may", "might",
  "shall", "should", "will", "would", "must", "not", "no",
  "paper", "study", "work", "propose", "show", "present", "using", "based",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function normalizePhrase(phrase: string): string {
  return phrase.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * TOKENIZE-PLURALS (ABC-JEV-INTEGRATION.md §1be point 5, Option B split) —
 * `tokenize()` itself stays plural-blind; every existing caller (the
 * pool-wide TF-IDF index/topicality ranking, rerank.ts, the reference-table
 * build script) is unaffected by this function's existence. `tokenizeFolded`
 * folds each token to `term-expand.ts`'s `singularize` form and is used at
 * combine.ts's T4 (Required-gate similarity fallback) comparison — never the
 * shared index every scored item gets.
 *
 * SENSE-CONTEXT-EVIDENCE (§1bg point 1) — keyword.ts's SENSE-CONTEXT
 * short-tag context check now uses `tokenizeFolded` too (`senseContextGate`,
 * `senseContextStripSet`): TOKENIZE-PLURALS folded it here first and
 * reverted after it exposed a pre-existing path defect (the overlap axis
 * counting non-topical shared words, e.g. "while"/"focused", as evidence).
 * That defect is fixed by a document-frequency cut on the overlap axis (see
 * `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT` in keyword.ts), which is what
 * makes folding the context check finally safe.
 */
export function tokenizeFolded(text: string): string[] {
  return tokenize(text).map(singularize);
}
