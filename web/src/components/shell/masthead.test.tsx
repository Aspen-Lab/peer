import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P9-23 (A P9-W2's N2): on a paper the masthead's centred "← Briefing" group and the main nav were drawn with
// no space between them — 0 px at 1024 / 900 / 768, 53 px at 1280, 133 at 1440 — because the header's grid
// (`1fr auto 1fr`) had no column gap, so the `auto` cell and a right cell sized to its own minimum touched.
// Layout is not computed in this node environment; the page's pixels are measured in the checkpoint
// (docs/reading-helper-abc/P9-23-C-*.md), and this file pins the classes that make them.
//
// P9-40 (ruling §1h.64 (a)): with the position rail ("← Briefing · 2 of 5 · k j") the three cells need 826px with a
// mouse and about 897px on a touch tablet, so a paper opened from the briefing at 768-896px pushed the nav past
// the window (the `?` button stood 33px beyond the edge at 768; the page was 801px wide, 897px on touch). Below `lg`
// the wordmark is its mark alone, so the cells fit; the Briefing link reads "← Briefing" once.
//
// The masthead reads the router (`usePathname`, `useRouter`) and nothing else it needs to mount here: the
// stores start empty and the auth hook answers "loading" on the server. `next/navigation` is stubbed the way
// this repo's other component tests do (persona/result.test.tsx).

let pathname = "/papers/openalex%3AW2";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

// The briefing the paper was opened from. The store's server snapshot is its initial state, so `setState` would
// not reach a static render; the masthead reads `papers` and nothing else from it (P9-40: the position rail).
let papers: { id: string }[] = [];
vi.mock("@/store/feed", () => ({
  useFeedStore: (select: (s: { papers: { id: string }[] }) => unknown) => select({ papers }),
}));

import { Masthead } from "./masthead";

const render = () => renderToStaticMarkup(createElement(Masthead));

/** The first opening tag of `tag` (optionally the one carrying `contains`) and its class tokens. */
const open = (html: string, tag: string, contains = "") =>
  (html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? []).find((t) => t.includes(contains)) ?? "";
const classes = (tagText: string) => (/\bclass="([^"]*)"/.exec(tagText)?.[1] ?? "").split(/\s+/).filter(Boolean);

beforeEach(() => {
  pathname = "/papers/openalex%3AW2";
  papers = [];
});

describe("the masthead's grid keeps a gap between its cells (N2)", () => {
  it("has a 16px column gap, so the centred group and the main nav never touch", () => {
    const header = classes(open(render(), "header"));

    // `gap-x-4` is 1rem = 16px. Without it the `auto` centre cell and the right cell, sized to its own
    // content, abut (the gap measured 0 px at 768 / 900 / 1024).
    expect(header).toContain("gap-x-4");
  });

  it("is a 48px sticky bar with two groups from md", () => {
    const header = classes(open(render(), "header"));

    for (const cls of ["hidden", "md:grid", "sticky", "top-0", "z-50", "h-12", "px-6", "grid-cols-[1fr_auto]", "items-center"]) {
      expect(header).toContain(cls);
    }
  });
});

describe("the reader masthead", () => {
  it("omits briefing pagination on a paper in the feed while keeping the main navigation", () => {
    papers = [{ id: "openalex:W1" }, { id: "openalex:W2" }, { id: "openalex:W3" }];
    const html = render();
    expect(html).not.toContain("← Briefing");
    expect(html).not.toContain("Previous paper");
    expect(html).not.toContain("Next paper");
    expect(html).not.toContain("2 / 3");
    expect(open(html, "a", 'aria-label="Main"')).toContain('href="/"');
  });

  it("omits the briefing link on a directly opened paper too", () => {
    expect(render()).not.toContain("← Briefing");
    expect(open(render(), "a", 'aria-label="Peer"')).toContain('href="/"');
  });
});

