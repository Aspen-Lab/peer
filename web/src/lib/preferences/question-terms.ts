import { specificTerms } from "@/lib/papers/reading-map";
import { QUESTION_TERM_WEIGHT, type QuestionTerm } from "./ledger";

/** The longest word a question may hold and still give terms (P5-04). */
const LONGEST_WORD = 24;
/** The shortest run of letters and digits, mixed, that reads as a key. */
const KEY_RUN_LENGTH = 16;
/**
 * The fewest decimal digits in one word, whatever separates them, that read as an
 * identifier, a card or a phone number (P5-04b: unbroken; P5-04c: grouped).
 */
const DIGIT_TOTAL_LENGTH = 16;
const NOT_A_WORD = /[@/\\:=]/;
const DOT_BETWEEN_LETTERS = /\p{L}\.\p{L}/u;
const LETTERS_AND_DIGITS = new RegExp(`[\\p{L}\\p{N}]{${KEY_RUN_LENGTH},}`, "gu");
const DIGIT = /\p{Nd}/gu;

/**
 * P5-04 (S2, §1h.15 (b)): is this word, as the reader typed it, a key, an address
 * or a host rather than a word of a question? The ledger travels in every
 * briefing request and, signed in, is stored against the account, so a credential
 * or an address pasted into a question box must not become a term of it. A word is
 * left out whole when it is longer than 24 characters (no ordinary word is; a
 * 23-letter compound still passes), holds `@`, `/`, `\`, `:` or `=` (an address, a
 * path, a link, an assignment), has a dot between letters on both sides (a host or
 * an address; a sentence's own full stop does not), holds a run of 16 or more
 * letters and digits that mixes both (a key's body), or holds 16 or more decimal
 * digits in all (P5-04b, §1h.16 (d): an identifier, a card or a phone number, the
 * same privacy class as a key, since a ledger term travels in every briefing
 * request and, signed in, is stored against the account). P5-04c (§1h.17 (b))
 * counts the digits of the whole word, whatever separates them (hyphens, dots,
 * parentheses, brackets: a card or a phone number written in groups), so the
 * unbroken run of 16 is only the plainest case of the count and has no clause of
 * its own. A public identifier written in groups (an ORCID iD) goes with them, at
 * no cost: it names a person, never a topic. Groups separated by spaces are
 * separate words and stay as they are (a four-digit word is a year or a count). A
 * word with 15 digits passes this rule; whether such a word becomes a term is
 * `specificTerms`'s business, not this function's. It runs on the whole word
 * because `tokenize` turns `@ / \ : = .` into spaces: an address would otherwise
 * arrive as four plain-looking words, and the rule would have nothing to see. The
 * cost is small and silent by design: a word such as "and/or" gives no term.
 */
export function isSecretOrAddressShaped(word: string): boolean {
  if (word.length > LONGEST_WORD) return true;
  if (NOT_A_WORD.test(word) || DOT_BETWEEN_LETTERS.test(word)) return true;
  if ((word.match(DIGIT) ?? []).length >= DIGIT_TOTAL_LENGTH) return true;
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
 * P5-04 (S4): each term comes with its share. One question is one signal: its
 * evidence totals `QUESTION_TERM_WEIGHT` however many specific terms it has, so
 * each of its n terms gets `QUESTION_TERM_WEIGHT / n`; a term two questions of
 * the paper both name takes the larger share, not the sum. The terms are in the
 * order they were first met.
 */
export function questionTerms(
  questions: readonly string[],
  notForRecommendations: readonly string[] = [],
): QuestionTerm[] {
  const out = new Set(notForRecommendations.map((q) => q.trim().toLocaleLowerCase()));
  const shares = new Map<string, number>();
  for (const question of questions) {
    if (out.has(question.trim().toLocaleLowerCase())) continue;
    const own = specificTerms(readableWords(question));
    for (const term of own) shares.set(term, Math.max(shares.get(term) ?? 0, QUESTION_TERM_WEIGHT / own.length));
  }
  return [...shares].map(([term, weight]) => ({ term, weight }));
}
