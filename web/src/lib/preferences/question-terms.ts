import { specificTerms } from "@/lib/papers/reading-map";

/** The longest word a question may hold and still give terms (P5-04). */
const LONGEST_WORD = 24;
/** The shortest run of letters and digits, mixed, that reads as a key. */
const KEY_RUN_LENGTH = 16;
const NOT_A_WORD = /[@/\\:=]/;
const DOT_BETWEEN_LETTERS = /\p{L}\.\p{L}/u;
const LETTERS_AND_DIGITS = new RegExp(`[\\p{L}\\p{N}]{${KEY_RUN_LENGTH},}`, "gu");

/**
 * P5-04 (S2, §1h.15 (b)): is this word, as the reader typed it, a key, an address
 * or a host rather than a word of a question? The ledger travels in every
 * briefing request and, signed in, is stored against the account, so a credential
 * or an address pasted into a question box must not become a term of it. A word is
 * left out whole when it is longer than 24 characters (no ordinary word is; a
 * 23-letter compound still passes), holds `@`, `/`, `\`, `:` or `=` (an address, a
 * path, a link, an assignment), has a dot between letters on both sides (a host or
 * an address; a sentence's own full stop does not), or holds a run of 16 or more
 * letters and digits that mixes both (a key's body). It runs on the whole word
 * because `tokenize` turns `@ / \ : = .` into spaces: an address would otherwise
 * arrive as four plain-looking words, and the rule would have nothing to see.
 * The cost is small and silent by design: a word such as "and/or" gives no term.
 */
export function isSecretOrAddressShaped(word: string): boolean {
  if (word.length > LONGEST_WORD) return true;
  if (NOT_A_WORD.test(word) || DOT_BETWEEN_LETTERS.test(word)) return true;
  return (word.match(LETTERS_AND_DIGITS) ?? []).some((run) => /\p{L}/u.test(run) && /\p{N}/u.test(run));
}

/** The question as it is read for terms: every word that is not key- or address-shaped. */
function readableWords(question: string): string {
  return question.split(/\s+/).filter((word) => !isSecretOrAddressShaped(word)).join(" ");
}

/**
 * P5-02 (blueprint P5): the terms of a paper's settled questions that may enter
 * the preference ledger — the reading map's own specific terms (`specificTerms`:
 * `tokenize`'s lower-cased tokens minus the generic and route-stoplist words),
 * one per canonical form across the questions. The reader's own words are the
 * only source. A question in `notForRecommendations` (the reader ticked "Not
 * for recommendations"; compared trimmed and case-folded) contributes nothing;
 * a term another question holds stays. The question's text never leaves here.
 * P5-04 (S2): a word shaped like a key or an address gives no term, nor any
 * fragment of it (`isSecretOrAddressShaped`).
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
    for (const term of specificTerms(readableWords(question))) {
      if (seen.has(term)) continue;
      seen.add(term);
      terms.push(term);
    }
  }
  return terms;
}
