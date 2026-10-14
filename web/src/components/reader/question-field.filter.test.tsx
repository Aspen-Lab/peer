import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P10-11 rule 2 (the walk's X-A5, BACKLOG-72): the dropdown listed every suggestion whatever was typed. It now follows the
// typed text: with text in the bar it lists only the suggestions that contain a typed word (case-folded, any word of two
// letters or more), "Just get the gist" always last; an empty focused bar still offers the examples (the owner's
// "输入问题的时候自动弹出"); text that matches nothing leaves "Just get the gist" alone. No DOM: the scripted runtime of
// `question-field.focus.test.tsx`. Every question is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  return { ...actual, ...stagedRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { defaultProfile } from "@/types";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { useProfileStore } from "@/store/profile";
import { ASK } from "./copy";
import { QuestionField } from "./question-field";

const PAPER = "upload:bbbbbbbbbbbbbbbb";
const EXAMPLES = [
  { label: "From your earlier questions", items: ["Does the film keep its capacity after cycling?", "How does crack density change?"] },
  { label: "From your profile", items: ["What grain size was used in the anode?", "Which electrolyte is tested?"] },
];

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

function field() {
  const mounted = stagedRuntime.mount(() => QuestionField({ paperId: PAPER, examples: EXAMPLES }), () => {});
  stagedRuntime.flush();
  const view = () => {
    const all = elements(mounted.value as ReactNode);
    return {
      section: all.find((el) => el.type === "section")!,
      bar: all.find((el) => "data-ask-line" in el.props)!,
      listbox: all.find((el) => el.props.role === "listbox"),
      options: all.filter((el) => el.props.role === "option"),
    };
  };
  const call = (fn: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => void)(...args);
  return {
    focus: () =>
      stagedRuntime.event(() => {
        call(view().section.props.onFocus);
        call(view().bar.props.onFocus);
      }),
    type: (text: string) => stagedRuntime.event(() => call(view().bar.props.onChange, { target: { value: text } })),
    /** The listbox's items, in order, as the reader reads them; null when the dropdown is closed. */
    items: () => (view().listbox ? view().options.map((el) => String(el.props.children)) : null),
    unmount: mounted.unmount,
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile } });
});
afterEach(() => vi.unstubAllGlobals());

const GIST = ASK.chips.gist;

describe("the dropdown follows the typed text (P10-11, BACKLOG-72)", () => {
  it("an empty bar with focus still offers every example, the gist last", () => {
    const f = field();
    expect(f.items()).toBeNull();
    f.focus();
    expect(f.items()).toEqual([
      "Does the film keep its capacity after cycling?",
      "How does crack density change?",
      "What grain size was used in the anode?",
      "Which electrolyte is tested?",
      GIST,
    ]);
    f.unmount();
  });

  it("text lists only the suggestions that contain a typed word, case-folded, the gist last", () => {
    const f = field();
    f.focus();
    f.type("GRA");
    expect(f.items()).toEqual(["What grain size was used in the anode?", GIST]);
    f.type("crack zzz");
    expect(f.items()).toEqual(["How does crack density change?", GIST]);
    f.type("capacity electrolyte");
    expect(f.items()).toEqual(["Does the film keep its capacity after cycling?", "Which electrolyte is tested?", GIST]);
    f.unmount();
  });

  it("text that matches nothing leaves 'Just get the gist' alone", () => {
    const f = field();
    f.focus();
    f.type("zzz");
    expect(f.items()).toEqual([GIST]);
    f.unmount();
  });

  it("a one-letter word is not a typed word: it filters nothing", () => {
    const f = field();
    f.focus();
    f.type("a");
    expect(f.items()).toHaveLength(5);
    f.unmount();
  });
});
