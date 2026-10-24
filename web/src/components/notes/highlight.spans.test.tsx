import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { el, type TextDomNode } from "@/test-support/fake-text-dom";
import type { Paper } from "@/types";
import { canHighlight, highlightSelection, type HighlightTarget } from "./highlight";
import { useHighlightStrip } from "./highlight-strip";

// P11-50 (found by C P11-47, its §9 item 2; ruling §1h.155 rule 1): Highlight is offered only where it makes a mark. A selection whose two ends are in two
// blocks of one Summary or answer container reaches the page's `canHighlight` with `spansBlocks: true` (set by the selection reader, only when it is true),
// and `canHighlight` is false for it — whatever else the target says, and whether or not the first block happens to hold its words. Nothing else reads the
// field. The margin's button, `h` and the phone's cell all end in `highlightSelection`, which asks `canHighlight` first. No DOM here: the block is a small
// tree (`test-support/fake-text-dom.ts`), `document` and `window` are stubbed. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024" } as unknown as Paper;
const TEXT = "The soil water rose in spring. Later the soil water fell, and the layers dried.";
const BOUNDS = { left: 100, top: 220, right: 220, bottom: 240 };

// `extra` is a loose record on purpose: the field is the fix's, and this file must compile on the commit before it.
const target = (extra: Record<string, unknown> = {}): HighlightTarget =>
  ({
    sectionIndex: -1,
    paragraphIndex: -1,
    passage: "soil water",
    source: "summary",
    paragraphId: "summary-proposal",
    rect: BOUNDS,
    bounds: BOUNDS,
    ...extra,
  }) as HighlightTarget;
const noteOf = () => readingNoteFor(useNotesStore.getState().notes, "p1");
const highlights = () => noteOf()?.blocks.filter((b) => b.type === "highlight") ?? [];

let blocks: Record<string, TextDomNode>;
let log: string[];

beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  useWindows.setState({ windows: [], clock: 0 });
  useHighlightStrip.setState({ id: null, top: 0 });
  log = [];
  blocks = { "summary-proposal": el("div", { id: "summary-proposal" }, TEXT), "answers-block": el("div", { id: "answers-block" }, TEXT) };
  vi.stubGlobal("document", { getElementById: (id: string) => blocks[id] ?? null });
  vi.stubGlobal("window", { getSelection: () => ({ removeAllRanges: () => log.push("cleared"), rangeCount: 0, isCollapsed: true, toString: () => "" }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("canHighlight — a selection that spans two blocks is not offered Highlight (ruling §1h.155 rule 1)", () => {
  it("is false for a Summary block's, an answer's and a paragraph's target that says it spans blocks, whatever else it says", () => {
    expect(canHighlight(target({ spansBlocks: true }))).toBe(false);
    expect(canHighlight(target({ spansBlocks: true, paragraphId: "summary-new-here" }))).toBe(false);
    expect(canHighlight(target({ spansBlocks: true, source: "answer", paragraphId: "answers-block" }))).toBe(false);
    expect(canHighlight(target({ spansBlocks: true, source: "paper", sectionIndex: 1, paragraphIndex: 2, paragraphId: "paper-section-1-p2" }))).toBe(false);
  });

  it("is what it was with no such field: true for the same targets, and for one that is not a block of the page still false", () => {
    expect(canHighlight(target())).toBe(true);
    expect(canHighlight(target({ paragraphId: "summary-new-here" }))).toBe(true);
    expect(canHighlight(target({ source: "answer", paragraphId: "answers-block" }))).toBe(true);
    expect(canHighlight(target({ source: "paper", sectionIndex: 1, paragraphIndex: 2, paragraphId: "paper-section-1-p2" }))).toBe(true);
    expect(canHighlight(target({ paragraphId: "summary" }))).toBe(false);
    expect(canHighlight(target({ passage: "   " }))).toBe(false);
    expect(canHighlight(null)).toBe(false);
  });
});

describe("highlightSelection on a target that spans two blocks", () => {
  const untouched = () => {
    expect(log).toEqual([]);
    expect(useHighlightStrip.getState().id).toBeNull();
    expect(Object.keys(useNotesStore.getState().notes)).toEqual([]);
    expect(useWindows.getState().windows).toEqual([]);
  };

  it("makes nothing even when the first block holds the passage's words: no note, no highlight, the selection left, no strip", () => {
    expect(highlightSelection(target({ spansBlocks: true }), { paper: PAPER })).toBeNull();
    untouched();
    expect(highlights()).toHaveLength(0);
  });

  it("makes nothing in the answers either", () => {
    expect(highlightSelection(target({ spansBlocks: true, source: "answer", paragraphId: "answers-block" }), { paper: PAPER })).toBeNull();
    untouched();
  });

  it("the same words, with no such field, are highlighted as ever (the field alone decides)", () => {
    const made = highlightSelection(target(), { paper: PAPER });
    expect(made).toEqual({ id: expect.any(String), created: true });
    expect(highlights()).toHaveLength(1);
    expect(log).toEqual(["cleared"]);
  });
});
