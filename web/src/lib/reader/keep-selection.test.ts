import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-45b (the manager's follow-up to P11-45): a drag-select that starts in the paper's text column and is released anywhere outside it ends at the column's nearest
// edge, at the pointer's height — never at the end of the document.
//
// Measured on the base (`0d17a382`, which has P11-45's clamp on the two separators only), 1280 x 720 on the invented paper, a press at a line's start and a release
// along the line: 12 and 23 px past its end (over the margin's separator) were right (72 characters); 40, 100 and 300 px past (over the margin's empty aside) selected
// 36,977 characters; over an open sticky note in the margin 36,786 to 36,794; 40 and 120 px before the line's start (over the left pane) 20,285; below the window's foot
// and past the column 36,610; over the masthead 20,668 — none with a button offered (the cap is 1,200 characters). Every selection ran from the line to the place in
// the DOCUMENT of what lay under the pointer.
//
// Held here: the decision (`endSelectionInColumn`), the controller (`selectionKeeper`: which presses are followed, what asks for a correction, the frame), the
// document-level wiring (`watchSelection`). The real shell, with the hook's one call, is `reader-shell.keep-selection.flow.test.tsx`.

// The module is reached through a typed handle, so this file compiles where it is not there yet.
type Visible = { top: number; bottom: number | null };
type Column = { getBoundingClientRect: () => { left: number; right: number }; contains: (node: unknown) => boolean };
type Pointer = { pointerType: string; pointerId: number; isPrimary?: boolean; button: number; buttons: number; clientX: number; clientY: number; target: unknown };
interface Env {
  startsInText(target: unknown): boolean;
  endAt(x: number, y: number): void;
  frame(run: () => void): unknown;
  cancel(handle: unknown): void;
}
interface Keeper {
  down(e: Pointer): void;
  move(e: Pointer): void;
  up(e: Pointer): void;
  cancel(): void;
}
interface KeepSelection {
  CONTROL_SELECTOR: string;
  CARET_STEP_PX: number;
  CARET_TRIES: number;
  caretAt(doc: unknown, x: number, y: number): { node: unknown; offset: number } | null;
  endSelectionInColumn(column: Column | null, x: number, y: number, visible: Visible, doc?: unknown, selection?: unknown): boolean;
  selectionKeeper(env: Env): Keeper;
  domEnv(column: unknown): Env;
  watchSelection(column: unknown, doc?: unknown): () => void;
}
const specifier = "./keep-selection";
const load = async () => (await import(/* @vite-ignore */ specifier)) as unknown as KeepSelection;

// ── The page: a column from 356 to 908, a window 720 high, a masthead 48 high, a legend that covers the window's last 28 rows ──

const COLUMN = { left: 356, right: 908 };
const VISIBLE: Visible = { top: 49, bottom: 719 };
const inColumn = (name = "text in the paper") => ({ inColumn: true, name });
const elsewhere = (name: string) => ({ inColumn: false, name });

const column = (): Column => ({
  getBoundingClientRect: () => ({ left: COLUMN.left, right: COLUMN.right }),
  contains: (node: unknown) => (node as { inColumn?: boolean } | null)?.inColumn === true,
});

interface SelectionStub {
  rangeCount: number;
  isCollapsed: boolean;
  anchorNode: unknown;
  focusNode: unknown;
  focusOffset: number;
  extend: ReturnType<typeof vi.fn>;
}
let selection: SelectionStub;
/** The caret under a point: the paper's text anywhere inside the column's box; the legend's over the window's last 28 rows; the masthead's over the first 48. */
let caret: ReturnType<typeof vi.fn>;
let doc: { caretPositionFromPoint: typeof caret };

beforeEach(() => {
  selection = { rangeCount: 1, isCollapsed: false, anchorNode: inColumn(), focusNode: null, focusOffset: 0, extend: vi.fn() };
  caret = vi.fn((x: number, y: number) => {
    if (y < 48) return { offsetNode: elsewhere("masthead"), offset: 0 };
    if (y > 719 - 28) return { offsetNode: elsewhere("legend"), offset: 0 };
    if (x < COLUMN.left || x > COLUMN.right) return { offsetNode: elsewhere("aside"), offset: 0 };
    return { offsetNode: { inColumn: true, at: [x, y] }, offset: Math.round(y) };
  });
  doc = { caretPositionFromPoint: caret };
});
afterEach(() => vi.unstubAllGlobals());

describe("endSelectionInColumn — the end goes to the column's nearest visible point", () => {
  const put = async (x: number, y: number, over: { visible?: Visible; selection?: Partial<SelectionStub> } = {}) => {
    const { endSelectionInColumn } = await load();
    return endSelectionInColumn(column(), x, y, over.visible ?? VISIBLE, doc, { ...selection, ...over.selection });
  };
  const extendedAt = () => {
    const [node, offset] = selection.extend.mock.calls[0] as [{ at: number[] }, number];
    return { at: node.at, offset };
  };

  it.each([12, 23, 40, 100, 300])("a release %i px past the line's end (the margin, a card, a separator): the column's right edge, at the pointer's height", async (past) => {
    selection.extend = vi.fn();
    const sel = { ...selection, extend: selection.extend };
    const { endSelectionInColumn } = await load();
    expect(endSelectionInColumn(column(), COLUMN.right + past, 300, VISIBLE, doc, sel)).toBe(true);
    expect(sel.extend).toHaveBeenCalledTimes(1);
    expect((sel.extend.mock.calls[0][0] as { at: number[] }).at).toEqual([COLUMN.right - 1, 300]);
  });

  it.each([12, 40, 120, 300])("a release %i px before the line's start (the left pane, a separator): the column's left edge, at the pointer's height", async (before) => {
    expect(await put(COLUMN.left - before, 412)).toBe(true);
    expect(extendedAt().at).toEqual([COLUMN.left + 1, 412]);
  });

  it("a release beyond the window's right or left edge (x past the window): the same, at the pointer's height", async () => {
    expect(await put(1400, 300)).toBe(true);
    expect(extendedAt().at).toEqual([COLUMN.right - 1, 300]);
    selection.extend.mockClear();
    expect(await put(-40, 301)).toBe(true);
    expect(extendedAt().at).toEqual([COLUMN.left + 1, 301]);
  });

  it("a release below the window's foot: the last visible line, looked for above the legend that covers the window's last rows", async () => {
    expect(await put(600, 760)).toBe(true);
    const { at } = extendedAt();
    expect(at[0]).toBe(600);
    expect(at[1]).toBeLessThan(719 - 28);
    expect(at[1]).toBeGreaterThan(719 - 28 - 12 * 6);
    // and beside the column as well as below: the edge's x, the same last line
    selection.extend.mockClear();
    expect(await put(COLUMN.right + 80, 800)).toBe(true);
    expect(extendedAt().at[0]).toBe(COLUMN.right - 1);
  });

  it("a release above the window's top or over the masthead: the first line under its foot", async () => {
    expect(await put(600, 20)).toBe(true);
    expect(extendedAt().at[1]).toBeGreaterThanOrEqual(49);
    selection.extend.mockClear();
    expect(await put(600, -50)).toBe(true);
    expect(extendedAt().at[1]).toBeGreaterThanOrEqual(49);
  });

  it("a pointer over the column's visible box: the browser is right there, nothing is touched", async () => {
    expect(await put(600, 300)).toBe(false);
    expect(await put(COLUMN.left, 49)).toBe(false);
    expect(await put(COLUMN.right, 719)).toBe(false);
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("no selection, a collapsed one, and one that began outside the column (a card's text, the notes editor, the left pane's title): nothing is touched", async () => {
    const edge = COLUMN.right + 100;
    expect(await put(edge, 300, { selection: { rangeCount: 0 } })).toBe(false);
    expect(await put(edge, 300, { selection: { isCollapsed: true } })).toBe(false);
    for (const where of ["a card's own text", "the notes editor", "the left pane's title", "the map"]) {
      expect(await put(edge, 300, { selection: { anchorNode: elsewhere(where) } })).toBe(false);
    }
    expect(await put(edge, 300, { selection: { anchorNode: null } })).toBe(false);
    expect(caret).not.toHaveBeenCalled();
  });

  it("no column: nothing", async () => {
    const { endSelectionInColumn } = await load();
    expect(endSelectionInColumn(null, 1000, 300, VISIBLE, doc, selection)).toBe(false);
  });

  it("no text at that point, and nothing of the column's on any of the rows tried: nothing is touched", async () => {
    caret.mockReturnValue(null);
    expect(await put(1000, 300)).toBe(false);
    caret.mockReturnValue({ offsetNode: elsewhere("aside"), offset: 0 });
    expect(await put(1000, 300)).toBe(false);
    expect(caret).toHaveBeenCalledTimes(2 * 12);
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("the end already there: not extended again (no needless change of the selection)", async () => {
    const spot = { offsetNode: { inColumn: true }, offset: 7 };
    caret.mockReturnValue(spot);
    expect(await put(1000, 300, { selection: { focusNode: spot.offsetNode, focusOffset: 7 } })).toBe(false);
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a window of unknown height: no clamp below, the masthead's still holds", async () => {
    expect(await put(600, 900, { visible: { top: 49, bottom: null } })).toBe(false);
    expect(await put(600, 20, { visible: { top: 49, bottom: null } })).toBe(true);
  });

  it("falls back to caretRangeFromPoint where the standard call is not there", async () => {
    const { endSelectionInColumn } = await load();
    const node = { inColumn: true };
    const range = vi.fn(() => ({ startContainer: node, startOffset: 3 }));
    const sel = { ...selection, extend: vi.fn() };
    expect(endSelectionInColumn(column(), 1000, 300, VISIBLE, { caretRangeFromPoint: range }, sel)).toBe(true);
    expect(sel.extend).toHaveBeenCalledWith(node, 3);
    const { caretAt } = await load();
    expect(caretAt({}, 1, 1)).toBeNull();
  });
});

describe("selectionKeeper — which presses are followed, and when a correction is asked for", () => {
  let frames: Array<(() => void) | null>;
  let ends: Array<[number, number]>;
  const env = (startsInText = (target: unknown) => (target as { inColumn?: boolean })?.inColumn === true): Env => ({
    startsInText,
    endAt: (x, y) => ends.push([x, y]),
    frame: (run) => frames.push(run) - 1,
    cancel: (handle) => {
      frames[handle as number] = null;
    },
  });
  const runFrames = () => frames.splice(0).forEach((run) => run?.());
  const pointer = (over: Partial<Pointer> = {}): Pointer => ({ pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: 1000, clientY: 300, target: inColumn(), ...over });
  const keeper = async (e: Env = env()) => (await load()).selectionKeeper(e);

  beforeEach(() => {
    frames = [];
    ends = [];
  });

  it("follows a mouse press that began in the text: three moves in a frame ask for one correction, at the last move's place", async () => {
    const k = await keeper();
    k.down(pointer({ button: 0, clientX: 400 }));
    for (const x of [930, 960, 990]) k.move(pointer({ clientX: x }));
    expect(ends).toEqual([]);
    runFrames();
    expect(ends).toEqual([[990, 300]]);
    k.move(pointer({ clientX: 1100, clientY: 340 }));
    runFrames();
    expect(ends).toEqual([[990, 300], [1100, 340]]);
  });

  it("the release asks for the last correction, and the press is over: later moves ask for nothing", async () => {
    const k = await keeper();
    k.down(pointer());
    k.move(pointer({ clientX: 1000 }));
    k.up(pointer({ buttons: 0, clientX: 1010, clientY: 310 }));
    runFrames();
    expect(ends).toEqual([[1010, 310]]);
    k.move(pointer({ clientX: 1200 }));
    runFrames();
    expect(ends).toHaveLength(1);
  });

  it("a button that came up where the page did not see it (outside the window): the next move is the release, and the press is over", async () => {
    const k = await keeper();
    k.down(pointer());
    k.move(pointer({ buttons: 0, clientX: 1500 }));
    runFrames();
    expect(ends).toEqual([[1500, 300]]);
    k.move(pointer({ buttons: 0, clientX: 1600 }));
    runFrames();
    expect(ends).toHaveLength(1);
  });

  it("a press that did not begin in the text is not followed: a card's text, the notes editor, the left pane's title, the map, a separator", async () => {
    const k = await keeper();
    for (const where of ["a card's own text", "the notes editor", "the left pane's title", "the map", "a separator"]) {
      k.down(pointer({ target: elsewhere(where) }));
      k.move(pointer({ clientX: 500 }));
      k.move(pointer({ clientX: 1100 }));
      k.up(pointer({ buttons: 0, clientX: 1100 }));
    }
    runFrames();
    expect(ends).toEqual([]);
  });

  it("a press that goes down on a control inside the column is the control's: not followed (the page's own test of a target decides it)", async () => {
    const control = { inColumn: true, control: true };
    const k = await keeper(env((target) => (target as { inColumn?: boolean; control?: boolean }).inColumn === true && (target as { control?: boolean }).control !== true));
    k.down(pointer({ target: control }));
    k.move(pointer({ clientX: 1100 }));
    k.up(pointer({ buttons: 0 }));
    runFrames();
    expect(ends).toEqual([]);
  });

  it("only a mouse's primary button: a touch, a pen, the secondary button, a pointer that is not primary", async () => {
    const k = await keeper();
    for (const over of [{ pointerType: "touch" }, { pointerType: "pen" }, { button: 2 }, { isPrimary: false }]) {
      k.down(pointer(over));
      k.move(pointer());
      k.up(pointer({ buttons: 0 }));
    }
    runFrames();
    expect(ends).toEqual([]);
  });

  it("another pointer's moves are not this press's", async () => {
    const k = await keeper();
    k.down(pointer({ pointerId: 1 }));
    k.move(pointer({ pointerId: 2, clientX: 1100 }));
    k.up(pointer({ pointerId: 2, buttons: 0 }));
    runFrames();
    expect(ends).toEqual([]);
  });

  it("a cancelled pointer (a drag of the text itself began) ends the press and takes back the correction that was waiting", async () => {
    const k = await keeper();
    k.down(pointer());
    k.move(pointer({ clientX: 1100 }));
    k.cancel();
    runFrames();
    expect(ends).toEqual([]);
    k.move(pointer({ clientX: 1200 }));
    runFrames();
    expect(ends).toEqual([]);
  });

  it("a new press replaces the old: a press outside the text after one inside ends the following", async () => {
    const k = await keeper();
    k.down(pointer());
    k.up(pointer({ buttons: 0, clientX: 1100 }));
    k.down(pointer({ target: elsewhere("a card's own text") }));
    k.move(pointer({ clientX: 1100 }));
    runFrames();
    expect(ends).toEqual([[1100, 300]]); // the first press's release only
  });
});

describe("domEnv — the real page's tests of a target and a point", () => {
  const element = (inside: boolean, controlIn: "none" | "inside" | "outside") => ({
    closest: (selector: string) => (selector.includes("button") && controlIn !== "none" ? { inColumn: controlIn === "inside" } : null),
    inColumn: inside,
  });

  it("a press starts a drag-select in the text when it is in the column and not on a control of the column's own; a control that wraps the column is not one", async () => {
    const { domEnv } = await load();
    const env = domEnv(column());
    expect(env.startsInText(element(true, "none"))).toBe(true);
    expect(env.startsInText(element(true, "inside"))).toBe(false);
    expect(env.startsInText(element(true, "outside"))).toBe(true);
    expect(env.startsInText(element(false, "none"))).toBe(false);
    expect(env.startsInText(null)).toBe(false);
    expect(env.startsInText({ inColumn: true })).toBe(false); // no `closest`: not an element
  });

  it("names the controls: links, buttons, fields, disclosures, labels, editable blocks, draggables and their roles", async () => {
    const { CONTROL_SELECTOR } = await load();
    for (const part of ["a", "button", "input", "textarea", "select", "summary", "label", "[contenteditable]", '[draggable="true"]', '[role="button"]', '[role="link"]']) {
      expect(CONTROL_SELECTOR.split(", ")).toContain(part);
    }
  });

  it("asks for the correction at the window's visible rows: below the masthead's foot, above the window's last row", async () => {
    const { domEnv } = await load();
    const node = { inColumn: true };
    const extend = vi.fn();
    vi.stubGlobal("window", { innerHeight: 720, getSelection: () => ({ rangeCount: 1, isCollapsed: false, anchorNode: node, focusNode: null, focusOffset: 0, extend }) });
    vi.stubGlobal("document", { caretPositionFromPoint: vi.fn((x: number, y: number) => ({ offsetNode: node, offset: y })) });
    domEnv(column()).endAt(1000, 2000);
    expect(extend).toHaveBeenCalledTimes(1);
    expect((document as unknown as { caretPositionFromPoint: ReturnType<typeof vi.fn> }).caretPositionFromPoint).toHaveBeenCalledWith(COLUMN.right - 1, 719);
    extend.mockClear();
    domEnv(column()).endAt(1000, -300);
    expect((document as unknown as { caretPositionFromPoint: ReturnType<typeof vi.fn> }).caretPositionFromPoint).toHaveBeenLastCalledWith(COLUMN.right - 1, 49);
  });
});

describe("watchSelection — the document's listeners", () => {
  it("listens for the press, the move, the release and the cancel on the document, in the capture phase, and lets go of all four", async () => {
    const { watchSelection } = await load();
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => run);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const added: Array<[string, unknown, unknown]> = [];
    const removed: Array<[string, unknown, unknown]> = [];
    const fake = { addEventListener: (t: string, f: unknown, c: unknown) => added.push([t, f, c]), removeEventListener: (t: string, f: unknown, c: unknown) => removed.push([t, f, c]) };
    const stop = watchSelection(column(), fake);
    expect(added.map(([t]) => t)).toEqual(["pointerdown", "pointermove", "pointerup", "pointercancel"]);
    expect(added.every(([, , capture]) => capture === true)).toBe(true);
    stop();
    expect(removed.map(([t]) => t)).toEqual(["pointerdown", "pointermove", "pointerup", "pointercancel"]);
    expect(removed.every(([, , capture]) => capture === true)).toBe(true);
    expect(removed.map(([, f]) => f)).toEqual(added.map(([, f]) => f));
  });

  it("does nothing, and fails nothing, with no document to listen on or no frames", async () => {
    const { watchSelection } = await load();
    vi.stubGlobal("requestAnimationFrame", undefined);
    expect(() => watchSelection(column(), { addEventListener: () => {}, removeEventListener: () => {} })()).not.toThrow();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    expect(() => watchSelection(column(), {})()).not.toThrow();
  });
});

describe("the module's means", () => {
  it("states no pointer-events rule and no listener of the document's other events: it follows the pointer and gives the selection's end, nothing else", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/reader/keep-selection.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/pointer-events|pointerEvents|preventDefault|stopPropagation/);
    expect(source).not.toMatch(/mousemove|mouseup|selectionchange|scrollBy|scrollTo/);
  });
});
