// P10-09a (review 7.1a; ruling §1h.78): the cards at the right of the reading page, as one small store.
// A sticky note opens one; P10-09c adds the notes window (P10-09b's) to the same stack — one cascade, one column; P11-14
// (B P11-03 §3.2; ruling §1h.113) makes the stack the margin's: the kinds are `sticky | notes | explain | figure | highlight`, each
// with its own front height, the cascade starts where the first card opened — level with its selection (R-open, O-6) — and a
// header press raises a card, the X closes it, opening raises. Nothing here is persisted: a reload closes every window, and what
// a window wrote is already in the paper's note.
//
// `order` is the stacking: the window raised last has the highest, and stands in front.
//
// P11-14 (B P11-01 §3.1, §4 C4): nothing is reserved on the page any more. The margin is a track of the reader's shell, so a card
// opening or closing never moves the paper's words, and there is no reserve to bind, no place to hold and no scroll to make.

import { useEffect, useState } from "react";
import { create } from "zustand";
import { DOCK_STACK_FLOOR_PX, DOCK_TOP_PX, columnBottomPx, legendHeightPx } from "@/components/reader/explain-dock";
import { readPageZoom, useMarginRect, type MarginRect } from "@/lib/reader/margin";
import type { Block } from "@/lib/notes/types";

export type WindowKind = "sticky" | "notes" | "explain" | "figure" | "highlight";

/** The notes window's id in the stack (there is one). */
export const NOTES_WINDOW_ID = "notes-window";

/** The explain card's id in the stack (there is one). */
export const EXPLAIN_WINDOW_ID = "explain-window";

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
  /**
   * R-open (B P11-03 §3.3; O-6): the y, in window pixels, where the oldest card of the cascade stands — the first card opened level
   * with the selection that opened it, and later cards cascade from there. Null while no card stands, and for a first card that
   * had no selection to be level with (it then starts at the margin's top).
   */
  origin: number | null;
  /** Open a window, or raise it (and retitle it) when it is open already. The first card of an empty stack starts the cascade at
   *  `anchorTop`; a later card joins where the oldest stands. */
  open: (window: Pick<FloatingWindow, "id" | "kind" | "title"> & { anchorTop?: number }) => void;
  close: (id: string) => void;
  raise: (id: string) => void;
  /** An explain card that stands alone keeps level with its selection as the page scrolls; once a second card joins, the origin is
   *  frozen — a stack that moved with the text could not be a stack of headers. Anything else is ignored. */
  follow: (y: number) => void;
}

export const useWindows = create<WindowsState>()((set) => ({
  windows: [],
  clock: 0,
  origin: null,
  open: ({ anchorTop, ...next }) =>
    set((s) => {
      const order = s.clock + 1;
      const exists = s.windows.some((w) => w.id === next.id);
      const windows = exists
        ? s.windows.map((w) => (w.id === next.id ? { ...w, title: next.title, order } : w))
        : [...s.windows, { ...next, order }];
      const origin = s.windows.length > 0 ? s.origin : anchorTop !== undefined && Number.isFinite(anchorTop) ? anchorTop : null;
      return { windows, clock: order, origin };
    }),
  close: (id) =>
    set((s) => {
      if (!s.windows.some((w) => w.id === id)) return s;
      const windows = s.windows.filter((w) => w.id !== id);
      return windows.length === 0 ? { windows, origin: null } : { windows };
    }),
  raise: (id) =>
    set((s) => {
      if (!s.windows.some((w) => w.id === id)) return s;
      const order = s.clock + 1;
      return { windows: s.windows.map((w) => (w.id === id ? { ...w, order } : w)), clock: order };
    }),
  follow: (y) =>
    set((s) => (s.windows.length === 1 && s.windows[0].kind === "explain" && Number.isFinite(y) && s.origin !== y ? { origin: y } : s)),
}));

// ── The stack ─────────────────────────────────────────────────────────────
//
// Cascaded cards: from the top of the column down, each later window is offset by a header's height, so the
// windows behind show only their headers and the one raised last — the front — stands at the bottom of the
// cascade, whole. A press on a header raises that window: it takes the front's place and the others close up.

/** A window's header: all that shows of one that is behind another. */
export const WINDOW_HEADER_PX = 40;

export interface StackRow {
  id: string;
  top: number;
  height: number;
  /** In front, and whole. */
  front: boolean;
  /** Stacking, from `STACK_Z_BASE`: behind to front. */
  z: number;
}

/** Over the masthead (`z-50`) and under the selection's actions (`z-[70]`): the cards of the stack stand from here, one z each. */
export const STACK_Z_BASE = 60;

/** What the front window keeps at least, when the column is lifted to make room for it. */
export const MIN_FRONT_PX = 160;

/** The same for the notes window, which is written in at length: lifted, not squeezed, below this. */
export const NOTES_MIN_FRONT_PX = 240;

/** A highlight's card: a swatch row and a remove button, quick (P11-04 §5); its front height, whole. */
export const HIGHLIGHT_FRONT_PX = 140;

/** The sticky's front height when nothing else is asked. */
export const STICKY_FRONT_PX = 260;

/** The front height of the kinds that have one of their own; the others (the notes window, a figure, the explain card until its
 *  content is known) take all the room the band leaves. */
const FRONT_PX: Readonly<Partial<Record<WindowKind, number>>> = { sticky: STICKY_FRONT_PX, highlight: HIGHLIGHT_FRONT_PX };

/** What each kind keeps at least in front when the column is lifted to make room for it: a sticky 160, the notes window and a figure
 *  240 (written in, looked into), the explain card its floor (header, follow-up field and Send, with a few lines of answer). */
