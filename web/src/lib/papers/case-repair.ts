// P12-83 (§1h.463, B P12-80 K2, R2-C): a font whose own map turns capital letters into lowercase ones is read as
// capitals again, from the paper's own evidence.
//
// Some PDFs carry a font whose ToUnicode map is written with wrong entries: the codes of a few capitals (I, L, S, T, U
// in one font B P12-80 read) are mapped to the lowercase letters. pdf.js follows the map, so an acronym comes out of
// its text layer as "sE" for "SE", "lCO" for "LCO", "DFt" for "DFT". MuPDF and pdftotext read the PDF's encoding
// instead and give the capitals; nothing in Peer changes the case, so the damage is already in the items. The
// damaged glyphs sit in items of their own, a letter or two long, touching the capital-led item beside them. That is
// the evidence, and it is the paper's: no word list, no table of fonts.
//
//   Evidence. A run of one or two lowercase letters that touches (no word space between them, same line, same font) a
//   run that begins with a capital — "s" + "E", "l" + "CO", "ss" + "Bs" — or that continues a run ending in two
//   capitals — "DF" + "t" — and does not belong to a lowercase word ("wa" + "s" + "E" is not it). The font and the
//   letters are noted. Units look the same on the page ("p" + "H", "e" + "V", "m" + "M"), so the evidence alone settles
//   nothing:
//   Qualifying. A font is read as damaged when it has at least 3 such hits over at least 2 different letters, and it
//   counts only the letters it never prints as capitals anywhere in the paper: a font that prints a capital P cannot
//   be one whose capital P reads as "p". A font that does not qualify is not touched, whatever its shapes.
//   Repair. In a font that qualifies, the runs of the noted letters in those same shapes read as capitals; and the
//   first letter of a word that stands alone in an item of its own before a touching lowercase item ("l" + "i-": Li-)
//   reads as one, since the damaged glyph is the only reason such an item exists.
//
// Every other item comes back exactly as it came, the same object. Pure, deterministic, no dependency, linear in the
// number of items. It reads items and returns items; the order of the pages and of the items is kept.

import type { PdfPageText, PdfTextItem } from "./pdf-outline";

/** The longest run of letters that is one damaged glyph's item ("ss" in "SS" is two glyphs in one item). */
const MAX_RUN_LETTERS = 2;
/** A font needs at least this many hits… */
export const CASE_MIN_HITS = 3;
/** …over at least this many different letters, to be read as one whose capitals read as lowercase. */
export const CASE_MIN_LETTERS = 2;

/** Two items are on one line when their baselines differ by less than this share of the type size. */
const SAME_LINE_EM = 0.1;
/** The outline puts a space between two runs where the gap is more than this share of the next run's size (and 1 pt):
 *  the same measure, so "touching" here is "joined without a space" there (`lineOf`, `pdf-outline.ts`). */
const SPACE_EM = 0.18;
/** Kerning may draw a glyph over its neighbour's edge; this much overlap (of the type size) is still touching. */
const OVERLAP_EM = 0.25;

const LOWER_RUN = new RegExp(`^[a-z]{1,${MAX_RUN_LETTERS}}$`);
const STARTS_CAPITAL = /^\p{Lu}/u;
const ENDS_TWO_CAPITALS = /\p{Lu}{2}$/u;
const STARTS_LOWER = /^\p{Ll}/u;
const ENDS_LOWER = /\p{Ll}$/u;
const ENDS_WORD_CHARACTER = /[\p{L}\p{N}]$/u;

/** Whether `right` follows `left` on the page with no word space between them, in the same font. */
function touches(left: PdfTextItem, right: PdfTextItem): boolean {
  if (left.fontName !== right.fontName || !(left.width > 0)) return false;
  const size = Math.max(left.height, right.height);
  if (!(size > 0) || Math.abs(left.y - right.y) > SAME_LINE_EM * size) return false;
  const gap = right.x - (left.x + left.width);
  return gap <= Math.max(1, right.height * SPACE_EM) && gap >= -OVERLAP_EM * size;
}

