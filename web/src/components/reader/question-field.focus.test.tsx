import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P9-07 (B, round P9 Theme 2; the feature walk's X1): two questions settled with Enter once became ONE
// line — `…many cycles?How does crack density…`, no separator, one "Not for recommendations" box, a
// settled set of one item. Nothing in the field joins two lines (`oneLine` puts a space, the store
// `cleanQuestions` trims, drops, dedupes and cuts each item on its own; `removeLine` only removes; the
// debounce hook never writes to the store). What joined them was the typing: Enter had added line 2
// but the focus stayed on line 1, so the next question was inserted at the end of line 1.
//
// Why the focus stayed: Enter hands it over through a ref, `pendingFocus`, that a `useEffect` with no
// dependency reads after every render. React runs a render's passive effects as a task of their own;
// the page re-renders ~250 ms after the typing pauses (`useDebouncedQuestions`) and takes ~300 ms
// to do it, and an Enter that arrives while that render is running is handled right after its commit,
// BEFORE its passive effects. The handler sets `pendingFocus`; React then flushes the earlier commit's
// effects, which read it, find no line 2 yet (`inputs.current[1]` is unset), and clear it; the render
// that adds line 2 has nothing left to focus. (Reproduced on real React in Chromium, the 19.2.4 of
// package.json and the 19.3.0-canary Next vendors: Enter within [250 ms, 250 ms + the page render] of
// the last keystroke; this runtime keeps the three steps apart so the order can be set — see
// `test-support/staged-runtime.ts`.)
//
// No DOM: a "textarea" here is an object the ref callbacks are given when a render commits, whose
// `focus()` says which line gets the next typing. Every question is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  return { ...actual, ...stagedRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { defaultProfile } from "@/types";
import { MAX_QUESTION_CHARS, useReadingQuestionsStore } from "@/store/reading-questions";
import { useProfileStore } from "@/store/profile";
import { QuestionField } from "./question-field";

const PAPER = "upload:aaaaaaaaaaaaaaaa";
const Q1 = "Does the textured film keep its capacity after many cycles?";
const Q2 = "How does crack density change with the grain boundary type?";
const LONG = "Does the textured film keep most of its capacity after many cycles, and how does the crack density change? ".repeat(6).slice(0, MAX_QUESTION_CHARS);

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

interface Textarea {
  value: string;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
}
type RefCallback = (el: Textarea | null) => void;

/**
 * One page open, and a reader at the keyboard. `commit` is what a browser does when a render lands:
 * the ref callbacks of the lines are called (the old ones with null first, as React does) with the
 * line's textarea. Typing goes where `focus()` last put it, at the end of what is there — the caret
 * of a line the reader has just filled, and what Playwright's `insertText` does.
 */
function reader(props: { examples?: Array<{ label: string; items: string[] }> } = {}) {
  let active = -1;
  const textareas: Textarea[] = [];
  let refs: Array<RefCallback | undefined> = [];
  const textarea = (i: number): Textarea =>
    (textareas[i] ??= {
      get value() {
        return view().lines[i] ?? "";
      },
      focus: () => void (active = i),
      setSelectionRange: () => {},
    });

  const mounted = stagedRuntime.mount(
    () => QuestionField({ paperId: PAPER, examples: props.examples ?? [] }),
    (out) => {
      const lines = elements(out as ReactNode).filter((el) => "data-ask-line" in el.props);
      const next = lines.map((el) => el.props.ref as RefCallback | undefined);
      refs.forEach((ref) => ref?.(null));
      next.forEach((ref, i) => ref?.(textarea(i)));
      refs = next;
    },
  );
  stagedRuntime.flush(); // the first commit's passive effects have run: the page was open a while

  const view = () => {
    const all = elements(mounted.value as ReactNode);
    const inputs = all.filter((el) => "data-ask-line" in el.props);
    return {
      all,
      inputs,
      lines: inputs.map((el) => el.props.value as string),
      section: all.find((el) => el.type === "section")!,
    };
  };
  const call = (fn: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => void)(...args);
  const at = (i: number) => view().inputs[i].props;

  return {
    view,
    /** The line that has the focus; -1 when none. */
    get active() {
      return active;
    },
    lines: () => view().lines,
    click: (i: number) =>
      stagedRuntime.event(() => {
        textarea(i).focus();
        call(view().section.props.onFocus);
        call(at(i).onFocus);
      }),
    /** Text inserted at the end of the focused line. */
    type: (text: string) =>
      stagedRuntime.event(() => {
        if (active < 0) throw new Error("nothing has the focus: the typing would go nowhere");
        call(at(active).onChange, { target: { value: view().lines[active] + text } });
      }),
    /** Select all, then type over: the line becomes `text`. */
    typeOver: (text: string) =>
      stagedRuntime.event(() => call(at(active).onChange, { target: { value: text } })),
    enter: () => stagedRuntime.event(() => call(at(active).onKeyDown, { key: "Enter", preventDefault: () => {} })),
    /** The reader clicks outside the box: the line blurs, the box is left. */
    blur: () =>
      stagedRuntime.event(() => {
        call(at(active).onBlur);
        call(view().section.props.onBlur, { currentTarget: { contains: () => false }, relatedTarget: null });
        active = -1;
      }),
    chip: (label: string) =>
      stagedRuntime.event(() => call(view().all.find((el) => el.type === "button" && el.props.children === label)!.props.onClick)),
    /** The page's own re-render (the debounce published): a commit no event started. */
    pageRenders: () => stagedRuntime.rerender(),
    /** The scheduler's task that runs the passive effects that are waiting. */
    effectsRun: () => stagedRuntime.flush(),
    unmount: mounted.unmount,
  };
}

const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile } });
});
afterEach(() => vi.unstubAllGlobals());

