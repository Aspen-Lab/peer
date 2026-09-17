"use client";

// Arranges the reader's blocks — it renders none of them. Below xl the
// children come back as a fragment in the spec's order, so the DOM is
// today's; from xl they are placed on the spread: plate, title and decision
// in the panel, the words, the additions and the Next row in the column.
// The block order, strings and type are untouched; only the place. The rail
// is not a block any more: position and the way back live in the shell.
//
// The structure is chosen in JS rather than with `display: contents` and
// `order`, because a CSS re-ordering would have a screen reader announce
// the decision before the abstract on a phone. Crossing 80rem remounts the
// blocks (the authors toggle resets); a window resize across the
// breakpoint is rare and gets no transition.

import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { fitScaleIndex, READING_SCALE_STEPS, useReadingPrefsStore } from "@/store/reading-prefs";
import {
  COLUMN_CLASS,
  PANEL_CLASS,
  READING_COLUMN_BASE_PX,
  READING_GRID_GAP_2XL_PX,
  SPREAD_GRID,
  SPREAD_QUERY,
} from "./spread";

interface ReaderLayoutProps {
  /** From `useSpread()`; the page owns it so its own effects can depend on it. */
  spread: boolean;
  plate: ReactNode;
  title: ReactNode;
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
 * S21: the reading scale actually shown — the reader's manual ladder step,
 * or, while Fit is on (and the spread applies — Fit has nothing to do
 * below xl), the step `fitScaleIndex` picks for the current viewport.
 * Computed fresh at read time rather than written back into `scaleIndex`
 * (see reading-prefs.ts's own header comment): nothing here calls
 * `setState` from an effect. Subscribed to `window`'s `resize` event via
 * `useSyncExternalStore`, the same shape `useSpread` above already uses
 * for `matchMedia`'s `change` event, so Fit's step re-picks itself as the
 * window is dragged, not only on the next click.
 *
 * Reads the panel's live width via `[data-reader-panel]` rather than a
 * threaded ref, because this hook has **two** call sites that need the
 * identical resolved value — this file's own `ReaderLayout` (for the
 * spread's grid track) and `app/papers/[id]/page.tsx` (for the article's
 * own max-width, S20's other half of the same calc() pair) — and page.tsx
 * is `ReaderLayout`'s parent, with no ref path from a ref created inside a
 * child to a parent that renders before it. A DOM-query lookup sidesteps
 * that entirely and matches this codebase's own established
 * cross-component idiom (`keyboard.tsx`'s `document.querySelectorAll("[data-paper-id]")`,
 * `withZoomTransition`'s `[data-zoom-root]`) — both call sites compute the
 * same thing independently and can never disagree, the same reason it was
 * already safe for both to call the old, non-fit-aware `useReadingScale`
 * selector. (Traced deviation from the round-7 fix guide, logged in full
 * in §4: the guide's own text put this computation "inside
 * useReadingScale()'s existing consumer, reader-layout.tsx" as if it had
 * one call site — 7-01, the guide's own earlier item, gave it a second,
 * in page.tsx. Computing fit-awareness in only one of the two would let
 * the article's max-width and the grid's column width use two different
 * scales while Fit is on, breaking the exact panel-width invariant 7-01
 * derived and live-verified. This hook is the fix: identical computation,
 * called independently from both places, so they cannot diverge.)
 */
export function useResolvedReadingScale(): number {
  const scaleIndex = useReadingPrefsStore((s) => s.scaleIndex);
  const fit = useReadingPrefsStore((s) => s.fit);
  const spread = useSpread();
  useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 0);
  if (!fit || !spread || typeof window === "undefined") {
    return READING_SCALE_STEPS[scaleIndex];
  }
  const panel = document.querySelector<HTMLElement>("[data-reader-panel]");
  const index = fitScaleIndex(
    window.innerWidth,
    panel?.offsetWidth ?? 0,
    READING_GRID_GAP_2XL_PX,
    READING_COLUMN_BASE_PX,
  );
  return READING_SCALE_STEPS[index];
}

export function ReaderLayout(p: ReaderLayoutProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // S15/S21: read here, not threaded as a prop from page.tsx — this file
  // already self-contains its other layout-affecting state (`useSpread`),
  // so the reading-size scale follows the same shape. Sets --reading-scale
  // on a thin wrapper around `words` and `additions` only (never
  // `decision`, never the panel) — the CSS variable falls back to 1
  // everywhere it isn't explicitly set, so nothing outside these two wraps
  // is affected.
  const readingScale = useResolvedReadingScale();
  const readingScaleStyle = { "--reading-scale": readingScale } as CSSProperties;

  // The panel's height, for the sticky rule: a panel taller than the
  // viewport pins by its bottom so the decision stays and the plate scrolls
  // away. Written as `--panel-h` — keep that name: `globals.css` gives every
  // inline variable whose name contains `--i` a stagger delay.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      el.style.setProperty("--panel-h", `${el.offsetHeight}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [p.spread]);

  if (!p.spread) {
    // Today's DOM, byte for byte except for the two new scale wrappers:
    // spec order, fragments flatten. `decision` sits between `words` and
    // `additions` here (screen-reader order), so each gets its own thin
    // wrapper rather than one shared one around both.
    return (
      <>
        {p.plate}
        {p.title}
        <div className="reading-scaled" style={readingScaleStyle}>{p.words}</div>
        {p.decision}
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
      {/* data-reader-panel: useResolvedReadingScale's own DOM-query
          target for the panel's live width — see that hook's comment. */}
      <div ref={panelRef} className={PANEL_CLASS} data-reader-panel="">
        {p.plate}
        {p.title}
        {p.decision}
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
