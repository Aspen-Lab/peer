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
const log = vi.hoisted(() => ({ opened: [] as string[], queries: [] as string[], wide: true }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});
vi.mock("./paper-notes", () => ({
  usePaperNotes: ({ openWindow }: { openWindow?: () => void }) => ({
    ready: true,
    own: undefined,
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

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { MASTHEAD_MIN_VIEWPORT_PX } from "@/components/reader/explain-dock";
import { hookRuntime } from "@/test-support/hook-runtime";
import { useMarginStore } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import type { Paper } from "@/types";
import { NotesButton, NotesButtonView, WINDOW_QUERY, opensWindow } from "./notes-button";
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
