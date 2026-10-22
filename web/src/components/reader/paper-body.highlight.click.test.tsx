import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// P11-09 (owner item 8; B P11-04 §3.3): a click on a highlight's mark, with a collapsed selection, tells the page
// (`onHighlightClick(id, rect)`, which raises the colour strip); a drag that ends on a mark is a selection, not a click.
// The wiring is read off the element tree `PaperBody` returns, run on the minimal hook runtime (this project's Vitest has
// no DOM); what a click means for a given target is `highlightClickOf`'s, tested in `paper-body.highlight.test.tsx`.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import type { Paper } from "@/types";
import { PAPER_BODY_ID, PaperBody, paragraphAnchor, type ViewRect } from "./paper-body";

const paper: Paper = {
  id: "p1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const doc: ExtractedDocument = {
  source: "pdf", pageCount: 2, figureCaptions: [], equations: [],
  sections: [{ id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life.\n\nGrain boundaries carry the strain.", page: 1 }],
};
const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } };
const reading = buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));
const P1 = "Grain boundaries carry the strain.";
const spot = { id: "h1", n: 0, start: 0, end: 16, quote: P1.slice(0, 16), colour: "yellow", order: 0 };

interface FakeEl {
  nodeType: 1;
  tag: string;
  attrs: Record<string, string>;
  parentElement: FakeEl | null;
  children: FakeEl[];
  closest(selector: string): FakeEl | null;
  querySelectorAll(selector: string): FakeEl[];
  getAttribute(name: string): string | null;
  getClientRects(): ViewRect[];
  getBoundingClientRect(): ViewRect;
}
/** A selector list of `tag`, `tag[attr]` and `tag[attr="value"]` terms. */
function matches(node: FakeEl, selector: string): boolean {
  return selector.split(",").some((term) => {
    const m = /^\s*([a-z]+)?(?:\[([a-z-]+)(?:="([^"]*)")?\])?\s*$/.exec(term);
    if (!m) return false;
    const [, tag, attr, value] = m;
    if (tag && node.tag !== tag) return false;
    if (attr && !(attr in node.attrs)) return false;
    return !(attr && value !== undefined && node.attrs[attr] !== value);
  });
}
function el(tag: string, attrs: Record<string, string>, parent: FakeEl | null, rect: ViewRect): FakeEl {
  const self: FakeEl = {
    nodeType: 1, tag, attrs, parentElement: parent, children: [],
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
    getClientRects: () => [rect],
    getBoundingClientRect: () => rect,
  };
  parent?.children.push(self);
  return self;
}
const RECT: ViewRect = { left: 20, top: 100, right: 220, bottom: 120 };
const p = el("p", {}, null, RECT);
const highlight = el("mark", { "data-highlight": "h1" }, p, RECT);
const stickyOnly = el("mark", { "data-note": "1" }, p, { left: 20, top: 140, right: 80, bottom: 160 });

type Click = (event: { target: unknown }) => void;
async function mountBody(onHighlightClick?: (id: string, rect: ViewRect) => void) {
  const props = { reading, noteAnchors: { [paragraphAnchor(0, 1)]: [spot] }, ...(onHighlightClick ? { onHighlightClick } : {}) };
  const mounted = await hookRuntime.mount(() => PaperBody(props as unknown as Parameters<typeof PaperBody>[0]));
  return mounted.value as unknown as ReactElement<{ id?: string; onClick?: Click }>;
}
const selecting = (isCollapsed: boolean | null) => vi.stubGlobal("window", { getSelection: () => (isCollapsed === null ? null : { isCollapsed }) });

describe("PaperBody — onHighlightClick (P11-09, rule 2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is told the highlight's id and its first line when a click lands on its mark with a collapsed selection", async () => {
    const told = vi.fn();
    const root = await mountBody(told);
    expect(root.props.id).toBe(PAPER_BODY_ID);
    selecting(true);
    root.props.onClick!({ target: highlight });
    expect(told).toHaveBeenCalledTimes(1);
    expect(told).toHaveBeenCalledWith("h1", RECT);
  });

  it("is told on a click when the page has no selection to ask", async () => {
    const told = vi.fn();
    const root = await mountBody(told);
    selecting(null);
    root.props.onClick!({ target: highlight });
    expect(told).toHaveBeenCalledWith("h1", RECT);
  });

  it("is not told when the selection is not collapsed: a drag that ends on the mark stays a selection", async () => {
    const told = vi.fn();
    const root = await mountBody(told);
    selecting(false);
    root.props.onClick!({ target: highlight });
    expect(told).not.toHaveBeenCalled();
  });

  it("is not told of a click anywhere that is no highlight's mark", async () => {
    const told = vi.fn();
    const root = await mountBody(told);
    selecting(true);
    root.props.onClick!({ target: stickyOnly });
    root.props.onClick!({ target: p });
    expect(told).not.toHaveBeenCalled();
  });

  it("puts no click handler on the body when the page asked for none, so the body is what it was", async () => {
    const root = await mountBody();
    expect(root.props.onClick).toBeUndefined();
  });
});
