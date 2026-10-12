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

  it("is otherwise the bar it was: from md, 48px, three columns, sticky", () => {
    const header = classes(open(render(), "header"));

    for (const cls of ["hidden", "md:grid", "sticky", "top-0", "z-50", "h-12", "px-6", "grid-cols-[1fr_auto_1fr]", "items-center"]) {
      expect(header).toContain(cls);
    }
  });
});

describe("the Briefing link drops its label to its arrow where the cells cannot hold the gap (N2)", () => {
  // The rail's link is the one `href="/"` anchor that is not the wordmark: it carries the rail's name.
  const back = (html: string) => open(html, "a", 'aria-label="← Briefing"');

  it("keeps its accessible name, '← Briefing', whichever of the two forms is showing", () => {
    const html = render();
    const tag = back(html);

    expect(tag).toContain('href="/"');
    expect(tag).toContain('aria-label="← Briefing"');
  });

  it("shows only the arrow below lg and the whole label from lg", () => {
    const html = render();
    const link = html.slice(html.indexOf(back(html)));
    const inside = link.slice(0, link.indexOf("</a>"));
    const label = open(inside, "span", "aria-hidden");
    const word = open(inside, "span", "lg:inline");

    // P9-40 re-aimed this test (§1c): it used to pin two spans, a `lg:hidden` "←" and a `hidden lg:inline`
    // "← Briefing", which left "←← Briefing" in the link's textContent. The property is the same, the arrow below
    // lg and the whole label from lg, but the arrow is now there at every width, in the one decorative span, and
    // only the word (with its leading space) comes in from lg, inside it: one line of text, as it was.
    expect(inside).toMatch(/href="\/"><span aria-hidden="true">←<span class="hidden lg:inline"> Briefing<\/span><\/span>$/);
    expect(classes(word)).toEqual(expect.arrayContaining(["hidden", "lg:inline"]));
    // Neither form is read out twice: the link's name is the aria-label, the span is decoration.
    expect(label).toContain('aria-hidden="true"');
  });

  it("reads '← Briefing' once in its textContent, the arrow shared by the arrow-only and the labelled form", () => {
    const html = render();
    const link = html.slice(html.indexOf(back(html)));
    const inside = link.slice(0, link.indexOf("</a>"));

    // P9-23 left "←← Briefing": both forms were in the DOM, each with its own arrow, one of them display:none.
    // A script or a test that reads `textContent` sees the DOM, not the screen.
    expect(inside.replace(/<[^>]*>/g, "")).toBe("← Briefing");
  });

  it("is a touch target where there is no hover, as the arrow alone would be 14px wide", () => {
    const tag = classes(back(render()));

    expect(tag).toContain("[@media(hover:none)]:min-h-11");
    expect(tag).toContain("[@media(hover:none)]:min-w-11");
  });

  it("is wider to hit than its glyph below lg: an invisible after box reaches 8px out each side, gone from lg", () => {
    const tag = classes(back(render()));

    // The arrow is about 8px wide in the bar's mono. `after:absolute` + `-inset-x-2` / `-inset-y-3` make a click
    // area of about 24 x 42 px around it without taking any room in the grid, and the box ends inside the 16px gap.
    expect(tag).toEqual(expect.arrayContaining(["relative", "after:absolute", "after:-inset-x-2", "after:-inset-y-3"]));
    // From lg the whole label is the target and the box is not drawn.
    expect(tag).toContain("lg:after:hidden");
  });

  it("is on a paper only: the briefing's masthead has no rail", () => {
    pathname = "/";

    expect(render()).not.toContain("← Briefing");
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

describe("below lg the position text drops, the arrows stay and name it (P9-40, step 2)", () => {
  // Step 1 (the wordmark is its mark) fits a mouse from 768 but not a touch tablet: with the 44px arrows and the
  // 44px `?` the cells still need 844px, so at 768 and 820 the nav stood past the window. The rule's second step:
  // the "2 of 5" text drops between md and lg, with the hairline after it; the arrows (the real prev / next
  // buttons) stay, and their names say where you are, since the text that said it is gone.
  const BRIEFING = ["openalex:W1", "openalex:W2", "openalex:W3", "openalex:W4", "openalex:W5"];
  const onPaper = (n: number) => {
    papers = BRIEFING.map((id) => ({ id }));
    pathname = `/papers/${encodeURIComponent(BRIEFING[n - 1])}`;
    return render();
  };
  /** From the Briefing link to the nav: the rail, the centre cell's whole markup. */
  const rail = (html: string) => {
    const from = html.lastIndexOf("<a", html.indexOf('aria-label="← Briefing"'));
    return html.slice(from, html.indexOf("<nav", from));
  };

  it("names the position in each arrow: 'Previous paper, 2 of 5' and 'Next paper, 2 of 5'", () => {
    const html = onPaper(2);

    expect(open(html, "button", 'aria-label="Previous paper')).toContain('aria-label="Previous paper, 2 of 5"');
    expect(open(html, "button", 'aria-label="Next paper')).toContain('aria-label="Next paper, 2 of 5"');
  });

  it.each([
    [1, 'aria-label="Previous paper, 1 of 5"', 'aria-label="Next paper, 1 of 5"'],
    [5, 'aria-label="Previous paper, 5 of 5"', 'aria-label="Next paper, 5 of 5"'],
  ])("names the position at the ends too: paper %i of 5, and the missing direction is disabled", (n, prev, next) => {
    const html = onPaper(n);
    const prevTag = open(html, "button", "Previous paper");
    const nextTag = open(html, "button", "Next paper");

    expect(prevTag).toContain(prev);
    expect(nextTag).toContain(next);
    expect(n === 1 ? prevTag : nextTag).toContain("disabled");
    expect(n === 1 ? nextTag : prevTag).not.toContain("disabled");
  });

  it("draws the position text from lg only: the 'N of M' span is hidden below it, as is the hairline after it", () => {
    const html = rail(onPaper(2));
    const text = open(html, "span", "tabular-nums");
    const rules = html.match(/<span aria-hidden="true" class="[^"]*\bw-px\b[^"]*">/g) ?? [];

    // The text is in the markup, for the widths that hold it: "2 of 5" once.
    expect(html.replace(/<[^>]*>/g, "")).toContain("2 of 5");
    expect(classes(text)).toEqual(expect.arrayContaining(["hidden", "lg:inline"]));
    // Two hairlines frame it from lg (before it, after it); below lg the one after it goes with it, so the arrow
    // and the keys keep exactly one between them.
    expect(rules).toHaveLength(2);
    expect(classes(rules[0] ?? "")).not.toContain("hidden");
    expect(classes(rules[1] ?? "")).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
  });

  it("keeps the arrows and the keycaps at every width: they are not hidden by the width", () => {
    const html = rail(onPaper(2));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];

    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(classes(b)).not.toContain("hidden");
  });

  it("is still the way back alone on a deep link: no position, no arrows, no text, no hairline", () => {
    papers = [];
    const html = rail(render());

    expect(html.replace(/<[^>]*>/g, "")).toBe("← Briefing");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("w-px");
  });
});
