"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PLAIN_DEFAULT_LEVEL, isPlainLevel, type PlainLevel } from "@/lib/papers/plain-levels";
import { DIVIDER_PX, LEFT_DEFAULT_PX, MARGIN_DEFAULT_PX } from "@/components/reader/pane-layout";

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
  /** P4-01 (blueprint §3.6; §1h.12 (h)): the level the reader last chose for "Say it plainly" —
   *  one of the three, `undergrad` until they choose. Remembered here with the other reading
   *  preferences, so the next paragraph and the next paper start at it. A blob persisted before
   *  this key existed has none, and zustand's persist merges it over the initial state below, so
   *  it reads as the default exactly as a fresh reader's does — which is why `version` stays 1. */
  plainLevel: PlainLevel;
  increaseScale: () => void;
  decreaseScale: () => void;
  setFit: (fit: boolean) => void;
  /** Choose a level for "Say it plainly". Anything that is not one of the three is ignored. */
  setPlainLevel: (level: PlainLevel) => void;
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
      plainLevel: PLAIN_DEFAULT_LEVEL,
      increaseScale: () =>
        set((state) => ({ scaleIndex: Math.min(MAX_SCALE_INDEX, state.scaleIndex + 1) })),
      decreaseScale: () =>
        set((state) => ({ scaleIndex: Math.max(0, state.scaleIndex - 1) })),
      setFit: (fit) => set({ fit }),
      setPlainLevel: (level) => {
        if (isPlainLevel(level)) set({ plainLevel: level });
      },
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

/** The paper's column at the 1x A / A step, in the reference width Fit measures against (B P11-01 §2.7): today's 640 px reading column. */
const FIT_COLUMN_PX = 640;

/**
 * Fit's whole-page zoom multiplier — the factor that scales the page (panes, text, figures, all of it) so it fills ~85% of the window,
 * the way a PDF viewer's "fit width" reads on a big monitor. Pure arithmetic, zero DOM access, unit-testable with plain numbers.
 *
 * P11-10 (B P11-01 §2.7; ruling §1h.113 (a), D8): the reference width is the three-pane shell's DEFAULT panes at the reader's current
 * A / A step — the left pane (320), the paper's column (640 × the step), the margin (360) and the two dividers (24): 1,344 at 1x. It
 * replaces the caps of the retired two-column spread (1072 / 1184 px), against which Fit over-zoomed a layout that now fills the window:
 * the zoom is 1.0 at 1440 (the panes already fill it), about 1.21 at 1920 and 1.62 at 2560, and starts above 1,581 px. It never reads a
 * pane's width, so a divider drag cannot change it, and below the shell's 1024 px (the one column) there is nothing for it to do.
 *
 * History (Ruling 21, round 7, item 7-07): the page's 1x width used to be MEASURED off `[data-zoom-root]`, which went stale after
 * "Larger/Smaller text" while Fit was on and was not zoom-invariant once the zoomed element was clamped by `width: 100%`. It is
 * COMPUTED instead, from numbers that are already known, so it can never go stale or land on an inconsistent state.
 *
 * Replaces `fitScaleIndex` (retired: nothing picks a ladder step for Fit any more — Fit is continuous, not ladder-bound).
 */
export function fitZoom(viewportWidth: number, readingScale: number): number {
  const referenceWidth = LEFT_DEFAULT_PX + FIT_COLUMN_PX * readingScale + MARGIN_DEFAULT_PX + 2 * DIVIDER_PX;
  return Math.min(2.5, Math.max(1, (0.85 * viewportWidth) / referenceWidth));
}
