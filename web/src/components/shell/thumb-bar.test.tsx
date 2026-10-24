import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P9-41 (ruling §1h.66; C P9-20's checkpoint §7 / §8 item 1): below 768 px the "Explain this" control stood as a floating pill
// 8 px above the thumb bar and still covered 1,790 to 2,473 px² of the words that scroll under that corner. It is the bar's own
// cell now: while a settled selection is on offer (the explain box says so through `explain-offer.ts`) the rail's centre cell, where
// "3 of 10" stands, gives way to it — 44 px tall, in thumb reach, with the pill's name and the pill's action — and ← Briefing and
// Next → keep their places. When the selection collapses or leaves the screen the cell goes and the rail is as it was.
// No DOM in this project's Vitest: the bar is rendered to markup (the pixels are measured in a browser, in the checkpoint), and the
// cell's handlers are read off its element.

// The bar reads the router and the feed store. A server render reads a zustand store's INITIAL state (an empty briefing, no "3 of 10"),
// so the store is stood in for here: the briefing the rail counts in is the one the test sets.
let pathname = "/papers/p3";
let briefing: Paper[] = [];
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/store/feed", () => ({
  useFeedStore: (select: (state: { papers: Paper[]; savedPapers: Paper[] }) => unknown) => select({ papers: briefing, savedPapers: [] }),
}));

import { EXPLAIN } from "@/components/reader/copy";
import { registerReaderActions } from "@/lib/reader/reader-keys";
import { setExplainOffer, setHighlightOffer } from "@/lib/reader/explain-offer";
import type { Paper } from "@/types";
import { ThumbBar } from "./thumb-bar";
import { ExplainCell, HighlightCell } from "./thumb-bar";

const paper = (id: string) => ({ id, title: `Paper ${id}` }) as unknown as Paper;
const render = () => renderToStaticMarkup(createElement(ThumbBar));

/** The first opening tag of `tag` carrying `contains`, and its class tokens. */
const open = (html: string, tag: string, contains = "") =>
  (html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? []).find((t) => t.includes(contains)) ?? "";
const classes = (tagText: string) => (/\bclass="([^"]*)"/.exec(tagText)?.[1] ?? "").split(/\s+/).filter(Boolean);
/** The explain cell's own tag. */
const cell = (html: string) => open(html, "button", "data-explain-ask");

beforeEach(() => {
  pathname = "/papers/p3";
  briefing = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"].map(paper);
  setExplainOffer(false);
});
afterEach(() => {
  setExplainOffer(false);
  briefing = [];
});

