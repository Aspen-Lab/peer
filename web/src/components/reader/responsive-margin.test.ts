import { describe, expect, it } from "vitest";
import { fitPanes, railMinimumWidth, readingCentreMinimum } from "./pane-layout";
import { bottomMarginRectOf } from "@/lib/reader/margin";

describe("P12-07 comfortable reading before extra columns", () => {
  it("reserves 476px of actual text plus both 12px insets at 1x", () => {
    expect(readingCentreMinimum(1)).toBe(500);
    expect(railMinimumWidth(1)).toBe(852);
    for (const scale of [.85, .925, 1, 1.1, 1.2, 1.32, 1.45, 1.6]) {
      const minimum = readingCentreMinimum(scale);
      const fit = fitPanes({ viewport: railMinimumWidth(scale), centreMinimum: minimum });
      expect(fit.centre - 24).toBeGreaterThanOrEqual(476 * scale);
      expect(fit.pinned).toBe(false);
      expect(fit.forced).toBe(true);
    }
  });
  it("temporarily forces a rail, then restores the saved pane choices", () => {
    const saved = { left: 360, margin: 400, leftPinned: true, centreMinimum: 500 };
    expect(fitPanes({ ...saved, viewport: 853 })).toMatchObject({ pinned: false, forced: true, margin: 281, centre: 500 });
    expect(fitPanes({ ...saved, viewport: 1440 })).toMatchObject({ pinned: true, forced: false, left: 360, margin: 400 });
    expect(saved).toEqual({ left: 360, margin: 400, leftPinned: true, centreMinimum: 500 });
  });
});

describe("P12-09 complementary bottom margin", () => {
  it("uses a nonmodal full usable band above the legend, capped at 420px / 55%", () => {
    const phone = bottomMarginRectOf(390, 844, 1);
    expect(phone).toMatchObject({ presentation: "bottom", left: 8, width: 374, bottom: 796 });
    expect(phone.bottom - phone.top).toBeLessThanOrEqual(420);
    const short = bottomMarginRectOf(853, 480, 1);
    expect(short.bottom - short.top).toBeCloseTo((432 - 48) * .55);
    expect(short.top).toBeGreaterThan(48);
  });
});
