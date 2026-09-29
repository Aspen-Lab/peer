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
 * folds each token to `term-expand.ts`'s `singularize` form and is used
 * ONLY at combine.ts's T4 (Required-gate similarity fallback) comparison —
 * never the shared index every scored item gets. keyword.ts's SENSE-CONTEXT
 * short-tag context check stays on plain `tokenize()`: folding it exposed a
 * pre-existing path defect (the overlap axis counting non-topical shared
 * words as evidence) that needs its own fix, not just a tokenizer swap —
 * see the new item SENSE-CONTEXT-EVIDENCE.
 */
export function tokenizeFolded(text: string): string[] {
  return tokenize(text).map(singularize);
}
