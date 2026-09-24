// Mathematics inside the paper's text.
//
// The extractors flatten a formula's MathML into a jumble — "Q K T d k" —
// because a formula has no words to keep. LaTeXML writes the TeX beside every
// formula, and TeX is what a renderer wants; so the extractor keeps it,
// marked, and the reading page draws it.
//
// The marks are the mathematical white brackets, U+27E6 and U+27E7: printable,
// so a paragraph that reaches a place with no renderer still reads as text
// with a formula in it rather than as text with holes; and in no paper's prose
// otherwise, so nothing real is mistaken for a formula.
//
//   inline    ⟦h_{t}⟧            the TeX, between the brackets, in the text
//   display   ⟦#3⟧               a paragraph of its own — the third equation
//                                the document lifted, whose TeX is kept beside
//                                the sections rather than in them
//
// Built from code points, not typed: an escape written into a source file
// through a tool has arrived as the control character it names before now.

export const MATH_OPEN = String.fromCodePoint(0x27e6);
export const MATH_CLOSE = String.fromCodePoint(0x27e7);

/** TeX that will sit inside the text: any close bracket it carries is dropped,
 *  since one would end the formula early. TeX has no use for the character. */
export function inlineMath(latex: string): string {
  const tex = latex.replace(/\s+/g, " ").trim().split(MATH_CLOSE).join("");
  return tex ? `${MATH_OPEN}${tex}${MATH_CLOSE}` : "";
}

/** The paragraph that stands where the k-th lifted equation was. */
export function blockMarker(index: number): string {
  return `${MATH_OPEN}#${index}${MATH_CLOSE}`;
}

/** The index a marker paragraph names, or null for any other paragraph. */
export function parseBlockMarker(paragraph: string): number | null {
  const m = new RegExp(`^${MATH_OPEN}#(\\d+)${MATH_CLOSE}$`).exec(paragraph.trim());
  return m ? Number(m[1]) : null;
}

export type MathRun = { kind: "text"; value: string } | { kind: "math"; value: string };

/** A paragraph as its prose and its formulas, in order. Text with no
 *  brackets comes back as one run, so the common case costs one comparison. */
export function splitMath(text: string): MathRun[] {
  if (!text.includes(MATH_OPEN)) return [{ kind: "text", value: text }];
  const runs: MathRun[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf(MATH_OPEN, at);
    if (open < 0) break;
    const close = text.indexOf(MATH_CLOSE, open + 1);
    if (close < 0) break;
    if (open > at) runs.push({ kind: "text", value: text.slice(at, open) });
    const tex = text.slice(open + 1, close);
    // A display marker inside a line — a block that was never lifted out —
    // reads as nothing rather than as "#3".
    if (!/^#\d+$/.test(tex)) runs.push({ kind: "math", value: tex });
    at = close + 1;
  }
  if (at < text.length) runs.push({ kind: "text", value: text.slice(at) });
  return runs;
}

/** The text with every formula's TeX shown plainly — for a search index, a
 *  word count, a place that cannot draw. */
export function plainMath(text: string): string {
  return splitMath(text)
    .map((run) => run.value)
    .join("");
}
