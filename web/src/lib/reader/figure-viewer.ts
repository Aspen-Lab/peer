// P11-12 (owner item 1; B P11-05 §2.3; ruling §1h.113): the figure the reader has opened from the paper's body, as one small
// store. A figure in Paper digestion is a button (`Figure` in `paper-body.tsx`); pressing it calls `openFigure` here, and the card
// that shows it in the margin — a later item's — reads `useOpenFigure`. Until that card is hosted nothing but the body's own button
// (its `aria-expanded` and its outline) listens.
//
// The rules, all of them the ruling's:
//   - One figure at a time (D2): opening another replaces the open one.
//   - Pressing the figure that is open keeps it (D4) — the same key, nothing closed, nothing reset — but it is a new open: each
//     `openFigure` hands out a new ref, so a host that acts on the ref's identity (to bring the card forward) acts on a re-press too.
//   - In memory only: nothing is written to storage, nothing is logged, and a reload shows no figure open. A private upload's
//     figure address is cookie-bound and stays in this tab.
//   - P11-41 (round 2, Theme B (c); ruling §1h.138 (d)): a figure can be PARKED. A card that is open in the margin when the window narrows below
//     1024 px is not closed: the host takes it out of the margin with `parkFigure` and puts the very same figure back with `resumeFigure` when the
//     window is wide again. Parked, a figure is not open (the body's button is not pressed, Escape has nothing to close), and it is held here, in this
//     module's memory, as the open figure is: nothing is stored (the zoom and pan are the kept card's own state, `figure-host.tsx`). Any other
//     figure opened, and any close, forgets it — a figure closed while the window was narrow stays closed.
//   - It is not the floating windows' store, and does not reserve the page's width or hold the reader's place: the host
//     that puts the card in the margin's stack does those, so that the margin stays the one thing that decides them.
//
// This is a plain external store read with `useSyncExternalStore` (the server snapshot is the current state too, so a render that
// is not in a browser — a test's — shows what the store holds). The store is empty at hydration: nothing can open a figure before
// the page has a button to press.

import { useSyncExternalStore } from "react";

/** A rectangle in window pixels, as `getBoundingClientRect` reports one. */
export interface FigureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the margin needs to show a figure: its key, its picture and caption, and where it stood in the body. */
export interface FigureRef {
  /** The body's own key for the figure: `${label}:${ordinal}`. Two refs with one key are one figure. */
  key: string;
  /** The picture's address, as the body draws it. */
  src: string;
  /** "Figure 3" */
  label: string;
  caption: string;
  /** The picture's own size in pixels: from the loaded picture, else from the figure's record; null when neither is known. */
  natural: { width: number; height: number } | null;
  /** Where the picture stood in the window when it was pressed; null when that could not be read. */
  origin: FigureRect | null;
}

let open: FigureRef | null = null;
/** The figure the window's narrowing took out of the margin, to be put back when it widens (P11-41); never while a figure is open. */
let parked: FigureRef | null = null;
const listeners = new Set<() => void>();

function set(next: FigureRef | null): void {
  open = next;
  for (const listener of [...listeners]) listener();
}

/** Open a figure, replacing any other that is open — or parked. The same figure again stays open, as a new ref. */
export function openFigure(ref: FigureRef): void {
  parked = null;
  set({
    key: ref.key,
    src: ref.src,
    label: ref.label,
    caption: ref.caption,
    natural: ref.natural ? { ...ref.natural } : null,
    origin: ref.origin ? { ...ref.origin } : null,
  });
}

/** Close the open figure, and forget a parked one (a figure closed while the window was narrow stays closed). Nothing open or parked: nothing happens, and nobody is told. */
export function closeFigure(): void {
  if (open === null && parked === null) return;
  parked = null;
  set(null);
}

/**
 * P11-41: take the open figure out of the margin without closing it — the window narrowed below 1024 px. It is no longer open (the body's
 * button is not pressed) and is held for `resumeFigure`. Returns whether there was a figure to park.
 */
export function parkFigure(): boolean {
  if (open === null) return false;
  parked = open;
  set(null);
  return true;
}

/**
 * P11-41: the window is wide again — the parked figure is the open one once more, the very same ref (not a copy: a host that acts on a
 * new ref, the card's focus, then does not). Returns whether there was one.
 */
export function resumeFigure(): boolean {
  if (parked === null) return false;
  const back = parked;
  parked = null;
  set(back);
  return true;
}

/** The parked figure, or null. */
export function getParkedFigure(): FigureRef | null {
  return parked;
}

/** The open figure, or null. */
export function getOpenFigure(): FigureRef | null {
  return open;
}

/** The open figure's key, or null. */
export function openFigureKey(): string | null {
  return open === null ? null : open.key;
}

/** Be told whenever a figure opens (or opens again) or closes; returns the way to stop. */
export function subscribeOpenFigure(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open figure, or null; the component renders again when a figure opens, opens again, or closes. */
export function useOpenFigure(): FigureRef | null {
  return useSyncExternalStore(subscribeOpenFigure, getOpenFigure, getOpenFigure);
}

/** The parked figure, or null; the component renders again when a figure is parked, comes back, or is forgotten. */
export function useParkedFigure(): FigureRef | null {
  return useSyncExternalStore(subscribeOpenFigure, getParkedFigure, getParkedFigure);
}

/** Whether the figure with this key is the open one; the component renders again only when that changes. */
export function useFigureOpen(key: string): boolean {
  return useSyncExternalStore(
    subscribeOpenFigure,
    () => open !== null && open.key === key,
    () => open !== null && open.key === key,
  );
}
