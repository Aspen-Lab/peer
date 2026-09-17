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
import { useReadingScale } from "@/store/reading-prefs";
import { COLUMN_CLASS, PANEL_CLASS, SPREAD_GRID, SPREAD_QUERY } from "./spread";

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

export function ReaderLayout(p: ReaderLayoutProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // S15: read here, not threaded as a prop from page.tsx — this file
  // already self-contains its one other piece of layout-affecting state
  // (`useSpread`), so the reading-size scale follows the same shape. Sets
  // --reading-scale on a thin wrapper around `words` and `additions` only
  // (never `decision`, never the panel) — the CSS variable falls back to 1
  // everywhere it isn't explicitly set, so nothing outside these two wraps
  // is affected.
  const readingScale = useReadingScale();
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
      <div ref={panelRef} className={PANEL_CLASS}>
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
