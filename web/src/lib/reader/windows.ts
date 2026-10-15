// P10-09a (review 7.1a; ruling §1h.78): the floating windows at the right of the reading page, as one small store.
// A sticky note opens one; P10-09c adds the notes window (P10-09b's) to the same stack — one cascade, one column — and the
// explain window joins in a later item (BACKLOG-66), so its kind is in the type already. Nothing here is persisted: a
// reload closes every window, and what a window wrote is already in the paper's note.
//
// `order` is the stacking: the window raised last has the highest, and stands in front.
//
// P10-09d (X-B1; ruling §1h.87 (c)): while any window stands, the column is reserved on the page as the explain window reserves
// it (`reserveDock`, counted and shared): taken when the first window registers, given back when the last leaves, from 1024 px
// only (`bindWindowsReserve`, below) — the paper's words move out of the column and are never covered.

import { useEffect, useState } from "react";
import { create } from "zustand";
import { DOCK_MIN_VIEWPORT_PX, DOCK_TOP_PX, PAGE_ZOOM_ROOT, PAGE_ZOOM_VAR, columnBottomPx, legendHeightPx, reserveDock } from "@/components/reader/explain-dock";
import type { Block } from "@/lib/notes/types";

export type WindowKind = "sticky" | "notes" | "explain";

/** The notes window's id in the stack (there is one). */
export const NOTES_WINDOW_ID = "notes-window";

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

/** The same for the notes window, which is written in at length: lifted, not squeezed, below this. */
export const NOTES_MIN_FRONT_PX = 240;

export interface StackFrame {
  top: number;
  bottom: number;
  /** A sticky's height while it is in front. The notes window in front takes what the screen leaves instead. */
  frontHeight: number;
  minTop?: number;
  ceiling?: number;
}

/**
 * Lay the windows out as cascaded cards between `top` and `bottom` (viewport pixels): by `order`, oldest at
 * the top, each later one a header lower; the last is the front, `frontHeight` tall (less where the screen is
 * short, never under a header). Where the explain window stands so low that the front would keep less than
 * `MIN_FRONT_PX` (`NOTES_MIN_FRONT_PX` for the notes window) under it, and `minTop` and `ceiling` (the explain window's top) are given, the column moves
 * ABOVE the explain window if it fits there, else is lifted until the front fits — never above `minTop` — so
 * the front window stays usable. Pure.
 */
export function stackLayout(windows: readonly FloatingWindow[], frame: StackFrame): StackRow[] {
  const ordered = [...windows].sort((a, b) => a.order - b.order);
  const behind = Math.max(0, ordered.length - 1) * WINDOW_HEADER_PX;
  // The notes window in front is a pad to write on: all the height the screen leaves (it scrolls inside), and a taller floor.
  const notesFront = ordered[ordered.length - 1]?.kind === "notes";
  const frontHeight = notesFront ? Number.POSITIVE_INFINITY : frame.frontHeight;
  const want = Math.min(frontHeight, notesFront ? NOTES_MIN_FRONT_PX : MIN_FRONT_PX);
  let top0 = frame.top;
  let bottom = frame.bottom;
  if (frame.minTop !== undefined && top0 + behind + want > bottom) {
    if (frame.ceiling !== undefined && frame.minTop + behind + want <= frame.ceiling - COLUMN_GAP_PX) {
      top0 = frame.minTop;
      bottom = frame.ceiling - COLUMN_GAP_PX;
    } else if (frame.ceiling === undefined) {
      top0 = Math.max(frame.minTop, bottom - behind - want);
    }
    // P10-18: with the explain window standing (a `ceiling`) the column is never lifted under it — it stands over the stack, so a lifted
    // column hid its own headers. The explain window gives the room instead (`stackRoom`, `dockInStack`); where even that is not
    // enough the front gives way (down to its header), the headers below the explain window stay.
  }
  return ordered.map((w, i) => {
    const top = top0 + i * WINDOW_HEADER_PX;
    const front = i === ordered.length - 1;
    const height = front ? Math.max(WINDOW_HEADER_PX, Math.min(frontHeight, bottom - top)) : WINDOW_HEADER_PX;
    return { id: w.id, top, height, front, z: STACK_Z_BASE + i };
  });
}

/**
 * P10-18 (A P10-14 §4 X-B1, B9): what the explain window must leave the stack below it, in pixels: the gap, a header for every window
 * behind the front, and the front's least height (`NOTES_MIN_FRONT_PX` for the notes window, `MIN_FRONT_PX` for a sticky) — exactly what
 * `stackLayout` asks of the screen before it lifts or moves the column. 0 while no sticky or notes window stands. A sticky whose heading
 * has left the note is counted though it is not drawn: the explain window leaves a header too much, never one too little.
 */
export function stackRoom(windows: readonly FloatingWindow[]): number {
  const column = windows.filter((w) => w.kind === "sticky" || w.kind === "notes");
  if (column.length === 0) return 0;
  const front = column.reduce((a, b) => (b.order > a.order ? b : a));
  return COLUMN_GAP_PX + (column.length - 1) * WINDOW_HEADER_PX + (front.kind === "notes" ? NOTES_MIN_FRONT_PX : MIN_FRONT_PX);
}

/**
 * The windows that stand in the column, laid out: the notes window, and every sticky whose "Note N" heading is in the
 * paper's note (a window whose heading is gone is not drawn, so it takes no slot); the explain window is not here yet.
 * The stickies' view and the notes window's view both lay out through this, so they agree on every position.
 */
