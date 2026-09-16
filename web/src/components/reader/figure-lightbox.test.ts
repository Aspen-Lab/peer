import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampFigureSize, FigureLightbox } from "./figure-lightbox";

// S12 (6-08): this repo has no @testing-library/react and no test anywhere
// simulates a click/keydown (confirmed by B's investigation) — so the
// ceiling here is the same as every other component in this codebase: a
// renderToStaticMarkup smoke test of the default (closed) render, plus
// direct unit tests on the one pure function the interactive behaviour
// depends on. Open/close/focus/keyboard-guard behaviour is exercised by the
// manager's own browser click-through, per the round-6 text's assignment.

describe("FigureLightbox — default (closed) render", () => {
  const html = renderToStaticMarkup(
    createElement(FigureLightbox, {
      src: "https://example.com/figure.png",
      alt: "Figure 1",
      caption: "A caption",
    }),
  );

  it("wraps the thumbnail in a button with the enlarge label and zoom-in cursor", () => {
    expect(html).toContain('aria-label="Enlarge figure"');
    expect(html).toContain("cursor-zoom-in");
  });

  it("renders no dialog until opened", () => {
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain("Close figure");
  });

  it("passes the thumbnail's src/alt straight through", () => {
    expect(html).toContain('src="https://example.com/figure.png"');
    expect(html).toContain('alt="Figure 1"');
  });
});

describe("clampFigureSize", () => {
  it("scales up toward the viewport's own ceiling when that binds tighter than the 2x-natural cap", () => {
    // naturalCeiling {600,400}; viewportCeiling {384,288} — viewport wins on both axes.
    const size = clampFigureSize({ width: 300, height: 200 }, { width: 400, height: 300 });
    expect(size).toEqual({ width: 384, height: 256 });
  });

  it("caps at 2x the natural size when the viewport has room to spare", () => {
    // naturalCeiling {100,100}; viewportCeiling {3840,3840} — the 2x cap wins.
    const size = clampFigureSize({ width: 50, height: 50 }, { width: 4000, height: 4000 });
    expect(size).toEqual({ width: 100, height: 100 });
  });

  it("shrinks an oversized figure to fit within 96vw/96vh, aspect preserved", () => {
    // naturalCeiling {4000,2000}; viewportCeiling {960,960} — viewport wins, and the
    // resulting scale (0.48) is below 1x: the figure is shown smaller than its own
    // natural size, the "contain" half of never overflowing the screen.
    const size = clampFigureSize({ width: 2000, height: 1000 }, { width: 1000, height: 1000 });
    expect(size).toEqual({ width: 960, height: 480 });
  });

  it("returns a zero size for a broken image (zero natural size) rather than dividing by zero", () => {
    expect(clampFigureSize({ width: 0, height: 0 }, { width: 1000, height: 1000 })).toEqual({
      width: 0,
      height: 0,
    });
  });
});
