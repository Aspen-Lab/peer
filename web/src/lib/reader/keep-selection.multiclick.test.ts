import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchSelection } from "./keep-selection";

// P11-66 (ruling §1h.180; round 7's Theme B walk, item 2 and (g), matrix `z21`): a TRIPLE click on a paragraph followed by a drag released beside the column (over the left
// pane's text or a pane control, the margin, a separator) or beyond its visible box (above the masthead, below the window, over the foot legend) ended the selection in the
// pane — 12 of 100 gestures at five windows (1,649 characters at 1440; 1,641 at 1280; 4 over a pane control), no button offered — and, where it stayed in the paper, left the
// triple-clicked paragraph out (1440 x 900: 77 to 89 characters, a paragraph's start to the next line's start, from paragraphs of 1,100 to 1,700). The same drag after a single press
// is clean in 100 of 100 (C P11-45b), and so is a double-click-and-drag.
//
// The cause, found by execution (1440 x 900, the invented paper, `Selection.extend` logged on the real page): the correction DOES run, once, at the first move — and puts the end
// at the character the column's edge gives at the pointer's height. A triple click's selection starts at the paragraph's start, so a pointer on the paragraph's first line gives the
// start itself: the selection collapses (0 characters). The browser's next move then takes the (collapsed) selection's place for its base — in the pane's own block — and every later
// correction finds a selection that "began outside the column" and returns. Where the pointer was on a later line the end went to that line's start (87 characters), the paragraph's
// remaining lines left out, because a character is not what the browser's paragraph granularity gives.
//
// The rule: the end of a triple-click-and-drag is where the same drag released at the column's nearest visible point puts it — the browser's paragraph granularity at the pointer's
// height. The triple-clicked paragraph is never left out; a release on an earlier paragraph takes that one from its start; a later one, to its end.
//
// Held here, through the real wiring only (`watchSelection` over a page of four paragraphs and a selection that does what the browser's does at the press): what the selection is
// after the correction; and the presses that must not move (a single press, a double click, three slow clicks, touch and pen, a plain triple click, a release inside the column).

const COLUMN = { left: 356, right: 908 };
const HEIGHT = 720;
/** Paragraph k's rows: P0 49 to 199, P1 200 to 399 (the one that is triple-clicked), P2 400 to 599, P3 600 to the legend. */
const BANDS = [199, 399, 599, Number.POSITIVE_INFINITY];
const LENGTH = [1100, 1400, 1300, 1200];

interface Spot {
  rank: number;
  inColumn: boolean;
  name: string;
  length: number;
  closest: () => null;
  compareDocumentPosition: (other: Spot) => number;
}
const node = (rank: number, inColumn: boolean, name: string, length = 0): Spot => ({
  rank,
  inColumn,
  name,
  length,
  closest: () => null,
  // The page's own order of the document: the pane (rank 0) first, the paper's paragraphs (10 + k), the margin and the legend after (100).
  compareDocumentPosition(other: Spot) {
    return other.rank > rank ? 4 : other.rank < rank ? 2 : 0;
  },
});
const PARAGRAPH = LENGTH.map((length, k) => node(10 + k, true, `paragraph ${k}`, length));
const PANE = node(0, false, "the left pane's block");
const ASIDE = node(100, false, "the margin's aside");
const MASTHEAD = node(0, false, "the masthead");
const LEGEND = node(101, false, "the foot legend");

interface Pos {
  node: Spot;
  offset: number;
}
const same = (a: Pos | null, b: Pos | null) => !!a && !!b && a.node === b.node && a.offset === b.offset;
const before = (a: Pos, b: Pos) => (a.node === b.node ? a.offset < b.offset : a.node.rank < b.node.rank);

