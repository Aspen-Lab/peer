import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// P9-52 (A P9-W3's N5, §6 item 5): on the home page at 390 x 844 with touch the search input was 23 px tall (in a
// 36 px box). Where there is no hover (`hover: none`) the input is at least 44 px tall and the box around it is 44 px,
// the height of the Upload button's menu form beside it; with a mouse nothing moves (36 px box, 18 px input). The box
// is also 4 px higher (`-mt-1`) where there is no hover, so its centre stays on the centre of the 36 px Upload square
// beside it in the `items-start` row (a 44 px box top-aligned would sit 4 px lower than the square). Layout is not
// computed in this node environment: the boxes are in the checkpoint (docs/reading-helper-abc/P9-52-C-*.md), and
// this file pins the classes that make them. The box reads the router and nothing else it needs to mount here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SearchBox } from "./search-box";

const html = () => renderToStaticMarkup(createElement(SearchBox));
const open = (markup: string, tag: string) => (markup.match(new RegExp(`<${tag}\\b[^>]*>`)) ?? [""])[0];
const classesOf = (tag: string) => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);

describe("the search box on the home page is a touch target where there is no hover (P9-52, N5)", () => {
  it("makes the input at least 44 px tall where there is no hover", () => {
    const input = classesOf(open(html(), "input"));

    // The box has a 1 px border a side, so its 44 px leaves 42 px inside; the input stands 1 px out each way
    // (`-my-px`) over the border, which is drawn by the box and is transparent behind the input.
    expect(input).toContain("[@media(hover:none)]:h-11");
    expect(input).toContain("[@media(hover:none)]:-my-px");
  });

  it("makes the box around it 44 px tall where there is no hover, level with the Upload square beside it", () => {
    const form = classesOf(open(html(), "form"));

    expect(form).toContain("[@media(hover:none)]:h-11");
    expect(form).toContain("[@media(hover:none)]:-mt-1");
  });

  it("is the same box for a mouse: 36 px high, the input as it was, and no height floor outside hover:none", () => {
    const form = classesOf(open(html(), "form"));
    const input = classesOf(open(html(), "input"));

    expect(form).toEqual(expect.arrayContaining(["h-9", "w-full", "sm:w-[280px]", "items-center", "border"]));
    expect(input).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "bg-transparent", "px-2.5", "font-mono", "text-meta"]));
    for (const cls of [...form, ...input]) {
      if (/(^|:)(min-h|h|-mt|-my)-/.test(cls) && cls !== "h-9") expect(cls.startsWith("[@media(hover:none)]:"), cls).toBe(true);
    }
  });

  it("is still the search it was: the `/` key's id, a search role, the accessible name", () => {
    const markup = html();

    expect(open(markup, "form")).toContain('role="search"');
    expect(open(markup, "input")).toContain('id="peer-search"');
    expect(open(markup, "input")).toContain('type="search"');
    expect(open(markup, "input")).toContain("aria-label=");
  });
});
