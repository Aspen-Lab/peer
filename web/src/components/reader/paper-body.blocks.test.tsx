import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import { captionText } from "@/lib/notes/anchor-blocks";
import type { Paper } from "@/types";
import {
  ANCHOR_BLOCK_ATTRIBUTE,
  ANCHOR_BLOCK_TEXT_SELECTOR,
  PaperBody,
  paragraphAnchor,
  readSelection,
  sameSelection,
  selectionTarget,
  type SelectionLike,
} from "./paper-body";

// P11-27 rule 2 (owner items 5 and 8; round 1's walk X-4; ruling §1h.122): a selection in a figure's caption or in a section's heading is offered
// Take notes and Highlight, so each of them has an anchor of its own — an id in the shape of a paragraph's (`paper-section-<k>-p<n>`, where n counts the
// section's paragraphs, then its heading, then its captions), a marker (`data-anchor-block`) the selection reader finds, the marks and the tag a note
// is drawn with, and a highlight's colour. A selection across two blocks is still nothing. The paper's words are never changed: the markup of a heading
// and a figure with no note is what it was, but for the id and the marker. Every text is invented.

const paper: Paper = {
  id: "p1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [
    { ordinal: 1, label: "Figure 1", caption: "Creep against density in the invented survey.", page: 1, width: 1400, height: 900 },
    { ordinal: 2, label: "Figure 2", caption: "A sketch of the specimen, drawn by hand." },
  ],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "Not in the body.", page: 1 },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Figure 1 shows the rate.\n\nFigure 2 shows the specimen.\n\nGrain boundaries carry the strain.", page: 1 },
    { id: "s2", heading: "2 Methods of the tidal survey", canonical: "methods", text: "The team walked the shore at dawn.", page: 2 },
  ],
};
const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } };
const reading = buildReading(paper, fullText, new Date("2026-10-20T00:00:00.000Z"));
const S0 = reading.body[0];
const P = S0.paragraphs.length;
const HEADING_ID = paragraphAnchor(0, P);
const CAPTION_ID = (k: number) => paragraphAnchor(0, P + 1 + k);
const FIG1 = captionText(S0.figures![0]);
const FIG2 = captionText(S0.figures![1]);

const spot = (id: string, n: number, text: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({ id, n, start, end, quote: text.slice(start, end), ...extra });
const render = (noteAnchors?: Record<string, unknown[]>) => renderToStaticMarkup(createElement(PaperBody, { reading, ...(noteAnchors ? { noteAnchors: noteAnchors as never } : {}) }));
const slice = (html: string, open: RegExp, close: string) => {
  const from = html.search(open);
  return from < 0 ? "" : html.slice(from, html.indexOf(close, from) + close.length);
};
const headingHtml = (html: string, k = 0) => slice(html, new RegExp(`<h3 [^>]*id="${paragraphAnchor(k, reading.body[k].paragraphs.length)}"`), "</h3>");
const captionHtml = (html: string, k: number) => slice(html, new RegExp(`<figure [^>]*id="${CAPTION_ID(k)}"`), "</figure>");
const figcaption = (html: string, k: number) => slice(captionHtml(html, k), /<figcaption/, "</figcaption>");
const TAG = (n: number) => `<sup[^>]*>⁠<button[^>]*aria-label="Open note ${n}"[^>]*>\\[${n}\\]</button></sup>`;

it("the reading under test is the one the cases below describe", () => {
  expect(reading.body.map((s) => s.heading)).toEqual(["1 Introduction", "2 Methods of the tidal survey"]);
  expect(P).toBe(3);
  expect(S0.figures!.map((f) => f.label)).toEqual(["Figure 1", "Figure 2"]);
  expect(FIG1).toBe("Figure 1 · Creep against density in the invented survey.");
  expect(FIG2).toBe("Figure 2 · A sketch of the specimen, drawn by hand.");
});

describe("PaperBody — an anchor for each heading and each caption", () => {
  const html = render();

  it("names the heading's anchor after the section's paragraphs: p<P>", () => {
    expect(html).toContain(`id="${HEADING_ID}"`);
    expect(headingHtml(html)).toContain(`${ANCHOR_BLOCK_ATTRIBUTE}="heading"`);
    expect(headingHtml(html, 1)).toContain('id="paper-section-1-p1"');
  });

  it("names each figure's anchor after the heading's: p<P + 1 + k>, in the order the section holds its figures", () => {
    expect(captionHtml(html, 0)).toContain(`${ANCHOR_BLOCK_ATTRIBUTE}="caption"`);
    expect(captionHtml(html, 1)).toContain(`${ANCHOR_BLOCK_ATTRIBUTE}="caption"`);
    expect(captionHtml(html, 0)).toContain(FIG1.split(" · ")[1]);
    expect(captionHtml(html, 1)).toContain(FIG2.split(" · ")[1]);
  });

  it("keeps the marker's name and the text selector in one place: the heading itself and the caption's figcaption", () => {
    expect(ANCHOR_BLOCK_ATTRIBUTE).toBe("data-anchor-block");
    expect(ANCHOR_BLOCK_TEXT_SELECTOR).toBe(`[${ANCHOR_BLOCK_ATTRIBUTE}="heading"], figcaption`);
  });

  it("clears the sticky masthead when the square scrolls to it: the heading and the figure carry `scroll-mt-20`", () => {
    expect(headingHtml(html)).toMatch(/class="[^"]*\bscroll-mt-20\b/);
    expect(captionHtml(html, 0).slice(0, captionHtml(html, 0).indexOf(">"))).toMatch(/class="[^"]*\bscroll-mt-20\b/);
  });

  it("changes nothing else: the paragraphs' anchors stand, and the heading's and the caption's words are as they were", () => {
    for (let i = 0; i < P; i += 1) expect(html).toContain(`<div id="${paragraphAnchor(0, i)}"`);
    expect(headingHtml(html)).toMatch(/>1 Introduction<\/h3>$/);
    expect(figcaption(html, 0)).toBe(`<figcaption class="annotation mt-2 leading-[1.6] text-text-faint measure-mono"><span class="text-text-muted">Figure 1</span> · Creep against density in the invented survey.</figcaption>`);
  });

  it("gives the heading an id even where the section has no paragraphs (a group heading): p0", () => {
    const group = { ...reading, body: [{ ...S0, paragraphs: [], figures: undefined, equations: undefined }] };
    const out = renderToStaticMarkup(createElement(PaperBody, { reading: group as never }));
    expect(out).toContain('id="paper-section-0-p0"');
    expect(out).toContain(`${ANCHOR_BLOCK_ATTRIBUTE}="heading"`);
  });
});

