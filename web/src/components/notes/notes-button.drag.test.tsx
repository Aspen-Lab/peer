import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same runtime as `notes-button.clear.flow.test.tsx`, for the flow block at the foot: the minimal hook runtime, the real stores read in place of
// zustand's hooks, the paper-notes hook replaced by one whose `open` calls the window opener. The view-level blocks above it use no hook.
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
import { fitPanes } from "@/components/reader/pane-layout";
import { hookRuntime } from "@/test-support/hook-runtime";
import { useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { EXPLAIN_WINDOW_ID, NOTES_WINDOW_ID, useWindows, type FloatingWindow } from "@/lib/reader/windows";
import type { Paper } from "@/types";
import { DIVIDER_PX } from "@/components/reader/pane-layout";
import { EDGE_TAB_BESIDE_PX, EDGE_TAB_DIVIDER_CLEAR_PX, EDGE_TAB_HIT_PX, NotesButton, NotesButtonView } from "./notes-button";

// P11-46 (round 3, Theme B walk, E-1; ruling §1h.148): the edge tab's transparent hit strip (P11-34, `before:`, 9 px on the text's side) begins
// at the text column's right edge. With a card open at 1024 to 1366 px the gutter between that edge and the margin is 24 px, so the strip lies
// within 0 to 9 px of the line ends, and the face within 9 to 24: a drag that goes along a line and is released 1 to 23 px past its end — as a drag
// along a line does — is released over the tab. The browser then ends the selection at the tab's place in the document, the end of the paper:
// 48,483 characters at 1280 x 720 in the owner's paper, with no buttons offered (`getSelection` is far over the 1,200-character cap).
//
// The rule: the tab never catches a drag that began in the paper. It may only be pressed. A pointer that went down outside the tab — above all one
// that went down in the text — passes through it (`pointer-events: none`, which the strip, a child of the tab, inherits), so the selection ends at
// the line's end as it would with no tab there; a pointer that goes down on the tab, its face or its strip, is the tab's, as it was.
//
// The means is CSS, not a listener: while any pointer is held (`:root:active` — `:active` matches the pressed element and every ancestor) and the
// tab is not the pressed element (`&:not(:active)` — a press on the tab, its label or its strip, a pseudo-element whose state is its element's,
// leaves the tab `:active`), the tab ignores the pointer. The browser clears `:active` on release, on cancel and when the window loses the pointer,
// so no state of ours can stay stuck and leave the tab dead. There is no DOM in this suite, so the cascade cannot be run; what can be held is the
// rule as the markup states it, read as the cascade reads it (`appliesTo` below), against each press the reader can make. The browser runs are in
// the checkpoint (real drags 1, 3, 6 and 9 px past a line's end at four windows, both themes, and real and touch presses on the tab).

const view = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: true, onOpen: () => {}, ...props } as never));
/** The element's classes as the browser reads them: the markup writes `&` in an attribute as `&amp;`, and the tab's variant has one. */
const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? "").replace(/&amp;/g, "&").split(" ").filter(Boolean);

/** The arbitrary variant the tab's pass-through is written with, `[<selector>]:pointer-events-none`, as the selector with its spaces back (`_`). */
const PASS = /^\[(.+)\]:pointer-events-none$/;
const passVariants = (html: string) => classesOf(html).flatMap((c) => (PASS.exec(c) ? [PASS.exec(c)![1].replace(/_/g, " ")] : []));

/** What the cascade knows of a press: `:active` is on the element pressed and on every ancestor of it, so on the root always; on the tab only if it is the pressed one. */
interface Gesture { name: string; rootActive: boolean; tabActive: boolean }
const GESTURES = {
  none: { name: "no pointer is down", rootActive: false, tabActive: false },
  text: { name: "a pointer went down on the paper's text", rootActive: true, tabActive: false },
  elsewhere: { name: "a pointer went down on a card's control", rootActive: true, tabActive: false },
  face: { name: "a pointer went down on the tab's face", rootActive: true, tabActive: true },
  strip: { name: "a pointer went down on the tab's transparent strip (its ::before: the tab is its originating element)", rootActive: true, tabActive: true },
} satisfies Record<string, Gesture>;

/**
 * Does `selector` (the variant, `&` the tab) match the tab in this gesture? Only the shapes the tab's rule is written in are understood — an ancestor
 * compound (`:root:active`, `html:active`, `body:active`) then the tab's own (`&`, `&:active`, `&:not(:active)`) — and any other is an error, so a rule
 * written another way must be taught to this reader (and so read again) before it can pass.
 */
