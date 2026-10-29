import { expect, it } from "vitest";
import { markBox, markLine, stripStanding } from "./highlight-strip-host";
const rect = (top: number, bottom = top + 20) => ({ left: 30, right: 140, top, bottom });
const doc = (boxes: ReturnType<typeof rect>[]) => ({ querySelector: () => null, querySelectorAll: () => boxes.map((r) => ({ getClientRects: () => [r] })) }) as unknown as Document;
it("uses a later visible segment, not the first offscreen piece, and bounds all pieces", () => {
  const d = doc([rect(-200), rect(300), rect(1300)]);
  expect(markLine(d, "group", { top: 48, bottom: 900 })).toEqual(rect(300));
  expect(markBox(d, "group")).toEqual({ left: 30, right: 140, top: -200, bottom: 1320 });
});
it("does not call an empty gap between offscreen segments visible", () => {
  expect(markLine(doc([rect(-200), rect(1300)]), "group", { top: 48, bottom: 900 })).toBeNull();
});
it("bottom docking keeps a paper mark above the dock eligible and clears its controls", () => {
  const margin = { left: 0, width: 390, top: 500, bottom: 780, presentation: "bottom" as const };
  const got = stripStanding({ mark: rect(100), viewport: { width: 390, height: 844 }, margin, controls: [{ left: 0, right: 390, top: 500, bottom: 540 }] });
  expect(got).not.toBeNull();
  expect(got!.top).toBeGreaterThanOrEqual(540);
  expect(stripStanding({ mark: rect(-100), viewport: { width: 390, height: 844 }, margin })).toBeNull();
});