export const LEAST_FRONT_PX: Readonly<Record<WindowKind, number>> = {
  sticky: MIN_FRONT_PX,
  highlight: HIGHLIGHT_FRONT_PX,
  notes: NOTES_MIN_FRONT_PX,
  figure: NOTES_MIN_FRONT_PX,
  explain: DOCK_STACK_FLOOR_PX,
};

export interface StackFrame {
  top: number;
  bottom: number;
  /** A sticky's height while it is in front (the stickies' name for it; `frontHeights.sticky` wins). */
  frontHeight?: number;
  /** The front's height by kind, where a kind has one to give: the explain card its content (`ExplainBox` measures it). A kind that
   *  is absent has its default — a sticky 260, a highlight 140, the others the whole room. */
  frontHeights?: Partial<Record<WindowKind, number>>;
  /** The top of the band: where the column is lifted to, never above, when the front would otherwise be squeezed. */
  minTop?: number;
}

function frontHeightOf(kind: WindowKind, frame: StackFrame): number {
  const given = frame.frontHeights?.[kind];
  if (given !== undefined) return given;
  if (kind === "sticky" && frame.frontHeight !== undefined) return frame.frontHeight;
  return FRONT_PX[kind] ?? Number.POSITIVE_INFINITY;
}

/**
 * Lay the windows out as cascaded cards between `top` and `bottom` (viewport pixels): by `order`, oldest at
 * the top, each later one a header lower; the last is the front, its kind's height tall (less where the screen is
 * short, never under a header). Where the front would keep less than its kind's least height (`LEAST_FRONT_PX`) under
 * it and `minTop` is given, the column is lifted until the front fits — never above `minTop` — so the front window stays usable.
 * P11-14: the explain card is one of these windows, so nothing stands over the stack and the column never steps round it. Pure.
 */
export function stackLayout(windows: readonly FloatingWindow[], frame: StackFrame): StackRow[] {
  const ordered = [...windows].sort((a, b) => a.order - b.order);
  const behind = Math.max(0, ordered.length - 1) * WINDOW_HEADER_PX;
  const frontKind = ordered[ordered.length - 1]?.kind;
  // The front keeps its kind's height: a pad to write on or a figure to look into takes all the height the screen leaves (it scrolls
  // inside), a sticky its own, the explain card its content; and is lifted, not squeezed, below its least height.
  const frontHeight = frontKind ? frontHeightOf(frontKind, frame) : 0;
  const want = frontKind ? Math.min(frontHeight, LEAST_FRONT_PX[frontKind]) : 0;
  const bottom = frame.bottom;
  let top0 = frame.top;
  if (frame.minTop !== undefined && top0 + behind + want > bottom) top0 = Math.max(frame.minTop, bottom - behind - want);
  return ordered.map((w, i) => {
    const top = top0 + i * WINDOW_HEADER_PX;
    const front = i === ordered.length - 1;
    const height = front ? Math.max(WINDOW_HEADER_PX, Math.min(frontHeight, bottom - top)) : WINDOW_HEADER_PX;
    return { id: w.id, top, height, front, z: STACK_Z_BASE + i };
  });
}

/**
 * The band the cascade stands in, from the margin's band and the origin (R-open): it starts at the origin — level with the selection
 * that opened the first card — held inside the band, never above the masthead's foot (`minTop` is that, for the lift) nor below the
 * legend's strip; with no origin, at the band's top. Pure.
 */
export function stackFrameIn(band: Pick<MarginRect, "top" | "bottom">, origin: number | null): { top: number; bottom: number; minTop: number } {
  const top = origin === null ? band.top : Math.min(Math.max(origin, band.top), band.bottom);
  return { top, bottom: band.bottom, minTop: band.top };
}

/**
 * The windows that stand in the column, laid out: the notes window, the explain card, the figure and highlight cards, and every
 * sticky whose "Note N" heading is in the paper's note (a window whose heading is gone is not drawn, so it takes no slot — and
 * `StickyNotes` takes it out of the store, so every view of the stack counts the same windows). The stickies' view, the notes
 * window's view and the explain box's all lay out through this, so they agree on every position.
 */
export function stackRows(windows: readonly FloatingWindow[], blocks: readonly Block[], frame: StackFrame): StackRow[] {
  const stacked = windows.filter((w) => w.kind !== "sticky" || blocks.some((b) => b.id === w.id && b.type === "h3" && b.anchor));
  return stackLayout(stacked, frame);
}

/**
 * The column's frame for the views of the stack: the band the cascade stands in — the margin's (`useMarginRect()`) where a shell has
 * registered one, else the masthead's foot down to the legend's strip, as it is below 1024 css px — with the cascade starting at the
 * origin (level with the selection that opened the first card, R-open; `useWindows`'s `origin`) held in that band. Nothing is read from
 * the page's DOM and nothing is polled: the cards no longer step round the explain card, which is one of them.
 * `active` — nothing is read while no window stands.
 */
export function useColumn(active: boolean): { top: number; bottom: number; minTop: number } {
  const rect = useMarginRect();
  const origin = useWindows((s) => s.origin);
  const [below, setBelow] = useState(bandBottom);
  useEffect(() => {
    if (!active || rect) return;
    const read = () => setBelow(bandBottom());
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [active, rect]);
  return stackFrameIn({ top: rect?.top ?? DOCK_TOP_PX, bottom: rect?.bottom ?? below }, origin);
}

/** The foot of the band where there is no margin: the screen's height less the legend's strip, at the page's zoom. */
function bandBottom(): number {
  return typeof window === "undefined" ? 1000 : columnBottomPx(window.innerHeight, legendHeightPx(readPageZoom()));
}
