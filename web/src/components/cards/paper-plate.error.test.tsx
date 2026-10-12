import { describe, expect, it, vi } from "vitest";

// P9-57 (A P9-W4 §3, "A figure whose route URL answers 404"): the lead plate's picture is a URL the plate cannot
// know to be good until the browser has tried it (an owner-only route that answers 404, a publisher's host that
// refuses every request). When it fails, the plate falls to the terms plate — and that fall was a step in the
// title's place: the picture's box is 16:9 (320 × 180 at 1440, 350 × 196.9 at 390) and the terms plate was 2.4:1
// (133 and 146 px), so the h1 moved up 47 px / 51 px, and the caption the page sets under the plate stayed under a
// plate that no longer drew its picture. Rule 2: the plate's height does not change in the step, and the plate says
// that its picture failed (`onFigureError`) so the line that names the picture can go with it.
//
// The feed's tiles (`feed-tile.tsx`) mount the same component without `lead`: what they draw when a picture fails
// is pinned here as it was (rule 3).
//
// No DOM here (this project's Vitest runs in Node): the component runs on the minimal hook runtime, the figure
// route's answer is handed in, and the `onError` the picture is given is called on the element it returns.
const state = vi.hoisted(() => ({
  figure: null as unknown as import("@/components/paper-figure").FigureState,
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});
vi.mock("@/components/paper-figure", () => ({ useResolvedFigure: () => state.figure }));

import type { ComponentProps, ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import type { Paper } from "@/types";
import type { FigureState } from "@/components/paper-figure";
import { FigureLightbox } from "@/components/reader/figure-lightbox";
import { PaperPlate } from "./paper-plate";

const found = (imageUrl: string): FigureState => ({
  key: "k",
  imageUrl,
  caption: "Figure 4. A profile of the crust on a sun-facing wall section.",
  source: "pdf",
  status: "found",
  reason: null,
  hideFigure: false,
  matchedBy: null,
});
const SRC = "/api/papers/upload%3A0123456789abcdef/figure-image?page=4&fig=4";
const OTHER = "/api/papers/upload%3A0123456789abcdef/figure-image?page=2&fig=1";
const TERMS = ["Soil water", "Seaweed mulch", "Terraces"];

const paper: Paper = {
  id: "upload:0123456789abcdef",
  title: "A paper",
  authors: [],
  relevanceReason: "",
  venue: "Uploaded PDF",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};
type PlateProps = ComponentProps<typeof PaperPlate> & { onFigureError?: (src: string) => void };
const lead = (over: Partial<PlateProps> = {}): PlateProps => ({ paper, terms: TERMS, lead: true, lightbox: true, ...over });
const tile = (over: Partial<PlateProps> = {}): PlateProps => ({ paper, terms: TERMS, ...over });

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}
const classesOf = (tree: ReactNode): string[] => String(elements(tree)[0]?.props.className ?? "").split(/\s+/).filter(Boolean);
const kindOf = (tree: ReactNode): unknown => elements(tree)[0]?.props["data-plate"];
const wordsOf = (tree: ReactNode): string[] =>
  elements(tree).flatMap((el) => (typeof el.props.children === "string" ? [el.props.children] : []));
/** What stands in the box that gives the plate its height: the shape classes, not the look. */
const SHAPE = /^(aspect-|max-xl:)/;
const shapeOf = (tree: ReactNode): string[] => classesOf(tree).filter((name) => SHAPE.test(name)).sort();
const pictureOf = (tree: ReactNode) => elements(tree).find((el) => el.type === FigureLightbox || el.type === "img");

/**
 * The browser's `error` event on the picture, called on the element the render returned. The runtime re-renders
 * when the handler set state, as React does after an event.
 */
const fails = (tree: ReactNode): void => (pictureOf(tree)?.props.onError as (() => void) | undefined)?.();

/** One page open. With `fail`, the picture reports that it could not load, once, as the browser would. */
async function draw(props: PlateProps, fail = false) {
  let reported = false;
  const page = () => {
    const tree = PaperPlate(props);
    if (fail && !reported) {
      reported = true;
      fails(tree);
    }
    return tree;
  };
  return (await hookRuntime.mount(page)).value;
}

describe("the lead plate whose picture fails keeps the box it held (P9-57, rule 2)", () => {
  it("draws the picture in the figure's box while it has not failed", async () => {
    state.figure = found(SRC);
    const tree = await draw(lead());
    expect(kindOf(tree)).toBe("figure");
    expect(classesOf(tree)).toContain("aspect-[16/9]");
    expect(pictureOf(tree)).toBeDefined();
  });

  it("falls to the terms plate in the figure's own box: the same shape classes, 16:9 and the one-column cap, not 2.4:1", async () => {
    state.figure = found(SRC);
    const whole = await draw(lead());
    const lost = await draw(lead(), true);
    expect(kindOf(lost)).toBe("terms");
    expect(classesOf(lost)).toContain("aspect-[16/9]");
    expect(classesOf(lost)).not.toContain("aspect-[2.4/1]");
    expect(classesOf(lost)).toContain("max-xl:w-full");
    expect(shapeOf(lost)).toEqual(shapeOf(whole));
    expect(shapeOf(lost).some((name) => name.startsWith("max-xl:max-h-"))).toBe(true);
  });

  it("is a terms plate in the figure's shape, not a mat: the paper's words, no picture, no crop marks", async () => {
    state.figure = found(SRC);
    const lost = await draw(lead(), true);
    expect(pictureOf(lost)).toBeUndefined();
    expect(wordsOf(lost)).toEqual(expect.arrayContaining(TERMS));
    expect(classesOf(lost)).not.toContain("cropmarks");
    expect(classesOf(lost)).toContain("grain");
  });

  it("holds the box for a paper with no terms of its own too: the empty window and its rule, in the figure's shape", async () => {
    state.figure = found(SRC);
    const whole = await draw(lead({ terms: [] }));
    const lost = await draw(lead({ terms: [] }), true);
    expect(kindOf(lost)).toBe("terms");
    expect(shapeOf(lost)).toEqual(shapeOf(whole));
    expect(wordsOf(lost)).toEqual([]);
  });

  it("is the failure of that picture only: a new picture for the same paper is drawn again, in the figure's box", async () => {
    state.figure = found(SRC);
    let reported = false;
    const page = () => {
      const tree = PaperPlate(lead());
      if (!reported) {
        reported = true;
        fails(tree);
        state.figure = found(OTHER);
      }
      return tree;
    };
    const tree = (await hookRuntime.mount(page)).value;
    expect(kindOf(tree)).toBe("figure");
    expect(pictureOf(tree)?.props.src).toBe(OTHER);
  });
});

describe("the lead plate says that its picture failed, so the line that names it can go (P9-57, rule 2)", () => {
  it("calls onFigureError once, with the picture that failed", async () => {
    state.figure = found(SRC);
    const seen: string[] = [];
    await draw(lead({ onFigureError: (src) => seen.push(src) }), true);
    expect(seen).toEqual([SRC]);
  });

  it("does not call it for a picture that loads", async () => {
    state.figure = found(SRC);
    const seen: string[] = [];
    await draw(lead({ onFigureError: (src) => seen.push(src) }));
    expect(seen).toEqual([]);
  });

  it("reports it from the plain img as from the lightbox (one handler, both pictures)", async () => {
    state.figure = found(SRC);
    const seen: string[] = [];
    await draw(tile({ onFigureError: (src) => seen.push(src) }), true);
    expect(seen).toEqual([SRC]);
  });
});

describe("the feed's tile whose picture fails is what it was (P9-57, rule 3)", () => {
  it("falls to the 2.4:1 terms plate, as before, and says nothing to a caller that did not ask", async () => {
    state.figure = found(SRC);
    const lost = await draw(tile(), true);
    expect(kindOf(lost)).toBe("terms");
    expect(classesOf(lost)).toContain("aspect-[2.4/1]");
    expect(classesOf(lost)).not.toContain("aspect-[16/9]");
    expect(classesOf(lost).filter((name) => name.startsWith("max-xl:"))).toEqual([]);
    expect(wordsOf(lost)).toEqual(expect.arrayContaining(TERMS));
  });

  it("draws the picture on the figure's mat while it has not failed", async () => {
    state.figure = found(SRC);
    const tree = await draw(tile());
    expect(kindOf(tree)).toBe("figure");
    expect(classesOf(tree)).toContain("cropmarks");
  });
});
