import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P7-13 (R11a, the owner's R11): each question line is a textarea that grows with its text.
// jsdom does not exist here, so a browser's layout cannot be measured; what is pinned is what
// the field does with the element it renders — it folds a pasted newline to a space (an
// `<input>` stripped one, a textarea keeps it), keeps Enter from adding one, fits the element's
// height to its content with `fitHeight`, and the page's `q` command finds a line by the
// `data-ask-line` mark whatever the element is. The field runs on the minimal hook runtime and
// its own handlers are called on the element tree it returns.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { MAX_QUESTION_CHARS, useReadingQuestionsStore } from "@/store/reading-questions";
import { QuestionField, fitHeight, focusFirstEmptyQuestion, oneLine } from "./question-field";

const PAPER = "openalex:W1";
const AT = "2026-10-05T00:00:00.000Z";

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

async function field() {
  const mounted = await hookRuntime.mount(() => QuestionField({ paperId: PAPER, examples: [] }));
  const lines = elements(mounted.value).filter((el) => "data-ask-line" in el.props);
  return { mounted, lines };
}

const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("the line is a textarea of one row with the shared limit", () => {
  it("renders a <textarea rows=1 maxLength=MAX_QUESTION_CHARS> for every line, with the data-ask-line mark", async () => {
    useReadingQuestionsStore.getState().set(PAPER, ["First question here?", "Second question here?"], false, AT);
    const { lines, mounted } = await field();

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.type).toBe("textarea");
      expect(line.props.rows).toBe(1);
      expect(line.props.maxLength).toBe(MAX_QUESTION_CHARS);
      expect(line.props.type).toBeUndefined();
    }
    mounted.unmount();
  });
});

describe("a pasted newline is folded to a space", () => {
  it("oneLine folds every kind of line break, with the spaces around it, into one space", () => {
    expect(oneLine("one\ntwo")).toBe("one two");
    expect(oneLine("one\r\ntwo")).toBe("one two");
    expect(oneLine("one\rtwo")).toBe("one two");
    expect(oneLine("one  \n  two")).toBe("one two");
    expect(oneLine("one\n\n\ntwo")).toBe("one two");
    expect(oneLine("no break here")).toBe("no break here");
    expect(oneLine("")).toBe("");
  });

  it("onChange stores the folded text, never a line break", async () => {
    const { lines, mounted } = await field();
    (lines[0].props.onChange as (e: unknown) => void)({ target: { value: "Why does the film crack?\r\nAnd how fast?\n" } });

    expect(stored().items).toEqual(["Why does the film crack? And how fast?"]);
    expect(JSON.stringify(stored())).not.toMatch(/\\n|\\r/);
    mounted.unmount();
  });

  it("a ticked line stays ticked through a paste, on the folded text", async () => {
    useReadingQuestionsStore.getState().set(PAPER, ["Why does it crack?"], false, AT, ["Why does it crack?"]);
    const { lines, mounted } = await field();
    (lines[0].props.onChange as (e: unknown) => void)({ target: { value: "Why does it crack?\nAt what rate?" } });

    expect(stored().items).toEqual(["Why does it crack? At what rate?"]);
    expect(stored().notForRecs).toEqual(["Why does it crack? At what rate?"]);
    mounted.unmount();
  });
});

describe("Enter still adds a line and never a line break", () => {
  it("prevents the default of Enter, and moves on as before", async () => {
    useReadingQuestionsStore.getState().set(PAPER, ["First question here?"], false, AT);
    const { lines, mounted } = await field();
    const preventDefault = vi.fn();
    (lines[0].props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("leaves every other key alone", async () => {
    const { lines, mounted } = await field();
    const preventDefault = vi.fn();
    (lines[0].props.onKeyDown as (e: unknown) => void)({ key: "a", preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    mounted.unmount();
  });
});

describe("the height follows the content", () => {
  /** The bits of a textarea `fitHeight` reads and writes. */
  function fake({ scrollHeight, offsetHeight, clientHeight }: { scrollHeight: number; offsetHeight: number; clientHeight: number }) {
    const style = { height: "" };
    const heights: string[] = [];
    return {
      style: new Proxy(style, {
        set(target, key, value) {
          if (key === "height") heights.push(String(value));
          (target as Record<string | symbol, unknown>)[key] = value;
          return true;
        },
      }),
      scrollHeight,
      offsetHeight,
      clientHeight,
      heights,
      raw: style,
    };
  }

  it("resets to auto, then takes the content's height plus the border the box adds", () => {
    // 3 rows of 24 px = 72 px of content, a 1 px bottom border: the box is 73 px tall.
    const el = fake({ scrollHeight: 72, offsetHeight: 73, clientHeight: 72 });
    fitHeight(el as unknown as HTMLTextAreaElement);

    expect(el.heights).toEqual(["auto", "73px"]);
    expect(el.raw.height).toBe("73px");
  });

  it("a line with no border adds none", () => {
    const el = fake({ scrollHeight: 24, offsetHeight: 24, clientHeight: 24 });
    fitHeight(el as unknown as HTMLTextAreaElement);

    expect(el.raw.height).toBe("24px");
  });

  it("a line that is not laid out (hidden, nothing to measure) keeps the height it had", () => {
    const el = fake({ scrollHeight: 0, offsetHeight: 0, clientHeight: 0 });
    el.raw.height = "73px";
    fitHeight(el as unknown as HTMLTextAreaElement);

    expect(el.raw.height).toBe("73px");
    expect(el.heights).toEqual(["auto", "73px"]);
  });

  it("does nothing for an element that is not there, or has no style (the tests' own tree)", () => {
    expect(() => fitHeight(null)).not.toThrow();
    expect(() => fitHeight({} as unknown as HTMLTextAreaElement)).not.toThrow();
  });
});

describe("the page's q command finds a line by its mark, whatever the element", () => {
  /** A fake document: only the selector the function asks for is answered. */
  function documentWith(lines: Array<{ value: string; focus: () => void }>) {
    const asked: string[] = [];
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) => {
        asked.push(selector);
        return selector === "[data-ask-line]" ? lines : [];
      },
    });
    return asked;
  }

  it("asks for [data-ask-line], not input[data-ask-line], and focuses the first empty line", () => {
    const focus = [vi.fn(), vi.fn(), vi.fn()];
    const asked = documentWith([
      { value: "A question", focus: focus[0] },
      { value: "   ", focus: focus[1] },
      { value: "", focus: focus[2] },
    ]);
    focusFirstEmptyQuestion();

    expect(asked).toEqual(["[data-ask-line]"]);
    expect(focus[1]).toHaveBeenCalledTimes(1);
    expect(focus[0]).not.toHaveBeenCalled();
    expect(focus[2]).not.toHaveBeenCalled();
  });

  it("with every line written, focuses the last one", () => {
    const focus = [vi.fn(), vi.fn()];
    documentWith([
      { value: "One", focus: focus[0] },
      { value: "Two", focus: focus[1] },
    ]);
    focusFirstEmptyQuestion();

    expect(focus[1]).toHaveBeenCalledTimes(1);
    expect(focus[0]).not.toHaveBeenCalled();
  });

  it("with no line on the page, does nothing", () => {
    documentWith([]);
    expect(() => focusFirstEmptyQuestion()).not.toThrow();
  });
});
