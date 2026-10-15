import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useReadingQuestionsStore } from "@/store/reading-questions";
import { check, focus, optionTexts, session } from "@/test-support/question-session";
import { ASK, STANDING } from "./copy";
import { chipGroups, standingGroup, withoutStandingRepeats } from "./question-field";

// P5-04 (N5, §1h.15 (g)): a standing question pressed on one paper is stored as that paper's
// question, so on the next paper it was offered twice — under "Your standing questions" and under
// "From your earlier questions" (A rendered it twice). A question now appears under one group
// only: the standing group has it and the example groups leave it out, compared trimmed and
// case-folded. With no standing questions nothing changes. The questions below are invented.

const PAPER = "openalex:W5";
const STANDING_Q = "Which cohort was studied, and how large was it?";
const OTHER_STANDING = "Are negative findings reported?";
const EARLIER_Q = "Does the anode crack after a hundred cycles?";
const PROFILE_Q = "Could I use XRD here?";
const EXAMPLES = [
  { label: ASK.fromEarlier, items: [STANDING_Q, EARLIER_Q] },
  { label: ASK.fromProfile, items: [PROFILE_Q] },
];

const texts = (groups: ReturnType<typeof chipGroups>) => groups.map((g) => ({ label: g.label, chips: g.chips.map((c) => c.text) }));

describe("withoutStandingRepeats", () => {
  const standing = [STANDING_Q, OTHER_STANDING];
  const groups = () => [standingGroup(standing, [""])!, ...chipGroups(EXAMPLES)];

  it("leaves a standing question out of the example groups and keeps it in the standing group", () => {
    expect(texts(withoutStandingRepeats(groups(), standing))).toEqual([
      { label: STANDING.chipGroup, chips: [STANDING_Q, OTHER_STANDING] },
      { label: ASK.fromEarlier, chips: [EARLIER_Q] },
      { label: ASK.fromProfile, chips: [PROFILE_Q] },
    ]);
  });

  it("compares trimmed and case-folded, and across a run of spaces", () => {
    const loud = [{ label: ASK.fromEarlier, items: [`  ${STANDING_Q.toUpperCase().replace(/ /g, "   ")} `, EARLIER_Q] }];
    expect(texts(withoutStandingRepeats(chipGroups(loud), standing))).toEqual([{ label: ASK.fromEarlier, chips: [EARLIER_Q] }]);
  });

  it("drops a group that is left with nothing", () => {
    const only = chipGroups([{ label: ASK.fromEarlier, items: [STANDING_Q] }]);
    expect(withoutStandingRepeats(only, standing)).toEqual([]);
  });

  it("with no standing questions the groups come back as they were (absent, empty, or junk)", () => {
    const today = chipGroups(EXAMPLES);
    for (const none of [undefined, [], ["", "   "], [4 as unknown as string]]) {
      expect(withoutStandingRepeats(today, none)).toEqual(today);
    }
  });

  it("reads the list as the standing group does — at most five — so a sixth, which is never offered, is not hidden", () => {
    const five = Array.from({ length: 5 }, (_, i) => `Standing question ${i} about the cohort?`);
    const sixth = "A sixth standing question that is never offered?";
    const earlier = chipGroups([{ label: ASK.fromEarlier, items: [sixth, five[0]] }]);
    expect(texts(withoutStandingRepeats(earlier, [...five, sixth]))).toEqual([{ label: ASK.fromEarlier, chips: [sixth] }]);
  });
});

// P10-03 re-aim of "the box: a standing question pressed on an earlier paper is one chip, not two": the box is the
// bar's dropdown, and the count is of its items while the bar has focus.
describe("the dropdown: a standing question picked on an earlier paper is one item, not two", () => {
  beforeEach(() => useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null }));

  /** The dropdown's items, in order, when the bar holds `text` and has focus. P10-11 re-aim (BACKLOG-72): the
   *  default text is one letter — the dropdown lists every suggestion there (one letter is no word to filter by), as
   *  these tests count them; the "Is the sample size reported?" they typed before matches none of them now that the
   *  list follows the typed text. P10-21 re-aim (X-A6): it was the empty bar's text, which now lists nothing. */
  async function listed(standing?: string[], text = "g"): Promise<{ headings: string[]; options: string[] }> {
    let seen = { headings: [] as string[], options: [] as string[] };
    await session(
      [
        focus,
        ({ bar }) => (bar.props.onChange as (e: unknown) => void)({ target: { value: text } }),
        check((view) => void (seen = { headings: view.headings, options: optionTexts(view) })),
      ],
      { paperId: PAPER, examples: EXAMPLES, standing },
    );
    return seen;
  }
  const count = (open: { options: string[] }, text: string) => open.options.filter((option) => option === text).length;

  it("A's measure: the standing question was on the page twice; now once, under the standing group, and the others stay", async () => {
    const open = await listed([STANDING_Q, OTHER_STANDING]);
    expect(count(open, STANDING_Q)).toBe(1);
    expect(open.options.indexOf(STANDING_Q)).toBeLessThan(open.options.indexOf(EARLIER_Q));
    expect(open.headings[0]).toBe(STANDING.chipGroup);
    expect(count(open, EARLIER_Q)).toBe(1);
    expect(count(open, PROFILE_Q)).toBe(1);
  });

  it("with no standing questions the dropdown is as it was: the question stays an earlier one, and nothing else differs", async () => {
    const today = await listed(undefined);
    expect(count(today, STANDING_Q)).toBe(1);
    expect(today.headings).not.toContain(STANDING.chipGroup);
    expect(await listed([])).toEqual(today);
    expect(await listed(["", "   "])).toEqual(today);
  });

  it("a standing question that is the bar's text is offered by no group", async () => {
    // P10-11 re-aim (BACKLOG-72): the other standing question shares a word with the bar's text ("cohort"), as the
    // list follows the typed text now; OTHER_STANDING shared none and would be filtered out.
    const sharesAWord = "How was the cohort recruited?";
    const open = await listed([STANDING_Q, sharesAWord], STANDING_Q);
    expect(count(open, STANDING_Q)).toBe(0);
    expect(count(open, sharesAWord)).toBe(1);
  });
});
