"use client";

// P11-15 rule 2 (owner item 1; B P11-05 §2.3, §2.4, §4; ruling §1h.113 (c) D2, D4, D5): the host of the figure the reader has opened.
//
// It listens to the figure store (`lib/reader/figure-viewer.ts`: a press on a Paper-digestion figure calls `openFigure`) and puts the
// figure where the page has room for it:
//   - in the margin, as a card of the stack — `useWindows.open({ id: "figure", kind: "figure", title })` on every press, so a second figure
//     replaces the first (one card, D2) and the same figure pressed again comes forward (D4);
//   - where there is no margin (below 1024 css px, a page without the shell: `useMarginRect()` is null) in today's lightbox overlay, the very
//     viewer the Summary uses (D5), with nothing reserved and nothing persistent. A window narrowed below the margin's width does not turn an
//     open card into an overlay: nothing is drawn.
// Nothing is reserved on the page and no place is held: the margin is a track of the shell and the paper's words never move.
//
// P11-41 (round 2, Theme B (c); round 1's r3; ruling §1h.138 (d)): that card is PARKED, not closed. When the window narrows below the margin's
// width the figure is taken out of the store's open slot into its parked one (`parkFigure`: the body's button is no longer pressed, Escape has
// nothing to close), its window leaves the stack (the other cards would count a header for a card nobody sees), and the card itself is KEPT: it
// stays mounted in a hidden `Activity` (`FigureStack`), because the zoom and the pan are the card's own state (`use-figure-zoom.ts`) and an
// unmounted card would lose them. When the window is wide again the window goes back into the stack where it stood — the cards that were in front
// of it are in front again (`stackAfterReturn`) — and the very same figure is open again (`resumeFigure`), at the zoom and pan it was left at.
// A figure pressed while the window is narrow is the lightbox as before, and it replaces the parked one (D2); a close, and the host unmounting
// (the paper changing), forget it: a figure closed while the window was narrow stays closed. Held in memory only: nothing is stored.
//
// Escape closes the front figure card wherever the focus is. The page's own Escape is "back to the briefing" (the keyboard layer, on
// `window`), so a reader who has just pressed a figure — the focus is in the text — would leave the paper. The listener is on the document, in
// the bubble phase, as the explain card's: after every capture listener and every React handler, before the keyboard layer; and it leaves a key
// that was handled (`defaultPrevented`) and a modal dialog over the page (`MODAL_OVER_PAGE`: the lightbox, the shortcuts sheet). It is also
// gated on being the front card — one Escape closes one card — and it stands from the moment the host mounts, so it is the first of the
// document's Escape listeners when the explain card is open as well: the explain card's, which opened later, then finds the key handled.
// P11-17c rule 1: that order no longer carries the rule. The explain card, a sticky and the notes window take the key only while they are the
// front card too (`front-escape.ts`), so whichever listener runs first, exactly one card closes: the one in front.
//
// The store's key (`label:ordinal`) repeats across papers ("Figure 1:1"): the page mounts the host with `key={paper.id}` and the host closes
// the figure when it unmounts, so a card never follows the reader to the next paper.

