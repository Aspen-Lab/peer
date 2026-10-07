import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK, STANDING } from "./copy";
import { QuestionField, fillNextLine, standingGroup } from "./question-field";

// P5-01 (brief commit 2): the standing questions as ONE chip group in the question box. Shown only
// when the profile has some; a press adds the line exactly as an example tag does; never filled in
// on load. Questions below are invented.

const PAPER = "openalex:W2";
const STANDING_Q = ["Which cohort was studied, and how large was it?", "Are negative findings reported?"];
const EXAMPLES = [{ label: ASK.fromProfile, items: ["Could I use XRD here?"] }];

function withLines(items: string[]) {
  useReadingQuestionsStore.setState({
    byPaper: { [PAPER]: { items, gist: false, updatedAt: "2026-10-07T00:00:00.000Z" } },
    lastPaperId: PAPER,
  });
}

function render(props: { standing?: readonly string[]; examples?: typeof EXAMPLES } = {}): string {
  return renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, examples: props.examples ?? [], standing: props.standing }));
}

describe("standingGroup — the one group", () => {
  it("is null with none, and labelled in the profile's words with some", () => {
    expect(standingGroup([], [""])).toBeNull();
    expect(standingGroup(undefined, [""])).toBeNull();
    expect(standingGroup(STANDING_Q, [""])).toEqual({
      label: STANDING.chipGroup,
      chips: STANDING_Q.map((text) => ({ label: text, text })),
    });
  });

  it("leaves out a question that is already a line in the box, without regard to case or spacing", () => {
    const group = standingGroup(STANDING_Q, ["  are NEGATIVE findings reported?  ", ""]);
    expect(group?.chips.map((chip) => chip.text)).toEqual([STANDING_Q[0]]);
    expect(standingGroup(STANDING_Q, [STANDING_Q[0], STANDING_Q[1]])).toBeNull();
  });

  it("reads the list defensively: only non-empty text, at most five", () => {
    const messy = ["", "  ", 4 as unknown as string, ...Array.from({ length: 8 }, (_, i) => `Question number ${i}?`)];
    expect(standingGroup(messy, [""])?.chips).toHaveLength(5);
  });

  it("a press is the example tag's action: the chip's text goes to the next empty line", () => {
    const group = standingGroup(STANDING_Q, [""])!;
    expect(fillNextLine([""], group.chips[0].text)).toEqual({ lines: [STANDING_Q[0]], focus: 0 });
    // The wiring: the group's buttons call the same handler as the examples' buttons.
    const source = readFileSync(join(process.cwd(), "src/components/reader/question-field.tsx"), "utf8");
    expect(source.match(/onClick=\{\(\) => onChip\(chip\)\}/g)).toHaveLength(1);
    expect(source).toContain("[...(standingChips ? [standingChips] : []), ...chipGroups(examples)]");
  });
});

describe("QuestionField — with standing questions", () => {
  beforeEach(() => useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null }));

  it("with none, the box is byte-identical to today's (the prop absent, empty, or junk)", () => {
    for (const items of [[], ["Does the anode crack?"]]) {
      if (items.length) withLines(items);
      const today = render({ examples: EXAMPLES });
      expect(render({ examples: EXAMPLES, standing: [] })).toBe(today);
      expect(render({ examples: EXAMPLES, standing: ["", "   "] })).toBe(today);
    }
    expect(render()).not.toContain(STANDING.chipGroup);
  });

  it("shows one labelled group of chips, before the profile's examples, when the box shows chips", () => {
    withLines(["Does the anode crack?"]);
    const html = render({ standing: STANDING_Q, examples: EXAMPLES });
    expect(html.split(STANDING.chipGroup)).toHaveLength(2);
    for (const q of STANDING_Q) expect(html).toContain(`>${q}</button>`);
    expect(html.indexOf(STANDING.chipGroup)).toBeLessThan(html.indexOf(ASK.fromProfile));
    // The label is in the label face, like the other group labels.
    expect(html).toMatch(new RegExp(`<p class="annotation[^"]*">${STANDING.chipGroup}</p>`));
  });

  it("waits, like every chip, for focus or a question; an unfocused empty box shows none", () => {
    const html = render({ standing: STANDING_Q });
    expect(html).not.toContain(STANDING.chipGroup);
    expect(html).not.toContain("<button");
  });

  it("does not offer again a question that is already a line", () => {
    withLines([STANDING_Q[0]]);
    const html = render({ standing: STANDING_Q });
    expect(html).not.toContain(`>${STANDING_Q[0]}</button>`);
    expect(html).toContain(`>${STANDING_Q[1]}</button>`);
  });

  it("drops the group when every standing question is already a line", () => {
    withLines(STANDING_Q);
    expect(render({ standing: STANDING_Q })).not.toContain(STANDING.chipGroup);
  });

  it("with five lines taken the chips are disabled, with no new words", () => {
    withLines(["a one?", "b two?", "c three?", "d four?", "e five?"]);
    const html = render({ standing: STANDING_Q });
    const escaped = STANDING_Q[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const chip = html.match(new RegExp(`<button[^>]*>${escaped}</button>`));
    expect(chip?.[0]).toContain("disabled");
  });
});

describe("the paper page — wiring", () => {
  it("hands the profile's standing questions to the field and to nothing else", () => {
    const page = readFileSync(join(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
    expect(page).toContain("standing={profile.standingQuestions}");
    expect(page.match(/standingQuestions/g)).toHaveLength(1);
  });
});

describe("QuestionField — never filled in", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opening a paper with standing questions leaves the box empty, stores nothing and sends nothing", () => {
    const html = render({ standing: STANDING_Q, examples: EXAMPLES });
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain('value=""');
    for (const q of STANDING_Q) expect(html).not.toContain(`value="${q}"`);
    expect(useReadingQuestionsStore.getState().byPaper).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the field's source never writes a standing question except through a press", () => {
    const source = readFileSync(join(process.cwd(), "src/components/reader/question-field.tsx"), "utf8");
    // Nothing that runs by itself (an effect, a state initialiser, a timer) touches the prop.
    const touching = source.split("\n").filter((line) => /\bstanding\b/.test(line) && /useEffect|useState|useLayoutEffect|setTimeout|commit\(|fillNextLine/.test(line));
    expect(touching).toEqual([]);
  });
});
