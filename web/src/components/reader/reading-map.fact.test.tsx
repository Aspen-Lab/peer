import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingMap, RouteResult } from "@/lib/papers/reading-map";
import { ROUTE } from "./copy";
import { ReadingMapView } from "./reading-map";

// P11-35 (round 2, Theme A reader r1's extra 4; §1h.133): in the left pane's map a row's fact line broke between a term and its count — at 1440 x 900,
// "1. INTRODUCTION" read "relevant · mentions growing ×6, LCO" with "×6, parameter ×4" on the next line. The rule: a term and its count never part. In every
// fact line, at every pane width from 240 to 480 px, the last word of a term and its "×n" stay on one line; the line still breaks after a comma and inside a
// long multi-word term; a term longer than the line still wraps and nothing runs past the pane — and when a term fits a line alone but not with its count, the
// count follows the term's last letters rather than standing alone. What leaves the page stays plain: the words are drawn in spans that cannot break between the
// word and its count, and the text is the string `ROUTE.mentions` always was, with plain spaces.
//
// A node test cannot lay a line out. This file pins the structure that does it, and simulates the lines of a monospace face (the fact line is `annotation`: a
// character is 7.2 px at the 12-px `text-caption`, as `reading-map.meta.test.tsx` has it) at every pane width from 240 to 480 px, every row, every level; the
// pixels (fact lines whose "term ×n" parts, per pane width and window, before and after) are in the checkpoint.

const map: ReadingMap = {
  sections: [
    { id: "f1", heading: "1. INTRODUCTION", canonical: "introduction", role: "setup", page: 1, words: 1041, minutes: 6, paragraphs: [] },
    { id: "f2", heading: "2.1 Twinned Interfaces", canonical: "results", role: "evidence", page: 3, words: 1853, minutes: 11, level: 2, paragraphs: [] },
    { id: "f3", heading: "2.2 Morphogenesis", canonical: "results", role: "evidence", page: 6, words: 1211, minutes: 7, level: 3, paragraphs: [] },
    { id: "f4", heading: "3. EXPERIMENTAL", canonical: "methods", role: "method", page: 9, words: 600, minutes: 4, paragraphs: [] },
    { id: "f5", heading: "4. CONCLUSIONS", canonical: "conclusion", role: "interpretation", page: 11, words: 90, minutes: 1, paragraphs: [] },
  ],
  totalMinutes: 29,
};

const LONG = "dichlorodiphenyltrichloroethane";
const HITS: Record<string, { term: string; count: number }[]> = {
  // The owner's row: three short terms, and a fourth the line does not state.
  f1: [{ term: "growing", count: 6 }, { term: "LCO", count: 6 }, { term: "parameter", count: 4 }, { term: "left out", count: 1 }],
  // A term longer than the narrowest line, then a short one.
  f2: [{ term: LONG, count: 14 }, { term: "lattice", count: 3 }],
  // Multi-word terms: the break may fall inside the term, never between its last word and the count.
  f3: [{ term: "crack growth", count: 12 }, { term: "twinned lattice interface", count: 3 }, { term: "film", count: 2 }],
  f4: [{ term: "film", count: 2 }],
  // A term of 23 letters: it fits the narrowest line (27 characters) alone, and not with " ×12,".
  f5: [{ term: "polytetrafluoroethylene", count: 12 }, { term: "film", count: 2 }],
};
const TIERS = { f1: "medium", f2: "strong", f3: "background", f4: "faint", f5: "medium" } as const;
const route = {
  byQuestion: [
    {
      question: "How does crack growth change the lattice parameter?",
      vague: false,
      sections: Object.fromEntries(
        Object.entries(HITS).map(([id, hits]) => [id, { tier: TIERS[id as keyof typeof TIERS], hits, paragraphs: [] }]),
      ),
    },
  ],
  vague: false,
} as unknown as RouteResult;

const html = renderToStaticMarkup(createElement(ReadingMapView, { map, route }));

