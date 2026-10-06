import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P3-02 (ruling §1h.2; user decision §1a.10): the body offers "Explain this?"
// for a selection of up to one paragraph's worth of the paper's own words —
// two ends in one paragraph, non-empty, at most 1,200 characters, no drawn
// formula — and for nothing else. `selectionTarget` is the pure rule;
// `readSelection` reads it off the DOM's selection (a stand-in here: this
// project's Vitest has no DOM); the listener is `PaperBody`'s own effect, run
// on the minimal hook runtime. The body's markup is not touched: the existing
// paper-body tests pin it, and the last test here pins that a listener changes
// nothing in what renders.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import type { PaperReading } from "@/lib/papers/reading";
import {
  MAX_SELECTION_CHARS,
  PaperBody,
  SELECTION_DEBOUNCE_MS,
  paragraphAnchor,
  readSelection,
  selectionTarget,
  type ExplainSelection,
  type SelectionLike,
} from "./paper-body";

describe("selectionTarget — the pure rule", () => {
  const id = paragraphAnchor(2, 3);

  it("is the paragraph and the words when both ends sit in one paragraph", () => {
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: "the rafting ratio" })).toEqual({
      sectionIndex: 2,
      paragraphIndex: 3,
      passage: "the rafting ratio",
    });
  });

  it("collapses the whitespace a selection carries across a line break", () => {
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: "  the  rafting\n ratio \t" })?.passage).toBe("the rafting ratio");
  });

  it("is nothing across two paragraphs, or when an end is in none", () => {
    expect(selectionTarget({ anchorParagraphId: paragraphAnchor(2, 3), focusParagraphId: paragraphAnchor(2, 4), text: "x" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: paragraphAnchor(2, 3), focusParagraphId: paragraphAnchor(1, 3), text: "x" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: null, text: "x" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: null, focusParagraphId: id, text: "x" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: null, focusParagraphId: null, text: "x" })).toBeNull();
  });

  it("is nothing for an id that is not a paragraph's", () => {
    expect(selectionTarget({ anchorParagraphId: "paper-section-2", focusParagraphId: "paper-section-2", text: "x" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: "other-p3", focusParagraphId: "other-p3", text: "x" })).toBeNull();
  });

  it("is nothing for an empty selection, or one that is only whitespace", () => {
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: "" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: " \n\t " })).toBeNull();
  });

  it("allows 1,200 characters and nothing longer", () => {
    expect(MAX_SELECTION_CHARS).toBe(1200);
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: "x".repeat(1200) })).not.toBeNull();
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: "x".repeat(1201) })).toBeNull();
    // Counted after the whitespace is collapsed, as the server counts it.
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: `${"x ".repeat(500)}\n\n\n      ${"y ".repeat(50)}` })).not.toBeNull();
  });
});

// ── A DOM, as far as the reading needs one ──────────────────────────────

type Rect = { left: number; top: number; right: number; bottom: number };
const BODY_SELECTOR = "#paper-body";

interface StubElement {
  id: string;
  nodeType: number;
  parentElement: StubElement | null;
  tag: string;
  inBody: boolean;
  closest(selector: string): StubElement | null;
}

function element(tag: string, id: string, parent: StubElement | null, inBody = true): StubElement {
  const self: StubElement = {
    id,
    nodeType: 1,
    parentElement: parent,
    tag,
    inBody,
    closest(selector) {
      if (selector === BODY_SELECTOR) return inBody ? self : null;
      if (selector === "p") {
        for (let at: StubElement | null = self; at; at = at.parentElement) if (at.tag === "p") return at;
        return null;
      }
      return null;
    },
  };
  return self;
}

/** A paragraph as the body renders it: its anchor `div` holding the `<p>`. */
function paragraph(k: number, i: number, inBody = true) {
  const host = element("div", paragraphAnchor(k, i), null, inBody);
  const p = element("p", "", host, inBody);
  return { host, p, text: { nodeType: 3, parentElement: p } };
}

