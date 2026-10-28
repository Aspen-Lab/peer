import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P12-89 (E5): what FEEDS the tab its place beside a card — `NotesButton` mounted on the minimal hook runtime (no DOM), as `notes-button.beside.flow.test.tsx` does.
// `notes-button.divider.test.tsx` holds the arithmetic on the view; this holds the wiring: that the header rows of the cards that stand are read from the page (a
// stand-in `document` whose cards have boxes), that they are read again when the stack or the margin changes and when the window is scrolled or resized, that the
// tab's top follows them, and that nothing is read where the tab is not beside a card. Every text and every box is invented.
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
import { hookRuntime } from "@/test-support/hook-runtime";
import { bottomMarginRectOf, marginRectOf, useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import type { Paper } from "@/types";
import { EDGE_TAB_DIVIDER_CLEAR_PX, EDGE_TAB_HEADER_CLEAR_PX, EDGE_TAB_LENGTH_PX, NotesButton, NotesButtonView } from "./notes-button";

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

/** Every tab mounted in a test, so that none outlives it: the stores are the page's, and a tab left subscribed would read the next test's page. */
const mounts: { unmount: () => void }[] = [];
async function mountButton() {
  const latest = { tree: null as ReactNode };
  const mounted = await hookRuntime.mount(() => {
    const [step, setStep] = useState(0);
    latest.tree = NotesButton({ variant: "edge", paper });
    useEffect(() => {
      setStep(step + 1);
    }, [step]);
    return latest.tree;
  });
  mounts.push(mounted);
  return { ...mounted, tree: () => latest.tree };
}

// ── A page to read: cards with boxes, a window that records its listeners, frames that run when asked ─────────────────────────────────────

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
interface Fake {
  cards: unknown[];
  reads: number;
  listeners: Map<string, Set<unknown>>;
  /** Frames waiting to run, where `hold` is set; else a frame runs the moment it is asked for. */
  frames: (() => void)[];
  hold: boolean;
}
let fake: Fake;
const fakeCard = (kind: string, outer: ReturnType<typeof box>, header: ReturnType<typeof box>) => ({
  getBoundingClientRect: () => outer,
  getAttribute: (name: string) => (name === "data-margin-card" ? kind : null),
  firstElementChild: { getBoundingClientRect: () => header, childNodes: [], children: [] },
  querySelector: () => null,
  querySelectorAll: () => [],
});
const runFrames = () => {
  const pending = fake.frames.splice(0);
  for (const run of pending) run();
};

/** The margin of a 1440 x 900 window: the rail's, level with the shell's 360 px track. */
const MARGIN: MarginRect = marginRectOf({ left: 1080, width: 360 }, 900, 1);
const sticky = { id: "s1", kind: "sticky" as const, title: "Note 1", order: 1 };
const global = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  fake = { cards: [], reads: 0, listeners: new Map(), frames: [], hold: false };
  global.document = {
    querySelectorAll: () => {
      fake.reads++;
      return fake.cards;
    },
  };
  global.window = {
    innerHeight: 900,
    innerWidth: 1440,
    addEventListener: (type: string, fn: unknown) => {
      if (!fake.listeners.has(type)) fake.listeners.set(type, new Set());
      fake.listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: unknown) => {
      fake.listeners.get(type)?.delete(fn);
    },
  };
  global.requestAnimationFrame = (run: () => void) => {
    if (fake.hold) fake.frames.push(run);
    else run();
    return 1;
  };
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: MARGIN });
});
afterEach(() => {
  for (const mounted of mounts.splice(0)) mounted.unmount();
  delete global.document;
  delete global.window;
  delete global.requestAnimationFrame;
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: null });
});

