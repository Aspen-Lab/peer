import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defaultProfile, type Paper } from "@/types";

// P9-36 (the owner's decision, §1a.18 (f): job and event information is not
// processed). The Profile's reading card tells the reader "You've kept N items
// out of M Peer surfaced" and shows a "Saved" tile; N is the saved papers - not
// the papers plus whatever else an older build left in the feed store under a
// `saved...` key.
//
// zustand's React hook reads `getInitialState()` under renderToStaticMarkup (the
// server snapshot), so a `setState` before rendering never reaches the markup
// (see decision-block.test.tsx). The repo's way past that is a fake `useFeedStore`
// over a plain state object (app/saved/page.test.tsx); this one keeps everything
// else of the real module (`getState`, `setState`, the exports other modules
// import) and replaces only the hook's reading.

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock("@/store/feed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/feed")>();
  const hook = (selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(h.state) : h.state;
  return { ...actual, useFeedStore: Object.assign(hook, actual.useFeedStore) };
});

import { ReadingCard } from "./page";

const paper = (id: string) =>
  ({ id, title: `Paper ${id}`, source: "arxiv" }) as unknown as Paper;

function textOf(html: string): string {
  return html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}

describe("ReadingCard - the reading stats count papers (P9-36)", () => {
  let initial: Record<string, unknown>;

  beforeAll(async () => {
    const real = await vi.importActual<typeof import("@/store/feed")>("@/store/feed");
    initial = { ...real.useFeedStore.getState() };
  });

  // Every saved list the store holds besides the papers, three rows each: a
  // total that counted any of them would be off by 3 per list.
  function otherSavedLists(): Record<string, unknown[]> {
    return Object.fromEntries(
      Object.entries(initial)
        .filter(([key, value]) => /^saved/.test(key) && key !== "savedPapers" && Array.isArray(value))
        .map(([key]) => [key, [{ id: "x" }, { id: "y" }, { id: "z" }]]),
    );
  }

  function render(savedPapers: Paper[], extra: Record<string, unknown>): string {
    h.state = {
      ...initial,
      savedPapers,
      readItems: { a: true, b: true, c: true, d: true },
      ...extra,
    };
    return textOf(renderToStaticMarkup(createElement(ReadingCard, { profile: defaultProfile })));
  }

  it("control: the fake store reaches the card - two saved papers and four read make 2 kept out of 6", () => {
    const out = render([paper("p1"), paper("p2")], {});
    expect(out).toContain("You've kept 2 items out of 6 Peer surfaced");
    expect(out).toMatch(/Saved 2 Read 4 /);
  });

  it("keeps the hero line and the Saved tile to the saved papers, whatever else is saved in the store", () => {
    const out = render([paper("p1"), paper("p2")], otherSavedLists());
    expect(out).toContain("You've kept 2 items out of 6 Peer surfaced");
    expect(out).toMatch(/Saved 2 Read 4 /);
  });

  it("with no saved papers, rows in any other saved list count for nothing", () => {
    const out = render([], otherSavedLists());
    expect(out).toContain("You've kept 0 items out of 4 Peer surfaced");
    expect(out).toMatch(/Saved 0 Read 4 /);
  });
});
