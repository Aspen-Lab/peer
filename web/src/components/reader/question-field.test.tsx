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
const OTHER = "openalex:W2";

function render(paperId = PAPER, challenges: string[] = []): string {
  return renderToStaticMarkup(createElement(QuestionField, { paperId, challenges }));
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
    expect(html).not.toContain(ASK.groups.common);
  });

  it("with a question, shows its line with a remove control, the hint and the common chips in order", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["How does LCO degrade?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render();

    expect(html).toContain('value="How does LCO degrade?"');
    expect(html).toContain(`aria-label="${ASK.remove(1)}"`);
    expect(html).toContain(ASK.hint);
    const order = [ASK.chips.method, ASK.chips.conclusions, ASK.chips.differ, ASK.chips.gist].map((chip) => html.indexOf(chip));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // No previous paper and no challenges: those groups are absent.
    expect(html).not.toContain(ASK.groups.last);
    expect(html).not.toContain(ASK.groups.challenges);
  });

  it("offers the challenge chips only when the page passes some", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["How does LCO degrade?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });

    expect(render(PAPER, [])).not.toContain(ASK.groups.challenges);
    const html = render(PAPER, ["dendrite growth in lithium metal anodes"]);
    expect(html).toContain(ASK.groups.challenges);
    expect(html).toContain("dendrite growth in lithium metal anodes");
  });

  it("offers the last paper's questions only when the last paper is another one", () => {
    useReadingQuestionsStore.setState({
      byPaper: {
        [OTHER]: { items: ["Why does the anode crack?"], gist: false, updatedAt: "2026-10-04T00:00:00.000Z" },
        [PAPER]: { items: ["How does LCO degrade?"], gist: false, updatedAt: "2026-10-03T00:00:00.000Z" },
      },
      lastPaperId: OTHER,
    });
    const html = render(PAPER);
    expect(html).toContain(ASK.groups.last);
    expect(html).toContain("Why does the anode crack?");
    expect(html.indexOf(ASK.groups.last)).toBeLessThan(html.indexOf(ASK.groups.common));

    useReadingQuestionsStore.setState({ lastPaperId: PAPER });
    expect(render(PAPER)).not.toContain(ASK.groups.last);
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
    const html = renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, challenges: [], vague: true }));

    expect(ROUTE.vague).toBe("Ask something more specific and Peer can point you to the right sections.");
    expect(html).toContain(ROUTE.vague);
    expect(html.indexOf(ROUTE.vague)).toBeGreaterThan(html.lastIndexOf("<input"));
    expect(html.indexOf(ROUTE.vague)).toBeLessThan(html.indexOf(ASK.groups.common));
  });

  it("shows no hint for a route that points somewhere, or with no route", () => {
    expect(renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, challenges: [], vague: false }))).not.toContain(ROUTE.vague);
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
    const html = renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, challenges: [], vague: true }));

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
    expect(fillNextLine([""], ASK.chips.method)).toEqual({ lines: [ASK.chips.method], focus: 0 });
    expect(fillNextLine(["A", ""], ASK.chips.method)).toEqual({ lines: ["A", ASK.chips.method], focus: 1 });
    expect(fillNextLine(["A"], ASK.chips.method)).toEqual({ lines: ["A", ASK.chips.method], focus: 1 });
    expect(fillNextLine(["1", "2", "3", "4", "5"], "Six")).toEqual({ lines: ["1", "2", "3", "4", "5"], focus: -1 });
  });

  it("fills only the start of 'How does this differ from X?', for the reader to finish", () => {
    const groups = chipGroups({ paperId: PAPER, byPaper: {}, previousPaperId: null, challenges: [] });
    const differ = groups.flatMap((g) => g.chips).find((chip) => chip.label === ASK.chips.differ);

    expect(differ).toEqual({ label: ASK.chips.differ, kind: "prefix", text: "How does this differ from " });
    expect(fillNextLine([""], differ!.text).lines).toEqual(["How does this differ from "]);
  });

  it("'Just get the gist' is a toggle, and typing any question turns it off", () => {
    const groups = chipGroups({ paperId: PAPER, byPaper: {}, previousPaperId: null, challenges: [] });
    expect(groups.flatMap((g) => g.chips).find((chip) => chip.label === ASK.chips.gist)?.kind).toBe("gist");
    expect(nextGist(true, [""])).toBe(true);
    expect(nextGist(true, ["A question"])).toBe(false);
    expect(nextGist(false, [""])).toBe(false);
  });

  it("orders the chip groups: last paper, common, challenges — and leaves out an empty one", () => {
    const byPaper = { [OTHER]: { items: ["Why does the anode crack?"], gist: false, updatedAt: "2026-10-04T00:00:00.000Z" } };

    expect(chipGroups({ paperId: PAPER, byPaper, previousPaperId: OTHER, challenges: ["dendrite growth"] }).map((g) => g.label))
      .toEqual([ASK.groups.last, ASK.groups.common, ASK.groups.challenges]);
    expect(chipGroups({ paperId: PAPER, byPaper, previousPaperId: null, challenges: [] }).map((g) => g.label))
      .toEqual([ASK.groups.common]);
    expect(chipGroups({ paperId: PAPER, byPaper, previousPaperId: PAPER, challenges: [] }).map((g) => g.label))
      .toEqual([ASK.groups.common]);
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
