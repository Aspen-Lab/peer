import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P2-03 (§1g.11 a): the field settles the question — the one a deep report
// is asked about. P2-08b (§1g.18) timed that to the box as a whole. P7-13 (R11c, the
// owner's order) takes the guessing out: it is sent only by what the reader does on
// purpose. P10-03 (review 2.5): that is the Submit control and Enter — there is one
// question, so no line to end, and no × or tick any more. Leaving the box settles
// nothing, and neither does a wait (there is none) or leaving the page. Never on a
// keystroke, never on the gist pick. No DOM here: the field runs on the minimal hook
// runtime and its own handlers are called on the element tree it returns.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK } from "./copy";
import { check as step, focus as focusStep, pick, session, type as typeStep } from "@/test-support/question-session";
import { QuestionField, enterAction, leftTheBox } from "./question-field";

const PAPER = "openalex:W1";
const AT = "2026-10-05T00:00:00.000Z";
/** P1-09 (§1f.20): the page's example groups. */
const EXAMPLE = "Does this help with dendrite growth?";
const EXAMPLES = [{ label: ASK.fromProfile, items: [EXAMPLE] }];
/** A few milliseconds: the tests wait for real, the runtime uses real timers. */
const WAIT = 60;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const section = all.find((el) => el.type === "section")!;
  const button = (label: string) => all.find((el) => el.type === "button" && el.props.children === label);
  const submit = () => (button(ASK.submit)!.props.onClick as () => void)();
  /** Focus leaves the box: the section's own blur, with nothing receiving focus. */
  const leave = () => (section.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
  return { mounted, inputs, button, submit, leave, section };
}

const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];

// P2-10 (§1g.21 (6)) had the field listen for `pagehide` while its wait was
// pending. The wait is gone (P7-13), and so is the listener. This suite has no
// DOM, so `window` is a bare event target the tests can read: how many
// listeners each event has, and a way to fire one.
let windowListeners: Map<string, Set<() => void>>;
const listenerCount = (type: string) => windowListeners.get(type)?.size ?? 0;
const fireOnWindow = (type: string) => [...(windowListeners.get(type) ?? [])].forEach((listener) => listener());

beforeEach(() => {
  windowListeners = new Map();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: () => void) => {
      windowListeners.set(type, (windowListeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: () => void) => {
      windowListeners.get(type)?.delete(listener);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the field settles the questions (P2-03)", () => {
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
  });

  // P2-08b (§1g.18): this test named the events that settle as Enter, blur and
  // removal. P7-13 (R11c): leaving the box no longer settles it, so the test
  // names what does and what does not, through the same pure functions the
  // handlers use. (It also pinned `BOX_IDLE_MS`, the wait after leaving the
  // box, 1500 ms: that constant is gone with the wait.) P10-03 re-aim of "names what ends
  // the box: Enter on an empty last line or on the last line of a full box": there is no
  // last line; Enter submits unless it picks a highlighted item (`enterAction`).
  it("names what ends the box: Enter (unless it picks an item) and the Submit control — nothing a focus does", () => {
    // Focus moving to another control inside the box is not leaving it.
    expect(leftTheBox({ contains: () => true } as unknown as Node, {} as EventTarget)).toBe(false);
    expect(leftTheBox({ contains: () => false } as unknown as Node, {} as EventTarget)).toBe(true);
    expect(leftTheBox({ contains: () => false } as unknown as Node, null)).toBe(true);
    // Enter submits; with the dropdown open and an item highlighted it picks that item, which settles nothing.
    expect(enterAction(false, -1)).toBe("submit");
    expect(enterAction(true, -1)).toBe("submit");
    expect(enterAction(true, 0)).toBe("pick");
    expect(enterAction(false, 0)).toBe("submit");
  });

  it("typing writes through to items and settles nothing", async () => {
    const { inputs, mounted } = await field();
    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "Does tungsten delay rafting at 1100 C?" } });

    expect(stored().items).toEqual(["Does tungsten delay rafting at 1100 C?"]);
    expect(stored().settled).toBeUndefined();
    mounted.unmount();
  });

  // P2-08b (§1g.18): used to say Enter settles nothing — pressing Enter between questions was how a reader
  // typed five of them, and each settle was a deep report. P10-03 re-aim: there is one question, and Enter is
  // the reader saying it is done, so it settles on the spot (P7-13's Enter on the empty last line).
  it("Enter settles the question at once: no wait, no timer", async () => {
    const { inputs, mounted } = await field();
    (inputs[0].props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault: () => {} });

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    await sleep(WAIT);
    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  // P7-13 (R11c): replaces "a line's blur settles nothing; leaving the box
  // settles it after the wait, not before" (P2-08b), whose second half the
  // owner removed: leaving the box, and then staying away, settles nothing.
  it("a line's blur and leaving the box settle nothing, however long the reader then stays away", async () => {
    const { inputs, leave, mounted } = await field();
    (inputs[0].props.onBlur as () => void)();
    leave();
    await sleep(WAIT);

    expect(stored().settled).toBeUndefined();
    expect(stored().items).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  // P2-08b (§1g.18): used to say removing a line settles nothing, and P5-04 (S3, §1h.15 (c)) ruled the × a
  // finished gesture that settles at once ("removing a line settles what is left at once; leaving the box
  // afterwards changes nothing"). P10-03: the × is gone with the lines. Emptying the bar is typing like any other
  // and settles nothing; that test is re-aimed in `question-field.remove.test.tsx` ("emptying the bar …").

  // P7-13 (R11c): replaces "an unmount with no wait pending settles nothing"
  // and "leaving the page during the wait settles at once" (§1g.21 (5)). There
  // is no wait to leave inside of: an unmount settles nothing, typed questions
  // or not, and the typed set stays in the store, unsent, for the next visit.
  it("an unmount settles nothing, with questions typed and not submitted", async () => {
    const { mounted } = await field();
    mounted.unmount();

    expect(stored().settled).toBeUndefined();
    expect(stored().items).toEqual(["Does tungsten delay rafting?"]);
  });

  // P10-03 re-aim of "the gist toggle settles nothing" and "an example chip fills the next line and settles nothing
  // until the reader submits (P1-09)": the gist and the examples are the dropdown's items, picked on the scripted reader.
  it("picking the gist settles nothing", async () => {
    await session(
      [focusStep, pick(1), step(() => {
        expect(stored().gist).toBe(true);
        expect(stored().settled).toBeUndefined();
      })],
      { paperId: PAPER, examples: EXAMPLES },
    );
  });

  it("an example picked from the dropdown fills the bar and settles nothing until the reader submits (P1-09)", async () => {
    useReadingQuestionsStore.getState().clear(PAPER);
    await session(
      [
        focusStep,
        typeStep("g"), // P10-21 re-aim (X-A6): the first character opens the list
        pick(0),
        step(() => {
          expect(stored().items).toEqual([EXAMPLE]);
          expect(stored().settled).toBeUndefined();
        }),
        // The reader leaves the bar, or presses Enter after the pick: leaving settles nothing.
        ({ section }) => (section.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null }),
        step(() => expect(stored().settled).toBeUndefined()),
        // Submit does.
        ({ submit }) => (submit.props.onClick as () => void)(),
        step(() => expect(stored().settled).toEqual([EXAMPLE])),
      ],
      { paperId: PAPER, examples: EXAMPLES },
    );
  });
});

