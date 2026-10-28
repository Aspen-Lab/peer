import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DOCK_BOTTOM_PX, legendHeightPx } from "./explain-dock";
import { PaneDivider, DIVIDER_FOOT_STYLE, type PaneDividerProps } from "./pane-divider";

// P12-89 rule 2 (ruling §1h.473; blind reader B3-r1, A P12-88 §7): the pane dividers' hit strips end at the key legend's top edge, so that no fixed overlay stands over any
// part of one.
//
// A scanned the strips down their whole length (a point every 20 px) and each scan missed at the foot: the key legend is a fixed bar, `--legend-h` x the page's Fit zoom tall
// (28 px at 1x; `legendHeightPx`), and the strip, as tall as the shell's row (`align-self: stretch`, the whole paper), ran under it. The strip is now sticky, as the left pane is:
// it begins where the pane does and is no taller than the window leaves between that and the legend's top edge.
//
// There is no DOM in this suite, so no rect can be read. What can be held is the arithmetic, on the markup itself: the strip's `top` and `max-height` are CSS expressions in
// its style, read the way the page reads them (`--page-zoom`, `--legend-h`, `rem`, `vh`; a length declared inside Fit's zoomed container is resolved locally and painted x zoom,
// as `left-pane.fit-top.test.ts` evaluates the pane's), and the legend's top is worked out apart from the strip, from `legendHeightPx` and from the stylesheet's `--legend-h`.
// A small model of sticky positioning puts the strip in the window at scroll 0, mid-page and at the foot of the page. Measured in a real browser too (the real markup and
// stylesheet, Chromium, a static page, scrolled): see the checkpoint.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");
const REM_PX = 16;
const LEGEND_PX = Number(/--legend-h:\s*(\d+(?:\.\d+)?)rem;/.exec(CSS)?.[1]) * REM_PX;

const target = { current: null } as RefObject<HTMLElement | null>;
const props: PaneDividerProps = {
  pane: "margin",
  value: 360,
  room: { viewport: 1440, other: 320 },
  target,
  variable: "--margin-w",
  label: "Resize margin",
  controls: "reader-margin",
  onCommit: () => {},
};
const render = (over: Partial<PaneDividerProps> = {}) => renderToStaticMarkup(createElement(PaneDivider, { ...props, ...over }));
const leftProps: Partial<PaneDividerProps> = { pane: "left", value: 320, room: { viewport: 1440, other: 360 }, variable: "--left-pane-w", label: "Resize left panel", controls: "reader-left-pane" };

/** The declarations of the element's `style` attribute. */
function declarations(html: string): Record<string, string> {
  const style = /style="([^"]*)"/.exec(html)?.[1];
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const part of style.replace(/&amp;/g, "&").split(";")) {
    const at = part.indexOf(":");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

/** An expression of numbers, + - * / and parentheses. */
function arithmetic(text: string): number {
  const tokens = text.match(/\d*\.?\d+|[()+\-*/]/g) ?? [];
  expect(tokens.join(""), `${text} is plain arithmetic`).toBe(text.replace(/\s+/g, ""));
  let at = 0;
  const factor = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const inner = sum();
      at += 1;
      return inner;
    }
    return token === "-" ? -factor() : Number(token);
  };
  const product = (): number => {
    let value = factor();
    while (tokens[at] === "*" || tokens[at] === "/") value = tokens[at++] === "*" ? value * factor() : value / factor();
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[at] === "+" || tokens[at] === "-") value = tokens[at++] === "+" ? value + product() : value - product();
    return value;
  };
  return sum();
}

