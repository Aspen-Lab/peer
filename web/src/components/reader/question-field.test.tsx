import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { defaultProfile, type Paper } from "@/types";
import { useProfileStore } from "@/store/profile";
import { MAX_QUESTION_CHARS, useReadingQuestionsStore } from "@/store/reading-questions";
import zenodoDocJson from "@/lib/papers/__fixtures__/zenodo-W7208807247.doc.json";
import { ASK, ROUTE } from "./copy";
import { PaperBody } from "./paper-body";
import { QuestionField, chipGroups, nextGist, settleLine, suggestionItems, vagueHintShown } from "./question-field";

// P1-03 (§1f.10): the question field; round P10 (P10-03) made it one bar. This project's Vitest
// has no DOM, so what the field shows is checked by rendering it (react-dom/server), and what a
// key or a click does on the pure functions the field's handlers call
// (`question-field.bar.test.tsx` runs the gestures themselves on a scripted reader).

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

  // P10-03 re-aim of "with no questions, is one quiet line … nothing else": the bar is now always the
  // bordered search bar, with its Submit control (inert) inside it; the label and the bar are all there is.
  it("with no questions, is the label and one empty bar with an inert Submit inside it — nothing listed under it", () => {
    const html = render();

    expect(html).toContain(ASK.heading);
    expect(html).toContain(`placeholder="${ASK.placeholder}"`);
    // P7-13 (R11a): the line is a textarea that grows, no longer an input.
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).not.toContain("<input");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Submit<\/button>/);
    expect(html).not.toContain(ASK.chips.gist);
    // Examples wait for focus and are a dropdown (question-field.bar.test.tsx).
    expect(render(PAPER, EXAMPLES)).not.toContain(ASK.fromProfile);
  });

  // P10-03 re-aim of "with a question, shows its line with a remove control, the hint and the gist control —
  // and no generic chip": there is no remove control, no hint and no gist control under the bar any more.
  it("with a question, shows it whole in the bar and nothing under the bar — no remove control, no hint, no gist, no generic example", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["How does LCO degrade?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render();

    expect(html).toContain(">How does LCO degrade?</textarea>");
    expect(html).not.toContain("×");
    expect(html).not.toContain(ASK.chips.gist);
    for (const chip of GENERIC) expect(html).not.toContain(chip);
    expect(html).not.toContain(ASK.fromEarlier);
    expect(html).not.toContain(ASK.fromProfile);
  });

  // P10-03 re-aim of "offers the example groups only when the page passes some" and "renders both groups in
  // order, each example a button, and the gist control after them": the groups are the dropdown's, drawn
  // only while the bar has focus on an unsettled question — never at rest, whatever the page passes.
  it("draws no example at rest, whatever groups the page passes (they are the dropdown's, open only with focus)", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["How does LCO degrade?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });

    for (const groups of [[], [EXAMPLES[1]], EXAMPLES]) {
      const html = render(PAPER, groups);
      for (const text of [ASK.fromEarlier, ASK.fromProfile, "Why does the anode crack?", "Does this help with dendrite growth?", "Could I use XRD here?", ASK.chips.gist]) {
        expect(html).not.toContain(text);
      }
      expect(html).not.toContain('role="option"');
    }
  });

  // P10-03 re-aim of "shows a chosen gist as a selected chip, not as a line": the chosen gist stands in the bar
  // where the placeholder stood, and is not text in it.
  it("shows a chosen gist in the bar as its placeholder, not as the bar's text", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: [], gist: true, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render();

    expect(html).toContain(`placeholder="${ASK.chips.gist}"`);
    expect(html).not.toMatch(/<textarea[^>]*>Just get the gist<\/textarea>/);
    expect(html).toContain("></textarea>");
  });

  // P7-13 (R11a, §1h.29 Q7): 200 rose to 500, and the counter moved from 160 to 400.
  it("counts characters only past 400", () => {
    const line = "q".repeat(450);
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: [line], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render();

    expect(html).toContain(ASK.counter(450));
    expect(html).not.toContain(ASK.counter(6));
    expect(html).toContain('maxLength="500"');
  });

  it("shows no count at 400 or below, and one from 401", () => {
    const show = (length: number) => {
      useReadingQuestionsStore.setState({
        byPaper: { [PAPER]: { items: ["q".repeat(length)], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
        lastPaperId: PAPER,
      });
      return render();
    };

    // What the old threshold (160) and the old limit (200) would have shown is shown no more.
    expect(show(170)).not.toContain(ASK.counter(170));
    expect(show(300)).not.toContain(ASK.counter(300));
    expect(show(400)).not.toContain(ASK.counter(400));
    expect(show(401)).toContain(ASK.counter(401));
    expect(show(500)).toContain("500/500");
  });
});