describe("below lg the wordmark is its mark alone, so the masthead fits with the position rail (P9-40)", () => {
  // The wordmark's link is the first anchor of the bar, the one that wears the registration corners (`group/mark`).
  const wordLink = (html: string) => open(html, "a", "group/mark");
  const innerOf = (html: string, tag: string) => {
    const from = html.slice(html.indexOf(tag) + tag.length);
    return from.slice(0, from.indexOf("</a>"));
  };

  it("keeps its accessible name, 'Peer', on the link: the word is hidden below lg, an aria-label names the mark", () => {
    const tag = wordLink(render());

    expect(tag).toContain('href="/"');
    expect(tag).toContain('aria-label="Peer"');
  });

  it("draws the word only from lg: the mark is always there, the display-serif 'Peer' is hidden below it", () => {
    const html = render();
    const inside = innerOf(html, wordLink(html));
    const word = open(inside, "span", "font-display");

    expect(inside).toContain("<svg");
    expect(inside).toMatch(/>Peer<\/span>/);
    expect(classes(word)).toEqual(expect.arrayContaining(["hidden", "lg:inline"]));
  });

  it("has no gap between the mark and its corners below lg, so the link is the mark and its padding: 30px", () => {
    const tag = classes(wordLink(render()));

    // The link's `gap-2` sat between the mark, the word and the (zero-width) corners wrapper: with the word gone
    // it left 8px of nothing, 38px for a 14px mark. From lg the gap is what it was, so the box is pixel-identical.
    expect(tag).toContain("lg:gap-2");
    expect(tag).not.toContain("gap-2");
  });

  it("has a click area around the mark that takes no room, at least 44px each way, gone from lg", () => {
    const tag = classes(wordLink(render()));

    // The mark and its padding are 30 x 26px; an invisible `after` box reaches 8px out each side and 12px up and
    // down, to the bar's edges, 46 x 50px, without taking room in the grid. From lg the whole word is the target
    // and the box is not drawn.
    expect(tag).toEqual(expect.arrayContaining(["relative", "after:absolute", "after:-inset-x-2", "after:-inset-y-3"]));
    expect(tag).toContain("lg:after:hidden");
  });

  it("is otherwise the wordmark it was from lg: the mark, then the display-serif word, 8px apart, in a padded link", () => {
    const html = render();
    const tag = classes(wordLink(html));
    const word = classes(open(innerOf(html, wordLink(html)), "span", "font-display"));

    for (const cls of ["group/mark", "relative", "inline-flex", "items-center", "px-2", "py-1.5", "text-heading"]) {
      expect(tag).toContain(cls);
    }
    for (const cls of ["font-display", "text-title-lg", "font-medium", "leading-none", "text-heading"]) {
      expect(word).toContain(cls);
    }
  });
});

describe("the navigation is grouped without divider lines", () => {
  // Measured after steps 1 and 2: with a mouse the cells fit from 768, and on touch from 820, but at 768 the touch
  // tablet's `?` still ended at 781px, 13px past the window (44px arrows, a 44px `?`). Five hairlines are visible
  // in the bar below lg, 17px each with their 8px margins; at 4px a side they are 9px, 37px less in all, and the `?`
  // ends at 744px, inside the bar's 24px margin. A mouse is not asked for it: its cells fit already.
  const BRIEFING = ["openalex:W1", "openalex:W2", "openalex:W3", "openalex:W4", "openalex:W5"];
  const hairlines = () => {
    papers = BRIEFING.map((id) => ({ id }));
    return (render().match(/<span aria-hidden="true" class="[^"]*\bw-px\b[^"]*">/g) ?? []).map(classes);
  };

  it("does not draw vertical separators between actions", () => {
    expect(hairlines()).toHaveLength(0);
  });

  it("keeps accessible names on navigation links", () => {
    const html = render();
    for (const name of ["Main", "Search", "Saved", "Profile"]) expect(html).toContain(`aria-label="${name}"`);
  });
});