/** calc() over rem / px / vh, `var(--page-zoom, 1)` and `var(--legend-h)`: the local px the zoomed container resolves. */
function local(expression: string, zoom: number, vh: number): number {
  const text = expression
    .replace(/var\(--page-zoom,\s*1\)/g, String(zoom))
    .replace(/var\(--legend-h\)/g, String(LEGEND_PX))
    .replace(/(\d*\.?\d+)rem/g, (_, n) => String(Number(n) * REM_PX))
    .replace(/(\d*\.?\d+)vh/g, (_, n) => String((Number(n) * vh) / 100))
    .replace(/(\d*\.?\d+)px/g, "$1")
    .replace(/calc\(/g, "(");
  return arithmetic(text);
}

interface Strip {
  top: number;
  bottom: number;
}

/**
 * Where the strip stands in the window (painted px) with the page scrolled by `scrollY`, for a shell row from `rowTop` to `rowBottom` in the document (painted px; the
 * row begins at the masthead's 48 px and the article's 1rem of top padding, painted x zoom). A strip without `position: sticky` is the row; a sticky one stands at its `top`
 * once the row has scrolled past it, is no taller than its `max-height` or the row, and is carried up by the row's end.
 */
function stripAt(html: string, zoom: number, vh: number, rowTop: number, rowBottom: number, scrollY: number): Strip {
  const style = declarations(html);
  const rowAt = { top: rowTop - scrollY, bottom: rowBottom - scrollY };
  if (style.position !== "sticky") return rowAt;
  expect(style["align-self"], "a sticky strip is placed at the start of its row").toBe("start");
  expect(style.height, "and is no taller than its row").toBe("100%");
  const stuck = local(style.top, zoom, vh) * zoom;
  const tall = Math.min(rowBottom - rowTop, local(style["max-height"], zoom, vh) * zoom);
  const top = Math.min(Math.max(rowAt.top, stuck), rowAt.bottom - tall);
  return { top, bottom: top + tall };
}

const WINDOWS = [
  [1440, 900],
  [1024, 576],
  [853, 480],
] as const;
const ZOOMS = [1, 1.142, 1.378, 1.838, 2.5];
/** The row's top at scroll 0, painted: the masthead (unzoomed) and the article's top padding (zoomed). */
const rowTopAt = (zoom: number) => 48 + 16 * zoom;
const DOC_PX = 6000;

describe("the strip's markup (P12-89 rule 2)", () => {
  it("both dividers carry the foot style: sticky, at the start of the row, as tall as the row up to the legend's top", () => {
    for (const html of [render(), render(leftProps)]) {
      expect(declarations(html)).toEqual({
        position: "sticky",
        "align-self": "start",
        top: "calc(3rem / var(--page-zoom, 1) + 1rem)",
        height: "100%",
        "max-height": "calc((100vh - 3rem) / var(--page-zoom, 1) - var(--legend-h) - 1rem)",
      });
    }
    expect(DIVIDER_FOOT_STYLE.position).toBe("sticky");
  });

  it("nothing else about the strip changed: the same element, class, role, values and no children", () => {
    const html = render();

    expect(html).toContain('class="reader-divider"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="360"');
    expect(html).toContain('data-reader-divider="margin"');
    expect(html).toMatch(/<div [^>]*><\/div>$/);
  });

  it("the legend it ends at is the stylesheet's: `--legend-h` on the root, which the legend's own height is (inside the same zoomed page)", () => {
    const legend = read("src/components/reader/key-legend.tsx");

    expect(LEGEND_PX).toBe(DOCK_BOTTOM_PX);
    expect(legend).toContain("h-[var(--legend-h)]");
    expect(legend).toMatch(/fixed inset-x-0 bottom-0/);
    expect(DIVIDER_FOOT_STYLE.maxHeight).toContain("var(--legend-h)");
  });

  it("begins where the pane does, and where the separator's keyboard focus is aligned: the stylesheet's own sticky top, so it never slides and focus moves nothing", () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (selector: string) => {
      const start = stripped.indexOf(`\n${selector} {`);
      expect(start, `${selector} is a rule of the stylesheet`).toBeGreaterThanOrEqual(0);
      return stripped.slice(start, stripped.indexOf("\n}", start));
    };
    const declaration = (body: string, property: string) => new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim();

    expect(DIVIDER_FOOT_STYLE.top).toBe(declaration(rule(".reader-left"), "top"));
    expect(DIVIDER_FOOT_STYLE.top).toBe(declaration(rule(".reader-divider"), "scroll-margin-top"));
    // and the hit area, cursor and width are the stylesheet's, as they were
    expect(declaration(rule(".reader-divider"), "cursor")).toBe("col-resize");
    expect(declaration(rule(".reader-divider,\n.reader-divider-rest"), "width")).toBe("12px");
  });
});

