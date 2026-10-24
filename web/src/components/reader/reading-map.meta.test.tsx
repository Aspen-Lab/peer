import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingMap } from "@/lib/papers/reading-map";
import { ReadingMapView } from "./reading-map";

// P11-23 rule 2 (A P11-21 X-A2; ruling §1h.120): in the left pane the "words · minutes" meta of a map row broke over two lines and the second
// line opened with "· 11 min" — 3 of 14 rows at the default 320-px pane, all 14 at 280 (the first visit's width at 1024) and at 240. The meta
// is laid out so that a break never leaves a separator at a line's start: the separator belongs to the part BEFORE it ("setup ·", "p.1 ·") and
// the one that would end a line is dropped, which is what a right-aligned line's clip does to the slot that carries it. The box clips 2ch off its
// right edge (`-mr-[2ch]` on the lines inside it, `overflow-x-clip` on the box); every part but the last has a 2ch slot holding " ·" after it, and the
// last has an empty one, so a line's last part always ends exactly at the clip and nothing but a slot is ever cut. The meta is monospace
// (`annotation`), so " ·" is exactly 2ch. A line breaks in one place at most: between "role · page" and "words · minutes", so a narrow pane gets
// those two lines and not "6 min" alone.
//
// A node test cannot lay a line out. This file pins the structure that does it and simulates the breaks of a monospace line at every pane width
// from 240 to 480 px; the pixels (rows broken / rows with a leading separator, per width, on two invented papers) are in the checkpoint.

const source = readFileSync(resolve(process.cwd(), "src/components/reader/reading-map.tsx"), "utf8");

const map: ReadingMap = {
  sections: [
    { id: "m1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 1, words: 1234, minutes: 6, paragraphs: [] },
    { id: "m2", heading: "2.1 Samples", canonical: "methods", role: "method", page: 12, words: 1, minutes: 1, paragraphs: [] },
    { id: "m3", heading: "Problem Statement", canonical: "body", role: "body", words: 90, minutes: 1, paragraphs: [] },
    { id: "m4", heading: "Appendix", canonical: "body", role: "body", words: 0, minutes: 0, paragraphs: [] },
    { id: "m5", heading: "3 Results", canonical: "results", role: "evidence", page: 4, words: 12345, minutes: 54, paragraphs: [] },
    { id: "m6", heading: "4 Discussion", canonical: "discussion", role: "interpretation", page: 123, words: 99999, minutes: 434, paragraphs: [] },
  ],
  totalMinutes: 500,
};
const html = renderToStaticMarkup(createElement(ReadingMapView, { map }));
const headings = map.sections.map((row) => row.heading);

/** The meta of a row: the markup from the heading link's end to the closing tag of the heading-and-meta group. */
const metaMarkup = (heading: string) => {
  const at = html.indexOf(`>${heading}</a>`);
  const after = html.indexOf("</a>", at) + "</a>".length;
  return html.slice(after, html.indexOf("</div>", after));
};
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, "");
const classesOf = (markup: string, pattern: RegExp) => (pattern.exec(markup)?.[1] ?? "").split(/\s+/).filter(Boolean);

interface Run {
  name: string;
  classes: string[];
  parts: { name: string; text: string }[];
  slots: string[];
  /** The plain spaces inside the run. */
  spaces: number;
}
/** The row's meta as its runs, and the plain spaces standing between two runs. */
function parse(heading: string): { runs: Run[]; between: number } {
  const runs: Run[] = [];
  let between = 0;
  let open: Run | null = null;
  const token = /<span data-meta-run="([a-z]+)"(?: class="([^"]*)")?>|<span data-meta-part="([a-z]+)"[^>]*>([^<]*)<\/span>|<span data-meta-slot=""[^>]*>([^<]*)<\/span>|(<\/span>)|<[^>]*>| /g;
  for (const m of metaMarkup(heading).matchAll(token)) {
    if (m[1] !== undefined) {
      open = { name: m[1], classes: (m[2] ?? "").split(/\s+/).filter(Boolean), parts: [], slots: [], spaces: 0 };
      runs.push(open);
    } else if (m[3] !== undefined) open?.parts.push({ name: m[3], text: m[4] });
    else if (m[5] !== undefined) open?.slots.push(m[5]);
    else if (m[6] !== undefined) open = null;
    else if (m[0] !== " ") continue;
    else if (open) open.spaces += 1;
    else between += 1;
  }
  return { runs, between };
}

