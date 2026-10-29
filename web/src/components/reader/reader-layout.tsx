"use client";

// On desktop, the sticky sidebar contains the paper outline; title, actions,
// bibliographic details, tabs and article share one reading column. On a
// phone the blocks remain in their existing single-column reading order.
// The map and common question field stay outside the tab panel so switching
// views does not reset them. The chosen structure follows visual DOM order.
// Crossing the desktop breakpoint remounts the blocks, as it did before.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import "./reader-compact.css";
import { fitZoom, READING_SCALE_STEPS, useReadingPrefsStore } from "@/store/reading-prefs";
import { TABPANEL_ID, tabId } from "./reader-tabs";
import { ReaderShell } from "./reader-shell";
import { ReadingControls } from "./reading-controls";
import { SPREAD_QUERY } from "./spread";
import type { ReaderTab } from "./use-reader-tab";

/** The id of the wrapper that holds the blocks both tabs share. */
export const COMMON_ID = "reader-common";

/**
 * Where a tab the reader picks starts, once its blocks are on the page: the page goes there only if it has
 * scrolled off the top. In the panes (the spread) the centre opens with the common blocks, so that is the start (the
 * tabpanel when there are none). In one column (P9-04, X3) the common blocks stand ABOVE the strip and the
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
  /** Actions follow the title in both layouts. */
  decision: ReactNode;
  /** Bibliography, access details and the DOI. */
  details?: ReactNode;
  /** Report generation status, when present. */
  progress?: ReactNode;
  /** Summary / Paper digestion switch when a full body is available. */
  tabs?: ReactNode;
  /** Explain why book view is unavailable when the paper has no full text. */
  bookHint?: ReactNode;
  /** The paper outline, outside the tab panel in both layouts. */
  map?: ReactNode;
  /** The tab on show, for the tabpanel's label. */
  tab?: ReaderTab;
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
 * ≥ 64rem (1024 css px, the three panes), by the window. Safe to read on the first render: `Reader` mounts
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
 * below the three panes, per spec). COMPUTED from the viewport width and the reader's
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

/** What a zone gives the focus ring (2px + 3px offset) of whatever stands at its edge: a zone clips what overflows it, and a command or a
 *  map row at the edge would lose its ring. The old map had `xl:-mx-1.5 xl:px-1.5` for it. */
const ZONE_INSET = "px-1.5";

export function ReaderLayout(p: ReaderLayoutProps) {
  // S15/S21: read here, not threaded as a prop from page.tsx — this file
  // already self-contains its other layout-affecting state (`useSpread`),
  // so the reading-size scale follows the same shape. Sets --reading-scale
  // on a thin wrapper around `words` and `additions` only (never
  // `decision`, never the pane) — the CSS variable falls back to 1
  // everywhere it isn't explicitly set, so nothing outside these two wraps
  // is affected.
  const readingScale = useResolvedReadingScale();
  const readingScaleStyle = { "--reading-scale": readingScale } as CSSProperties;

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
        {p.details}
        {p.progress}
        {common}
        {/* P9-04 (X3): the strip stands directly above the panel it switches (`aria-controls`),
            after the blocks both tabs share — not four screens above it. */}
        <div id="reader-book-toolbar-slot">{p.bookHint}</div>
        {p.tabs}
        {/* P10-04 (review 3.1): the map, directly under the strip it stands with and above the panel it
            helps the reader move through; outside the panel, so it shows under both tabs. */}
        {p.map}
        {panel}
        {p.next}
      </>
    );
  }

  // The three panes (P11-16). The tabpanel is a flex column, as the old spread's was, so the first block's own top gap stays inside it.
  const panel = tabbed ? (
    <div role="tabpanel" id={TABPANEL_ID} aria-labelledby={p.tab ? tabId(p.tab) : undefined} className="scroll-mt-20 flex flex-col">
      {blocks}
    </div>
  ) : (
    blocks
  );

  return (
    <ReaderShell
      left={{ whole: <div className={ZONE_INSET}>{p.map ?? <div className="reader-outline-empty"><span>Contents</span><p>No outline available</p></div>}</div> }}
      centre={
        <div className="reader-document">
          <div className="reader-document-tools"><ReadingControls spread /></div>
          <div className="reader-document-title">{p.title}</div>
          <div className="reader-document-commands">{p.decision}</div>
          <div className="reader-document-details">{p.details}</div>
          {p.progress}
          <div id="reader-book-toolbar-slot">{p.bookHint}</div>
          {p.tabs}
          {common}
          {panel}
          {p.plate && <div className="reader-document-figure">{p.plate}</div>}
          <div>{p.next}</div>
        </div>
      }
    />
  );
}
