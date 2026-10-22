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
// P11-57 (ruling §1h.165): the same rule for a Shift+click. A click on a word leaves a caret in the text, and a Shift+click then takes the lines between: the browser
// extends the standing selection to the place under the pointer on the PRESS (not the release), and that press began outside the column, so it was not followed.
// Measured, base `6b02956c`, 1280 x 720: 12 to 23 px past a line's end (over the margin's separator, whose own press is taken, so the browser changes nothing) left the
// caret as it was, 0 characters; 40 px and more past (over the aside) ran to the end of the paper, 39,208 characters, no buttons; 40 and 120 px before a line's start (over
// the left pane) ran to 17,816 to 17,828. A Shift+press whose target is outside the column and on no control of its own, while a selection whose anchor is in the column
// stands (a caret counts: it is what a click leaves, and what the Shift+click extends), is followed like a press in the text: the anchor is read at the press, before the
// browser's own move, and one correction is made at the next frame (the browser has extended by then), then again on each move while the button is held (a click that is
// not quite still is a drag-extension to the browser) and at the release. Where the browser has moved the anchor out of the column or cleared the selection, it is put back
// from the anchor read at the press, then ended at the edge. A pointer over the column's box whose press was on something outside it (a fixed overlay over the text) is
// corrected too: its own caret, found further in where the overlay stands. A Shift+press in the text, on a control, with no column selection standing (a card's text, the
// notes editor, a text field's own caret), without Shift, by touch or pen: as before. A press that puts a text field in focus (the notes window's text, which becomes its
// editor on a click) is the field's: the frame after finds it focused and the correction is not made.
//
// Why not the notes tab's CSS rule (`pointer-events: none` while a pointer is held and the element is not the one pressed): tried on the separators in P11-45 and
// measured — the pointer then falls through to the shell's grid, which holds no text there, and the selection ends at the same place. Under a margin, a card
// or a pane there is no text of the column to fall through to; the position has to be given.
//
// Why a file of its own, not `keep-place.ts`: that one keeps the SCROLL place through a re-flow; this one keeps the SELECTION's end through a drag. They share the
// column (`COLUMN_SELECTOR`) and nothing else, and each is one call in the shell.
//
// P11-62 (ruling §1h.173): the foot legend is not the column's. The window's last rows (`DOCK_BOTTOM_PX`, 28 px; `legendHeightPx(zoom)` once Fit scales the page) are the legend's,
// a fixed overlay of the page, and its text is the last in the document. Measured, base `b6aa9c22`, 1024 x 768 to 1920 x 1080, light and dark, with and without a key, Fit on
// at 1280 and 1440: a drag released at any height over the legend, in the column's x, ran to the end of the paper (70,018 to 70,145 characters on the walk's paper), the legend's
// words highlighted, no button offered — the visible box said the window's last row was the column's, so the pointer was "over the column" and the browser's own end was left
// alone. Over the margin or the left pane the same release was corrected (the pointer was beside the column). `Visible.legendTop` is the legend's top edge at the page's own
// zoom: a pointer at or below it is beyond the visible box, and the end goes to the last visible line, whatever the x. Only that decision moved: where the last visible line is
// looked for (from the pointer's row, or the window's last, up past the legend) is as it was, so a release over the margin, the left pane or below the window ends where it did.
// (Tried first: the box's `bottom` itself moved above the legend. It put the search at the row above the legend's top edge and every release below the window, and the last pixel
// over the margin, ended one line lower than today — measured, 1280 x 720: 599 to 668 characters.)
//
// P11-66 (ruling §1h.180): the same rule for a TRIPLE click and a drag. Round 7's Theme B walk (`z21`, five windows, 40 drags each, paragraphs of 1,100 to 1,700 characters):
// a triple click on a paragraph, then a drag released beside the column or beyond its visible box, ended the selection in the left pane in 12 of 100 (1,649 characters at 1440;
// 4 over a pane control; no button offered) and, where it stayed in the paper, left the triple-clicked paragraph out in 56 more (its first lines, or all but its first line,
// 77 to 1,362 characters of a paragraph of 1,009 to 1,413). A single press's drag, and a double click's, were clean in 100 of 100. The cause, by execution on the real page
// (`Selection.extend` logged): the correction ran, once, at the first move, and put the end at the character the column's edge gives at the pointer's height. A triple
// click's selection starts at the paragraph's start, so on its first line that character IS the start: the selection collapsed (0 characters); the browser's next move then took
// the collapsed selection's place for its base, in the pane's own block, and every later correction found a selection that "began outside the column" and returned. On a later
// line the end went to that line's start — a character is not what the browser's paragraph granularity gives. The browser's Chrome keeps that granularity for the whole drag, so
// the end has to be a paragraph's too. A triple click is a third press within `MULTI_CLICK_MS` and `MULTI_CLICK_PX` of the second (pointer events carry no count) that leaves
// a selection standing at its first move; that selection is the base (the paragraph, from its start to its end, as the browser has it), read before the browser's own move
// of it. The correction (`endParagraphsInColumn`) finds the paragraph at the column's nearest visible point with the browser's own `modify(…, "paragraphboundary")` and puts
// the selection at the base's start through that paragraph's end (a later paragraph), or at that paragraph's start from the base's end (an earlier one); the base is never left
// out, and it does not depend on where the browser has taken the selection since. Once a correction has been made the selection is ours for the rest of the press (setting
// a selection by hand ends the browser's paragraph granularity: measured, a drag taken over the pane and back over the column ended at the pointer's character, 112 to 122
// characters of a paragraph), so a pointer that comes back over the column is followed too, at its own place. A single press, a double click, a plain triple click, a pointer over the column, touch and
// pen, and a Shift+press are as before. (A third press has to be the third: three presses a second apart, or 10 px apart, are single presses.)
//
// Everything that decides something is a pure function, or a small controller over an `env`, so it runs in the Node-only test suite; only `domEnv` and the hook
// touch the real page.