export function stackRows(windows: readonly FloatingWindow[], blocks: readonly Block[], frame: StackFrame): StackRow[] {
  const stacked = windows.filter(
    (w) => w.kind === "notes" || (w.kind === "sticky" && blocks.some((b) => b.id === w.id && b.type === "h3" && b.anchor)),
  );
  return stackLayout(stacked, frame);
}

/**
 * The column's frame, read from the page: where it starts (under the explain window when one stands, else the dock's
 * top), where the screen ends above the foot legend, and the explain window's top (`ceiling`). Re-read every 250 ms,
 * on scroll (the explain window stands level with its paragraph) and on resize. `active` — nothing is read while no
 * window stands.
 */
export function useColumn(active: boolean): { top: number; bottom: number; ceiling?: number } {
  const [frame, setFrame] = useState<{ top: number; bottom: number; ceiling?: number }>({ top: columnTop(null), bottom: 1000 });
  useEffect(() => {
    if (!active) return;
    const read = () => {
      const dock = document.querySelector("[data-explain-dock]");
      const box = dock ? dock.getBoundingClientRect() : null;
      const root = document.querySelector<HTMLElement>(PAGE_ZOOM_ROOT);
      const zoom = root ? Number.parseFloat(getComputedStyle(root).getPropertyValue(PAGE_ZOOM_VAR)) : Number.NaN;
      const next = {
        top: columnTop(box ? { bottom: box.bottom } : null),
        bottom: columnBottomPx(window.innerHeight, legendHeightPx(zoom)),
        ...(box && box.bottom > 0 ? { ceiling: Math.floor(box.top) } : {}),
      };
      setFrame((current) => (current.top === next.top && current.bottom === next.bottom && current.ceiling === next.ceiling ? current : next));
    };
    read();
    const timer = setInterval(read, 250);
    window.addEventListener("scroll", read, true);
    window.addEventListener("resize", read);
    return () => {
      clearInterval(timer);
      window.removeEventListener("scroll", read, true);
      window.removeEventListener("resize", read);
    };
  }, [active]);
  return frame;
}

// ── The reserved column ───────────────────────────────────────────────────
//
// A window at the right stood over the text (A P10-10's X-B1: about 150 px of every line beside a sticky at 1440 unreadable);
// the explain window kept the column clear (`--explain-dock`) and the text reflowed. One reserve now serves them all: this
// binds the stack to `reserveDock`'s counted reserve, so the page's width is kept clear while at least one window of any kind
// stands here OR the explain window stands (it takes its own, counted with the rest).
//
// Below `DOCK_MIN_VIEWPORT_PX` (1024 px, the explain window's own minimum) nothing is reserved: the notes window is a masthead
// tab from 1024 px only, and a sticky opened on a narrower screen floats over the text as it always did.

export interface ReserveEnv {
  /** The document's root: what `reserveDock` writes the properties on. */
  root: Parameters<typeof reserveDock>[0];
  /** The window's width now, in CSS pixels. */
  width: () => number;
  /** Call `cb` when the window is resized; returns what stops it. */
  onResize: (cb: () => void) => () => void;
}

/**
 * Keep `reserveDock`'s reserve taken while a window stands in `store` and the window is at least 1024 px wide: taken when
 * the first window registers, released when the last leaves or the window narrows past the minimum, and taken again when it
 * widens. Returns what unbinds it (and gives back any take it holds).
 */
export function bindWindowsReserve(env: ReserveEnv, store: Pick<typeof useWindows, "getState" | "subscribe"> = useWindows): () => void {
  let release: (() => void) | null = null;
  const sync = () => {
    const want = store.getState().windows.length > 0 && env.width() >= DOCK_MIN_VIEWPORT_PX;
    if (want && !release) release = reserveDock(env.root);
    else if (!want && release) {
      release();
      release = null;
    }
  };
  const stop = store.subscribe(sync);
  const stopResize = env.onResize(sync);
  sync();
  return () => {
    stop();
    stopResize();
    release?.();
    release = null;
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bindWindowsReserve({
    root: document.documentElement,
    width: () => window.innerWidth,
    onResize: (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
  });
}

/**
 * Where the reader's eyes are, as a top in viewport pixels: the selected words when a selection stands on the screen, else the
 * first paragraph of the paper that reaches below the masthead. Undefined where there is nothing to read (a server render, a page
 * without the paper's text).
 */
export function readingAnchorTop(): number | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return undefined;
  const selection = window.getSelection?.();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const box = selection.getRangeAt(0).getBoundingClientRect();
    if (box.height > 0 && box.bottom > 0 && box.top < window.innerHeight) return box.top;
  }
  for (const paragraph of document.querySelectorAll('[id^="paper-section-"][id*="-p"]')) {
    const box = paragraph.getBoundingClientRect();
    if (box.bottom > DOCK_TOP_PX + 8) return box.top;
  }
  return undefined;
}

/**
 * P7-15's measure-before / measure-after (`explain-box.tsx`, the dock's reflow), shared: read where the reader's words are, make
 * the change that moves them (a window joining or leaving reserves or frees the column, and the text reflows), read again before
 * the next paint and scroll the page by the difference — the words stay where the eyes are. A move under a pixel, or no words to
 * measure, scrolls nothing. `scroll` is the page's own scroll unless a test gives another.
 */
export function holdInPlace({
  measure = readingAnchorTop,
  change,
  scroll = (dy) => {
    if (typeof window !== "undefined") window.scrollBy({ top: dy, behavior: "instant" });
  },
}: {
  measure?: () => number | undefined;
  change: () => void;
  scroll?: (dy: number) => void;
}): void {
  const before = measure();
  change();
  const after = before === undefined ? undefined : measure();
  if (before !== undefined && after !== undefined && Math.abs(after - before) >= 1) scroll(after - before);
}
