import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHighlight } from "@/lib/notes/blocks";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import type { Paper } from "@/types";
import { canHighlight, highlightSelection, useHighlight, type HighlightTarget } from "./highlight";
import { useHighlightStrip } from "./highlight-strip";

// P11-07 (owner item 8; B P11-04 §5; ruling §1h.112 D4, D5, D8): "Highlight" on a selection — the paper's note made if needed,
// `addHighlight` at the occurrence the reader selected (Yellow), the browser's selection cleared, the colour strip raised at the
// selection's first line. For the paper's body here; for a Summary block or an answer (P11-28), `highlight.blocks.test.ts`. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024" } as unknown as Paper;
const TEXT = "See the tide pools at dawn. Later the tide pools were bare, and the snails were gone.";
const FIRST = TEXT.indexOf("the tide pools");
const SECOND = TEXT.lastIndexOf("the tide pools");
const BODY = [{ paragraphs: ["Intro."] }, { paragraphs: ["A.", "B.", TEXT] }];
const noteOf = () => readingNoteFor(useNotesStore.getState().notes, "p1");
const highlights = () => noteOf()?.blocks.filter((b) => b.type === "highlight") ?? [];

const BOUNDS = { left: 100, top: 220, right: 220, bottom: 240 };
const target = (extra: Record<string, unknown> = {}): HighlightTarget =>
  ({
    sectionIndex: 1,
    paragraphIndex: 2,
    passage: "the tide pools",
    source: "paper",
    paragraphId: "paper-section-1-p2",
    rect: BOUNDS,
    bounds: BOUNDS,
    ...extra,
  }) as HighlightTarget;

