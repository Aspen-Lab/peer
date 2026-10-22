import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingMap } from "@/lib/papers/reading-map";
import { MAP } from "./copy";
import { ReadingMapView } from "./reading-map";

// P11-23 rule 4 (BACKLOG-104; ruling §1h.126): the map's summary line above the rows ("Read from PDF · 16 sections · 6,042 words · about 34 min", from
// `MAP.summary`) opened its second line with "· about 34 min" at the left pane's default 320 px (and from 313 to 332). Rule 2's treatment, from the other
// side: the line is left-aligned where the rows' meta is right-aligned, so in the pane a separator is drawn in a 2ch slot at the START of the part it
// introduces ("· " before "about"), the box clips 2ch off its left edge (`-ml-[2ch]` on the lines inside it, `overflow-x-clip` on the box), and the first
// part has an empty slot so that it begins at the edge. A part is one nowrap piece, so every line begins with a slot (the first's empty, any other's
// clipped) and a break falls between parts. All of that is for the pane (`.reader-left`, which the one column has no ancestor of): the one column keeps the
// plain string's own breaks and is what it was. The words are `MAP.summary`'s own and `copy.ts` is untouched.
//
// A node test cannot lay a line out. This file pins the structure and simulates the breaks of a monospace line over every pane width from 240 to 480 px;
// the pixels (leading separators per width, before and after; the one column's glyphs) are in the checkpoint.

const source = readFileSync(resolve(process.cwd(), "src/components/reader/reading-map.tsx"), "utf8");
const PANE = "[.reader-left_&]:";

const map: ReadingMap = {
  sections: [
    { id: "s1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 1, words: 1234, minutes: 6, paragraphs: [] },
    { id: "s2", heading: "2 Methods", canonical: "methods", role: "method", page: 3, words: 4808, minutes: 21, paragraphs: [] },
  ],
  totalMinutes: 34,
};
const render = (props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) => renderToStaticMarkup(createElement(ReadingMapView, { map, ...props }));
/** The summary line's markup: from its box to the phone button that follows it. */
const boxOf = (html: string) => {
  const at = html.indexOf("<span data-map-summary");
  expect(at, "the summary line is drawn in a box of its own").toBeGreaterThanOrEqual(0);
  return html.slice(at, html.indexOf("<button", at));
};
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, "");
/** A class attribute as written in the source: the markup escapes the `&` of the pane's variant. */
const unescape = (text: string) => text.replace(/&amp;/g, "&");
const classesOf = (markup: string, pattern: RegExp) => unescape(pattern.exec(markup)?.[1] ?? "").split(/\s+/).filter(Boolean);

/** The line's parts in order: the slot's text, and the part's own text after it. */
// P11-35 (re-aimed, §1c): a part's closing count and its word are one `nowrap` run inside the part (`CountedPart`), so the part's text is read with that run's tags removed.
const partsOf = (markup: string) =>
  [...markup.matchAll(/<span class="[^"]*"><span data-summary-slot="" class="[^"]*">([^<]*)<\/span>((?:[^<]|<span class="whitespace-nowrap">[^<]*<\/span>)*)<\/span>(?= <span class=|<\/span><\/span>)/g)].map((m) => ({ slot: m[1], part: m[2].replace(/<[^>]*>/g, "") }));

const LINES = [
  { html: render({ source: "PDF" }), text: MAP.summary(2, 34, 6042, "PDF") },
  { html: render(), text: MAP.summary(2, 34, 6042) },
  { html: render({ source: "arXiv HTML" }), text: MAP.summary(2, 34, 6042, "arXiv HTML") },
  { html: renderToStaticMarkup(createElement(ReadingMapView, { map: { sections: [map.sections[0]], totalMinutes: 1 }, source: "PDF" })), text: MAP.summary(1, 1, 1234, "PDF") },
];

