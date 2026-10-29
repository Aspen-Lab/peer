import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-34 (BACKLOG-102): the tab clear of the text, in every state the page can put it in. `notes-button.clear.test.tsx` holds the arithmetic on
// the view; this holds what FEEDS it: `NotesButton` with no card, with each kind of card standing (a sticky, the notes window, the explain card,
// a figure), with several stacked, and with the notes window shown by the tab's own press — at the margin the shell gives at each window. The
// tab's place does not depend on which card or how many (it stands at the margin's left edge, the cards' common edge), and the same width must
// clear the text in all of them. Same runtime as `notes-button.beside.flow.test.tsx`: the minimal hook runtime, the real stores read in place
// of zustand's hooks, the paper-notes hook replaced by one whose `open` calls the window opener. Every text is invented.
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DIVIDER_PX, fitPanes } from "@/components/reader/pane-layout";
import { hookRuntime } from "@/test-support/hook-runtime";
import { useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { EXPLAIN_WINDOW_ID, NOTES_WINDOW_ID, useWindows, type FloatingWindow } from "@/lib/reader/windows";
import type { Paper } from "@/types";
import { EDGE_TAB_DIVIDER_CLEAR_PX, NotesButton, NotesButtonView } from "./notes-button";

const paper: Paper = {
  id: "openalex:W1", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw.",
  summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const centreRule = CSS.slice(CSS.indexOf("\n.reader-centre {"), CSS.indexOf("\n}", CSS.indexOf("\n.reader-centre {")));
/** The gutter at 1x between the text's right edge and the margin's left edge: the divider and the centre's RIGHT padding (`padding-inline: 12px 20px`, P12-89: the second number). */
const GUTTER_PX = DIVIDER_PX + Number(/padding-inline:\s*\d+(?:\.\d+)?px\s+(\d+(?:\.\d+)?)px/.exec(centreRule)?.[1]);
/** Re-aimed (P12-89, E5): the least clear from the text was 8 px in the 24 px gutter, where the tab stood over the divider's strip. The tab now stands in the centre's right padding, left of
 *  the strip, and the padding holds it (15 px), its clear of the strip (2 px) and 3 px of clear before the text: counted from the frame's outer edge (1 px), 2 px. */
const CLEAR_PX = 2;
const FRAME_PX = 1;
const CAPTION_PX = Number(/--text-caption:\s*(\d+(?:\.\d+)?)px/.exec(CSS)?.[1]);
const EYEBROW_LEADING = Number(/@utility eyebrow \{[^}]*line-height:\s*(\d+(?:\.\d+)?)/.exec(CSS)?.[1]);

/** The margin the shell registers at a window of this width: its left edge from the pane widths the window leaves, the band as the page's. */
const marginAt = (viewport: number): MarginRect => {
  const fit = fitPanes({ viewport });
  return { left: viewport - fit.margin, width: fit.margin, top: 48, bottom: viewport > 1100 ? 860 : 574 };
};
const WINDOWS = [1024, 1093, 1280, 1440, 1920];

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
/** The tab's width as it will be laid out: the width its markup declares, else what its classes make (the label runs down the tab: its left border,
 *  the `py-*` padding on its two sides and a line of the `eyebrow` face — 1 + 4 + 16.1 + 4 = 25.1 for the base's tab, the 25.09 px a browser measured). */
const widthOf = (html: string) => {
  const declared = px(html, "width");
  if (declared !== undefined) return declared;
  const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");
  const pad = Number(/^py-(\d+(?:\.\d+)?)$/.exec(classes.find((c) => /^py-\d/.test(c)) ?? "")?.[1] ?? 0) * 4;
  return 1 + 2 * pad + CAPTION_PX * (classes.includes("leading-none") ? 1 : EYEBROW_LEADING);
};

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

const card = (id: string, kind: FloatingWindow["kind"], order: number): FloatingWindow => ({ id, kind, title: id, order });
const STATES: { name: string; windows: FloatingWindow[]; presses?: number }[] = [
  { name: "a sticky", windows: [card("s1", "sticky", 1)] },
  { name: "the notes window", windows: [card(NOTES_WINDOW_ID, "notes", 1)] },
  { name: "the explain card", windows: [card(EXPLAIN_WINDOW_ID, "explain", 1)] },
  { name: "a figure", windows: [card("figure", "figure", 1)] },
  { name: "the notes window with a figure stacked", windows: [card(NOTES_WINDOW_ID, "notes", 1), card("figure", "figure", 2)] },
  { name: "four cards stacked", windows: [card("s1", "sticky", 1), card(EXPLAIN_WINDOW_ID, "explain", 2), card(NOTES_WINDOW_ID, "notes", 3), card("figure", "figure", 4)] },
  { name: "the notes window shown by the tab's own press", windows: [], presses: 1 },
];

beforeEach(() => {
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: marginAt(1440) });
});
afterEach(() => {
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: null });
});