// P9-52 (A P9-W3's N5, §6 item 5): on the home page at 390 x 844 with touch the phone's in-flow wordmark ("Peer", the
// `md:hidden` link above the date; the bar is gone below 768) was 37 x 19 px. Where there is no hover (`hover: none`) it
// is at least 44 px tall (`[@media(hover:none)]:min-h-11`, the rule P9-23 gave the bar's own controls); with a mouse
// nothing moves. It is made a block (`flex w-fit`) there so the 44 px is its own box and not a line box's strut, and
// the wrapper's 24 px of padding above gives back 8 px of it, so the words sit about where they sat. The bar's cells,
// P9-23's and P9-40's, are not touched: the bar is hidden below `md` and the link is hidden from it. Layout is not
// computed in this node environment: the boxes and the bar's `?` / scrollWidth checks are in the checkpoint
// (docs/reading-helper-abc/P9-52-C-*.md), and this block pins the classes that make them.
describe("the phone's in-flow wordmark on the home page is a touch target where there is no hover (P9-52, N5)", () => {
  // The bar's wordmark link wears the registration corners (`group/mark`); the in-flow one is the link set in the display serif.
  const flowLink = (html: string) => open(html, "a", "font-display");
  const flowWrapper = (html: string) => open(html, "div", "md:hidden");

  it("is at least 44 px tall where there is no hover, and is a block there so the 44 px is its own box", () => {
    pathname = "/";
    const link = classes(flowLink(render()));

    expect(link).toContain("[@media(hover:none)]:min-h-11");
    expect(link).toContain("[@media(hover:none)]:flex");
    expect(link).toContain("[@media(hover:none)]:w-fit");
    expect(link).toContain("[@media(hover:none)]:items-center");
  });

  it("gives back 8 px of the wrapper's 24 px above it where there is no hover, so the words sit about where they sat", () => {
    pathname = "/";
    const wrapper = classes(flowWrapper(render()));

    expect(wrapper).toContain("pt-6");
    expect(wrapper).toContain("[@media(hover:none)]:pt-4");
  });

  it("is the same link for a mouse: the display serif, to '/', in flow below md only, and no height floor outside hover:none", () => {
    pathname = "/";
    const html = render();
    const link = classes(flowLink(html));

    expect(flowLink(html)).toContain('href="/"');
    expect(link).toEqual(expect.arrayContaining(["font-display", "text-title-lg", "font-medium", "leading-none", "text-heading"]));
    expect(classes(flowWrapper(html))).toEqual(expect.arrayContaining(["md:hidden", "px-6", "pt-6"]));
    for (const cls of [...link, ...classes(flowWrapper(html))]) {
      if (/(^|:)(min-h|h|min-w|w)-/.test(cls)) expect(cls.startsWith("[@media(hover:none)]:"), cls).toBe(true);
    }
    // The word is still the one text of the link, named by what it says.
    expect(html).toMatch(/<a\b[^>]*font-display[^>]*>Peer<\/a>/);
  });

  it("is on the home page only: a paper has no in-flow wordmark", () => {
    pathname = "/papers/openalex%3AW2";

    expect(flowLink(render())).toBe("");
    expect(flowWrapper(render())).toBe("");
  });

  it("leaves the bar's own wordmark link as P9-40 built it: no touch floor of its own", () => {
    pathname = "/";
    const bar = classes(open(render(), "a", "group/mark"));

    expect(bar).toEqual(expect.arrayContaining(["group/mark", "relative", "inline-flex", "items-center", "lg:gap-2"]));
    expect(bar).not.toContain("[@media(hover:none)]:min-h-11");
  });
});

// P10-21 rule 7 (round 2's reader, confirmed by the director): once scrolled, the bar was glass (60% of the
// secondary ground, blurred), and the paper's words showed through it. Scrolled, it takes the surface colour, opaque.
describe("the masthead is opaque once the page is scrolled", () => {
  it("takes the surface background when scrolled, and is not glass", () => {
    const header = classes(open(render(), "header"));

    expect(header).toContain("peer-masthead");
    expect(header).not.toContain("data-[scrolled=true]:glass-bar");
    expect(header.some((c) => /backdrop|glass/.test(c))).toBe(false);
    expect(header).toContain("sticky");
    expect(header).toContain("top-0");
  });
});
