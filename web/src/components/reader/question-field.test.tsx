import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { Paper } from "@/types";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import zenodoDocJson from "@/lib/papers/__fixtures__/zenodo-W7208807247.doc.json";
import { ASK, ROUTE } from "./copy";
import { PaperBody } from "./paper-body";
import {
  QuestionField,
  addLineAfter,
  chipGroups,
  fillNextLine,
  nextGist,
  removeLine,
  settleLine,
  showChips,
  vagueHintShown,
} from "./question-field";

// P1-03 (§1f.10): the question field. This project's Vitest has no DOM, so
// what the field shows is checked by rendering it (react-dom/server), and
// what a key or a click does is checked on the pure functions the field's
// handlers call.

const PAPER = "openalex:W1";

/** P1-09 (§1f.20): the example groups the page builds (`exampleQuestions`). */
const EXAMPLES = [
  { label: ASK.fromEarlier, items: ["Why does the anode crack?"] },
  { label: ASK.fromProfile, items: ["Does this help with dendrite growth?", "Could I use XRD here?"] },
];
/** The three generic blueprint chips P1-09 removed (§1a.7). */
const GENERIC = ["Can I use this method in my own work?", "Do the conclusions hold up?", "How does this differ from X?"];

function render(paperId = PAPER, examples: typeof EXAMPLES = []): string {
  return renderToStaticMarkup(createElement(QuestionField, { paperId, examples }));
}

describe("QuestionField — what it shows", () => {
  beforeEach(() => useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null }));

  it("with no questions, is one quiet line: the label and an empty input, nothing else", () => {
    const html = render();

    expect(html).toContain(ASK.heading);
    expect(html).toContain(`placeholder="${ASK.placeholder}"`);
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).not.toContain("<button");
    expect(html).not.toContain(ASK.hint);
    expect(html).not.toContain(ASK.chips.gist);
    // Examples wait for focus or a question, like every chip.
    expect(render(PAPER, EXAMPLES)).not.toContain(ASK.fromProfile);
  });

  it("with a question, shows its line with a remove control, the hint and the gist control — and no generic chip", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["How does LCO degrade?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render();

    expect(html).toContain('value="How does LCO degrade?"');
    expect(html).toContain(`aria-label="${ASK.remove(1)}"`);
    expect(html).toContain(ASK.hint);
    expect(html).toContain(ASK.chips.gist);
    for (const chip of GENERIC) expect(html).not.toContain(chip);
    // No examples from the page: no group heading.
    expect(html).not.toContain(ASK.fromEarlier);
    expect(html).not.toContain(ASK.fromProfile);
  });

  it("offers the example groups only when the page passes some (P1-09)", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["How does LCO degrade?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });

    expect(render(PAPER, [])).not.toContain(ASK.fromProfile);
    const html = render(PAPER, [EXAMPLES[1]]);
    expect(html).toContain(ASK.fromProfile);
    expect(html).toContain(">Does this help with dendrite growth?<");
    expect(html).not.toContain(ASK.fromEarlier);
  });

  it("renders both groups in order, each example a button, and the gist control after them (P1-09)", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["How does LCO degrade?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render(PAPER, EXAMPLES);

    const order = [ASK.fromEarlier, "Why does the anode crack?", ASK.fromProfile, "Does this help with dendrite growth?", "Could I use XRD here?", ASK.chips.gist].map((text) => html.indexOf(text));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/<button type="button"[^>]*>Why does the anode crack\?<\/button>/);
    for (const chip of GENERIC) expect(html).not.toContain(chip);
  });

  it("shows a chosen gist as a selected chip, not as a line", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: [], gist: true, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render();

    expect(html).toMatch(/aria-pressed="true"[^>]*>Just get the gist</);
    expect(html).not.toContain('value="Just get the gist"');
  });

  it("counts characters only past 160", () => {
    const line = "q".repeat(170);
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["Short.", line], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render();

    expect(html).toContain(ASK.counter(170));
    expect(html).not.toContain(ASK.counter(6));
    expect(html).toContain('maxLength="200"');
  });
});