import { Activity, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { closeFigure, getOpenFigure, getParkedFigure, parkFigure, resumeFigure, useOpenFigure, useParkedFigure, type FigureRef } from "@/lib/reader/figure-viewer";
import { useMarginRect, type MarginRect } from "@/lib/reader/margin";
import { STACK_Z_BASE, WINDOW_HEADER_PX, stackLayout, useColumn, useWindows, type FloatingWindow, type StackFrame, type StackRow } from "@/lib/reader/windows";
import { DOCK_MIN_VIEWPORT_PX, MODAL_OVER_PAGE } from "./explain-dock";
import { FigureCard, FIGURE_WINDOW_ID } from "./figure-card";
import { isFrontCard } from "./front-escape";
import { FigureViewer } from "./figure-lightbox";
import type { Size } from "./figure-zoom";

/** The card's row in the stack, from the windows that stand and the column's frame; undefined while it is not in the stack. Pure. */
export function figureRowOf(windows: readonly FloatingWindow[], frame: StackFrame): StackRow | undefined {
  return stackLayout(windows, frame).find((row) => row.id === FIGURE_WINDOW_ID);
}

/** Whether the figure card is the card in front — the window raised last. Pure. */
export function figureIsFront(windows: readonly FloatingWindow[]): boolean {
  return isFrontCard(windows, FIGURE_WINDOW_ID);
}

/** The X and Escape: the figure leaves the store and its window leaves the stack. A module-level function: the overlay's effects depend on its identity. */
export function dismissFigure(): void {
  closeFigure();
  useWindows.getState().close(FIGURE_WINDOW_ID);
}

/** A press on the card's header: it comes forward. */
export function raiseFigure(): void {
  useWindows.getState().raise(FIGURE_WINDOW_ID);
}

/** Escape, when this is the front figure card's to take: the key is consumed and the card closes. Returns whether it took the key. */
export function takeEscape(event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "preventDefault" | "stopPropagation">, doc: Pick<Document, "querySelector">): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  if (getOpenFigure() === null || !figureIsFront(useWindows.getState().windows)) return false;
  if (typeof doc.querySelector === "function" && doc.querySelector(MODAL_OVER_PAGE)) return false;
  event.preventDefault();
  event.stopPropagation();
  dismissFigure();
  return true;
}

// ── Where the card stood in the stack (P11-41) ───────────────────────────────────────────────────────

/** What the host remembers of the stack, to put a parked card back where it stood. */
export interface FigurePlace {
  /** The stack as it stood while the window was wide — the figure's window among the others. */
  stack: readonly FloatingWindow[];
  /** The ids of the windows that left the stack while the window was narrow: the Explain card, which stands in the stack from 1024 px only and
   *  joins it again, in front, when the width is back. One of these that is in the stack again has rejoined; it has not been touched. */
  left: ReadonlySet<string>;
  /** The cascade's origin while the window was wide — the y where the oldest card stood, level with the selection that opened it — or null. The stack
   *  forgets it when it is empty, which it is below 1024 when nothing but the Explain card and the figure stood in it. */
  origin: number | null;
}

/** The place of the figure's window in `stack` (the stack as it stood while the window was wide), or null when it was not in it. Pure. */
export function figurePlaceOf(stack: readonly FloatingWindow[], left: ReadonlySet<string>, origin: number | null = null): FigurePlace | null {
  return stack.some((w) => w.id === FIGURE_WINDOW_ID) ? { stack, left, origin } : null;
}

/** The ids of the windows that left the stack while the window was narrow, were in the old stack, and are not in `now`: the ones to wait for. Pure. */
export function windowsToRejoin(now: readonly FloatingWindow[], place: FigurePlace): string[] {
  return place.stack.filter((w) => w.id !== FIGURE_WINDOW_ID && place.left.has(w.id) && !now.some((one) => one.id === w.id)).map((w) => w.id);
}

/** The order to raise the windows in, back to front (`order`), and which of them nobody touched (`kept`). */
export interface ReturnPlan {
  order: string[];
  kept: string[];
}

/**
 * The windows of the stack as it is now (the figure's own opened again, in front), in the order to raise them, back to front, so that the figure
 * is where it stood: the windows that nobody touched while the window was narrow — they stand with the order they had (`settled`: the old stack's
 * orders, or the ones the last call left), or they left the stack and are back (the Explain card) — in the order the old stack had them, the
 * figure among them; then the windows the reader opened or raised meanwhile, in the order they were, in front. Pure.
 */
