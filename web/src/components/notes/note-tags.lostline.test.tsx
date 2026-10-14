import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnchorHeading, AnchorMarker, HeadingWithLostLine, PASSAGE_LOST_LINE } from "./note-tags";

// P10-39 (rule 1; P10-36's unsettled): the lost-passage line follows the note's heading. P10-36 drew it from the marker as a
// right-aligned absolute span that came before the heading's words in the DOM and sat at the window's edge; now the editor draws it
// after the heading's words, in the heading's row (wrapping under them when the row is narrow), so a screen reader hears the heading
// first, and the marker keeps only the square. Rendered with react-dom/server (no DOM in this project's Vitest). Invented text.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const HEADING = createElement("div", { "data-heading": "" }, "Note 2");
const ANCHOR = { paperId: "p1", paragraphId: "paper-section-0-p1", quote: "finest grains crept fastest", n: 2, start: 4, end: 31 };

describe("HeadingWithLostLine — the heading's words, then the line", () => {
  it("puts the line after the heading's words in the DOM", () => {
    const html = renderToStaticMarkup(createElement(HeadingWithLostLine, { lost: true }, HEADING));
    expect(html).toContain(PASSAGE_LOST_LINE);
    expect(html.indexOf("Note 2")).toBeGreaterThan(-1);
    expect(html.indexOf("Note 2")).toBeLessThan(html.indexOf(PASSAGE_LOST_LINE));
  });

  it("wraps under the heading at a narrow width (a wrapping row, not an absolute span at the edge)", () => {
    const html = renderToStaticMarkup(createElement(HeadingWithLostLine, { lost: true }, HEADING));
    expect(html).toContain("flex-wrap");
    expect(html).not.toContain("absolute");
  });

  it("draws no line, and no wrapper, for a note whose passage the paper holds", () => {
    const html = renderToStaticMarkup(createElement(HeadingWithLostLine, { lost: false }, HEADING));
    expect(html).not.toContain(PASSAGE_LOST_LINE);
    expect(html).toBe(renderToStaticMarkup(HEADING));
  });
});

describe("AnchorMarker — only the square", () => {
  it("carries no line, lost or not", () => {
    for (const lost of [true, false]) {
      expect(renderToStaticMarkup(createElement(AnchorMarker, { lost, n: 2, onGo: () => {} }))).not.toContain(PASSAGE_LOST_LINE);
    }
    expect(renderToStaticMarkup(createElement(AnchorMarker, { lost: true, n: 2, onGo: () => {}, onOpen: () => {} }))).not.toContain(PASSAGE_LOST_LINE);
  });
});

describe("AnchorHeading — the wiring", () => {
  it("shows the heading alone while the passage is not known lost (the first render, and the server's)", () => {
    const html = renderToStaticMarkup(createElement(AnchorHeading, { anchor: ANCHOR }, HEADING));
    expect(html).toBe(renderToStaticMarkup(HEADING));
  });

  it("is what the note editor wraps an anchored heading's words in", () => {
    const editor = read("src/components/notes/note-editor.tsx");
    expect(editor).toMatch(/<AnchorHeading anchor=\{b\.anchor\}>\s*\{content\}\s*<\/AnchorHeading>/);
    expect(editor).not.toContain("PASSAGE_LOST_LINE");
  });
});