/**
 * The shape the lowercase run at `items[at]` has, if it has one a damaged glyph has:
 * - "capital-follows": it touches a run that begins with a capital, and no lowercase run touches it from the left;
 * - "acronym-leads": it touches a run ending in two capitals on its left, and no lowercase run touches it on its right;
 * - "word-start": one letter, alone in its item, with nothing that ends in a letter touching it on its left, and a run
 *   that begins in lowercase touching it on its right.
 * The first two are the evidence; the third is only repaired, never counted.
 */
type Shape = "capital-follows" | "acronym-leads" | "word-start";

function shapeOf(items: readonly PdfTextItem[], at: number): Shape | null {
  const item = items[at];
  if (!item || !LOWER_RUN.test(item.str)) return null;
  const left = at > 0 ? items[at - 1] : undefined;
  const right = at + 1 < items.length ? items[at + 1] : undefined;
  const before = left && touches(left, item) ? left : null;
  const after = right && touches(item, right) ? right : null;
  if (after && STARTS_CAPITAL.test(after.str) && !(before && ENDS_LOWER.test(before.str))) return "capital-follows";
  if (before && ENDS_TWO_CAPITALS.test(before.str) && !(after && STARTS_LOWER.test(after.str))) return "acronym-leads";
  if (item.str.length === 1 && after && STARTS_LOWER.test(after.str) && !(before && ENDS_WORD_CHARACTER.test(before.str))) {
    return "word-start";
  }
  return null;
}

/**
 * The fonts that print capitals as lowercase letters, and the letters each one does it for, learned from the pages'
 * own items: the hits of every font are collected over the whole paper, the letters the font also prints as capitals
 * are dropped, and the font is kept when the hits that remain are at least `CASE_MIN_HITS` over at least
 * `CASE_MIN_LETTERS` letters. A paper with no hit learns nothing.
 */
export function learnCaseFonts(pages: readonly PdfPageText[]): Map<string, ReadonlySet<string>> {
  const hits = new Map<string, string[]>();
  for (const page of pages) {
    const items = page.items;
    for (let i = 0; i < items.length; i++) {
      const shape = shapeOf(items, i);
      if (shape !== "capital-follows" && shape !== "acronym-leads") continue;
      const item = items[i] as PdfTextItem;
      const runs = hits.get(item.fontName);
      if (runs) runs.push(item.str);
      else hits.set(item.fontName, [item.str]);
    }
  }
  const learned = new Map<string, ReadonlySet<string>>();
  if (hits.size === 0) return learned;

  // The capitals each of those fonts prints, as lower-case letters.
  const printed = new Map<string, Set<string>>();
  for (const font of hits.keys()) printed.set(font, new Set());
  for (const page of pages) {
    for (const item of page.items) {
      const capitals = printed.get(item.fontName);
      if (!capitals) continue;
      for (const ch of item.str) if (ch >= "A" && ch <= "Z") capitals.add(ch.toLowerCase());
    }
  }

  for (const [font, runs] of hits) {
    const capitals = printed.get(font) as Set<string>;
    const counted = runs.filter((run) => [...run].every((letter) => !capitals.has(letter)));
    const letters = new Set(counted.flatMap((run) => [...run]));
    if (counted.length >= CASE_MIN_HITS && letters.size >= CASE_MIN_LETTERS) learned.set(font, letters);
  }
  return learned;
}

/**
 * The pages with the capitals a damaged font read as lowercase read as capitals again (see the head of this file).
 * Only the items of a font that qualifies, of the shapes above and made of that font's noted letters, change; they are
 * new objects with the same geometry and the upper-case text. Every other item, and every page and the array itself
 * where nothing changed, comes back as the same object.
 */
export function withPageCase(pages: PdfPageText[]): PdfPageText[] {
  const learned = learnCaseFonts(pages);
  if (learned.size === 0) return pages;
  let changed = false;
  const out = pages.map((page) => {
    let items: PdfTextItem[] | null = null;
    for (let i = 0; i < page.items.length; i++) {
      const item = page.items[i] as PdfTextItem;
      const letters = learned.get(item.fontName);
      if (!letters || !LOWER_RUN.test(item.str)) continue;
      if (![...item.str].every((letter) => letters.has(letter))) continue;
      if (shapeOf(page.items, i) === null) continue;
      items ??= page.items.slice();
      items[i] = { ...item, str: item.str.toUpperCase() };
    }
    if (items === null) return page;
    changed = true;
    return { ...page, items };
  });
  return changed ? out : pages;
}