describe("NotesButton lowers the tab below a card's header (P12-89, E5)", () => {
  it("a sticky whose header stands under the tab's usual place (450 to 596 at 1440 x 900): the tab stands below the header, at the same x", async () => {
    useWindows.setState({ windows: [sticky], clock: 1 });
    fake.cards = [fakeCard("sticky", box(1080, 430, 1440, 690), box(1081, 431, 1439, 471))];
    const mounted = await mountButton();
    const html = markupOf(mounted.tree());

    expect(viewOf(mounted.tree()).props).toMatchObject({ beside: true, marginLeft: 1080, clearTop: 471 + EDGE_TAB_HEADER_CLEAR_PX });
    expect(px(html, "top")).toBe(475);
    expect(px(html, "left")).toBe(1080 + EDGE_TAB_DIVIDER_CLEAR_PX);
  });

  it("a header above the tab, or below it, or none: the tab keeps its class's place and writes no top", async () => {
    useWindows.setState({ windows: [sticky], clock: 1 });
    for (const header of [box(1081, 101, 1439, 141), box(1081, 630, 1439, 670)]) {
      fake.cards = [fakeCard("sticky", box(1080, header.top - 1, 1440, header.top + 259), header)];
      const mounted = await mountButton();

      expect(viewOf(mounted.tree()).props.clearTop, `header at ${header.top}`).toBeUndefined();
      expect(markupOf(mounted.tree())).not.toMatch(/[;"]top:/);
      mounted.unmount();
    }
    fake.cards = [];
    const none = await mountButton();
    expect(viewOf(none.tree()).props.clearTop).toBeUndefined();
  });

  it("a stack of three cards: below the last header the tab meets", async () => {
    useWindows.setState({ windows: [sticky, { ...sticky, id: "s2", order: 2 }, { ...sticky, id: "s3", order: 3 }], clock: 3 });
    fake.cards = [
      fakeCard("sticky", box(1080, 400, 1440, 440), box(1081, 400, 1439, 440)),
      fakeCard("sticky", box(1080, 440, 1440, 480), box(1081, 440, 1439, 480)),
      fakeCard("sticky", box(1080, 480, 1440, 720), box(1081, 480, 1439, 520)),
    ];
    const mounted = await mountButton();

    expect(viewOf(mounted.tree()).props.clearTop).toBe(520 + EDGE_TAB_HEADER_CLEAR_PX);
  });

  it("reads the page when the tab stands beside a card and re-reads it when the stack, the margin or the window changes", async () => {
    useWindows.setState({ windows: [sticky], clock: 1 });
    fake.cards = [fakeCard("sticky", box(1080, 100, 1440, 360), box(1081, 101, 1439, 141))];
    const mounted = await mountButton();
    const first = fake.reads;

    expect(first).toBeGreaterThan(0);
    useWindows.setState({ windows: [sticky, { ...sticky, id: "s2", title: "Note 2", order: 2 }], clock: 2 });
    const second = fake.reads;
    useMarginStore.setState({ rect: { ...MARGIN, left: 1060, width: 380 } });
    const third = fake.reads;
    for (const type of ["resize", "scroll"]) for (const fn of fake.listeners.get(type) ?? []) (fn as () => void)();

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(fake.reads).toBeGreaterThan(third);
    expect([...fake.listeners.keys()].sort()).toEqual(["resize", "scroll"]);

    // a burst of changes inside one frame is one read
    fake.hold = true;
    const before = fake.reads;
    useWindows.setState({ clock: 5 });
    useWindows.setState({ clock: 6 });
    useWindows.setState({ clock: 7 });
    runFrames();
    expect(fake.reads - before).toBe(1);

    // gone: every listener removed, and a frame that was waiting reads nothing
    useWindows.setState({ clock: 8 });
    mounted.unmount();
    expect([...fake.listeners.values()].every((set) => set.size === 0), "every listener is removed").toBe(true);
    const after = fake.reads;
    runFrames();
    useWindows.setState({ clock: 9 });
    runFrames();
    expect(fake.reads, "nothing is read once the tab is gone").toBe(after);
  });

  it("reads nothing where the tab is not beside a card: no card, a bottom band, no margin registered", async () => {
    fake.cards = [fakeCard("sticky", box(1080, 100, 1440, 360), box(1081, 101, 1439, 141))];
    // no card standing
    let mounted = await mountButton();
    expect(fake.reads, "no card").toBe(0);
    mounted.unmount();

    // a card standing in the bottom band: the tab is on the window's right edge, not beside it
    useWindows.setState({ windows: [sticky], clock: 1 });
    useMarginStore.setState({ rect: bottomMarginRectOf(853, 480, 1) });
    mounted = await mountButton();
    expect(fake.reads, "the bottom band").toBe(0);
    expect(viewOf(mounted.tree()).props).toMatchObject({ beside: false, clearTop: undefined });
    mounted.unmount();

    // a card standing and no margin registered: the card's 360 px, the tab left of it, no divider there
    useMarginStore.setState({ rect: null });
    mounted = await mountButton();
    expect(fake.reads, "no margin").toBe(0);
    expect(viewOf(mounted.tree()).props).toMatchObject({ beside: true, clearTop: undefined });
  });

  it("without a page to read (the server, a test with no DOM) there is nothing to read and the tab keeps its class's place", async () => {
    delete global.document;
    useWindows.setState({ windows: [sticky], clock: 1 });
    const mounted = await mountButton();

    expect(viewOf(mounted.tree()).props).toMatchObject({ beside: true, marginLeft: 1080, clearTop: undefined });
    expect(fake.reads).toBe(0);
    expect(EDGE_TAB_LENGTH_PX.open).toBe(146);
  });
});
