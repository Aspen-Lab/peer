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
// search — Fit is continuous now, a multiplier straight off the viewport
// and the page's own live (pre-Fit-zoom) width, not a step index.
describe("fitZoom", () => {
  it("clamps to 1 (no zoom) below the 1x floor", () => {
    // 0.85*1000/1000 = 0.85, below the floor — a page already wider than
    // 85% of the viewport should never shrink under Fit.
    expect(fitZoom(1000, 1000)).toBe(1);
  });

  it("clamps to the 2.5 ceiling on a very narrow page", () => {
    // 0.85*3000/100 = 25.5, far past the ceiling.
    expect(fitZoom(3000, 100)).toBe(2.5);
  });

  it("a mid-range value fills ~85% of the viewport", () => {
    // 0.85*2560/1200 ≈ 1.8133..., matching the ruling's own worked example
    // (2560px, a 1200px 1x page, "≈ 1.8x").
    expect(fitZoom(2560, 1200)).toBeCloseTo(1.8133, 4);
  });

  it("falls back to 1 (book layout), never Infinity or the ceiling, when the page width is not yet known", () => {
    expect(fitZoom(2560, 0)).toBe(1);
    expect(fitZoom(2560, -1)).toBe(1);
  });
});
