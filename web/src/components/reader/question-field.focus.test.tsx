import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P9-07 (B, round P9 Theme 2; the feature walk's X1): two questions settled with Enter once became ONE
// line — `…many cycles?How does crack density…`, no separator, one opt-out box, a
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
// P10-03 (round P10, review 2.5): there is ONE bar now, so Enter adds no line and hands the focus to none —
// it submits. What survives of this suite is what still can go wrong in the one bar: the typing must
// never be lost or joined to something else whatever the page's render is doing (the sequences of P9-07,
// re-aimed: Enter submits and the bar keeps the focus and the text), and a pick from the dropdown hands the
// focus to the bar with the caret at its end, once (P9-19, P9-11). Each re-aimed test says which it was.
//
// No DOM: a "textarea" here is an object the ref callback is given when a render commits, whose
// `focus()` says whether the bar gets the next typing. Every question is invented.
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
  readonly value: string;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}
type RefCallback = (el: Textarea | null) => void;

/**
 * One page open, and a reader at the keyboard. `commit` is what a browser does when a render lands:
 * the ref callback of the bar is called (the old one with null first, as React does) with its textarea.
 * Typing goes where `focus()` last put it, at the end of what is there — the caret of a bar the reader has
 * just filled, and what Playwright's `insertText` does.
 *
 * P9-19 (A P9-R2's F6 b): the staged runtime has no DOM and no spy to read, so the stub textarea keeps the
 * selection a DOM textarea keeps: `setSelectionRange` records its range, clamped to the value as the DOM
 * clamps it, and `selectionStart` / `selectionEnd` read it back. The caret starts at 0 and stays wherever the
 * code last put it — the stub does not move it when the value changes, as a browser may or may not. So
 * the bar is "at its end" only if the code asked for it.
 */
