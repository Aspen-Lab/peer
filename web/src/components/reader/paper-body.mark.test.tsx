import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import { inlineMath } from "@/lib/text/math";
import type { Paper } from "@/types";
import { PaperBody, paragraphAnchor, readSelection, type SelectionLike } from "./paper-body";

// P10-09f (review 7.1c; walk X-B3, B11; rules 2 and 4): the highlighter. The words a sticky note was taken on stay
// marked in the paper — a `<mark data-note="N">` in the highlighter token — with the note's tag [N] right after
// them, not at the paragraph's end; two notes in one paragraph each mark their own words; a note whose range the
// text no longer holds draws no mark and its tag stands at the paragraph's end. The mark never changes the paragraph's
// text, its order or the selection behaviour. Every text is invented.

const paper: Paper = {
  id: "p1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const FORMULA_PARAGRAPH = `The load ${inlineMath("x_{1}")} meets the grain boundaries twice.`;
const doc: ExtractedDocument = {
  source: "pdf", pageCount: 2, figureCaptions: [], equations: [],
  sections: [
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: `Creep limits the life.\n\nGrain boundaries carry the strain.\n\n${FORMULA_PARAGRAPH}`, page: 1 },
  ],
};
const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } };
const reading = buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));
const P1 = "Grain boundaries carry the strain.";
const P2 = reading.body[0].paragraphs[2];

const spot = (id: string, n: number, text: string, start: number, end: number) => ({ id, n, start, end, quote: text.slice(start, end) });
const render = (noteAnchors?: Record<string, ReturnType<typeof spot>[] | { id: string; n: number }[]>) =>
  renderToStaticMarkup(createElement(PaperBody, { reading, ...(noteAnchors ? { noteAnchors } : {}) }));
const paragraphHtml = (html: string, i: number) => {
  const from = html.indexOf(`<div id="${paragraphAnchor(0, i)}"`);
  return html.slice(from, html.indexOf("</p>", from) + 4);
};
const TAG = (n: number) => `<sup[^>]*><button[^>]*aria-label="Open note ${n}"[^>]*>\\[${n}\\]</button></sup>`;

describe("PaperBody — the words a sticky was taken on are marked", () => {
  it("wraps the anchored words in <mark data-note> and puts the tag right after them", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16)] }), 1);
    expect(html).toMatch(new RegExp(`<p><mark data-note="1"[^>]*>Grain boundaries</mark>${TAG(1)} carry the strain\\.</p>`));
  });

  it("marks each note's own words in one paragraph, each with its own tag after its own words", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 5), spot("b", 2, P1, 17, 22)] }), 1);
    expect(html).toMatch(
      new RegExp(`<p><mark data-note="1"[^>]*>Grain</mark>${TAG(1)} boundaries <mark data-note="2"[^>]*>carry</mark>${TAG(2)} the strain\\.</p>`),
    );
  });

  it("starts a later, overlapping note's mark where the earlier ends, and gives it its own tag after its own end", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 22)] }), 1);
    expect(html).toMatch(new RegExp(`<mark data-note="1"[^>]*>Grain boundaries</mark>${TAG(1)}<mark data-note="2"[^>]*> carry</mark>${TAG(2)} the strain\\.</p>`));
    expect(html.match(/<mark\b/g)).toHaveLength(2);
    expect(html).not.toMatch(/<mark[^>]*>[^<]*<mark/);
  });

  it("draws the tag at the paragraph's end, and no mark, for a note with no range or a range the text no longer holds", () => {
    const none = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [{ id: "a", n: 1 }] }), 1);
    expect(none).not.toContain("<mark");
    expect(none).toMatch(new RegExp(`<p>${P1.replace(".", "\\.")}${TAG(1)}</p>`));
    const stale = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [{ id: "a", n: 1, start: 0, end: 5, quote: "Grains" }] }), 1);
    expect(stale).not.toContain("<mark");
    expect(stale).toMatch(new RegExp(`<p>${P1.replace(".", "\\.")}${TAG(1)}</p>`));
  });

  it("marks words that follow a formula without disturbing it, and never a range that cuts one", () => {
    const start = P2.indexOf("grain boundaries");
    const html = paragraphHtml(render({ [paragraphAnchor(0, 2)]: [spot("a", 1, P2, start, start + 16)] }), 2);
    expect(html).toMatch(/<code[^>]*>x_\{1\}<\/code>/);
    expect(html).toMatch(/<mark data-note="1"[^>]*>grain boundaries<\/mark>/);
    const cut = paragraphHtml(render({ [paragraphAnchor(0, 2)]: [spot("a", 1, P2, 4, 14)] }), 2);
    expect(cut).not.toContain("<mark");
  });

  it("is drawn in the highlighter token, a background only, with the paragraph's own ink", () => {
    const tag = /<mark[^>]*>/.exec(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 5)] }))![0];
    expect(tag).toContain("bg-[color:var(--color-note-mark)]");
    expect(tag).toContain("text-inherit");
    expect(tag).not.toMatch(/route-(?:strong|medium|faint|background)/);
  });

  it("changes nothing else: without its marks and tags the body is the body without notes", () => {
    const bare = render();
    const marked = render({
      [paragraphAnchor(0, 0)]: [{ id: "z", n: 3 }],
      [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 5), spot("b", 2, P1, 17, 22)],
    });
    const stripped = marked.replace(/<mark[^>]*>/g, "").replace(/<\/mark>/g, "").replace(/<sup[^>]*>.*?<\/sup>/g, "");
    expect(stripped).toBe(bare);
    expect(render({})).toBe(bare);
  });

  it("keeps the text of a paragraph with a formula, in order, when a range is marked after the formula", () => {
    const at = P2.indexOf("grain");
    const text = (html: string) => paragraphHtml(html, 2).replace(/<sup[^>]*>.*?<\/sup>/g, "").replace(/<[^>]+>/g, "");
    expect(text(render({ [paragraphAnchor(0, 2)]: [spot("c", 4, P2, at, at + 5)] }))).toBe(text(render()));
  });
});