describe("the tab is clear of the text in every state (P11-34)", () => {
  for (const viewport of WINDOWS) {
    describe(`at ${viewport} px`, () => {
      for (const state of STATES) {
        // Re-aimed (P12-89, E5): "at least 8 px from the text, ending at the margin's left edge" (`left` = the edge, so the tab's face was over the margin divider's strip); the tab now
        // ends `EDGE_TAB_DIVIDER_CLEAR_PX` left of the strip, in the centre's 20 px right padding. The rule it held (clear of the text, counted from the frame's outer edge) is kept at what
        // the padding leaves, 2 px (`CLEAR_PX` above), and the tab is also held clear of the strip.
        it(`${state.name}: clear of the text by the padding's room, ending 2 px left of the margin divider's strip`, async () => {
          const rect = marginAt(viewport);
          useMarginStore.setState({ rect });
          useWindows.setState({ windows: state.windows, clock: state.windows.length });
          const tree = await mountButton(state.presses ?? 0);
          const html = markupOf(tree);

          expect(viewOf(tree).props).toMatchObject({ variant: "edge", beside: true, marginLeft: rect.left });
          const stripLeft = rect.left - DIVIDER_PX;
          const tabRight = px(html, "left")!;
          expect(html).toContain("translateX(-100%)");
          expect(tabRight).toBe(stripLeft - EDGE_TAB_DIVIDER_CLEAR_PX);
          const textRight = rect.left - GUTTER_PX;
          expect(tabRight - widthOf(html) - FRAME_PX - textRight).toBeGreaterThanOrEqual(CLEAR_PX);
        });
      }

      it("no card: on the window's edge, the full tab, far from the text", async () => {
        const rect = marginAt(viewport);
        useMarginStore.setState({ rect });
        const tree = await mountButton(0);
        const html = markupOf(tree);

        expect(viewOf(tree).props).toMatchObject({ beside: false });
        expect(html).toMatch(/\bright-0\b/);
        expect(px(html, "width")).toBeUndefined();
        expect(viewport - rect.left).toBeGreaterThan(0);
      });
    });
  }

  it("a second press closes the window, and the tab is back on the window's edge, full size", async () => {
    useMarginStore.setState({ rect: marginAt(1024) });
    const tree = await mountButton(2);

    expect(viewOf(tree).props).toMatchObject({ shown: false, beside: false });
    expect(markupOf(tree)).toMatch(/\bright-0\b/);
    expect(px(markupOf(tree), "width")).toBeUndefined();
  });

  it("the press is the same one: the narrow tab's onOpen is the page's opener, and it stays a single button named for what it does", async () => {
    useMarginStore.setState({ rect: marginAt(1024) });
    useWindows.setState({ windows: [card("s1", "sticky", 1)], clock: 1 });
    const tree = await mountButton(0);
    const html = markupOf(tree);

    expect(typeof viewOf(tree).props.onOpen).toBe("function");
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Notes<");
  });
});
