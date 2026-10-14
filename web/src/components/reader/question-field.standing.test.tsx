import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P5-01 (brief commit 2): the standing questions as ONE group of the question bar's dropdown (P10-03: it was a
// chip group in the box). Shown only when the profile has some; picking one fills the bar exactly as an example
// does; never filled in on load. Questions below are invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { check, focus, optionTexts, pick, session, type as typeStep, type SessionProps, type Step, type View } from "@/test-support/question-session";
import { ASK, STANDING } from "./copy";
import { QuestionField, standingGroup } from "./question-field";

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

/** P10-21 (X-A6): the first typed character opens the list — one letter is no word to filter by, so every suggestion. */
const firstCharacter: Step = typeStep("g");

/** What the dropdown lists when the bar has focus: its group headings and its items, or null when it is closed. */
async function listed(props: Partial<SessionProps> = {}, script: Step[] = []): Promise<{ headings: string[]; options: string[] } | null> {
  let seen: { headings: string[]; options: string[] } | null = null;
  await session(
    [focus, ...script, check((view: View) => void (seen = view.listbox ? { headings: view.headings, options: optionTexts(view) } : null))],
    { paperId: PAPER, examples: props.examples ?? [], standing: props.standing },
  );
  return seen;
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

  it("leaves out a question that is already the bar's text, without regard to case or spacing", () => {
    const group = standingGroup(STANDING_Q, ["  are NEGATIVE findings reported?  "]);
    expect(group?.chips.map((chip) => chip.text)).toEqual([STANDING_Q[0]]);
    expect(standingGroup([STANDING_Q[0]], [STANDING_Q[0]])).toBeNull();
  });

  it("reads the list defensively: only non-empty text, at most five", () => {
    const messy = ["", "  ", 4 as unknown as string, ...Array.from({ length: 8 }, (_, i) => `Question number ${i}?`)];
    expect(standingGroup(messy, [""])?.chips).toHaveLength(5);
  });

  // P10-03 re-aim of "a press is the example tag's action: the chip's text goes to the next empty line": a pick
  // is the example's action — the question goes into the bar — and the standing group's items are picked by the
  // very handler the examples' are.
  it("a pick is the example's action: the question goes into the bar", async () => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    await session(
      [
        focus,
        firstCharacter,
        pick(0),
        check((view) => {
          expect(view.bar.props.value).toBe(STANDING_Q[0]);
          expect(useReadingQuestionsStore.getState().byPaper[PAPER].items).toEqual([STANDING_Q[0]]);
        }),
      ],
      { paperId: PAPER, examples: EXAMPLES, standing: STANDING_Q },
    );
    // The wiring: standing items and examples are rendered by the one code path.
    const source = readFileSync(join(process.cwd(), "src/components/reader/question-field.tsx"), "utf8");
    expect(source.match(/onClick=\{\(\) => pick\(/g)).toHaveLength(2); // an example (standing or not) and the gist
    expect(source).toContain("[...(standingChips ? [standingChips] : []), ...chipGroups(examples)]");
  });
});

describe("QuestionField — with standing questions", () => {
  beforeEach(() => useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null }));

  it("with none, the box is byte-identical to today's (the prop absent, empty, or junk)", async () => {
    for (const items of [[], ["Does the anode crack?"]]) {
      if (items.length) withLines(items);
      const today = render({ examples: EXAMPLES });
      expect(render({ examples: EXAMPLES, standing: [] })).toBe(today);
      expect(render({ examples: EXAMPLES, standing: ["", "   "] })).toBe(today);
      // …and the dropdown lists the same, with no standing group.
      const open = await listed({ examples: EXAMPLES }, [firstCharacter]);
      expect(await listed({ examples: EXAMPLES, standing: [] }, [firstCharacter])).toEqual(open);
      expect(await listed({ examples: EXAMPLES, standing: ["", "   "] }, [firstCharacter])).toEqual(open);
      expect(open?.headings).not.toContain(STANDING.chipGroup);
    }
    expect(render()).not.toContain(STANDING.chipGroup);
  });

  it("shows one labelled group, before the profile's examples, in the dropdown", async () => {
    const open = await listed({ standing: STANDING_Q, examples: EXAMPLES }, [firstCharacter]);
    expect(open!.headings).toEqual([STANDING.chipGroup, ASK.fromProfile]);
    expect(open!.options).toEqual([...STANDING_Q, "Could I use XRD here?", ASK.chips.gist]);
  });

  it("is in the label face, like the other group labels", async () => {
    let className = "";
    await session(
      [focus, firstCharacter, check((view) => void (className = String(view.all.find((el) => el.props.children === STANDING.chipGroup)?.props.className)))],
      { paperId: PAPER, examples: EXAMPLES, standing: STANDING_Q },
    );
    expect(className).toMatch(/\bannotation\b/);
  });

  // P10-03 re-aim of "waits, like every chip, for focus or a question; an unfocused empty box shows none": the
  // dropdown waits for focus.
  it("waits, like every suggestion, for focus: an unfocused bar lists none", () => {
    const html = render({ standing: STANDING_Q });
    expect(html).not.toContain(STANDING.chipGroup);
    for (const q of STANDING_Q) expect(html).not.toContain(`>${q}<`);
    expect(html.match(/<button/g)).toHaveLength(1); // the Submit control, nothing else
  });

  it("does not offer again a question that is the bar's text", async () => {
    withLines([STANDING_Q[0]]);
    // P10-11 re-aim (BACKLOG-72): the other standing question shares a word with the bar's text ("cohort"); the list
    // follows the typed text now, and "Are negative findings reported?" shares none with it.
    const sharesAWord = "How was the cohort recruited?";
    const open = await listed({ standing: [STANDING_Q[0], sharesAWord] }, [({ bar }) => (bar.props.onChange as (e: unknown) => void)({ target: { value: `${STANDING_Q[0]} ` } })]);
    expect(open!.options).not.toContain(STANDING_Q[0]);
    expect(open!.options).toContain(sharesAWord);
  });

  it("drops the group when its only questions are the bar's text", async () => {
    withLines([STANDING_Q[0]]);
    const open = await listed({ standing: [STANDING_Q[0]] });
    expect(open!.headings).not.toContain(STANDING.chipGroup);
  });

  // Removed with the lines (P10-03): "with five lines taken the chips are disabled, with no new words" — the bar
  // takes a pick at any time, over what is there.
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

  it("opening a paper with standing questions leaves the bar empty, stores nothing and sends nothing", () => {
    const html = render({ standing: STANDING_Q, examples: EXAMPLES });
    // P7-13: the line is a textarea; empty, it has no text between its tags.
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).toContain("></textarea>");
    expect(html).not.toMatch(/<textarea[^>]*>[^<]+<\/textarea>/);
    for (const q of STANDING_Q) expect(html).not.toContain(`>${q}</textarea>`);
    expect(useReadingQuestionsStore.getState().byPaper).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the field's source never writes a standing question except through a pick", () => {
    const source = readFileSync(join(process.cwd(), "src/components/reader/question-field.tsx"), "utf8");
    // Nothing that runs by itself (an effect, a state initialiser, a timer) touches the prop.
    const touching = source.split("\n").filter((line) => /\bstanding\b/.test(line) && /useEffect|useState|useLayoutEffect|setTimeout|commit\(|pick\(/.test(line));
    expect(touching).toEqual([]);
  });
});
