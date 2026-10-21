// P11-45b (the manager's follow-up to P11-45; ruling §1h.148's aim): a drag-select that starts in the paper's text and is released anywhere outside the text
// column ends at the column's nearest edge, at the pointer's height — never at the end of the document.
//
// The fault. The browser ends a drag-select at the place in the DOCUMENT of whatever lies under the pointer. Beside the column lies no text of the paper: a
// separator, the margin's empty aside (at 1280 x 720 on the invented paper: 36,181 to 36,977 characters, no buttons offered, from a release 40 px or more past a
// line's end), a margin card (the fixed cards stand at the end of the document: 36,433 to 36,794), the left pane (its title and map come first in the document:
// 20,285 to 20,825), the masthead above (20,668), the legend and the window's edge below. The selection then runs from the line to that place. Measured, base
// `0d17a382`: P11-45's clamp, on the two separators' own handlers, covered 12 to 23 px past a line's end and nothing else; every other place outside the column was
// still wrong, in both directions, at 1280, 1440 (from 100 px) and 1024. P11-45b folds that clamp into this one handler: the separators have none of their own now.
//
// The rule. While a mouse press that began in the paper's text is held, and at its release, the selection's end is put at the nearest point of the column's
// visible box to the pointer: the column's edge at the pointer's height when the pointer is beside it; the first or the last visible line when it is above the
// masthead's foot or below the window's. Once per animation frame — after the browser's own move of the end, before the paint — so there is nothing to see.
//
// What it leaves to the browser. A press that did not begin in the text (a card's own text, the notes editor, the left pane's title or its map, a field);
// a press on a control inside the column (a link, a button, a field, a summary, a draggable); a pointer that is not a mouse's; a secondary button; a pointer
// over the column (the browser is right there); a selection that did not begin in the column; a collapsed one. A drag that begins on a separator or its keys
// are the separator's own (`pane-divider.tsx`), and a press on the notes tab keeps its own pass-through (`notes-button.tsx`).
//
// Why not the notes tab's CSS rule (`pointer-events: none` while a pointer is held and the element is not the one pressed): tried on the separators in P11-45 and
// measured — the pointer then falls through to the shell's grid, which holds no text there, and the selection ends at the same place. Under a margin, a card
// or a pane there is no text of the column to fall through to; the position has to be given.
//
// Why a file of its own, not `keep-place.ts`: that one keeps the SCROLL place through a re-flow; this one keeps the SELECTION's end through a drag. They share the
// column (`COLUMN_SELECTOR`) and nothing else, and each is one call in the shell.
//
// Everything that decides something is a pure function, or a small controller over an `env`, so it runs in the Node-only test suite; only `domEnv` and the hook
// touch the real page.

import { useEffect, type RefObject } from "react";
import { DOCK_TOP_PX } from "@/components/reader/explain-dock";
import { COLUMN_SELECTOR } from "@/lib/reader/keep-place";

/**
 * A press on one of these is the control's own, not the start of a drag-select in the text: a link, a button, a field, a disclosure, a label, an editable
 * block (a chip in a note), a draggable, the roles of the same. The column is not edited and holds few of them; it is the rule, not a list of what is there.
 */
export const CONTROL_SELECTOR =
  'a, button, input, textarea, select, summary, label, [contenteditable], [draggable="true"], [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"]';

/** How far (px) and how many times the caret is looked for further in when the nearest point is a fixed overlay's (the legend, the masthead). */
export const CARET_STEP_PX = 6;
export const CARET_TRIES = 12;

/** The visible part of the column, vertically: the first line under the masthead's foot, and the window's last row (null where it is not known). */
export interface Visible {
  top: number;
  bottom: number | null;
}

/** The column, as far as this file reads it: its box and what is inside it. */
export interface ColumnLike {
  getBoundingClientRect(): { left: number; right: number };
  contains(node: Node): boolean;
}

/** What gives a caret position under a point: the document (`Document`). */
export interface CaretSource {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => { startContainer: Node; startOffset: number } | null;
}

/** The members of the document's selection this file reads and moves. */
export type SelectionLike = Pick<Selection, "rangeCount" | "isCollapsed" | "anchorNode" | "focusNode" | "focusOffset" | "extend">;

