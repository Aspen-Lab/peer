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
  sameSelection,
  selectionTarget,
  type ExplainSelection,
  type SelectionLike,
} from "./paper-body";

describe("selectionTarget — the pure rule", () => {
  const id = paragraphAnchor(2, 3);

  it("is the paragraph and the words when both ends sit in one paragraph", () => {
    // Re-aimed (P10-08): the target also says where it is from (the paper) and carries the paragraph's own id.
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: "the rafting ratio" })).toEqual({
      sectionIndex: 2,
      paragraphIndex: 3,
      passage: "the rafting ratio",
      source: "paper",
      paragraphId: id,
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
  /** A real element has one; a stand-in has it only when a test gives it a box (P8-02). */
  getBoundingClientRect?(): Rect;
}

function element(tag: string, id: string, parent: StubElement | null, inBody = true, box?: Rect | (() => Rect)): StubElement {
  const self: StubElement = {
    id,
    nodeType: 1,
    parentElement: parent,
    tag,
    inBody,
    ...(box ? { getBoundingClientRect: () => (typeof box === "function" ? box() : box) } : {}),
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
function paragraph(k: number, i: number, inBody = true, box?: Rect | (() => Rect)) {
  const host = element("div", paragraphAnchor(k, i), null, inBody);
  const p = element("p", "", host, inBody, box);
  return { host, p, text: { nodeType: 3, parentElement: p } };
}

interface StubNode {
  nodeType: number;
  parentElement: StubElement | null;
}

function range(
  source: Rect[] | (() => Rect[]),
  over: { start?: StubNode; end?: StubNode; endOffset?: number; hasFormula?: boolean; box?: Rect | (() => Rect) } = {},
) {
  const rects = () => (typeof source === "function" ? source() : source);
  const one = paragraph(1, 2, true, over.box);
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
  over: { start?: StubNode; end?: StubNode; endOffset?: number; text?: string; rects?: Rect[] | (() => Rect[]); hasFormula?: boolean; isCollapsed?: boolean; rangeCount?: number; box?: Rect | (() => Rect) } = {},
): SelectionLike {
  const made = range(over.rects ?? TWO_LINES, over);
  return {
    rangeCount: over.rangeCount ?? 1,
    isCollapsed: over.isCollapsed ?? false,
    toString: () => over.text ?? "the rafting ratio",
    getRangeAt: () => made,
  };
}

describe("sameSelection — a selection that has not changed is not a new one (P8-02: the paragraph's box counts)", () => {
  const box = { left: 120, top: 150, right: 760, bottom: 420 };

  it("is the same for one read twice, with or without the paragraph's box", () => {
    expect(sameSelection(readSelection(selection({ box })), readSelection(selection({ box })))).toBe(true);
    expect(sameSelection(readSelection(selection()), readSelection(selection()))).toBe(true);
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection(readSelection(selection()), null)).toBe(false);
  });

  it("is a different one when the paragraph's box moved or appeared, though the selection's lines did not", () => {
    expect(sameSelection(readSelection(selection({ box })), readSelection(selection({ box: { ...box, top: 100 } })))).toBe(false);
    expect(sameSelection(readSelection(selection({ box })), readSelection(selection()))).toBe(false);
    expect(sameSelection(readSelection(selection()), readSelection(selection({ box })))).toBe(false);
  });
});

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

  // P8-02 (BACKLOG-31): the explain window stands level with the first line of the PARAGRAPH the
  // explained passage belongs to, so the selection reports the paragraph's own box (the `<p>`, which
  // the body renders as the first child of the paragraph's anchor) beside its lines, and again when
  // measured again. Nothing else is added to what is reported.
  it("also gives the paragraph's own box, whose top is the paragraph's first line, not the selection's", () => {
    const box = { left: 120, top: 150, right: 760, bottom: 420 };
    const read = readSelection(selection({ box }));

    expect(read?.paragraph).toEqual(box);
    // The words picked are lower down in it.
    expect(read?.bounds.top).toBe(200);
    expect(read?.rect).toEqual({ left: 40, top: 224, right: 120, bottom: 244 });
  });

  it("measures the paragraph's box again with the selection, after the page has scrolled", () => {
    let box = { left: 120, top: 150, right: 760, bottom: 420 };
    const read = readSelection(selection({ box: () => box }));
    box = { left: 120, top: -90, right: 760, bottom: 180 };

    expect(read?.measure?.()?.paragraph).toEqual({ left: 120, top: -90, right: 760, bottom: 180 });
    // The first reading stays as it was.
    expect(read?.paragraph?.top).toBe(150);
  });

  it("is the paragraph the selection starts in, for a triple click that ends at the start of the next one", () => {
    const a = paragraph(1, 2, true, { left: 120, top: 100, right: 760, bottom: 300 });
    const b = paragraph(1, 3, true, { left: 120, top: 316, right: 760, bottom: 500 });
    const read = readSelection(selection({ start: a.text, end: b.p as never, endOffset: 0, text: "A whole paragraph of the paper, in one go.\n\n" }));

    expect(read).toMatchObject({ paragraphIndex: 2 });
    expect(read?.paragraph).toEqual({ left: 120, top: 100, right: 760, bottom: 300 });
  });

  it("reports no paragraph box where the element cannot give one — and is still the selection", () => {
    const read = readSelection(selection());

    expect(read).toMatchObject({ sectionIndex: 1, paragraphIndex: 2, passage: "the rafting ratio" });
    expect(read).not.toHaveProperty("paragraph");
    expect(read?.measure?.()).not.toHaveProperty("paragraph");
    // …nor one with no size at all (a paragraph that is not laid out).
    expect(readSelection(selection({ box: { left: 0, top: 0, right: 0, bottom: 0 } }))).not.toHaveProperty("paragraph");
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

type Listener = (event?: unknown) => void;
type ListenOptions = boolean | { capture?: boolean };

/**
 * A DOM target's listeners as the DOM keeps them (P9-18): one per (type,
 * function, capture phase), and removed only by naming the same three — so a
 * listener added in the capture phase and removed without it stays, as it
 * would in a browser.
 */
function registry() {
  const entries: Array<{ type: string; listener: Listener; capture: boolean }> = [];
  const captureOf = (options?: ListenOptions) => (typeof options === "object" ? Boolean(options.capture) : Boolean(options));
  const find = (type: string, listener: Listener, capture: boolean) => entries.findIndex((e) => e.type === type && e.listener === listener && e.capture === capture);
  return {
    add(type: string, listener: Listener, options?: ListenOptions) {
      const capture = captureOf(options);
      if (find(type, listener, capture) < 0) entries.push({ type, listener, capture });
    },
    remove(type: string, listener: Listener, options?: ListenOptions) {
      const at = find(type, listener, captureOf(options));
      if (at >= 0) entries.splice(at, 1);
    },
    of: (type: string) => entries.filter((e) => e.type === type),
    all: () => [...entries],
  };
}

let documentListeners: ReturnType<typeof registry>;
let windowListeners: ReturnType<typeof registry>;
let current: SelectionLike | null;

beforeEach(() => {
  vi.useFakeTimers();
  documentListeners = registry();
  windowListeners = registry();
  current = null;
  vi.stubGlobal("document", {
    addEventListener: (type: string, listener: Listener, options?: ListenOptions) => documentListeners.add(type, listener, options),
    removeEventListener: (type: string, listener: Listener, options?: ListenOptions) => documentListeners.remove(type, listener, options),
  });
  vi.stubGlobal("window", {
    getSelection: () => current,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number | undefined) => clearTimeout(id),
    addEventListener: (type: string, listener: Listener, options?: ListenOptions) => windowListeners.add(type, listener, options),
    removeEventListener: (type: string, listener: Listener, options?: ListenOptions) => windowListeners.remove(type, listener, options),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const dispatch = (target: ReturnType<typeof registry>, type: string, event?: unknown) => target.of(type).forEach(({ listener }) => listener(event));
const changed = () => dispatch(documentListeners, "selectionchange");
const count = () => documentListeners.of("selectionchange").length;
const MOUSE = { button: 0, isPrimary: true, pointerType: "mouse" };
/** The primary button goes down on the page (a pointer event reaches the document). */
const press = (init: Record<string, unknown> = {}) => dispatch(documentListeners, "pointerdown", { ...MOUSE, ...init });
/** …and comes up, or the browser takes the pointer away. */
const release = (type: "pointerup" | "pointercancel" = "pointerup", init: Record<string, unknown> = {}) => dispatch(documentListeners, type, { ...MOUSE, ...init });
/** The window loses focus (the reader switches to another window). */
const blurred = () => dispatch(windowListeners, "blur", {});

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

// ── P9-18 (BACKLOG-45; A P9-R2's F2 and §6.1; ruling §1h.56) ──────────────
// A selection is offered when the primary pointer is UP. The 150 ms wait is
// "the reader has stopped", and a reader who drags with the button down, and
// stops to look at the words, has not finished: the window must not move and
// the control must not appear until the release. A selection made without a
// press (keyboard, touch handles, a script) has no release, and keeps the
// 150 ms wait.
describe("PaperBody's selection listener — offered when the primary pointer is up (P9-18, BACKLOG-45)", () => {
  async function mountSeen() {
    const seen: Array<ExplainSelection | null> = [];
    const mounted = await mountBody((s) => seen.push(s));
    return { seen, mounted };
  }

  it("offers nothing while the primary button is down, however long the drag pauses; the release offers it at once", async () => {
    const { seen, mounted } = await mountSeen();
    press();
    current = selection();
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS + 250); // the reader holds still 400 ms with the button down
    expect(seen, "nothing may be offered while the primary pointer is down").toEqual([]);
    release();
    vi.advanceTimersByTime(0);

    expect(seen, "one report, the moment the button comes up — no wait after it").toHaveLength(1);
    expect(seen[0]).toMatchObject({ sectionIndex: 1, paragraphIndex: 2, passage: "the rafting ratio" });
    vi.advanceTimersByTime(1000);
    expect(seen, "and the release read is the only one").toHaveLength(1);
    mounted.unmount();
  });

  it("reports a drag that moves, pauses and moves again once, at the release", async () => {
    const { seen, mounted } = await mountSeen();
    press();
    current = selection();
    for (let i = 0; i < 5; i += 1) {
      changed();
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(400); // the pause
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS * 2);
    expect(seen).toEqual([]);
    release();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS);

    expect(seen).toHaveLength(1);
    mounted.unmount();
  });

  it("holds a wait already running when the button goes down: a press ends the debounce it found", async () => {
    const { seen, mounted } = await mountSeen();
    current = selection();
    changed(); // e.g. a double click's first selection, or a keyboard change
    vi.advanceTimersByTime(100);
    press();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS * 2);
    expect(seen, "the wait that was running does not fire into the press").toEqual([]);
    release();
    vi.advanceTimersByTime(0);

    expect(seen).toHaveLength(1);
    mounted.unmount();
  });

  it("reports null at the release of a click that collapses a selection, not before", async () => {
    const { seen, mounted } = await mountSeen();
    press();
    current = null; // the press collapses the selection…
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS + 250);
    expect(seen).toEqual([]);
    release();
    vi.advanceTimersByTime(0);

    expect(seen).toEqual([null]);
    mounted.unmount();
  });

  it("holds each drag until its own release", async () => {
    const { seen, mounted } = await mountSeen();
    press();
    current = selection({ text: "the first drag" });
    changed();
    release();
    vi.advanceTimersByTime(0);
    expect(seen).toHaveLength(1);

    press();
    current = selection({ text: "the second drag" });
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS + 250);
    expect(seen, "the second drag is not offered while it is held").toHaveLength(1);
    release();
    vi.advanceTimersByTime(0);

    expect(seen.map((s) => s?.passage)).toEqual(["the first drag", "the second drag"]);
    mounted.unmount();
  });

  it("frees the gate and reads when the window loses focus with the button down: the release may never arrive", async () => {
    const { seen, mounted } = await mountSeen();
    press();
    current = selection();
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS + 250);
    expect(seen).toEqual([]);
    blurred();
    vi.advanceTimersByTime(0);
    expect(seen, "one read when the window blurs").toHaveLength(1);

    // …and the flag is clear: a keyboard change after it is on the 150 ms wait again.
    current = selection({ text: "the next words" });
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS - 1);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(seen.map((s) => s?.passage)).toEqual(["the rafting ratio", "the next words"]);
    mounted.unmount();
  });

  it("frees the gate when the browser takes the pointer away (pointercancel), and the next change is read after 150 ms", async () => {
    const { seen, mounted } = await mountSeen();
    press();
    release("pointercancel");
    current = selection();
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS);

    expect(seen).toHaveLength(1);
    mounted.unmount();
  });

  it("reads at once when the pointer is cancelled with the button down, as at a release", async () => {
    const { seen, mounted } = await mountSeen();
    press();
    current = selection();
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS + 250);
    expect(seen).toEqual([]);
    release("pointercancel");
    vi.advanceTimersByTime(0);

    expect(seen).toHaveLength(1);
    mounted.unmount();
  });

  it("keeps the 150 ms wait for a keyboard selection: shift + arrow ×5 is offered once, 150 ms after the last key", async () => {
    const { seen, mounted } = await mountSeen();
    current = selection();
    for (let i = 0; i < 5; i += 1) {
      changed();
      vi.advanceTimersByTime(40);
    }
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS - 40 - 1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(1000);

    expect(seen, "once, after the last key").toHaveLength(1);
    mounted.unmount();
  });

  it.each([
    ["a touch pointer (selection handles fire no pointer events)", { pointerType: "touch" }],
    ["a secondary button", { button: 2 }],
    ["a pointer that is not the primary one", { isPrimary: false }],
  ])("keeps the 150 ms wait under %s: it is no press of the primary pointer", async (_name, init) => {
    const { seen, mounted } = await mountSeen();
    press(init);
    current = selection();
    changed();
    vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS - 1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toHaveLength(1);
    release("pointerup", init);
    vi.advanceTimersByTime(1000);

    expect(seen, "and its lifting adds no read of its own").toHaveLength(1);
    mounted.unmount();
  });

  it("reads nothing for a release, a cancel or a blur that no press of the primary pointer came before", async () => {
    const { seen, mounted } = await mountSeen();
    current = selection();
    release();
    release("pointercancel");
    blurred();
    vi.advanceTimersByTime(1000);

    expect(seen).toEqual([]);
    mounted.unmount();
  });

  it("listens for the pointer on the document in the capture phase, and for the blur on the window", async () => {
    const mounted = await mountBody(() => {});

    for (const type of ["pointerdown", "pointerup", "pointercancel"]) {
      expect(documentListeners.of(type), type).toHaveLength(1);
      expect(documentListeners.of(type)[0].capture, `${type} in the capture phase, so a handler that stops propagation cannot hide it`).toBe(true);
    }
    expect(windowListeners.of("blur")).toHaveLength(1);
    mounted.unmount();
  });

  it("adds no listener without somewhere to report to, and removes every one it added on unmount", async () => {
    const without = await mountBody();
    expect(documentListeners.all()).toEqual([]);
    expect(windowListeners.all()).toEqual([]);
    without.unmount();

    const withIt = await mountBody(() => {});
    expect(documentListeners.all().length).toBeGreaterThan(0);
    withIt.unmount();

    expect(documentListeners.all(), "document").toEqual([]);
    expect(windowListeners.all(), "window").toEqual([]);
  });

  it("reports nothing after it is unmounted, even for a release already on its way", async () => {
    const { seen, mounted } = await mountSeen();
    press();
    current = selection();
    changed();
    release();
    mounted.unmount();
    vi.advanceTimersByTime(1000);

    expect(seen).toEqual([]);
  });
});