describe("the thumb bar's rail — the Explain control stands in it only while a settled selection is on offer (P9-41, §1h.66)", () => {
  it("is the rail it was while nothing is on offer: ← Briefing, 3 of 10, Next → — and no Explain control", () => {
    const html = render();

    expect(html).toContain("← Briefing");
    expect(html).toContain("3 of 10");
    expect(html).toContain("Next →");
    expect(html).not.toContain(EXPLAIN.ask);
    expect(cell(html)).toBe("");
  });

  it("holds the control as a cell while a selection is on offer: the pill's accessible name, a 44 px target that no hover gates", () => {
    setExplainOffer(true);
    const html = render();
    const tag = cell(html);

    expect(tag).not.toBe("");
    expect(tag).toContain('type="button"');
    // The same name the floating pill had: its text (a button's name is its content).
    expect(html).toContain(`>${EXPLAIN.ask}</button>`);
    // 44 px: `min-h-11` (2.75rem), bare — not behind `[@media(hover:none)]`, because the bar is a touch surface by position.
    expect(classes(tag)).toContain("min-h-11");
    expect(tag).not.toContain("hover:none");
  });

  // P11-13 (rule 3; B P11-03 §2.5; ruling §1h.113 (b) O-5) re-aims this test, which pinned P9-41's three-column rail (← Briefing,
  // the control in the middle, Next →): while a selection is on offer the rail IS the cells, and "Briefing" returns when it goes.
  it("gives the whole rail to the cells while a selection is on offer: the position text, ← Briefing and Next → wait, the control takes the bar", () => {
    setExplainOffer(true);
    const html = render();

    expect(html).not.toContain("3 of 10");
    expect(html).not.toContain("← Briefing");
    expect(html).not.toContain("Next →");
    expect(cell(html)).not.toBe("");
    // Alone it is the whole width of the rail, not a pill in column 2.
    expect(classes(cell(html))).toContain("w-full");
    expect(classes(cell(html))).not.toContain("col-start-2");
  });

  it("leaves when the selection clears: the rail is the very markup it was before the selection", () => {
    const before = render();

    setExplainOffer(true);
    expect(render()).not.toBe(before);
    expect(render()).toContain(EXPLAIN.ask);

    setExplainOffer(false);
    expect(render()).toBe(before);
  });

  // P11-13 re-aims the middle of this test: ← Briefing is not drawn while the control is (it returns with the rail below).
  it("stands in a rail with no position too (an uploaded PDF, a deep link): the control, and the way back once the selection goes", () => {
    pathname = "/papers/upload%3Aabc123";
    setExplainOffer(true);
    const html = render();

    expect(html).toContain(EXPLAIN.ask);
    expect(html).not.toContain("← Briefing");
    expect(html).not.toContain("Next →");
    expect(html).not.toMatch(/\d+ of \d+/);
    // …and without a selection that rail is the way back alone.
    setExplainOffer(false);
    expect(render()).not.toContain(EXPLAIN.ask);
    expect(render()).toContain("← Briefing");
    expect(render()).not.toContain("Next →");
  });

  it("is the paper's rail alone: the four tabs never carry it, whatever is on offer", () => {
    setExplainOffer(true);
    for (const path of ["/", "/search", "/saved", "/profile"]) {
      pathname = path;
      const html = render();

      expect(html, path).not.toContain(EXPLAIN.ask);
      expect(html, path).toContain("Today");
    }
  });

  it("is part of the bar that exists under 768 px: the whole nav is `md:hidden`, fixed to the window's foot", () => {
    setExplainOffer(true);
    const nav = classes(open(render(), "nav"));

    expect(nav).toEqual(expect.arrayContaining(["md:hidden", "fixed", "bottom-0"]));
  });
});