import { useEffect, type RefObject } from "react";
import { DOCK_TOP_PX, legendHeightPx } from "@/components/reader/explain-dock";
import { COLUMN_SELECTOR } from "@/lib/reader/keep-place";
import { readPageZoom } from "@/lib/reader/margin";

/**
 * A press on one of these is the control's own, not the start of a drag-select in the text: a link, a button, a field, a disclosure, a label, an editable
 * block (a chip in a note), a draggable, the roles of the same. The column is not edited and holds few of them; it is the rule, not a list of what is there.
 */
export const CONTROL_SELECTOR =
  'a, button, input, textarea, select, summary, label, [contenteditable], [draggable="true"], [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"]';

/** A legend's top edge that is a whole number of pixels to within this is that number (the product of 28 and Fit's zoom carries rounding noise): its row is the legend's. */
export const LEGEND_EDGE_EPSILON_PX = 1e-6;

/** How far (px) and how many times the caret is looked for further in when the nearest point is a fixed overlay's (the legend, the masthead). */
export const CARET_STEP_PX = 6;
export const CARET_TRIES = 12;

/** A third press within this long (ms) and this far (px) of the second is a triple click: pointer events carry no click count, so the keeper counts (P11-66). */
export const MULTI_CLICK_MS = 1000;
export const MULTI_CLICK_PX = 10;

/**
 * The visible part of the column, vertically: the first line under the masthead's foot, and the window's last row (null where it is not known); `legendTop` is the foot
 * legend's top edge (P11-62), the rows from it down being the legend's and not the column's — absent or null where there is none or it is not known.
 */
