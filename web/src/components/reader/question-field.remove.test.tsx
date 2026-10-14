import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P5-04 (S3, §1h.15 (c)): a question deleted with the × button was a finished gesture, like a tick: its words
// left the preference ledger at once, not at the next visit to the box. P7-13 (R11c): leaving the box settles
// nothing (the owner took the blur + 1.5 s settle away); clearing the text takes the words out when the reader
// presses Submit (or Enter).
//
// P10-03 (round P10, review 2.5, 2.3): the × and the tick are gone with the lines — there is one question in one
// bar, and the reader deletes it by selecting and deleting. So this file is re-aimed: what survives of "a
// deleted question's words leave the ledger" is the keyboard gesture followed by Submit (P7-13), and that is all
// that can now delete a question. The five × tests are re-aimed to it, one for one:
//   "A's sequence: one settled question, × pressed, no focus or blur after — no words left, one ledger write, no
//    request"  ->  "emptying the bar and pressing Submit …"
//   "with two questions, × on one takes out its words, keeps the other's …"  ->  "a question replaced by another:
//    Submit takes the old words out and puts the new in"
//   "leaving the box after the × writes nothing more", "a × after leaving the box …"  ->  "leaving the box
//    before or after Submit writes nothing"
//   "a question not yet settled is not in the ledger before the × and a × on another line settles it …"  ->
//    "a question not yet submitted is not in the ledger"
//   "a ticked question's × writes nothing: its words were never in"  ->  gone with the tick; the switch's case
//    (words never in with the switch off) is in `question-field.optout.test.tsx`.
// No DOM: the field runs on the minimal hook runtime inside the scripted reader. Every question is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { defaultProfile } from "@/types";
import { questionTermsOf } from "@/lib/preferences/ledger";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { check, focus, leave, session as run, submit, type, wait, type Step } from "@/test-support/question-session";
import { settleQuestions } from "./question-field";

const PAPER = "openalex:W88";
const AT = "2026-10-07T00:00:00.000Z";
const A = "Does annealing coarsen the grain boundaries?";
const B = "Is the electrolyte stable against dendrites?";

const session = (script: Step[]) => run(script, { paperId: PAPER });
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

describe("emptying the bar takes the question's words out of the ledger when the reader submits (P5-04 S3, P7-13; P10)", () => {
  it("one settled question, the bar emptied, Submit: no words left, one ledger write, no request", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    expect(terms().length).toBeGreaterThan(0);
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const writes = ledgerWrites();

    await session([type(""), submit, check(() => expect(terms()).toEqual([]))]);

    expect(writes.count()).toBe(1);
    expect(fetched).not.toHaveBeenCalled();
    writes.stop();
  });

  it("emptying the bar settles nothing by itself: the words stay in the ledger, and the settled set stands, until Submit", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    const writes = ledgerWrites();

    await session([
      focus,
      type(""),
      leave,
      wait(60),
      check((view) => {
        expect(terms().length).toBeGreaterThan(0);
        expect(view.submit.props.disabled).toBe(false);
      }),
    ]);

    expect(writes.count()).toBe(0);
    writes.stop();
  });

  it("a question replaced by another: Submit takes the old words out and puts the new ones in", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    expect(terms()).toContain("annealing");

    await session([
      type(B),
      check(() => expect(terms()).toContain("annealing")),
      submit,
      check(() => {
        expect(stored().settled).toEqual([B]);
        expect(terms()).toContain("electrolyte");
        expect(terms()).not.toContain("annealing");
      }),
    ]);
  });

  it("leaving the box before or after Submit writes nothing more", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    const writes = ledgerWrites();

    await session([
      focus,
      leave,
      wait(40),
      check(() => expect(writes.count()).toBe(0)),
      submit,
      check(() => expect(writes.count()).toBe(1)),
      leave,
      focus,
      leave,
      wait(40),
      check(() => expect(writes.count()).toBe(1)),
    ]);
    writes.stop();
  });

  it("a question not yet submitted is not in the ledger", async () => {
    await session([focus, type(A), leave, wait(40), check(() => expect(terms()).toEqual([]))]);
    expect(stored().settled).toBeUndefined();
  });
});
