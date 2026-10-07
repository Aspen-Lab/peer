import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P5-04 (S3, §1h.15 (c)): a question deleted with the × button is a finished gesture, like a
// tick: its words leave the preference ledger at once, not at the next visit to the box. A
// measured that the focused button is removed with the line, so no blur reached the box and the
// idle wait that `commit` had stopped was never started again — five terms stayed in the ledger
// (and, signed in, the account's copy) until the box was next focused and left. Clearing the
// text with the keyboard never had the gap: the line is still focused, and leaving it is a blur.
// No DOM: the field runs on the minimal hook runtime and its handlers are called on the
// elements it returns. Every question is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile } from "@/types";
import { questionTermsOf } from "@/lib/preferences/ledger";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK } from "./copy";
import { QuestionField, settleQuestions } from "./question-field";

const PAPER = "openalex:W88";
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

async function field(idleMs = IDLE) {
  const mounted = await hookRuntime.mount(() => QuestionField({ paperId: PAPER, examples: [], idleMs }));
  const all = elements(mounted.value);
  const inputs = all.filter((el) => "data-ask-line" in el.props);
  const remove = (n: number) => all.find((el) => el.type === "button" && el.props["aria-label"] === ASK.remove(n))!;
  const boxes = all.filter((el) => el.type === "input" && el.props.type === "checkbox");
  const section = all.find((el) => el.type === "section")!;
  const leave = () => (section.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
  return { mounted, inputs, remove, boxes, leave };
}

const ledger = () => useProfileStore.getState().profile.preferenceLedger;
const terms = () => questionTermsOf(ledger(), PAPER).sort();
const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];

/** How many times the ledger was replaced since this was called. */
function ledgerWrites() {
  let n = 0;
  const stop = useProfileStore.subscribe((state, previous) => {
    if (state.profile.preferenceLedger !== previous.profile.preferenceLedger) n += 1;
  });
  return { count: () => n, stop };
}

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile } });
});
afterEach(() => vi.unstubAllGlobals());

describe("× takes a question's words out of the ledger at once (P5-04, S3)", () => {
  it("A's sequence: one settled question, × pressed, no focus or blur after — no words left, one ledger write, no request", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    expect(terms().length).toBeGreaterThanOrEqual(3);
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const writes = ledgerWrites();
    const { remove, mounted } = await field();

    (remove(1).props.onClick as () => void)();

    expect(terms()).toEqual([]);
    expect(writes.count()).toBe(1);
    expect(fetched).not.toHaveBeenCalled();
    // Nothing more comes later: the settle was the gesture's own, no wait is pending.
    await sleep(IDLE * 4);
    expect(writes.count()).toBe(1);
    writes.stop();
    mounted.unmount();
  });

  it("with two questions, × on one takes out its words, keeps the other's, and `settled` holds the box as it stands", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);
    const both = terms();
    expect(both).toContain("annealing");
    expect(both).toContain("electrolyte");
    const writes = ledgerWrites();
    const { remove, mounted } = await field();

    (remove(1).props.onClick as () => void)();

    expect(stored().items).toEqual([B]);
    expect(stored().settled).toEqual([B]);
    expect(terms()).toContain("electrolyte");
    expect(terms()).not.toContain("annealing");
    expect(terms()).not.toContain("grain");
    expect(writes.count()).toBe(1);
    writes.stop();
    mounted.unmount();
  });

  it("leaving the box after the × writes nothing more", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);
    const { remove, leave, mounted } = await field();
    (remove(1).props.onClick as () => void)();
    const writes = ledgerWrites();

    leave();
    await sleep(IDLE * 4);

    expect(writes.count()).toBe(0);
    expect(terms()).toContain("electrolyte");
    writes.stop();
    mounted.unmount();
  });

  it("a × inside a pending wait ends it: the settle is the × itself, the wait does not settle again", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);
    const { remove, leave, mounted } = await field();
    leave();
    const writes = ledgerWrites();
    (remove(2).props.onClick as () => void)();
    expect(terms()).not.toContain("electrolyte");
    await sleep(IDLE * 4);
    expect(writes.count()).toBe(1);
    writes.stop();
    mounted.unmount();
  });

  it("a question not yet settled is not in the ledger before the × and a × on another line settles it as the box stands", async () => {
    // The finished gesture settles the box as a whole, as a tick does (S5): the line the
    // reader typed and left unsettled is part of the box.
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    expect(terms()).not.toContain("electrolyte");
    const { remove, mounted } = await field();

    (remove(1).props.onClick as () => void)();

    expect(stored().settled).toEqual([B]);
    expect(terms()).toContain("electrolyte");
    expect(terms()).not.toContain("annealing");
    mounted.unmount();
  });

  it("a ticked question's × writes nothing: its words were never in", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT, [A]);
    settleQuestions(PAPER);
    const writes = ledgerWrites();
    const { remove, mounted } = await field();

    (remove(1).props.onClick as () => void)();

    expect(writes.count()).toBe(0);
    expect(terms()).toContain("electrolyte");
    writes.stop();
    mounted.unmount();
  });
});

describe("clearing the text with the keyboard still takes the words out when the box is left", () => {
  it("the line keeps focus, so leaving it is a blur: one write after the wait, none before", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    const { inputs, leave, mounted } = await field();
    const writes = ledgerWrites();

    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "" } });
    expect(terms().length).toBeGreaterThan(0);
    leave();
    await sleep(IDLE * 4);

    expect(terms()).toEqual([]);
    expect(writes.count()).toBe(1);
    writes.stop();
    mounted.unmount();
  });
});
