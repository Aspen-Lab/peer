// P10-09a (review 7.1a; ruling §1h.78): the floating windows at the right of the reading page, as one small store.
// A sticky note opens one; the page's other windows (the notes window of P10-09b, the explain window) join the
// stack in the next round, so their kinds are in the type already. Nothing here is persisted: a reload closes
// every window, and what a window wrote is already in the paper's note.
//
// `order` is the stacking: the window raised last has the highest, and stands in front.

import { create } from "zustand";
import { DOCK_TOP_PX } from "@/components/reader/explain-dock";

export type WindowKind = "sticky" | "notes" | "explain";

export interface FloatingWindow {
  /** A sticky's is its header block's id in the paper's note. */
  id: string;
  kind: WindowKind;
  title: string;
  order: number;
}

interface WindowsState {
  windows: FloatingWindow[];
  /** The last `order` handed out. */
  clock: number;
  /** Open a window, or raise it (and retitle it) when it is open already. */
  open: (window: Pick<FloatingWindow, "id" | "kind" | "title">) => void;
  close: (id: string) => void;
  raise: (id: string) => void;
}

export const useWindows = create<WindowsState>()((set) => ({
  windows: [],
  clock: 0,
  open: (next) =>
    set((s) => {
      const order = s.clock + 1;
      const exists = s.windows.some((w) => w.id === next.id);
      const windows = exists
        ? s.windows.map((w) => (w.id === next.id ? { ...w, title: next.title, order } : w))
        : [...s.windows, { ...next, order }];
      return { windows, clock: order };
    }),
  close: (id) => set((s) => (s.windows.some((w) => w.id === id) ? { windows: s.windows.filter((w) => w.id !== id) } : s)),
  raise: (id) =>
    set((s) => {
      if (!s.windows.some((w) => w.id === id)) return s;
      const order = s.clock + 1;
      return { windows: s.windows.map((w) => (w.id === id ? { ...w, order } : w)), clock: order };
    }),
}));

// ── The stack ─────────────────────────────────────────────────────────────
//
// Cascaded cards: from the top of the column down, each later window is offset by a header's height, so the
// windows behind show only their headers and the one raised last — the front — stands at the bottom of the
// cascade, whole. A press on a header raises that window: it takes the front's place and the others close up.

/** A window's header: all that shows of one that is behind another. */
export const WINDOW_HEADER_PX = 40;

/** The gap between the explain window's bottom and the first card. */
const COLUMN_GAP_PX = 8;

/**
 * Where the column of windows starts: the dock's top when no explain window stands, just under its bottom when
 * one does, and — if one stands but its box cannot be read — the dock's top plus 400 px, past where it can reach.
 * `dock` is the explain window's box, or null.
 */
export function columnTop(dock: { bottom: number } | null): number {
  if (!dock) return DOCK_TOP_PX;
  return Number.isFinite(dock.bottom) && dock.bottom > 0 ? Math.ceil(dock.bottom) + COLUMN_GAP_PX : DOCK_TOP_PX + 400;
}

export interface StackRow {
  id: string;
  top: number;
  height: number;
  /** In front, and whole. */
  front: boolean;
  /** Stacking, from `STACK_Z_BASE`: behind to front. */
  z: number;
}

/** Under the explain window (`z-[70]`) and over the masthead (`z-50`). */
export const STACK_Z_BASE = 60;

/** What the front window keeps at least, when the column is lifted to make room for it. */
export const MIN_FRONT_PX = 160;

/**
 * Lay the windows out as cascaded cards between `top` and `bottom` (viewport pixels): by `order`, oldest at
 * the top, each later one a header lower; the last is the front, `frontHeight` tall (less where the screen is
 * short, never under a header). Where the explain window stands so low that the front would keep less than
 * `MIN_FRONT_PX` under it, and `minTop` and `ceiling` (the explain window's top) are given, the column moves
 * ABOVE the explain window if it fits there, else is lifted until the front fits — never above `minTop` — so
 * the front window stays usable. Pure.
 */
export function stackLayout(
  windows: readonly FloatingWindow[],
  frame: { top: number; bottom: number; frontHeight: number; minTop?: number; ceiling?: number },
): StackRow[] {
  const ordered = [...windows].sort((a, b) => a.order - b.order);
  const behind = Math.max(0, ordered.length - 1) * WINDOW_HEADER_PX;
  const want = Math.min(frame.frontHeight, MIN_FRONT_PX);
  let top0 = frame.top;
  let bottom = frame.bottom;
  if (frame.minTop !== undefined && top0 + behind + want > bottom) {
    if (frame.ceiling !== undefined && frame.minTop + behind + want <= frame.ceiling - COLUMN_GAP_PX) {
      top0 = frame.minTop;
      bottom = frame.ceiling - COLUMN_GAP_PX;
    } else {
      top0 = Math.max(frame.minTop, bottom - behind - want);
    }
  }
  return ordered.map((w, i) => {
    const top = top0 + i * WINDOW_HEADER_PX;
    const front = i === ordered.length - 1;
    const height = front ? Math.max(WINDOW_HEADER_PX, Math.min(frame.frontHeight, bottom - top)) : WINDOW_HEADER_PX;
    return { id: w.id, top, height, front, z: STACK_Z_BASE + i };
  });
}
