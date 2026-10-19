"use client";

// Arranges the reader's blocks — it renders none of them. Below 1024 css px the children come back as a fragment, in one column; from it
// they are placed in the three-pane shell (`reader-shell.tsx`, P11-10): the left pane (the reading controls, the title, the commands and the
// Summary / Paper digestion strip in its fixed zone; the map, then the plate and the details in its scroll zone), the centre (the common
// blocks, the active tab's blocks and the Next row), and the margin, which the shell draws and keeps empty. The block order, strings and
// type are untouched; only the place. The rail is not a block any more: position and the way back live in the shell.
//
// P11-16 (B P11-01 §2.3, §2.4, §3.2; ruling §1h.113 (a)), the owner's items 2 and 6: the owner's paper has a plate and a six-line title, which
// filled the old spread's first 845 px, so the map stood at y 915 and was never on screen on arrival (and under 1280 css px there was no panel
// at all). The left pane is split: what the reader needs in view while reading — the controls, the title, the commands, the strip — is a
// fixed zone that never scrolls, and the map is the first thing of the pane's one scroller, so its first rows are on screen at 1280 x 720.
// The decision block is two slots for it: `decision` (the commands) and `details` (the sentence, the private-PDF line, the DOI, the progress).
// The map stays outside the tabpanel, under both tabs, and no block remounts on a tab switch, a pin, a rail or peek change, or a drag: each
// is built once here and appears once, and the shell keeps one DOM node per zone in every state.
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
// both tabs share (`common`: "Before you read" and the answers); the
// active tab's blocks are `words` and `additions` as before, in one tabpanel. `common` is built here from its slot alone and drawn BEFORE
// the panel, outside it, in both layouts — it never reads the tab, so a
// switch cannot remount the question field or lose what the reader typed.
//
// P9-04 (X3): in one column the tab strip stands directly above its tabpanel. The order is plate,
// title, decision, the common blocks, the strip, the panel, Next: on a phone the strip used
// to stand under the decision, with the question box and more (about 2,000 px) between it and the
// panel it switches. In the panes the strip is in the left pane beside the column, a remote control for the column by design (R10).
//
// P10-02 (ruling §1h.78): the paper's terms strip, which stood in the panel under the tab strip (after
// the common blocks in one column), is deleted, and with it its `terms` slot. The paper's own definitions
// still feed "Explain this" and the plate; they are not a block of this layout.
//
// P10-04 (review 3.1; A8): the reading map stands directly under the strip — in one column between the strip and the tabpanel; in the panes it
// is the left pane's scroll zone's first block. It is a slot of its own, outside the tabpanel: under both tabs, never remounted by a switch,
// and nothing of it is duplicated in the column.
//
// The structure is chosen in JS rather than with `display: contents` and
// `order`, so what a screen reader announces is what the page shows. Crossing
// 64rem remounts the blocks (the authors toggle resets); a window resize
// across the breakpoint is rare and gets no transition.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
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
  /** The commands — straight after the title in both layouts (P7-14, R2 + Q1). In the panes: the left
   *  pane's fixed zone, which never scrolls. */
  decision: ReactNode;
  /** P11-16: what follows the commands — the sentence, the private-PDF line, the DOI, the progress. In the
   *  panes: the left pane's scroll zone, after the map and the plate; in one column straight after `decision`. */
  details?: ReactNode;
  /** P7-14 (R10): the Summary / Paper digestion strip. At the foot of the left pane's fixed zone in the panes;
   *  in one column (P9-04) directly above the tabpanel it switches.
   *  Present only on a paper Peer has read in full; its presence is what makes
   *  `words` and `additions` a tabpanel. */
  tabs?: ReactNode;
  /** P10-04 (review 3.1): the reading map. The first block of the left pane's scroll zone in the panes (on
   *  screen on arrival, P11-16); in one column between the strip and the tabpanel. Under both tabs, outside
   *  the tabpanel. */
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
  // The strip and the map are what the left pane's two zones are for; with neither (a paper with no body) the pane has nothing to float and
  // scrolls as one.
  const tail = tabbed || (p.map !== undefined && p.map !== null);
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
        {common}
        {/* P9-04 (X3): the strip stands directly above the panel it switches (`aria-controls`),
            after the blocks both tabs share — not four screens above it. */}
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

  // The left pane. The shell's header row holds the pin and the collapse button and has no slot of its own, so the reading controls open the
  // fixed zone directly under it, then the title, the commands and the strip. (A `header` slot on the shell would put the controls in the
  // header row itself and give the map another 44px.) With nothing to float — no strip, no map — the pane scrolls as one.
  // The pane is a window high at most and the fixed zone must leave the map room, so the blocks' own gaps — made for a page — are
  // tightened here, by the wrapper, and not in the blocks (they keep their gaps in one column): the commands 20 -> 12px under the title, the
  // strip 32 -> 16px under the commands, the map 24 -> 16px under the strip.
  const head = (
    <>
      <ReadingControls spread />
      {p.title}
      <div className="[&>*>:first-child]:mt-3">{p.decision}</div>
      {p.tabs ? <div className="[&>:first-child]:mt-4">{p.tabs}</div> : null}
    </>
  );
  const rest = (
    <>
      {p.map ? <div className="[&>:first-child]:mt-4">{p.map}</div> : null}
      {p.plate}
      {p.details}
    </>
  );

  return (
    <ReaderShell
      left={
        tail
          ? {
              fixed: <div className={ZONE_INSET}>{head}</div>,
              scroll: <div className={ZONE_INSET}>{rest}</div>,
            }
          : {
              whole: (
                <div className={ZONE_INSET}>
                  {head}
                  {rest}
                </div>
              ),
            }
      }
      centre={
        // A flex column, as the old reading column was; the first block's own top gap is dropped, so whatever opens the column — the claim's
        // band, the skim deck, a TL;DR — starts level with the top of the left pane.
        <div className="flex flex-col [&>:first-child>:first-child]:mt-0 [&>:first-child>:first-child>:first-child]:mt-0">
          {common}
          {panel}
          <div>{p.next}</div>
        </div>
      }
    />
  );
}