export interface Visible {
  top: number;
  bottom: number | null;
  legendTop?: number | null;
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
export type SelectionLike = Pick<Selection, "rangeCount" | "isCollapsed" | "anchorNode" | "anchorOffset" | "focusNode" | "focusOffset" | "extend" | "collapse">;

/** The anchor of the selection that stood when a Shift+press went down: the one thing the browser's own move of the end does not lose for us. */
export interface Held {
  node: Node;
  offset: number;
}

/** A selection's two ends in document order: what a triple click selected (a paragraph, from its start to the next one's, as the browser has it) when the drag began. */
export interface Span {
  start: Held;
  end: Held;
}

/** What a text field is: where a caret is the field's own and not a selection of the paper. */
export const TEXT_FIELD_SELECTOR = "input, textarea, [contenteditable]";

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
 *
 * `press` is the anchor read at a Shift+press whose target was outside the column (P11-57): the selection may then be a caret (a click's, or the one a separator's own
 * press leaves) and the pointer may stand over the column's box (an overlay), so neither makes it return; and where the browser has moved the anchor out of the column, or
 * cleared the selection, the selection is put back at `press` before its end is moved. False, and nothing touched, where `press` is no longer in the column.
 */
export function endSelectionInColumn(
  column: ColumnLike | null,
  x: number,
  y: number,
  visible: Visible,
  doc: CaretSource = document,
  selection: SelectionLike | null = typeof window === "undefined" ? null : window.getSelection(),
  press: Held | null = null,
): boolean {
  if (press) {
    if (!column || !selection || !column.contains(press.node)) return false;
  } else {
    if (!column || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    if (!selection.anchorNode || !column.contains(selection.anchorNode)) return false;
  }
  const box = column.getBoundingClientRect();
  const bottom = visible.bottom ?? Number.POSITIVE_INFINITY;
  const beside = x < box.left || x > box.right;
  const beyond = y < visible.top || y > bottom || (typeof visible.legendTop === "number" && y >= visible.legendTop - LEGEND_EDGE_EPSILON_PX);
  if (!press && !beside && !beyond) return false;
  const px = x > box.right ? box.right - 1 : x < box.left ? box.left + 1 : x;
  const py = Math.min(Math.max(y, visible.top), bottom);
  // Further in: up from the foot, down from the masthead.
  const inward = Number.isFinite(bottom) && py > (visible.top + bottom) / 2 ? -1 : 1;
  for (let attempt = 0; attempt < CARET_TRIES; attempt++) {
    const spot = caretAt(doc, px, py + inward * attempt * CARET_STEP_PX);
    if (!spot || !column.contains(spot.node)) continue;
    const kept = selection.rangeCount > 0 && !!selection.anchorNode && column.contains(selection.anchorNode);
    if (press && !kept) selection.collapse(press.node, press.offset);
    else if (selection.focusNode === spot.node && selection.focusOffset === spot.offset) return false;
    selection.extend(spot.node, spot.offset);
    return true;
  }
  return false;
}

/** The selection's members `endParagraphsInColumn` moves: the ones above, and the browser's own `modify` (the paragraph's boundaries). */
export type ParagraphSelectionLike = SelectionLike & Pick<Selection, "modify">;

/**
 * Where `a` stands against `b` in the document: negative before, zero the same, positive after. Positions in one node by offset; in two, by the nodes' order, and where one
 * holds the other, by the child that holds it.
 */
export function comparePositions(a: Held, b: Held): number {
  if (a.node === b.node) return a.offset - b.offset;
  const rel = a.node.compareDocumentPosition(b.node);
  const childAt = (parent: Node, inside: Node): number => {
    let child = inside;
    while (child.parentNode && child.parentNode !== parent) child = child.parentNode;
    return Array.prototype.indexOf.call(parent.childNodes, child) as number;
  };
  // 16: b lies inside a; 8: a lies inside b; 4: b follows a; else b precedes a.
  if (rel & 16) return childAt(a.node, b.node) < a.offset ? 1 : -1;
  if (rel & 8) return childAt(b.node, a.node) < b.offset ? -1 : 1;
  return rel & 4 ? -1 : 1;
}

/**
 * P11-66: put the end of a triple-click selection at the paragraph the column's nearest visible point to (x, y) lies in. `base` is the paragraph that was triple-clicked, read
 * before the browser moved it. False, and nothing touched, with no column, a base that is no longer in it, a pointer over the column's visible box, or no text there.
 *
 * The nearest point and the rows tried are `endSelectionInColumn`'s. `engaged` is set once a correction has been made for this press: the selection is then ours — setting it
 * by hand ends the browser's paragraph granularity for the rest of the drag (measured: a drag taken over the pane and back over the column ended at the pointer's character, 112
 * to 122 characters of a paragraph) — so a pointer back over the column is followed too, at its own place. The paragraph under the point is found with the browser's own boundaries, not read off the DOM: the caret
 * is put there, moved back to the paragraph's start, then extended to its end. The selection is then set whole — the base's start through that paragraph's end (or the base's end,
 * if that is later: the same paragraph), or, for a paragraph wholly before the base, its start through the base's end — whatever the browser has done with it since the press.
 */
export function endParagraphsInColumn(
  column: ColumnLike | null,
  x: number,
  y: number,
  visible: Visible,
  base: Span,
  doc: CaretSource = document,
  selection: ParagraphSelectionLike | null = typeof window === "undefined" ? null : window.getSelection(),
  order: (a: Held, b: Held) => number = comparePositions,
  engaged = false,
): boolean {
  if (!column || !selection || !column.contains(base.start.node)) return false;
  const box = column.getBoundingClientRect();
  const bottom = visible.bottom ?? Number.POSITIVE_INFINITY;
  const beside = x < box.left || x > box.right;
  const beyond = y < visible.top || y > bottom || (typeof visible.legendTop === "number" && y >= visible.legendTop - LEGEND_EDGE_EPSILON_PX);
  if (!beside && !beyond && !engaged) return false;
  const px = x > box.right ? box.right - 1 : x < box.left ? box.left + 1 : x;
  const py = Math.min(Math.max(y, visible.top), bottom);
  const inward = Number.isFinite(bottom) && py > (visible.top + bottom) / 2 ? -1 : 1;
  let touched = false;
  for (let attempt = 0; attempt < CARET_TRIES; attempt++) {
    const spot = caretAt(doc, px, py + inward * attempt * CARET_STEP_PX);
    if (!spot || !column.contains(spot.node)) continue;
    touched = true;
    selection.collapse(spot.node, spot.offset);
    selection.modify("move", "backward", "paragraphboundary");
    const first = selection.focusNode ? { node: selection.focusNode, offset: selection.focusOffset } : null;
    selection.modify("extend", "forward", "paragraphboundary");
    const last = selection.focusNode ? { node: selection.focusNode, offset: selection.focusOffset } : null;
    if (!first || !last) continue;
    const earlier = order(last, base.start) < 0;
    const anchor = earlier ? base.end : base.start;
    const focus = earlier ? first : order(last, base.end) > 0 ? last : base.end;
    selection.collapse(anchor.node, anchor.offset);
    selection.extend(focus.node, focus.offset);
    return true;
  }
  // No paragraph of the column's could be read after the caret was moved: the base is put back, as the browser had it at the press.
  if (touched) {
    selection.collapse(base.start.node, base.start.offset);
    selection.extend(base.end.node, base.end.offset);
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
  shiftKey?: boolean;
  /** The event's time (ms): the keeper counts presses by it (P11-66). Absent: the press counts as a single one. */
  timeStamp?: number;
}

/** What the controller needs from the page. */
export interface KeeperEnv {
  /** Does a press on this target begin a drag-select in the paper's text? (In the column, and not on a control.) */
  startsInText(target: unknown): boolean;
  /** Does a Shift+press on this target begin outside the column, on no control of its own? */
  startsOutside(target: unknown): boolean;
  /** The anchor of the selection that stands, when it began in the column and is not a text field's own caret; null otherwise. Read at the press. */
  standing(): Held | null;
  /** Put the selection's end at the column's nearest visible point to (x, y); `press` is the anchor read at a Shift+press (P11-57). */
  endAt(x: number, y: number, press?: Held): void;
  /** The paragraph a triple click selected, read before the browser moves it; null where the selection is not one of the column's (P11-66). Absent: triple clicks are not followed as such. */
  paragraph?(): Span | null;
  /** Put the end of a triple-click selection at the paragraph of the column's nearest visible point to (x, y), `base` kept whole (P11-66). */
  endParagraphsAt?(x: number, y: number, base: Span): void;
  /** Run `run` at the next animation frame; the result is what `cancel` takes. */
  frame(run: () => void): unknown;
  cancel(handle: unknown): void;
}

/**
 * The press, the pointer and the frame. A mouse press that begins in the paper's text is followed until the button is released (or the pointer is cancelled): each
 * move, and the release, asks for one correction at the next frame — three moves in a frame make one. A press that begins anywhere else is not followed at all —
 * except a Shift+press outside the column, on no control, with a selection that began in the column standing (P11-57): its anchor is read at the press, one correction is
 * asked for at the next frame, then as for any press followed, each correction carrying that anchor.
 */
export function selectionKeeper(env: KeeperEnv) {
  /** The pointer of a press that began in the text, and is held. */
  let pressed: number | null = null;
  /** The anchor read at a Shift+press outside the column, while that press is held; null for a press that began in the text. */
  let held: Held | null = null;
  let waiting: unknown = null;
  /** The last mouse press: when and where, and how many in a row (P11-66). */
  let last: { time: number; x: number; y: number } | null = null;
  let clicks = 0;
  /** The held press is a triple click's (or a later click's) and is read at its first move or release; the paragraph it selected, once read. */
  let triple = false;
  let base: Span | null = null;
  const takeBase = () => {
    if (!triple) return;
    triple = false;
    base = env.paragraph ? env.paragraph() : null;
  };
  const ask = (x: number, y: number) => {
    if (waiting !== null) env.cancel(waiting);
    const press = held;
    const paragraphs = base;
    waiting = env.frame(() => {
      waiting = null;
      if (press) env.endAt(x, y, press);
      else if (paragraphs && env.endParagraphsAt) env.endParagraphsAt(x, y, paragraphs);
      else env.endAt(x, y);
    });
  };
  /** The press is over: one last correction at (x, y), carrying the press's own anchor. */
  const release = (x: number, y: number) => {
    pressed = null;
    ask(x, y);
    held = null;
  };
  return {
    down(event: PointerLike) {
      const mouse = event.pointerType === "mouse" && event.button === 0 && event.isPrimary !== false;
      pressed = mouse && env.startsInText(event.target) ? event.pointerId : null;
      held = null;
      base = null;
      triple = false;
      if (mouse && typeof event.timeStamp === "number") {
        const again = last !== null && event.timeStamp >= last.time && event.timeStamp - last.time <= MULTI_CLICK_MS && Math.abs(event.clientX - last.x) <= MULTI_CLICK_PX && Math.abs(event.clientY - last.y) <= MULTI_CLICK_PX;
        clicks = again ? clicks + 1 : 1;
        last = { time: event.timeStamp, x: event.clientX, y: event.clientY };
        triple = pressed !== null && clicks >= 3 && event.shiftKey !== true && typeof env.paragraph === "function";
      } else {
        clicks = 0;
        last = null;
      }
      if (pressed === null && mouse && event.shiftKey === true && env.startsOutside(event.target)) {
        const standing = env.standing();
        if (standing) {
          pressed = event.pointerId;
          held = standing;
          ask(event.clientX, event.clientY);
        }
      }
    },
    move(event: PointerLike) {
      if (pressed === null || event.pointerId !== pressed) return;
      takeBase();
      // The button came up where the page did not see it (outside the window): that was the release.
      if ((event.buttons & 1) === 0) release(event.clientX, event.clientY);
      else ask(event.clientX, event.clientY);
    },
    up(event: PointerLike) {
      if (pressed === null || event.pointerId !== pressed) return;
      takeBase();
      release(event.clientX, event.clientY);
    },
    /** The pointer was cancelled (a drag of the text itself began; the system took the touch): nothing to correct. */
    cancel() {
      pressed = null;
      held = null;
      triple = false;
      base = null;
      if (waiting !== null) env.cancel(waiting);
      waiting = null;
    },
  };
}

/** The real page, for a column. Browser only. */
export function domEnv(column: Element): KeeperEnv {
  /** A correction has been made for the triple click that is held (P11-66): the selection is ours until it is released, over the column as beside it. */
  let engaged = false;
  /**
   * The column's visible rows: below the masthead's foot, above the foot legend (P11-62: its top edge is the window's height less the legend's, as the page computes it —
   * `legendHeightPx` at the page's Fit zoom). The window's last row is still where the last visible line is looked for from, a pointer below the window's foot.
   */
  const visible = (): Visible => {
    const height = typeof window.innerHeight === "number" ? window.innerHeight : null;
    return { top: DOCK_TOP_PX + 1, bottom: height === null ? null : height - 1, legendTop: height === null ? null : height - legendHeightPx(readPageZoom(column)) };
  };
  /** Does a text field (an input, a textarea, an editable block) have the focus? Then the caret in the document is its own. */
  const fieldHasFocus = (): boolean => {
    const field = document.activeElement;
    return !!field && typeof field.matches === "function" && field.matches(TEXT_FIELD_SELECTOR);
  };
  return {
    startsInText(target) {
      const element = target as Element | null;
      if (!element || !column.contains(element) || typeof element.closest !== "function") return false;
      const control = element.closest(CONTROL_SELECTOR);
      return !control || !column.contains(control);
    },
    startsOutside(target) {
      const element = target as Element | null;
      if (!element || typeof element.closest !== "function" || column.contains(element)) return false;
      const control = element.closest(CONTROL_SELECTOR);
      return !control || (typeof control.contains === "function" && control.contains(column));
    },
    standing() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !column.contains(selection.anchorNode)) return null;
      if (fieldHasFocus()) return null;
      return { node: selection.anchorNode, offset: selection.anchorOffset };
    },
    paragraph() {
      engaged = false;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return null;
      if (fieldHasFocus()) return null;
      const anchor = { node: selection.anchorNode, offset: selection.anchorOffset };
      const focus = { node: selection.focusNode, offset: selection.focusOffset };
      const forward = comparePositions(anchor, focus) <= 0;
      const span = forward ? { start: anchor, end: focus } : { start: focus, end: anchor };
      return column.contains(span.start.node) ? span : null;
    },
    endParagraphsAt(x, y, base) {
      if (fieldHasFocus()) return;
      const selection = window.getSelection();
      // A browser with no `modify` has no paragraph to find: the end is put at the character, as for any press.
      if (selection && typeof selection.modify === "function") engaged = endParagraphsInColumn(column, x, y, visible(), base, document, selection, undefined, engaged) || engaged;
      else endSelectionInColumn(column, x, y, visible());
    },
    endAt(x, y, press) {
      if (!press) {
        endSelectionInColumn(column, x, y, visible());
        return;
      }
      // A text field took the focus in this press (a card's text that turns into its editor on a click): its caret is the selection now, and the field's own.
      if (fieldHasFocus()) return;
      endSelectionInColumn(column, x, y, visible(), document, window.getSelection(), press);
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
 * The shell's one call: a drag-select that began in the paper's text, and a Shift+click outside the column with a selection of the paper standing, end at the column's
 * edge whatever the pointer is over. `grid` is the shell's grid, which holds the column; where it cannot be found (a shell rendered without a DOM) nothing is watched and
 * nothing fails.
 */
export function useKeepSelection(grid: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const shell = grid.current;
    if (!shell || typeof shell.querySelector !== "function") return;
    const column = shell.querySelector(COLUMN_SELECTOR);
    return column ? watchSelection(column) : undefined;
  }, [grid]);
}
