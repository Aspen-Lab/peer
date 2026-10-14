import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P5-02 (blueprint P5, brief commit 2) put an opt-out checkbox on every question in the box; the
// ledger heard of a paper's questions once per settle — never per keystroke — and a ticked question's terms never
// entered it, or left it at once if they were in. P10-03 (round P10, ruling §1h.78; review 2.3, rubric A6): the
// checkbox is gone, and the one opt-out is a switch on the Profile — `profile.questionsTuneRecommendations`
// (absent = on), labelled "Use my questions to tune recommendations". Off, the ledger learns nothing from the
// questions submitted; turning it off removes nothing already learned. This file keeps what survived (when the ledger
// hears, and what it holds) and re-aims the checkbox's cases to the switch, one for one:
//   "is not there with no question", "is one per question, labelled …", "an old stored list loads unticked",
//   "shows a stored mark as ticked"  ->  "the box has no checkbox" (and `question-field.bar.test.tsx`)
//   "ticking writes the mark to the store and takes an already entered question's terms out at once"  ->
//     "turning it off removes nothing already learned"
//   "unticking puts the terms back only when the questions next settle"  ->  "turning it back on lets the words in at
//     the next Submit, not before"
//   "a ticked line stays ticked while the reader edits it"  ->  gone with the mark; the stored mark keys are ignored
//     (`store/reading-questions.optout.test.ts`)
//   "a ticked question's terms never enter; an unticked one's do"  ->  "with the switch off the question's terms never enter"
// No DOM: the field runs on the minimal hook runtime inside the scripted reader. Invented words.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { defaultProfile } from "@/types";
import { applyPreferenceSignal, questionTermsOf, termConcept } from "@/lib/preferences/ledger";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { check, focus, leave, session as run, submit, type, wait, type Step } from "@/test-support/question-session";
import { settleQuestions } from "./question-field";

const PAPER = "openalex:W7";
const AT = "2026-10-07T00:00:00.000Z";
const A = "Does annealing coarsen the grain boundaries?";
const B = "Is the electrolyte stable against dendrites?";

const session = (script: Step[]) => run(script, { paperId: PAPER });
const ledger = () => useProfileStore.getState().profile.preferenceLedger;
const terms = () => questionTermsOf(ledger(), PAPER).sort();
const storedEntry = () => useReadingQuestionsStore.getState().byPaper[PAPER];
const switchTo = (on: boolean | undefined) =>
  useProfileStore.setState({ profile: { ...useProfileStore.getState().profile, questionsTuneRecommendations: on } });

const realRecord = useProfileStore.getState().recordQuestionTerms;

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile }, recordQuestionTerms: realRecord });
});
afterEach(() => vi.unstubAllGlobals());

describe("the switch on the Profile (A6): on by default", () => {
  it("a fresh profile has it absent, which is on: a submitted question's terms enter the ledger", async () => {
    expect(useProfileStore.getState().profile.questionsTuneRecommendations).toBeUndefined();
    await session([type(A), submit, check(() => expect(terms()).toEqual(expect.arrayContaining(["annealing", "grain"])))]);
  });

  it("an explicit true is the same as absent", async () => {
    switchTo(true);
    await session([type(A), submit, check(() => expect(terms()).toContain("annealing"))]);
  });

  it("the box has no checkbox, whatever is stored: the old marks are not read", async () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: [A], gist: false, updatedAt: AT, notForRecs: [A] } as never },
    });
    await session([
      check((view) => expect(view.boxes).toHaveLength(0)),
      submit,
      // A mark from an earlier version keeps nothing out any more: only the switch does.
      check(() => expect(terms()).toContain("annealing")),
    ]);
  });
});

describe("with the switch off", () => {
  it("the question's terms never enter, however it is submitted; the report is still asked (the question is settled)", async () => {
    switchTo(false);
    const record = vi.fn();
    useProfileStore.setState({ recordQuestionTerms: record });
    await session([type(A), submit, check(() => expect(storedEntry().settled).toEqual([A]))]);
    expect(record).not.toHaveBeenCalled();
    expect(terms()).toEqual([]);
    // Enter is Submit's twin.
    await session([type(B), ({ bar }) => (bar.props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault: () => {} }), check(() => expect(storedEntry().settled).toEqual([B]))]);
    expect(record).not.toHaveBeenCalled();
  });

  it("turning it off removes nothing already learned, and a like on the same word stands", async () => {
    const liked = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: AT });
    useProfileStore.setState({ profile: { ...defaultProfile, preferenceLedger: liked } });
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    const learned = terms();
    expect(learned).toContain("annealing");

    switchTo(false);
    await session([type(B), submit, check(() => expect(storedEntry().settled).toEqual([B]))]);

    expect(terms()).toEqual(learned);
    expect(terms()).not.toContain("electrolyte");
    expect(ledger()?.["text:grain"]?.positive).toBe(1);
  });

  it("emptying the bar and submitting with it off leaves the ledger as it was (the words stay, as the privacy page says)", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    const learned = terms();
    switchTo(false);
    await session([type(""), submit, check(() => expect(terms()).toEqual(learned))]);
  });

  it("turning it back on lets the words in at the next Submit, not before", async () => {
    switchTo(false);
    await session([type(A), submit]);
    expect(terms()).toEqual([]);
    switchTo(true);
    // The question is already settled; nothing is sent by the switch itself.
    expect(terms()).toEqual([]);
    await session([type(`${A} At 900 K?`), leave, wait(40), check(() => expect(terms()).toEqual([])), submit, check(() => expect(terms()).toContain("annealing"))]);
  });

  it("is read when the reader submits, not when the page opened: a switch turned off after typing keeps the words out", async () => {
    await session([focus, type(A), () => switchTo(false), submit, check(() => expect(terms()).toEqual([]))]);
  });
});

describe("what reaches the ledger, and when", () => {
  it("never on a keystroke, nor on leaving the box; once when the reader submits", async () => {
    const record = vi.fn();
    useProfileStore.setState({ recordQuestionTerms: record });
    await session([
      ...["D", "Do", "Does annealing", A].map((value) => type(value)),
      wait(60),
      check(() => expect(record).not.toHaveBeenCalled()),
      leave,
      wait(60),
      check(() => expect(record).not.toHaveBeenCalled()),
    ]);
    // The reader leaves the page and comes back: the typed question is still there, and Submit sends it.
    await session([submit]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(PAPER);
  });

  it("emptying the bar and settling takes the paper's terms out (switch on)", async () => {
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
