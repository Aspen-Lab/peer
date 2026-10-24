"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clampPane } from "@/components/reader/pane-layout";

// P11-10 (B P11-01 §2.3, §2.6, §4 C1; ruling §1h.113): what the reader chose for the three panes, kept in this browser — whether the
// left pane is pinned or the rail, and how wide the left pane and the margin are. Widths are in UNZOOMED css px (Fit's zoom divides
// out before they get here, `pane-divider.tsx`), and they are the reader's WISH: the window's answer to them is `fitPanes`
// (`pane-layout.ts`), recomputed on every resize, never written back here. So a small window squeezes the panes without forgetting
// the widths, and a big one gives them back.
//
// Written when a drag is released, a key is pressed on a divider, or the pin is pressed — never while a drag is under way (the divider
// writes a CSS custom property on the shell per frame and commits once, on release).
//
// Every field is optional: absent is "no choice yet" (the left pane starts pinned at every width the shell exists in, ruling §1h.115 item 4;
// the widths are the defaults). A blob that is corrupt, hand-edited or from a build that kept something else reads as that — the
// fields that are not what they should be are dropped one by one, a number is clamped into its pane's range, nothing throws.
//
// Same pattern as `store/reading-prefs.ts`: `persist({ skipHydration: true })`, loaded after mount by <StoreHydrator/> so the first
// client render matches the server's. Nothing here is per paper, per user or sent anywhere.

export const READER_PANES_STORAGE_KEY = "peer-reader-panes";

/** What is kept. */
export interface ReaderPanesData {
  /** The reader pinned (true) or collapsed (false) the left pane. Absent: no choice yet. */
  leftPinned?: boolean;
  /** The left pane's width as a column, in unzoomed css px. */
  leftWidth?: number;
  /** The margin's width, in unzoomed css px. */
  marginWidth?: number;
}

interface ReaderPanesState extends ReaderPanesData {
  setLeftPinned: (pinned: boolean) => void;
  /** Keep the left pane's width, clamped to its range. Something that is not a number is ignored. */
  setLeftWidth: (width: number) => void;
  /** Keep the margin's width, clamped to its range. Something that is not a number is ignored. */
  setMarginWidth: (width: number) => void;
  /** Forget every choice: the defaults again. */
  reset: () => void;
}

/**
 * What a stored value is worth: the fields that are what they should be, and nothing else. A boolean pin; a finite width, clamped into
 * its pane's range (so a blob written when the bounds were different, or edited by hand, cannot stretch a pane past them). Anything
 * else — a string, null, NaN, an object, an array — is no choice, and reads as the default. Pure.
 */
export function sanitizePanes(stored: unknown): ReaderPanesData {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const value = stored as Record<string, unknown>;
  const kept: ReaderPanesData = {};
  if (typeof value.leftPinned === "boolean") kept.leftPinned = value.leftPinned;
  if (typeof value.leftWidth === "number" && Number.isFinite(value.leftWidth)) kept.leftWidth = clampPane("left", value.leftWidth);
  if (typeof value.marginWidth === "number" && Number.isFinite(value.marginWidth)) kept.marginWidth = clampPane("margin", value.marginWidth);
  return kept;
}

export const useReaderPanesStore = create<ReaderPanesState>()(
  persist(
    (set) => ({
      setLeftPinned: (pinned) => {
        if (typeof pinned === "boolean") set({ leftPinned: pinned });
      },
      setLeftWidth: (width) => {
        if (typeof width === "number" && Number.isFinite(width)) set({ leftWidth: clampPane("left", width) });
      },
      setMarginWidth: (width) => {
        if (typeof width === "number" && Number.isFinite(width)) set({ marginWidth: clampPane("margin", width) });
      },
      reset: () => set({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined }),
    }),
    {
      name: READER_PANES_STORAGE_KEY,
      version: 1,
      // See store/reading-prefs.ts: rehydrated after mount via <StoreHydrator/>, so the first client render matches the server's.
      skipHydration: true,
      // The data only; the setters are not state.
      partialize: (state): ReaderPanesData => ({ leftPinned: state.leftPinned, leftWidth: state.leftWidth, marginWidth: state.marginWidth }),
      // Clamped on read: the stored fields go through `sanitizePanes`, so a corrupt blob reads as the defaults and the actions survive.
      merge: (persisted, current) => ({ ...current, ...sanitizePanes(persisted) }),
    },
  ),
);