describe("the cell's press — what the floating pill did (P9-41, §1h.66)", () => {
  const props = (element: ReactElement) => element.props as { onClick: () => void; onMouseDown: (event: { preventDefault: () => void }) => void; children: string; "data-explain-ask": string };

  it("calls the page's `explain` action — what the `e` key and the pill call: it opens the explain window for the selection", () => {
    const explain = vi.fn();
    const stop = registerReaderActions({ explain });

    props(ExplainCell()).onClick();

    expect(explain).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does nothing, and does not throw, where the page has registered no `explain` (not a paper with a body)", () => {
    const stop = registerReaderActions({ next: vi.fn() });

    expect(() => props(ExplainCell()).onClick()).not.toThrow();
    stop();
    expect(() => props(ExplainCell()).onClick()).not.toThrow();
  });

  it("does not take the selection with its press: the mouse-down is cancelled, as the pill's was (it is what is explained)", () => {
    const preventDefault = vi.fn();

    props(ExplainCell()).onMouseDown({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("is marked as the Explain control, as the pill and the window's header control are, and says the pill's words", () => {
    const element = props(ExplainCell());

    expect(element["data-explain-ask"]).toBe("");
    expect(element.children).toBe(EXPLAIN.ask);
  });
});

// ── P11-13 (rule 3; owner item 8; B P11-03 §2.5; ruling §1h.113 (b) O-5) ─────────────────────────────────────────────────────
// Under 768 px the bar shows the cells that stand for the selection's actions while a selection is on offer: [Explain this?] when
// the explain box says so, [Highlight] when the selection toolbar does (`explain-offer.ts`'s two flags). Each is at least 44 px
// tall and one share of the bar's width; "← Briefing" and the rest of the rail come back when the selection goes. Take notes on a
// phone stays deferred.
describe("the thumb bar's cells — [Explain this] [Highlight] while a selection is on offer (P11-13, rule 3; O-5)", () => {
  beforeEach(() => setHighlightOffer(false));
  afterEach(() => setHighlightOffer(false));
  const highlightCell = (html: string) => open(html, "button", "data-highlight-ask");

  it("shows the Highlight cell alone when only a highlight is on offer (a selection the page cannot explain), and no Explain cell", () => {
    setHighlightOffer(true);
    const html = render();

    expect(highlightCell(html)).not.toBe("");
    expect(html).toContain(">Highlight</button>");
    expect(cell(html)).toBe("");
    expect(html).not.toContain("← Briefing");
    expect(html).not.toContain("Next →");
    expect(html).not.toContain("3 of 10");
  });

  it("shows both, Explain this first and Highlight second, each its share of the rail, when both are on offer", () => {
    setExplainOffer(true);
    setHighlightOffer(true);
    const html = render();

    expect(cell(html)).not.toBe("");
    expect(highlightCell(html)).not.toBe("");
    expect(html.indexOf(EXPLAIN.ask)).toBeLessThan(html.indexOf(">Highlight</button>"));
    const row = open(html, "div", "grid-cols-2");
    expect(row).not.toBe("");
    for (const tag of [cell(html), highlightCell(html)]) expect(classes(tag)).toContain("w-full");
    expect(html).not.toContain("← Briefing");
  });

  it("makes each cell a 44 px target that no hover gates", () => {
    setExplainOffer(true);
    setHighlightOffer(true);
    const html = render();

    for (const tag of [cell(html), highlightCell(html)]) {
      expect(tag).toContain('type="button"');
      expect(classes(tag)).toContain("min-h-11");
      expect(tag).not.toContain("hover:none");
    }
  });

  it("is the rail it was when both go: the markup before the selection, 'Briefing' back", () => {
    const before = render();

    setHighlightOffer(true);
    expect(render()).not.toBe(before);
    setExplainOffer(true);
    setHighlightOffer(false);
    expect(render()).not.toBe(before);

    setExplainOffer(false);
    expect(render()).toBe(before);
    expect(before).toContain("← Briefing");
  });

  it("is the paper's rail alone: the four tabs never carry the cells", () => {
    setExplainOffer(true);
    setHighlightOffer(true);
    for (const path of ["/", "/search", "/saved", "/profile"]) {
      pathname = path;
      const html = render();
      expect(html, path).not.toContain("Highlight");
      expect(html, path).toContain("Today");
    }
  });

  it("is part of the bar that exists under 768 px", () => {
    setHighlightOffer(true);
    expect(classes(open(render(), "nav"))).toEqual(expect.arrayContaining(["md:hidden", "fixed", "bottom-0"]));
  });

  describe("the Highlight cell's press", () => {
    const props = (element: ReactElement) => element.props as { onClick: () => void; onMouseDown: (event: { preventDefault: () => void }) => void; children: string; "data-highlight-ask": string };

    it("calls the page's `highlight` action — what the h key calls", () => {
      const highlight = vi.fn();
      const stop = registerReaderActions({ highlight });

      props(HighlightCell()).onClick();

      expect(highlight).toHaveBeenCalledTimes(1);
      stop();
    });

    it("does nothing, and does not throw, where the page has registered no `highlight`", () => {
      const stop = registerReaderActions({ next: vi.fn() });

      expect(() => props(HighlightCell()).onClick()).not.toThrow();
      stop();
      expect(() => props(HighlightCell()).onClick()).not.toThrow();
    });

    it("does not take the selection with its press, and is marked and named as the Highlight control", () => {
      const preventDefault = vi.fn();
      const element = props(HighlightCell());

      element.onMouseDown({ preventDefault });

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(element["data-highlight-ask"]).toBe("");
      expect(element.children).toBe("Highlight");
    });
  });
});
