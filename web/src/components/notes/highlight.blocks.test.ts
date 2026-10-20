import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHighlight } from "@/lib/notes/blocks";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { el, rangeStartingAt, textNodesOf, type TextDomNode } from "@/test-support/fake-text-dom";
import type { Paper } from "@/types";
import { canHighlight, highlightSelection, useHighlight, type HighlightTarget } from "./highlight";
import { useHighlightStrip } from "./highlight-strip";

// P11-28 (owner item 8; round 1 Theme B readers r1, r2; ruling §1h.123 (c), which amends D8 of §1h.112): "Highlight" is offered on a Summary block and on an
// answer, with and without a key, as on a paragraph of the paper: the margin's button, `h` and the phone's cell all call `canHighlight` and `highlightSelection`.
// The block is not a paragraph of the paper, so its words are not in the body the page hands over: they are read from the block's element, by the id the
// selection reports for it (`paragraphId`: `summary-…`, or `answers-block`). Where the block is not on the page, nothing is made. No DOM here: the block is a
// small tree (`test-support/fake-text-dom.ts`), `document` and `window` are stubbed. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024" } as unknown as Paper;
const TEXT = "The soil water rose in spring. Later the soil water fell, and the layers dried.";
const FIRST = TEXT.indexOf("soil water");
const SECOND = TEXT.lastIndexOf("soil water");
const BOUNDS = { left: 100, top: 220, right: 220, bottom: 240 };

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
let live: { text: string; node: TextDomNode; offset: number; root: TextDomNode } | null;
let log: string[];

beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  useWindows.setState({ windows: [], clock: 0 });
  useHighlightStrip.setState({ id: null, top: 0 });
  log = [];
  blocks = { "summary-proposal": el("div", { id: "summary-proposal" }, TEXT) };
  live = null;
  vi.stubGlobal("document", { getElementById: (id: string) => blocks[id] ?? null });
  vi.stubGlobal("window", {
    getSelection: () => ({
      removeAllRanges: () => log.push("cleared"),
      get rangeCount() {
        return live ? 1 : 0;
      },
      get isCollapsed() {
        return live === null;
      },
      toString: () => live?.text ?? "",
      getRangeAt: () => rangeStartingAt(live!.root, live!.node, live!.offset),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("canHighlight — D8 amended: a Summary block and an answer are offered Highlight", () => {
  it("is offered for a selection in a Summary block, or in the answers, by the id the selection reports for the block", () => {
    expect(canHighlight(target())).toBe(true);
    expect(canHighlight(target({ paragraphId: "summary-new-here" }))).toBe(true);
    expect(canHighlight(target({ source: "answer", paragraphId: "answers-block" }))).toBe(true);
    // a paper with no body shows its answers inside the Summary's container: the source says "summary", the block is the answers'
    expect(canHighlight(target({ source: "summary", paragraphId: "answers-block" }))).toBe(true);
  });

  it("is not offered for a selection that names no block of the page — a bare kind, no id, a paragraph's id under a Summary source — nor an empty one", () => {
    for (const paragraphId of ["summary", "answer", "", undefined, "paper-section-1-p2", "answers"]) {
      expect(canHighlight(target({ paragraphId })), String(paragraphId)).toBe(false);
    }
    expect(canHighlight(target({ passage: "   " }))).toBe(false);
    expect(canHighlight(null)).toBe(false);
  });

  it("is the paper's body's rule, unchanged, for a paragraph", () => {
    const paragraph = { sectionIndex: 1, paragraphIndex: 2, passage: "tide pools", source: "paper" as const, paragraphId: "paper-section-1-p2" };
    expect(canHighlight(paragraph)).toBe(true);
    expect(canHighlight({ ...paragraph, source: undefined })).toBe(true);
    expect(canHighlight({ ...paragraph, sectionIndex: -1 })).toBe(false);
  });
});

describe("highlightSelection on a Summary block", () => {
  it("makes the paper's note, adds a Yellow highlight on the block's words with the id the selection reported, clears the selection and raises the strip at the first line", () => {
    expect(noteOf()).toBeUndefined();
    const made = highlightSelection(target(), { paper: PAPER });
    expect(made).toEqual({ id: expect.any(String), created: true });
    expect(highlights()).toHaveLength(1);
    expect(readHighlight(highlights()[0])).toEqual({ paperId: "p1", paragraphId: "summary-proposal", quote: "soil water", start: FIRST, end: FIRST + 10, colour: "yellow" });
    expect(log).toEqual(["cleared"]);
    expect(useHighlightStrip.getState()).toMatchObject({ id: made?.id, top: BOUNDS.top });
  });

  it("opens no window, numbers no sticky and sends nothing: the highlight is a block of the note", () => {
    highlightSelection(target(), { paper: PAPER });
    expect(useWindows.getState().windows).toEqual([]);
    expect(noteOf()?.stickyCount ?? 0).toBe(0);
    expect(noteOf()?.blocks.some((b) => b.anchor)).toBe(false);
  });

  it("marks the occurrence the reader selected: the live selection says where it began", () => {
    const [node] = textNodesOf(blocks["summary-proposal"]);
    live = { text: "soil water", node, offset: SECOND, root: blocks["summary-proposal"] };
    highlightSelection(target(), { paper: PAPER });
    expect(readHighlight(highlights()[0])).toMatchObject({ start: SECOND, end: SECOND + 10 });
  });

  it("takes the offset the selection reader gave, when it gave one, before it looks at the live selection", () => {
    const [node] = textNodesOf(blocks["summary-proposal"]);
    live = { text: "soil water", node, offset: FIRST, root: blocks["summary-proposal"] };
    highlightSelection(target({ offset: SECOND }), { paper: PAPER });
    expect(readHighlight(highlights()[0])).toMatchObject({ start: SECOND });
  });

  it("ignores a live selection that is not the one it was handed (the reader selected something else since): the first occurrence", () => {
    const [node] = textNodesOf(blocks["summary-proposal"]);
    live = { text: "layers dried", node, offset: SECOND, root: blocks["summary-proposal"] };
    highlightSelection(target(), { paper: PAPER });
    expect(readHighlight(highlights()[0])).toMatchObject({ start: FIRST });
  });

  it("takes the first occurrence when the selection is gone (a phone's cell can be pressed after it collapsed)", () => {
    highlightSelection(target(), { paper: PAPER });
    expect(readHighlight(highlights()[0])).toMatchObject({ start: FIRST });
  });

  it("for the same words again: the existing highlight, created false — one block, the strip raised for it", () => {
    const first = highlightSelection(target(), { paper: PAPER })!;
    useHighlightStrip.getState().hide();
    const again = highlightSelection(target(), { paper: PAPER });
    expect(again).toEqual({ id: first.id, created: false });
    expect(highlights()).toHaveLength(1);
    expect(useHighlightStrip.getState().id).toBe(first.id);
  });

  it("measures the selection's line again before the selection is cleared, as it does for a paragraph's", () => {
    const measure = vi.fn(() => {
      log.push("measured");
      return { rect: BOUNDS, bounds: { ...BOUNDS, top: 175 } };
    });
    const made = highlightSelection(target({ measure }), { paper: PAPER });
    expect(log).toEqual(["measured", "cleared"]);
    expect(useHighlightStrip.getState()).toMatchObject({ id: made?.id, top: 175 });
  });
});

describe("highlightSelection on the answers", () => {
  const ANSWERS = () =>
    el(
      "section",
      { id: "answers-block" },
      el("button", {}, "Answers generated by AI based on this paper"),
      el("div", {}, el("p", {}, "Does the layer hold water?"), el("p", {}, "Answered."), el("ul", {}, el("li", {}, el("p", {}, "Peer says the layer held water."), el("p", {}, "It held water in every plot.")))),
    );

  it("highlights words of an answer, anchored to the answers' block", () => {
    blocks["answers-block"] = ANSWERS();
    const made = highlightSelection(target({ source: "answer", paragraphId: "answers-block", passage: "held water in every plot" }), { paper: PAPER });
    expect(made?.created).toBe(true);
    const words = "Answers generated by AI based on this paper Does the layer hold water? Answered. Peer says the layer held water. It held water in every plot.";
    expect(readHighlight(highlights()[0])).toMatchObject({ paragraphId: "answers-block", quote: "held water in every plot", start: words.indexOf("held water in every plot"), colour: "yellow" });
  });

  it("highlights a selection that runs from an answer into the quote under it: the lines of a block are one space apart", () => {
    blocks["answers-block"] = ANSWERS();
    const made = highlightSelection(target({ source: "answer", paragraphId: "answers-block", passage: "the layer held water. It held water" }), { paper: PAPER });
    expect(made?.created).toBe(true);
    expect(readHighlight(highlights()[0])?.quote).toBe("the layer held water. It held water");
  });
});

describe("highlightSelection where it makes nothing", () => {
  const untouched = () => {
    expect(log).toEqual([]);
    expect(useHighlightStrip.getState().id).toBeNull();
    expect(Object.keys(useNotesStore.getState().notes)).toEqual([]);
  };

  it("when the block is not on the page (an answer after a reload, a Summary before its report is drawn): no note, the selection left, no strip, no error", () => {
    expect(highlightSelection(target({ source: "answer", paragraphId: "answers-block" }), { paper: PAPER })).toBeNull();
    untouched();
  });

  it("when the block has not the selection's words: the note made for it is taken away again", () => {
    expect(highlightSelection(target({ passage: "words the block never held" }), { paper: PAPER })).toBeNull();
    untouched();
  });

  it("for a Summary or an answer selection that names no block of the page", () => {
    for (const source of ["summary", "answer"]) {
      expect(highlightSelection(target({ source, paragraphId: undefined }), { paper: PAPER })).toBeNull();
      expect(highlightSelection(target({ source, paragraphId: "paper-section-1-p2" }), { paper: PAPER })).toBeNull();
    }
    untouched();
  });

  it("when the paper's note was there already, it is left as it was", () => {
    useNotesStore.getState().ensureReadingNote({ id: "p1", title: "A Paper", authors: ["Ann Lee"] });
    const before = noteOf();
    expect(highlightSelection(target({ passage: "words the block never held" }), { paper: PAPER })).toBeNull();
    expect(noteOf()).toBe(before);
    expect(log).toEqual([]);
  });
});

describe("useHighlight — the page's onHighlight", () => {
  it("highlights a Summary block's selection like any other, in the paper's note", () => {
    const got: Array<ReturnType<typeof useHighlight>> = [];
    const Probe = () => {
      got.push(useHighlight({ paper: PAPER }));
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    expect(got[0](target())).toBeUndefined();
    expect(readHighlight(highlights()[0])).toMatchObject({ paragraphId: "summary-proposal", quote: "soil water" });
  });
});
