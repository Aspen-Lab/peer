"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  TWO_XL_BREAKPOINT_PX,
  TWO_XL_COLUMN_PX,
  TWO_XL_PANEL_PX,
  XL_BREAKPOINT_PX,
  XL_CAP_PX,
} from "@/components/reader/spread";

// S15: the reader's font-size controls (A / A) — one index into a fixed
// ladder of multipliers, read by globals.css's --reading-scale-driven
// tokens (--text-lead/--text-body/--text-body-lg) via calc(). Persisted per
// reader so the choice survives navigation and reload — same skipHydration
// pattern as store/profile.ts and store/feed.ts: the first client render
// matches the server's default (index 2, 1x) and <StoreHydrator/>
// rehydrates the saved value after mount, so there is no hydration
// mismatch to guard against here.

// S20: two steps appended above 1.32x so a wide monitor can fill more of
// itself — the column now scales as a page (spread.ts, page-container.tsx),
// not just the text, so a bigger step is safe to add. `DEFAULT_SCALE_INDEX`
// (below) is unchanged: it still lands on the same `1` entry.
export const READING_SCALE_STEPS = [0.85, 0.925, 1, 1.1, 1.2, 1.32, 1.45, 1.6] as const;
const DEFAULT_SCALE_INDEX = 2; // 1x, the middle step
const MAX_SCALE_INDEX = READING_SCALE_STEPS.length - 1;

// S21 / Ruling 19 (round 7, second pass): "Fit to screen" is a whole-page
// CSS `zoom`, not a ladder step — `fit` just says whether it is on.
// `scaleIndex` keeps meaning exactly what it means today (the reader's own
// manual/"book layout" text-and-column step). The two now COMPOSE rather
// than one replacing the other: Fit's own multiplier is computed fresh at
// read time from the live DOM (`reader-layout.tsx`'s `usePageZoom`, via
// `fitZoom` below — this store has no DOM access, so it cannot compute it
// itself), on top of whatever `scaleIndex` already produced. Neither knob
// clears the other any more: `increaseScale`/`decreaseScale`/`resetScale`
// leave `fit` untouched, and `setFit` leaves `scaleIndex` untouched. Turning
// Fit off falls out with no bookkeeping either way, since neither action
// ever wrote into the other's field.
interface ReadingPrefsState {
  scaleIndex: number;
  fit: boolean;
  increaseScale: () => void;
  decreaseScale: () => void;
  setFit: (fit: boolean) => void;
  /** Ctrl/⌘+0: back to 1x on the ladder. Does not touch `fit` — Fit is a
   *  separate, composable knob (Ruling 19), not something a ladder reset
   *  is expected to clear. */
  resetScale: () => void;
}

export const useReadingPrefsStore = create<ReadingPrefsState>()(
  persist(
    (set) => ({
      scaleIndex: DEFAULT_SCALE_INDEX,
      fit: false,
      increaseScale: () =>
        set((state) => ({ scaleIndex: Math.min(MAX_SCALE_INDEX, state.scaleIndex + 1) })),
      decreaseScale: () =>
        set((state) => ({ scaleIndex: Math.max(0, state.scaleIndex - 1) })),
      setFit: (fit) => set({ fit }),
      resetScale: () => set({ scaleIndex: DEFAULT_SCALE_INDEX }),
    }),
    {
      name: "peer-reading-prefs",
      version: 1,
      // skipHydration: see store/profile.ts / store/feed.ts — rehydrated
      // after mount via <StoreHydrator/> so the first client render matches
      // SSR's default scale (1x, fit off) and never mismatches the server
      // markup. A blob persisted before `fit` existed simply has no `fit`
      // key; zustand's persist merges it over the initial state above, so
      // it defaults to `false` exactly as a fresh reader would get.
      skipHydration: true,
    },
  ),
);

/**
 * Ruling 21 (round 7, item 7-07): Fit's whole-page zoom multiplier — the
 * factor that scales the page (panel, gap, column, figures, all of it) so
 * it fills ~85% of the viewport, the way a PDF viewer's "fit width" reads
 * on a big monitor. Pure arithmetic, zero DOM access, unit-testable with
 * plain numbers.
 *
 * The page's 1x width (`pageWidthAt1x`, the previous version's second
 * argument) used to be MEASURED — `reader-layout.tsx`'s `usePageZoom` read
 * `[data-zoom-root]`'s own `offsetWidth` off the live DOM. A7b-01/A7b-02
 * (round 7, closing) found two real ways that measurement lies: it goes
 * stale after "Larger text"/"Smaller text" while Fit is on (nothing
 * re-triggers the read until an actual window resize), and it is not
 * zoom-invariant once the zoomed element is clamped by `width: 100%` rather
 * than its own `max-width` (the xl breakpoint's regime), so a resize while
 * already fitted can strand the zoom near a self-inconsistent value with no
 * fixed point. Ruling 21: COMPUTE it instead, from the same two numbers
 * `page-container.tsx`'s own calc pair uses for the spread's max-width at
 * each breakpoint (`spread.ts`'s `XL_CAP_PX`/`TWO_XL_CAP_PX`, pinned against
 * that file's literals by its own test) times the reader's current
 * `readingScale` step — both already-known values with nothing to measure,
 * so this can never go stale or land on an inconsistent state.
 *
 * Replaces `fitScaleIndex` (retired: nothing picks a ladder step for Fit
 * any more — Fit is continuous, not ladder-bound).
 */
export function fitZoom(viewportWidth: number, readingScale: number): number {
  // The page's 1x-zoom width at this A/A step — the same expression
  // page-container.tsx's max-width calc pair evaluates to: at 2xl the panel
  // share is fixed and only the reading track scales; at xl the whole cap
  // scales; below xl Fit has nothing to do (spec) — book layout, not a
  // divide-by-zero.
  const pageWidth =
    viewportWidth >= TWO_XL_BREAKPOINT_PX
      ? TWO_XL_PANEL_PX + TWO_XL_COLUMN_PX * readingScale
      : viewportWidth >= XL_BREAKPOINT_PX
        ? XL_CAP_PX * readingScale
        : 0;
  if (pageWidth <= 0) return 1;
  return Math.min(2.5, Math.max(1, (0.85 * viewportWidth) / pageWidth));
}