let log: string[];
beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  useWindows.setState({ windows: [], clock: 0 });
  useHighlightStrip.setState({ id: null, top: 0 });
  log = [];
  vi.stubGlobal("window", { getSelection: () => ({ removeAllRanges: () => log.push("cleared") }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("canHighlight", () => {
  it("is offered for a selection in the paper's body — with or without `source`", () => {
    expect(canHighlight(target())).toBe(true);
    expect(canHighlight(target({ source: undefined }))).toBe(true);
  });

  // P11-28 RE-AIM (ruling §1h.123 (c), which amends D8): this test said a Summary and an answer are not offered Highlight. They are now, when the selection names
  // a block of the page (`highlight.blocks.test.ts` holds that, and the ids). What stays true, and is kept here: a Summary or an answer selection that names NO
  // block of the page — the id of a paragraph of the paper under a "summary" source, as this file's `target()` carries — is not offered it, nor is a selection with
  // no paragraph of the body, an empty one, or none.
  it("is not offered for a Summary or an answer selection that names no block of the page, a selection with no paragraph of the body, an empty one, or none", () => {
    expect(canHighlight(target({ source: "summary", sectionIndex: -1, paragraphIndex: -1 }))).toBe(false);
    expect(canHighlight(target({ source: "answer", sectionIndex: -1, paragraphIndex: -1 }))).toBe(false);
    expect(canHighlight(target({ source: "summary" }))).toBe(false);
    expect(canHighlight(target({ sectionIndex: -1 }))).toBe(false);
    expect(canHighlight(target({ paragraphIndex: -1 }))).toBe(false);
    expect(canHighlight(target({ sectionIndex: 1.5 }))).toBe(false);
    expect(canHighlight(target({ passage: "   " }))).toBe(false);
    expect(canHighlight(null)).toBe(false);
    expect(canHighlight(undefined)).toBe(false);
  });
});

describe("highlightSelection — steps 1 to 5", () => {
  const run = (t: HighlightTarget = target(), body: typeof BODY | undefined = BODY) => highlightSelection(t, { paper: PAPER, body });

  it("makes the paper's note without navigating, adds a Yellow highlight, clears the selection and raises the strip at the selection's first line", () => {
    expect(noteOf()).toBeUndefined();
    const made = run(target({ offset: FIRST }));
    expect(made).toEqual({ id: expect.any(String), created: true });
    expect(noteOf()).toBeDefined();
    expect(highlights()).toHaveLength(1);
    expect(readHighlight(highlights()[0])).toEqual({
      paperId: "p1",
      paragraphId: "paper-section-1-p2",
      quote: "the tide pools",
      start: FIRST,
      end: FIRST + 14,
      colour: "yellow",
    });
    expect(log).toEqual(["cleared"]);
    expect(useHighlightStrip.getState()).toMatchObject({ id: made?.id, top: BOUNDS.top });
  });

  it("saves, switches and removes a bold or circled passage in the paper's reading note", () => {
    const t = target({ offset: FIRST });
    const bold = highlightSelection(t, { paper: PAPER, body: BODY, style: "bold" })!;
    expect(readHighlight(highlights()[0])).toMatchObject({ quote: "the tide pools", mark: "bold" });
    expect(noteOf()?.sources).toBeDefined();
    const circle = highlightSelection(t, { paper: PAPER, body: BODY, style: "circle" })!;
    expect(circle).toEqual({ id: bold.id, created: false });
    expect(highlights()).toHaveLength(1);
    expect(readHighlight(highlights()[0])).toMatchObject({ mark: "circle" });
    highlightSelection(t, { paper: PAPER, body: BODY, style: "highlight" });
    expect(readHighlight(highlights()[0])?.mark).toBeUndefined();
    useNotesStore.getState().removeHighlight(noteOf()!.id, bold.id);
    expect(highlights()).toHaveLength(0);
  });

  it("preserves a saved circle through a serialized notes round trip", () => {
    const made = highlightSelection(target({ offset: FIRST }), { paper: PAPER, body: BODY, style: "circle" })!;
    const snapshot = JSON.stringify(useNotesStore.getState().notes);
    useNotesStore.setState({ notes: {} });
    useNotesStore.setState({ notes: JSON.parse(snapshot) });
    expect(readingNoteFor(useNotesStore.getState().notes, PAPER.id)).toBeDefined();
    expect(readHighlight(highlights().find((block) => block.id === made.id))).toMatchObject({ quote: "the tide pools", mark: "circle" });
  });

  it("marks the occurrence the reader selected: the offset picks the second of two", () => {
    run(target({ offset: SECOND }));
    expect(readHighlight(highlights()[0])).toMatchObject({ start: SECOND, end: SECOND + 14 });
    expect(TEXT.slice(SECOND, SECOND + 14)).toBe("the tide pools");
  });

  it("is always Yellow, whatever colour the last highlight was changed to (D4)", () => {
    const first = run(target({ offset: FIRST }))!;
    useNotesStore.getState().setHighlightColour(noteOf()!.id, first.id, "ink");
    run(target({ offset: SECOND }));
    expect(highlights().map((b) => readHighlight(b)?.colour)).toEqual(["ink", "yellow"]);
  });

  it("takes a tag's text out of the passage, as 'Take notes' does", () => {
    run(target({ passage: "the⁠[2] tide pools", offset: FIRST }));
    expect(readHighlight(highlights()[0])?.quote).toBe("the tide pools");
  });

  it("measures the selection's line again, before the selection is cleared", () => {
    const measure = vi.fn(() => {
      log.push("measured");
      return { rect: BOUNDS, bounds: { ...BOUNDS, top: 175 } };
    });
    const made = run(target({ offset: FIRST, measure }));
    expect(log).toEqual(["measured", "cleared"]);
    expect(useHighlightStrip.getState()).toMatchObject({ id: made?.id, top: 175 });
  });

  it("falls back to the bounds it was handed when it cannot measure again", () => {
    run(target({ offset: FIRST, measure: () => null }));
    expect(useHighlightStrip.getState().top).toBe(BOUNDS.top);
  });

  it("for the same words again: the existing highlight, created false — one block, the strip raised for it", () => {
    const first = run(target({ offset: FIRST }))!;
    useHighlightStrip.getState().hide();
    log = [];
    const again = run(target({ offset: FIRST }));
    expect(again).toEqual({ id: first.id, created: false });
    expect(highlights()).toHaveLength(1);
    expect(useHighlightStrip.getState().id).toBe(first.id);
    expect(log).toEqual(["cleared"]);
  });

  it("opens no window, reserves no column and numbers no sticky", () => {
    run(target({ offset: FIRST }));
    run(target({ offset: SECOND }));
    expect(useWindows.getState().windows).toEqual([]);
    expect(noteOf()?.stickyCount ?? 0).toBe(0);
    expect(noteOf()?.blocks.some((b) => b.anchor)).toBe(false);
  });

  it("uses the paper's note that is there, and does not make a second", () => {
    const id = useNotesStore.getState().ensureReadingNote({ id: "p1", title: "A Paper", authors: ["Ann Lee"] });
    run(target({ offset: FIRST }));
    expect(Object.keys(useNotesStore.getState().notes)).toEqual([id]);
    expect(highlights()).toHaveLength(1);
  });
});

describe("highlightSelection — nothing is made", () => {
  const untouched = () => {
    expect(log).toEqual([]);
    expect(useHighlightStrip.getState().id).toBeNull();
  };

  // P11-28 RE-AIM (ruling §1h.123 (c)): was "for a Summary or an answer selection: no note, the selection left, no strip (D8)". A Summary or an answer selection that
  // names a block of the page is highlighted now (`highlight.blocks.test.ts`); one that names none still makes nothing, which is what this keeps.
  it("for a Summary or an answer selection that names no block of the page: no note, the selection left, no strip", () => {
    for (const source of ["summary", "answer"]) {
      expect(highlightSelection(target({ source, sectionIndex: -1, paragraphIndex: -1 }), { paper: PAPER, body: BODY })).toBeNull();
    }
    expect(Object.keys(useNotesStore.getState().notes)).toEqual([]);
    untouched();
  });

  it("when the passage is not found whole in its paragraph: the note made for it is taken away again", () => {
    expect(highlightSelection(target({ passage: "the tide pools and the snails" }), { paper: PAPER, body: BODY })).toBeNull();
    expect(noteOf()).toBeUndefined();
    expect(Object.keys(useNotesStore.getState().notes)).toEqual([]);
    untouched();
  });

  it("when the paper's note was there already, a highlight that cannot be made leaves it as it was", () => {
    useNotesStore.getState().ensureReadingNote({ id: "p1", title: "A Paper", authors: ["Ann Lee"] });
    const before = noteOf();
    expect(highlightSelection(target({ passage: "not in this paragraph" }), { paper: PAPER, body: BODY })).toBeNull();
    expect(noteOf()).toBe(before);
    untouched();
  });

  it("without the body, or without the selection's paragraph in it", () => {
    expect(highlightSelection(target(), { paper: PAPER })).toBeNull();
    expect(highlightSelection(target({ sectionIndex: 9 }), { paper: PAPER, body: BODY })).toBeNull();
    expect(highlightSelection(target({ paragraphIndex: 9 }), { paper: PAPER, body: BODY })).toBeNull();
    expect(Object.keys(useNotesStore.getState().notes)).toEqual([]);
    untouched();
  });
});

describe("useHighlight — the page's onHighlight", () => {
  function hook(input: Parameters<typeof useHighlight>[0]) {
    const got: Array<ReturnType<typeof useHighlight>> = [];
    const Probe = ({ keep }: { keep: (fn: ReturnType<typeof useHighlight>) => void }) => {
      keep(useHighlight(input));
      return null;
    };
    renderToStaticMarkup(createElement(Probe, { keep: (fn) => got.push(fn) }));
    return got[0];
  }

  it("returns a function that highlights the selection it is given in the paper's note", () => {
    const onHighlight = hook({ paper: PAPER, body: BODY });
    expect(onHighlight(target({ offset: SECOND }))).toBeUndefined();
    expect(readHighlight(highlights()[0])).toMatchObject({ quote: "the tide pools", start: SECOND });
    expect(log).toEqual(["cleared"]);
    expect(useHighlightStrip.getState().id).toBe(highlights()[0].id);
  });

  // P11-28 RE-AIM (ruling §1h.123 (c)): was "does nothing for a selection that is not the paper's". It does nothing for a Summary or an answer selection that names no block.
  it("does nothing for a Summary or an answer selection that names no block of the page", () => {
    hook({ paper: PAPER, body: BODY })(target({ source: "answer", sectionIndex: -1, paragraphIndex: -1 }));
    expect(highlights()).toEqual([]);
    expect(log).toEqual([]);
  });
});

describe("a highlight needs no key and no model, and sends nothing (I7)", () => {
  it("has no request in its source", () => {
    for (const file of ["./highlight.tsx", "./highlight-strip.tsx"]) {
      const src = readFileSync(resolve(__dirname, file), "utf8").replace(/\/\/.*$/gm, "");
      expect(src, file).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|\/api\/|apiKey|canAsk|useProfile|model/i);
    }
  });
});
