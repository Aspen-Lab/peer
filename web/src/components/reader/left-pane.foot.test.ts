import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P11-23 rule 1 (A P11-21 X-A1; ruling §1h.120): at the very end of the page the whole left pane — the title, the commands, the strip, the map —
// stepped up about 8 px (-7.5 to -8.3 px at four windows, both tabs; the title's y 118 to 109.7 at 1440 x 900 on Summary). The cause is the
// pane's `margin-bottom` (P10-21): a sticky element stops where its holder ends, plus the room its negative bottom margin lends it. The holder
// ends 4rem above the window's bottom at the page's end (the page's own bottom room, `md:pb-16` on the paper page), but the window-high pane
// would end only the legend and 1rem above it (44 px), so a pane that may hang less than 20 px (1.25rem) below its holder is pushed up by the rest
// — -0.75rem hung 12 px, and the pane stepped up by the other 8. The rule: the pane's overhang is at least the page's bottom room less the
// clearance the pane keeps above the legend, at every Fit zoom (the lengths are declared in the zoomed ancestor's local space and painted ×
// zoom; the window's and the masthead's are not, so they are divided by it: ruling 19), so the holder's end never stops it.
//
// P11-37 (B P11-36 §3.5; BACKLOG-105) RE-DERIVED, no assertion weakened: the pane's `top` is `3rem / zoom + 1rem` (the masthead is outside Fit's zoom, the
// article's padding inside it) and its `max-height` is `(100vh - 4rem) / zoom - legend - 1rem` (the legend is inside it: `legend-h` x zoom tall), so the
// pane's foot stands `1rem / zoom + legend` (local) above the window's bottom, not `(legend + 1rem) / zoom`: 16 px (painted) clear of the legend at every
// zoom. The overhang the holder's end needs is the page's room less that, at every Fit zoom, as before.
//
// A node test cannot lay the page out, nor scroll it. This file reads the numbers off the three places that hold them — the stylesheet (the pane's
// margin, its max-height and top, the legend's height) and the paper page (its bottom room) — and checks the rule over them. The measured
// y of every element of the pane, at a mid scroll and at the end, at four windows, both tabs, pinned and in the peek, is in the checkpoint.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");
const PAGE = read("src/app/papers/[id]/page.tsx");

/** A top-level rule's body: from its selector's `{` to the closing brace at the left margin. */
const rule = (selector: string) => {
  const start = CSS.indexOf(`\n${selector} {`);
  expect(start, `${selector} is a rule of the stylesheet`).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf("\n}", start));
};
const rem = (text: string, pattern: RegExp, what: string): number => {
  const hit = pattern.exec(text);
  expect(hit, what).not.toBeNull();
  return Number(hit?.[1]);
};

const PANE = rule(".reader-left");
/** The pane's overhang below its holder, in rem: what its negative bottom margin lends it. */
const overhang = -rem(PANE, /margin-bottom:\s*(-\d+(?:\.\d+)?)rem;/, "the pane has a negative bottom margin in rem");
/** The window-high pane's own geometry (rem): the top it sticks at (the masthead, divided by the zoom, and the article's padding), and what it keeps clear below (the legend, and a rem) in its max-height. */
const stuckTop = /top:\s*calc\((\d+(?:\.\d+)?)rem\s*\/\s*var\(--page-zoom,\s*1\)\s*\+\s*(\d+(?:\.\d+)?)rem\);/.exec(PANE);
const mastheadRem = Number(stuckTop?.[1]);
const paddingRem = Number(stuckTop?.[2]);
const maxHeight = /max-height:\s*calc\(\(100vh\s*-\s*(\d+(?:\.\d+)?)rem\)\s*\/\s*var\(--page-zoom,\s*1\)\s*-\s*var\(--legend-h\)\s*-\s*(\d+(?:\.\d+)?)rem\);/.exec(PANE);
const legend = rem(CSS, /--legend-h:\s*(\d+(?:\.\d+)?)rem;/, "the legend's height is a custom property in rem");
/** The page's bottom room under the reader's grid, in rem: `md:pb-16` on the paper page's container. */
const room = rem(PAGE, /\$\{PAGE_CLASS\}\s+md:pb-(\d+)\b/, "the paper page's container has a bottom padding from md") / 4;
/**
 * The overhang (rem, local) the holder's end needs at Fit zoom `z`. The pane's foot, painted, is `100vh - (c - a) - z x (legend + d - b)` from the window's top
 * (a = the masthead, b = the article's padding, c = what max-height takes off the window, d = its clearance), so it stands `(c - a) / z + legend + d - b`
 * (local) above the window's bottom; the holder's end stands `room` above it.
 */
const needed = (zoom: number) => room - ((Number(maxHeight?.[1]) - mastheadRem) / zoom + legend + Number(maxHeight?.[2]) - paddingRem);

describe("the left pane at the page's foot (P11-23 rule 1; A P11-21 X-A1)", () => {
  it("reads the pane's own geometry off the stylesheet: it sticks at the top the max-height takes off, and keeps the legend and a rem clear", () => {
    expect(stuckTop, "the pane sticks at the masthead divided by the zoom, plus the article's padding").not.toBeNull();
    expect(maxHeight, "the pane's max-height is the window less the top, divided by the zoom, less the legend and a clearance").not.toBeNull();
    expect(Number(maxHeight?.[1])).toBe(mastheadRem + paddingRem);
    expect(Number(maxHeight?.[2])).toBeGreaterThan(0);
    expect(legend).toBeGreaterThan(0);
    expect(room).toBeGreaterThan(0);
  });

  // The pane's foot, when it is stuck at its top and as tall as the window allows, is `legend + clearance` above the window's bottom (screen). The holder's
  // end, at the page's end, is `room` above it (the zoomed container's padding, painted ×zoom). A pane whose overhang (painted ×zoom too) is less than the
  // difference is pushed up by the rest. In the zoomed ancestor's local space, with zoom z: overhang >= room - (legend + clearance) / z.
  it("lets the pane hang below its holder by at least the page's bottom room less the pane's own clearance above the legend, at every Fit zoom", () => {
    for (const zoom of [0.75, 1, 1.2142857, 1.5, 2]) {
      expect(overhang, `at Fit zoom ${zoom}: needs ${needed(zoom).toFixed(3)}rem of overhang, has ${overhang}rem`).toBeGreaterThanOrEqual(needed(zoom));
    }
  });

  it("is 1.25rem at least with Fit off (the 20 px the page's room and the pane's clearance leave); -0.75rem, the first rule's, left 8 px", () => {
    expect(needed(1)).toBeCloseTo(1.25, 6);
    expect(overhang).toBeGreaterThanOrEqual(needed(1));
    expect(overhang).toBeGreaterThan(0.75);
  });

  it("does not hang past the page's own bottom room: the pane never ends below the page", () => {
    expect(overhang).toBeLessThanOrEqual(room);
  });

  it("leaves the rail and the peek out of it: they are fixed to the window, with no bottom margin", () => {
    const fixedStates = CSS.slice(CSS.indexOf('.reader-left[data-state="rail"],'), CSS.indexOf('.reader-left[data-state="rail"] {'));

    expect(fixedStates).toContain('.reader-left[data-state="peek"] {');
    expect(fixedStates).toMatch(/position:\s*fixed;/);
    expect(fixedStates).toMatch(/margin-bottom:\s*0;/);
  });
});