// P7-13 (R11a, the owner's R11): the line is a box that grows with its text, so a long
// question is read whole instead of scrolling sideways in an input. jsdom has no layout, so
// "grows" is pinned by what the element is — a `<textarea rows="1">` with the app's own
// limit, whose height `fitHeight` (question-field.grow.test.tsx) sets from its content — and
// "whole" by its content being the whole stored question.
describe("QuestionField — the line is a growing textarea (P7-13, R11a)", () => {
  beforeEach(() => useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null }));
  const tags = (html: string) => html.match(/<textarea[^>]*>/g) ?? [];

  // P10-03 re-aim of "each line is a one-row textarea …": the bar is the one line.
  it("the bar is a one-row textarea carrying the data-ask-line mark, the id and the shared limit", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["First question here?", "Second question here?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const html = render();

    expect(tags(html)).toHaveLength(1);
    const tag = tags(html)[0];
    expect(tag).toContain('rows="1"');
    expect(tag).toContain('data-ask-line=""');
    expect(tag).toContain(`id="ask-${PAPER}-0"`);
    expect(tag).toContain(`maxLength="${MAX_QUESTION_CHARS}"`);
    expect(tag).not.toContain("type=");
    // The bar is not an input, and nothing in the box is one.
    expect(html.match(/<input/g)).toBeNull();
  });

  it("a 300-character question is kept whole by the store and shown whole in its line", () => {
    const question = Array.from({ length: 50 }, (_, i) => `word${String(i).padStart(2, "0")}`).join(" ").slice(0, 300).trim();
    expect(question.length).toBeGreaterThan(290);
    useReadingQuestionsStore.getState().set(PAPER, [question], false, "2026-10-05T00:00:00.000Z");

    expect(useReadingQuestionsStore.getState().byPaper[PAPER].items).toEqual([question]);
    const html = render();
    expect(html).toContain(`>${question}</textarea>`);
    // 300 is under the counter's threshold: the reader sees the text, not a count.
    expect(html).not.toContain(ASK.counter(question.length));
  });

  // P10-03 re-aim of "the placeholder stays on the first line only": there is one bar, and it has the placeholder.
  it("the bar carries the placeholder, and no line is named by number", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: ["First question here?", "Second question here?"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: PAPER,
    });
    const [only] = tags(render());

    expect(only).toContain(`placeholder="${ASK.placeholder}"`);
    expect(only).not.toContain("aria-label=");
  });
});