// ── A selection inside a mark is still a target ─────────────────────────────

interface Stub {
  id: string;
  nodeType: number;
  tag: string;
  parentElement: Stub | null;
  closest(selector: string): Stub | null;
}
function stub(tag: string, id: string, parent: Stub | null, inBody = true): Stub {
  const self: Stub = {
    id, nodeType: 1, tag, parentElement: parent,
    closest(selector) {
      if (selector === "#paper-body") return inBody ? self : null;
      if (selector === "p") {
        for (let at: Stub | null = self; at; at = at.parentElement) if (at.tag === "p") return at;
      }
      return null;
    },
  };
  return self;
}

describe("a selection inside a mark", () => {
  const host = stub("div", paragraphAnchor(0, 1), null);
  const p = stub("p", "", host);
  const mark = stub("mark", "", p);
  const inside = { nodeType: 3, parentElement: mark };
  const plainWords = { nodeType: 3, parentElement: p };
  const rect = { left: 10, top: 10, right: 90, bottom: 30 };
  const selection = (start: unknown, end: unknown): SelectionLike => {
    const range = {
      startContainer: start, endContainer: end, endOffset: 3, cloneRange: () => range,
      cloneContents: () => ({ querySelector: () => null }), getClientRects: () => [rect], getBoundingClientRect: () => rect,
    };
    return { rangeCount: 1, isCollapsed: false, toString: () => "boundaries carry", getRangeAt: () => range } as unknown as SelectionLike;
  };

  it("is still a target of its paragraph, whether it sits wholly in the mark or runs out of it", () => {
    expect(readSelection(selection(inside, inside))).toMatchObject({ sectionIndex: 0, paragraphIndex: 1, passage: "boundaries carry", paragraphId: paragraphAnchor(0, 1) });
    expect(readSelection(selection(inside, plainWords))).toMatchObject({ paragraphId: paragraphAnchor(0, 1) });
    expect(readSelection(selection(plainWords, inside))).toMatchObject({ paragraphId: paragraphAnchor(0, 1) });
  });

  it("lies inside the paragraph's <p>, where the selection reads from", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16)] }), 1);
    expect(html.indexOf("<p>")).toBeLessThan(html.indexOf("<mark"));
    expect(html.indexOf("</mark>")).toBeLessThan(html.indexOf("</p>"));
  });
});
