import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P9-23 (A P9-W2's N2): on a paper the masthead's centred "← Briefing" group and the main nav were drawn with
// no space between them — 0 px at 1024 / 900 / 768, 53 px at 1280, 133 at 1440 — because the header's grid
// (`1fr auto 1fr`) had no column gap, so the `auto` cell and a right cell sized to its own minimum touched.
// Layout is not computed in this node environment; the page's pixels are measured in the checkpoint
// (docs/reading-helper-abc/P9-23-C-*.md), and this file pins the classes that make them.
//
// The masthead reads the router (`usePathname`, `useRouter`) and nothing else it needs to mount here: the
// stores start empty and the auth hook answers "loading" on the server. `next/navigation` is stubbed the way
// this repo's other component tests do (persona/result.test.tsx).

let pathname = "/papers/openalex%3AW2";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import { Masthead } from "./masthead";

const render = () => renderToStaticMarkup(createElement(Masthead));

/** The first opening tag of `tag` (optionally the one carrying `contains`) and its class tokens. */
const open = (html: string, tag: string, contains = "") =>
  (html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? []).find((t) => t.includes(contains)) ?? "";
const classes = (tagText: string) => (/\bclass="([^"]*)"/.exec(tagText)?.[1] ?? "").split(/\s+/).filter(Boolean);

beforeEach(() => {
  pathname = "/papers/openalex%3AW2";
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
    const arrow = open(inside, "span", "lg:hidden");
    const label = open(inside, "span", "lg:inline");

    expect(arrow).not.toBe("");
    expect(classes(arrow)).toContain("lg:hidden");
    expect(inside).toMatch(/lg:hidden[^>]*>←<\/span>/);
    // The full label is in the markup for the widths that hold it, hidden below them.
    expect(classes(label)).toEqual(expect.arrayContaining(["hidden", "lg:inline"]));
    expect(inside).toMatch(/hidden lg:inline[^>]*>← Briefing<\/span>/);
    // Neither form is read out twice: the link's name is the aria-label, the spans are decoration.
    expect(arrow).toContain('aria-hidden="true"');
    expect(label).toContain('aria-hidden="true"');
  });

  it("is a touch target where there is no hover, as the arrow alone would be 14px wide", () => {
    const tag = classes(back(render()));

    expect(tag).toContain("[@media(hover:none)]:min-h-11");
    expect(tag).toContain("[@media(hover:none)]:min-w-11");
  });

  it("is on a paper only: the briefing's masthead has no rail", () => {
    pathname = "/";

    expect(render()).not.toContain("← Briefing");
  });
});
