import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { placeCard } from "./explain-box";
import { DOCK_BOTTOM_PX, DOCK_GAP_PX, DOCK_MIN_VIEWPORT_PX, DOCK_MIN_VISIBLE_PX, DOCK_RESERVE_PX, DOCK_TOP_PX, DOCK_VAR, DOCK_WIDTH_PX, DOCK_WIDTH_VAR, reserveDock } from "./explain-dock";

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

  it("never stands so low that less than 160 px of it shows above the legend (P8-02)", () => {
    // The window is level with its paragraph (`placePanel`), and the paragraph may be anywhere on the page:
    // its top is held between the masthead's foot and this much above the legend.
    expect(DOCK_MIN_VISIBLE_PX).toBe(160);
    expect(DOCK_TOP_PX + DOCK_MIN_VISIBLE_PX + DOCK_BOTTOM_PX).toBe(236);
  });
});

// ── The page makes room (P7-15, R7 / Q4) ──────────────────────────────────

describe("what the page keeps clear while the dock is open", () => {
  it("is the dock and a 16 px gap: 376 px, named for the page's CSS and for the notes tab", () => {
    expect(DOCK_GAP_PX).toBe(16);
    expect(DOCK_RESERVE_PX).toBe(DOCK_WIDTH_PX + DOCK_GAP_PX);
    expect(DOCK_RESERVE_PX).toBe(376);
    expect(DOCK_VAR).toBe("--explain-dock");
    expect(DOCK_WIDTH_VAR).toBe("--explain-dock-width");
  });

  it("is written on the document's root as two custom properties, and taken off again by what it returns", () => {
    const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    const release = reserveDock({ style });

    expect(style.setProperty).toHaveBeenCalledWith("--explain-dock", "376px");
    expect(style.setProperty).toHaveBeenCalledWith("--explain-dock-width", "360px");
    expect(style.removeProperty).not.toHaveBeenCalled();
    release();
    expect(style.removeProperty).toHaveBeenCalledWith("--explain-dock");
    expect(style.removeProperty).toHaveBeenCalledWith("--explain-dock-width");
  });

  it("does nothing, and fails at nothing, where there is no root to write to", () => {
    for (const root of [null, undefined, {}, { style: undefined }]) {
      expect(() => reserveDock(root as never)()).not.toThrow();
    }
  });
});

describe("the page's width is kept at <main>, in CSS", () => {
  const css = read("src/app/globals.css");

  it("the shell's <main> is the class the rule names", () => {
    expect(read("src/app/layout.tsx")).toMatch(/<main className="[^"]*\bpeer-main-content\b[^"]*">/);
  });

  it("<main> pads its right side by the reserved width, none when nothing is open", () => {
    const rule = /\.peer-main-content\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

    expect(rule).toMatch(new RegExp(`padding-right:\\s*var\\(${DOCK_VAR},\\s*0px\\);`));
  });

  it("the custom property the rule reads is the one the dock writes", () => {
    expect(css).toContain(`var(${DOCK_VAR}, 0px)`);
    expect(read("src/components/notes/notes-button.tsx")).toContain(`var(${DOCK_WIDTH_VAR},0px)`);
  });
});