export function stackAfterReturn(now: readonly FloatingWindow[], place: FigurePlace, settled?: ReadonlyMap<string, number>): ReturnPlan {
  const was = new Map(place.stack.map((w) => [w.id, w.order]));
  const since = settled ?? was;
  const kept: FloatingWindow[] = [];
  const newer: FloatingWindow[] = [];
  for (const w of now) {
    // The figure's own window was opened again, so its order is new: it is untouched at the first call, and a later one asks whether it was raised since.
    const untouched =
      w.id === FIGURE_WINDOW_ID
        ? was.has(w.id) && (settled === undefined || settled.get(w.id) === w.order)
        : since.get(w.id) === w.order || (place.left.has(w.id) && was.has(w.id));
    (untouched ? kept : newer).push(w);
  }
  kept.sort((a, b) => (was.get(a.id) ?? 0) - (was.get(b.id) ?? 0));
  newer.sort((a, b) => a.order - b.order);
  return { order: [...kept, ...newer].map((w) => w.id), kept: kept.map((w) => w.id) };
}

/** Raise the windows of the stack in `stackAfterReturn`'s order; returns the orders the untouched ones have now (what `settled` is next time). */
function applyReturn(place: FigurePlace, settled?: ReadonlyMap<string, number>): Map<string, number> {
  const plan = stackAfterReturn(useWindows.getState().windows, place, settled);
  for (const id of plan.order) useWindows.getState().raise(id);
  const kept = new Set(plan.kept);
  return new Map(useWindows.getState().windows.filter((w) => kept.has(w.id)).map((w) => [w.id, w.order]));
}

/** Whether the window is wide enough for the margin (and the Explain card's dock): 1024 css px. A page that is not in a browser (a test's) is wide. */
function wideWindow(): boolean {
  return typeof window === "undefined" || window.innerWidth >= DOCK_MIN_VIEWPORT_PX;
}

/** How long, after a card has come back, the host waits for the windows that left with it to join the stack again (it is a bound, not a delay). */
export const REJOIN_WAIT_MS = 1000;

/** The host's memory of the stack (P11-41): see `createStackMemory`. */
export interface StackMemory {
  /** Start watching the store; returns what stops it. */
  watch: () => () => void;
  /** The card is being parked: keep the place its window stands in. */
  park: () => void;
  /** The card is coming back: its window goes back into the stack in its old place; a window that left with it and is not back yet is put in its place when it joins. */
  restore: (title: string) => void;
}

/**
 * What the host remembers of the stack so that a parked card can come back where it stood. It is kept by a subscription to the windows store,
 * not read when the margin goes: the Explain card follows the window's width a frame later than the margin does (it reads the width on the next
 * animation frame), so it has left the stack — or not yet — when the margin is gone, and rejoins it — in front — only after the margin is back.
 *   - `wide`: the stack as it was the last time it changed while the window was 1024 px or more; the figure's window is in it.
 *   - `left`: the windows that left the stack while the window was narrower.
 *   - `waiting`: after a card has come back, the windows of `left` that are not back yet: when one joins, the stack is put right again, for a
 *     moment at most (`REJOIN_WAIT_MS`).
 * Memory only; nothing is stored.
 */
