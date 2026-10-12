"use client";

// Arranges the reader's blocks — it renders none of them. Below xl the
// children come back as a fragment, from xl they are placed on the spread:
// plate, title, decision and tab strip in the panel, the common blocks, the
// active tab's blocks and the Next row in the column. The block order, strings
// and type are untouched; only the place. The rail is not a block any more:
// position and the way back live in the shell.
//
// P7-14 (R2, Q1): the decision block — the commands: "Read it here", Save,
// Copy — follows the title in BOTH layouts, before the abstract and before
// the question box. It used to follow the abstract below xl, so that a screen
// reader would meet the abstract first; the owner asked for the commands
// directly under the title and answered that the narrow layout is no
// exception. The DOM order is the visual order.
//
// P7-14 (R10): a paper Peer has read in full has two tabs, "Summary" and
// "Paper digestion". The page hands this file the strip (`tabs`), the blocks
// both tabs share (`common`: "Before you read" and the answers) and the
// terms; the active tab's blocks are `words` and `additions` as before, in
// one tabpanel. `common` is built here from its slot alone and drawn BEFORE
// the panel, outside it, in both layouts — it never reads the tab, so a
// switch cannot remount the question field or lose what the reader typed.
//
// P9-04 (X3): in one column the tab strip stands directly above its tabpanel. The order is plate,
// title, decision, the common blocks, the terms, the strip, the panel, Next: on a phone the strip used
// to stand under the decision, with the question box and the terms (about 2,000 px) between it and the
// panel it switches. The spread is unchanged: there the strip is in the panel beside the column, a
// remote control for the column by design (R10).
//
// P9-04 (X2): the panel scrolls as one. "Terms to know" used to be the one block of the panel that
// gave when the window was short — a flex item that shrank to a 7rem floor and scrolled inside itself,
// so a reader on a 1440 x 1000 window saw one of eight terms in a 112-px window nested in the panel's
// own scroll region. It is an ordinary block now: the panel, bounded by the window in `reader-panel`
// (globals.css), is the one scroll region, and nothing inside it scrolls on its own.
//
// The structure is chosen in JS rather than with `display: contents` and
// `order`, so what a screen reader announces is what the page shows. Crossing
// 80rem remounts the blocks (the authors toggle resets); a window resize
// across the breakpoint is rare and gets no transition.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { fitZoom, READING_SCALE_STEPS, useReadingPrefsStore } from "@/store/reading-prefs";
import { TABPANEL_ID, tabId } from "./reader-tabs";
import { COLUMN_CLASS, PANEL_CLASS, SPREAD_GRID, SPREAD_QUERY } from "./spread";
import type { ReaderTab } from "./use-reader-tab";

/** The id of the wrapper that holds the blocks both tabs share. */
export const COMMON_ID = "reader-common";

/**
 * Where a tab the reader picks starts, once its blocks are on the page: the page goes there only if it has
 * scrolled off the top. On the spread the column opens with the common blocks, so that is the start (the
 * panel when there are none). In one column (P9-04, X3) the common blocks stand ABOVE the strip and the
 * panel directly below it, so the start is the panel — `scroll-mt-20` leaves the strip in view above it —
 * and never the common blocks: a pick made at the strip must not throw the page back up to them.
 * `doc` is the document (a stub in the tests).
 */
export function scrollToTabStart(spread: boolean, doc: Pick<Document, "getElementById">): void {
  const start = (spread ? doc.getElementById(COMMON_ID) : null) ?? doc.getElementById(TABPANEL_ID);
  if (start && start.getBoundingClientRect().top < 0) start.scrollIntoView({ block: "start" });
}

interface ReaderLayoutProps {
  /** From `useSpread()`; the page owns it so its own effects can depend on it. */
  spread: boolean;
  plate: ReactNode;
  title: ReactNode;
  /** The commands, then the sentence — straight after the title in both
   *  layouts (P7-14, R2 + Q1). */
  decision: ReactNode;
  /** P7-14 (R10): the Summary / Paper digestion strip. Under the decision block in the
   *  spread's panel; in one column (P9-04) directly above the tabpanel it switches.
   *  Present only on a paper Peer has read in full; its presence is what makes
   *  `words` and `additions` a tabpanel. */
  tabs?: ReactNode;
  /** The tab on show, for the tabpanel's label. */
  tab?: ReaderTab;
  /** "Terms to know": in the panel under the strip on the spread, after the
   *  common blocks and before the strip in one column. Shown under both tabs. */
  terms?: ReactNode;
  /** The blocks both tabs share ("Before you read" and the answers), above the
   *  active tab's blocks in the column. Q6: one state, never remounted by a tab. */
  common?: ReactNode;
  words: ReactNode;
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

  const tabbed = p.tabs !== undefined && p.tabs !== null;
  // Built from the slot alone — the tab is not read here, on purpose (see the header).
  const common = p.common ? (
    <div id={COMMON_ID} className="reading-scaled scroll-mt-20" style={readingScaleStyle}>{p.common}</div>
  ) : null;
  const blocks = (
    <>
      <div className="reading-scaled" style={readingScaleStyle}>{p.words}</div>
      <div className="reading-scaled" style={readingScaleStyle}>{p.additions}</div>
    </>
  );

  if (!p.spread) {
    // One column: the blocks in reading order. `words` and `additions` each get
    // a thin scale wrapper of their own — the decision and the strip are not scaled.
    const panel = tabbed ? (
      // `flow-root`: the first block's own top gap (the map's 24px, a band's 48px) stays inside the panel
      // instead of collapsing out through it, so the panel's box begins at the strip's foot (P9-04, X3).
      <div role="tabpanel" id={TABPANEL_ID} aria-labelledby={p.tab ? tabId(p.tab) : undefined} className="scroll-mt-20 flow-root">{blocks}</div>
    ) : (
      blocks
    );
    return (
      <>
        {p.plate}
        {p.title}
        {p.decision}
        {common}
        {p.terms}
        {/* P9-04 (X3): the strip stands directly above the panel it switches (`aria-controls`),
            after the blocks both tabs share and the terms — not four screens above it. */}
        {p.tabs}
        {panel}
        {p.next}
      </>
    );
  }

  // The same, in the column: a flex column, so the Next row can take the free space.
  const panel = tabbed ? (
    <div role="tabpanel" id={TABPANEL_ID} aria-labelledby={p.tab ? tabId(p.tab) : undefined} className="scroll-mt-20 xl:flex xl:flex-col">
      {blocks}
    </div>
  ) : (
    blocks
  );

  return (
    // S20: `--reading-scale` set here too, not only on the `words`/
    // `additions` wraps below — `grid-template-columns` (spread.ts) is a
    // regular property, not a custom one, so its own `var()` resolves fresh
    // per element from whatever is inherited AT THAT ELEMENT. The grid div
    // is an ancestor of the existing wraps, not a descendant, so it
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
        {p.tabs}
        {/* P9-04 (X2): the terms are an ordinary block. The panel scrolls as one
            (`reader-panel`, globals.css); nothing inside it scrolls on its own. */}
        {p.terms}
      </div>
      <div className={COLUMN_CLASS}>
        {common}
        {panel}
        {/* Takes the free space on a page shorter than the panel, so the row
            sits bottom-right level with the DOI line; on a long page it is
            simply last. Never at the top — full text arriving later must
            not re-place it. */}
        <div className="xl:mt-auto">{p.next}</div>
      </div>
    </div>
  );
}