/** The caret position under a point: `caretPositionFromPoint` (Chromium 128 up, Firefox) or `caretRangeFromPoint` (Safari, older Chromium). */
export function caretAt(doc: CaretSource, x: number, y: number): { node: Node; offset: number } | null {
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

/**
 * Put the end of a selection that began in the paper's column at the column's nearest visible point to (x, y). False, and nothing touched, with no selection, a
 * collapsed one, one that began outside the column, a pointer over the column's visible box, no text there, or the end already there.
 *
 * The nearest point: x at the column's edge (one pixel in) when the pointer is beside it, else its own; y at its own, clamped to `visible`. A caret that is not
 * the column's (a fixed overlay stands over that row: the legend at the window's foot, the masthead) is looked for further in, `CARET_STEP_PX` at a time.
 */
export function endSelectionInColumn(
  column: ColumnLike | null,
  x: number,
  y: number,
  visible: Visible,
  doc: CaretSource = document,
  selection: SelectionLike | null = typeof window === "undefined" ? null : window.getSelection(),
): boolean {
  if (!column || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  if (!selection.anchorNode || !column.contains(selection.anchorNode)) return false;
  const box = column.getBoundingClientRect();
  const bottom = visible.bottom ?? Number.POSITIVE_INFINITY;
  const beside = x < box.left || x > box.right;
  const beyond = y < visible.top || y > bottom;
  if (!beside && !beyond) return false;
  const px = x > box.right ? box.right - 1 : x < box.left ? box.left + 1 : x;
  const py = Math.min(Math.max(y, visible.top), bottom);
  // Further in: up from the foot, down from the masthead.
  const inward = Number.isFinite(bottom) && py > (visible.top + bottom) / 2 ? -1 : 1;
  for (let attempt = 0; attempt < CARET_TRIES; attempt++) {
    const spot = caretAt(doc, px, py + inward * attempt * CARET_STEP_PX);
    if (!spot || !column.contains(spot.node)) continue;
    if (selection.focusNode === spot.node && selection.focusOffset === spot.offset) return false;
    selection.extend(spot.node, spot.offset);
    return true;
  }
  return false;
}

/** The members of a pointer event the controller reads. */
export interface PointerLike {
  pointerType: string;
  pointerId: number;
  isPrimary?: boolean;
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
  target: unknown;
}

/** What the controller needs from the page. */
export interface KeeperEnv {
  /** Does a press on this target begin a drag-select in the paper's text? (In the column, and not on a control.) */
  startsInText(target: unknown): boolean;
  /** Put the selection's end at the column's nearest visible point to (x, y). */
  endAt(x: number, y: number): void;
  /** Run `run` at the next animation frame; the result is what `cancel` takes. */
  frame(run: () => void): unknown;
  cancel(handle: unknown): void;
}

/**
 * The press, the pointer and the frame. A mouse press that begins in the paper's text is followed until the button is released (or the pointer is cancelled): each
 * move, and the release, asks for one correction at the next frame — three moves in a frame make one. A press that begins anywhere else is not followed at all.
 */
export function selectionKeeper(env: KeeperEnv) {
  /** The pointer of a press that began in the text, and is held. */
  let pressed: number | null = null;
  let waiting: unknown = null;
  const ask = (x: number, y: number) => {
    if (waiting !== null) env.cancel(waiting);
    waiting = env.frame(() => {
      waiting = null;
      env.endAt(x, y);
    });
  };
  return {
    down(event: PointerLike) {
      const mouse = event.pointerType === "mouse" && event.button === 0 && event.isPrimary !== false;
      pressed = mouse && env.startsInText(event.target) ? event.pointerId : null;
    },
    move(event: PointerLike) {
      if (pressed === null || event.pointerId !== pressed) return;
      // The button came up where the page did not see it (outside the window): that was the release.
      if ((event.buttons & 1) === 0) pressed = null;
      ask(event.clientX, event.clientY);
    },
    up(event: PointerLike) {
      if (pressed === null || event.pointerId !== pressed) return;
      pressed = null;
      ask(event.clientX, event.clientY);
    },
    /** The pointer was cancelled (a drag of the text itself began; the system took the touch): nothing to correct. */
    cancel() {
      pressed = null;
      if (waiting !== null) env.cancel(waiting);
      waiting = null;
    },
  };
}

/** The real page, for a column. Browser only. */
export function domEnv(column: Element): KeeperEnv {
  return {
    startsInText(target) {
      const element = target as Element | null;
      if (!element || !column.contains(element) || typeof element.closest !== "function") return false;
      const control = element.closest(CONTROL_SELECTOR);
      return !control || !column.contains(control);
    },
    endAt(x, y) {
      endSelectionInColumn(column, x, y, { top: DOCK_TOP_PX + 1, bottom: typeof window.innerHeight === "number" ? window.innerHeight - 1 : null });
    },
    frame: (run) => requestAnimationFrame(run),
    cancel: (handle) => cancelAnimationFrame(handle as number),
  };
}

/** Listen on the document, in the capture phase (nothing between the press and us can stop it), until the result is called. */
export function watchSelection(column: Element, doc: Document = document): () => void {
  if (typeof doc.addEventListener !== "function" || typeof requestAnimationFrame !== "function") return () => {};
  const keeper = selectionKeeper(domEnv(column));
  const down = (event: Event) => keeper.down(event as PointerEvent);
  const move = (event: Event) => keeper.move(event as PointerEvent);
  const up = (event: Event) => keeper.up(event as PointerEvent);
  const cancel = () => keeper.cancel();
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("pointermove", move, true);
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("pointercancel", cancel, true);
  return () => {
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("pointercancel", cancel, true);
    keeper.cancel();
  };
}

/**
 * The shell's one call: a drag-select that began in the paper's text ends at the column's edge whatever the pointer is over. `grid` is the shell's grid, which holds
 * the column; where it cannot be found (a shell rendered without a DOM) nothing is watched and nothing fails.
 */
export function useKeepSelection(grid: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const shell = grid.current;
    if (!shell || typeof shell.querySelector !== "function") return;
    const column = shell.querySelector(COLUMN_SELECTOR);
    return column ? watchSelection(column) : undefined;
  }, [grid]);
}