describe("PaperBody — the marks a note and a highlight are drawn with, in a heading and in a caption", () => {
  const heading = S0.heading;

  it("marks a sticky's words in the heading, the tag right after them", () => {
    const out = headingHtml(render({ [HEADING_ID]: [spot("a", 1, heading, 2, 7)] }));
    expect(out).toMatch(new RegExp(`>1 <mark data-note="1"[^>]*>Intro</mark>${TAG(1)}duction</h3>$`));
  });

  it("marks a sticky's words in the caption, and the tag stands after them inside the figcaption", () => {
    const start = FIG1.indexOf("density");
    const out = figcaption(render({ [CAPTION_ID(0)]: [spot("a", 1, FIG1, start, start + 7)] }), 0);
    expect(out).toMatch(new RegExp(`Creep against <mark data-note="1"[^>]*>density</mark>${TAG(1)} in the invented survey\\.</figcaption>$`));
  });

  it("keeps the label's quiet face when a mark runs across it: the label inside the mark is still the label", () => {
    const out = figcaption(render({ [CAPTION_ID(0)]: [spot("a", 1, FIG1, 0, FIG1.indexOf("Creep") + 5)] }), 0);
    expect(out).toMatch(/<mark data-note="1"[^>]*><span class="text-text-muted">Figure 1<\/span> · Creep<\/mark>/);
  });

  it("paints a highlight on the caption's words in its colour, with its ink, and with no tag", () => {
    const start = FIG2.indexOf("sketch");
    const out = figcaption(render({ [CAPTION_ID(1)]: [spot("h1", 0, FIG2, start, start + 6, { colour: "pink", order: 0 })] }), 1);
    expect(out).toMatch(/<mark data-highlight="h1" style="background-color:#[0-9a-f]{6};color:#[0-9a-f]{6}">sketch<\/mark>/i);
    expect(out).not.toContain("<sup");
  });

  it("paints a highlight on the heading's words", () => {
    const out = headingHtml(render({ [HEADING_ID]: [spot("h1", 0, heading, 2, 14, { colour: "yellow", order: 0 })] }));
    expect(out).toMatch(/<mark data-highlight="h1" style="background-color:#[0-9a-f]{6};color:#[0-9a-f]{6}">Introduction<\/mark>/i);
  });

  it("draws a note whose words the block no longer holds as a tag alone, at the block's end — as a paragraph does", () => {
    const out = headingHtml(render({ [HEADING_ID]: [{ id: "a", n: 1 }] }));
    expect(out).toMatch(new RegExp(`>1 Introduction${TAG(1)}</h3>$`));
    expect(out).not.toContain("<mark");
  });

  it("never changes the words: the heading's and the caption's text with every mark and tag removed is what it was", () => {
    const strip = (s: string) => s.replace(/<sup[\s\S]*?<\/sup>/g, "").replace(/<[^>]+>/g, "");
    const noted = render({ [HEADING_ID]: [spot("a", 1, S0.heading, 2, 7)], [CAPTION_ID(0)]: [spot("b", 2, FIG1, 9, 20)] });
    expect(strip(headingHtml(noted))).toBe(strip(headingHtml(render())));
    expect(strip(figcaption(noted, 0))).toBe(FIG1);
  });

  it("still marks a paragraph's note beside them (the paragraphs' marks are as they were)", () => {
    const text = S0.paragraphs[2];
    const out = render({ [paragraphAnchor(0, 2)]: [spot("p", 1, text, 0, 5)], [HEADING_ID]: [spot("a", 2, S0.heading, 2, 7)] });
    expect(out.match(/<mark data-note=/g)).toHaveLength(2);
  });
});