/** A selection that does what the browser's does for the members `keep-selection.ts` reads and moves, with the browser's `modify` for the paragraph's boundaries. */
class Selection {
  anchor: Pos | null = null;
  focus: Pos | null = null;
  get rangeCount() {
    return this.anchor ? 1 : 0;
  }
  get isCollapsed() {
    return !this.anchor || same(this.anchor, this.focus);
  }
  get anchorNode() {
    return this.anchor?.node ?? null;
  }
  get anchorOffset() {
    return this.anchor?.offset ?? 0;
  }
  get focusNode() {
    return this.focus?.node ?? null;
  }
  get focusOffset() {
    return this.focus?.offset ?? 0;
  }
  collapse(n: Spot, offset: number) {
    this.anchor = this.focus = { node: n, offset };
  }
  extend(n: Spot, offset: number) {
    if (!this.anchor) throw new Error("extend with no selection");
    this.focus = { node: n, offset };
  }
  modify(alter: string, direction: string, granularity: string) {
    if (granularity !== "paragraphboundary" || !this.focus) throw new Error(`modify ${alter} ${direction} ${granularity}`);
    const to = { node: this.focus.node, offset: direction === "forward" ? this.focus.node.length : 0 };
    if (alter === "move") this.anchor = this.focus = to;
    else this.focus = to;
  }
  /** The selection as a range, in document order. */
  range() {
    if (!this.anchor || !this.focus) return null;
    return before(this.focus, this.anchor) ? { start: this.focus, end: this.anchor } : { start: this.anchor, end: this.focus };
  }
}

let selection: Selection;
let frames: Array<(() => void) | null>;
let handlers: Record<string, (event: unknown) => void>;
let calls: string[];

/** What the browser answers for a point: the paper's paragraph under the row inside the column's x; the masthead's and the legend's text on their rows; the aside beside. */
const caret = (x: number, y: number) => {
  if (y < 48) return { offsetNode: MASTHEAD, offset: 0 };
  if (y > HEIGHT - 28) return { offsetNode: LEGEND, offset: 0 };
  if (x < COLUMN.left || x > COLUMN.right) return { offsetNode: x < COLUMN.left ? PANE : ASIDE, offset: 0 };
  const k = BANDS.findIndex((bottom) => y <= bottom);
  return { offsetNode: PARAGRAPH[k], offset: Math.min(LENGTH[k] - 1, Math.max(1, Math.round(y) - (k === 0 ? 49 : BANDS[k - 1]))) };
};

/** A new selection, its moves counted in `calls`. */
const fresh = () => {
  selection = new Selection();
  for (const name of ["collapse", "extend", "modify"] as const) {
    const original = selection[name].bind(selection) as (...args: never[]) => void;
    (selection as unknown as Record<string, unknown>)[name] = (...args: never[]) => {
      calls.push(name);
      return original(...args);
    };
  }
};

beforeEach(() => {
  calls = [];
  fresh();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run) - 1);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id] = null;
  });
  vi.stubGlobal("window", {
    innerHeight: HEIGHT,
    getSelection: () => selection,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  });
  vi.stubGlobal("document", { activeElement: null, querySelector: () => null, caretPositionFromPoint: caret });
  handlers = {};
  const column = {
    getBoundingClientRect: () => ({ left: COLUMN.left, right: COLUMN.right }),
    contains: (n: unknown) => (n as Spot | null)?.inColumn === true,
  };
  watchSelection(column as never, { addEventListener: (type: string, run: (event: unknown) => void) => (handlers[type] = run), removeEventListener: () => {} } as never);
});
afterEach(() => vi.unstubAllGlobals());

const runFrames = () => frames.splice(0).forEach((run) => run?.());
const pointer = (over: Record<string, unknown> = {}) => ({ pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: 600, clientY: 260, target: PARAGRAPH[1], timeStamp: 0, ...over });

/** What the browser does with a triple click on paragraph 1 (measured): the paragraph is selected, from its first character to the next paragraph's start. */
const tripleSelects = () => {
  selection.anchor = { node: PARAGRAPH[1], offset: 0 };
  selection.focus = { node: PARAGRAPH[2], offset: 0 };
};