export function createStackMemory(): StackMemory {
  let wide: readonly FloatingWindow[] = [];
  let wideOrigin: number | null = null;
  const left = new Set<string>();
  let place: FigurePlace | null = null;
  let waiting: { place: FigurePlace; settled: ReadonlyMap<string, number>; pending: Set<string> } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopWaiting = () => {
    waiting = null;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return {
    watch() {
      wide = useWindows.getState().windows;
      wideOrigin = useWindows.getState().origin;
      const stop = useWindows.subscribe((now, before) => {
        if (!wideWindow()) {
          for (const w of before.windows) if (!now.windows.some((one) => one.id === w.id)) left.add(w.id);
          return;
        }
        wide = now.windows;
        wideOrigin = now.origin;
        const wait = waiting;
        if (wait) {
          const back = [...wait.pending].filter((id) => now.windows.some((one) => one.id === id));
          if (back.length > 0) {
            for (const id of back) wait.pending.delete(id);
            if (wait.pending.size === 0) stopWaiting();
            wait.settled = applyReturn(wait.place, wait.settled);
          }
        }
        if (waiting === null && getParkedFigure() === null) left.clear();
      });
      return () => {
        stop();
        stopWaiting();
      };
    },
    park() {
      place = figurePlaceOf(wide, left, wideOrigin);
    },
    restore(title) {
      const mine = place;
      place = null;
      // An empty stack starts its cascade where the card says (`anchorTop`): the origin it had, so that the cascade stands where it stood. A stack
      // that has cards keeps its own.
      useWindows.getState().open({ id: FIGURE_WINDOW_ID, kind: "figure", title, ...(mine !== null && mine.origin !== null ? { anchorTop: mine.origin } : {}) });
      if (mine === null) return;
      const settled = applyReturn(mine);
      const pending = new Set(windowsToRejoin(useWindows.getState().windows, mine));
      if (pending.size === 0) return;
      stopWaiting();
      waiting = { place: mine, settled, pending };
      timer = setTimeout(stopWaiting, REJOIN_WAIT_MS);
    },
  };
}

interface Shown {
  figure: FigureRef;
  /** Decided by the margin at the press: a card in the margin, else the overlay. */
  card: boolean;
}

export function FigureHost() {
  const figure = useOpenFigure();
  const away = useParkedFigure();
  const rect = useMarginRect();
  // What is on show: the figure and where it was put — decided by the margin at the press, never changed by it afterwards. Derived while
  // rendering (React's pattern for state that follows a prop): the new ref of a press, the same figure again too, is a new `shown`.
  const [shown, setShown] = useState<Shown | null>(null);
  if ((shown?.figure ?? null) !== figure) setShown(figure === null ? null : { figure, card: rect !== null });
  const returnTo = useRef<HTMLElement | null>(null);
  // P11-41: what the host remembers of the stack, to put a parked card back where it stood (see `createStackMemory`), and the figure that has just come
  // back, whose window is in its old place already.
  const [memory] = useState(createStackMemory);
  const returned = useRef<FigureRef | null>(null);
  useEffect(() => memory.watch(), [memory]);

  // A press: a card opens its window, which raises it when it stands already (a second figure replaces the first, the same one again comes
  // forward); the overlay has no window. A close takes the window away, and the focus back to where the reader pressed — unless the reader
  // has put it somewhere else.
  useLayoutEffect(() => {
    const comingBack = shown !== null && returned.current === shown.figure;
    returned.current = null;
    if (shown === null) {
      useWindows.getState().close(FIGURE_WINDOW_ID);
      const back = returnTo.current;
      returnTo.current = null;
      if (back && back.isConnected && (document.activeElement === null || document.activeElement === document.body)) back.focus({ preventScroll: true });
      return;
    }
    if (!shown.card) {
      useWindows.getState().close(FIGURE_WINDOW_ID);
      return;
    }
    // A card that has come back from being parked: the layout effect below has put its window in its old place, and nothing is raised again.
    if (comingBack) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && typeof active.focus === "function" && !active.closest?.('[data-margin-card="figure"]')) returnTo.current = active;
    useWindows.getState().open({ id: FIGURE_WINDOW_ID, kind: "figure", title: shown.figure.label });
  }, [shown]);

  // The window narrows below the margin's width while the card stands: the card is PARKED, not closed (P11-41; see the top of the file). Nothing is
  // drawn below the margin's width, and the figure is not open there; the stack is remembered for the way back.
  useEffect(() => {
    if (shown === null || !shown.card || rect !== null) return;
    memory.park();
    parkFigure();
  }, [shown, rect, memory]);

  // The margin is there again and a figure is parked: its window goes back into the stack where it stood and the very same figure is open again.
  // The card never left (it is hidden, see `FigureStack`), so the zoom and the pan it had are the ones it shows.
  useLayoutEffect(() => {
    if (away === null || figure !== null || rect === null) return;
    memory.restore(away.label);
    returned.current = away;
    resumeFigure();
  }, [away, figure, rect, memory]);

  // Escape: the front figure card's, wherever the focus is (see the top of the file). Stands for as long as the host does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => void takeEscape(event, document);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // The paper changed (the page keys the host by it) or the page went: the store's key repeats across papers, so nothing may stay open.
  useEffect(
    () => () => {
      dismissFigure();
    },
    [],
  );

  if (shown !== null && shown.figure === figure) {
    if (!shown.card) return <FigureOverlay figure={shown.figure} />;
    // In the margin; or the margin has just gone and the effect above has not parked the card yet: hidden from this very render.
    return <FigureStack figure={shown.figure} frame={rect} parked={rect === null} />;
  }
  // Parked: nothing is open and nothing is drawn, and the card is kept.
  if (shown === null && away !== null) return <FigureStack figure={away} frame={rect} parked />;
  return null;
}

