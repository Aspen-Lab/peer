import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { placeCard } from "./explain-box";
import { DOCK_BOTTOM_PX, DOCK_GAP_PX, DOCK_MIN_VIEWPORT_PX, DOCK_MIN_VISIBLE_PX, DOCK_RESERVE_PX, DOCK_THREAD_FLOOR_PX, DOCK_TOP_PX, DOCK_VAR, DOCK_WIDTH_PX, DOCK_WIDTH_VAR, emptyDockStands, reserveDock } from "./explain-dock";

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

  it("an empty window never stands so low that less than 160 px of it shows above the legend (P8-02; re-aimed, P9-17: the floor of the window with nothing in it)", () => {
    // The window is level with its paragraph (`placePanel`), and the paragraph may be anywhere on the page:
    // its top is held between the masthead's foot and this much above the legend. The empty window is about 125 px
    // tall, so this default floor leaves it all of its height; a window that holds a passage has its own (below).
    expect(DOCK_MIN_VISIBLE_PX).toBe(160);
    expect(DOCK_TOP_PX + DOCK_MIN_VISIBLE_PX + DOCK_BOTTOM_PX).toBe(236);
  });

  it("a window that holds a passage never stands so low that its header, its controls and two lines of the answer do not show: 360 px (P9-17, ruling §1h.56)", () => {
    // A P9-R2 F1, measured: the sticky header is 140 px (a two-line quote and the "Explain this?" control), the
    // sticky controls row 101 px; at the old 160 px floor they overlapped by 38 to 83 px and the answer showed
    // nowhere. The second line of the answer ends 330 px below the window's top, 344 with the control at the 44 px touch
    // size (P9-17's browser check; the 300 px first guessed leaves none of it in view). The floor is a property of what the
    // window holds, not one number for every state.
    expect(DOCK_THREAD_FLOOR_PX).toBe(360);
    expect(DOCK_THREAD_FLOOR_PX).toBeGreaterThan(DOCK_MIN_VISIBLE_PX);
    expect(DOCK_TOP_PX + DOCK_THREAD_FLOOR_PX + DOCK_BOTTOM_PX).toBe(436);
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

// ── The window before the first Explain (P8-06, ruling §1h.45) ─────────────────────────────

describe("when the window stands empty, before any passage is explained (P8-06)", () => {
  const stands = { canAsk: true, hasBody: true, hidden: false, width: 1280 };

  it("stands for a reader with a key, on a paper with a readable body, from the dock's width, until it is hidden", () => {
    expect(emptyDockStands(stands)).toBe(true);
    expect(emptyDockStands({ ...stands, width: DOCK_MIN_VIEWPORT_PX })).toBe(true);
    expect(emptyDockStands({ ...stands, width: 1920 })).toBe(true);
  });

  it("does not stand without a key: a permanent panel would be a locked block (§1b)", () => {
    expect(emptyDockStands({ ...stands, canAsk: false })).toBe(false);
  });

  it("does not stand on a paper with no readable body (no Paper digestion tab to select in)", () => {
    expect(emptyDockStands({ ...stands, hasBody: false })).toBe(false);
  });

  it("does not stand once the reader has hidden it (Escape or Close) — for the rest of the visit", () => {
    expect(emptyDockStands({ ...stands, hidden: true })).toBe(false);
  });

  it("does not stand below 1024 px: the card (640 to 1023) and the sheet open on the reader's press only", () => {
    for (const width of [DOCK_MIN_VIEWPORT_PX - 1, 800, 640, 390]) expect(emptyDockStands({ ...stands, width }), `${width} px`).toBe(false);
  });
});