/** Three presses on the paragraph, 150 ms apart, the third held; `gap` is the time between presses, `over` what each press carries. */
function click(times: number, gap = 150, over: Record<string, unknown> = {}) {
  for (let i = 0; i < times; i++) {
    handlers.pointerdown(pointer({ timeStamp: 1000 + i * gap, ...over }));
    if (i === 0) selection.collapse(PARAGRAPH[1], 300);
    if (i === 1) {
      selection.anchor = { node: PARAGRAPH[1], offset: 280 };
      selection.focus = { node: PARAGRAPH[1], offset: 320 };
    }
    if (i === 2) tripleSelects();
    if (i < times - 1) handlers.pointerup(pointer({ buttons: 0, timeStamp: 1010 + i * gap, ...over }));
  }
}
/** The browser's own move of the end for a pointer over the left pane (measured at 1440 x 900): the base is taken into the pane's block, the end is in the pane. */
const browserMovesIntoPane = () => {
  selection.anchor = { node: PANE, offset: 0 };
  selection.focus = { node: PANE, offset: 15 };
};
/** The browser's own move of the end, for a press it follows: the end goes to what lies under the pointer (the anchor stays). */
const browserFollows = (x: number, y: number) => {
  const spot = caret(x, y);
  if (selection.anchor) selection.focus = { node: spot.offsetNode, offset: spot.offset };
};
/** The drag: moves to (x, y), the browser's move, the frame; then the release there, the frame. `browser` false: the browser does not follow (touch, pen). */
function dragTo(x: number, y: number, over: Record<string, unknown> = {}, browser = true) {
  const move = (mx: number, my: number) => {
    handlers.pointermove(pointer({ clientX: mx, clientY: my, ...over }));
    if (browser) browserFollows(mx, my);
  };
  move((600 + x) / 2, 300);
  move(x, y);
  runFrames();
  handlers.pointerup(pointer({ buttons: 0, clientX: x, clientY: y, ...over }));
  runFrames();
}
const paragraph = (k: number) => ({ start: { node: PARAGRAPH[k], offset: 0 }, end: { node: PARAGRAPH[k], offset: LENGTH[k] } });
/** Does the selection take paragraph `k` whole? */
const covers = (k: number) => {
  const range = selection.range();
  const { start, end } = paragraph(k);
  return !!range && !before(start, range.start) && !before(range.end, end);
};
const startsAt = (k: number) => selection.range()?.start.node === PARAGRAPH[k] && selection.range()?.start.offset === 0;
const endsIn = (k: number) => selection.range()?.end.node === PARAGRAPH[k] && selection.range()?.end.offset === LENGTH[k];

const LEFT = [
  ["over the left pane", 60],
  ["over the separator before the column", COLUMN.left - 12],
  ["over a pane control", 94],
] as const;
const RIGHT = [
  ["over the margin", COLUMN.right + 160],
  ["over the separator after the column", COLUMN.right + 12],
] as const;

describe("a triple click, then a drag released beside the column: the end is the column's edge at the pointer's height, by paragraph", () => {
  it.each([...LEFT, ...RIGHT])("released %s on the triple-clicked paragraph's own rows: the paragraph is selected whole (never collapsed, never cut at a line)", (_name, x) => {
    for (const y of [210, 260, 330, 390]) {
      fresh();
      click(3);
      dragTo(x, y);
      expect(covers(1), `y ${y}`).toBe(true);
      expect(startsAt(1), `y ${y}`).toBe(true);
      expect(selection.isCollapsed, `y ${y}`).toBe(false);
    }
  });

  it.each([...LEFT, ...RIGHT])("released %s at a later paragraph's height: the triple-clicked paragraph through that paragraph's end", (_name, x) => {
    click(3);
    dragTo(x, 450);
    expect(startsAt(1)).toBe(true);
    expect(endsIn(2)).toBe(true);
    fresh();
    click(3);
    dragTo(x, 640);
    expect(startsAt(1)).toBe(true);
    expect(endsIn(3)).toBe(true);
  });

  it.each([...LEFT, ...RIGHT])("released %s at an earlier paragraph's height: that paragraph from its start through the triple-clicked one", (_name, x) => {
    click(3);
    dragTo(x, 120);
    expect(startsAt(0)).toBe(true);
    expect(covers(1)).toBe(true);
    // the selection's anchor is the triple-clicked paragraph's end: a later move back over the column is the browser's
    expect(selection.anchor?.node).toBe(PARAGRAPH[2]);
    expect(selection.anchor?.offset).toBe(0);
  });

  it("the browser has taken the base into the pane's block (what it does on the next move: measured, 699 and 1,649 characters ending in the pane): the correction puts the paragraph back", () => {
    click(3);
    handlers.pointermove(pointer({ clientX: 328, clientY: 310 }));
    runFrames();
    browserMovesIntoPane();
    handlers.pointermove(pointer({ clientX: 160, clientY: 339 }));
    runFrames();
    browserMovesIntoPane();
    handlers.pointerup(pointer({ buttons: 0, clientX: 160, clientY: 339 }));
    runFrames();
    expect(selection.anchorNode).not.toBe(PANE);
    expect(selection.focusNode).not.toBe(PANE);
    expect(startsAt(1)).toBe(true);
    expect(covers(1)).toBe(true);
  });

  it("a release beyond the visible box: above the masthead (the first visible line's paragraph), below the window and over the foot legend (the last visible line's), in the column's x as beside it", () => {
    for (const x of [600, 60, COLUMN.right + 160]) {
      fresh();
      click(3);
      dragTo(x, 10);
      expect(startsAt(0), `above, x ${x}`).toBe(true);
      expect(covers(1), `above, x ${x}`).toBe(true);
      for (const y of [700, 719, 760]) {
        fresh();
        click(3);
        dragTo(x, y);
        expect(startsAt(1), `y ${y}, x ${x}`).toBe(true);
        expect(endsIn(3), `y ${y}, x ${x}`).toBe(true);
      }
    }
  });

  it("the buttons' premise holds: the selection begins and ends in the paper's paragraphs, never in the pane, the margin, the masthead or the legend", () => {
    for (const [, x] of [...LEFT, ...RIGHT]) {
      for (const y of [10, 120, 260, 450, 640, 710, 760]) {
        fresh();
        click(3);
        dragTo(x, y);
        const range = selection.range();
        expect(range?.start.node.inColumn, `x ${x} y ${y}`).toBe(true);
        expect(range?.end.node.inColumn, `x ${x} y ${y}`).toBe(true);
      }
    }
  });
});

