import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { Paper } from "@/types";

// P11-12 (owner item 1; B P11-05 §2.1, §6 C3, invariants 8 and 9; ruling §1h.113): a figure in Paper digestion is a button
// that opens it in the margin. The click goes through the store (`figure-viewer.ts`), so `PaperBody` takes no new prop. The
// button is the picture's own box — nothing moves: the aspect box stays the mat's first child, the four reserve literals
// stay (`paper-body.figure-reserve.test.tsx`), the button adds no padding, border or margin. A figure with no picture is no
// button. The open figure carries a quiet accent ring (D10) and `aria-expanded`.
//
// No DOM here (the suite runs in plain Node): the markup is rendered to a string, and the handler a click would run is read
// off the button as React is handed it (the JSX runtime is spied on, below) and called with the few members of the event it
// reads. Layout is measured in a real browser: the boxes are in the checkpoint (docs/reading-helper-abc/P11-12-C-*.md).
// Every text is invented.

const spy = vi.hoisted(() => ({ buttons: [] as Array<Record<string, unknown>> }));
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if (type === "button") spy.buttons.push(props);
      return (actual.jsxDEV as (...args: unknown[]) => unknown)(type, props, ...rest);
    },
  };
});
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const wrap = (make: (...args: unknown[]) => unknown) => (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
    if (type === "button") spy.buttons.push(props);
    return make(type, props, ...rest);
  };
  return { ...actual, jsx: wrap(actual.jsx as (...args: unknown[]) => unknown), jsxs: wrap(actual.jsxs as (...args: unknown[]) => unknown) };
});

import { closeFigure, getOpenFigure, openFigure } from "@/lib/reader/figure-viewer";
import { useWindows } from "@/lib/reader/windows";
import { PaperBody } from "./paper-body";

const paper: Paper = {
  id: "openalex:W1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

/**
 * Figure 1 has a known size (an aspect box), Figure 2 has a page but no size (the fixed room), Figure 3 has no page and no
 * picture at all (its caption stands alone).
 */
const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [
    { ordinal: 1, label: "Figure 1", caption: "Creep against density.", page: 1, width: 1400, height: 900 },
    { ordinal: 2, label: "Figure 2", caption: "Creep against grain size.", page: 2 },
    { ordinal: 3, label: "Figure 3", caption: "A sketch of the specimen." },
  ],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "Not in the body." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Figure 1 shows the rate.\n\nFigure 2 shows the other.\n\nFigure 3 shows the specimen.", page: 1 },
  ],
};
const fullText: FullTextResult = {
  status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 },
};
const reading = buildReading(paper, fullText, new Date("2026-10-19T00:00:00.000Z"));
const figures = (reading.body ?? []).flatMap((section) => section.figures ?? []);
const figureOf = (label: string) => figures.find((f) => f.label === label)!;

