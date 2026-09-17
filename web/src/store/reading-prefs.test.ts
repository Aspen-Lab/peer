import { beforeEach, describe, expect, it } from "vitest";
import { fitScaleIndex, READING_SCALE_STEPS, useReadingPrefsStore } from "@/store/reading-prefs";

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

// S21 (round 7, item 7-03): "Fit to screen". `fit` never gets written back
// into `scaleIndex` — the displayed scale is resolved at read time by
// `reader-layout.tsx`'s `useResolvedReadingScale`, not tested here (it
// needs a DOM/window this Node-environment test file doesn't have); this
// file covers the store's own contract: `fit` starts off, manual zoom
// clears it, and `resetScale` clears both.
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

  it("increaseScale clears fit — manual zoom cancels Fit", () => {
    useReadingPrefsStore.getState().setFit(true);
    useReadingPrefsStore.getState().increaseScale();
    expect(useReadingPrefsStore.getState().fit).toBe(false);
  });

  it("decreaseScale clears fit — manual zoom cancels Fit", () => {
    useReadingPrefsStore.getState().setFit(true);
    useReadingPrefsStore.getState().decreaseScale();
    expect(useReadingPrefsStore.getState().fit).toBe(false);
  });

  it("resetScale returns to the default step and clears fit", () => {
    const store = useReadingPrefsStore.getState();
    store.increaseScale();
    store.increaseScale();
    store.setFit(true);
    store.resetScale();
    const state = useReadingPrefsStore.getState();
    expect(state.scaleIndex).toBe(2);
    expect(state.fit).toBe(false);
  });
});

describe("fitScaleIndex", () => {
  // Base 2xl numbers from spread.ts: a 560px column, a 96px gap. A generous
  // panel (300px) so the arithmetic below is easy to check by hand.
  const PANEL = 300;
  const GAP = 96;
  const BASE = 560;

  it("a wide viewport picks a high step", () => {
    // Needs panel(300) + gap(96) + 560*1.6(896) = 1292 to fit within 85% of
    // the viewport — 1292 / 0.85 ≈ 1520, so 1600px clears it.
    expect(fitScaleIndex(1600, PANEL, GAP, BASE)).toBe(READING_SCALE_STEPS.length - 1);
  });

  it("a narrow viewport picks a low, non-floor step", () => {
    // 0.85*1100 = 935. Page widths (300+96+560*step): index 1 (0.925x) is
    // 914, which fits; index 2 (1x) is 956, which does not — so this lands
    // on exactly 1, neither the top nor the 0 floor.
    expect(fitScaleIndex(1100, PANEL, GAP, BASE)).toBe(1);
  });

  it("the boundary case at exactly 0.85x of the viewport", () => {
    // Numbers chosen so both sides land on an exact float, not a division
    // round-trip that could land a hair off either way: with panel 500,
    // gap 100, base 1000, index 3's (1.1x) page width is exactly 1700, and
    // 0.85*2000 is exactly 1700 too. A page exactly at the target should
    // still fit — the guide's own condition is `<=`, not `<`.
    expect(fitScaleIndex(2000, 500, 100, 1000)).toBe(3);
  });

  it("floors to 0 when even the smallest step does not fit", () => {
    expect(fitScaleIndex(200, PANEL, GAP, BASE)).toBe(0);
  });
});
