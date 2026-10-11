"use client";

// Arranges the reader's blocks — it renders none of them. Below xl the
// children come back as a fragment, from xl they are placed on the spread:
// plate, title and decision in the panel, the words, the additions and the
// Next row in the column. The block order, strings and type are untouched;
// only the place. The rail is not a block any more: position and the way
// back live in the shell.
//
// P7-14 (R2, Q1): the decision block — the commands: "Read it here", Save,
// Copy — follows the title in BOTH layouts, before the abstract and before
// the question box. It used to follow the abstract below xl, so that a screen
// reader would meet the abstract first; the owner asked for the commands
// directly under the title and answered that the narrow layout is no
// exception. The DOM order is the visual order.
//
// The structure is chosen in JS rather than with `display: contents` and
// `order`, so what a screen reader announces is what the page shows. Crossing
// 80rem remounts the blocks (the authors toggle resets); a window resize
// across the breakpoint is rare and gets no transition.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { fitZoom, READING_SCALE_STEPS, useReadingPrefsStore } from "@/store/reading-prefs";
import { COLUMN_CLASS, PANEL_CLASS, SPREAD_GRID, SPREAD_QUERY } from "./spread";

interface ReaderLayoutProps {
  /** From `useSpread()`; the page owns it so its own effects can depend on it. */
  spread: boolean;
  plate: ReactNode;
  title: ReactNode;
  /** P1-03 (§1f.10): "Before you read" — the question field (and, from
   *  P1-04, the map). P7-14 (R2): after the decision block, which follows
   *  the title. */
  ask?: ReactNode;
  words: ReactNode;
  decision: ReactNode;
  additions: ReactNode;
  next: ReactNode;
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(SPREAD_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * ≥ xl, by the window. Safe to read on the first render: `Reader` mounts
 * only once the paper is known, which is after `StoreHydrator` rehydrates
 * (all stores are `skipHydration`) or after the by-id fetch — never during
 * SSR or hydration. The server snapshot is the one-column page regardless.
 */
export function useSpread(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SPREAD_QUERY).matches,
    () => false,
  );
}

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * S20: unconditionally the reader's own ladder step — Ruling 19 (round 7,
 * second pass) makes Fit a separate, composing whole-page zoom rather than
 * a different way to pick this same value, so this hook no longer branches
 * on `fit` at all and needs no DOM/viewport access.
 */
export function useResolvedReadingScale(): number {
  const scaleIndex = useReadingPrefsStore((s) => s.scaleIndex);
  return READING_SCALE_STEPS[scaleIndex];
}

/**
 * Ruling 21 (round 7, item 7-07): Fit's whole-page zoom multiplier — 1
 * (no-op) unless Fit is on and the spread applies (Fit has nothing to do
 * below xl, per spec). COMPUTED from the viewport width and the reader's
 * own `readingScale` step (`fitZoom`, `store/reading-prefs.ts`) — never
 * measured off a live DOM element any more. The previous version read
 * `[data-zoom-root]`'s own `offsetWidth` as a stand-in for the page's 1x
 * width; A7b-01/A7b-02 (round 7, closing) found that stand-in goes stale
 * after "Larger text"/"Smaller text" while Fit is on (nothing re-triggers a
 * DOM read until an actual window resize) and is not zoom-invariant once
 * the zoomed element is clamped by `width: 100%` instead of its own
 * `max-width` (the regime the xl breakpoint can enter), so a resize while
 * already fitted could strand the zoom on a self-inconsistent value. Both
 * inputs here are already-known numbers — nothing to go stale, nothing to
 * mis-measure.
 *
 * Subscribed to `window`'s `resize` event via `useSyncExternalStore` (the
 * same shape `useSpread` above already uses for `matchMedia`'s `change`
 * event) and to the reading-prefs store via `useResolvedReadingScale`, so
 * Fit's zoom recomputes immediately on either an A/A click or an actual
 * window resize — not only on the next resize.
 */
export function usePageZoom(): number {
  const fit = useReadingPrefsStore((s) => s.fit);
  const spread = useSpread();
  const readingScale = useResolvedReadingScale();
  const viewportWidth = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 0);
  if (!fit || !spread) return 1;
  return fitZoom(viewportWidth, readingScale);
}

export function ReaderLayout(p: ReaderLayoutProps) {
  // S15/S21: read here, not threaded as a prop from page.tsx — this file
  // already self-contains its other layout-affecting state (`useSpread`),
  // so the reading-size scale follows the same shape. Sets --reading-scale
  // on a thin wrapper around `words` and `additions` only (never
  // `decision`, never the panel) — the CSS variable falls back to 1
  // everywhere it isn't explicitly set, so nothing outside these two wraps
  // is affected.
  const readingScale = useResolvedReadingScale();
  const readingScaleStyle = { "--reading-scale": readingScale } as CSSProperties;

  // P7-14 (R2): no panel-height measuring. The panel pins by its top
  // (`globals.css`, `reader-panel`); it used to measure itself so that a panel
  // taller than the window could pin by its bottom and keep the decision in view.

  if (!p.spread) {
    // One column: the blocks in reading order. `words` and `additions` each get
    // a thin scale wrapper of their own — the question box and the decision
    // between and before them are not scaled.
    return (
      <>
        {p.plate}
        {p.title}
        {p.decision}
        {p.ask}
        <div className="reading-scaled" style={readingScaleStyle}>{p.words}</div>
        <div className="reading-scaled" style={readingScaleStyle}>{p.additions}</div>
        {p.next}
      </>
    );
  }

  return (
    // S20: `--reading-scale` set here too, not only on the two `words`/
    // `additions` wraps below — `grid-template-columns` (spread.ts) is a
    // regular property, not a custom one, so its own `var()` resolves fresh
    // per element from whatever is inherited AT THAT ELEMENT. The grid div
    // is an ancestor of the two existing wraps, not a descendant, so it
    // needs the variable set on itself; `readingScaleStyle` is the same
    // constant those wraps already use, reused rather than duplicated.
    <div className={SPREAD_GRID} style={readingScaleStyle}>
      {/* data-reader-panel: no longer read by this file (Ruling 19 moved
          Fit's own DOM query to [data-zoom-root], see usePageZoom above) —
          left on the element as a stable selector future code may still
          want, costs nothing to keep. */}
      <div className={PANEL_CLASS} data-reader-panel="">
        {p.plate}
        {p.title}
        {p.decision}
        {p.ask}
      </div>
      <div className={COLUMN_CLASS}>
        <div className="reading-scaled" style={readingScaleStyle}>{p.words}</div>
        <div className="reading-scaled" style={readingScaleStyle}>{p.additions}</div>
        {/* Takes the free space on a page shorter than the panel, so the row
            sits bottom-right level with the DOI line; on a long page it is
            simply last. Never at the top — full text arriving later must
            not re-place it. */}
        <div className="xl:mt-auto">{p.next}</div>
      </div>
    </div>
  );
}
