"use client";

import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { COLUMN_SELECTOR } from "@/lib/reader/keep-place";
import { readPageZoom } from "@/lib/reader/margin";
import { clampPane, defaultPanePx, paneRange, stepPane, type PaneName, type PaneRoom } from "./pane-layout";

// The separator between two panes (P11-10 rule 2; B P11-01 §2.6; ruling §1h.113 (a)). One per boundary of the reader shell
// (`reader-shell.tsx`): left | centre resizes the left pane, centre | margin resizes the margin. It is a `role="separator"` the reader
// can reach with Tab and move with the arrow keys, and drag with a pointer.
//
// The pointer path is the figure lightbox's capture pattern (`figure-lightbox.tsx`, `startDrag` / `moveDrag` / `endDrag`): a primary,
// left-button press takes the pointer (`setPointerCapture`), nothing moves until the pointer has travelled 4 px, and `pointerup`,
// `pointercancel` and `lostpointercapture` end it. What it moves is a CSS custom property on the shell's grid (`variable`, e.g.
// `--margin-w`), written once per animation frame — no React render per pointer move, so the text re-flows at the browser's speed —
// and the width is committed once, on release (`onCommit`, which writes the store): a stored width is never written during a drag.
//
// The keyboard path (`stepPane`): ← → move the boundary 16 px, Shift 64; Home and End are the pane's least and greatest width; Enter is
// its default. A double-click is its default too.
//
// Zoom. Fit scales the page with a CSS `zoom`, so a pointer's distance (window px) is divided by `--page-zoom` to get the layout px the
// widths are in (B §1.4, measured). `aria-valuenow`, the CSS variable and the committed width are all in those unzoomed px.

// A drag-select that starts in the paper's text and is released over a separator (P11-45, the manager's addition from C P11-46's measurement; ruling §1h.148's
// aim): at 1280 css px the separator is the 12 px beside the column's own 12 px of padding, so a release 12 to 23 px past a line's end is over it, and the browser
// ends the selection at the separator's place in the document - the end of the paper for the margin's, the end of the left pane for the left's (36,977 and
// 19,467 characters at 1280 x 720 on the invented paper, with no buttons offered: the selection is far over the cap). The notes tab's cure (C P11-46: while a
// pointer is held and the element is not what it went down on, `pointer-events: none` - `[:root:active_&:not(:active)]`) was tried here and measured: the pointer
// then falls through to the shell's grid, which holds no text there, and the selection still ends at the same place. So the separator keeps the pointer and puts
// the selection's end right itself: while a press made elsewhere is held over it (the selection began in the paper's column) the end goes to the text column's
// nearest edge at the pointer's height - the line's end - once per animation frame, after the browser's own move of it and before the paint, and again at the
// release. It does nothing for the separator's own drag (that press is `drag.current`), for a pointer over the text, for a touch, or for a selection that did not
// begin in the column; its keys, its focus and its hit area are as they were.

