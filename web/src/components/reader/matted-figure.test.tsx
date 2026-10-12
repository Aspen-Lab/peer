import { describe, expect, it, vi } from "vitest";

// P9-57 (A P9-W4 §3, "A figure whose route URL answers 404"): a figure the deep report bound to a result is
// drawn on a mat, and its URL is an owner-only route (`…/figure-image?page=N&fig=K`) that answers 404 when the
// owner's cookie is gone or the route fails. `MattedFigure` had no error handling: the browser drew a broken-image
// glyph with the caption as its alt text, and the same caption again in the `<figcaption>`, in a mat 550 × 124 at
// 1440 and 268 × 174 at 390. The Reading's own `Figure` (paper-body.tsx) falls back to its caption alone, which is
// the pattern: the picture and its mat go, the caption stays once, no alt repeats it.
//
// No DOM here (this project's Vitest runs in Node): the component runs on the minimal hook runtime and the
// `onError` the lightbox is handed is called on the element it returns, as the question box's tests do.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { FigureLightbox } from "./figure-lightbox";
import { MattedFigure } from "./matted-figure";

const SRC = "/api/papers/upload%3A0123456789abcdef/figure-image?page=2&fig=1";
const OTHER = "/api/papers/upload%3A0123456789abcdef/figure-image?page=3&fig=2";
const CAPTION = "Figure 1. Soil water against layer depth, three orchards.";

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}
const lightboxOf = (tree: ReactNode) => elements(tree).find((el) => el.type === FigureLightbox);
/** Every string the tree would put in front of a reader or a screen reader: text children and alt attributes. */
function said(tree: ReactNode): string[] {
  const out: string[] = [];
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string") return void out.push(node);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const { props } = node as ReactElement<Props>;
    if (typeof props.alt === "string") out.push(props.alt);
    walk(props.children);
  };
  walk(tree);
  return out.filter((text) => text.length > 0);
}
const classNames = (tree: ReactNode): string =>
  elements(tree).map((el) => (typeof el.props.className === "string" ? el.props.className : "")).join(" ");

/**
 * The browser's `error` event on the picture, called on the element the render returned. The runtime re-renders
 * when the handler set state, as React does after an event.
 */
const fails = (tree: ReactNode): void => (lightboxOf(tree)?.props.onError as (() => void) | undefined)?.();

/** One page open. With `fail`, the picture reports that it could not load, once, as the browser would. */
async function draw(props: { src: string; caption?: string | null }, fail = false) {
  let reported = false;
  const page = () => {
    const tree = MattedFigure(props);
    if (fail && !reported) {
      reported = true;
      fails(tree);
    }
    return tree;
  };
  return (await hookRuntime.mount(page)).value;
}

describe("a bound figure whose picture fails to load is its caption alone, once (P9-57, rule 1)", () => {
  it("hands the picture an onError, so the failure is seen at all", async () => {
    const tree = await draw({ src: SRC, caption: CAPTION });
    expect(typeof lightboxOf(tree)?.props.onError).toBe("function");
  });

  it("drops the picture and its mat: no lightbox, no img, no mat, no crop marks", async () => {
    const tree = await draw({ src: SRC, caption: CAPTION }, true);
    expect(lightboxOf(tree)).toBeUndefined();
    expect(elements(tree).some((el) => el.type === "img" || el.type === "button")).toBe(false);
    expect(classNames(tree)).not.toContain("plate-mat");
    expect(classNames(tree)).not.toContain("cropmarks");
  });

  it("keeps the caption once: one figcaption, and no alt anywhere to say it again", async () => {
    const tree = await draw({ src: SRC, caption: CAPTION }, true);
    expect(elements(tree).filter((el) => el.type === "figcaption")).toHaveLength(1);
    expect(said(tree)).toEqual([CAPTION]);
    expect(elements(tree).some((el) => "alt" in el.props)).toBe(false);
  });

  it("draws nothing at all for a picture that fails and has no caption (no empty figure, no margin)", async () => {
    expect(await draw({ src: SRC, caption: null }, true)).toBeNull();
    expect(await draw({ src: SRC }, true)).toBeNull();
  });

  it("is the failure of that picture only: a new picture for the same place is drawn", async () => {
    // The first picture fails, then the figure's URL changes (a re-bound report): the failure was the first URL's.
    let current = SRC;
    let reported = false;
    const page = () => {
      const tree = MattedFigure({ src: current, caption: CAPTION });
      if (!reported) {
        reported = true;
        fails(tree);
        current = OTHER;
      }
      return tree;
    };
    const mounted = await hookRuntime.mount(page);
    expect(lightboxOf(mounted.value)?.props.src).toBe(OTHER);
  });
});

describe("a picture that loads is drawn as it was (P9-57, rule 3)", () => {
  it("is the lightbox on the mat, the picture's alt and the figcaption as before", async () => {
    const tree = await draw({ src: SRC, caption: CAPTION });
    const box = lightboxOf(tree);
    expect(box?.props.src).toBe(SRC);
    expect(box?.props.alt).toBe(CAPTION);
    expect(box?.props.caption).toBe(CAPTION);
    expect(classNames(tree)).toContain("bg-[var(--plate-mat)]");
    expect(classNames(tree)).toContain("cropmarks");
    expect(elements(tree).filter((el) => el.type === "figcaption")).toHaveLength(1);
  });

  it("draws the picture with no caption, with an empty alt and no figcaption", async () => {
    const tree = await draw({ src: SRC, caption: null });
    expect(lightboxOf(tree)?.props.alt).toBe("");
    expect(elements(tree).some((el) => el.type === "figcaption")).toBe(false);
  });
});