const render = () => renderToStaticMarkup(createElement(PaperBody, { reading }));
const OPENERS = /<button type="button" aria-label="Open (Figure \d) in the margin"[^>]*>/g;
const openerOf = (html: string, label: string) => html.match(new RegExp(`<button type="button" aria-label="Open ${label} in the margin"[^>]*>`))?.[0] ?? "";
const classesOf = (opener: string) => (opener.match(/ class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);

beforeEach(() => {
  closeFigure();
  useWindows.setState({ windows: [], clock: 0 });
  spy.buttons.length = 0;
});
afterEach(() => closeFigure());

it("the reading under test is the one the cases below describe", () => {
  expect(figures.map((f) => f.label)).toEqual(["Figure 1", "Figure 2", "Figure 3"]);
  expect([figureOf("Figure 1").width, figureOf("Figure 1").height]).toEqual([1400, 900]);
  expect(figureOf("Figure 2").width).toBeUndefined();
  expect(figureOf("Figure 1").imageUrl).toBeTruthy();
  expect(figureOf("Figure 2").imageUrl).toBeTruthy();
  expect(figureOf("Figure 3").imageUrl).toBeUndefined();
});

describe("a figure with a picture is a button that opens it in the margin", () => {
  const html = render();

  it("names the button for the figure: 'Open Figure N in the margin', closed, with the picture's pointer", () => {
    expect([...html.matchAll(OPENERS)].map((m) => m[1])).toEqual(["Figure 1", "Figure 2"]);
    for (const label of ["Figure 1", "Figure 2"]) {
      const opener = openerOf(html, label);
      expect(opener).toContain('type="button"');
      expect(opener).toContain('aria-expanded="false"');
      expect(classesOf(opener)).toContain("cursor-zoom-in");
    }
  });

  it("holds the picture and nothing else: the caption stays under the mat, outside the button", () => {
    const inside = [...html.matchAll(/<button type="button" aria-label="Open Figure \d in the margin"[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
    expect(inside).toHaveLength(2);
    for (const content of inside) expect(content).toMatch(/^<img [^>]*\/>$/);
    expect(html).toMatch(/<\/button><\/div><\/div><figcaption[^>]*><span class="text-text-muted">Figure 1<\/span> · Creep against density\.<\/figcaption>/);
    expect(html).toMatch(/<\/button><\/div><figcaption[^>]*><span class="text-text-muted">Figure 2<\/span> · Creep against grain size\.<\/figcaption>/);
  });

  it("a figure with a known size: the aspect box is still the mat's first child, and the button fills it", () => {
    expect(html).toContain('<div class="bg-[var(--plate-mat)] p-3 sm:p-4"><div class="mx-auto" style="aspect-ratio:1400 / 900;');
    expect(html).toMatch(/style="aspect-ratio:1400 \/ 900;[^"]*"><button type="button" aria-label="Open Figure 1 in the margin"/);
    expect(classesOf(openerOf(html, "Figure 1"))).toEqual(["block", "h-full", "w-full", "cursor-zoom-in"]);
    expect(html).toMatch(/<img [^>]*class="block h-full w-full object-contain"/);
  });

  it("a figure with no known size: the button is the picture's own width, centred, never wider than the mat", () => {
    expect(html).toContain('<div class="bg-[var(--plate-mat)] p-3 sm:p-4"><button type="button" aria-label="Open Figure 2 in the margin"');
    expect(classesOf(openerOf(html, "Figure 2"))).toEqual(["mx-auto", "block", "max-w-full", "cursor-zoom-in"]);
    expect(html).toContain('class="mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain"');
  });

  it("adds no padding, margin, border, gap or ring to the figure's box when it is closed (invariant 8: nothing moves)", () => {
    for (const label of ["Figure 1", "Figure 2"]) {
      const spaced = classesOf(openerOf(html, label)).filter((c) => /^(-?[pm][trblxy]?-|border|gap|space-|ring|outline|shadow)/.test(c));
      expect(spaced).toEqual(label === "Figure 2" ? ["mx-auto"] : []);
    }
  });

  it("the picture's reserve is as it was: the mat's first-paint class, the lazy picture, its address and caption", () => {
    expect(html).toContain('loading="lazy" decoding="async" referrerPolicy="no-referrer"');
    expect(html).toContain(`src="${figureOf("Figure 1").imageUrl!.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('alt="Creep against density."');
    expect(html).not.toContain("min-h-[calc(32rem");
  });

  it("a figure whose picture did not arrive is no button: its caption stands alone", () => {
    expect(html).not.toContain("Open Figure 3");
    expect(html).toContain("Figure 3</span> · A sketch of the specimen.");
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});

describe("the open figure (D10)", () => {
  it("is the one whose key the store holds: aria-expanded true and a quiet accent ring, the others untouched", () => {
    openFigure({ key: "Figure 2:2", src: "x", label: "Figure 2", caption: "", natural: null, origin: null });
    const html = render();

    const open = openerOf(html, "Figure 2");
    expect(open).toContain('aria-expanded="true"');
    expect(classesOf(open)).toEqual(expect.arrayContaining(["ring-2", "ring-accent/45", "cursor-zoom-in"]));

    const other = openerOf(html, "Figure 1");
    expect(other).toContain('aria-expanded="false"');
    expect(classesOf(other).some((c) => c.startsWith("ring"))).toBe(false);
  });

  it("is marked by a ring, which is a shadow: the box, the padding and the focus outline are not touched", () => {
    openFigure({ key: "Figure 1:1", src: "x", label: "Figure 1", caption: "", natural: null, origin: null });
    const classes = classesOf(openerOf(render(), "Figure 1"));

    expect(classes.filter((c) => c.startsWith("outline"))).toEqual([]);
    expect(classes.filter((c) => /^(-?[pm][trblxy]?-|border|gap|space-)/.test(c))).toEqual([]);
    expect(classes).toEqual(["block", "h-full", "w-full", "cursor-zoom-in", "ring-2", "ring-accent/45"]);
  });

  it("goes with the figure: closing it takes the ring and aria-expanded away", () => {
    openFigure({ key: "Figure 1:1", src: "x", label: "Figure 1", caption: "", natural: null, origin: null });
    closeFigure();
    const html = render();

    expect(html).not.toContain('aria-expanded="true"');
    expect(html).not.toContain("ring-accent");
  });

  it("a figure with another key is not the open one, whatever its label", () => {
    openFigure({ key: "Figure 2:9", src: "x", label: "Figure 2", caption: "", natural: null, origin: null });

    expect(render()).not.toContain('aria-expanded="true"');
  });
});

describe("pressing a figure", () => {
  /** What the button's handler reads off its event: the button's box, and the picture inside it. */
  const press = (label: string, picture: { naturalWidth: number; naturalHeight: number } | null, box = { left: 300, top: 220, width: 640, height: 411 }) => {
    spy.buttons.length = 0;
    render();
    const props = spy.buttons.find((p) => p["aria-label"] === `Open ${label} in the margin`);
    expect(props, `the button of ${label} was rendered`).toBeDefined();
    const onClick = props!.onClick as (event: unknown) => void;
    onClick({
      currentTarget: {
        querySelector: (selector: string) => (selector === "img" ? picture : null),
        getBoundingClientRect: () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top }),
      },
    });
  };

  it("opens it in the store: key, address, label, caption, the picture's own size and where it stood", () => {
    press("Figure 1", { naturalWidth: 2800, naturalHeight: 1800 });

    expect(getOpenFigure()).toEqual({
      key: "Figure 1:1",
      src: figureOf("Figure 1").imageUrl,
      label: "Figure 1",
      caption: "Creep against density.",
      natural: { width: 2800, height: 1800 },
      origin: { left: 300, top: 220, width: 640, height: 411 },
    });
  });

  it("takes the size from the figure's record while the picture has not loaded, and none where neither is known", () => {
    press("Figure 1", { naturalWidth: 0, naturalHeight: 0 });
    expect(getOpenFigure()?.natural).toEqual({ width: 1400, height: 900 });

    press("Figure 2", { naturalWidth: 0, naturalHeight: 0 });
    expect(getOpenFigure()?.key).toBe("Figure 2:2");
    expect(getOpenFigure()?.natural).toBeNull();

    press("Figure 2", null);
    expect(getOpenFigure()?.natural).toBeNull();
  });

  it("a second figure replaces the first (D2); the open figure pressed again stays open (D4)", () => {
    press("Figure 1", { naturalWidth: 2800, naturalHeight: 1800 });
    press("Figure 2", { naturalWidth: 1000, naturalHeight: 700 });
    expect(getOpenFigure()?.key).toBe("Figure 2:2");

    const before = getOpenFigure();
    press("Figure 2", { naturalWidth: 1000, naturalHeight: 700 });
    expect(getOpenFigure()?.key).toBe("Figure 2:2");
    expect(getOpenFigure()).not.toBe(before);
  });

  it("opens no window and reserves nothing: the margin's card is a later item's, and the page does not move", () => {
    press("Figure 1", { naturalWidth: 2800, naturalHeight: 1800 });

    expect(useWindows.getState().windows).toEqual([]);
  });

  it("is a plain button press: no link, no form, nothing but the store", () => {
    press("Figure 1", { naturalWidth: 2800, naturalHeight: 1800 });
    const props = spy.buttons.find((p) => p["aria-label"] === "Open Figure 1 in the margin")!;

    expect(props.type).toBe("button");
    expect(props.onClick).toBeTypeOf("function");
    expect(props.disabled).toBeUndefined();
  });
});