describe("the map's meta at a break: the separator belongs to the part before it (P11-23 rule 2)", () => {
  it("draws no separator in front of any part: the old `· ${text}` is gone, and no part's text opens or ends with one", () => {
    expect(source).not.toMatch(/`·\s*\$\{/);
    for (const heading of headings) {
      for (const run of parse(heading).runs) for (const part of run.parts) expect(part.text, `${heading}: ${part.text}`).not.toMatch(/^[·\s]|[·\s]$/);
    }
  });

  it("reads as it always did, to a screen reader and a copy: the same words, separators and single spaces", () => {
    expect(textOf(metaMarkup("1 Introduction"))).toBe("setup · p.1 · 1,234 words · 6 min");
    expect(textOf(metaMarkup("2.1 Samples"))).toBe("method · p.12 · 1 word · 1 min");
    expect(textOf(metaMarkup("Problem Statement"))).toBe("90 words · 1 min");
    expect(textOf(metaMarkup("Appendix"))).toBe("0 words");
    expect(textOf(metaMarkup("3 Results"))).toBe("evidence · p.4 · 12,345 words · 54 min");
    for (const heading of headings) expect(textOf(metaMarkup(heading)), heading).not.toMatch(/ {2}|^ | $| /);
  });

  it("gives every part a slot after it: \" ·\" for each but the last part of the row, whose slot is empty", () => {
    for (const heading of headings) {
      const { runs } = parse(heading);
      const parts = runs.flatMap((run) => run.parts);
      const slots = runs.flatMap((run) => run.slots);

      expect(slots, heading).toHaveLength(parts.length);
      expect(slots, heading).toEqual([...parts.slice(1).map(() => " ·"), ""]);
      // The slot stands after its part: in a run, the part and then its slot, so a run ends with a slot.
      for (const run of runs) expect(run.slots, heading).toHaveLength(run.parts.length);
    }
  });

  it("gives the meta a box that clips exactly the room the slots hold: `overflow-x-clip` on the box, `-mr-[Nch]` inside it, `w-[Nch]` on each slot, N the width of \" ·\"", () => {
    const markup = metaMarkup("1 Introduction");
    const box = classesOf(markup, /^<span class="([^"]*)">/);
    const lines = classesOf(markup, /^<span class="[^"]*"><span class="([^"]*)">/);
    const slots = [...markup.matchAll(/<span data-meta-slot="" class="([^"]*)">/g)].map((m) => m[1].split(/\s+/));

    expect(box).toEqual(expect.arrayContaining(["annotation", "overflow-x-clip", "ml-auto", "text-right", "min-w-0", "max-w-full"]));
    // A clip on one axis: `overflow-hidden` would clip the glyphs' tops and bottoms too.
    expect(box).not.toContain("overflow-hidden");
    expect(lines).toContain("block");
    const room = Number(lines.map((c) => /^-mr-\[(\d+)ch\]$/.exec(c)?.[1]).find((n) => n !== undefined));
    expect(room, "the lines stand wider than the box by the slot's width").toBe(2);
    expect(slots).toHaveLength(4);
    for (const slot of slots) expect(slot).toEqual(expect.arrayContaining(["inline-block", "whitespace-pre", `w-[${room}ch]`]));
    // The slot's text is exactly that wide in a monospace face: a space and the separator.
    expect(" ·".length).toBe(room);
  });

  it("allows a break in one place only: the plain space between the two runs; every other space is inside a whitespace-nowrap run", () => {
    for (const heading of headings) {
      const { runs, between } = parse(heading);

      expect(runs.length, heading).toBeGreaterThanOrEqual(1);
      expect(runs.length, heading).toBeLessThanOrEqual(2);
      expect(between, heading).toBe(runs.length - 1);
      for (const run of runs) {
        expect(run.classes, `${heading} ${run.name}`).toContain("whitespace-nowrap");
        expect(run.spaces, `${heading} ${run.name}`).toBe(run.parts.length - 1);
      }
    }
    expect(parse("1 Introduction").runs.map((run) => [run.name, run.parts.map((part) => part.name)])).toEqual([["place", ["role", "page"]], ["size", ["words", "minutes"]]]);
    expect(parse("Problem Statement").runs.map((run) => run.name)).toEqual(["size"]);
    expect(parse("Appendix").runs.map((run) => run.parts.map((part) => part.name))).toEqual([["words"]]);
  });
});

// A simulation of the lines the markup allows, with the face's width as the unit (the meta is monospace: a character is 1ch, 7.2 px at the 12-px
// `text-caption`). A line is both runs, joined by their separator, when they fit the box, else one run per line, and the slot that ends a line is
// clipped. The box is as wide as the heading group less nothing: the pane's width, less its side padding (24), the fold toggle and its gap (20) and
// the row's indent (12 a level, 24 at most).
describe("the meta's lines at every pane width from 240 to 480 px, every row (a model of what the markup allows; the pixels are in the checkpoint)", () => {
  const CH = 7.2;
  /** A run's visible text: its parts and the separators between them, without the slot that ends it. */
  const visible = (run: Run) => run.parts.map((part) => part.text).join(" · ");

  it("never opens a line with a separator and never ends one with a separator, and says the whole meta, for every row at every width and level", () => {
    for (const heading of headings) {
      const runs = parse(heading).runs.map(visible);
      const full = textOf(metaMarkup(heading));
      for (let pane = 240; pane <= 480; pane += 1) {
        for (const level of [1, 2, 3]) {
          const boxCh = (pane - 24 - 20 - Math.min((level - 1) * 12, 24)) / CH;
          const joined = runs.join(" · ");
          const lines = joined.length <= boxCh ? [joined] : runs;
          for (const line of lines) expect(line, `${heading} at ${pane}px, level ${level}`).toMatch(/^[^·\s].*[^·\s]$|^[^·\s]$/);
          expect(lines.join(" · "), `${heading} at ${pane}px`).toBe(full);
        }
      }
    }
  });

  it("breaks into the two runs, not into a part and an orphan; and the widest run fits the narrowest pane's text column", () => {
    expect(parse("3 Results").runs.map(visible)).toEqual(["evidence · p.4", "12,345 words · 54 min"]);
    expect(parse("1 Introduction").runs.map(visible)).toEqual(["setup · p.1", "1,234 words · 6 min"]);
    expect(parse("Problem Statement").runs.map(visible)).toEqual(["90 words · 1 min"]);
    // The widest run of the widest row ("interpretation · p.123", "99999 words · 434 min") in the 240-px pane's 172-px column at level 3.
    const widest = Math.max(...headings.flatMap((heading) => parse(heading).runs.map((run) => visible(run).length)));
    expect(widest).toBeLessThanOrEqual((240 - 24 - 20 - 24) / CH);
  });
});
