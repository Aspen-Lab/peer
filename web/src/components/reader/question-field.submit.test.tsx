import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P7-13 (R11c, the owner's R11; §1h.29 Q8): the Submit button. These cases need several
// gestures in a row, each seeing the field as the last one left it (the button's disabled
// state is a render of its own), so the field runs on the minimal hook runtime inside a
// scripted reader: one gesture per render round, as `question-field.tick.test.tsx` does.
// `question-field.settle.test.tsx` pins the single-gesture side (a click settles at once and
// writes the ledger once; leaving the box and unmounting settle nothing). Every question is
// invented.
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
import { ASK } from "./copy";
import { QuestionField, settleQuestions } from "./question-field";

const PAPER = "openalex:W713";
const AT = "2026-10-11T00:00:00.000Z";
const A = "Does annealing coarsen the grain boundaries?";
const B = "Is the electrolyte stable against dendrites?";
const C = "Which cathode survives fast charging?";
const D = "Does the separator resist thermal runaway?";
const E = "What limits the cycle life of the anode?";

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
  /** The Submit button of this render, if the box shows one. */
  submit: ReactElement<Props> | undefined;
}
type Step = (view: View) => void;

const type = (index: number, value: string): Step => ({ inputs }) => (inputs[index].props.onChange as (e: unknown) => void)({ target: { value } });
const enter = (index: number): Step => ({ inputs }) => (inputs[index].props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault: () => {} });
const tick = (index: number, on = true): Step => ({ boxes }) => (boxes[index].props.onChange as (e: unknown) => void)({ target: { checked: on } });
const focus: Step = ({ section }) => (section.props.onFocus as () => void)();
const leave: Step = ({ section }) => (section.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
const submit: Step = (view) => (view.submit!.props.onClick as () => void)();
const check = (fn: (view: View) => void): Step => fn;

class Wait extends Error {}
const wait = (ms: number): Step => {
  let until = 0;
  return () => {
    until = until || Date.now() + ms;
    if (Date.now() < until) throw new Wait();
  };
};

/** One page open: the field, and a reader who does one thing per render round. */
async function session(script: Step[]) {
  const queued = [...script];
  const latest: { view: View | null } = { view: null };
  const opened = await hookRuntime.mount(
    () => {
      const all = elements(QuestionField({ paperId: PAPER, examples: [] }));
      latest.view = {
        section: all.find((el) => el.type === "section")!,
        inputs: all.filter((el) => "data-ask-line" in el.props),
        boxes: all.filter((el) => el.type === "input" && el.props.type === "checkbox"),
        submit: all.find((el) => el.type === "button" && el.props.children === ASK.submit),
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
    { maxRounds: 200 },
  );
  opened.unmount();
}

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

const disabled = (view: View) => view.submit?.props.disabled;

describe("the Submit button — when there is something to send", () => {
  it("shows once the box is in use and is enabled while the typed set differs from the settled one", async () => {
    await session([
      check((view) => expect(view.submit).toBeUndefined()),
      focus,
      check((view) => {
        // Focused and empty: the button is there, with nothing to send.
        expect(view.submit).toBeDefined();
        expect(disabled(view)).toBe(true);
      }),
      type(0, A),
      check((view) => expect(disabled(view)).toBe(false)),
    ]);
  });

  it("is disabled when the cleaned items equal the settled set — at once on opening a settled paper", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);

    await session([check((view) => expect(disabled(view)).toBe(true))]);
  });

  it("is enabled on opening a paper whose questions were typed and never submitted", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);

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

  it("follows the set, not the keystrokes: edited and put back it is disabled again; spaces and case make no difference to it", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);

    await session([
      type(0, `${A} At 900 K?`),
      check((view) => expect(disabled(view)).toBe(false)),
      type(0, A),
      check((view) => expect(disabled(view)).toBe(true)),
      type(1, `  ${B}  `),
      check((view) => expect(disabled(view)).toBe(true)),
    ]);
  });

  it("is enabled when a question was added or taken away since the last settle", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);

    await session([
      type(0, ""),
      check((view) => expect(disabled(view)).toBe(false)),
      type(0, A),
      check((view) => expect(disabled(view)).toBe(true)),
      enter(0),
      type(1, B),
      check((view) => expect(disabled(view)).toBe(false)),
    ]);
  });

  it("clearing every line leaves something to send when questions were settled: Submit takes their words out of the ledger", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    settleQuestions(PAPER);
    expect(terms().length).toBeGreaterThan(0);
    const writes = ledgerWrites();

    await session([
      type(0, ""),
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
        // Nothing left to send, and nothing in the box: it is the quiet box again, without a button.
        expect(view.submit).toBeUndefined();
      }),
    ]);

    expect(writes.count()).toBe(1);
    writes.stop();
  });

  it("a mark moved since the last settle is something to send: an untick is not in the ledger until Submit", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT, [A]);
    useReadingQuestionsStore.getState().settle(PAPER);

    await session([
      check((view) => expect(disabled(view)).toBe(true)),
      tick(0, false),
      check((view) => {
        expect(terms()).toEqual([]);
        expect(disabled(view)).toBe(false);
      }),
      submit,
      check((view) => {
        expect(terms()).toContain("annealing");
        expect(disabled(view)).toBe(true);
      }),
    ]);
  });

  it("a tick settles the box as it stands, so the button is disabled after it", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);

    await session([
      check((view) => expect(disabled(view)).toBe(false)),
      tick(1),
      check((view) => {
        expect(stored().settled).toEqual([A, B]);
        expect(disabled(view)).toBe(true);
      }),
    ]);
  });
});