describe("the map's summary line at a break: a separator never opens a line in the pane (P11-23 rule 4)", () => {
  it("is drawn in a box of its own that stands where the plain span stood: the first child of the summary's flex line, before the phone button", () => {
    for (const { html } of LINES) expect(html).toMatch(/<p class="annotation mt-2 flex items-baseline gap-3 text-text-faint"><span data-map-summary="" class="[^"]*">.*?<\/span><button\b/);
    expect(source).toContain("<SummaryLine text={MAP.summary(rowCount, map.totalMinutes, totalWords, source)} />");
  });

  it("reads, to a screen reader and a copy, as MAP.summary's own string: the same words, separators and single spaces (copy.ts is untouched)", () => {
    for (const { html, text } of LINES) {
      expect(textOf(boxOf(html))).toBe(text);
      expect(textOf(boxOf(html))).not.toMatch(/ {2}|^ | $| /);
    }
    expect(textOf(boxOf(LINES[0].html))).toBe("Read from PDF · 2 sections · 6,042 words · about 34 min");
  });

  it("introduces each part but the first with a slot holding \"· \": the first part's slot is empty", () => {
    for (const { html, text } of LINES) {
      const found = partsOf(boxOf(html));
      const parts = text.split(" · ");

      expect(found.map((piece) => piece.part), text).toEqual(parts);
      expect(found.map((piece) => piece.slot), text).toEqual(["", ...parts.slice(1).map(() => "· ")]);
    }
  });

  it("gives the pane's box what clips exactly the slots' width off its left edge: `overflow-x-clip` on the box, `-ml-[Nch]` inside it, `w-[Nch]` on each slot, N the width of \"· \"", () => {
    const markup = boxOf(LINES[0].html);
    const box = classesOf(markup, /^<span data-map-summary="" class="([^"]*)">/);
    const lines = classesOf(markup, /^<span data-map-summary="" class="[^"]*"><span class="([^"]*)">/);
    const slots = [...markup.matchAll(/<span data-summary-slot="" class="([^"]*)">/g)].map((m) => unescape(m[1]).split(/\s+/));

    expect(box).toContain(`${PANE}overflow-x-clip`);
    // A clip on one axis: `overflow-hidden` would clip the glyphs' tops and bottoms too.
    expect(box.join(" ")).not.toContain("overflow-hidden");
    expect(lines).toContain("block");
    const room = Number(lines.map((c) => new RegExp(`^${PANE.replace(/[[\]]/g, "\\$&")}-ml-\\[(\\d+)ch\\]$`).exec(c)?.[1]).find((n) => n !== undefined));
    expect(room, "the lines stand left of the box by the slot's width").toBe(2);
    expect(slots).toHaveLength(4);
    for (const slot of slots) expect(slot).toEqual(expect.arrayContaining([`${PANE}inline-block`, `${PANE}whitespace-pre`, `${PANE}w-[${room}ch]`]));
    // The slot's text is exactly that wide in a monospace face (`annotation`): the separator and a space.
    expect("· ".length).toBe(room);
  });

  it("makes each part one nowrap piece, the slot in it, so a line always begins with a slot and a break falls between parts", () => {
    const markup = boxOf(LINES[0].html);
    const wrappers = [...markup.matchAll(/<span class="([^"]*)"><span data-summary-slot=/g)].map((m) => unescape(m[1]).split(/\s+/));

    expect(wrappers).toHaveLength(4);
    for (const wrapper of wrappers) expect(wrapper).toEqual([`${PANE}whitespace-nowrap`]);
  });

  // P11-35 (re-aimed, §1c): "changes nothing in the one column" stood for P11-23's rule 4, which left the one column's breaks as they were. P11-35's rule 1 (a count and its
  // word never part, at every place that draws one) changes exactly one thing there: each part's closing count and its word ("34 min", "6,042 words", "2 sections") are a
  // `whitespace-nowrap` run, so a break that fell between them falls before the count. The rest is as it was: every other class that shapes the line is for the pane, so outside
  // it the line is the plain string, its other breaks included, and the pane's own (whole nowrap parts) is the same.
  it("changes the one column in one way only: every class that shapes the line is for the pane, but `block` and one `whitespace-nowrap` run holding each part's closing count and its word", () => {
    for (const { html, text } of LINES) {
      const markup = boxOf(html);
      const classes = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => unescape(m[1]).split(/\s+/)).filter(Boolean);
      const counted = text.split(" · ").map((part) => /\d[\d,]*\s\S+$/.exec(part)?.[0]).filter((run): run is string => run !== undefined);

      expect(counted.length, text).toBe(3);
      expect(classes.filter((c) => !c.startsWith(PANE)), "classes that apply in the one column").toEqual(["block", ...counted.map(() => "whitespace-nowrap")]);
      expect([...markup.matchAll(/<span class="whitespace-nowrap">([^<]*)<\/span>/g)].map((m) => m[1]), text).toEqual(counted);
    }
  });
});

// A simulation of the lines the pane's markup allows, with the face's width as the unit (the line is monospace: a character is 1ch, 7.2 px at the 12-px
// `text-caption`). A part is one nowrap piece (its slot and its words); pieces fill lines of the width the box has plus the 2ch the lines stand left of it; a
// space between two pieces is the only break; the slot that opens a line is the clipped one. The box is the pane's width less its side padding (24).
describe("the summary line's lines in the pane at every width from 240 to 480 px (a model of what the markup allows; the pixels are in the checkpoint)", () => {
  const CH = 7.2;
  /** Greedy fill: a piece (slot and part) goes on the line while it fits the lines' width (the box's and the 2ch of the first part's empty slot). */
  function lines(text: string, boxCh: number): string[][] {
    const out: string[][] = [[]];
    let used = 0;
    for (const [index, part] of text.split(" · ").entries()) {
      const width = 2 + part.length; // the slot's 2ch, the first part's empty one included, then the part
      const line = out[out.length - 1];
      if (line.length > 0 && used + 1 + width > boxCh + 2) {
        out.push([]);
        used = 0;
      }
      const target = out[out.length - 1];
      used += (target.length > 0 ? 1 : 0) + width;
      target.push(index > 0 ? `· ${part}` : part);
    }
    return out;
  }
  /** What shows of a line: the clipped slot of its first piece dropped. */
  const visible = (line: string[]) => line.map((piece, index) => (index === 0 ? piece.replace(/^· /, "") : piece)).join(" ");

  it("never opens a line with a separator, never ends one with one, and says every word once, at every width", () => {
    for (const { text } of LINES) {
      const words = text.split(" ").filter((word) => word !== "·");
      for (let pane = 240; pane <= 480; pane += 1) {
        const shown = lines(text, (pane - 24) / CH).map(visible);

        for (const line of shown) {
          expect(line, `${text} at ${pane}px`).toMatch(/^[^·\s]/);
          expect(line, `${text} at ${pane}px`).toMatch(/[^·\s]$/);
        }
        expect(shown.join(" ").split(" ").filter((word) => word !== "·"), `${text} at ${pane}px`).toEqual(words);
      }
    }
  });

  it("is one line where it fits, and at the default 320 px breaks before the last part with its dot clipped, where it used to open a line with it", () => {
    const text = LINES[0].text;

    expect(lines(text, 80).map(visible)).toEqual([text]);
    expect(lines(text, (320 - 24) / CH).map(visible)).toEqual(["Read from PDF · 2 sections · 6,042 words", "about 34 min"]);
  });
});