/** A row's fact line: the `<p>` after the row's heading, as `[opening tag, inner markup]`. */
const factOf = (heading: string): { open: string; inner: string } => {
  const at = html.indexOf(`>${heading}</a>`);
  const from = html.indexOf('<p class="annotation pl-5', at);
  const close = html.indexOf("</p>", from);
  const open = html.slice(from, html.indexOf(">", from) + 1);
  return { open, inner: html.slice(from + open.length, close) };
};
const decode = (text: string) => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (markup: string) => decode(markup.replace(/<[^>]*>/g, ""));
const classesOf = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);

/** What the fact line says, as `MAP`'s rows have always said it. */
const SAID: Record<string, string> = {
  f1: `${ROUTE.tiers.medium} · ${ROUTE.mentions(HITS.f1)}`,
  f2: `${ROUTE.tiers.strong} · ${ROUTE.mentions(HITS.f2)}`,
  f3: `${ROUTE.tiers.background} · ${ROUTE.mentions(HITS.f3)}`,
  f4: ROUTE.mentions(HITS.f4),
  f5: `${ROUTE.tiers.medium} · ${ROUTE.mentions(HITS.f5)}`,
};
const ROWS = map.sections.map((row) => ({ id: row.id, heading: row.heading, level: row.level ?? 1 }));

// ── The line breaker's view of the markup ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Word {
  text: string;
  /** Where the word starts in the line's flat text. */
  at: number;
  /** The word may be broken between its characters when it is longer than the line (`overflow-wrap: anywhere` or `break-word`, and no `nowrap`). */
  wraps: boolean;
  /** Per character: inside a `whitespace-nowrap` piece, where no line breaks. */
  locked: boolean[];
}
const wrapsClass = (c: string) => c === "wrap-anywhere" || c === "break-words" || c === "[overflow-wrap:anywhere]";
/** The unbreakable runs a browser would see: an atomic inline (`inline-block`) or a `whitespace-nowrap` span is one word, and a plain space outside them is a break. */
function wordsOf(open: string, inner: string): { flat: string; words: Word[] } {
  const rootWraps = classesOf(open).some(wrapsClass);
  const stack: { atomic: boolean; wraps: boolean; nowrap: boolean }[] = [];
  const words: Word[] = [];
  let flat = "";
  let current: Word | null = null;
  for (const m of inner.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/g)) {
    if (m[2] !== undefined) {
      if (m[1] === "/") stack.pop();
      else {
        const classes = classesOf(m[3]);
        stack.push({ atomic: classes.includes("inline-block") || classes.includes("whitespace-nowrap"), wraps: classes.some(wrapsClass), nowrap: classes.includes("whitespace-nowrap") });
      }
      continue;
    }
    const insideAtom = stack.some((s) => s.atomic);
    const nowrap = stack.some((s) => s.nowrap);
    // A word may be broken between its characters when it is not a `nowrap` run as a whole (its outermost atom is no `nowrap`) and an element on it or the line asks for it.
    const outer = stack.find((s) => s.atomic);
    const wraps = (outer === undefined || !outer.nowrap) && (rootWraps || stack.some((s) => s.wraps));
    for (const ch of decode(m[4])) {
      const at = flat.length;
      flat += ch;
      if (ch === " " && !insideAtom) {
        current = null;
        continue;
      }
      if (current === null) {
        current = { text: "", at, wraps, locked: [] };
        words.push(current);
      }
      current.text += ch;
      current.locked.push(nowrap);
    }
  }
  return { flat, words };
}

/**
 * Greedy lines of a monospace face `width` characters wide: the line index of every non-space character of the flat text, the words that ran past the line, the
 * lines' text. A word that fits goes whole to the line where it fits, after a plain space or at the next line's start. A word longer than the line starts a line and
 * breaks between its characters (when it may: `wraps`), except inside its `nowrap` pieces, which move whole to the next line when they do not fit the rest of this one.
 */
