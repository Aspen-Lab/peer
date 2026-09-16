import { beforeEach, describe, expect, it } from "vitest";
import { READING_SCALE_STEPS, useReadingPrefsStore } from "@/store/reading-prefs";

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
    const store = useReadingPrefsStore.getState();
    store.increaseScale();
    store.increaseScale();
    store.increaseScale();
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

  it("the ladder is exactly the six steps the spec names, in order", () => {
    expect(READING_SCALE_STEPS).toEqual([0.85, 0.925, 1, 1.1, 1.2, 1.32]);
  });
});
