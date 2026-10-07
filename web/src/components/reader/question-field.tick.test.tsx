import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P5-04 (S5, §1h.15 (e)): a tick settles the box as it stands before the ledger hears of it.
// A reproduced, in a browser, that after settling two questions, ticking the second (its words
// leave), editing it and ticking the FIRST box, the old text of the second came back into the
// ledger until the next settle: the sync read the live marks plus the marks as at the last
// settle, and the edit had moved the live mark to the new text, so the settled old text was no
// longer named by either. A tick now settles first (the settled list and the marks as they stand),
// then syncs; the two-list rule for an edit with no tick (a mark follows an edit) is unchanged,
// and an untick still lets the words in when the questions next settle.
//
// These cases need several gestures in a row, each seeing the field as the last one left it: no
// DOM here, so the field runs on the minimal hook runtime inside a scripted reader (one gesture
// per render round, as `question-box.flow.test.tsx` does). Every question is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile } from "@/types";
import { questionTermsOf } from "@/lib/preferences/ledger";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { QuestionField, settleQuestions } from "./question-field";

const PAPER = "openalex:W616";
const AT = "2026-10-07T00:00:00.000Z";
const A = "Does annealing coarsen the grain boundaries?";
const B = "Is the electrolyte stable against dendrites?";
const B2 = "Does the separator resist thermal runaway?";
const C = "Which cathode survives fast charging?";
// Words only one question holds (so a question's words can be told apart in the ledger).
const ONLY_A = ["annealing", "coarsen", "grain", "boundaries"];
const ONLY_B = ["electrolyte", "stable", "dendrites"];
const ONLY_B2 = ["separator", "resist", "thermal", "runaway"];
const ONLY_C = ["cathode", "survives", "fast", "charging"];

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

interface View {
  section: ReactElement<Props>;
  inputs: ReactElement<Props>[];
  boxes: ReactElement<Props>[];
}
type Step = (view: View) => void;

const tick = (index: number, on = true): Step => ({ boxes }) =>
  (boxes[index].props.onChange as (e: unknown) => void)({ target: { checked: on } });
const edit = (index: number, value: string): Step => ({ inputs }) =>
  (inputs[index].props.onChange as (e: unknown) => void)({ target: { value } });
const leave: Step = ({ section }) =>
  (section.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
const wait = (ms: number): Step => {
  let until = 0;
  return () => {
    // A step cannot sleep inside an effect; a wait is a busy-free poll of the clock by the driver.
    until = until || Date.now() + ms;
    if (Date.now() < until) throw new Wait();
  };
};
class Wait extends Error {}

/** One page open: the field, and a reader who does one thing per render round. */
async function session(script: Step[], idleMs = 1500) {
  const queued = [...script];
  const latest: { view: View | null } = { view: null };
  const opened = await hookRuntime.mount(
    () => {
      const all = elements(QuestionField({ paperId: PAPER, examples: [], idleMs }));
      latest.view = {
        section: all.find((el) => el.type === "section")!,
        inputs: all.filter((el) => "data-ask-line" in el.props),
        boxes: all.filter((el) => el.type === "input" && el.props.type === "checkbox"),
      };
      const [round, setRound] = useState(0);
      useEffect(() => {
        const next = queued[0];
        if (!next) return;
        try {
          next(latest.view!);
        } catch (error) {
          if (error instanceof Wait) {
            const timer = setTimeout(() => setRound((n) => n + 1), 2);
            return () => clearTimeout(timer);
          }
          throw error;
        }
        queued.shift();
        setRound((n) => n + 1);
      }, [round]);
      return null;
    },
    { maxRounds: 500 },
  );
  opened.unmount();
}

const ledger = () => useProfileStore.getState().profile.preferenceLedger;
const terms = () => questionTermsOf(ledger(), PAPER).sort();
const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];
const holds = (words: string[]) => words.filter((w) => terms().includes(w));
const check = (fn: () => void): Step => () => fn();

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

describe("a tick settles the box as it stands (P5-04, S5)", () => {
  it("A's order: settle two, tick 2, edit 2, tick 1 — none of 2's old words, none of its new, and (ticked too) none of 1's", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);
    expect(holds(ONLY_A)).toHaveLength(ONLY_A.length);
    expect(holds(ONLY_B)).toHaveLength(ONLY_B.length);

    await session([
      tick(1),
      check(() => {
        expect(holds(ONLY_B)).toEqual([]);
        expect(holds(ONLY_A)).toHaveLength(ONLY_A.length);
      }),
      edit(1, B2),
      tick(0),
      check(() => {
        expect(holds(ONLY_B)).toEqual([]);
        expect(holds(ONLY_B2)).toEqual([]);
        expect(holds(ONLY_A)).toEqual([]);
        expect(terms()).toEqual([]);
        // The settled list is the box as it stands, with the marks as they stand.
        expect(stored().settled).toEqual([A, B2]);
        expect(stored().settledNotForRecs).toEqual([A, B2]);
      }),
    ]);
  });

  it("with a third question, the second tick leaves the unticked one's words in: tick 2, edit 2, tick 3", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B, C], false, AT);
    settleQuestions(PAPER);

    await session([
      tick(1),
      edit(1, B2),
      tick(2),
      check(() => {
        expect(holds(ONLY_A)).toHaveLength(ONLY_A.length);
        expect(holds(ONLY_B)).toEqual([]);
        expect(holds(ONLY_B2)).toEqual([]);
        expect(holds(ONLY_C)).toEqual([]);
      }),
    ]);
  });

  it("the box as it stands is what a tick settles: a line edited since the last settle is settled with it", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);

    await session([
      edit(0, C),
      tick(1),
      check(() => {
        expect(stored().settled).toEqual([C, B]);
        expect(holds(ONLY_A)).toEqual([]);
        expect(holds(ONLY_C)).toHaveLength(ONLY_C.length);
        expect(holds(ONLY_B)).toEqual([]);
      }),
    ]);
  });

  it("a tick writes the ledger once and sends nothing", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const writes = ledgerWrites();

    await session([tick(0), check(() => expect(writes.count()).toBe(1))]);

    expect(fetched).not.toHaveBeenCalled();
    writes.stop();
  });
});

describe("the two-list rule and the untick stand", () => {
  it("a ticked question that is edited with no further tick stays out at the next settle", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);

    await session([
      tick(1),
      edit(1, B2),
      leave,
      wait(60),
      check(() => {
        expect(holds(ONLY_B)).toEqual([]);
        expect(holds(ONLY_B2)).toEqual([]);
        expect(holds(ONLY_A)).toHaveLength(ONLY_A.length);
      }),
    ], 15);
  });

  it("an untick lets the words in when the questions next settle, never the old text of an edited question", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    settleQuestions(PAPER);

    await session([
      tick(1),
      edit(1, B2),
      tick(1, false),
      check(() => {
        // Not yet, and never the old text: B is no longer a line of the box.
        expect(holds(ONLY_B)).toEqual([]);
        expect(holds(ONLY_B2)).toEqual([]);
      }),
      leave,
      wait(60),
      check(() => {
        expect(holds(ONLY_B2)).toHaveLength(ONLY_B2.length);
        expect(holds(ONLY_B)).toEqual([]);
      }),
    ], 15);
  });
});
