import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STICKY_QUOTE_MAX, readHighlight } from "@/lib/notes/blocks";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { el, type TextDomNode } from "@/test-support/fake-text-dom";
import type { Paper } from "@/types";
import { canHighlight, highlightSelection, type HighlightTarget } from "./highlight";
import { useHighlightStrip } from "./highlight-strip";
import { takeStickyNote } from "./sticky-note";

// P11-47 (round 3, Theme B walk, weighed (f); ruling §1h.148 rule 1): "Highlight" and "Take notes" take a selection of any length inside one block. A triple click on
// a paragraph of 3,000 characters highlights all 3,000: the note holds them, the strip is raised, the selection is cleared. The paper's body, a Summary block and
// the answers are each tried with a selection over the Explain cap (1,200). A sticky taken on the same words is anchored over all of them, its quote the start.
// No DOM here: the block is a small tree (`test-support/fake-text-dom.ts`), `document` and `window` are stubbed. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024" } as unknown as Paper;

function sentences(n: number, seed = 0): string {
  let out = "";
  for (let k = seed; out.length < n; k += 1) out += `${out ? " " : ""}In plot ${k} the crew counted the invented tide pools twice.`;
  return out;
}
const PASSAGE = sentences(3000);
const TEXT = `Before the passage. ${PASSAGE} After the passage.`;
const AT = TEXT.indexOf(PASSAGE);
const BOUNDS = { left: 100, top: 220, right: 220, bottom: 240 };
const noteOf = () => readingNoteFor(useNotesStore.getState().notes, "p1");
const highlights = () => noteOf()?.blocks.filter((b) => b.type === "highlight") ?? [];

const target = (extra: Record<string, unknown> = {}): HighlightTarget =>
  ({
    sectionIndex: 1,
    paragraphIndex: 2,
    passage: PASSAGE,
    source: "paper",
    paragraphId: "paper-section-1-p2",
    rect: BOUNDS,
    bounds: BOUNDS,
    ...extra,
  }) as HighlightTarget;

let blocks: Record<string, TextDomNode>;
let log: string[];
beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  useWindows.setState({ windows: [], clock: 0 });
  useHighlightStrip.setState({ id: null, top: 0 });
  log = [];
  blocks = {};
  vi.stubGlobal("document", { getElementById: (id: string) => blocks[id] ?? null });
  vi.stubGlobal("window", { getSelection: () => ({ removeAllRanges: () => log.push("cleared"), rangeCount: 0, isCollapsed: true, toString: () => "" }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("Highlight on a long selection in the paper's body", () => {
  const BODY = [{ paragraphs: ["Intro."] }, { paragraphs: ["A.", "B.", TEXT] }];

  it("is offered: the check has no length in it", () => {
    expect(canHighlight(target())).toBe(true);
    expect(canHighlight(target({ passage: sentences(20000) }))).toBe(true);
  });

  it("keeps all 3,000 characters in the note, marks them all, clears the selection and raises the strip", () => {
    const made = highlightSelection(target({ offset: AT }), { paper: PAPER, body: BODY });
    expect(made).toEqual({ id: expect.any(String), created: true });
    expect(highlights()).toHaveLength(1);
    const spot = readHighlight(highlights()[0])!;
    expect(spot.quote).toBe(PASSAGE);
    expect(spot.quote.length).toBeGreaterThan(2999);
    expect([spot.start, spot.end]).toEqual([AT, AT + PASSAGE.length]);
    expect(TEXT.slice(spot.start, spot.end)).toBe(PASSAGE);
    expect(log).toEqual(["cleared"]);
    expect(useHighlightStrip.getState()).toMatchObject({ id: made?.id, top: BOUNDS.top });
  });

  it("is the whole paragraph for a triple click on it", () => {
    const body = [{ paragraphs: ["Intro."] }, { paragraphs: ["A.", "B.", PASSAGE] }];
    highlightSelection(target({ offset: 0 }), { paper: PAPER, body });
    expect(readHighlight(highlights()[0])).toMatchObject({ start: 0, end: PASSAGE.length, quote: PASSAGE });
  });

  it("is made once for the same long range: the second press returns the first", () => {
    const first = highlightSelection(target({ offset: AT }), { paper: PAPER, body: BODY })!;
    const again = highlightSelection(target({ offset: AT }), { paper: PAPER, body: BODY });
    expect(again).toEqual({ id: first.id, created: false });
    expect(highlights()).toHaveLength(1);
  });
});

describe("Highlight on a long selection in a Summary block and in the answers", () => {
  it("highlights a Summary block's 3,000 characters whole, anchored to the block", () => {
    blocks["summary-proposal"] = el("div", { id: "summary-proposal" }, TEXT);
    const made = highlightSelection(target({ source: "summary", sectionIndex: -1, paragraphIndex: -1, paragraphId: "summary-proposal" }), { paper: PAPER });
    expect(made?.created).toBe(true);
    expect(readHighlight(highlights()[0])).toMatchObject({ paragraphId: "summary-proposal", quote: PASSAGE, start: AT, end: AT + PASSAGE.length, colour: "yellow" });
    expect(log).toEqual(["cleared"]);
  });

  it("highlights an answer's 2,000 characters whole, anchored to the answers' block", () => {
    const answer = sentences(2000);
    blocks["answers-block"] = el("section", { id: "answers-block" }, el("p", {}, "Does the layer hold water?"), el("p", {}, answer));
    const made = highlightSelection(target({ source: "answer", sectionIndex: -1, paragraphIndex: -1, paragraphId: "answers-block", passage: answer }), { paper: PAPER });
    expect(made?.created).toBe(true);
    expect(readHighlight(highlights()[0])).toMatchObject({ paragraphId: "answers-block", quote: answer });
  });
});

describe("Take notes on a long selection (the sticky's anchor)", () => {
  it("anchors the sticky over all 3,000 characters; its quote is the passage's start, at most 300 characters, as for a short selection", () => {
    const made = takeStickyNote({ ...target(), paragraphText: TEXT }, { id: "p1", title: "A Paper", authors: ["Ann Lee"] });
    expect(made).toMatchObject({ n: 1 });
    const anchor = noteOf()!.blocks.find((b) => b.anchor)!.anchor!;
    expect(anchor.quote.length).toBeLessThanOrEqual(STICKY_QUOTE_MAX);
    expect(PASSAGE.startsWith(anchor.quote)).toBe(true);
    expect(TEXT.slice(anchor.start, anchor.end)).toBe(PASSAGE);
    expect(useWindows.getState().windows.map((w) => w.kind)).toEqual(["sticky"]);
  });
});
