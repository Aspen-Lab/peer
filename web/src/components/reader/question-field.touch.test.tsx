import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P9-52 (A P9-W3's N5, §6 item 5): on a phone (390 x 844, touch) the question box's controls were too small to
// hit: the "Remove question N" × was 7 x 16 px, the opt-out checkbox 13 x 13 px. Where there is
// no hover (`hover: none`) they became 44 px targets; with a mouse nothing moved. P10-03 (round P10): the × and
// the checkbox are gone with the lines; the controls left are the Submit control in the bar and the dropdown's
// items, and the same rule holds for them — a 44 px floor where there is no hover, none for a mouse beyond the
// bar's own 48 px. Layout is not computed in this node environment: the boxes are in the checkpoint
// (docs/reading-helper-abc/P10-03-C-*.md), and this file pins the classes that make them.
// No DOM: the field runs on the scripted reader and its elements are read, as the sibling files do. Invented words.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { check, focus, session, type as typeStep, type El } from "@/test-support/question-session";
import { ASK } from "./copy";

const PAPER = "openalex:W52";
const A = "Does a denser planting clean more water than sand?";
const EXAMPLES = [{ label: ASK.fromEarlier, items: ["How long must the water stay inside a bed?"] }];

const classesOf = (el: El | undefined) => String(el?.props.className ?? "").split(/\s+/).filter(Boolean);

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile } });
});
afterEach(() => vi.unstubAllGlobals());

const TOUCH_H = "[@media(hover:none)]:min-h-11";

// P10-03 re-aim of "the × beside a question is a 44 x 44 target where there is no hover" and "the 'Not for
// recommendations' row is a 44 px target where there is no hover": the × and the row no longer exist; the
// same floor is pinned on the Submit control and the dropdown's items.
describe("the bar's controls are 44 px targets where there is no hover (P9-52, N5; P10)", () => {
  it("the Submit control and every item of the dropdown carry the touch floor", async () => {
    await session(
      [
        focus,
        typeStep("g"), // P10-21 re-aim (X-A6): the first character opens the list
        check((view) => {
          expect(classesOf(view.submit)).toContain(TOUCH_H);
          expect(view.options).toHaveLength(2);
          for (const option of view.options) expect(classesOf(option)).toContain(TOUCH_H);
        }),
      ],
      { paperId: PAPER, examples: EXAMPLES },
    );
  });

  it("the Submit control is still the same word in the same quiet face: only the hit area is guaranteed", async () => {
    await session(
      [
        check((view) => {
          expect(view.submit.props.children).toBe(ASK.submit);
          expect(view.submit.props.type).toBe("button");
          expect(classesOf(view.submit)).toEqual(expect.arrayContaining(["annotation", "shrink-0"]));
        }),
      ],
      { paperId: PAPER, examples: [] },
    );
  });

  it("the box has no checkbox and no ×, so there is nothing small left to hit", async () => {
    await session(
      [focus, check((view) => {
        expect(view.boxes).toHaveLength(0);
        expect(view.all.filter((el) => el.type === "button").map((el) => el.props.children)).toEqual([ASK.submit]);
      })],
      { paperId: PAPER, examples: EXAMPLES },
    );
  });
});

describe("a mouse's question bar is the one it should be (P9-52, rule 2)", () => {
  it("has no height or width floor outside hover:none on the Submit control or the items, and the bar's own is 48 px", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, "2026-10-12T00:00:00.000Z");
    await session(
      [
        focus,
        check((view) => {
          for (const el of [view.submit, ...view.options]) {
            for (const cls of classesOf(el)) {
              if (/(^|:)(min-h|min-w|h|w)-/.test(cls)) expect(cls.startsWith("[@media(hover:none)]:"), cls).toBe(true);
            }
          }
          const bar = view.all.find((el) => "data-ask-bar" in el.props);
          expect(classesOf(bar)).toContain("min-h-12");
        }),
      ],
      { paperId: PAPER, examples: EXAMPLES },
    );
  });
});