/** The card element for the open figure at its row. Keyed by the figure's own key: a press of the same figure again is the same card (its
 *  zoom and pan are kept), a different figure is a new one (zoom reset to fit). `stacked`: another card stands with it, so its caption takes a
 *  fifth of it, not three tenths (P11-26 rule 2). Pure. */
export function figureCardElement(figure: FigureRef, frame: MarginRect | null, row: StackRow, stacked = false): ReactElement {
  return (
    <FigureCard
      key={figure.key}
      figure={figure}
      frame={frame}
      front={row.front}
      top={row.top}
      height={row.height}
      z={row.z}
      stacked={stacked}
      onClose={dismissFigure}
      onRaise={raiseFigure}
    />
  );
}

/** The row a parked card is kept at: a header, behind — it is hidden, and a card behind draws its header only (its zoom and pan, which are the card's
 *  own state and not its body's, are kept all the same: a card sent behind and raised again has them). */
const PARKED_ROW: StackRow = { id: FIGURE_WINDOW_ID, top: 0, height: WINDOW_HEADER_PX, front: false, z: STACK_Z_BASE };

/**
 * The card, at the row the stack gives it. It stays mounted while another card is in front (its zoom and pan live in it) — and while it is
 * `parked` (P11-41: the window is narrower than the margin's width): then it is the same element in a hidden `Activity`, which React keeps
 * mounted with its state and draws nothing of, and its window is not in the stack. The `Activity` is there in both states, so the card is the same
 * element at the same place in the tree whether it is shown or kept — which is what keeps its zoom and pan across the step.
 */
export function FigureStack({ figure, frame, parked = false }: { figure: FigureRef; frame: MarginRect | null; parked?: boolean }) {
  const windows = useWindows((s) => s.windows);
  const column = useColumn(true);
  const found = figureRowOf(windows, column);
  const row = parked ? PARKED_ROW : found;
  // Not in the stack for the one frame before the host's layout effect has opened it: nothing to draw.
  if (!row) return null;
  return <Activity mode={parked ? "hidden" : "visible"}>{figureCardElement(figure, frame, row, windows.length > 1)}</Activity>;
}

/** Today's lightbox, for a page with no margin: the viewer the Summary opens, in a portal, closed by `closeFigure`. */
export function FigureOverlay({ figure }: { figure: FigureRef }) {
  const [probed, setProbed] = useState<{ src: string; size: Size } | null>(null);
  const known = figure.natural;
  // The size of a picture that neither had loaded when it was pressed nor had a record: read from the picture itself.
  useEffect(() => {
    if (known || typeof Image === "undefined") return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) setProbed({ src: figure.src, size: { width: img.naturalWidth, height: img.naturalHeight } });
      else closeFigure();
    };
    img.onerror = () => closeFigure();
    img.src = figure.src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [known, figure.src]);
  const natural = known ?? (probed && probed.src === figure.src ? probed.size : null);
  if (!natural || typeof document === "undefined") return null;
  return createPortal(<FigureViewer src={figure.src} alt={figure.caption} caption={figure.caption} natural={natural} onClose={closeFigure} />, document.body);
}