interface StubNode {
  nodeType: number;
  parentElement: StubElement | null;
}

function range(
  source: Rect[] | (() => Rect[]),
  over: { start?: StubNode; end?: StubNode; endOffset?: number; hasFormula?: boolean } = {},
) {
  const rects = () => (typeof source === "function" ? source() : source);
  const one = paragraph(1, 2);
  const made = {
    startContainer: over.start ?? one.text,
    endContainer: over.end ?? one.text,
    endOffset: over.endOffset ?? 17,
    cloneRange: () => made,
    cloneContents: () => ({ querySelector: (selector: string) => (over.hasFormula && selector.includes(".katex") ? {} : null) }),
    getClientRects: () => rects(),
    getBoundingClientRect: () => rects()[0] ?? { left: 0, top: 0, right: 0, bottom: 0 },
  };
  return made;
}

const TWO_LINES: Rect[] = [{ left: 100, top: 200, right: 160, bottom: 220 }, { left: 40, top: 224, right: 120, bottom: 244 }];

/** The DOM's selection, with its range's two ends in the given nodes. */
function selection(
  over: { start?: StubNode; end?: StubNode; endOffset?: number; text?: string; rects?: Rect[] | (() => Rect[]); hasFormula?: boolean; isCollapsed?: boolean; rangeCount?: number } = {},
): SelectionLike {
  const made = range(over.rects ?? TWO_LINES, over);
  return {
    rangeCount: over.rangeCount ?? 1,
    isCollapsed: over.isCollapsed ?? false,
    toString: () => over.text ?? "the rafting ratio",
    getRangeAt: () => made,
  };
}