// P1-05 (§1f.6, §1f.13; blueprint §3.3): a route too vague to point
// anywhere says so under the questions, and nothing is tinted (the page
// passes `vague` from the route it computed).
describe("QuestionField — the vague hint (P1-05)", () => {
  beforeEach(() =>
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["What is it?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    }),
  );

  it("shows the hint when the route is vague, under the question lines", () => {
    const html = renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, examples: [], vague: true }));

    expect(ROUTE.vague).toBe("Ask something more specific and Peer can point you to the right sections.");
    expect(html).toContain(ROUTE.vague);
    expect(html.indexOf(ROUTE.vague)).toBeGreaterThan(html.lastIndexOf("<input"));
    expect(html.indexOf(ROUTE.vague)).toBeLessThan(html.indexOf(ASK.chips.gist));
  });

  it("shows no hint for a route that points somewhere, or with no route", () => {
    expect(renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, examples: [], vague: false }))).not.toContain(ROUTE.vague);
    expect(render()).not.toContain(ROUTE.vague);
  });
});

// P1-07 (§1f.18 a; A's O2): the hint is for a settled question, never for
// the line being typed — a line settles on Enter or blur. The store still
// takes every keystroke (the tints follow it live).
describe("QuestionField — the hint waits for a settled line (P1-07)", () => {
  const VAGUE_TYPING = ["Does tungsten"];

  it("a focused line with one specific term shows no hint", () => {
    const typing = settleLine(null, { type: "focus", index: 0 });
    expect(typing).toBe(0);
    expect(vagueHintShown({ vague: true, lines: VAGUE_TYPING, unsettled: settleLine(typing, { type: "change", index: 0 }) })).toBe(false);
  });

  it("the same line shows it once it settles: on blur, or on Enter", () => {
    expect(vagueHintShown({ vague: true, lines: VAGUE_TYPING, unsettled: settleLine(0, { type: "blur", index: 0 }) })).toBe(true);
    expect(vagueHintShown({ vague: true, lines: VAGUE_TYPING, unsettled: settleLine(0, { type: "enter", index: 0 }) })).toBe(true);
    // Typing again unsettles it.
    expect(vagueHintShown({ vague: true, lines: VAGUE_TYPING, unsettled: settleLine(null, { type: "change", index: 0 }) })).toBe(false);
  });

  it("another settled vague line keeps the hint while a new line is typed; a route that points somewhere never shows it", () => {
    const lines = ["What is it?", "Does tung"];
    expect(vagueHintShown({ vague: true, lines, unsettled: 1 })).toBe(true);
    expect(vagueHintShown({ vague: false, lines, unsettled: null })).toBe(false);
    // Blurring a line other than the one being typed changes nothing.
    expect(settleLine(1, { type: "blur", index: 0 })).toBe(1);
    // Nothing written at all: no hint.
    expect(vagueHintShown({ vague: true, lines: [""], unsettled: null })).toBe(false);
  });

  it("a stored vague question shows the hint on mount, with nothing focused", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["What is it?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, examples: [], vague: true }));

    expect(html).toContain(ROUTE.vague);
  });
});

