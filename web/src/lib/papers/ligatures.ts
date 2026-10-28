// P12-67 (§1h.439): the ligatures a PDF's font stores as private-use glyphs read as letters again.
//
// A paper whose font sets fi / fl / ff / ffi / ffl as glyphs with no Unicode mapping comes out of pdf.js with a
// private-use character (U+E000–U+F8FF) in their place: "inuence", "gure", "dierent". The code is the
// font's own — the same glyph is a different code in another font, and nothing in the file says which ligature a
// code is. The paper does: it prints "figure" and "first" in other places, where the font did not ligate them (a word
// at a line's end, a bold face, a caption in another font), or prints "influence" with the ligature spelled out.
// So the code is learned from the paper itself and from nothing else — no table of fonts, no guess.
//
// Pure, deterministic, no dependency, linear in the size of the text. It reads strings and returns strings.

/** The private-use area of the Basic Multilingual Plane. */
const PRIVATE_USE = /[-]/;
/** A word: a run of letters (with their combining marks) and private-use codes. */
const WORD = /[\p{L}\p{M}-]+/gu;
const LETTER = /\p{L}/u;

/** The letters a code may stand for, in the order they are counted. */
export const LIGATURE_CANDIDATES = ["fi", "fl", "ff", "ffi", "ffl"] as const;
/** A code's ligature must be confirmed by at least this many different words… */
const MIN_CONFIRMING_WORDS = 2;
/** …and by at least this many times as many as the runner-up. */
const MIN_LEAD = 2;

/** Rule 1: the private-use code `word` carries, when it carries exactly one kind; otherwise null. */
function soleCode(word: string): string | null {
  let code: string | null = null;
  for (let i = 0; i < word.length; i++) {
    const unit = word.charCodeAt(i);
    if (unit < 0xe000 || unit > 0xf8ff) continue;
    if (code === null) code = word[i] as string;
    else if (word[i] !== code) return null;
  }
  return code;
}

/**
 * Rule 1: which letters each private-use code stands for, learned from the paper's own words.
 *
 * The words of every text are collected, lower-cased. Those with no private-use character are the words the paper
 * prints plainly. For each code, the words that contain it are tried with each candidate (fi, fl, ff, ffi, ffl) in
 * its place, and a candidate scores one for every distinct such word the paper also prints plainly. The code's
 * ligature is the candidate with the most words, if it has at least two and at least twice the runner-up's;
 * otherwise the code is not in the answer and is left as it is.
 *
 * - A word counts once however often it occurs ("figure" ten times is one word, not ten).
 * - A word carrying two different codes confirms nothing: with one of them replaced, it still carries the other,
 *   and no plainly printed word does.
 * - A code that stands alone (a bullet, a mark between spaces: no letter in its run) is not in any word and is never
 *   learned, so it cannot be "confirmed" by a paper that happens to print the word "fi".
 */
export function learnLigatures(texts: Iterable<string>): Map<string, string> {
  const learned = new Map<string, string>();
  const list = Array.from(texts).filter((text) => typeof text === "string" && text !== "");
  if (!list.some((text) => PRIVATE_USE.test(text))) return learned;

  const plain = new Set<string>();
  const broken = new Map<string, Set<string>>();
  for (const text of list) {
    for (const match of text.matchAll(WORD)) {
      const word = match[0].toLowerCase();
      const code = soleCode(word);
      if (code === null) {
        if (!PRIVATE_USE.test(word)) plain.add(word);
        continue;
      }
      if (!LETTER.test(word)) continue;
      const words = broken.get(code) ?? new Set<string>();
      words.add(word);
      broken.set(code, words);
    }
  }

  for (const [code, words] of broken) {
    const counts = LIGATURE_CANDIDATES.map(() => 0);
    for (const word of words) {
      const parts = word.split(code);
      LIGATURE_CANDIDATES.forEach((candidate, index) => {
        if (plain.has(parts.join(candidate))) counts[index] = (counts[index] ?? 0) + 1;
      });
    }
    let best = 0;
    for (let i = 1; i < counts.length; i++) if ((counts[i] ?? 0) > (counts[best] ?? 0)) best = i;
    const top = counts[best] ?? 0;
    const runnerUp = Math.max(0, ...counts.filter((_, i) => i !== best));
    if (top >= MIN_CONFIRMING_WORDS && top >= MIN_LEAD * runnerUp) learned.set(code, LIGATURE_CANDIDATES[best] as string);
  }
  return learned;
}