function lay(words: Word[], width: number): { lineOf: Map<number, number>; overflow: string[]; lines: string[] } {
  const lineOf = new Map<number, number>();
  const overflow: string[] = [];
  const lines: string[] = [""];
  let line = 0;
  let col = 0;
  const newLine = () => {
    line += 1;
    lines[line] = "";
    col = 0;
  };
  for (const word of words) {
    if (col > 0 && col + 1 + word.text.length <= width) {
      lines[line] += " ";
      col += 1;
    } else if (col > 0) newLine();
    if (word.text.length > width && !word.wraps) overflow.push(word.text);
    // The segments a line may not split: a run of locked characters, or one free character.
    for (let i = 0; i < word.text.length; ) {
      let j = i + 1;
      if (word.locked[i]) while (j < word.text.length && word.locked[j]) j += 1;
      // A `nowrap` piece longer than the line has no way to wrap: it runs past the pane.
      if (word.wraps && word.locked[i] && j - i > width) overflow.push(word.text.slice(i, j));
      if (word.wraps && word.text.length > width && col > 0 && col + (j - i) > width) newLine();
      for (; i < j; i += 1) {
        lineOf.set(word.at + i, line);
        lines[line] += word.text[i];
        col += 1;
      }
    }
  }
  return { lineOf, overflow, lines };
}