function reader(props: { examples?: Array<{ label: string; items: string[] }> } = {}) {
  let active = false;
  let element: Textarea | undefined;
  let ref: RefCallback | undefined;
  let selection: [number, number] = [0, 0];
  const textarea = (): Textarea =>
    (element ??= {
      get value() {
        return view().text;
      },
      focus: () => void (active = true),
      setSelectionRange(start: number, end: number) {
        const length = this.value.length;
        selection = [Math.min(start, length), Math.min(end, length)];
      },
      get selectionStart() {
        return selection[0];
      },
      get selectionEnd() {
        return selection[1];
      },
    });

  const mounted = stagedRuntime.mount(
    () => QuestionField({ paperId: PAPER, examples: props.examples ?? [] }),
    (out) => {
      const bar = elements(out as ReactNode).find((el) => "data-ask-line" in el.props);
      const next = bar?.props.ref as RefCallback | undefined;
      ref?.(null);
      next?.(textarea());
      ref = next;
    },
  );
  stagedRuntime.flush(); // the first commit's passive effects have run: the page was open a while

  const view = () => {
    const all = elements(mounted.value as ReactNode);
    const inputs = all.filter((el) => "data-ask-line" in el.props);
    return {
      all,
      inputs,
      text: inputs[0].props.value as string,
      section: all.find((el) => el.type === "section")!,
      options: all.filter((el) => el.props.role === "option"),
    };
  };
  const call = (fn: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => void)(...args);
  const bar = () => view().inputs[0].props;

  return {
    view,
    /** Whether the bar has the focus. */
    get active() {
      return active;
    },
    /** How many textareas the box draws. */
    bars: () => view().inputs.length,
    text: () => view().text,
    click: () =>
      stagedRuntime.event(() => {
        textarea().focus();
        call(view().section.props.onFocus);
        call(bar().onFocus);
      }),
    /** Text inserted at the end of the bar. */
    type: (text: string) =>
      stagedRuntime.event(() => {
        if (!active) throw new Error("nothing has the focus: the typing would go nowhere");
        call(bar().onChange, { target: { value: view().text + text } });
      }),
    /** Where the caret of the bar stands, and how long its text is. */
    caret: () => ({ start: textarea().selectionStart, end: textarea().selectionEnd, length: textarea().value.length }),
    /** Text inserted at the caret of the bar (replacing a selection), as a browser does. */
    typeAtCaret: (text: string) =>
      stagedRuntime.event(() => {
        if (!active) throw new Error("nothing has the focus: the typing would go nowhere");
        const field = textarea();
        const before = view().text;
        call(bar().onChange, { target: { value: before.slice(0, field.selectionStart) + text + before.slice(field.selectionEnd) } });
      }),
    /** Select all, then type over: the bar becomes `text`. */
    typeOver: (text: string) => stagedRuntime.event(() => call(bar().onChange, { target: { value: text } })),
    enter: () => stagedRuntime.event(() => call(bar().onKeyDown, { key: "Enter", preventDefault: () => {} })),
    /** The reader clicks outside the box: the bar blurs, the box is left. */
    blur: () =>
      stagedRuntime.event(() => {
        call(bar().onBlur);
        call(view().section.props.onBlur, { currentTarget: { contains: () => false }, relatedTarget: null });
        active = false;
      }),
    /** The reader picks the dropdown's item that reads `label`. */
    pick: (label: string) =>
      stagedRuntime.event(() => {
        const option = view().options.find((el) => el.props.children === label);
        if (!option) throw new Error(`no such item in the dropdown: ${label}`);
        call(option.props.onClick);
      }),
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

// P10-03 re-aim of "the sequences that were suspected — none of them joins two lines". Each sequence is kept
// as the reader typed it; what is asserted is the one-bar contract: Enter submits what is in the bar, keeps
// the focus there and adds nothing, so a second question typed afterwards continues the same bar.
describe("the sequences that were suspected — none of them loses or joins the typing", () => {
  it("(control) type, Enter, type again: one bar, the focus stays in it, the first Enter settled the first question", () => {
    const r = reader();
    r.click();
    r.type(Q1);
    r.enter();
    expect(r.active).toBe(true);
    expect(r.bars()).toBe(1);
    expect(stored().settled).toEqual([Q1]);
    r.type(` ${Q2}`);
    expect(r.text()).toBe(`${Q1} ${Q2}`);
    expect(r.bars()).toBe(1);
    // Nothing settles again by itself.
    expect(stored().settled).toEqual([Q1]);
    r.unmount();
  });

  it("(a) a 500-character question, select all and type over it, Enter: the bar holds the new question, settled alone", () => {
    const r = reader();
    r.click();
    r.type(LONG);
    expect(r.text()).toHaveLength(MAX_QUESTION_CHARS);
    r.typeOver(Q1);
    r.enter();
    expect(r.text()).toBe(Q1);
    expect(stored().settled).toEqual([Q1]);
    r.unmount();
  });

  it("(c) a blur between the keystrokes, then the box entered again: the typing continues in the same bar", () => {
    const r = reader();
    r.click();
    r.type(Q1);
    r.blur();
    r.click();
    r.type(` ${Q2}`);
    expect(r.text()).toBe(`${Q1} ${Q2}`);
    expect(stored().settled).toBeUndefined();
    r.unmount();
  });

  it("(b) the question typed at once, the page's render only afterwards, its effects run in time, then Enter: settled whole", () => {
    const r = reader();
    r.click();
    r.type(Q1);
    r.type(` ${Q2}`);
    r.pageRenders();
    r.effectsRun();
    r.enter();
    expect(r.text()).toBe(`${Q1} ${Q2}`);
    expect(stored().settled).toEqual([`${Q1} ${Q2}`]);
    r.unmount();
  });

  it("an Enter after the page's render, once that render's effects have run, submits and keeps the focus", () => {
    const r = reader();
    r.click();
    r.type(Q1);
    r.pageRenders();
    r.effectsRun();
    r.enter();
    expect(r.active).toBe(true);
    expect(stored().settled).toEqual([Q1]);
    r.unmount();
  });
});

// P10-03 re-aim of "Enter hands the focus to the line it adds, whatever the page's render is doing (P9-07)": no
// line is added, so no focus is handed over; the failure P9-07 found (an Enter between a commit and its passive
// effects taking the wrong target) can only show now as an Enter that loses the text or the focus.
describe("Enter keeps the text and the focus whatever the page's render is doing (P9-07, re-aimed)", () => {
  it("(d) Enter after the page's render committed and before its passive effects ran: the bar keeps its text and the focus, and the question settles", () => {
    const r = reader();
    r.click();
    r.type(Q1);
    r.pageRenders(); // the debounce published; the page took ~300 ms; its effects are queued behind the key
    r.enter();
    expect(r.text()).toBe(Q1);
    expect(r.active).toBe(true);
    expect(stored().settled).toEqual([Q1]);
    r.type(` ${Q2}`);
    expect(r.text()).toBe(`${Q1} ${Q2}`);
    r.unmount();
  });

  it("the feature walk: a 500-character question typed over, a blur, Q1, the page's render, Enter — one settled question", () => {
    const r = reader();
    r.click();
    r.type(LONG);
    r.pageRenders();
    r.effectsRun();
    r.blur();
    r.click();
    r.typeOver(Q1);
    r.pageRenders();
    r.enter();
    expect(r.text()).toBe(Q1);
    expect(stored().items).toEqual([Q1]);
    expect(stored().settled).toEqual([Q1]);
    r.unmount();
  });

  it("an example picked from the dropdown focuses the bar too", () => {
    const r = reader({ examples: [{ label: "From your earlier questions", items: [Q2] }] });
    r.click();
    r.type(Q1);
    r.pageRenders();
    r.blur();
    expect(r.active).toBe(false);
    r.click();
    r.pick(Q2);
    r.effectsRun();
    expect(r.text()).toBe(Q2);
    expect(r.active).toBe(true);
    r.unmount();
  });
});

// P9-19 (A P9-R2's F6 b; the survivor 11d of P9-11): an example fills the bar and hands it the focus, and
// the caret is to stand at the end of what it put there, so the next words the reader types continue the
// question instead of landing in front of it. (`question-field.tsx` asks for it with `setSelectionRange`; a
// browser may put the caret there on its own when a value is set from script, and may not, so the code does
// not rely on it.)
describe("a bar an example filled has the caret at its end (P9-19)", () => {
  const examples = [{ label: "From your earlier questions", items: [Q2] }];

  it("the pick fills the empty bar, focuses it, and the caret stands at its end", () => {
    const r = reader({ examples });
    r.click();
    r.pick(Q2); // the bar is empty, so the pick fills it
    r.effectsRun();
    expect(r.text()).toBe(Q2);
    expect(r.active).toBe(true);
    const caret = r.caret();
    expect(caret.length).toBe(Q2.length);
    expect(caret.start).toBe(caret.length);
    expect(caret.end).toBe(caret.length);
    r.unmount();
  });

  // P10-03 re-aim of "the tag that opens a second line puts the caret at the end of that line": a pick over typed
  // text replaces it, and the caret is at the end of what was put there.
  it("a pick over typed words replaces them and puts the caret at the end of the picked question", () => {
    const r = reader({ examples });
    r.click();
    r.type(Q1);
    r.pageRenders();
    r.pick(Q2);
    r.effectsRun();
    expect(r.text()).toBe(Q2);
    const caret = r.caret();
    expect(caret.length).toBe(Q2.length);
    expect(caret.start).toBe(caret.length);
    expect(caret.end).toBe(caret.length);
    r.unmount();
  });

  it("what the reader types next continues the question: it is added after the words the pick put there", () => {
    const r = reader({ examples });
    r.click();
    r.pick(Q2);
    r.effectsRun();
    r.typeAtCaret(" And in air?");
    expect(r.text()).toBe(`${Q2} And in air?`);
    r.unmount();
  });
});

describe("a request to focus the bar fires once (P9-11)", () => {
  it("a reader who leaves the bar after a pick is not pulled back into it by the next renders", () => {
    // The request lives in state; an effect with no dependency would read it after EVERY render and pull the
    // focus back to the bar, whatever the reader did since. It is keyed on the request.
    const r = reader({ examples: [{ label: "From your earlier questions", items: [Q2] }] });
    r.click();
    r.pick(Q2);
    r.effectsRun();
    expect(r.active).toBe(true);
    r.blur(); // the reader clicks away
    r.pageRenders();
    r.effectsRun();
    r.pageRenders();
    r.effectsRun();
    expect(r.active).toBe(false);
    expect(r.text()).toBe(Q2);
    r.unmount();
  });
});
