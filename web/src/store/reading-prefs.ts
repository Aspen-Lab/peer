"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

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

// S21: "Fit to screen" — `scaleIndex` keeps meaning exactly what it means
// today (the reader's own manual/"book layout" choice); `fit` is a
// separate flag, never written back into `scaleIndex`. The DISPLAYED scale
// is computed fresh at read time by the caller (fit ? fitScaleIndex(...) :
// READING_SCALE_STEPS[scaleIndex]) — see reader-layout.tsx's
// `useResolvedReadingScale`, this store's one consumer (and, through it,
// page.tsx's — both call the same hook, so they can never see two
// different resolved scales at once; see that file's own comment for why
// this store alone can't compute it, since `fitScaleIndex` needs the
// panel's live DOM width). Turning Fit off is then free: `scaleIndex` was
// never touched while Fit was on, so "back to the book layout" falls out
// with no bookkeeping. Manual A/A cancels Fit — done once, here, in the
// two actions themselves, so no future caller (button, keyboard, anything
// added later) can forget it.
interface ReadingPrefsState {
  scaleIndex: number;
  fit: boolean;
  increaseScale: () => void;
  decreaseScale: () => void;
  setFit: (fit: boolean) => void;
  /** Ctrl/⌘+0: back to 1x, book layout — leaving Fit on would be
   *  incoherent, since Fit's whole point is picking a non-1x step itself. */
  resetScale: () => void;
}

export const useReadingPrefsStore = create<ReadingPrefsState>()(
  persist(
    (set) => ({
      scaleIndex: DEFAULT_SCALE_INDEX,
      fit: false,
      increaseScale: () =>
        set((state) => ({ scaleIndex: Math.min(MAX_SCALE_INDEX, state.scaleIndex + 1), fit: false })),
      decreaseScale: () =>
        set((state) => ({ scaleIndex: Math.max(0, state.scaleIndex - 1), fit: false })),
      setFit: (fit) => set({ fit }),
      resetScale: () => set({ scaleIndex: DEFAULT_SCALE_INDEX, fit: false }),
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
 * S21: the largest ladder step whose page width (panel + gap + column)
 * still fits within ~85% of the viewport — pure arithmetic, zero DOM
 * access, so it is unit-testable with plain numbers. Falls back to the
 * smallest step if even that does not fit.
 */
export function fitScaleIndex(
  viewportWidth: number,
  panelWidth: number,
  gap: number,
  baseColumnWidth: number,
): number {
  const target = 0.85 * viewportWidth;
  for (let i = READING_SCALE_STEPS.length - 1; i >= 0; i--) {
    if (panelWidth + gap + baseColumnWidth * READING_SCALE_STEPS[i] <= target) return i;
  }
  return 0;
}
