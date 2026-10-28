import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P12-77 rule 3 (E2; reader A-r1 in A P12-71's pack, `A12guard-P1-W4` / `-P2-W4`): on the phone, opening notes must keep the reading place.
//
// At 390 x 844 the only way to the notes was the in-flow row near the top of the page. The reader scrolled up to it, and the round trip through
// the notes page ("Back to paper", which restores the place `rememberPlace` recorded at the press) returned them near the top: scrollY 8385 -> 85 and
// 6907 -> 92. At 1440 and 853 the fixed edge tab keeps the place exactly, because it is pressed from where the reader is. So the edge tab is
// offered on a phone too (clamped above the thumb bar: `notes-button.foot.test.tsx`), and a press there GOES TO THE PAGE, as the row does — the opener
// `usePaperNotes` builds without a window opener, which is the one that records the place before it navigates (`remember: openWindow ? undefined : …`,
// `paper-notes.tsx`) — instead of opening the window, which has no margin to stand in under 768 px.
//
// `NotesButton` runs on the minimal hook runtime (no DOM here), as `notes-button.beside.flow.test.tsx` does; the paper-notes hook is replaced by one
// that records which opener was pressed ("window" when it was built with a window opener, "page" when without), the width is `window.matchMedia`
// stubbed for the press, and every text is invented.
const log = vi.hoisted(() => ({ opened: [] as string[], queries: [] as string[], wide: true, has: false }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});
vi.mock("./paper-notes", () => ({
  usePaperNotes: ({ openWindow }: { openWindow?: () => void }) => ({
    ready: true,
    own: log.has ? ({} as never) : undefined,
    citing: [],
    open: () => {
      log.opened.push(openWindow ? "window" : "page");
      openWindow?.();
    },
  }),
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
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import { MASTHEAD_MIN_VIEWPORT_PX } from "@/components/reader/explain-dock";
import { hookRuntime } from "@/test-support/hook-runtime";
import { bottomMarginRectOf, marginRectOf, useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { fitPanes, railMinimumWidth } from "@/components/reader/pane-layout";
import { useWindows } from "@/lib/reader/windows";
import type { Paper } from "@/types";
import { EDGE_TAB_DIVIDER_CLEAR_PX, NotesButton, NotesButtonView, WINDOW_QUERY, opensWindow } from "./notes-button";
import { NotesWindow } from "./notes-window";

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

/** Mount `NotesButton`; each entry of `widths` is one press, made at that width (`true`: md and up), each on the render the last press made. */
async function mountButton(variant: "edge" | "row", widths: boolean[] = []): Promise<ReactNode> {
  const latest = { tree: null as ReactNode };
  await hookRuntime.mount(() => {
    const [step, setStep] = useState(0);
    latest.tree = NotesButton({ variant, paper });
    useEffect(() => {
      if (step < widths.length) {
        log.wide = widths[step];
        (viewOf(latest.tree).props.onOpen as () => void)();
      }
      setStep(step + 1);
    }, [step]);
    return latest.tree;
  });
  return latest.tree;
}

beforeEach(() => {
  log.opened = [];
  log.queries = [];
  log.wide = true;
  log.has = false;
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: null });
  // the browser's `matchMedia`, answering for the width the test says (a function, as the browser's is: read at the press, not at the render)
  vi.stubGlobal("window", {
    matchMedia: (query: string) => {
      log.queries.push(query);
      return { matches: log.wide };
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: null });
});

describe("a press on the edge tab on a phone goes to the notes page (P12-77 rule 3)", () => {
  it("under md the press is the page's opener — the one that records the reader's place — and no window is shown", async () => {
    const tree = await mountButton("edge", [false]);

    expect(log.opened).toEqual(["page"]);
    expect(viewOf(tree).props).toMatchObject({ variant: "edge", shown: false, beside: false });
    expect(elements(tree).some((el) => el.type === NotesWindow)).toBe(false);
  });

  it("from md the press opens the window, as it always did, and the tab stands beside it", async () => {
    const tree = await mountButton("edge", [true]);

    expect(log.opened).toEqual(["window"]);
    expect(viewOf(tree).props).toMatchObject({ shown: true, beside: true });
    expect(elements(tree).some((el) => el.type === NotesWindow)).toBe(true);
  });

  it("is decided at the press: a window that was wide and is now narrow answers for what it is now", async () => {
    await mountButton("edge", [true, false]);

    // the first press opened the window; the second closes it (the tab is its toggle) whatever the width is now
    expect(log.opened).toEqual(["window"]);
    log.opened = [];
    await mountButton("edge", [false, false]);
    expect(log.opened).toEqual(["page", "page"]);
    log.opened = [];
    await mountButton("edge", [false, true]);
    expect(log.opened).toEqual(["page", "window"]);
  });

  it("asks Tailwind's md, 48rem — where the legend, the masthead and the margin begin — and nothing else", async () => {
    await mountButton("edge", [false]);

    expect(WINDOW_QUERY).toBe("(min-width: 48rem)");
    expect(MASTHEAD_MIN_VIEWPORT_PX).toBe(48 * 16);
    expect([...new Set(log.queries)]).toEqual([WINDOW_QUERY]);
  });

  it("the phone's row is still the page's opener, at every width: it never opens the window and never asks for the width", async () => {
    const tree = await mountButton("row", [false, true]);

    expect(log.opened).toEqual(["page", "page"]);
    expect(log.queries).toEqual([]);
    expect(viewOf(tree).props).toMatchObject({ variant: "row", shown: false, beside: false });
  });

  it("with no window to ask (the server, a test) it is the wide screen's answer: the window", () => {
    vi.unstubAllGlobals();

    expect(opensWindow()).toBe(true);
    expect(opensWindow(() => false)).toBe(false);
    expect(opensWindow((query) => query === WINDOW_QUERY)).toBe(true);
  });
});

// P12-77 (ruling §1h.455, item 2): on a phone, with a card standing, the tab stays at the window's right edge and ends 8 px above the band's top.
//
// Under 48rem the page registers the narrow reader's band (`ResponsiveMargin`: `presentation: "bottom"`, left 8, across the foot of the window) and
// `NotesButton` used to hand its `left` to the tab as the margin's left edge: the tab stood "beside" a margin that is not at the right, at
// `left: 8px; translateX(-100%)`, x -7 to 8 (measured on the real markup and stylesheet). Now under md it is not beside anything, and the band's top is
// its foot. From md with a side margin (the rail) the placement is as it was. (Between 768 px and the panes' minimum width the same band is registered; that
// was left beside the card by this ruling and is P12-79's: the describe at the foot of this file.)
const sticky = { id: "s1", kind: "sticky" as const, title: "Note 1", order: 1 };
const BAND: MarginRect = bottomMarginRectOf(390, 844, 1);
const SIDE: MarginRect = { left: 1000, width: 400, top: 48, bottom: 860 };

/** The markup of the tab as `NotesButton` last handed it its props. */
const markupOf = (tree: ReactNode) => renderToStaticMarkup(createElement(NotesButtonView, viewOf(tree).props as Parameters<typeof NotesButtonView>[0]));
const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/);

describe("a card standing on a phone: the tab keeps the right edge and ends above the band (§1h.455 item 2)", () => {
  it("under md, with the band registered and a card standing: not beside it, on the right edge, and its foot is the band's top", async () => {
    log.wide = false;
    useMarginStore.setState({ rect: BAND });
    useWindows.setState({ windows: [sticky], clock: 1 });
    const tree = await mountButton("edge");

    expect(viewOf(tree).props).toMatchObject({ variant: "edge", beside: false, bandTop: BAND.top });
    const html = markupOf(tree);
    expect(classesOf(html)).toContain("right-0");
    expect(html).not.toContain("left:");
    expect(html).not.toContain("translateX");
    expect(html).not.toContain("right-[min(360px,100vw)]");
    expect(html).toContain(`--tab-band-top:${BAND.top}px`);
  });

  it("under md with no card standing: on the right edge, no band written", async () => {
    log.wide = false;
    useMarginStore.setState({ rect: BAND });
    const tree = await mountButton("edge");

    expect(viewOf(tree).props).toMatchObject({ beside: false, bandTop: undefined });
    expect(markupOf(tree)).not.toContain("--tab-band-top:");
  });

  it("under md with a card standing and no band (a side margin, or none): still on the right edge, and no band to end above", async () => {
    log.wide = false;
    useWindows.setState({ windows: [sticky], clock: 1 });
    for (const rect of [SIDE, null]) {
      useMarginStore.setState({ rect });
      const tree = await mountButton("edge");

      expect(viewOf(tree).props, String(rect?.left)).toMatchObject({ beside: false, bandTop: undefined });
      expect(classesOf(markupOf(tree))).toContain("right-0");
    }
  });

  // RE-AIMED by P12-79 (E3). It held two cases from md: the side margin (`SIDE`, left 1000) and the bottom band's left (`BAND`, left 8) "between 768 and
  // 1023", both with the tab BESIDE the card. The second case was the defect E3 names (A P12-78 §6: the tab at x -7 to 8, 8 px of its label showing,
  // at 768 to 851 wide and wherever the reading step pushes the panes' minimum past the window), P12-77 having left it as it was on purpose. The
  // rule is now that a card standing in the bottom band, at any width, is "no side margin" (the describe at the foot of this file pins it). The
  // side-margin case is kept as it was, and the test is renamed to say so.
  // (Renamed again, P12-89, E5: "at the margin's left edge" held `left:${left}px`, the face over the margin divider's strip; it is now just inside the margin, the edge plus
  // `EDGE_TAB_DIVIDER_CLEAR_PX`. Still beside the card, and the band is not written.)
  it("from md with a side margin (the rail) it is placed beside the card, just inside the margin's left edge, and the band is not written", async () => {
    log.wide = true;
    useWindows.setState({ windows: [sticky], clock: 1 });
    for (const [rect, left] of [[SIDE, 1000]] as const) {
      useMarginStore.setState({ rect });
      const tree = await mountButton("edge");

      expect(viewOf(tree).props, String(left)).toMatchObject({ beside: true, marginLeft: left, bandTop: undefined });
      expect(markupOf(tree)).toContain(`left:${left + EDGE_TAB_DIVIDER_CLEAR_PX}px`);
      expect(markupOf(tree)).not.toContain("--tab-band-top:");
    }
  });

  it("the row is never beside a card and never has a band, on a phone or not", async () => {
    log.wide = false;
    useMarginStore.setState({ rect: BAND });
    useWindows.setState({ windows: [sticky], clock: 1 });
    const tree = await mountButton("row");

    expect(viewOf(tree).props).toMatchObject({ variant: "row", beside: false, bandTop: undefined });
    expect(log.queries).toEqual([]);
  });

  it("follows the window across md: it listens for the query's change and lets go on unmount", async () => {
    const calls: string[] = [];
    vi.stubGlobal("window", {
      matchMedia: () => ({
        matches: false,
        addEventListener: (type: string) => calls.push(`add ${type}`),
        removeEventListener: (type: string) => calls.push(`remove ${type}`),
      }),
    });
    const mounted = await hookRuntime.mount(() => NotesButton({ variant: "edge", paper }));

    expect(calls).toEqual(["add change"]);
    mounted.unmount();
    expect(calls).toEqual(["add change", "remove change"]);
  });
});

// P12-79 (E3; A P12-78 §6, measured on the page): with a card standing in the bottom band, the notes tab keeps the right edge at EVERY width.
//
// The page registers the bottom band (`ResponsiveMargin`: `presentation: "bottom"`, left 8) wherever the window is narrower than the panes need,
// `railMinimumWidth(scale)` — 852 px at the default step, 900 at step 1.10, 1,138 at 1.60 — not only under md. From 768 up to that width, and at the
// larger steps beyond it, a standing card is in the band, and `NotesButton` (which stood the tab beside the card whenever the window was not under md)
// put it at `left: 8px; translateX(-100%)`: x -7 to 8, 8 px of the label showing. A measured: 768 to 851 wide at the default step, 853 x 480 from
// step 1.10, 1024 x 576 at step 1.60. The rule is the band's, not the width's: a card standing in a registered bottom band is "no side margin", and
// the tab keeps the right edge and ends 8 px above the band's top (the clamp P12-77 built; `notes-button.foot.test.tsx` holds its arithmetic). Beside a card in
// a side margin (the rail) the placement is unchanged.
//
// The margin each layout registers is worked out here as the page does it (`useSpread`: the window's width against `railMinimumWidth` at the
// reading step; the band `bottomMarginRectOf` at Fit's zoom, which is 1 below the panes; the side margin from the shell's `fitPanes`).
/** The rect the page registers at a window (width x height) and reading step. */
const registeredAt = (width: number, height: number, step: number): MarginRect => {
  if (width < railMinimumWidth(step)) return bottomMarginRectOf(width, height, 1);
  const margin = fitPanes({ viewport: width }).margin;
  return marginRectOf({ left: width - margin, width: margin }, height, 1);
};
const wideAt = (width: number) => width >= MASTHEAD_MIN_VIEWPORT_PX;

describe("a card standing in the bottom band, at any width: the tab keeps the right edge and ends above the band (P12-79 E3)", () => {
  // A's measured cells and the widths around them: [width, height, reading step]. All are 768 px or wider; the band is registered at every one of them.
  const BANDED = [
    [768, 1024, 1], [800, 600, 1], [851, 600, 1], [820, 700, 1], [853, 480, 1.1], [899, 700, 1.1], [1024, 576, 1.6], [1100, 800, 1.6], [1137, 800, 1.6],
  ] as const;
  // …and the layouts that have the side margin (the rail), where the tab stands beside the card as it always did.
  const RAILED = [[852, 700, 1], [853, 480, 1], [1024, 576, 1], [1024, 576, 1.32], [1024, 768, 1], [1440, 900, 1], [900, 700, 1.1], [1138, 700, 1.6]] as const;

  it("the numbers behind the table: the panes' minimum is 852 at step 1.00, 900 at 1.10, 1,138 at 1.60 — and 1,005 at 1.32, where 1024 has the rail", () => {
    expect([1, 1.1, 1.6, 1.32].map(railMinimumWidth)).toEqual([852, 900, 1138, 1005]);
    for (const [w, h, step] of BANDED) expect(registeredAt(w, h, step).presentation, `${w} x ${h} step ${step}`).toBe("bottom");
    for (const [w, h, step] of RAILED) expect(registeredAt(w, h, step).presentation, `${w} x ${h} step ${step}`).toBeUndefined();
  });

  it.each(BANDED)("%i x %i at step %f: a sticky standing — not beside it, the right edge, no left offset, the band's top written (both labels)", async (width, height, step) => {
    log.wide = wideAt(width);
    const band = registeredAt(width, height, step);
    useMarginStore.setState({ rect: band });
    useWindows.setState({ windows: [sticky], clock: 1 });
    for (const has of [false, true]) {
      log.has = has;
      const tree = await mountButton("edge");
      const html = markupOf(tree);

      expect(viewOf(tree).props, `has ${has}`).toMatchObject({ variant: "edge", beside: false, bandTop: band.top });
      expect(classesOf(html)).toContain("right-0");
      expect(html).not.toContain("left:");
      expect(html).not.toContain("translateX");
      expect(html).not.toContain("width:");
      expect(html).not.toContain("right-[min(360px,100vw)]");
      expect(html).toContain(`--tab-band-top:${band.top}px`);
    }
  });

  it.each(BANDED)("%i x %i at step %f: the notes window shown from the tab is a card in the band too — same place, even before it registers in the stack", async (width, height, step) => {
    log.wide = wideAt(width);
    const band = registeredAt(width, height, step);
    useMarginStore.setState({ rect: band });
    // one press from md opens the window (`shown`); the hook runtime mounts no `NotesWindow`, so nothing is in the stack yet (the frame before it registers)
    const tree = await mountButton("edge", [true]);
    const html = markupOf(tree);

    expect(log.opened).toEqual(["window"]);
    expect(viewOf(tree).props).toMatchObject({ shown: true, beside: false, bandTop: band.top });
    expect(classesOf(html)).toContain("right-0");
    expect(html).not.toContain("left:");
    expect(html).toContain(`--tab-band-top:${band.top}px`);
  });

  it.each(BANDED)("%i x %i at step %f: with no card standing the band is not written and the tab is on the right edge, as it always was", async (width, height, step) => {
    log.wide = wideAt(width);
    useMarginStore.setState({ rect: registeredAt(width, height, step) });
    const tree = await mountButton("edge");

    expect(viewOf(tree).props).toMatchObject({ beside: false, bandTop: undefined });
    expect(classesOf(markupOf(tree))).toContain("right-0");
    expect(markupOf(tree)).not.toContain("--tab-band-top:");
    expect(markupOf(tree)).not.toContain("left:");
  });

  it("every kind of card that stands in the stack is a card in the band: sticky, explain, figure, highlight, notes", async () => {
    log.wide = true;
    const band = registeredAt(800, 600, 1);
    useMarginStore.setState({ rect: band });
    for (const kind of ["sticky", "explain", "figure", "highlight", "notes"] as const) {
      useWindows.setState({ windows: [{ id: `${kind}-1`, kind, title: kind, order: 1 }], clock: 1 });
      const tree = await mountButton("edge");

      expect(viewOf(tree).props, kind).toMatchObject({ beside: false, bandTop: band.top });
    }
  });

  // Re-aimed (P12-89, E5): it held `left:${rect.left}px` and `translateX(-100%)` (the face over the margin divider's strip); the tab is beside the card still, and now
  // just inside the margin's left edge: the edge plus `EDGE_TAB_DIVIDER_CLEAR_PX`, with no translation.
  it.each(RAILED)("%i x %i at step %f: a side margin (the rail) — beside the card, just inside the margin's left edge, and no band written", async (width, height, step) => {
    log.wide = true;
    const rect = registeredAt(width, height, step);
    useMarginStore.setState({ rect });
    useWindows.setState({ windows: [sticky], clock: 1 });
    const tree = await mountButton("edge");
    const html = markupOf(tree);

    expect(viewOf(tree).props).toMatchObject({ beside: true, marginLeft: rect.left, bandTop: undefined });
    expect(html).toContain(`left:${rect.left + EDGE_TAB_DIVIDER_CLEAR_PX}px`);
    expect(html).not.toContain("translateX");
    expect(html).not.toContain("--tab-band-top:");
    expect(classesOf(html)).not.toContain("right-0");
  });

  it("one pixel either side of the panes' minimum: 851 is the band (right edge), 852 the rail (beside the card), at step 1.00", async () => {
    log.wide = true;
    useWindows.setState({ windows: [sticky], clock: 1 });
    for (const [width, beside] of [[851, false], [852, true]] as const) {
      useMarginStore.setState({ rect: registeredAt(width, 700, 1) });
      const tree = await mountButton("edge");

      expect(viewOf(tree).props, `${width}`).toMatchObject({ beside });
    }
  });

  it("the row is never beside a card and has no band, at any width", async () => {
    log.wide = true;
    useMarginStore.setState({ rect: registeredAt(800, 600, 1) });
    useWindows.setState({ windows: [sticky], clock: 1 });
    const tree = await mountButton("row");

    expect(viewOf(tree).props).toMatchObject({ variant: "row", beside: false, bandTop: undefined });
  });
});
