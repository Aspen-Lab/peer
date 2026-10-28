"use client";

import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
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

/**
 * P12-89 rule 2 (ruling §1h.473; blind reader B3-r1, A P12-88 §7): the separator's strip ends at the key legend's top edge, so that no fixed overlay stands over any part of it.
 *
 * The strip was as tall as the shell's row (`align-self: stretch`), the whole paper; the key legend is fixed to the window's foot, so for the 28 px (x the page's Fit zoom)
 * above the window's foot the legend stood over the strip at every scroll position but the last, and a scan down the strip missed there (A's `B1hit`: the misses at the
 * foot of each scan). The strip is now sticky, as the left pane is: it begins where the pane does (`calc(3rem / zoom + 1rem)`: the masthead, unzoomed, and the article's
 * 1rem of top padding, zoomed: its position at scroll 0, so it never slides) and is no taller than the window leaves between that and the legend's top edge:
 * `(100vh - 3rem) / zoom - legend - 1rem`, where the legend is `var(--legend-h)` in the zoomed page — the legend's own height, 28 x zoom on the window's pixels
 * (`legendHeightPx`), so the strip's foot is the legend's top at every Fit zoom. `height: 100%` keeps it no taller than its row where the row is shorter (a short
 * paper), and at the foot of the page the row's end carries it up, clear of the legend. The line it draws (`::before`, the whole strip), its hit area, its width, its
 * cursor and its focus are the stylesheet's `.reader-divider`, as they were; only the strip's length changes, from the row's to this.
 */
export const DIVIDER_FOOT_STYLE: CSSProperties = {
  position: "sticky",
  alignSelf: "start",
  top: "calc(3rem / var(--page-zoom, 1) + 1rem)",
  height: "100%",
  maxHeight: "calc((100vh - 3rem) / var(--page-zoom, 1) - var(--legend-h) - 1rem)",
};

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

  // A drag still under way when the separator goes (the pane collapses, the page navigates) must not leave the page unselectable.
  useEffect(
    () => () => {
      if (drag.current) finish(drag.current);
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
    if (!active || active.pointerId !== event.pointerId) return;
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
    if (!active || active.pointerId !== event.pointerId) return;
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
      style={DIVIDER_FOOT_STYLE}
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
