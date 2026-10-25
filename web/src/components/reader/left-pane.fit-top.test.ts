import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P11-36 (B P11-36; round 2 Theme A E3; BACKLOG-105): under Fit the page is painted through a CSS `zoom` on the paper's container, and the
// masthead is not inside it. Three things the pane's rules say in "local" lengths (declared in the zoomed container, painted x zoom) must
// then agree with each other in painted px, which a node test cannot lay out, so this file evaluates the stylesheet's own calc() strings:
//   1. the pane sticks where it stands at scroll 0: masthead (48 px, unzoomed) + the container's top padding (painted x zoom);
//   2. the peek's content starts where the pinned pane's does;
//   3. neither the peek nor the pinned pane reaches the foot legend, which is inside the zoomed container and so `legend-h` x zoom tall.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const MASTHEAD = read("src/components/shell/masthead.tsx");
const CONTAINER = read("src/components/ui/page-container.tsx");

/** One top-level rule's body: from `selector {` at the left margin to the closing brace at the left margin. */
const rule = (selector: string) => {
  const start = CSS.indexOf(`\n${selector} {`);
  expect(start, `${selector} is a rule of the stylesheet`).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf("\n}", start));
};
const declaration = (body: string, property: string) => {
  const hit = new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;]+);`).exec(body);
  return hit ? hit[1].trim() : null;
};

/** A length expression of numbers, + - * / and parentheses: the plain arithmetic left once the units and the variables are substituted. */
function arithmetic(text: string): number {
  const tokens = text.match(/\d*\.?\d+|[()+\-*/]/g) ?? [];
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

/** calc() over rem / px / vh, `var(--page-zoom, 1)` and `var(--legend-h)` -> local px (the number the zoomed container resolves). */
function local(expr: string, zoom: number, vh: number): number {
  const legend = Number(/--legend-h:\s*([\d.]+)rem/.exec(CSS)?.[1]) * 16;
  const text = expr
    .replace(/var\(--page-zoom,\s*1\)/g, String(zoom))
    .replace(/var\(--legend-h\)/g, String(legend))
    .replace(/calc\(/g, "(")
    .replace(/([\d.]+)rem/g, (_m, n) => String(Number(n) * 16))
    .replace(/([\d.]+)vh/g, (_m, n) => String((Number(n) * vh) / 100))
    .replace(/([\d.]+)px/g, "$1");
  expect(text, `only numbers and operators remain in ${expr}`).toMatch(/^[\d.\s+\-*/()]+$/);
  return arithmetic(text);
}
const painted = (expr: string | null, zoom: number, vh = 1080) => {
  expect(expr, "the declaration exists").not.toBeNull();
  return zoom * local(expr as string, zoom, vh);
};

const mastheadPx = Number(/sticky top-0[^"]*\bh-(\d+)\b/.exec(MASTHEAD)?.[1]) * 4;
/** Explicit reader-shell padding in the reader compound variant, painted x Fit zoom. */
const padding = /width:\s*"reader",\s*rhythm:\s*"reader",\s*class:\s*"has-\[\.reader-shell\]:pt-(\d+)"/.exec(CONTAINER);
const staticTop = (zoom: number) => mastheadPx + zoom * Number(padding?.[1]) * 4;

const ZOOMS = [1, 1.2142857, 1.6190476, 2.5];
const PANE = rule(".reader-left");
const PEEK = rule('.reader-left[data-state="rail"],\n.reader-left[data-state="peek"]');
const legendPainted = (zoom: number) => zoom * Number(/--legend-h:\s*([\d.]+)rem/.exec(CSS)?.[1]) * 16;

describe("the left pane under Fit's zoom (B P11-36, E3; BACKLOG-105)", () => {
  it("reads the masthead's height and the container's top padding", () => {
    expect(mastheadPx).toBe(48);
    expect(padding, "the reader container explicitly pads its shell").not.toBeNull();
    expect(Number(padding?.[1]) * 4).toBe(16);
  });

  // The static position of the pane at scroll 0 is the masthead (unzoomed) plus the container's padding (painted x zoom). A `top` that is not that
  // number lets the pane travel the difference with the page's first scroll (3.4 px at 1920 x 1080, Fit on) and makes the separator's focus move the window.
  it("sticks the pane, rests the rail's button and aligns the separators' focus at the pane's static position, at every Fit zoom", () => {
    for (const zoom of ZOOMS) {
      const want = staticTop(zoom);
      expect(painted(declaration(PANE, "top"), zoom), `the pane's top at Fit zoom ${zoom}`).toBeCloseTo(want, 1);
      expect(painted(declaration(rule(".reader-rail-button"), "top"), zoom), `the rail button's top at Fit zoom ${zoom}`).toBeCloseTo(want, 1);
      expect(painted(declaration(rule(".reader-divider"), "scroll-margin-top"), zoom), `the separator's scroll margin at Fit zoom ${zoom}`).toBeCloseTo(want, 1);
    }
  });

  // The peek is fixed from the masthead's foot; its content (the header row, the title, the first map row) must start at the pinned pane's top.
  it("starts the peek's content where the pinned pane's starts, at every Fit zoom", () => {
    for (const zoom of ZOOMS) {
      const top = painted(declaration(PEEK, "top"), zoom);
      const pad = declaration(PEEK, "padding-top");
      const content = top + (pad ? painted(pad, zoom) : 0);
      expect(content, `the peek's content top at Fit zoom ${zoom}`).toBeCloseTo(painted(declaration(PANE, "top"), zoom), 1);
    }
  });

  // The peek is drawn to the legend, not past it: the legend is `legend-h` x zoom tall once Fit scales the page (key-legend.tsx is inside the zoomed container).
  it("ends the peek at the legend's top, not under it, at every Fit zoom and window height", () => {
    for (const zoom of ZOOMS) {
      for (const vh of [720, 1080]) {
        const foot = painted(declaration(PEEK, "top"), zoom, vh) + painted(declaration(PEEK, "height"), zoom, vh);
        expect(foot, `the peek's foot at Fit zoom ${zoom}, ${vh} px high`).toBeCloseTo(vh - legendPainted(zoom), 1);
      }
    }
  });

  // The pinned pane keeps 16 px of air above the legend whatever the zoom (P11-23: "it still ends 16 px above the legend"; Fit off 16, Fit at 1920 was 10).
  it("keeps the pinned pane 16 px clear of the legend, at every Fit zoom and window height", () => {
    for (const zoom of ZOOMS) {
      for (const vh of [720, 1080]) {
        const foot = painted(declaration(PANE, "top"), zoom, vh) + painted(declaration(PANE, "max-height"), zoom, vh);
        expect(vh - legendPainted(zoom) - foot, `the air above the legend at Fit zoom ${zoom}, ${vh} px high`).toBeGreaterThanOrEqual(15.5);
      }
    }
  });
});