describe("Enter on the empty last line settles at once (§1h.29 Q8)", () => {
  it("Enter on a written line adds a line and settles nothing; Enter on that empty line settles the set on the spot", async () => {
    const writes = ledgerWrites();

    await session([
      type(0, A),
      enter(0),
      check((view) => {
        expect(view.inputs).toHaveLength(2);
        expect(stored().settled).toBeUndefined();
      }),
      enter(1),
      check((view) => {
        expect(stored().settled).toEqual([A]);
        expect(disabled(view)).toBe(true);
      }),
    ]);

    expect(writes.count()).toBe(1);
    writes.stop();
  });

  it("settles without waiting: nothing is pending between the second Enter and the check", async () => {
    await session([type(0, A), enter(0), enter(1), check(() => expect(stored().settled).toEqual([A]))]);
  });

  it("Enter on the last line of a full five-line box is the done gesture too; on any other line it is not", async () => {
    const script: Step[] = [];
    [A, B, C, D, E].forEach((text, index) => {
      script.push(type(index, text));
      if (index < 4) script.push(enter(index));
    });
    await session([...script, enter(3), check(() => expect(stored().settled).toBeUndefined()), enter(4), check(() => expect(stored().settled).toEqual([A, B, C, D, E]))]);
  });

  it("an Enter that settles twice changes nothing the second time", async () => {
    const writes = ledgerWrites();

    await session([type(0, A), enter(0), enter(1), enter(1), wait(20), check(() => expect(stored().settled).toEqual([A]))]);

    expect(writes.count()).toBe(1);
    writes.stop();
  });

  it("Submit after the Enter that settled finds nothing new: disabled, and a click would change nothing", async () => {
    await session([
      type(0, A),
      enter(0),
      enter(1),
      check((view) => expect(disabled(view)).toBe(true)),
    ]);
  });
});

describe("leaving the box settles nothing (§1h.29 — the blur + 1.5 s settle is gone)", () => {
  it("focus in, a question typed, focus out, a long wait: still unsettled, still enabled, nothing in the ledger", async () => {
    await session([
      focus,
      type(0, A),
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

  it("the typed set is held across leaving and coming back: it is still there to submit", async () => {
    await session([
      type(0, A),
      leave,
      focus,
      check((view) => expect(disabled(view)).toBe(false)),
      submit,
      check(() => expect(stored().settled).toEqual([A])),
    ]);
  });
});
