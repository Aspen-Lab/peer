import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P12-89 (E5; rulings §1h.475, §1h.476): what FEEDS the tab its place beside a card — `NotesButton` mounted on the minimal hook runtime (no DOM), as `notes-button.beside.flow.test.tsx` does.
// `notes-button.divider.test.tsx` holds the arithmetic on the view (the tab against the margin divider's strip, the paper text, the cards and their headers); this holds the wiring: that with
// each kind of card standing, several stacked and the notes window shown by the tab's own press, the tab's right edge is 2 px left of the strip (the margin's edge less the strip's 12 px
// less the clear), at Fit's zoom too (the page's zoom reaches the view and widens the strip), that nothing is read from the page to place it, and that the places the rule does not touch
// are as they were: no card, the bottom band, no margin registered. Every text and every box is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});
vi.mock("./paper-notes", () => ({
  usePaperNotes: ({ openWindow }: { openWindow?: () => void }) => ({ ready: true, own: undefined, citing: [], open: () => openWindow?.() }),
}));
vi.mock("@/lib/reader/margin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reader/margin")>();
  return { ...actual, useMarginRect: () => actual.useMarginStore.getState().rect };
});
vi.mock("@/lib/reader/windows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reader/windows")>();
  const read = (select: (state: ReturnType<typeof actual.useWindows.getState>) => unknown) => select(actual.useWindows.getState());
  return { ...actual, useWindows: Object.assign(read, actual.useWindows) };
});

import { createElement, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DIVIDER_PX, fitPanes } from "@/components/reader/pane-layout";
import { hookRuntime } from "@/test-support/hook-runtime";
import { bottomMarginRectOf, marginRectOf, useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { EXPLAIN_WINDOW_ID, NOTES_WINDOW_ID, useWindows, type FloatingWindow } from "@/lib/reader/windows";
import { legendHeightPx } from "@/components/reader/explain-dock";
import type { Paper } from "@/types";
import { EDGE_TAB_DIVIDER_CLEAR_PX, NotesButton, NotesButtonView } from "./notes-button";

const paper: Paper = {
  id: "openalex:W1", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw.",
  summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

type Props2 = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}
const viewOf = (tree: ReactNode) => {
  const view = elements(tree).find((el) => el.type === NotesButtonView);
  if (!view) throw new Error("NotesButton rendered no NotesButtonView");
  return view;
};
const markupOf = (tree: ReactNode) => renderToStaticMarkup(createElement(NotesButtonView, viewOf(tree).props as Parameters<typeof NotesButtonView>[0]));
const px = (html: string, prop: string) => {
  const found = new RegExp(`[;"]${prop}:(-?\\d+(?:\\.\\d+)?)px`).exec(html);
  return found ? Number(found[1]) : undefined;
};
const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

/** Mount `NotesButton`; the reader then presses the tab `presses` times, each on the render the last press made. Returns the last render's tree. */
async function mountButton(presses = 0): Promise<ReactNode> {
  const latest = { tree: null as ReactNode };
  await hookRuntime.mount(() => {
    const [step, setStep] = useState(0);
    latest.tree = NotesButton({ variant: "edge", paper });
    useEffect(() => {
      if (step < presses) (viewOf(latest.tree).props.onOpen as () => void)();
      setStep(step + 1);
    }, [step]);
    return latest.tree;
  });
  return latest.tree;
}

/** The margin the shell registers at a window of this width at the default step: its left edge from the pane widths the window leaves, the band as the page's. */
const marginAt = (viewport: number): MarginRect => {
  const fit = fitPanes({ viewport });
  return marginRectOf({ left: viewport - fit.margin, width: fit.margin }, viewport > 1100 ? 900 : 576, 1);
};
const WINDOWS = [853, 1024, 1093, 1280, 1366, 1440, 1920];

const card = (id: string, kind: FloatingWindow["kind"], order: number): FloatingWindow => ({ id, kind, title: id, order });
const STATES: { name: string; windows: FloatingWindow[]; presses?: number }[] = [
  { name: "a sticky", windows: [card("s1", "sticky", 1)] },
  { name: "the notes window", windows: [card(NOTES_WINDOW_ID, "notes", 1)] },
  { name: "the explain card", windows: [card(EXPLAIN_WINDOW_ID, "explain", 1)] },
  { name: "a figure", windows: [card("figure", "figure", 1)] },
  { name: "four cards stacked", windows: [card("s1", "sticky", 1), card(EXPLAIN_WINDOW_ID, "explain", 2), card(NOTES_WINDOW_ID, "notes", 3), card("figure", "figure", 4)] },
  { name: "the notes window shown by the tab's own press", windows: [], presses: 1 },
];

const global = globalThis as unknown as Record<string, unknown>;
let reads = 0;

beforeEach(() => {
  reads = 0;
  // A page that must not be asked: placing the tab beside a card reads nothing from the DOM (P12-89 retired the header rows it once read).
  global.document = {
    querySelectorAll: () => {
      reads++;
      return [];
    },
  };
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: marginAt(1440) });
});
afterEach(() => {
  delete global.document;
  delete global.window;
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: null });
});