describe("the strip ends at the key legend's top edge — never under it (P12-89 rule 2)", () => {
  for (const [width, height] of WINDOWS) {
    for (const zoom of ZOOMS) {
      for (const pane of ["margin", "left"] as const) {
        it(`${width} x ${height}, Fit zoom ${zoom}, ${pane} divider: at scroll 0, mid-page and at the page's foot the strip's bottom is the legend's top or above it`, () => {
          const html = render(pane === "left" ? leftProps : {});
          // the legend's top, worked out apart from the strip: the window's height less the legend's height at the page's zoom
          const legendTop = height - legendHeightPx(zoom);
          const rowTop = rowTopAt(zoom);
          const rowBottom = rowTop + DOC_PX;
          // the page's foot: the document ends 4rem (painted x zoom) under the row (`md:pb-16`), so the last scroll puts the row's end 4rem x zoom above the window's foot
          const last = rowBottom + 64 * zoom - height;

          for (const scrollY of [0, 1, 17, 500, 2500, last - 1, last]) {
            const strip = stripAt(html, zoom, height, rowTop, rowBottom, scrollY);
            // (at the page's foot the row's end carries the strip up, partly under the masthead: that is the row's end, not the legend's)
            expect(strip.bottom, `scroll ${scrollY}`).toBeLessThanOrEqual(legendTop + 1e-6);
            expect(strip.bottom, `scroll ${scrollY}`).toBeGreaterThan(strip.top);
          }
          // and while the row runs on, it reaches the legend's top: not a px short (the strip is the whole of the room, not a stub)
          expect(stripAt(html, zoom, height, rowTop, rowBottom, 500).bottom).toBeCloseTo(legendTop, 6);
          expect(stripAt(html, zoom, height, rowTop, rowBottom, 0).bottom).toBeCloseTo(legendTop, 6);
        });
      }
    }
  }

  it("BEFORE (the strip as the row): it ran under the legend by the legend's own height at every scroll but the last — the check can fail, and it did", () => {
    const before = render().replace(/ style="[^"]*"/, "");

    for (const [width, height] of WINDOWS) {
      for (const zoom of ZOOMS) {
        const legendTop = height - legendHeightPx(zoom);
        const rowTop = rowTopAt(zoom);
        const rowBottom = rowTop + DOC_PX;
        for (const scrollY of [0, 500, 2500]) {
          const strip = stripAt(before, zoom, height, rowTop, rowBottom, scrollY);
          // the part of the strip in the window that is under the legend: the window's foot less the legend's top
          const under = Math.max(0, Math.min(strip.bottom, height) - legendTop);

          expect(under, `${width} x ${height}, zoom ${zoom}, scroll ${scrollY}`).toBeCloseTo(legendHeightPx(zoom), 6);
          expect(under).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the measure: the legend's height is 28 px at 1x and 28 x zoom under Fit, and the strip's room is the window less the masthead, the article's padding and that", () => {
    for (const [, height] of WINDOWS) {
      for (const zoom of ZOOMS) {
        const room = local(DIVIDER_FOOT_STYLE.maxHeight as string, zoom, height) * zoom;

        expect(legendHeightPx(zoom)).toBeCloseTo(LEGEND_PX * zoom, 9);
        expect(room, `${height} high, zoom ${zoom}`).toBeCloseTo(height - 48 - 16 * zoom - LEGEND_PX * zoom, 6);
        expect(rowTopAt(zoom) + room).toBeCloseTo(height - legendHeightPx(zoom), 6);
      }
    }
  });

  it("a short paper: the strip is no taller than its row, and ends above the legend with room to spare", () => {
    for (const [, height] of WINDOWS) {
      const html = render();
      const rowTop = rowTopAt(1);
      const strip = stripAt(html, 1, height, rowTop, rowTop + 300, 0);

      expect(strip.bottom - strip.top).toBe(300);
      expect(strip.bottom).toBeLessThan(height - LEGEND_PX);
    }
  });

  it("the rail's hairline (the left boundary with nothing to grab) is not a strip and is left as it was", () => {
    const shell = read("src/components/reader/reader-shell.tsx");

    expect(shell).toContain('<div className="reader-divider-rest" aria-hidden="true" />');
  });
});