/** The caret position under a point: `caretPositionFromPoint` (Chromium 128 up, Firefox) or `caretRangeFromPoint` (Safari, older Chromium). */
function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const standard = doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (typeof standard.caretPositionFromPoint === "function") {
    const position = standard.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

/**
 * Put the end of a selection that began in the paper's text back at the line's end when the pointer is beside the column: to the text column's nearest edge,
 * at the pointer's height. False, and nothing touched, with no selection, a collapsed one, one that began outside the column, a pointer over the column, or no
 * text at that point. `grid` is the shell's grid, which holds the column.
 */
export function endSelectionInColumn(
  grid: Pick<ParentNode, "querySelector"> | null,
  x: number,
  y: number,
  doc: Document = document,
  selection: Selection | null = typeof window === "undefined" ? null : window.getSelection(),
): boolean {
  const column = grid && typeof grid.querySelector === "function" ? grid.querySelector(COLUMN_SELECTOR) : null;
  if (!column || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  if (!selection.anchorNode || !column.contains(selection.anchorNode)) return false;
  const box = column.getBoundingClientRect();
  if (x >= box.left && x <= box.right) return false;
  const spot = caretAt(doc, x > box.right ? box.right - 1 : box.left + 1, y);
  if (!spot || !column.contains(spot.node)) return false;
  selection.extend(spot.node, spot.offset);
  return true;
}

/** The pointer has to travel this far (window px) before a press is a drag: the lightbox's own threshold. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * The width a drag has reached: the pane's width when the press began plus the pointer's horizontal travel, divided by the page's zoom
 * (window px to layout px). The left pane grows as the pointer goes right, the margin as it goes left. Clamped to the pane's range and
 * to what leaves the centre its minimum. Pure.
 */
export function dragWidth(pane: PaneName, origin: number, travelPx: number, zoom: number, room?: PaneRoom): number {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const sign = pane === "left" ? 1 : -1;
  return clampPane(pane, origin + (sign * travelPx) / scale, room);
}

export interface PaneDividerProps {
  pane: PaneName;
  /** The pane's width now, in unzoomed css px. */
  value: number;
  /** The window and the other pane's track: what keeps the centre at its minimum. */
  room: PaneRoom;
  /** The element that carries the pane's CSS variable: the shell's grid. */
  target: RefObject<HTMLElement | null>;
  /** The custom property on `target` that holds this pane's width in px. */
  variable: string;
  /** The accessible name: "Resize left panel". */
  label: string;
  /** The id of the pane this separator resizes. */
  controls: string;
  /** A width the reader chose — a released drag, a key, a double-click. The shell writes it to the store. */
  onCommit: (width: number) => void;
}

interface Drag {
  pointerId: number;
  /** The pointer's x when it went down, window px. */
  startX: number;
  /** The pane's width when it went down. */
  origin: number;
  zoom: number;
  moved: boolean;
  /** The last width computed, and the one waiting for its frame. */
  latest: number;
  frame: number | null;
}

export function PaneDivider({ pane, value, room, target, variable, label, controls, onCommit }: PaneDividerProps) {
  const self = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const bodyBefore = useRef<{ userSelect: string; cursor: string } | null>(null);
  /** The animation frame that waits to put a selection's end back in the column (a press made elsewhere, held over this separator). */
  const selecting = useRef<number | null>(null);
  const { min, max } = paneRange(pane, room);

  /** Show a width now: the grid's custom property and the separator's own value. */
  const show = (width: number) => {
    target.current?.style.setProperty(variable, `${width}px`);
    self.current?.setAttribute("aria-valuenow", String(width));
  };

  const finish = (active: Drag) => {
    if (active.frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(active.frame);
    active.frame = null;
    drag.current = null;
    if (self.current) delete self.current.dataset.dragging;
    if (bodyBefore.current && typeof document !== "undefined") {
      document.body.style.userSelect = bodyBefore.current.userSelect;
      document.body.style.cursor = bodyBefore.current.cursor;
    }
    bodyBefore.current = null;
  };

  /** A press made elsewhere is held (or was released) over the separator: after the browser has moved the selection's end, and before the paint, put it back. */
  const keepSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || typeof requestAnimationFrame !== "function") return;
    const { clientX, clientY } = event;
    if (selecting.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(selecting.current);
    selecting.current = requestAnimationFrame(() => {
      selecting.current = null;
      endSelectionInColumn(target.current, clientX, clientY);
    });
  };

  // A drag still under way when the separator goes (the pane collapses, the page navigates) must not leave the page unselectable.
  useEffect(
    () => () => {
      if (drag.current) finish(drag.current);
      if (selecting.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(selecting.current);
    },
    [],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    // No text selection, no scroll, no focus theft by the browser: the press is ours.
    event.preventDefault();
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      origin: value,
      zoom: readPageZoom(element),
      moved: false,
      latest: value,
      frame: null,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) {
      // Not this separator's drag: a button held from a press made elsewhere, over it.
      if ((event.buttons & 1) === 1) keepSelection(event);
      return;
    }
    if (active.pointerId !== event.pointerId) return;
    const travel = event.clientX - active.startX;
    if (!active.moved) {
      if (Math.abs(travel) < DRAG_THRESHOLD_PX) return;
      active.moved = true;
      if (self.current) self.current.dataset.dragging = "true";
      if (typeof document !== "undefined") {
        bodyBefore.current = { userSelect: document.body.style.userSelect, cursor: document.body.style.cursor };
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
      }
    }
    active.latest = dragWidth(pane, active.origin, travel, active.zoom, room);
    if (active.frame !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      show(active.latest);
      return;
    }
    active.frame = requestAnimationFrame(() => {
      active.frame = null;
      show(active.latest);
    });
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) {
      if (event.type === "pointerup" && event.button === 0) keepSelection(event);
      return;
    }
    if (active.pointerId !== event.pointerId) return;
    const element = event.currentTarget;
    // Only a release is a choice; a cancelled or lost pointer puts the pane back where it stood.
    const released = event.type === "pointerup";
    finish(active);
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (!active.moved) return;
    if (released) {
      show(active.latest);
      onCommit(active.latest);
    } else {
      show(active.origin);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt+← is the browser's Back, Ctrl/Cmd + arrows are the system's: not ours.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = stepPane(pane, value, event.key, event.shiftKey, room);
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onCommit(next);
  };

  const onDoubleClick = () => {
    onCommit(clampPane(pane, defaultPanePx(pane, room.viewport), room));
  };

  return (
    <div
      ref={self}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className="reader-divider"
      data-reader-divider={pane}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
