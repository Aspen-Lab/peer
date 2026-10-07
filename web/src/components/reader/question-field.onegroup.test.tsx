import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK, STANDING } from "./copy";
import { QuestionField, chipGroups, standingGroup, withoutStandingRepeats } from "./question-field";

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

describe("the box: a standing question pressed on an earlier paper is one chip, not two", () => {
  beforeEach(() => useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null }));

  const chips = (html: string, text: string) => html.split(`>${text}</button>`).length - 1;
  const render = (standing?: string[], line = "Is the sample size reported?") => {
    // A line of the box, so the chips show.
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: [line], gist: false, updatedAt: "2026-10-07T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    return renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, examples: EXAMPLES, standing }));
  };

  it("A's measure: the standing question was on the page twice; now once, under the standing group, and the others stay", () => {
    const html = render([STANDING_Q, OTHER_STANDING]);
    expect(chips(html, STANDING_Q)).toBe(1);
    expect(html.indexOf(`>${STANDING_Q}</button>`)).toBeGreaterThan(html.indexOf(STANDING.chipGroup));
    expect(html.indexOf(`>${STANDING_Q}</button>`)).toBeLessThan(html.indexOf(ASK.fromEarlier));
    expect(chips(html, EARLIER_Q)).toBe(1);
    expect(chips(html, PROFILE_Q)).toBe(1);
  });

  it("with no standing questions the box is as it was: the question stays an earlier chip, and nothing else differs", () => {
    const today = render(undefined);
    expect(chips(today, STANDING_Q)).toBe(1);
    expect(today).not.toContain(STANDING.chipGroup);
    expect(render([])).toBe(today);
    expect(render(["", "   "])).toBe(today);
  });

  it("a standing question that is already a line of the box is offered by no group", () => {
    const html = render([STANDING_Q, OTHER_STANDING], STANDING_Q);
    expect(chips(html, STANDING_Q)).toBe(0);
    expect(chips(html, OTHER_STANDING)).toBe(1);
  });
});