// ── Reading a selection in a heading and in a caption ─────────────────────

type Rect = { left: number; top: number; right: number; bottom: number };
interface Stub {
  id: string;
  nodeType: number;
  parentElement: Stub | null;
  tag: string;
  inBody: boolean;
  marker: string | null;
  closest(selector: string): Stub | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect?(): Rect;
}
function el(tag: string, id: string, parent: Stub | null, marker: string | null = null, inBody = true, box?: Rect): Stub {
  const self: Stub = {
    id, nodeType: 1, parentElement: parent, tag, inBody, marker,
    ...(box ? { getBoundingClientRect: () => box } : {}),
    getAttribute: (name) => (name === ANCHOR_BLOCK_ATTRIBUTE ? marker : null),
    closest(selector) {
      if (selector === "#paper-body") return inBody ? self : null;
      for (let at: Stub | null = self; at; at = at.parentElement) {
        if (selector === "p" && at.tag === "p") return at;
        if (selector === ANCHOR_BLOCK_TEXT_SELECTOR && (at.marker === "heading" || at.tag === "figcaption")) return at;
      }
      return null;
    },
  };
  return self;
}
const textIn = (parent: Stub) => ({ nodeType: 3, parentElement: parent });

/** A section heading as the body renders it: the `h3` that carries the id and the marker. */
function heading(k: number, i: number, inBody = true, box?: Rect) {
  const h3 = el("h3", paragraphAnchor(k, i), null, "heading", inBody, box);
  return { h3, text: textIn(h3) };
}
/** A caption as the body renders it: the `figure` that carries the id and the marker, the picture's button, the `figcaption`. */
function caption(k: number, i: number, inBody = true, box?: Rect) {
  const figure = el("figure", paragraphAnchor(k, i), null, "caption", inBody);
  const button = el("button", "", figure, null, inBody);
  const figcaptionEl = el("figcaption", "", figure, null, inBody, box);
  return { figure, picture: textIn(button), figcaption: figcaptionEl, text: textIn(figcaptionEl) };
}
function paragraph(k: number, i: number) {
  const host = el("div", paragraphAnchor(k, i), null);
  const p = el("p", "", host);
  return { text: textIn(p) };
}

const LINE: Rect[] = [{ left: 100, top: 200, right: 260, bottom: 220 }];
function selection(start: unknown, end: unknown, text = "Methods of the tidal", rects: Rect[] = LINE): SelectionLike {
  const range = {
    startContainer: start, endContainer: end, endOffset: 5,
    cloneRange: () => range,
    cloneContents: () => ({ querySelector: () => null }),
    getClientRects: () => rects,
    getBoundingClientRect: () => rects[0],
  };
  return { rangeCount: 1, isCollapsed: false, toString: () => text, getRangeAt: () => range as never };
}