function appliesTo(selector: string, gesture: Gesture): boolean {
  const parts = selector.split(" ");
  expect(parts.length, `"${selector}" is an ancestor compound and the tab's own`).toBe(2);
  const [ancestor, own] = parts;
  const ancestorRule = /^(:root|html|body):active$/.exec(ancestor);
  if (!ancestorRule) throw new Error(`unread ancestor "${ancestor}" in "${selector}"`);
  const ownRule = /^&(:not\(:active\)|:active)?$/.exec(own);
  if (!ownRule) throw new Error(`unread own compound "${own}" in "${selector}"`);
  const ownOk = ownRule[1] === ":not(:active)" ? !gesture.tabActive : ownRule[1] === ":active" ? gesture.tabActive : true;
  return gesture.rootActive && ownOk;
}
/** The tab ignores the pointer in this gesture: some pass-through variant it carries applies. */
const passesThrough = (html: string, gesture: Gesture) => passVariants(html).some((selector) => appliesTo(selector, gesture));

/** The states the page can put the edge tab in: no card, beside a card at the margin the shell gives at each window, shown by its own press, with and without a note. */
const STATES: { name: string; props: Record<string, unknown> }[] = [
  { name: "no card, on the window's edge", props: { beside: false, marginLeft: 1080 } },
  { name: "beside a card at 1024 px", props: { beside: true, marginLeft: 744 } },
  { name: "beside a card at 1093 px", props: { beside: true, marginLeft: 784 } },
  { name: "beside a card at 1280 px", props: { beside: true, marginLeft: 920 } },
  { name: "beside a card at 1366 px", props: { beside: true, marginLeft: 1006 } },
  { name: "beside a card at 1440 px", props: { beside: true, marginLeft: 1080 } },
  { name: "beside a card with no margin registered (under 1024 px)", props: { beside: true } },
  { name: "the notes window shown by its own press", props: { beside: true, marginLeft: 920, shown: true } },
  { name: "the paper has no note of its own yet", props: { beside: true, marginLeft: 920, has: false } },
];

describe("a drag that began in the paper is not caught by the tab (P11-46, §1h.148)", () => {
  it.each(STATES)("$name: the tab ignores a pointer that went down on the text, and on any other control that is not the tab", ({ props }) => {
    const html = view(props);

    expect(passVariants(html), "the tab carries a pass-through rule").not.toHaveLength(0);
    expect(passesThrough(html, GESTURES.text), GESTURES.text.name).toBe(true);
    expect(passesThrough(html, GESTURES.elsewhere), GESTURES.elsewhere.name).toBe(true);
  });

  it.each(STATES)("$name: a press on the tab — its face or its strip — is the tab's, as it was; and with no pointer down it takes the pointer as it did", ({ props }) => {
    const html = view(props);

    expect(passesThrough(html, GESTURES.face), GESTURES.face.name).toBe(false);
    expect(passesThrough(html, GESTURES.strip), GESTURES.strip.name).toBe(false);
    expect(passesThrough(html, GESTURES.none), GESTURES.none.name).toBe(false);
  });

  it("the rule is the tab's own, not the strip's: a drag released over the face (9 to 24 px past the line's end) is as much a drag as one over the strip", () => {
    const html = view({ beside: true, marginLeft: 744 });

    // on the button, whose `pointer-events` its strip and its label inherit; never as a `before:` / `after:` variant, which would leave the face catching the drag
    expect(classesOf(html).some((c) => /(^|:)before:|(^|:)after:/.test(c) && /pointer-events/.test(c))).toBe(false);
    // and nothing gives the strip its pointer back
    expect(html).not.toMatch(/pointer-events-auto/);
  });

  it("the pass-through names the press it waits for: a held pointer on the document, not a hover, a focus or the tab's own state alone", () => {
    for (const { props } of STATES) {
      for (const selector of passVariants(view(props))) {
        expect(selector).toMatch(/^(:root|html|body):active /);
        expect(selector).not.toMatch(/:hover|:focus/);
      }
    }
  });

  it("the phone's row is a plain button in the command stack and ignores no pointer", () => {
    const html = view({ variant: "row" });

    expect(passVariants(html)).toHaveLength(0);
    // (the row keeps the button face's own `disabled:pointer-events-none`, which is not a press's)
    expect(html).not.toMatch(/:active_&|:root:active|html:active/);
  });
});