describe("the sequences that were suspected — none of them joins two lines", () => {
  it("(control) type, Enter, type, Enter, Enter: two lines, the second typed in line 2, settled as two", () => {
    const r = reader();
    r.click(0);
    r.type(Q1);
    r.enter();
    expect(r.active).toBe(1);
    r.type(Q2);
    r.enter();
    r.enter(); // Enter on line 2 adds line 3; Enter on the empty last line settles
    expect(r.lines()).toEqual([Q1, Q2, ""]);
    expect(stored().settled).toEqual([Q1, Q2]);
    r.unmount();
  });

  it("(a) a 500-character line, select all and type over it, Enter, type, Enter on the empty line", () => {
    const r = reader();
    r.click(0);
    r.type(LONG);
    expect(r.lines()[0]).toHaveLength(MAX_QUESTION_CHARS);
    r.typeOver(Q1);
    r.enter();
    r.type(Q2);
    r.enter();
    r.enter();
    expect(r.lines()).toEqual([Q1, Q2, ""]);
    expect(stored().settled).toEqual([Q1, Q2]);
    r.unmount();
  });

  it("(c) a blur between the keystrokes, then the box entered again on line 1", () => {
    const r = reader();
    r.click(0);
    r.type(Q1);
    r.blur();
    r.click(0);
    r.enter();
    r.type(Q2);
    expect(r.lines()).toEqual([Q1, Q2]);
    r.unmount();
  });

  it("(b) the second question typed at once, the page's render only afterwards, its effects run in time", () => {
    const r = reader();
    r.click(0);
    r.type(Q1);
    r.enter();
    r.type(Q2);
    r.pageRenders();
    r.effectsRun();
    r.enter();
    r.enter();
    expect(r.lines()).toEqual([Q1, Q2, ""]);
    expect(stored().settled).toEqual([Q1, Q2]);
    r.unmount();
  });

  it("an Enter after the page's render, once that render's effects have run, hands the focus on", () => {
    const r = reader();
    r.click(0);
    r.type(Q1);
    r.pageRenders();
    r.effectsRun();
    r.enter();
    expect(r.active).toBe(1);
    r.type(Q2);
    expect(r.lines()).toEqual([Q1, Q2]);
    r.unmount();
  });
});

describe("Enter hands the focus to the line it adds, whatever the page's render is doing (P9-07)", () => {
  it("(d) Enter after the page's render committed and before its passive effects ran: the next question is in line 2", () => {
    const r = reader();
    r.click(0);
    r.type(Q1);
    r.pageRenders(); // the debounce published; the page took ~300 ms; its effects are queued behind the key
    r.enter();
    expect(r.lines()).toEqual([Q1, ""]);
    expect(r.active).toBe(1);
    r.type(Q2);
    expect(r.lines()).toEqual([Q1, Q2]);
    r.unmount();
  });

  it("the feature walk: a 500-character line typed over, a blur, Q1, the page's render, Enter, Q2, Enter, Enter — two settled questions", () => {
    const r = reader();
    r.click(0);
    r.type(LONG);
    r.pageRenders();
    r.effectsRun();
    r.blur();
    r.click(0);
    r.typeOver(Q1);
    r.pageRenders();
    r.enter();
    r.type(Q2);
    r.enter();
    r.enter();
    expect(r.lines().slice(0, 2)).toEqual([Q1, Q2]);
    expect(stored().items).toEqual([Q1, Q2]);
    expect(stored().settled).toEqual([Q1, Q2]);
    r.unmount();
  });

  it("an example tag that adds a line focuses it too", () => {
    const r = reader({ examples: [{ label: "From your earlier questions", items: [Q2] }] });
    r.click(0);
    r.type(Q1);
    r.pageRenders();
    r.chip(Q2); // line 1 is full, so the tag opens line 2
    expect(r.lines()).toEqual([Q1, Q2]);
    expect(r.active).toBe(1);
    r.unmount();
  });
});

describe("a request to focus a line fires once (P9-11)", () => {
  it("a reader who goes back to line 1 after Enter keeps the focus there through the next renders", () => {
    // The request lives in state now; an effect with no dependency would read it after EVERY render and pull
    // the focus back to the line Enter had opened, whatever the reader did since. It is keyed on the request.
    const r = reader();
    r.click(0);
    r.type(Q1);
    r.enter();
    expect(r.active).toBe(1);
    r.click(0); // the reader goes back to line 1 to add a few words
    r.pageRenders();
    r.effectsRun();
    r.type(" Or does it not?");
    r.pageRenders();
    r.effectsRun();
    expect(r.active).toBe(0);
    expect(r.lines()).toEqual([`${Q1} Or does it not?`, ""]);
    r.unmount();
  });
});
