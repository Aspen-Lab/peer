import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { questionTermsOf } from "@/lib/preferences/ledger";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { check, enter, focus, key, leave, pick, session, submit, type, type Step, type View } from "@/test-support/question-session";

const PAPER = "invented:submission";
const Q = "Does the invented coating retain water?";
const run = (steps: Step[], paperId = PAPER, extra = {}) => session(steps, { paperId, ...extra });
const state = (label: string, inert: boolean): Step => check((view: View) => {
  expect(view.submit.props.children).toBe(label);
  expect(view.submit.props["aria-disabled"]).toBe(inert);
  expect(view.submit.props.disabled).toBeUndefined();
});

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile } });
});
afterEach(() => vi.unstubAllGlobals());

describe("P12-06 truthful raw acknowledgement with normalized request guards", () => {
  it("starts orange Submit even when empty, and guards empty mouse and Enter", async () => {
    const settle = vi.spyOn(useReadingQuestionsStore.getState(), "settle");
    await run([state("Submit", true), submit, enter, type("   "), submit, enter, state("Submit", true)]);
    expect(settle).not.toHaveBeenCalled();
    expect(useReadingQuestionsStore.getState().byPaper[PAPER]).toBeUndefined();
    settle.mockRestore();
  });

  it("acknowledges mouse/Enter once, edits and exact reverts, without losing raw spaces", async () => {
    const settle = vi.spyOn(useReadingQuestionsStore.getState(), "settle");
    await run([
      type(Q), state("Submit", false), submit, state("Submitted", true), submit, enter,
      type(`${Q} More?`), state("Submit", false), type(Q), state("Submitted", true),
      type(`  ${Q}  `), state("Submit", false), enter, state("Submitted", true),
      check((v) => expect(v.bar.props.value).toBe(`  ${Q}  `)), submit, enter,
      type(Q), state("Submit", false), submit, state("Submitted", true),
    ]);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(useReadingQuestionsStore.getState().byPaper[PAPER].settled).toEqual([Q]);
    settle.mockRestore();
  });

  it("never acknowledges typing, blur, composition Enter or an example pick", async () => {
    await run([
      focus, type("g"), key("ArrowDown"), enter, state("Submit", false),
      check((v) => expect(v.bar.props.value).toBe(Q)),
      key("Enter", { nativeEvent: { isComposing: true } }), leave, state("Submit", false),
      check(() => expect(useReadingQuestionsStore.getState().byPaper[PAPER].settled).toBeUndefined()),
      enter, state("Submitted", true),
    ], PAPER, { examples: [{ label: "Invented examples", items: [Q] }] });
  });

  it("initializes reload from normalized stored settled text and separates a different paper", async () => {
    await run([type(`  ${Q}  `), submit, state("Submitted", true)]);
    await run([check((v) => expect(v.bar.props.value).toBe(Q)), state("Submitted", true)]);
    await run([state("Submit", true)], "invented:different");
    useReadingQuestionsStore.getState().set(PAPER, ["A new question?"], false);
    await run([state("Submit", false)]);
  });

  it("explicit clearing acknowledges empty only in this session and keeps ledger removal", async () => {
    await run([type(Q), submit, type(""), state("Submit", false), submit, state("Submitted", true), enter]);
    expect(useReadingQuestionsStore.getState().byPaper[PAPER]).toBeUndefined();
    expect(questionTermsOf(useProfileStore.getState().profile.preferenceLedger, PAPER)).toEqual([]);
    await run([state("Submit", true)]);
  });

  it("gist and standing modes do not pretend to have submitted a question", async () => {
    await run([focus, type("x"), pick(0), state("Submit", true), submit, enter,
      check(() => expect(useReadingQuestionsStore.getState().byPaper[PAPER].settled).toBeUndefined())]);
    await run([state("Submit", true), focus, type("g"), pick(0), state("Submit", false), enter, state("Submitted", true)],
      PAPER, { standing: [Q] });
  });

  it("uses shared orange/white action tokens and readable neutral Submitted with visible focus", async () => {
    await run([check((v) => {
      expect(v.submit.props.className).toContain("bg-action-orange");
      expect(v.submit.props.className).toContain("text-action-foreground");
      expect(v.submit.props.className).toContain("focus-visible:outline-action-focus");
    }), type(Q), submit, check((v) => {
      expect(v.submit.props.className).toContain("bg-bg-secondary");
      expect(v.submit.props.className).toContain("text-text-muted");
      expect(v.submit.props.className).not.toContain("bg-action-orange");
    })]);
  });
});
