"use client";

// P11-15 rule 2 (owner item 1; B P11-05 §2.3, §2.4, §4; ruling §1h.113 (c) D2, D4, D5): the host of the figure the reader has opened.
//
// It listens to the figure store (`lib/reader/figure-viewer.ts`: a press on a Paper-digestion figure calls `openFigure`) and puts the
// figure where the page has room for it:
//   - in the margin, as a card of the stack — `useWindows.open({ id: "figure", kind: "figure", title })` on every press, so a second figure
//     replaces the first (one card, D2) and the same figure pressed again comes forward (D4);
//   - where there is no margin (below 1024 css px, a page without the shell: `useMarginRect()` is null) in today's lightbox overlay, the very
//     viewer the Summary uses (D5), with nothing reserved and nothing persistent. A window narrowed below the margin's width closes an open
//     card; it does not jump into an overlay.
// Nothing is reserved on the page and no place is held: the margin is a track of the shell and the paper's words never move.
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

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { closeFigure, getOpenFigure, useOpenFigure, type FigureRef } from "@/lib/reader/figure-viewer";
import { useMarginRect, type MarginRect } from "@/lib/reader/margin";
import { stackLayout, useColumn, useWindows, type FloatingWindow, type StackFrame, type StackRow } from "@/lib/reader/windows";
import { MODAL_OVER_PAGE } from "./explain-dock";
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

interface Shown {
  figure: FigureRef;
  /** Decided by the margin at the press: a card in the margin, else the overlay. */
  card: boolean;
}

export function FigureHost() {
  const figure = useOpenFigure();
  const rect = useMarginRect();
  // What is on show: the figure and where it was put — decided by the margin at the press, never changed by it afterwards. Derived while
  // rendering (React's pattern for state that follows a prop): the new ref of a press, the same figure again too, is a new `shown`.
  const [shown, setShown] = useState<Shown | null>(null);
  if ((shown?.figure ?? null) !== figure) setShown(figure === null ? null : { figure, card: rect !== null });
  const returnTo = useRef<HTMLElement | null>(null);

  // A press: a card opens its window, which raises it when it stands already (a second figure replaces the first, the same one again comes
  // forward); the overlay has no window. A close takes the window away, and the focus back to where the reader pressed — unless the reader
  // has put it somewhere else.
  useLayoutEffect(() => {
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
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && typeof active.focus === "function" && !active.closest?.('[data-margin-card="figure"]')) returnTo.current = active;
    useWindows.getState().open({ id: FIGURE_WINDOW_ID, kind: "figure", title: shown.figure.label });
  }, [shown]);

  // The window narrows below the margin's width while the card stands: it closes (nothing persists below the dock's width).
  useEffect(() => {
    if (shown !== null && shown.card && rect === null) closeFigure();
  }, [shown, rect]);

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

  if (shown === null || shown.figure !== figure) return null;
  if (!shown.card) return <FigureOverlay figure={shown.figure} />;
  if (rect === null) return null;
  return <FigureStack figure={shown.figure} frame={rect} />;
}

/** The card element for the open figure at its row. Keyed by the figure's own key: a press of the same figure again is the same card (its
 *  zoom and pan are kept), a different figure is a new one (zoom reset to fit). `stacked`: another card stands with it, so its caption takes a
 *  fifth of it, not three tenths (P11-26 rule 2). Pure. */
export function figureCardElement(figure: FigureRef, frame: MarginRect, row: StackRow, stacked = false): ReactElement {
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

/** The card, at the row the stack gives it. It stays mounted while another card is in front (its zoom and pan live in it). */
export function FigureStack({ figure, frame }: { figure: FigureRef; frame: MarginRect }) {
  const windows = useWindows((s) => s.windows);
  const column = useColumn(true);
  const row = figureRowOf(windows, column);
  // Not in the stack for the one frame before the host's layout effect has opened it: nothing to draw.
  return row ? figureCardElement(figure, frame, row, windows.length > 1) : null;
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
