// P11-29 (B P11-24; ruling §1h.125): two small rules of globals.css that a browser measure found and a source-text pin keeps.
//
// 1. The separator takes focus without moving the page. The left pane's separator is a grid item with `align-self: stretch`, so it is as
//    tall as the whole row; Chromium's keyboard focus-scroll aligns the edge of an element taller than the window that is partly in view
//    with the window's edge, and at scroll 0 the separator's top sits 4rem down (the masthead plus the article's padding), so the window
//    scrolled 64px the first time focus reached it. `scroll-margin-top` counts that 4rem as part of the separator, and it is the pane's
//    own sticky `top` (`.reader-left`), divided by the same page zoom. Two neighbours were measured and are refused: `scroll-margin-block`
//    (the separator's scroll area becomes the whole document, so Tab from the paper's last link to the margin's separator jumps to the
//    top) and `scroll-padding-top` on `html` (it moves every `scroll-mt-20` landing).
// 2. Smooth scrolling respects reduced motion. `layout.tsx` switches the root's smooth scrolling on (`data-scroll-behavior="smooth"`); the
//    rule that makes it smooth is inside `@media (prefers-reduced-motion: no-preference)`, as the pane's transitions already are, so a
//    reader who asked for less motion gets a focus scroll or an anchor jump in one step.
//
// P11-37 (B P11-36 §3.5; BACKLOG-105) RE-AIM, `pinned` and the two titles that name it, no assertion weakened: the pane's sticky `top` is the first-paint
// position, the masthead (48 px, outside Fit's zoom) plus the article's 1rem (inside it): `calc(3rem / zoom + 1rem)`. `4rem / zoom` was that number only at
// zoom 1; under Fit it stood 16 x (zoom - 1) px short and the window still moved 3 px (1920 x 1080), 6, 10 and 23 px (2133, 2560 and 3840 wide) when focus
// reached a separator at scroll 0. The separators still carry the pane's own `top`, whatever it is (the second test), and only the top margin.
//
// jsdom computes neither `scroll-margin` nor `prefers-reduced-motion`, so these are source-text assertions on the stylesheet (the file's
// own pattern, see globals.css.test.ts); the browser measure is in the checkpoint P11-29-C.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

// Comments blanked (same length, so offsets agree), then every `{ … }` block with its prelude and its position.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
type Block = { prelude: string; open: number; close: number };
const blocks: Block[] = [];
{
  const open: Block[] = [];
  let from = 0;
  for (let at = 0; at < bare.length; at++) {
    const ch = bare[at];
    if (ch === "{") {
      open.push({ prelude: bare.slice(from, at).trim().replace(/\s+/g, " "), open: at, close: -1 });
      from = at + 1;
    } else if (ch === "}") {
      const block = open.pop();
      if (block) blocks.push({ ...block, close: at });
      from = at + 1;
    } else if (ch === ";") {
      from = at + 1;
    }
  }
  if (open.length > 0) throw new Error("globals.css has an unclosed block");
}
/** The blocks that contain `at`, outermost first. */
const around = (at: number) => blocks.filter((block) => block.open < at && at < block.close).sort((a, b) => a.open - b.open);
/** Every declaration of `property` whose value matches, with the preludes of the blocks around it. */
const declarations = (property: string, value: RegExp) => {
  const found: { text: string; preludes: string[] }[] = [];
  for (const match of bare.matchAll(new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;}]+)`, "g"))) {
    if (!value.test(match[1].trim())) continue;
    found.push({ text: match[0].trim(), preludes: around(match.index ?? 0).map((block) => block.prelude) });
  }
  return found;
};
/** The text of the one top-level rule whose prelude is exactly `selector`. */
const ruleOf = (selector: string) => {
  const rules = blocks.filter((block) => block.prelude === selector && around(block.open).length === 0);
  expect(rules, `${selector} is one top-level rule of globals.css`).toHaveLength(1);
  return bare.slice(rules[0].open + 1, rules[0].close);
};

describe("globals.css — the separator takes focus without moving the page (P11-29, rule 1)", () => {
  const pinned = /^calc\(\s*3rem\s*\/\s*var\(\s*--page-zoom\s*,\s*1\s*\)\s*\+\s*1rem\s*\)$/;

  it("the separators carry a scroll-margin-top of the pane's first-paint position (3rem over the page zoom, plus 1rem), so their top edge is already on the window's at scroll 0", () => {
    const margins = declarations("scroll-margin-top", /./).filter((d) => d.preludes.at(-1) === ".reader-divider");
    expect(margins, ".reader-divider declares scroll-margin-top once").toHaveLength(1);
    expect(margins[0].preludes).toEqual([".reader-divider"]);
    expect(margins[0].text.replace(/^scroll-margin-top\s*:\s*/, "")).toMatch(pinned);
  });

  it("is the pane's own sticky top, the figure that stands between the window's edge and the separator's top", () => {
    const top = /(?<![\w-])top\s*:\s*([^;}]+)/.exec(ruleOf(".reader-left"))?.[1].trim() ?? "";
    expect(top).toMatch(pinned);
    const margin = /scroll-margin-top\s*:\s*([^;}]+)/.exec(ruleOf(".reader-divider"))?.[1].trim() ?? "";
    expect(margin.replace(/\s+/g, "")).toBe(top.replace(/\s+/g, ""));
  });

  it("is only the top margin on the separators: no scroll-margin-block / -bottom / shorthand on them, no scroll-padding on the page", () => {
    // `scroll-margin-block` made Tab from the paper's last link to the margin's separator throw the window back to the top (B P11-24 §6.3).
    for (const selector of [".reader-divider", ".reader-divider:focus-visible"]) {
      const rule = blocks.some((block) => block.prelude === selector) ? ruleOf(selector) : "";
      expect(rule).not.toMatch(/scroll-margin(-block(-start|-end)?|-bottom|-inline[\w-]*|-left|-right)?\s*:/);
    }
    expect(bare).not.toMatch(/scroll-margin\s*:/);
    // `scroll-padding-top` on `html` would add 64px to every `scroll-mt-20` landing (the map's anchors, the paper's headings).
    expect(bare).not.toMatch(/scroll-padding[\w-]*\s*:/);
  });
});

describe("globals.css — smooth scrolling respects reduced motion (P11-29, rule 2)", () => {
  const noPreference = /^@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)$/;
  const smooth = declarations("scroll-behavior", /^smooth$/);

  it("declares the smooth root scrolling at all (default motion is unchanged), on the attribute layout.tsx switches on", () => {
    expect(smooth.length).toBeGreaterThanOrEqual(1);
    expect(smooth.some((d) => d.preludes.at(-1) === 'html[data-scroll-behavior="smooth"]')).toBe(true);
    expect(layout).toMatch(/<html[^>]*\sdata-scroll-behavior="smooth"/);
  });

  it("every scroll-behavior: smooth stands inside @media (prefers-reduced-motion: no-preference)", () => {
    for (const declaration of smooth) {
      expect(
        declaration.preludes.some((prelude) => noPreference.test(prelude)),
        `"${declaration.text}" is inside a no-preference media query (blocks around it: ${declaration.preludes.join(" > ") || "none"})`,
      ).toBe(true);
    }
  });

  it("sets nothing smooth on the reduce side, and never turns smooth on through the `reduce` query", () => {
    for (const declaration of smooth) {
      expect(declaration.preludes.join(" > ")).not.toMatch(/prefers-reduced-motion\s*:\s*reduce/);
    }
  });
});