describe("a map term and its count never part (P11-35)", () => {
  it("says what it always said: the string of `ROUTE.mentions` with its plain spaces, and the tier before it", () => {
    expect(ROUTE.mentions(HITS.f1)).toBe("mentions growing ×6, LCO ×6, parameter ×4");
    for (const row of ROWS) {
      const said = textOf(factOf(row.heading).inner);

      expect(said, row.heading).toBe(SAID[row.id]);
      // Nothing but the plain space joins a word to its count: no no-break space, no narrow one, no joiner, no zero-width space.
      expect(said, row.heading).not.toMatch(/[\u00a0\u202f\u2007\u2060\u200b\u200c\u200d\ufeff]/);
      expect(ROUTE.mentions(HITS[row.id])).not.toMatch(/[\u00a0\u202f\u2007\u2060\u200b\u200c\u200d\ufeff]/);
    }
    expect(textOf(factOf("1. INTRODUCTION").inner)).toBe("relevant · mentions growing ×6, LCO ×6, parameter ×4");
    expect(textOf(factOf("3. EXPERIMENTAL").inner)).toBe("mentions film ×2");
  });

  it("draws the last word of every stated term and its count in one unbreakable unit, the comma after the count inside it", () => {
    for (const row of ROWS) {
      const { open, inner } = factOf(row.heading);
      const { words } = wordsOf(open, inner);
      const stated = HITS[row.id].slice(0, 3);
      const units = words.filter((word) => / ×\d+,?$/.test(word.text));

      expect(units, row.heading).toHaveLength(stated.length);
      stated.forEach((hit, index) => {
        const last = hit.term.split(" ").pop();
        expect(units[index].text, `${row.heading}: ${hit.term}`).toBe(`${last} ×${hit.count}${index < stated.length - 1 ? "," : ""}`);
      });
    }
    // The fourth term of the first row is not stated, as before.
    expect(textOf(factOf("1. INTRODUCTION").inner)).not.toContain("left out");
  });

  it("leaves the words of a multi-word term before its last word to the line: a break may fall inside the term", () => {
    const { open, inner } = factOf("2.2 Morphogenesis");
    const { words } = wordsOf(open, inner);

    expect(words.map((word) => word.text)).toEqual([
      "background", "·", "mentions", "crack", "growth ×12,", "twinned", "lattice", "interface ×3,", "film ×2",
    ]);
  });

  it("keeps the break after a comma: the next term's first word is its own word, so the line may end after the comma", () => {
    for (const row of ROWS.slice(0, 3)) {
      const { open, inner } = factOf(row.heading);
      const { flat, words } = wordsOf(open, inner);
      const commas = [...flat.matchAll(/, /g)];

      expect(commas.length, row.heading).toBe(HITS[row.id].slice(0, 3).length - 1);
      for (const comma of commas) {
        // The comma closes a word and the space after it is a break: a word ends at the comma and the next one starts after the space.
        expect(words.some((word) => word.at + word.text.length - 1 === comma.index), `${row.heading}: a word ends at the comma`).toBe(true);
        expect(words.some((word) => word.at === (comma.index ?? 0) + 2), `${row.heading}: a word starts after the space`).toBe(true);
      }
    }
  });

  it("never breaks the fact line as a whole: the line itself is not `nowrap` and not `pre`", () => {
    for (const row of ROWS) {
      const classes = classesOf(factOf(row.heading).open);

      expect(classes, row.heading).not.toContain("whitespace-nowrap");
      expect(classes, row.heading).not.toContain("whitespace-pre");
    }
  });

  // The model of what the markup allows, at every pane width from 240 to 480 px, every row, at its level.
  describe("the lines, at every pane width from 240 to 480 px (a model of what the markup allows; the pixels are in the checkpoint)", () => {
    const CH = 7.2;
    /** The characters of a fact line: the pane less its side padding (24), the row's indent (12 a level less the first) and the line's own 20. */
    const widthCh = (pane: number, level: number) => Math.floor((pane - 24 - (level - 1) * 12 - 20) / CH);

    it("never puts a count on a line other than the line of its term's last word, and never splits the count: at every width, including where the word fits a line alone and the word with its count does not", () => {
      for (const row of ROWS) {
        const { open, inner } = factOf(row.heading);
        const { flat, words } = wordsOf(open, inner);
        for (let pane = 240; pane <= 480; pane += 1) {
          const { lineOf } = lay(words, widthCh(pane, row.level));
          for (const m of flat.matchAll(/(\S+) ×(\d+)/g)) {
            const end = (m.index ?? 0) + m[1].length - 1;
            const times = end + 2;
            expect(lineOf.get(end), `${row.heading} at ${pane}px: "${m[0]}" parts`).toBe(lineOf.get(times));
            expect(lineOf.get(times + m[2].length), `${row.heading} at ${pane}px: "${m[0]}" splits its count`).toBe(lineOf.get(times));
          }
        }
      }
    });

    it("runs nothing past the line: a term longer than the line wraps", () => {
      for (const row of ROWS) {
        const { open, inner } = factOf(row.heading);
        const { words } = wordsOf(open, inner);
        for (let pane = 240; pane <= 480; pane += 1) {
          expect(lay(words, widthCh(pane, row.level)).overflow, `${row.heading} at ${pane}px`).toEqual([]);
        }
      }
      // The narrowest line (240 px, level 2: 23 characters) is shorter than the long term alone (31), and wraps.
      expect(widthCh(240, 2)).toBeLessThan(LONG.length);
    });

    it("still breaks the line where it must: at the narrowest pane a fact line takes more than one line", () => {
      const { open, inner } = factOf("1. INTRODUCTION");
      const { lines } = lay(wordsOf(open, inner).words, widthCh(240, 1));

      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(widthCh(240, 1));
    });
  });

  // The unit: `<span data-mention-unit class="inline-block max-w-full">` the word's free letters, then `<span class="whitespace-nowrap">` its last three letters, the space, the count and the comma.
  const unitsOf = (inner: string) => [...inner.matchAll(/<span data-mention-unit=""([^>]*)>([^<]*)<span([^>]*)>([^<]*)<\/span><\/span>/g)].map((m) => ({ outer: classesOf(m[1]), free: m[2], inner: classesOf(m[3]), piece: m[4] }));

  it("keeps the count with the last letters of the term: the last three letters, the space, the count and the comma are one `nowrap` piece, the letters before them free", () => {
    for (const row of ROWS) {
      const { inner } = factOf(row.heading);
      const stated = HITS[row.id].slice(0, 3);
      const units = unitsOf(inner);

      expect(units.length, row.heading).toBe(stated.length);
      stated.forEach((hit, index) => {
        const word = hit.term.split(" ").pop() ?? "";
        const comma = index < stated.length - 1 ? "," : "";
        expect(units[index].free, `${row.heading}: ${hit.term}`).toBe(word.slice(0, -3));
        expect(units[index].piece, `${row.heading}: ${hit.term}`).toBe(`${word.slice(-3)} ×${hit.count}${comma}`);
        expect(units[index].inner, `${row.heading}: ${hit.term}`).toContain("whitespace-nowrap");
      });
    }
  });

  it("clamps a unit wider than the line to it and lets it wrap inside: `inline-block max-w-full` and `wrap-anywhere` (on it or the line), the unit itself never `whitespace-nowrap`", () => {
    for (const row of ROWS) {
      const { open, inner } = factOf(row.heading);
      const units = unitsOf(inner);

      expect(units.length, row.heading).toBe(HITS[row.id].slice(0, 3).length);
      for (const unit of units) {
        expect(unit.outer, `${row.heading}: ${unit.piece}`).toEqual(expect.arrayContaining(["inline-block", "max-w-full"]));
        expect(unit.outer, `${row.heading}: ${unit.piece}`).not.toContain("whitespace-nowrap");
        expect([...unit.outer, ...classesOf(open)].some(wrapsClass), `${row.heading}: ${unit.piece}`).toBe(true);
      }
    }
  });
});

