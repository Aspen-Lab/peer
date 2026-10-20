import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-14 (A P11-19, C1): the Notes tab stands BESIDE the cards. `NotesButtonView` takes `beside` and `marginLeft`; `NotesButton` is what
// feeds them — `beside` while a card stands in the stack or the notes window is shown (the edge tab only), `marginLeft` from the margin's
// rect — and nothing pinned that wiring: a button that always said `beside={false}` (or never passed the rect) left every test green, and
// the tab stood under the cards (`z-40` against their `z-60`). `notes-button.test.tsx` pins the view's markup; this pins what feeds it.
//
// `NotesButton` runs on the minimal hook runtime (no DOM here), as the stack's flow tests do: it is mounted, its element tree is inspected
// and the tab's own `onClick` is called. zustand's hook is an external module that imports the real React, which has no dispatcher in this
// runtime, so the two hooks `NotesButton` reads the stack and the margin with are replaced by a read of the REAL stores' state at that
// render (`useWindows`, `useMarginStore` are set below exactly as the page sets them); the paper-notes hook (router, notes store) is
// replaced by one whose `open` calls the window opener it was given, as the real one does for the edge tab. Every text is invented.
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
import { useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import type { Paper } from "@/types";
import { NotesButton, NotesButtonView } from "./notes-button";

const paper: Paper = {
  id: "openalex:W1", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw.",
  summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

/** The margin a shell would register: 400 px wide at the right, its left edge at 1000. */
const MARGIN: MarginRect = { left: 1000, width: 400, top: 48, bottom: 860 };

type Props2 = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}

/** The view the button hands its props to, on the tree's last render. */
const viewOf = (tree: ReactNode) => {
  const view = elements(tree).find((el) => el.type === NotesButtonView);
  if (!view) throw new Error("NotesButton rendered no NotesButtonView");
  return view;
};
const markupOf = (tree: ReactNode) => renderToStaticMarkup(createElement(NotesButtonView, viewOf(tree).props as Parameters<typeof NotesButtonView>[0]));

/** Mount `NotesButton`; the reader then presses the tab `presses` times, each on the render the last press made. Returns the last render's tree. */
async function mountButton(variant: "edge" | "row", presses = 0): Promise<ReactNode> {
  let last: ReactNode = null;
  await hookRuntime.mount(() => {
    const [step, setStep] = useState(0);
    const tree = NotesButton({ variant, paper });
    last = tree;
    useEffect(() => {
      if (step < presses) (viewOf(tree).props.onOpen as () => void)();
      setStep(step + 1);
    }, [step]);
    return tree;
  });
  return last;
}

beforeEach(() => {
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: MARGIN });
});
afterEach(() => {
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: null });
});

const sticky = { id: "s1", kind: "sticky" as const, title: "Note 1", order: 1 };

describe("NotesButton feeds the tab its place (P11-14, A P11-19 C1)", () => {
  it("with a card standing in the stack and a margin registered, the tab stands at the margin's left edge, beside the card", async () => {
    useWindows.setState({ windows: [sticky], clock: 1 });
    const tree = await mountButton("edge");

    expect(viewOf(tree).props).toMatchObject({ variant: "edge", beside: true, marginLeft: 1000, shown: false });
    const html = markupOf(tree);
    expect(html).toContain("left:1000px");
    expect(html).toContain("translateX(-100%)");
    expect(html).not.toMatch(/\bright-0\b/);
  });

  it("with no card standing, the tab is on the window's edge, whatever the margin", async () => {
    const tree = await mountButton("edge");

    expect(viewOf(tree).props).toMatchObject({ variant: "edge", beside: false, shown: false });
    const html = markupOf(tree);
    expect(html).toMatch(/\bright-0\b/);
    expect(html).not.toContain("left:");
  });

  it("with a card standing and no margin registered (no shell, or under 1024 px), the tab stands at the card's 360 px from the right edge", async () => {
    useMarginStore.setState({ rect: null });
    useWindows.setState({ windows: [sticky], clock: 1 });
    const tree = await mountButton("edge");

    expect(viewOf(tree).props).toMatchObject({ beside: true, marginLeft: undefined });
    const html = markupOf(tree);
    expect(html).toContain("right-[min(360px,100vw)]");
    expect(html).not.toContain("left:");
  });

  it("the notes window shown alone is a card beside which the tab stands", async () => {
    // Nothing in the stack yet: the tab's press opens the window (`shown`), and the tab already stands beside where it will be.
    const tree = await mountButton("edge", 1);

    expect(viewOf(tree).props).toMatchObject({ variant: "edge", shown: true, beside: true, marginLeft: 1000 });
    const html = markupOf(tree);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("left:1000px");
    expect(html).not.toMatch(/\bright-0\b/);
  });

  it("a second press closes the window, and the tab is back on the window's edge", async () => {
    const tree = await mountButton("edge", 2);

    expect(viewOf(tree).props).toMatchObject({ variant: "edge", shown: false, beside: false });
    expect(markupOf(tree)).toMatch(/\bright-0\b/);
  });

  it("the phone's row is never beside anything, with a card standing or not", async () => {
    useWindows.setState({ windows: [sticky], clock: 1 });
    const tree = await mountButton("row");

    expect(viewOf(tree).props).toMatchObject({ variant: "row", beside: false, shown: false });
  });
});