describe("what a triple click's drag does not change", () => {
  it("a release inside the column (the browser is right there): nothing is touched, whatever the paragraph", () => {
    click(3);
    calls.length = 0;
    dragTo(700, 450);
    dragTo(700, 120);
    dragTo(COLUMN.right - 80, 330);
    expect(calls).toEqual([]);
  });

  it("a plain triple click, released where it went down: nothing is touched", () => {
    click(3);
    calls.length = 0;
    handlers.pointerup(pointer({ buttons: 0 }));
    runFrames();
    expect(calls).toEqual([]);
    expect(covers(1)).toBe(true);
    expect(selection.anchor?.node).toBe(PARAGRAPH[1]);
    expect(selection.focus?.node).toBe(PARAGRAPH[2]);
  });

  it("a single press and a drag beside the column: one `extend` to the edge's character, at the pointer's height, no `collapse`, no `modify`", () => {
    handlers.pointerdown(pointer({ timeStamp: 1000 }));
    selection.collapse(PARAGRAPH[1], 300);
    calls.length = 0;
    dragTo(60, 330);
    expect(calls.filter((call) => call !== "extend")).toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
    expect(selection.focus).toEqual({ node: PARAGRAPH[1], offset: 131 });
    expect(selection.anchor).toEqual({ node: PARAGRAPH[1], offset: 300 });
  });

  it("a double click and a drag beside the column: as a single press's, one `extend` to the edge's character", () => {
    click(2);
    calls.length = 0;
    dragTo(60, 330);
    expect(calls.filter((call) => call !== "extend")).toEqual([]);
    expect(selection.focus).toEqual({ node: PARAGRAPH[1], offset: 131 });
    expect(selection.anchor).toEqual({ node: PARAGRAPH[1], offset: 280 });
  });

  it("three presses too slow for a triple click (a second apart), or not on one spot: a single press's drag", () => {
    for (const over of [{ gap: 1500 }, { gap: 150, far: true }]) {
      fresh();
      for (let i = 0; i < 3; i++) {
        handlers.pointerdown(pointer({ timeStamp: 1000 + i * over.gap, clientX: over.far ? 600 + i * 40 : 600 }));
        selection.collapse(PARAGRAPH[1], 300);
        if (i < 2) handlers.pointerup(pointer({ buttons: 0, timeStamp: 1010 + i * over.gap }));
      }
      calls.length = 0;
      dragTo(60, 330);
      expect(calls.filter((call) => call !== "extend")).toEqual([]);
      expect(selection.anchor).toEqual({ node: PARAGRAPH[1], offset: 300 });
      expect(selection.focus).toEqual({ node: PARAGRAPH[1], offset: 131 });
    }
  });

  it("touch and pen are not followed, triple or not", () => {
    for (const pointerType of ["touch", "pen"]) {
      fresh();
      click(3, 150, { pointerType });
      calls.length = 0;
      dragTo(60, 330, { pointerType }, false);
      expect(calls).toEqual([]);
      expect(selection.anchor?.node).toBe(PARAGRAPH[1]);
      expect(selection.focus?.node).toBe(PARAGRAPH[2]);
    }
  });

  it("a triple click that did not begin in the paper's text (a card's, the pane's) is not followed", () => {
    for (const target of [PANE, ASIDE]) {
      fresh();
      click(3, 150, { target });
      calls.length = 0;
      dragTo(60, 330, { target });
      expect(calls).toEqual([]);
    }
  });
});