// P7-13 (R11c, the owner's R11; §1h.29 Q8): a Submit button settles the question. P10 (review 2.6): inside the
// right end of the bar, in the label face, inert (grey) when there is nothing new to send; shown with no key
// too — it settles the ledger.
describe("QuestionField — the Submit button (P7-13, R11c)", () => {
  const AT = "2026-10-05T00:00:00.000Z";
  const button = (html: string) => /<button[^>]*>Submit<\/button>/.exec(html)?.[0];
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    useProfileStore.setState({ profile: { ...defaultProfile } });
  });

  // P10-03 re-aim of "is not in the quiet box: no question, nothing focused": the bar always has its control.
  it("is in the bar even when it is empty, inert", () => {
    expect(button(render())).toContain('disabled=""');
  });

  // P10-03 re-aim of "shows under the lines of a question, before the hint and the chips": it is inside the
  // bar, at its right end, and there is no hint or example under it.
  it("is inside the bar, after the textarea, in the label face", () => {
    useReadingQuestionsStore.getState().set(PAPER, ["How does LCO degrade?"], false, AT);
    const html = render();

    expect(button(html)).toBeDefined();
    expect(html).toMatch(/<\/textarea><button[^>]*>Submit<\/button><\/div>/);
    expect(button(html)).toMatch(/class="[^"]*\bannotation\b/);
    expect(button(html)).toContain('type="button"');
    expect(html).not.toContain(ASK.chips.gist);
  });

  // P10-03 re-aim of "is full width on a phone and right-aligned from the sm breakpoint": the control no longer
  // spans a row; it is the bar's right end at every width.
  it("does not span a row of its own: it is a shrink-0 pill at the bar's right end", () => {
    useReadingQuestionsStore.getState().set(PAPER, ["How does LCO degrade?"], false, AT);
    const html = render();

    expect(button(html)).toMatch(/\bshrink-0\b/);
    expect(button(html)).not.toMatch(/\bw-full\b/);
    expect(html).not.toMatch(/\bsm:justify-end\b/);
  });

  // P7-18 (F6, §1h.39 e): 26 px tall on a phone, beside Notes at 44 and the page's other commands
  // (`[@media(hover:none)]:min-h-11`, the touch-target class reader-commands and reader-tabs carry).
  it("is a 44-px target on touch, as the page's other controls are", () => {
    useReadingQuestionsStore.getState().set(PAPER, ["How does LCO degrade?"], false, AT);

    expect(button(render())).toMatch(/class="[^"]*\[@media\(hover:none\)\]:min-h-11(?:\s|")/);
  });

  it("is enabled while the typed question is not the settled one", () => {
    useReadingQuestionsStore.getState().set(PAPER, ["How does LCO degrade?"], false, AT);

    expect(button(render())).not.toContain('disabled=""');
  });

  it("is disabled when the cleaned item equals the settled set", () => {
    useReadingQuestionsStore.getState().set(PAPER, ["How does LCO degrade?"], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);

    expect(button(render())).toContain('disabled=""');
  });

  it("shows with no key: it settles the ledger, which needs none", () => {
    useReadingQuestionsStore.getState().set(PAPER, ["How does LCO degrade?"], false, AT);
    const profile = useProfileStore.getState().profile;
    expect(profile.feedAiApiKey ?? "").toBe("");

    expect(button(render())).toBeDefined();
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

  it("shows the hint when the route is vague, under the bar", () => {
    const html = renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, examples: [], vague: true }));

    expect(ROUTE.vague).toBe("Ask something more specific and Peer can point you to the right sections.");
    expect(html).toContain(ROUTE.vague);
    expect(html.indexOf(ROUTE.vague)).toBeGreaterThan(html.indexOf("</textarea>"));
    expect(html.indexOf(ROUTE.vague)).toBeGreaterThan(html.indexOf(">Submit</button>"));
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
  // P10-03 re-aim of "shows the chips while the field has focus, holds a question, or the gist is chosen",
  // `showChips`: the dropdown rule is `dropdownOpen` (question-field.bar.test.tsx pins it).
  // P10-03 re-aim of "adds a line on Enter …", "removes a line …" and "fills the next empty line with a chip …"
  // (`addLineAfter`, `removeLine`, `fillNextLine`): there are no lines to add, remove or fill; the bar's
  // handlers are pinned on the scripted reader.

  it("offers none of the three generic blueprint examples: every example is the reader's own (P1-09, §1a.7)", () => {
    const chips = chipGroups(EXAMPLES).flatMap((group) => group.chips.map((chip) => chip.label));
    expect(chips).toEqual(["Why does the anode crack?", "Does this help with dendrite growth?", "Could I use XRD here?"]);
    for (const chip of GENERIC) expect(chips).not.toContain(chip);
    expect(JSON.stringify(ASK)).not.toMatch(/Can I use this method|Do the conclusions hold up|How does this differ from/);
  });

  it("'Just get the gist' is the dropdown's own last item, not an example, and typing any question turns it off", () => {
    expect(chipGroups(EXAMPLES).flatMap((group) => group.chips).some((chip) => chip.label === ASK.chips.gist)).toBe(false);
    expect(suggestionItems(chipGroups(EXAMPLES)).at(-1)).toEqual({ kind: "gist", text: ASK.chips.gist });
    expect(nextGist(true, [""])).toBe(true);
    expect(nextGist(true, ["A question"])).toBe(false);
    expect(nextGist(false, [""])).toBe(false);
  });

  it("keeps the page's groups in order, each example a pick, and leaves out an empty group", () => {
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