describe("readSelection — what the page's selection is", () => {
  it("is the target with where it ends on screen: its last line", () => {
    const read = readSelection(selection());

    expect(read).toMatchObject({ sectionIndex: 1, paragraphIndex: 2, passage: "the rafting ratio", rect: { left: 40, top: 224, right: 120, bottom: 244 } });
  });

  it("also gives the box of all its lines, for a card that must stand clear of every word", () => {
    expect(readSelection(selection())?.bounds).toEqual({ left: 40, top: 200, right: 160, bottom: 244 });
    expect(readSelection(selection({ rects: [{ left: 5, top: 6, right: 70, bottom: 26 }] }))?.bounds).toEqual({ left: 5, top: 6, right: 70, bottom: 26 });
  });

  it("can measure itself again, from the range it kept, after the page has scrolled", () => {
    let rects: Rect[] = [{ left: 10, top: 300, right: 90, bottom: 320 }];
    const read = readSelection(selection({ rects: () => rects }));
    expect(read?.rect).toEqual({ left: 10, top: 300, right: 90, bottom: 320 });

    // The page scrolls: the kept range is measured again, and the first reading stays as it was.
    rects = [{ left: 10, top: 100, right: 90, bottom: 120 }];
    const again = read?.measure?.();
    expect(again?.rect).toEqual({ left: 10, top: 100, right: 90, bottom: 120 });
    expect(again?.bounds).toEqual({ left: 10, top: 100, right: 90, bottom: 120 });
    expect(read?.rect.top).toBe(300);
  });

  it("measures null once the kept range has no size (it scrolled out of the document)", () => {
    let rects: Rect[] = [{ left: 10, top: 300, right: 90, bottom: 320 }];
    const read = readSelection(selection({ rects: () => rects }));
    rects = [{ left: 0, top: 0, right: 0, bottom: 0 }];

    expect(read?.measure?.()).toBeNull();
  });

  it("reads an element end as well as a text end", () => {
    const one = paragraph(0, 0);
    expect(readSelection(selection({ start: one.p as never, end: one.text }))).toMatchObject({ sectionIndex: 0, paragraphIndex: 0 });
  });

  it("is null for no selection, a collapsed one, or one with no range", () => {
    expect(readSelection(null)).toBeNull();
    expect(readSelection(selection({ isCollapsed: true }))).toBeNull();
    expect(readSelection(selection({ rangeCount: 0 }))).toBeNull();
  });

  it("is null across two paragraphs", () => {
    const a = paragraph(1, 2);
    const b = paragraph(1, 3);

    expect(readSelection(selection({ start: a.text, end: b.text }))).toBeNull();
  });

  it("is the first paragraph for a triple click: the browser ends it at the start of the NEXT one", () => {
    const a = paragraph(1, 2);
    const b = paragraph(1, 3);
    const read = readSelection(selection({ start: a.text, end: b.p as never, endOffset: 0, text: "A whole paragraph of the paper, in one go.\n\n" }));

    expect(read).toMatchObject({ sectionIndex: 1, paragraphIndex: 2, passage: "A whole paragraph of the paper, in one go." });
    // The end may as well be the next paragraph's first text node.
    expect(readSelection(selection({ start: a.text, end: b.text, endOffset: 0, text: "A whole paragraph.\n\n" }))).toMatchObject({ paragraphIndex: 2 });
  });

  it("is still null for a drag that runs on into another paragraph, even if it ends at a start", () => {
    const a = paragraph(1, 2);
    const c = paragraph(1, 4);

    expect(readSelection(selection({ start: a.text, end: c.text, endOffset: 0, text: "the end of A\n\nall of B\n\n" }))).toBeNull();
    // Ending at the start of the next paragraph is only the paragraph's own end when it is the one text.
    expect(readSelection(selection({ start: a.text, end: c.text, endOffset: 9, text: "the end of A" }))).toBeNull();
  });

  it("puts the button where the last line with width ends, not at a zero-width rectangle after it", () => {
    const a = paragraph(1, 2);
    const b = paragraph(1, 3);
    const read = readSelection(
      selection({
        start: a.text,
        end: b.p as never,
        endOffset: 0,
        text: "One paragraph.\n\n",
        rects: [{ left: 40, top: 300, right: 400, bottom: 320 }, { left: 40, top: 324, right: 90, bottom: 344 }, { left: 40, top: 360, right: 40, bottom: 380 }],
      }),
    );

    expect(read?.rect).toEqual({ left: 40, top: 324, right: 90, bottom: 344 });
    // …and the box leaves it out too, so the card is not held off by an empty rectangle.
    expect(read?.bounds).toEqual({ left: 40, top: 300, right: 400, bottom: 344 });
  });

  it("is null outside the paper's body, in a heading, or in an equation or caption beside a paragraph", () => {
    const outside = paragraph(1, 2, false);
    expect(readSelection(selection({ start: outside.text, end: outside.text }))).toBeNull();

    const host = element("div", paragraphAnchor(1, 2), null);
    const caption = element("figcaption", "", host);
    const inCaption = { nodeType: 3, parentElement: caption };
    expect(readSelection(selection({ start: inCaption, end: inCaption }))).toBeNull();

    const heading = element("h3", "", null);
    const inHeading = { nodeType: 3, parentElement: heading };
    expect(readSelection(selection({ start: inHeading, end: inHeading }))).toBeNull();
    expect(readSelection(selection({ start: { nodeType: 3, parentElement: null }, end: { nodeType: 3, parentElement: null } }))).toBeNull();
  });

  it("is null for a selection with a drawn formula in it: that text is not the paper's words", () => {
    expect(readSelection(selection({ rects: [{ left: 1, top: 1, right: 50, bottom: 20 }], hasFormula: true }))).toBeNull();
  });

  it("is null for one too long, or off screen", () => {
    expect(readSelection(selection({ text: "x".repeat(1201) }))).toBeNull();
    expect(readSelection(selection({ rects: [{ left: 0, top: 0, right: 0, bottom: 0 }] }))).toBeNull();
  });

  it("falls back on the range's bounding rectangle when it has no client rectangles", () => {
    const bounding = { left: 5, top: 6, right: 70, bottom: 26 };
    const base = selection({ rects: [] });
    const kept = base.getRangeAt(0);
    const made = { ...kept, cloneRange: () => made, getBoundingClientRect: () => bounding };

    expect(readSelection({ ...base, getRangeAt: () => made as never })?.rect).toEqual(bounding);
  });
});

