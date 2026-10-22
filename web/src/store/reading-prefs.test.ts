import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PLAIN_DEFAULT_LEVEL, PLAIN_LEVELS } from "@/lib/papers/plain-levels";
import { useReaderPanesStore } from "@/store/reader-panes";
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
// 7-07 (Ruling 21): Fit is computed from the layout's own constants, never measured off the zoomed
// element, so an A/A change under Fit recomputes at once and a resize while fitted can never read a
// container-clamped width.
//
// P11-10 (B P11-01 §2.7; ruling §1h.113 (a), D8) RE-AIM — every test of this describe, named:
//   "2560 wide at 1x"            was 2176 / 1184 (the 2xl cap)        now 2176 / 1344 (the three-pane reference)
//   "2560 wide at the 1.2 step"  was 2176 / 1320 (504 + 680 x 1.2)    now 2176 / 1472 (320 + 640 x 1.2 + 360 + 24)
//   "1440 wide ... at 1x"        was 1224 / 1072 = 1.142              now 1 (the panes already fill a 1440 window)
//   "1300 wide ... at 1x"        was 1105 / 1072 = 1.031              now 1
//   "below xl (1200 wide)"       was inert below 1280                 now 1 below 1024 (1000); the formula alone is 1 below 1,582
//   "clamps to the 2.5 ceiling"  unchanged in kind (0.85 x 5000 / 1344 = 3.16)
//   "never shrinks below 1x"     the scaled reference (320 + 1024 + 384 = 1728) exceeds 0.85 x 1600
// The reference width is the shell's default panes at this A/A step: left 320, the paper's column 640 x the step, margin 360 and the
// two dividers 24 = 1,344 at 1x, in place of the retired two-column spread's caps (1072 / 1184). A pane's width never enters.
describe("fitZoom", () => {
  it("the reference is the three-pane defaults at 1x: 320 + 640 + 360 + 24 = 1,344, so Fit starts to zoom above 1,344 / 0.85 = 1,581 px", () => {
    expect(fitZoom(1500, 1)).toBe(1);
    expect(fitZoom(1581, 1)).toBe(1);
    expect(fitZoom(1582, 1)).toBeGreaterThan(1);
    expect(fitZoom(1600, 1)).toBeCloseTo(1360 / 1344, 4);
  });

  it("1440 wide at 1x: exactly 1 — the panes already fill the window", () => {
    expect(fitZoom(1440, 1)).toBe(1);
  });

  it("1920 wide at 1x: ≈ 1.214 (0.85 × 1920 / 1344)", () => {
    expect(fitZoom(1920, 1)).toBeCloseTo(1632 / 1344, 4);
    expect(fitZoom(1920, 1)).toBeCloseTo(1.21, 2);
  });

  it("2560 wide at 1x: ≈ 1.619 (0.85 × 2560 / 1344)", () => {
    expect(fitZoom(2560, 1)).toBeCloseTo(2176 / 1344, 4);
    expect(fitZoom(2560, 1)).toBeCloseTo(1.62, 2);
  });

  it("2560 wide at the 1.2 step: ≈ 1.478 — A/A under Fit re-derives the zoom from the reference (320 + 640 × 1.2 + 360 + 24)", () => {
    expect(fitZoom(2560, 1.2)).toBeCloseTo(2176 / 1472, 4);
  });

  it("1300 wide at 1x: exactly 1", () => {
    expect(fitZoom(1300, 1)).toBe(1);
  });

  it("below the shell's 1024 css px Fit is inert: exactly 1", () => {
    expect(fitZoom(1000, 1)).toBe(1);
    expect(fitZoom(1023, 1)).toBe(1);
    expect(fitZoom(400, 1)).toBe(1);
  });

  it("clamps to the 2.5 ceiling on an ultra-wide viewport", () => {
    // 0.85*5000/1344 ≈ 3.16, past the ceiling.
    expect(fitZoom(5000, 1)).toBe(2.5);
  });

  it("never shrinks below 1x: a page already wider than 85% of the viewport stays at 1", () => {
    // The scaled reference (320 + 640 × 1.6 + 360 + 24 = 1728) already exceeds 0.85 × 1600 = 1360.
    expect(fitZoom(1600, 1.6)).toBe(1);
  });

  it("never reads a pane's width: a divider drag cannot change it (B P11-01 §6 item 3)", () => {
    const before = [fitZoom(1920, 1), fitZoom(2560, 1.2)];
    useReaderPanesStore.setState({ leftPinned: true, leftWidth: 480, marginWidth: 560 });
    expect([fitZoom(1920, 1), fitZoom(2560, 1.2)]).toEqual(before);
    useReaderPanesStore.setState({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined });
  });

  it("is the reference of pane-layout's defaults, not a number of its own", () => {
    const source = readFileSync(resolve(process.cwd(), "src/store/reading-prefs.ts"), "utf8");
    expect(source).toContain('from "@/components/reader/pane-layout"');
    expect(source).not.toMatch(/XL_CAP_PX|TWO_XL_/);
  });
});