// P7-13 (R11c, §1h.29 Q8): the Submit button settles the question at once, and so does Enter (P10).
describe("Submit settles the questions at once (P7-13)", () => {
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    useProfileStore.setState({ profile: { ...defaultProfile } });
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
  });

  const ledgerWrites = () => {
    let n = 0;
    const stop = useProfileStore.subscribe((state, previous) => {
      if (state.profile.preferenceLedger !== previous.profile.preferenceLedger) n += 1;
    });
    return { count: () => n, stop };
  };

  it("a click settles the typed set on the spot: no wait, no timer", async () => {
    const { submit, mounted } = await field();
    expect(stored().settled).toBeUndefined();

    submit();

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  it("writes the preference ledger once, with the settled questions' terms", async () => {
    const writes = ledgerWrites();
    const { submit, mounted } = await field();

    submit();

    expect(writes.count()).toBe(1);
    expect(Object.keys(useProfileStore.getState().profile.preferenceLedger ?? {}).length).toBeGreaterThan(0);
    // Nothing more comes later.
    await sleep(WAIT);
    expect(writes.count()).toBe(1);
    writes.stop();
    mounted.unmount();
  });

  it("sends nothing itself: the field only writes the store, the report hook asks for the report", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const { submit, mounted } = await field();

    submit();

    expect(fetched).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("registers no pagehide listener, before or after, and a pagehide settles nothing", async () => {
    const { inputs, section, submit, mounted } = await field();
    (section.props.onFocus as () => void)();
    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "Does tungsten delay rafting at 1100 C?" } });
    expect(listenerCount("pagehide")).toBe(0);

    fireOnWindow("pagehide");
    expect(stored().settled).toBeUndefined();
    submit();
    expect(listenerCount("pagehide")).toBe(0);
    mounted.unmount();
    expect(listenerCount("pagehide")).toBe(0);
  });

  it("after Submit nothing settles by itself: a question typed afterwards waits for the next Submit", async () => {
    const { inputs, leave, submit, mounted } = await field();
    submit();
    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "Does tungsten delay rafting at 1100 C?" } });
    leave();
    await sleep(WAIT);

    expect(stored().items).toEqual(["Does tungsten delay rafting at 1100 C?"]);
    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  it("a second click with nothing new changes nothing and writes the ledger no more", async () => {
    const { submit, mounted } = await field();
    submit();
    const writes = ledgerWrites();

    submit();

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    expect(writes.count()).toBe(0);
    writes.stop();
    mounted.unmount();
  });
});