describe("readSelection — a selection in a heading or in a caption is a target", () => {
  it("is the heading's words, in the heading's anchor, marked as a heading's", () => {
    const h = heading(1, 3);
    const read = readSelection(selection(h.text, h.text));
    expect(read).toMatchObject({ sectionIndex: 1, paragraphIndex: 3, passage: "Methods of the tidal", source: "paper", paragraphId: "paper-section-1-p3", block: "heading" });
  });

  it("is the caption's words, in the figure's anchor, marked as a caption's", () => {
    const c = caption(0, 4);
    const read = readSelection(selection(c.text, c.text, "Creep against density"));
    expect(read).toMatchObject({ sectionIndex: 0, paragraphIndex: 4, passage: "Creep against density", source: "paper", paragraphId: "paper-section-0-p4", block: "caption" });
  });

  it("measures itself and gives the block's own box, as a paragraph does", () => {
    const box = { left: 90, top: 190, right: 700, bottom: 226 };
    const h = heading(1, 3, true, box);
    const read = readSelection(selection(h.text, h.text));
    expect(read?.paragraph).toEqual(box);
    expect(read?.measure?.()?.bounds).toEqual({ left: 100, top: 200, right: 260, bottom: 220 });
  });

  it("is a target for a paragraph's selection exactly as before: no `block`", () => {
    const p = paragraph(1, 2);
    const read = readSelection(selection(p.text, p.text, "the rafting ratio"));
    expect(read).toMatchObject({ sectionIndex: 1, paragraphIndex: 2, source: "paper", paragraphId: "paper-section-1-p2" });
    expect(read).not.toHaveProperty("block");
  });

  it("is the heading for a triple click that ends at the start of the next block (its end at offset 0 of another place)", () => {
    const h = heading(1, 3);
    const p = paragraph(1, 0);
    const read = readSelection(selection(h.text, p.text, "Methods of the tidal survey"));
    // endOffset is 5 in the stub: a drag that really ends in another block is no target.
    expect(read).toBeNull();
    const range = selection(h.text, p.text, "Methods of the tidal survey");
    (range.getRangeAt(0) as unknown as { endOffset: number }).endOffset = 0;
    expect(readSelection(range)).toMatchObject({ paragraphId: "paper-section-1-p3", block: "heading" });
  });

  it("is nothing across two blocks: a heading and the paragraph under it, a caption and a paragraph, two captions, two headings", () => {
    const h = heading(1, 3);
    const p = paragraph(1, 0);
    const c = caption(1, 4);
    const c2 = caption(1, 5);
    const h2 = heading(0, 3);
    expect(readSelection(selection(h.text, p.text))).toBeNull();
    expect(readSelection(selection(p.text, c.text))).toBeNull();
    expect(readSelection(selection(c.text, c2.text))).toBeNull();
    expect(readSelection(selection(h.text, h2.text))).toBeNull();
  });

  it("is nothing from a caption into its picture: the picture's button is no part of the caption's words", () => {
    const c = caption(0, 4);
    expect(readSelection(selection(c.text, c.picture))).toBeNull();
    expect(readSelection(selection(c.picture, c.picture))).toBeNull();
  });

  it("is nothing outside the paper's body, and nothing for an id that is not an anchor's", () => {
    const out = heading(1, 3, false);
    expect(readSelection(selection(out.text, out.text))).toBeNull();
    const stray = el("h3", "paper-section-1", null, "heading");
    expect(readSelection(selection(textIn(stray), textIn(stray)))).toBeNull();
    const unmarked = el("h3", "paper-section-1-p3", null, null);
    expect(readSelection(selection(textIn(unmarked), textIn(unmarked)))).toBeNull();
  });

  it("still reads the pure rule as it was: `selectionTarget` takes a heading's id like a paragraph's, and adds no `block`", () => {
    expect(selectionTarget({ anchorParagraphId: "paper-section-1-p3", focusParagraphId: "paper-section-1-p3", text: "Methods" })).toEqual({
      sectionIndex: 1, paragraphIndex: 3, passage: "Methods", source: "paper", paragraphId: "paper-section-1-p3",
    });
  });

  it("tells a heading's selection from a paragraph's of the same id: `block` counts", () => {
    const h = heading(1, 3);
    const a = readSelection(selection(h.text, h.text))!;
    expect(sameSelection(a, { ...a })).toBe(true);
    expect(sameSelection(a, { ...a, block: "caption" })).toBe(false);
  });
});

describe("the body's source", () => {
  const SOURCE = readFileSync(resolve(process.cwd(), "src/components/reader/paper-body.tsx"), "utf8");

  it("tells the store which body is on show, and takes it back when the body goes (a note on a heading reads its words from it)", () => {
    expect(SOURCE).toMatch(/setBodyOnShow\(body\)/);
    expect(SOURCE).toMatch(/setBodyOnShow\(null\)/);
  });

  it("resolves the notes' anchors against the headings and the captions too: the whole section, not its paragraphs alone", () => {
    expect(SOURCE).toMatch(/resolveAnchors\(body, noteAnchors\)/);
  });
});