// Rule 1's last bullet: every other place in the map that draws a count beside a word. The rows' meta ("1,041 words", "6 min") is whole nowrap parts (P11-23, pinned in
// `reading-map.meta.test.tsx`); the summary line is whole parts in the pane (P11-23 rule 4) and, in the one column, drew "about 24" / "min" at some widths until
// `CountedPart`; the questions' line ("Q1, Q3", `ROUTE.questions`) is only ever the row's `title` (a tooltip) and is not drawn in the page's lines.
describe("every other place the map draws a count beside a word (P11-35 rule 1)", () => {
  const summaryHtml = renderToStaticMarkup(createElement(ReadingMapView, { map, source: "PDF" }));
  const box = summaryHtml.slice(summaryHtml.indexOf("<span data-map-summary"), summaryHtml.indexOf("<button", summaryHtml.indexOf("<span data-map-summary")));

  it("the summary line, in the one column: a count never parts from its word, at any line width from 20 to 80 characters", () => {
    // The pane's classes are gated by `.reader-left` and do not apply here: `classesOf` keeps them as written, so only the ungated classes make a run unbreakable.
    const { flat, words } = wordsOf("", box);

    expect(flat).toBe(`Read from PDF · 5 sections · 4,795 words · about 29 min`);
    for (let width = 20; width <= 80; width += 1) {
      const { lineOf } = lay(words, width);
      for (const m of flat.matchAll(/(\d[\d,]*) (sections?|words?|min)\b/g)) {
        const last = (m.index ?? 0) + m[1].length - 1;
        const word = (m.index ?? 0) + m[1].length + 1;
        expect(lineOf.get(last), `at ${width} characters: "${m[0]}" parts`).toBe(lineOf.get(word));
      }
    }
  });

  it("the questions' line is no line of the page: \"Q1, Q3\" is the row's `title`, a tooltip, and no text of the map", () => {
    expect(html).toContain('title="Q1"');
    expect(textOf(html)).not.toMatch(/\bQ\d/);
  });
});

// Rule 2: what leaves the page stays plain. `ROUTE.mentions`' string reaches the screen and nothing else: the one caller outside the tests is the map's fact line
// (`reading-map.tsx`), whose markup keeps every space plain. No export (the Markdown of the reading), notes' copy, feed or JSON carries it.
describe("what leaves the page stays plain (P11-35 rule 2)", () => {
  const SRC = resolve(process.cwd(), "src");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  /** The code of a file, its comments taken out (a comment may name `ROUTE.mentions`). */
  const codeOf = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const sources = walk(SRC).map((path) => ({ path: relative(SRC, path), text: codeOf(readFileSync(path, "utf8")) }));

  it("is read by the map's fact line alone: no other source file (an export, a feed, a route, a store) uses the route's mention strings", () => {
    const callers = sources.filter(({ text }) => /ROUTE\.mention\w*/.test(text)).map(({ path }) => path);

    expect(callers).toEqual(["components/reader/reading-map.tsx"]);
  });

  it("puts no no-break space or joiner into the line's code: the fact line's own source has none", () => {
    const source = sources.find(({ path }) => path === "components/reader/reading-map.tsx")?.text ?? "";

    expect(source).not.toMatch(/\\u(00a0|2060|202f|200b)|[\u00a0\u2060\u202f\u200b]/i);
  });
});