describe("pressing the tab is as it was (P11-46)", () => {
  // Re-aimed (P12-89, E5): 24 px across (the 15 px face and a 9 px strip, `before:-left-[10px]`, `before:w-[9px]`) in the 24 px gutter, where the face stood over the margin divider. The tab stands in the
  // centre's 20 px right padding now, 2 px left of the divider's strip, and the strip beside the face is what is left of the padding: 3 px (`before:-left-[4px]`, `before:w-[3px]`), ending at the
  // text's right edge, never past it: 18 px across. Still on the text's side, still placed from the padding edge by the face's width and its 1 px border.
  it("the hit area is 18 px across beside a card: the 15 px face and a 3 px strip on the text's side", () => {
    const html = view({ beside: true, marginLeft: 744 });

    expect(EDGE_TAB_HIT_PX).toBe(18);
    expect(EDGE_TAB_BESIDE_PX).toBe(15);
    expect(html).toContain("before:absolute");
    expect(html).toContain("before:-left-[4px]");
    expect(html).toContain("before:w-[3px]");
    expect(html).toMatch(/[;"]width:15px/);
  });

  it("is still one button that opens and closes the window: its press, its state and its place are untouched", () => {
    const html = view({ beside: true, marginLeft: 744, shown: true });

    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('type="button"');
    // (re-aimed, P12-89: its right edge is the divider's strip's left edge less the clear, so `left` is 744 less the 12 px strip less 2 px; the translation is as it was)
    expect(html).toContain(`left:${744 - DIVIDER_PX - EDGE_TAB_DIVIDER_CLEAR_PX}px`);
    expect(html).toContain("translateX(-100%)");
    expect(html).not.toContain("tabindex");
    expect(classesOf(html)).toContain("z-40");
  });

  it("the tab with no card keeps its place and its size: the window's edge, the 25 px tab, no strip, and the same pass-through", () => {
    const html = view({ beside: false, marginLeft: 1080 });
    const classes = classesOf(html);

    expect(html).not.toContain("style=");
    expect(classes).toContain("right-0");
    expect(classes).toContain("px-3");
    expect(classes).toContain("py-1");
    expect(html).not.toMatch(/before:w-\[/);
    expect(passesThrough(html, GESTURES.text)).toBe(true);
    expect(passesThrough(html, GESTURES.face)).toBe(false);
  });
});

// The flow: the same rule where the page feeds the view — `NotesButton` mounted with each kind of card standing, with several stacked and with the
// window shown by the tab's own press, at the windows whose gutter is 24 px (the defect's) and at 1440, where the strip was already clear. Every
// text is invented.

const paper: Paper = {
  id: "openalex:W1", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw.",
  summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

const marginAt = (viewport: number): MarginRect => {
  const fit = fitPanes({ viewport });
  return { left: viewport - fit.margin, width: fit.margin, top: 48, bottom: viewport > 1100 ? 860 : 574 };
};
const WINDOWS = [1024, 1093, 1280, 1366, 1440];

type Props2 = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}
const viewOf = (tree: ReactNode) => {
  const found = elements(tree).find((el) => el.type === NotesButtonView);
  if (!found) throw new Error("NotesButton rendered no NotesButtonView");
  return found;
};
const markupOf = (tree: ReactNode) => renderToStaticMarkup(createElement(NotesButtonView, viewOf(tree).props as Parameters<typeof NotesButtonView>[0]));

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
const FLOW_STATES: { name: string; windows: FloatingWindow[]; presses?: number }[] = [
  { name: "a sticky", windows: [card("s1", "sticky", 1)] },
  { name: "the notes window", windows: [card(NOTES_WINDOW_ID, "notes", 1)] },
  { name: "the explain card", windows: [card(EXPLAIN_WINDOW_ID, "explain", 1)] },
  { name: "a figure", windows: [card("figure", "figure", 1)] },
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

describe("the page's tab ignores a drag that began in the paper in every state (P11-46)", () => {
  for (const viewport of WINDOWS) {
    describe(`at ${viewport} px`, () => {
      for (const state of FLOW_STATES) {
        it(`${state.name}: passes a pointer that went down on the text, keeps a press on its face and its strip`, async () => {
          useMarginStore.setState({ rect: marginAt(viewport) });
          useWindows.setState({ windows: state.windows, clock: state.windows.length });
          const tree = await mountButton(state.presses ?? 0);
          const html = markupOf(tree);

          expect(viewOf(tree).props).toMatchObject({ variant: "edge", beside: true });
          expect(passesThrough(html, GESTURES.text), GESTURES.text.name).toBe(true);
          expect(passesThrough(html, GESTURES.face), GESTURES.face.name).toBe(false);
          expect(passesThrough(html, GESTURES.strip), GESTURES.strip.name).toBe(false);
          // the press itself is the page's opener and the strip that gives the 24 px back is still there
          expect(typeof viewOf(tree).props.onOpen).toBe("function");
          expect(html).toContain(`before:w-[${EDGE_TAB_HIT_PX - EDGE_TAB_BESIDE_PX}px]`);
        });
      }

      it("no card: on the window's edge, full size, the same rule", async () => {
        useMarginStore.setState({ rect: marginAt(viewport) });
        const tree = await mountButton(0);
        const html = markupOf(tree);

        expect(viewOf(tree).props).toMatchObject({ beside: false });
        expect(passesThrough(html, GESTURES.text)).toBe(true);
        expect(passesThrough(html, GESTURES.face)).toBe(false);
      });
    });
  }

  it("a second press closes the window, and the tab on the window's edge carries the rule too", async () => {
    useMarginStore.setState({ rect: marginAt(1024) });
    const tree = await mountButton(2);
    const html = markupOf(tree);

    expect(viewOf(tree).props).toMatchObject({ shown: false, beside: false });
    expect(passesThrough(html, GESTURES.text)).toBe(true);
    expect(passesThrough(html, GESTURES.face)).toBe(false);
  });
});