describe("NotesButton stands the tab left of the margin divider's strip, in every state (P12-89 E5)", () => {
  for (const viewport of WINDOWS) {
    describe(`at ${viewport} px`, () => {
      for (const state of STATES) {
        it(`${state.name}: its right edge is the margin's edge less the strip's ${DIVIDER_PX} px less ${EDGE_TAB_DIVIDER_CLEAR_PX} px, z-40, no top of its own, nothing read from the page`, async () => {
          const rect = marginAt(viewport);
          useMarginStore.setState({ rect });
          useWindows.setState({ windows: state.windows, clock: state.windows.length });
          const tree = await mountButton(state.presses ?? 0);
          const html = markupOf(tree);

          expect(viewOf(tree).props).toMatchObject({ variant: "edge", beside: true, marginLeft: rect.left });
          expect(px(html, "left")).toBe(rect.left - DIVIDER_PX - EDGE_TAB_DIVIDER_CLEAR_PX);
          expect(html).toContain("translateX(-100%)");
          expect(classesOf(html)).toContain("z-40");
          expect(html).not.toMatch(/[;"]top:/);
          expect(viewOf(tree).props).not.toHaveProperty("clearTop");
          expect(reads, "nothing is read from the page").toBe(0);
        });
      }

      it("no card: on the window's edge, the full tab, no left", async () => {
        useMarginStore.setState({ rect: marginAt(viewport) });
        const tree = await mountButton(0);
        const html = markupOf(tree);

        expect(viewOf(tree).props).toMatchObject({ beside: false });
        expect(classesOf(html)).toContain("right-0");
        expect(html).not.toContain("left:");
      });
    });
  }

  it("at Fit's zoom the strip is 12 x zoom px wide in the window's pixels, and the tab (outside the zoomed page) stands 2 px left of it", async () => {
    // `readPageZoom()` reads `--page-zoom` of the page container through `getComputedStyle`
    global.document = { querySelector: () => ({}), querySelectorAll: () => [] };
    global.window = { getComputedStyle: () => ({ getPropertyValue: () => "1.378" }) };
    useMarginStore.setState({ rect: marginRectOf({ left: 1424, width: 360 }, 1080, 1.378) });
    useWindows.setState({ windows: [card("s1", "sticky", 1)], clock: 1 });
    const tree = await mountButton(0);
    const html = markupOf(tree);

    expect(viewOf(tree).props).toMatchObject({ beside: true, marginLeft: 1424, zoom: 1.378 });
    expect(px(html, "left")).toBeCloseTo(1424 - DIVIDER_PX * 1.378 - EDGE_TAB_DIVIDER_CLEAR_PX, 3);
    expect(html).toContain(`--tab-legend:${legendHeightPx(1.378)}px`);
    expect(html).toContain("translateX(-100%)");
  });

  it("a card standing in the bottom band is not beside it: the right edge, the band's top written, no left (as P12-79 built it)", async () => {
    const band = bottomMarginRectOf(853, 480, 1);
    useMarginStore.setState({ rect: band });
    useWindows.setState({ windows: [card("s1", "sticky", 1)], clock: 1 });
    const tree = await mountButton(0);
    const html = markupOf(tree);

    expect(viewOf(tree).props).toMatchObject({ beside: false, bandTop: band.top });
    expect(html).not.toContain("left:");
    expect(classesOf(html)).toContain("right-0");
  });

  it("a card standing and no margin registered (no shell: no divider either): the card's 360 px from the right edge, as it was", async () => {
    useMarginStore.setState({ rect: null });
    useWindows.setState({ windows: [card("s1", "sticky", 1)], clock: 1 });
    const tree = await mountButton(0);
    const html = markupOf(tree);

    expect(viewOf(tree).props).toMatchObject({ beside: true, marginLeft: undefined });
    expect(html).toContain("right-[min(360px,100vw)]");
    expect(html).not.toContain("left:");
  });

  it("a second press closes the window, and the tab is back on the window's edge", async () => {
    useMarginStore.setState({ rect: marginAt(1024) });
    const tree = await mountButton(2);

    expect(viewOf(tree).props).toMatchObject({ shown: false, beside: false });
    expect(classesOf(markupOf(tree))).toContain("right-0");
  });
});