// The spread variant's caps and the CSS must agree: page-container.tsx's class
// strings carry the literals Tailwind scans, spread.ts exports the numbers.
// Pin them to each other so neither can drift alone. (P11-10: `fitZoom` no longer
// reads these — the loading and error states' `spread` width still does; the test
// is unchanged, its comment re-aimed.)
describe("fit caps match page-container's class strings", () => {
  it("1072px at xl and 1184px at 2xl appear verbatim in the container's calc pair", async () => {
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

// P4-01 (blueprint §3.6; rulings §1h.12 (h)): the reader's level for "Say it plainly" is
// remembered here, with the other reading preferences, and is `undergrad` until they choose.
describe("reading prefs — the plain level (P4-01)", () => {
  beforeEach(() => {
    useReadingPrefsStore.setState({ plainLevel: "undergrad" });
  });

  it("starts at undergrad", () => {
    expect(useReadingPrefsStore.getState().plainLevel).toBe("undergrad");
    expect(PLAIN_DEFAULT_LEVEL).toBe("undergrad");
  });

  it("remembers each of the three levels the reader picks", () => {
    for (const level of PLAIN_LEVELS) {
      useReadingPrefsStore.getState().setPlainLevel(level);
      expect(useReadingPrefsStore.getState().plainLevel).toBe(level);
    }
  });

  it("takes nothing that is not one of the three: the level stays as it was", () => {
    useReadingPrefsStore.getState().setPlainLevel("graduate");
    for (const other of ["phd", "", "Undergrad", null, undefined, 2, {}]) {
      useReadingPrefsStore.getState().setPlainLevel(other as never);
      expect(useReadingPrefsStore.getState().plainLevel).toBe("graduate");
    }
  });

  it("leaves the scale and Fit alone, and they leave it alone", () => {
    useReadingPrefsStore.setState({ scaleIndex: 4, fit: true });
    useReadingPrefsStore.getState().setPlainLevel("highschool");
    useReadingPrefsStore.getState().resetScale();
    useReadingPrefsStore.getState().setFit(false);

    expect(useReadingPrefsStore.getState().plainLevel).toBe("highschool");
    expect(useReadingPrefsStore.getState().scaleIndex).toBe(2);
    useReadingPrefsStore.setState({ scaleIndex: 2, fit: false });
  });

  // No version bump: a blob persisted before the level existed has no `plainLevel` key, and
  // zustand's persist merges it over the initial state, so it reads as the default — exactly as
  // a reader with no choice yet. The store's own comment says so, and the version stays 1.
  it("is not a new version of the persisted blob: an older one merges to the default", () => {
    const source = readFileSync(resolve(process.cwd(), "src/store/reading-prefs.ts"), "utf8");

    expect(source).toContain('name: "peer-reading-prefs",\n      version: 1,');
    expect(source).toMatch(/plainLevel[^\n]*\n[^]*merges it over the initial state/);
  });
});
