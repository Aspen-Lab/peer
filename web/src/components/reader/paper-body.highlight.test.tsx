import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import { contrast } from "@/lib/notes/highlight-colours";
import type { HighlightColourId } from "@/lib/notes/types";
import type { Paper } from "@/types";
import * as bodyModule from "./paper-body";
import {
  PaperBody,
  coveringSegments,
  paragraphAnchor,
  readSelection,
  sameSelection,
  type CoveringSegment,
  type ExplainSelection,
  type SelectionLike,
  type ViewRect,
} from "./paper-body";

// P11-09 (owner item 8, "Highlight"; B P11-04 §3 and §2.8; ruling §1h.112): a highlight is drawn in the paper in its own
// colour, answers a click, and the selection that makes one carries the offset of its words. This file is the mark (rule 1),
// the click's reading (rule 2) and the selection's offset (rule 3); the flash and the tie-break are in
// `note-tags.highlight.test.tsx`, the click's wiring on `PaperBody` in `paper-body.highlight.click.test.tsx`.
// A highlight is a spot `{ id, n: 0, start, end, quote, colour, order }` in the anchor map (the store emits it, P11-07);
// the spots here are built by hand. Every text is invented.

const paper: Paper = {
  id: "p1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const doc: ExtractedDocument = {
  source: "pdf", pageCount: 2, figureCaptions: [], equations: [],
  sections: [
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life.\n\nGrain boundaries carry the strain.\n\nTide pools hold snails, and the tide pools near the cliff hold most.", page: 1 },
  ],
};
const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } };
const reading = buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));
const P1 = "Grain boundaries carry the strain.";
const ID1 = paragraphAnchor(0, 1);
// Read off the module so this file compiles before the function exists (the first commit of P11-09 is red on the contract).
const highlightClickOf = (
  bodyModule as unknown as { highlightClickOf: (target: unknown, selection: { isCollapsed: boolean } | null) => { id: string; rect: ViewRect } | null }
).highlightClickOf;

interface Spot {
  id: string;
  n: number;
  start?: number;
  end?: number;
  quote?: string;
  colour?: HighlightColourId;
  order?: number;
}
const sticky = (id: string, n: number, start: number, end: number): Spot => ({ id, n, start, end, quote: P1.slice(start, end) });
const hl = (id: string, start: number, end: number, colour: HighlightColourId = "yellow", order = 0): Spot => ({
  id, n: 0, start, end, quote: P1.slice(start, end), colour, order,
});
const render = (spots?: Spot[], inParagraph = ID1) =>
  renderToStaticMarkup(createElement(PaperBody, { reading, ...(spots ? { noteAnchors: { [inParagraph]: spots } } : {}) }));
/** The paragraph's own `<p>…</p>`. */
const paragraphHtml = (html: string, i: number) => {
  const from = html.indexOf("<p>", html.indexOf(`<div id="${paragraphAnchor(0, i)}"`));
  return html.slice(from, html.indexOf("</p>", from) + 4);
};
const p1 = (spots?: Spot[]) => paragraphHtml(render(spots), 1);
const TAG = (n: number, style = "") => `<sup[^>]*>⁠<button[^>]*aria-label="Open note ${n}"[^>]*${style}>\\[${n}\\]</button></sup>`;
/** A highlight's mark as it is drawn: its id, its fill and its ink. */
const HL = (id: string, bg: string, ink: string, part = false) => `<mark data-highlight${part ? "-part" : ""}="${id}" style="background-color:${bg};color:${ink}">`;

// What a reader sees, per preset (B P11-04 §4.2): fill, ink on it, and the deeper shade it wears nested in another mark.
const PRESETS: Record<HighlightColourId, { fill: string; ink: string; deep: string }> = {
  yellow: { fill: "#ffe600", ink: "#000000", deep: "#dbc600" },
  green: { fill: "#8fe388", ink: "#000000", deep: "#7bc375" },
  blue: { fill: "#7cc4ff", ink: "#000000", deep: "#6ba9db" },
  pink: { fill: "#ff9ec7", ink: "#000000", deep: "#db88ab" },
  orange: { fill: "#ffb84d", ink: "#000000", deep: "#db9e42" },
  ink: { fill: "#1e40af", ink: "#ffffff", deep: "#3e5bba" },
};

