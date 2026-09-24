import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampFigurePan, clampFigureSize, FigureLightbox } from "./figure-lightbox";

// Geometry regressions and SSR safety; pointer/focus/layout behavior is also
// checked in the browser, where transformed ancestors and real image sizes matter.

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
  it("fits a landscape image into the available viewport", () => {
    const size = clampFigureSize({ width: 300, height: 200 }, { width: 400, height: 300 });
    expect(size).toEqual({ width: 384, height: 256 });
  });

  it("fills the available space even for a small source image", () => {
    const size = clampFigureSize({ width: 50, height: 50 }, { width: 4000, height: 4000 });
    expect(size).toEqual({ width: 3840, height: 3840 });
  });

  it("shrinks an oversized figure to fit within 96vw/96vh, aspect preserved", () => {
    // Large sources shrink as needed; the aspect ratio stays intact.
    const size = clampFigureSize({ width: 2000, height: 1000 }, { width: 1000, height: 1000 });
    expect(size).toEqual({ width: 960, height: 480 });
  });

  it("returns a zero size for a broken image (zero natural size) rather than dividing by zero", () => {
    expect(clampFigureSize({ width: 0, height: 0 }, { width: 1000, height: 1000 })).toEqual({
      width: 0,
      height: 0,
    });
  });

  it("fits a tall figure into the space remaining around a caption", () => {
    const size = clampFigureSize({ width: 600, height: 1800 }, { width: 1200, height: 600 });
    expect(size).toEqual({ width: 192, height: 576 });
  });

  it("handles a viewport with no available image space", () => {
    expect(clampFigureSize({ width: 600, height: 400 }, { width: 320, height: 0 })).toEqual({ width: 0, height: 0 });
  });
});

describe("clampFigurePan", () => {
  it("allows movement within the zoomed image's bounds", () => {
    expect(clampFigurePan({ x: 120, y: -90 }, { width: 1600, height: 1200 }, { width: 800, height: 600 })).toEqual({ x: 120, y: -90 });
  });

  it("stops at each edge so the figure cannot be lost offscreen", () => {
    expect(clampFigurePan({ x: 2000, y: -2000 }, { width: 1600, height: 1200 }, { width: 800, height: 600 })).toEqual({ x: 400, y: -300 });
    expect(clampFigurePan({ x: -2000, y: 2000 }, { width: 1600, height: 1200 }, { width: 800, height: 600 })).toEqual({ x: -400, y: 300 });
  });

  it("keeps axes that already fit centered, including after a resize", () => {
    expect(clampFigurePan({ x: 80, y: 900 }, { width: 400, height: 1200 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 300 });
  });
});
