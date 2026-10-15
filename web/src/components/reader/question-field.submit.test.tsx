import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P7-13 (R11c, the owner's R11; §1h.29 Q8): the Submit control. These cases need several
// gestures in a row, each seeing the field as the last one left it (the control's disabled
// state is a render of its own), so the field runs on the minimal hook runtime inside a
// scripted reader: one gesture per render round (`test-support/question-session.ts`).
// `question-field.settle.test.tsx` pins the single-gesture side (a click settles at once and
// writes the ledger once; leaving the box and unmounting settle nothing). Every question is
// invented. P10-03 (review 2.5, 2.6): one question in one bar, the control inside the bar and
// there from the start, inert until the text is a question not yet submitted; Enter submits.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { defaultProfile } from "@/types";
import { questionTermsOf } from "@/lib/preferences/ledger";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { check, enter, focus, leave, session as run, submit, type, wait, type Step, type View } from "@/test-support/question-session";
import { settleQuestions } from "./question-field";

const PAPER = "openalex:W713";
const AT = "2026-10-11T00:00:00.000Z";
const A = "Does annealing coarsen the grain boundaries?";
const B = "Is the electrolyte stable against dendrites?";

const session = (script: Step[]) => run(script, { paperId: PAPER });

const ledger = () => useProfileStore.getState().profile.preferenceLedger;
const terms = () => questionTermsOf(ledger(), PAPER).sort();
const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];

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

const disabled = (view: View) => view.submit.props.disabled;

describe("the Submit control — when there is something to send", () => {
  // P10-03 re-aim of "shows once the box is in use …": the control is in the bar from the start (a search bar
  // has its button), so what is pinned is its state — inert while the bar is empty, live once a question is in it.
  it("is in the bar from the start, inert while it is empty, and enabled while the typed question differs from the settled one", async () => {
    await session([
      check((view) => {
        expect(view.submit).toBeDefined();
        expect(disabled(view)).toBe(true);
      }),
      focus,
      check((view) => expect(disabled(view)).toBe(true)),
      type(A),
      check((view) => expect(disabled(view)).toBe(false)),
    ]);
  });

  it("is disabled when the cleaned item equals the settled set — at once on opening a settled paper", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);

    await session([check((view) => expect(disabled(view)).toBe(true))]);
  });

  it("is enabled on opening a paper whose question was typed and never submitted", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);

    await session([check((view) => expect(disabled(view)).toBe(false))]);
  });

  it("is disabled again after a click, and the click is what settles", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);

    await session([
      check((view) => expect(disabled(view)).toBe(false)),
      submit,
      check((view) => {
        expect(stored().settled).toEqual([A]);
        expect(disabled(view)).toBe(true);
      }),
    ]);
  });

  it("follows the text, not the keystrokes: edited and put back it is disabled again; spaces at the edges make no difference to it", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);

    await session([
      type(`${A} At 900 K?`),
      check((view) => expect(disabled(view)).toBe(false)),
      type(A),
      check((view) => expect(disabled(view)).toBe(true)),
      type(`  ${A}  `),
      check((view) => expect(disabled(view)).toBe(true)),
    ]);
  });

  it("is enabled when the question was changed or taken away since the last settle", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);

    await session([
      type(""),
      check((view) => expect(disabled(view)).toBe(false)),
      type(A),
      check((view) => expect(disabled(view)).toBe(true)),
      type(B),
      check((view) => expect(disabled(view)).toBe(false)),
    ]);
  });

  // P10-03 re-aim: "clearing every line … Submit takes their words out of the ledger" — after it the bar is
  // empty and nothing is left to send, so the control is inert (it no longer vanishes with the quiet box).
  it("clearing the bar leaves something to send when a question was settled: Submit takes its words out of the ledger", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    expect(terms().length).toBeGreaterThan(0);
    const writes = ledgerWrites();

    await session([
      type(""),
      // Leaving the box does not send it…
      leave,
      check((view) => {
        expect(terms().length).toBeGreaterThan(0);
        expect(disabled(view)).toBe(false);
      }),
      // …Submit does.
      submit,
      check((view) => {
        expect(terms()).toEqual([]);
        // Nothing left to send, and nothing in the bar: the control is there and inert.
        expect(disabled(view)).toBe(true);
      }),
    ]);

    expect(writes.count()).toBe(1);
    writes.stop();
  });

  // Removed with the tick (P10-03, review 2.3): "a mark moved since the last settle is something to send: an untick
  // is not in the ledger until Submit" and "a tick settles the box as it stands, so the button is disabled after it".
  // The one opt-out is the Profile's switch (`question-field.optout.test.tsx`).
});

// P10-03 re-aim of "Enter on the empty last line settles at once (§1h.29 Q8)": there is no last line; Enter settles.
describe("Enter settles at once (§1h.29 Q8; P10)", () => {
  it("Enter on a written question settles it on the spot, and the control is inert after it", async () => {
    const writes = ledgerWrites();

    await session([
      type(A),
      check(() => expect(stored().settled).toBeUndefined()),
      enter,
      check((view) => {
        expect(view.inputs).toHaveLength(1);
        expect(stored().settled).toEqual([A]);
        expect(disabled(view)).toBe(true);
      }),
    ]);

    expect(writes.count()).toBe(1);
    writes.stop();
  });

  it("settles without waiting: nothing is pending between the Enter and the check", async () => {
    await session([type(A), enter, check(() => expect(stored().settled).toEqual([A]))]);
  });

  it("an Enter that settles twice changes nothing the second time", async () => {
    const writes = ledgerWrites();

    await session([type(A), enter, enter, wait(20), check(() => expect(stored().settled).toEqual([A]))]);

    expect(writes.count()).toBe(1);
    writes.stop();
  });

  it("Submit after the Enter that settled finds nothing new: disabled, and a click would change nothing", async () => {
    const writes = ledgerWrites();
    await session([type(A), enter, check((view) => expect(disabled(view)).toBe(true)), submit, check(() => expect(writes.count()).toBe(1))]);
    writes.stop();
  });
});

describe("leaving the box settles nothing (§1h.29 — the blur + 1.5 s settle is gone)", () => {
  it("focus in, a question typed, focus out, a long wait: still unsettled, still enabled, nothing in the ledger", async () => {
    await session([
      focus,
      type(A),
      leave,
      wait(80),
      check((view) => {
        expect(stored().items).toEqual([A]);
        expect(stored().settled).toBeUndefined();
        expect(terms()).toEqual([]);
        expect(disabled(view)).toBe(false);
      }),
    ]);
  });

  it("the typed question is held across leaving and coming back: it is still there to submit", async () => {
    await session([
      type(A),
      leave,
      focus,
      check((view) => expect(disabled(view)).toBe(false)),
      submit,
      check(() => expect(stored().settled).toEqual([A])),
    ]);
  });
});