/** Every `<mark>` of a paragraph in order, with its attributes and whether a highlight stands around it. */
function marksOf(html: string): { open: string; style: string; insideHighlight: boolean }[] {
  const out: { open: string; style: string; insideHighlight: boolean }[] = [];
  const stack: boolean[] = [];
  for (const token of html.matchAll(/<mark\b[^>]*>|<\/mark>/g)) {
    if (token[0] === "</mark>") {
      stack.pop();
      continue;
    }
    out.push({ open: token[0], style: /style="([^"]*)"/.exec(token[0])?.[1] ?? "", insideHighlight: stack.some(Boolean) });
    stack.push(/data-highhl(?:-part)?=/.test(token[0]));
  }
  return out;
}
const textOnly = (html: string) => html.replace(/<sup[^>]*>.*?<\/sup>/g, "").replace(/<[^>]+>/g, "");

describe("a highlight is drawn in the paper in its own colour (P11-09, rule 1)", () => {
  it("is a <mark data-highlight> with the fill and the ink inline, and no tag after it", () => {
    const html = p1([hl("h1", 0, 16)]);
    expect(html).toBe(`<p>${HL("h1", "#ffe600", "#000000")}Grain boundaries</mark> carry the strain.</p>`);
    expect(html).not.toContain("<sup");
    expect(html).not.toContain("Open note");
    expect(html).not.toContain("--color-note-");
  });

  it("wears each preset's fill and ink: the ink is black on the light fills and white on the dark one", () => {
    for (const [colour, want] of Object.entries(PRESETS)) {
      const html = p1([hl("h1", 0, 16, colour as HighlightColourId)]);
      expect(html).toContain(HL("h1", want.fill, want.ink));
    }
    // And never under 4.5:1, for any of them.
    for (const want of Object.values(PRESETS)) {
      expect(contrast(want.fill, want.ink)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(want.deep, want.ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reads a colour the table does not know as yellow", () => {
    expect(p1([{ ...hl("h1", 0, 16), colour: "magenta" as HighlightColourId }])).toContain(HL("h1", "#ffe600", "#000000"));
  });

  it("draws a highlight inside a sticky's mark at its deep shade, the sticky's own mark and tag unchanged", () => {
    const html = p1([sticky("s1", 1, 0, 22), hl("h1", 6, 16)]);
    expect(html).toMatch(
      new RegExp(
        `<p><mark data-note="1" class="bg-\\[color:var\\(--color-note-mark\\)\\] text-inherit">Grain ${HL("h1", "#dbc600", "#000000")}boundaries</mark> carry</mark>${TAG(1)} the strain\\.</p>`,
      ),
    );
    expect(html.match(/<sup/g)).toHaveLength(1);
  });

  it("draws a sticky's mark inside a highlight at the highlight's deep shade and ink, and keeps its tag, inked too", () => {
    const html = p1([hl("h1", 0, 22), sticky("s1", 1, 6, 16)]);
    expect(html).toMatch(
      new RegExp(
        `<p>${HL("h1", "#ffe600", "#000000")}Grain <mark data-note="1" style="background-color:#dbc600;color:#000000">boundaries</mark>${TAG(1, 'style="color:#000000"')} carry</mark> the strain\\.</p>`,
      ),
    );
    expect(html).not.toContain("--color-note-nested");
  });

  it("does the same on the dark preset: the deep blue with white words, and a white tag", () => {
    const html = p1([hl("h1", 0, 22, "ink"), sticky("s1", 1, 6, 16)]);
    expect(html).toContain(HL("h1", "#1e40af", "#ffffff"));
    expect(html).toContain('<mark data-note="1" style="background-color:#3e5bba;color:#ffffff">boundaries</mark>');
    expect(html).toMatch(new RegExp(TAG(1, 'style="color:#ffffff"')));
  });

  it("gives the part of a sticky's mark that lies inside a highlight the same shade and ink", () => {
    // The highlight holds 0–16; the sticky starts inside it (6) and runs out of it (22): its first words are a nested part.
    const html = p1([hl("h1", 0, 16), sticky("s1", 1, 6, 22)]);
    expect(html).toContain(`Grain <mark data-note-part="1" style="background-color:#dbc600;color:#000000">boundaries</mark></mark>`);
    expect(html).toMatch(new RegExp(`<mark data-note="1" class="bg-\\[color:var\\(--color-note-mark\\)\\] text-inherit"> carry</mark>${TAG(1)}`));
  });

  it("draws a highlight inside a highlight at its deep shade; the third shares it", () => {
    const html = p1([hl("a", 0, 22, "yellow", 0), hl("b", 6, 22, "green", 1), hl("c", 6, 16, "blue", 2)]);
    expect(html).toBe(
      `<p>${HL("a", "#ffe600", "#000000")}Grain ${HL("b", "#7bc375", "#000000")}${HL("c", "#6ba9db", "#000000")}boundaries</mark> carry</mark></mark> the strain.</p>`,
    );
  });

  it("draws two highlights that overlap level: the overlap is the later one's words at its deep shade (a part), the rest its fill", () => {
    const html = p1([hl("a", 0, 16, "yellow", 0), hl("b", 6, 22, "green", 1)]);
    expect(html).toBe(
      `<p>${HL("a", "#ffe600", "#000000")}Grain ${HL("b", "#7bc375", "#000000", true)}boundaries</mark></mark>${HL("b", "#8fe388", "#000000")} carry</mark> the strain.</p>`,
    );
    expect(html).not.toContain("<sup");
  });

  it("puts a sticky outside a highlight of the very same words, whichever is listed first and whatever the numbers", () => {
    for (const spots of [[sticky("s1", 4, 6, 16), hl("h1", 6, 16)], [hl("h1", 6, 16), sticky("s1", 4, 6, 16)]]) {
      const html = p1(spots);
      expect(html.indexOf('data-note="4"')).toBeLessThan(html.indexOf("data-highlight"));
      expect(html).toContain(`${HL("h1", "#dbc600", "#000000")}boundaries</mark>`);
    }
  });

  it("puts the earlier highlight (by order) outside the later one of the same words, whichever is listed first", () => {
    for (const spots of [[hl("late", 6, 16, "green", 5), hl("early", 6, 16, "pink", 2)], [hl("early", 6, 16, "pink", 2), hl("late", 6, 16, "green", 5)]]) {
      expect(p1(spots)).toBe(
        `<p>Grain ${HL("early", PRESETS.pink.fill, "#000000")}${HL("late", PRESETS.green.deep, "#000000")}boundaries</mark></mark> carry the strain.</p>`,
      );
    }
  });

  it("draws nothing, and no tag, for a highlight whose words the paragraph no longer holds", () => {
    const stale: Spot = { id: "h1", n: 0, start: 0, end: 5, quote: "Grains", colour: "yellow", order: 0 };
    expect(p1([stale])).toBe(`<p>${P1}</p>`);
    const noRange: Spot = { id: "h2", n: 0, colour: "yellow", order: 1 };
    expect(p1([noRange])).toBe(`<p>${P1}</p>`);
  });

  it("changes no word of the paragraph (I1): without its marks and tags it is the paragraph", () => {
    const cases: Spot[][] = [
      [hl("h1", 0, 16)],
      [sticky("s1", 1, 0, 22), hl("h1", 6, 16)],
      [hl("h1", 0, 22), sticky("s1", 1, 6, 16)],
      [hl("a", 0, 16), hl("b", 6, 22, "green", 1), sticky("s1", 1, 10, 30)],
    ];
    for (const spots of cases) expect(textOnly(p1(spots))).toBe(P1);
  });

  it("sets its own ink on every mark inside a highlight (I3), and each ink holds 4.5:1 on the shade it stands on", () => {
    const cases: Spot[][] = [
      [hl("h1", 0, 22), sticky("s1", 1, 6, 16)],
      [hl("h1", 0, 16), sticky("s1", 1, 6, 22)],
      [hl("a", 0, 16, "ink", 0), hl("b", 6, 22, "yellow", 1), sticky("s1", 1, 0, 10)],
      [hl("h1", 0, 22, "pink"), sticky("s1", 1, 6, 16), hl("h2", 8, 12, "ink", 1)],
    ];
    for (const spots of cases) {
      const marks = marksOf(p1(spots));
      const inside = marks.filter((one) => one.insideHighlight);
      expect(inside.length).toBeGreaterThan(0);
      for (const one of marks.filter((m) => m.insideHighlight || /data-highlight/.test(m.open))) {
        const bg = /background-color:(#[0-9a-f]{6})/.exec(one.style)?.[1];
        const ink = /(?:^|;)color:(#[0-9a-f]{6})/.exec(one.style)?.[1];
        expect(bg, one.open).toBeDefined();
        expect(ink, one.open).toBeDefined();
        expect(contrast(bg!, ink!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("changes nothing in a paragraph with no highlight (I4): a sticky's mark keeps its classes, no inline style, no tag change", () => {
    const stickies = [sticky("s1", 1, 0, 22), sticky("s2", 2, 6, 16), sticky("s3", 3, 17, 22)];
    const bare = p1(stickies);
    expect(bare).not.toContain("style=");
    expect(bare).not.toContain("data-highlight");
    expect(bare).toMatch(/<mark data-note="1" class="bg-\[color:var\(--color-note-mark\)\] text-inherit">/);
    expect(bare).toMatch(/<mark data-note="2" class="bg-\[color:var\(--color-note-nested\)\] text-inherit">/);
    // A highlight in ANOTHER paragraph leaves this paragraph, and the whole of the others, exactly as they were.
    const other = renderToStaticMarkup(
      createElement(PaperBody, {
        reading,
        noteAnchors: { [ID1]: stickies, [paragraphAnchor(0, 0)]: [{ ...hl("h9", 0, 5), quote: "Creep" }] },
      }),
    );
    expect(paragraphHtml(other, 1)).toBe(bare);
    expect(paragraphHtml(other, 2)).toBe(paragraphHtml(render(), 2));
  });

  it("leaves the paragraphs it is not in as they were", () => {
    expect(paragraphHtml(render([hl("h1", 0, 16)]), 0)).toBe(paragraphHtml(render(), 0));
    expect(paragraphHtml(render([hl("h1", 0, 16)]), 2)).toBe(paragraphHtml(render(), 2));
  });
});

describe("coveringSegments lays a highlight's lost words back as a part (P11-09, rule 1)", () => {
  const tree = (segments: CoveringSegment[]): string =>
    segments
      .map((one) => {
        if (one.kind === "text") return P1.slice(one.from, one.to);
        if (one.kind === "tag") return `<tag${one.spot.id}>`;
        return one.part ? `(${one.spot.id}@${one.depth} ${tree(one.inner)})` : `[${one.spot.id}@${one.depth} ${tree(one.inner)}]`;
      })
      .join("");

  it("a later highlight that starts inside an earlier one: its first words are a part inside it, its rest its own mark", () => {
    expect(tree(coveringSegments(P1, [hl("a", 0, 16, "yellow", 0), hl("b", 6, 22, "green", 1)]))).toBe(
      "[a@0 Grain (b@1 boundaries)][b@0  carry] the strain.",
    );
  });
});

// ── The click on a mark (rule 2) ────────────────────────────────────────────

interface FakeEl {
  nodeType: 1 | 3;
  tag: string;
  attrs: Record<string, string>;
  parentElement: FakeEl | null;
  children: FakeEl[];
  rects: ViewRect[];
  closest(selector: string): FakeEl | null;
  querySelectorAll(selector: string): FakeEl[];
  getAttribute(name: string): string | null;
  getClientRects(): ViewRect[];
  getBoundingClientRect(): ViewRect;
}
/** A selector list of `tag`, `tag[attr]` and `tag[attr="value"]` terms: all the click's reading asks. */
function matches(el: FakeEl, selector: string): boolean {
  return selector.split(",").some((term) => {
    const m = /^\s*([a-z]+)?(?:\[([a-z-]+)(?:="([^"]*)")?\])?\s*$/.exec(term);
    if (!m) throw new Error(`the fake DOM does not read the selector ${term}`);
    const [, tag, attr, value] = m;
    if (tag && el.tag !== tag) return false;
    if (attr && !(attr in el.attrs)) return false;
    return !(attr && value !== undefined && el.attrs[attr] !== value);
  });
}
function el(tag: string, attrs: Record<string, string>, parent: FakeEl | null, rects: ViewRect[] = []): FakeEl {
  const self: FakeEl = {
    nodeType: 1, tag, attrs, parentElement: parent, children: [], rects,
    closest(selector) {
      for (let at: FakeEl | null = self; at; at = at.parentElement) if (matches(at, selector)) return at;
      return null;
    },
    querySelectorAll(selector) {
      const found: FakeEl[] = [];
      const walk = (node: FakeEl) => {
        for (const child of node.children) {
          if (matches(child, selector)) found.push(child);
          walk(child);
        }
      };
      walk(self);
      return found;
    },
    getAttribute: (name) => attrs[name] ?? null,
    getClientRects: () => self.rects,
    getBoundingClientRect: () => self.rects[0] ?? { left: 0, top: 0, right: 0, bottom: 0 },
  };
  parent?.children.push(self);
  return self;
}
const line = (top: number): ViewRect => ({ left: 20, top, right: 220, bottom: top + 20 });

describe("highlightClickOf — a click on a highlight's mark (P11-09, rule 2)", () => {
  // <p> holds: a part of highlight h2 inside highlight h1's mark, h2's own mark after it (a later line), a sticky's mark and its tag.
  const p = el("p", {}, null);
  const h1 = el("mark", { "data-highlight": "h1" }, p, [line(100), line(120)]);
  const part = el("mark", { "data-highlight-part": "h2" }, h1, [line(120)]);
  const h2 = el("mark", { "data-highlight": "h2" }, p, [line(140)]);
  const inSticky = el("mark", { "data-note": "1" }, h1, [line(100)]);
  const tagButton = el("button", {}, h1);
  const stickyAlone = el("mark", { "data-note": "2" }, p, [line(160)]);
  const plainSelection = { isCollapsed: true };

  it("is the highlight's id and its first line, for a click with a collapsed selection", () => {
    expect(highlightClickOf(h1, plainSelection)).toEqual({ id: "h1", rect: line(100) });
  });

  it("reads a click on a nested part as that highlight, and takes the first line of the highlight's first mark in the paragraph", () => {
    // h2's marks in reading order: its part (inside h1, line 120) then its own mark (line 140).
    expect(highlightClickOf(part, plainSelection)).toEqual({ id: "h2", rect: line(120) });
    expect(highlightClickOf(h2, plainSelection)).toEqual({ id: "h2", rect: line(120) });
  });

  it("reads a click on a text node as the element around it, and a click when the page has no selection at all", () => {
    expect(highlightClickOf({ nodeType: 3, parentElement: h1 }, null)).toEqual({ id: "h1", rect: line(100) });
  });

  it("is a selection, not a click, when the selection is not collapsed (a drag that ends on the mark, a double click)", () => {
    expect(highlightClickOf(h1, { isCollapsed: false })).toBeNull();
  });

  it("reads a click on a sticky's mark inside a highlight as the highlight's, and a click on the sticky's tag as nobody's", () => {
    expect(highlightClickOf(inSticky, plainSelection)).toEqual({ id: "h1", rect: line(100) });
    expect(highlightClickOf(tagButton, plainSelection)).toBeNull();
  });

  it("reads a click anywhere that is no highlight's mark as nobody's", () => {
    expect(highlightClickOf(stickyAlone, plainSelection)).toBeNull();
    expect(highlightClickOf(p, plainSelection)).toBeNull();
    expect(highlightClickOf(null, plainSelection)).toBeNull();
    expect(highlightClickOf({ nodeType: 3, parentElement: null }, plainSelection)).toBeNull();
  });
});

// ── The selection's offset (rule 3, I10) ────────────────────────────────────

type FNode = { nodeType: number; nodeName: string; data?: string; childNodes?: FNode[] };
const text = (data: string): FNode => ({ nodeType: 3, nodeName: "#text", data });
const mark = (...childNodes: FNode[]): FNode => ({ nodeType: 1, nodeName: "MARK", childNodes });
/** The tag as `NoteTag` renders it: sup > word joiner, button > "[n]". */
const tag = (n: number): FNode => ({ nodeType: 1, nodeName: "SUP", childNodes: [text("⁠"), { nodeType: 1, nodeName: "BUTTON", childNodes: [text(`[${n}]`)] }] });
const textOf = (nodes: readonly FNode[]): string => nodes.map((n) => (n.nodeType === 3 ? n.data! : textOf(n.childNodes ?? []))).join("");

/** What `cloneContents` holds for the paragraph's words `from … to`: text cut at the ends, marks cut around it, a tag whole when the range runs across its place. */
function cloneContents(nodes: readonly FNode[], from: number, to: number): FNode[] {
  const out: FNode[] = [];
  let pos = 0;
  const walk = (list: readonly FNode[], into: FNode[]) => {
    for (const node of list) {
      if (node.nodeName === "SUP") {
        if (from < pos && pos < to) into.push(node);
      } else if (node.nodeType === 3) {
        const length = node.data!.length;
        const lo = Math.max(from, pos);
        const hi = Math.min(to, pos + length);
        if (lo < hi) into.push(text(node.data!.slice(lo - pos, hi - pos)));
        pos += length;
      } else {
        const inner: FNode[] = [];
        walk(node.childNodes ?? [], inner);
        if (inner.length > 0) into.push({ ...node, childNodes: inner });
      }
    }
  };
  walk(nodes, out);
  return out;
}

const SHORE = "Tide pools hold snails, and the tide pools near the cliff hold most of them.";

/**
 * The DOM's selection over a paragraph made of `nodes`, in the words' own coordinates (a tag has none): a range whose
 * start is `(container, offset = from)`, and which answers `selectNodeContents` and `setEnd` the way a browser's does —
 * `setEnd(container, offset)` ends the range at that offset — so a range from the `<p>`'s start to the selection's start
 * holds the words before it, and a tag standing between them whole.
 */
function selectOver(nodes: readonly FNode[], from: number, to: number, id = paragraphAnchor(1, 2), source?: "summary"): SelectionLike {
  const host = { id, nodeType: 1, parentElement: null as unknown, closest: (selector: string) => (selector === "#paper-body" && !source ? host : null) };
  // The Summary's container is marked `data-explain-source`; the body's paragraph is found by its anchor.
  const container = { id: "", getAttribute: (name: string) => (name === "data-explain-source" ? source ?? null : null), parentElement: null, closest: () => null };
  const p = {
    id: "",
    nodeType: 1,
    parentElement: host,
    closest: (selector: string) => (selector === "p" ? p : source && selector.includes("data-explain-source") ? container : null),
  };
  const end = { nodeType: 3, parentElement: p };
  const rect = { left: 10, top: 10, right: 90, bottom: 30 };
  const make = (a: number, b: number): Record<string, unknown> => ({
    startContainer: end, endContainer: end, startOffset: from, endOffset: 5,
    cloneRange: () => make(a, b),
    selectNodeContents: () => {
      a = 0;
      b = Number.MAX_SAFE_INTEGER;
    },
    setEnd: (_container: unknown, offset: number) => {
      b = offset;
    },
    cloneContents: () => ({ querySelector: () => null, childNodes: cloneContents(nodes, a, b) }),
    toString: () => textOf(cloneContents(nodes, a, b)),
    getClientRects: () => [rect],
    getBoundingClientRect: () => rect,
  });
  const selection = make(from, to);
  return {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => textOf(cloneContents(nodes, from, to)),
    getRangeAt: () => selection,
  } as unknown as SelectionLike;
}
type WithOffset = ExplainSelection & { offset?: number };
const offsetOf = (selection: SelectionLike) => (readSelection(selection) as WithOffset | null)?.offset;

describe("readSelection — the selection carries the offset of its words (P11-09, rule 3; B P11-04 §2.8)", () => {
  const second = SHORE.indexOf("tide pools");
  const first = SHORE.indexOf("Tide pools");

  it("is the length of the paragraph's words before the selection's start: the second of two equal passages is told from the first", () => {
    expect(first).toBe(0);
    expect(second).toBeGreaterThan(20);
    const nodes = [text(SHORE)];
    expect(readSelection(selectOver(nodes, first, first + 10))?.passage).toBe("Tide pools");
    expect(offsetOf(selectOver(nodes, first, first + 10))).toBe(0);
    expect(readSelection(selectOver(nodes, second, second + 10))?.passage).toBe("tide pools");
    expect(offsetOf(selectOver(nodes, second, second + 10))).toBe(second);
  });

  it("leaves the text of a note's tag out of the count, and the marks around words count as the words they hold", () => {
    const at = SHORE.indexOf("snails");
    const nodes = [text(SHORE.slice(0, at)), mark(text("snails")), tag(1), text(SHORE.slice(at + 6, second)), tag(2), text(SHORE.slice(second))];
    expect(textOf(nodes)).toContain("[1]");
    expect(offsetOf(selectOver(nodes, second, second + 10))).toBe(second);
    expect(offsetOf(selectOver(nodes, at, at + 6))).toBe(at);
  });

  it("is told only of the paper's body: a selection in the Summary or an answer has none", () => {
    const sel = readSelection(selectOver([text(SHORE)], 4, 9, "block-a", "summary")) as WithOffset | null;
    expect(sel?.source).toBe("summary");
    expect(sel && "offset" in sel).toBe(false);
  });

  it("is a hint only: a range that cannot give it leaves the selection as it was, and one that throws does not break the read", () => {
    const base = selectOver([text(SHORE)], second, second + 10);
    const range = base.getRangeAt(0) as unknown as Record<string, unknown>;
    const bare: Record<string, unknown> = { ...range, selectNodeContents: undefined, setEnd: undefined };
    bare.cloneRange = () => bare;
    const without = readSelection({ ...base, getRangeAt: () => bare } as unknown as SelectionLike) as WithOffset | null;
    expect(without?.passage).toBe("tide pools");
    expect(without && "offset" in without).toBe(false);
    const throwing: Record<string, unknown> = {
      ...range,
      setEnd: () => {
        throw new Error("the end is outside the node");
      },
    };
    throwing.cloneRange = () => throwing;
    const thrown = readSelection({ ...base, getRangeAt: () => throwing } as unknown as SelectionLike) as WithOffset | null;
    expect(thrown?.passage).toBe("tide pools");
    expect(thrown && "offset" in thrown).toBe(false);
  });

  it("makes two selections of one passage at two places two selections", () => {
    const a = readSelection(selectOver([text(SHORE)], first, first + 10));
    const b = { ...a!, offset: 40 } as ExplainSelection;
    expect(sameSelection(a, a)).toBe(true);
    expect(sameSelection(a, b)).toBe(false);
  });
});
