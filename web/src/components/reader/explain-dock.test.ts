import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { placeCard } from "./explain-box";
import { DOCK_BOTTOM_PX, DOCK_MIN_VIEWPORT_PX, DOCK_TOP_PX, DOCK_WIDTH_PX } from "./explain-dock";

// P7-15 (the owner's R7): the dock's rectangle is built from three numbers that the shell owns —
// the masthead's height above it, the foot legend's below it, and the width of the card it
// replaces. They are copied here from where they are drawn; these pins hold each copy against its
// source, so a taller masthead or legend cannot leave the dock under it or over it.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const REM_PX = 16;
const SPACING_UNIT_PX = 4;

describe("the dock's rectangle against the shell that frames it", () => {
  it("its top is the sticky masthead's height: `h-12` on the masthead's own bar", () => {
    const masthead = read("src/components/shell/masthead.tsx");
    const bar = /className="[^"]*\bsticky top-0\b[^"]*\bh-(\d+)\b[^"]*"/.exec(masthead);

    expect(bar).not.toBeNull();
    expect(Number(bar![1]) * SPACING_UNIT_PX).toBe(DOCK_TOP_PX);
  });

  it("its bottom stands above the foot legend: `--legend-h` is 1.75rem and the legend is that tall", () => {
    const css = read("src/app/globals.css");
    const legend = read("src/components/reader/key-legend.tsx");
    const declared = /--legend-h:\s*([\d.]+)rem;/.exec(css);

    expect(declared).not.toBeNull();
    expect(Number(declared![1]) * REM_PX).toBe(DOCK_BOTTOM_PX);
    expect(legend).toContain("h-[var(--legend-h)]");
  });

  it("is as wide as P3-02's card, which it replaces from 1024 px (Tailwind's `lg`)", () => {
    expect(placeCard({ left: 300, top: 400, right: 420, bottom: 420 }, { width: 1000, height: 900 }).width).toBe(DOCK_WIDTH_PX);
    expect(DOCK_WIDTH_PX).toBe(360);
    expect(DOCK_MIN_VIEWPORT_PX).toBe(64 * REM_PX);
  });
});
