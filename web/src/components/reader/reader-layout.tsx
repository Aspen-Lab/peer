"use client";

// Arranges the reader's blocks — it renders none of them. Below xl the
// children come back as a fragment in the spec's order, so the DOM is
// today's; from xl they are placed on the spread: rail, plate, title and
// decision in the panel, the words, the additions and the Next row in the
// column. The block order, strings and type are untouched; only the place.
//
// The structure is chosen in JS rather than with `display: contents` and
// `order`, because a CSS re-ordering would have a screen reader announce
// the decision before the abstract on a phone. Crossing 80rem remounts the
// blocks (the authors toggle resets); a window resize across the
// breakpoint is rare and gets no transition.

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { COLUMN_CLASS, PANEL_CLASS, SPREAD_GRID, SPREAD_QUERY } from "./spread";

interface ReaderLayoutProps {
  /** From `useSpread()`; the page owns it so its own effects can depend on it. */
  spread: boolean;
  rail: ReactNode;
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
    // Today's DOM, byte for byte: no wrapper, spec order, fragments flatten.
    return (
      <>
        {p.rail}
        {p.plate}
        {p.title}
        {p.words}
        {p.decision}
        {p.additions}
        {p.next}
      </>
    );
  }

  return (
    <div className={SPREAD_GRID}>
      <div ref={panelRef} className={PANEL_CLASS}>
        {p.rail}
        {p.plate}
        {p.title}
        {p.decision}
      </div>
      <div className={COLUMN_CLASS}>
        {p.words}
        {p.additions}
        {/* Takes the free space on a page shorter than the panel, so the row
            sits bottom-right level with the DOI line; on a long page it is
            simply last. Never at the top — full text arriving later must
            not re-place it. */}
        <div className="xl:mt-auto">{p.next}</div>
      </div>
    </div>
  );
}