describe("QuestionField — what the handlers do", () => {
  it("shows the chips while the field has focus, holds a question, or the gist is chosen", () => {
    expect(showChips({ focused: false, lines: [""], gist: false })).toBe(false);
    expect(showChips({ focused: true, lines: [""], gist: false })).toBe(true);
    expect(showChips({ focused: false, lines: ["A question"], gist: false })).toBe(true);
    expect(showChips({ focused: false, lines: [""], gist: true })).toBe(true);
  });

  it("adds a line on Enter after a written line, up to five, and moves to an empty one that exists", () => {
    expect(addLineAfter(["First"], 0)).toEqual({ lines: ["First", ""], focus: 1 });
    expect(addLineAfter(["First", "", "Third"], 0)).toEqual({ lines: ["First", "", "Third"], focus: 1 });
    expect(addLineAfter([""], 0)).toEqual({ lines: [""], focus: 0 });
    expect(addLineAfter(["1", "2", "3", "4", "5"], 4)).toEqual({ lines: ["1", "2", "3", "4", "5"], focus: 4 });
  });

  it("removes a line, and leaves one empty line when the last goes", () => {
    expect(removeLine(["A", "B", "C"], 1)).toEqual(["A", "C"]);
    expect(removeLine(["A"], 0)).toEqual([""]);
  });

  it("fills the next empty line with a chip, never more than five, and never by itself", () => {
    const example = "Does this help with dendrite growth?";
    expect(fillNextLine([""], example)).toEqual({ lines: [example], focus: 0 });
    expect(fillNextLine(["A", ""], example)).toEqual({ lines: ["A", example], focus: 1 });
    expect(fillNextLine(["A"], example)).toEqual({ lines: ["A", example], focus: 1 });
    expect(fillNextLine(["1", "2", "3", "4", "5"], "Six")).toEqual({ lines: ["1", "2", "3", "4", "5"], focus: -1 });
  });

  it("offers none of the three generic blueprint chips: every example is the reader's own (P1-09, §1a.7)", () => {
    const chips = chipGroups(EXAMPLES).flatMap((group) => group.chips.map((chip) => chip.label));
    expect(chips).toEqual(["Why does the anode crack?", "Does this help with dendrite growth?", "Could I use XRD here?"]);
    for (const chip of GENERIC) expect(chips).not.toContain(chip);
    expect(JSON.stringify(ASK)).not.toMatch(/Can I use this method|Do the conclusions hold up|How does this differ from/);
  });

  it("'Just get the gist' is a toggle of its own, not an example, and typing any question turns it off", () => {
    expect(chipGroups(EXAMPLES).flatMap((group) => group.chips).some((chip) => chip.label === ASK.chips.gist)).toBe(false);
    expect(nextGist(true, [""])).toBe(true);
    expect(nextGist(true, ["A question"])).toBe(false);
    expect(nextGist(false, [""])).toBe(false);
  });

  it("keeps the page's groups in order, each example a fill chip, and leaves out an empty group", () => {
    expect(chipGroups(EXAMPLES).map((group) => group.label)).toEqual([ASK.fromEarlier, ASK.fromProfile]);
    expect(chipGroups([{ label: ASK.fromEarlier, items: [] }, EXAMPLES[1]]).map((group) => group.label)).toEqual([ASK.fromProfile]);
    expect(chipGroups([])).toEqual([]);
    expect(chipGroups(EXAMPLES)[0].chips[0]).toEqual({ label: "Why does the anode crack?", text: "Why does the anode crack?" });
  });
});

describe("with no questions, the reading and the body are unchanged (§1f.10, §3d 6)", () => {
  const paper: Paper = {
    id: "openalex:W7208807247",
    title: "Graph Embeddings for Protein Structure Prediction",
    authors: [],
    relevanceReason: "",
    venue: "",
    source: "other",
    summaryIntro: "",
    summaryExperimentKeywords: [],
    summaryResultDiscussion: "",
    isSaved: false,
  };
  const doc = zenodoDocJson as unknown as ExtractedDocument;
  const NOW = new Date("2026-10-05T00:00:00.000Z");
  const fullText = { status: "ok" as const, doc, sourceLink: { url: "https://zenodo.org/x.pdf", kind: "pdf" as const, label: "zenodo" as const, rank: 1 }, attempts: [] };

  it("builds the same reading and renders the same body whatever the questions store holds", () => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    const before = buildReading(paper, fullText, NOW);
    const bodyBefore = renderToStaticMarkup(createElement(PaperBody, { reading: before }));

    useReadingQuestionsStore.setState({
      byPaper: { [paper.id]: { items: ["graph embeddings protein structure"], gist: true, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: paper.id,
    });
    const after = buildReading(paper, fullText, NOW);
    const bodyAfter = renderToStaticMarkup(createElement(PaperBody, { reading: after }));

    expect(after).toEqual(before);
    expect(bodyAfter).toBe(bodyBefore);
    expect(bodyBefore.length).toBeGreaterThan(1000);
  });
});
