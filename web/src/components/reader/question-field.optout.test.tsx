import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P5-02 (blueprint P5, brief commit 2): every question in the box carries a
// checkbox "Not for recommendations". Unticked by default (the question is the
// reader's declared intent). The ledger hears of a paper's questions once per
// settle — never per keystroke — and a ticked question's terms never enter it,
// or leave it at once if they were in. No DOM: the field runs on the minimal hook
// runtime and its handlers are called on the elements it returns. Invented words.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile } from "@/types";
import { applyPreferenceSignal, questionTermsOf, termConcept } from "@/lib/preferences/ledger";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK } from "./copy";
import { QuestionField, settleQuestions } from "./question-field";

const PAPER = "openalex:W7";
const AT = "2026-10-07T00:00:00.000Z";
const A = "Does annealing coarsen the grain boundaries?";
const B = "Is the electrolyte stable against dendrites?";
const IDLE = 15;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

async function field() {
  const mounted = await hookRuntime.mount(() => QuestionField({ paperId: PAPER, examples: [], idleMs: IDLE }));
  const all = elements(mounted.value);
  const inputs = all.filter((el) => "data-ask-line" in el.props);
  const boxes = all.filter((el) => el.type === "input" && el.props.type === "checkbox");
  const section = all.find((el) => el.type === "section")!;
  const leave = () => (section.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
  return { mounted, inputs, boxes, all, leave };
}

const ledger = () => useProfileStore.getState().profile.preferenceLedger;
const terms = () => questionTermsOf(ledger(), PAPER).sort();
const storedEntry = () => useReadingQuestionsStore.getState().byPaper[PAPER];

const realRecord = useProfileStore.getState().recordQuestionTerms;

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile }, recordQuestionTerms: realRecord });
});
afterEach(() => vi.unstubAllGlobals());

describe("the checkbox", () => {
  it("is not there with no question, so the empty box is as it was", async () => {
    const { boxes, mounted } = await field();
    expect(boxes).toHaveLength(0);
    mounted.unmount();
  });

  it("is one per question, labelled in the label face, and unticked", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    const { boxes, all, mounted } = await field();
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => !box.props.checked)).toBe(true);
    const labels = all.filter((el) => el.type === "label" && elements(el.props.children).some((c) => c.props.type === "checkbox"));
    expect(labels).toHaveLength(2);
    expect(JSON.stringify(labels[0].props.children)).toContain(ASK.notForRecs);
    expect(String(labels[0].props.className)).toContain("annotation");
    mounted.unmount();
  });

  it("an old stored list loads unticked", async () => {
    useReadingQuestionsStore.setState({ byPaper: { [PAPER]: { items: [A], gist: false, updatedAt: AT, settled: [A] } } });
    const { boxes, mounted } = await field();
    expect(boxes[0].props.checked).toBe(false);
    mounted.unmount();
  });

  it("shows a stored mark as ticked", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT, [B]);
    const { boxes, mounted } = await field();
    expect(boxes.map((box) => box.props.checked)).toEqual([false, true]);
    mounted.unmount();
  });

  it("ticking writes the mark to the store and takes an already entered question's terms out at once", async () => {
    const liked = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: AT });
    useProfileStore.setState({ profile: { ...defaultProfile, preferenceLedger: liked } });
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);
    const entered = terms();
    expect(entered).toContain("annealing");
    expect(entered).toContain("electrolyte");

    const { boxes, mounted } = await field();
    (boxes[0].props.onChange as (e: unknown) => void)({ target: { checked: true } });

    expect(storedEntry().notForRecs).toEqual([A]);
    expect(terms()).not.toContain("annealing");
    expect(terms()).toContain("electrolyte");
    // The like on the same word, and every other signal, stand.
    expect(ledger()?.["text:grain"]?.positive).toBe(1);
    mounted.unmount();
  });

  it("unticking puts the terms back only when the questions next settle", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT, [A]);
    settleQuestions(PAPER);
    expect(terms()).toEqual([]);
    const { boxes, leave, mounted } = await field();
    (boxes[0].props.onChange as (e: unknown) => void)({ target: { checked: false } });
    expect(terms()).toEqual([]);
    leave();
    await sleep(IDLE * 4);
    expect(terms()).toContain("annealing");
    mounted.unmount();
  });

  it("a ticked line stays ticked while the reader edits it", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT, [A]);
    const { inputs, mounted } = await field();
    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: A + " At 900 K?" } });
    expect(storedEntry().notForRecs).toEqual([A + " At 900 K?"]);
    mounted.unmount();
  });
});

describe("what reaches the ledger, and when", () => {
  it("never on a keystroke; once when the box settles", async () => {
    const record = vi.fn();
    useProfileStore.setState({ recordQuestionTerms: record });
    const { inputs, leave, mounted } = await field();
    for (const value of ["D", "Do", "Does annealing", A]) {
      (inputs[0].props.onChange as (e: unknown) => void)({ target: { value } });
    }
    await sleep(IDLE * 4);
    expect(record).not.toHaveBeenCalled();
    leave();
    await sleep(IDLE * 4);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(PAPER);
    mounted.unmount();
  });

  it("a ticked question's terms never enter; an unticked one's do", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT, [A]);
    const { leave, mounted } = await field();
    leave();
    await sleep(IDLE * 4);
    expect(terms()).toContain("electrolyte");
    expect(terms()).not.toContain("annealing");
    expect(terms()).not.toContain("grain");
    mounted.unmount();
  });

  it("removing every question and settling takes the paper's terms out", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    expect(terms().length).toBeGreaterThan(0);
    useReadingQuestionsStore.getState().set(PAPER, [], false, AT);
    settleQuestions(PAPER);
    expect(terms()).toEqual([]);
  });

  it("the ledger holds the terms, not the question", () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    const text = JSON.stringify(ledger());
    expect(text).not.toContain("coarsen the grain");
    expect(text).not.toContain(PAPER);
  });
});
