// The margin's contract (P11-10; B P11-01 §3.1; ruling §1h.113 (d)): where the reader's right-hand column is, for everything that stands
// in it — the selection's actions, the explain card, the sticky notes, the notes window, the figure card.
//
// The margin is an empty `<aside data-reader-margin>` in the reader shell's grid (`reader-shell.tsx`), blank until a selection is made.
// Nothing is drawn INTO it: every card is a `position: fixed` element mounted at the page's top level, outside the Fit zoom's
// container, placed in the window's own pixels — a `zoom` ancestor would scale them — and it needs only a rectangle to stand in. This
// file is that rectangle:
//
//   horizontal extent  the cell's own, `getBoundingClientRect()` (window px, Fit's zoom already applied), re-read on the cell's
//                      resize (a ResizeObserver — which also catches every divider drag, so a card follows its margin while it is
//                      dragged) and on the window's;
//   vertical band      the masthead's foot (`DOCK_TOP_PX`) down to the foot legend's top (`columnBottomPx` of the window's height and
//                      `legendHeightPx` of the page's zoom) — the same numbers `placePanel` and `useColumn` use. The band is made of
//                      the viewport, not of the cell: a sticky cell would be pushed up at the page's foot (P10-21), a band cannot move.
//
// `useMarginRect()` is null while no shell has registered a margin — below 1024 css px, or on a page without the shell — and a consumer
// then falls back to today's card and sheet. The margin is never collapsible (ruling §1h.113: D7), so the rect has no collapsed state.
//
// Every card in the margin carries `data-margin-card` (`MARGIN_CARD_SELECTOR`), so the selection's actions can find the cards that are
// open and stand clear of them.

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { DOCK_TOP_PX, PAGE_ZOOM_ROOT, PAGE_ZOOM_VAR, columnBottomPx, legendHeightPx } from "@/components/reader/explain-dock";

/** The shell's margin cell (`<aside data-reader-margin aria-label="Margin">`). */
export const MARGIN_SELECTOR = "[data-reader-margin]";

/** Every card that stands in the margin carries this attribute. The selection's actions read the open cards' rects through it. */
export const MARGIN_CARD_SELECTOR = "[data-margin-card]";

/** The margin, in the window's pixels: `left` and `width` are the cell's, `top` and `bottom` the band cards may stand in. */
export interface MarginRect {
  left: number;
  width: number;
  top: number;
  bottom: number;
}

const clampTo = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Where a card of `height` stands level with `anchorTop` (a window y): the anchor, but never above the band's top nor with its foot
 * below the band's bottom — `clamp(anchorTop, rect.top, rect.bottom − height)`. A card taller than the band stands at the top of it.
 */
export function placeInMargin(rect: MarginRect, anchorTop: number, height: number): number {
  return clampTo(anchorTop, rect.top, rect.bottom - height);
}

/** The page's Fit zoom, from `--page-zoom` as the page container mirrors it (`usePageZoom`); 1 with Fit off, without a container or a DOM.
 *  `from` is an element inside the container, or the document's. */
export function readPageZoom(from?: Element | null): number {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof window.getComputedStyle !== "function") return 1;
  const root = from ?? document.querySelector(PAGE_ZOOM_ROOT);
  if (!root) return 1;
  const zoom = Number.parseFloat(window.getComputedStyle(root).getPropertyValue(PAGE_ZOOM_VAR));
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** The margin's rect from its cell's box, the window's height and the page's zoom. Pure. */
export function marginRectOf(box: { left: number; width: number }, viewportHeight: number, zoom: number): MarginRect {
  return {
    left: box.left,
    width: box.width,
    top: DOCK_TOP_PX,
    bottom: columnBottomPx(viewportHeight, legendHeightPx(zoom)),
  };
}

const sameRect = (a: MarginRect | null, b: MarginRect | null) =>
  a === b || (a !== null && b !== null && a.left === b.left && a.width === b.width && a.top === b.top && a.bottom === b.bottom);

interface MarginState {
  rect: MarginRect | null;
}

/** The measured margin, as a small store (like `useWindows`): the hook below for components, `getState()` for code that reads once. */
export const useMarginStore = create<MarginState>()(() => ({ rect: null }));

/** What `registerMargin` needs from the page — a seam for tests; the default is the real DOM. */
export interface MarginEnv {
  /** The window's height now, in css px. */
  viewportHeight: () => number;
  /** The page's Fit zoom now (1 with Fit off). */
  zoom: () => number;
  /** Call `cb` when any of `els` changes size; returns what stops it. */
  observe: (els: readonly Element[], cb: () => void) => () => void;
  /** Call `cb` when the window is resized; returns what stops it. */
  onResize: (cb: () => void) => () => void;
}

const domEnv: MarginEnv = {
  viewportHeight: () => window.innerHeight,
  zoom: () => readPageZoom(),
  observe: (els, cb) => {
    if (typeof ResizeObserver === "undefined") return () => {};
    const observer = new ResizeObserver(cb);
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  },
  onResize: (cb) => {
    window.addEventListener("resize", cb);
    return () => window.removeEventListener("resize", cb);
  },
};

let owner: Element | null = null;

/**
 * The shell calls this with its margin cell when it mounts. From then on `useMarginRect()` is the cell's horizontal extent and the
 * viewport's band, re-read when the cell is resized and when the window is (a divider drag resizes the cell). Returns what stops it,
 * and the rect goes back to null — unless another margin has registered since.
 */
export function registerMargin(el: HTMLElement, env: MarginEnv = domEnv): () => void {
  owner = el;
  const read = () => {
    if (owner !== el) return;
    const next = marginRectOf(el.getBoundingClientRect(), env.viewportHeight(), env.zoom());
    if (!sameRect(useMarginStore.getState().rect, next)) useMarginStore.setState({ rect: next });
  };
  read();
  // The cell itself (a divider drag resizes it); the grid it stands in, whose width is the window's less a scrollbar — a page that grows
  // taller than the window gains one and moves the cell 15 px left without resizing it; and the zoom root, which changes size when
  // Fit's zoom does, and the legend's height — the band's foot — follows the zoom.
  const around = [el, el.parentElement, el.ownerDocument?.querySelector(PAGE_ZOOM_ROOT)].filter((node): node is Element => node != null);
  const stopObserving = env.observe([...new Set(around)], read);
  const stopResize = env.onResize(read);
  return () => {
    stopObserving();
    stopResize();
    if (owner === el) {
      owner = null;
      useMarginStore.setState({ rect: null });
    }
  };
}

/**
 * The margin in the window's pixels, or null where there is none (below 1024 css px, a page without the shell). A component that
 * stands in the margin when this is a rect, and falls back to today's card or sheet when it is null.
 */
export function useMarginRect(): MarginRect | null {
  return useSyncExternalStore(
    useMarginStore.subscribe,
    () => useMarginStore.getState().rect,
    () => null,
  );
}
