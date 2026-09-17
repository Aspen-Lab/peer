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

interface ReadingPrefsState {
  scaleIndex: number;
  increaseScale: () => void;
  decreaseScale: () => void;
}

export const useReadingPrefsStore = create<ReadingPrefsState>()(
  persist(
    (set) => ({
      scaleIndex: DEFAULT_SCALE_INDEX,
      increaseScale: () =>
        set((state) => ({ scaleIndex: Math.min(MAX_SCALE_INDEX, state.scaleIndex + 1) })),
      decreaseScale: () => set((state) => ({ scaleIndex: Math.max(0, state.scaleIndex - 1) })),
    }),
    {
      name: "peer-reading-prefs",
      version: 1,
      // skipHydration: see store/profile.ts / store/feed.ts — rehydrated
      // after mount via <StoreHydrator/> so the first client render matches
      // SSR's default scale (1x) and never mismatches the server markup.
      skipHydration: true,
    },
  ),
);

/** The current multiplier — what a component actually wants to render with. */
export function useReadingScale(): number {
  return useReadingPrefsStore((s) => READING_SCALE_STEPS[s.scaleIndex]);
}
