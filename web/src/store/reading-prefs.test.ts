import { beforeEach, describe, expect, it } from "vitest";
import { fitZoom, READING_SCALE_STEPS, useReadingPrefsStore } from "@/store/reading-prefs";

// S15: the font-size ladder's clamp logic — the only real behaviour this
// store has (persistence itself is the repo's established
// `persist({ skipHydration: true })` pattern, not independently testable
// here, same reasoning as every other store's own tests in this repo).

describe("reading prefs scale ladder", () => {
  beforeEach(() => {
    useReadingPrefsStore.setState({ scaleIndex: 2 });
  });

  it("defaults to index 2 — the 1x step", () => {
    expect(useReadingPrefsStore.getState().scaleIndex).toBe(2);
    expect(READING_SCALE_STEPS[2]).toBe(1);
  });

  it("increases one step at a time and clamps at the top of the ladder", () => {
    // S20 (7-01): was 3 fixed presses, which only reached the top because
    // the old 6-step ladder's top sat exactly 3 above the default index 2.
    // The 8-step ladder's top is 5 above it — a fixed count silently
    // undertested the clamp instead of failing loudly, caught by running
    // this file after the ladder grew. `.length` presses reaches the top
    // from any starting index, for any ladder length.
    const store = useReadingPrefsStore.getState();
    for (let i = 0; i < READING_SCALE_STEPS.length; i++) store.increaseScale();
    expect(useReadingPrefsStore.getState().scaleIndex).toBe(READING_SCALE_STEPS.length - 1);
    // One more click past the top does not go out of bounds.
    useReadingPrefsStore.getState().increaseScale();
    expect(useReadingPrefsStore.getState().scaleIndex).toBe(READING_SCALE_STEPS.length - 1);
  });

  it("decreases one step at a time and clamps at the bottom of the ladder", () => {
    const store = useReadingPrefsStore.getState();
    store.decreaseScale();
    store.decreaseScale();
    expect(useReadingPrefsStore.getState().scaleIndex).toBe(0);
    // One more click past the bottom does not go negative.
    useReadingPrefsStore.getState().decreaseScale();
    expect(useReadingPrefsStore.getState().scaleIndex).toBe(0);
  });

  // S20 (round 7, item 7-01): the ladder grew two steps upward (1.45, 1.6)
  // so a wide monitor can be filled — the column now scales as a page, not
  // just the text, so a bigger step is safe.
  it("the ladder is exactly the eight steps the spec names, in order", () => {
    expect(READING_SCALE_STEPS).toEqual([0.85, 0.925, 1, 1.1, 1.2, 1.32, 1.45, 1.6]);
  });
});

// S21 / Ruling 19 (round 7, second pass — was 7-03's ladder-index Fit,
// replaced): "Fit to screen" is now a whole-page CSS zoom, computed fresh
// at read time by `reader-layout.tsx`'s `usePageZoom` (not tested here — it
// needs a DOM/window this Node-environment test file doesn't have), not a
// different way to pick `scaleIndex`. So `fit` and `scaleIndex` are now
// independent: manual A/A no longer clears `fit`, and `resetScale` no
// longer clears it either — this file covers that composing contract.
describe("reading prefs — fit to screen", () => {
  beforeEach(() => {
    useReadingPrefsStore.setState({ scaleIndex: 2, fit: false });
  });

  it("fit starts false", () => {
    expect(useReadingPrefsStore.getState().fit).toBe(false);
  });

  it("setFit(true) turns fit on", () => {
    useReadingPrefsStore.getState().setFit(true);
    expect(useReadingPrefsStore.getState().fit).toBe(true);
  });

  it("increaseScale leaves fit untouched — Ruling 19: A/A and Fit compose", () => {
    useReadingPrefsStore.getState().setFit(true);
    useReadingPrefsStore.getState().increaseScale();
    expect(useReadingPrefsStore.getState().fit).toBe(true);
  });

  it("decreaseScale leaves fit untouched — Ruling 19: A/A and Fit compose", () => {
    useReadingPrefsStore.getState().setFit(true);
    useReadingPrefsStore.getState().decreaseScale();
    expect(useReadingPrefsStore.getState().fit).toBe(true);
  });

  it("resetScale returns to the default step and leaves fit untouched", () => {
    const store = useReadingPrefsStore.getState();
    store.increaseScale();
    store.increaseScale();
    store.setFit(true);
    store.resetScale();
    const state = useReadingPrefsStore.getState();
    expect(state.scaleIndex).toBe(2);
    expect(state.fit).toBe(true);
  });
});

// Ruling 19 (round 7, second pass): replaces `fitScaleIndex`'s ladder
// 7-07 (Ruling 21): Fit is computed from the layout's own constants — the
// article's 1x cap at the viewport's breakpoint (1000px at xl, 1200px at
// 2xl) times the reader's A/A scale — never measured off the zoomed element,
// so an A/A change under Fit recomputes at once and a resize while fitted
// can never read a container-clamped width. (Rewritten from the
// pageWidthAt1x-argument version of 7-04, not deleted.)
describe("fitZoom", () => {
  it("2560 wide at 1x: ≈ 1.813 (0.85 × 2560 / 1200)", () => {
    expect(fitZoom(2560, 1)).toBeCloseTo(1.8133, 4);
  });

  it("2560 wide at the 1.2 step: ≈ 1.659 — A/A under Fit re-derives the zoom from the 2xl pair (640 + 560 × 1.2)", () => {
    expect(fitZoom(2560, 1.2)).toBeCloseTo(2176 / 1312, 4);
  });

  it("1440 wide (xl band, 1000px cap) at 1x: ≈ 1.224", () => {
    expect(fitZoom(1440, 1)).toBeCloseTo(1.224, 3);
  });

  it("1300 wide (xl band) at 1x: ≈ 1.105", () => {
    expect(fitZoom(1300, 1)).toBeCloseTo(1.105, 3);
  });

  it("below xl (1200 wide) Fit is inert: exactly 1", () => {
    expect(fitZoom(1200, 1)).toBe(1);
  });

  it("clamps to the 2.5 ceiling on an ultra-wide viewport", () => {
    // 0.85*5000/1200 ≈ 3.54, past the ceiling.
    expect(fitZoom(5000, 1)).toBe(2.5);
  });

  it("never shrinks below 1x: a page already wider than 85% of the viewport stays at 1", () => {
    // 2xl band, but the scaled page (640 + 560 × 1.6 = 1536) already exceeds 0.85 × 1600 = 1360.
    expect(fitZoom(1600, 1.6)).toBe(1);
  });
});

// The formula and the CSS must agree on the caps: page-container.tsx's class
// strings carry the literals Tailwind scans, spread.ts exports the numbers
// fitZoom uses. Pin them to each other so neither can drift alone.
describe("fit caps match page-container's class strings", () => {
  it("1000px at xl and 1200px at 2xl appear verbatim in the container's calc pair", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/ui/page-container.tsx"),
      "utf8",
    );
    const { XL_CAP_PX, TWO_XL_PANEL_PX, TWO_XL_COLUMN_PX, TWO_XL_CAP_PX } = await import(
      "@/components/reader/spread"
    );
    expect(src).toContain(`calc(${XL_CAP_PX}px*var(--reading-scale,1))`);
    expect(src).toContain(`calc(${TWO_XL_PANEL_PX}px+${TWO_XL_COLUMN_PX}px*var(--reading-scale,1))`);
    expect(TWO_XL_PANEL_PX + TWO_XL_COLUMN_PX).toBe(TWO_XL_CAP_PX);
  });
});
