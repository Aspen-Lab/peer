import { beforeEach, describe, expect, it, vi } from "vitest";

// P2-03 (§1g.11 a): the field settles the questions — the ones a deep report
// is asked about — on Enter, on a line's blur and on a line's removal; never
// on a keystroke, and never on the gist toggle. No DOM here: the field runs
// on the minimal hook runtime and its own handlers are called on the element
// tree it returns.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK } from "./copy";
import { QuestionField, settlesQuestions } from "./question-field";

const PAPER = "openalex:W1";
const AT = "2026-10-05T00:00:00.000Z";
/** P1-09 (§1f.20): the page's example groups. */
const EXAMPLE = "Does this help with dendrite growth?";
const EXAMPLES = [{ label: ASK.fromProfile, items: [EXAMPLE] }];

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element in the tree the field returned (host elements only — the
 *  field renders no component of its own). */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

async function field() {
  const mounted = await hookRuntime.mount(() => QuestionField({ paperId: PAPER, examples: EXAMPLES }));
  const all = elements(mounted.value);
  const inputs = all.filter((el) => "data-ask-line" in el.props);
  const button = (label: string) => all.find((el) => el.type === "button" && (el.props["aria-label"] === label || el.props.children === label));
  return { mounted, inputs, button };
}

const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];

describe("the field settles the questions (P2-03)", () => {
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
  });

  it("names the events that settle: Enter, blur, removal — not typing, not the gist", () => {
    expect(settlesQuestions("enter")).toBe(true);
    expect(settlesQuestions("blur")).toBe(true);
    expect(settlesQuestions("remove")).toBe(true);
    expect(settlesQuestions("change")).toBe(false);
    expect(settlesQuestions("gist")).toBe(false);
    expect(settlesQuestions("chip")).toBe(false);
  });

  it("typing writes through to items and settles nothing", async () => {
    const { inputs, mounted } = await field();
    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "Does tungsten delay rafting at 1100 C?" } });

    expect(stored().items).toEqual(["Does tungsten delay rafting at 1100 C?"]);
    expect(stored().settled).toBeUndefined();
    mounted.unmount();
  });

  it("Enter settles the line it was pressed in", async () => {
    const { inputs, mounted } = await field();
    (inputs[0].props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault: () => {} });

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  it("a line's blur settles it", async () => {
    const { inputs, mounted } = await field();
    (inputs[0].props.onBlur as () => void)();

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  it("removing a line settles what is left", async () => {
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?", "Why 1100 C?"], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);
    const { button, mounted } = await field();
    (button(ASK.remove(1))?.props.onClick as () => void)();

    expect(stored().items).toEqual(["Why 1100 C?"]);
    expect(stored().settled).toEqual(["Why 1100 C?"]);
    mounted.unmount();
  });

  it("the gist toggle settles nothing", async () => {
    const { button, mounted } = await field();
    (button(ASK.chips.gist)?.props.onClick as () => void)();

    expect(stored().gist).toBe(true);
    expect(stored().settled).toBeUndefined();
    mounted.unmount();
  });

  it("an example chip fills the next line and settles nothing until that line's blur or Enter (P1-09)", async () => {
    const { button, mounted } = await field();
    (button(EXAMPLE)?.props.onClick as () => void)();
    expect(stored().items).toEqual(["Does tungsten delay rafting?", EXAMPLE]);
    expect(stored().settled).toBeUndefined();
    mounted.unmount();

    // The reader leaves the line the chip filled.
    const again = await field();
    (again.inputs[1].props.onBlur as () => void)();
    expect(stored().settled).toEqual(["Does tungsten delay rafting?", EXAMPLE]);
    again.mounted.unmount();

    // Or presses Enter in it.
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
    const third = await field();
    (third.button(EXAMPLE)?.props.onClick as () => void)();
    expect(stored().settled).toBeUndefined();
    third.mounted.unmount();
    const fourth = await field();
    (fourth.inputs[1].props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault: () => {} });
    expect(stored().settled).toEqual(["Does tungsten delay rafting?", EXAMPLE]);
    fourth.mounted.unmount();
  });
});
