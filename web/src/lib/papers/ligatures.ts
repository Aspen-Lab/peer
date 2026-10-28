// P12-67 (§1h.439): the ligatures a PDF's font stores as private-use glyphs read as letters again.
//
// A paper whose font sets fi / fl / ff / ffi / ffl as glyphs with no Unicode mapping comes out of pdf.js with a
// private-use character (U+E000–U+F8FF) in their place: "in\uE104uence", "\uE103gure", "di\uE09Derent". The code is the
// font's own — the same glyph is a different code in another font, and nothing in the file says which ligature a
// code is. The paper does: it prints "figure" and "first" in other places, where the font did not ligate them (a word
// at a line's end, a bold face, a caption in another font), or prints "influence" with the ligature spelled out.
// So the code is learned from the paper itself and from nothing else — no table of fonts, no guess.
//
// Pure, deterministic, no dependency, linear in the size of the text. It reads strings and returns strings.

/** The private-use area of the Basic Multilingual Plane. */
const PRIVATE_USE = /[\uE000-\uF8FF]/;
const PRIVATE_USE_EACH = /[\uE000-\uF8FF]/g;
/** A word: a run of letters (with their combining marks) and private-use codes. */
const WORD = /[\p{L}\p{M}\uE000-\uF8FF]+/gu;
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

/**
 * Rule 2: `text` with every learned code inside a word replaced by its ligature's letters.
 *
 * Only private-use characters change, and only the learned ones; every other character comes back as it came. A
 * code that stands alone (no letter in its run: a bullet, a mark between spaces) is left as it is, whatever was
 * learned: it is not inside a word. A code that was not learned stays in the word it is in.
 */
export function applyLigatures(text: string, learned: ReadonlyMap<string, string>): string {
  if (learned.size === 0 || !PRIVATE_USE.test(text)) return text;
  return text.replace(WORD, (word) =>
    PRIVATE_USE.test(word) && LETTER.test(word) ? word.replace(PRIVATE_USE_EACH, (code) => learned.get(code) ?? code) : word,
  );
}

/** The parts of a finished document that carry the paper's words. An extracted document, an outline, a draft. */
export interface LigatureText {
  title?: string | null;
  sections?: ReadonlyArray<{ heading?: string; text?: string }>;
  figureCaptions?: ReadonlyArray<{ label?: string; caption?: string }>;
}

/**
 * Rules 1 and 2 on a finished document, in one call: the code of each ligature is learned from the words of the
 * title, every section's heading and text and every caption's label and text together, and then every occurrence is
 * replaced in those same places. Everything else in the document (ids, pages, buckets, equations, sizes, the
 * source) is carried over as it was. A document in which nothing is learned is returned itself, the same object.
 * The equations are left out on purpose: a math font reuses the private-use area for symbols that are not
 * ligatures, and what an equation prints is not a word the paper prints elsewhere.
 */
export function restoreLigatures<T extends LigatureText>(doc: T): T {
  const texts: string[] = [];
  const take = (text: unknown) => {
    if (typeof text === "string" && text !== "") texts.push(text);
  };
  take(doc.title);
  for (const section of doc.sections ?? []) {
    take(section.heading);
    take(section.text);
  }
  for (const caption of doc.figureCaptions ?? []) {
    take(caption.label);
    take(caption.caption);
  }
  const learned = learnLigatures(texts);
  if (learned.size === 0) return doc;

  const fix = (text: string | undefined) => (typeof text === "string" ? applyLigatures(text, learned) : text);
  const patch: LigatureText = {};
  if (typeof doc.title === "string") patch.title = fix(doc.title);
  if (doc.sections) {
    patch.sections = doc.sections.map((section) => ({
      ...section,
      ...(section.heading !== undefined ? { heading: fix(section.heading) } : {}),
      ...(section.text !== undefined ? { text: fix(section.text) } : {}),
    }));
  }
  if (doc.figureCaptions) {
    patch.figureCaptions = doc.figureCaptions.map((caption) => ({
      ...caption,
      ...(caption.label !== undefined ? { label: fix(caption.label) } : {}),
      ...(caption.caption !== undefined ? { caption: fix(caption.caption) } : {}),
    }));
  }
  return { ...doc, ...patch };
}