// ── The listener ────────────────────────────────────────────────────────

const reading = {
  body: [{ id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] }],
  provenance: { sourceLabel: "PDF" },
} as unknown as PaperReading;

let documentListeners: Map<string, Set<() => void>>;
let current: SelectionLike | null;

beforeEach(() => {
  vi.useFakeTimers();
  documentListeners = new Map();
  current = null;
  vi.stubGlobal("document", {
    addEventListener: (type: string, listener: () => void) => {
      documentListeners.set(type, (documentListeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: () => void) => {
      documentListeners.get(type)?.delete(listener);
    },
  });
  vi.stubGlobal("window", {
    getSelection: () => current,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number | undefined) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const changed = () => [...(documentListeners.get("selectionchange") ?? [])].forEach((listener) => listener());
const count = () => documentListeners.get("selectionchange")?.size ?? 0;

async function mountBody(onSelect?: (selection: ExplainSelection | null) => void) {
  // `mount` settles with real timers; let the runtime's own waits through.
  vi.useRealTimers();
  const mounted = await hookRuntime.mount(() => PaperBody({ reading, onSelect }));
  vi.useFakeTimers();
  return mounted;
}

describe("PaperBody's selection listener (P3-02)", () => {
  it("listens for selectionchange only while there is somewhere to report to", async () => {
    const without = await mountBody();
    expect(count()).toBe(0);
    without.unmount();

    const withIt = await mountBody(() => {});
    expect(count()).toBe(1);
    withIt.unmount();
    expect(count()).toBe(0);
  });

  it("reports the selection once it has held still for 150 ms, and not before", async () => {
    const seen: Array<ExplainSelection | null> = [];
    const mounted = await mountBody((s) => seen.push(s));
    current = selection();
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS - 1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(SELECTION_DEBOUNCE_MS).toBe(150);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ sectionIndex: 1, paragraphIndex: 2, passage: "the rafting ratio" });
    mounted.unmount();
  });

  it("reports a drag once, at its end: each change restarts the wait", async () => {
    const seen: Array<ExplainSelection | null> = [];
    const mounted = await mountBody((s) => seen.push(s));
    current = selection();
    for (let i = 0; i < 5; i += 1) {
      changed();
      vi.advanceTimersByTime(100);
    }
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(60);

    expect(seen).toHaveLength(1);
    mounted.unmount();
  });

  it("reports null when the selection goes away or is not one paragraph's", async () => {
    const seen: Array<ExplainSelection | null> = [];
    const mounted = await mountBody((s) => seen.push(s));
    current = null;
    changed();
    vi.advanceTimersByTime(200);
    const a = paragraph(1, 2);
    const b = paragraph(1, 3);
    current = selection({ start: a.text, end: b.text });
    changed();
    vi.advanceTimersByTime(200);

    expect(seen).toEqual([null, null]);
    mounted.unmount();
  });

  it("reports nothing after it is unmounted, even for a change already waiting", async () => {
    const seen: Array<ExplainSelection | null> = [];
    const mounted = await mountBody((s) => seen.push(s));
    current = selection();
    changed();
    mounted.unmount();
    vi.advanceTimersByTime(500);

    expect(seen).toEqual([]);
  });

  it("changes nothing in the body: a listener and none render the same markup", async () => {
    const plain = await mountBody();
    const bare = JSON.stringify(plain.value);
    plain.unmount();
    const listening = await mountBody(() => {});

    expect(JSON.stringify(listening.value)).toBe(bare);
    listening.unmount();
  });
});
