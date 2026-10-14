// P2-05 (§1g.6, §3d 12) put the reader's questions in a paper's own reading note as "My questions → what it said".
// P10-09e (rule 1; the owner's 7.3) re-aimed it, §1c: the paper's note is its title line and the stickies, so the
// questions and the report's answers add nothing to it (the answers stand on the paper's page, under each question).
// The tests that pinned the section's entries, their order, their fallbacks and their Markdown are re-aimed to say
// that, and the one that kept Peer's prose out of the note stays as it was. Questions here are synthetic.

import { describe, expect, it } from "vitest";
import type { MarkdownQuestionAnswers } from "@/lib/papers/reading-markdown";
import { toMarkdown } from "./export";
import { readingNote } from "./templates";
import type { Block, Citable, Note } from "./types";

const ROSE: Citable = {
  id: "zenodo:1",
  title: "Applications of Machine Learning",
  authors: ["Dr. R. Reena Rose", "Ms.Sangeetha Ma", "A. Third"],
  venue: "Zenodo",
  publishedDate: "2024-03-01",
  url: "https://zenodo.org/records/1",
  abstract:
    "Machine learning is used across fields. This paper surveys its applications. It closes with open problems.",
};
const NOW = "2026-09-18T00:00:00.000Z";

const QUESTIONS = ["Does the method improve retention?", "Does it discuss recycling?"];

const ANSWERS: MarkdownQuestionAnswers[] = [
  {
    question: QUESTIONS[0],
    verdict: "answered",
    answers: [
      { text: "Peer says retention improved under the tested condition.", evidence: "Retention improved after the treatment.", evidenceWhere: "2 Results", sectionId: "s2", page: 7 },
      { text: "Peer says the gain held at follow-up.", evidence: "The gain held at follow-up.", evidenceWhere: "3 Follow-up", sectionId: "s3", page: 9 },
    ],
    readNext: [{ sectionId: "s2", why: "It reports the measured retention result.", kind: "answer" }],
  },
  {
    question: QUESTIONS[1],
    verdict: "not_addressed",
    answers: [],
    readNext: [{ sectionId: "s1", why: "It explains the comparison baseline.", kind: "background" }],
  },
];

/** A note's blocks without their random ids: what the reader would see. */
function shape(note: Note) {
  return note.blocks.map((b: Block) => ({
    type: b.type,
    text: b.text,
    ...(b.hint ? { hint: b.hint } : {}),
    ...(b.cite ? { cite: b.cite } : {}),
  }));
}

// The note P10-09e makes: the title line, nothing else.
const TITLE_LINE = [{ type: "h1", text: "Applications of Machine Learning" }];

describe("readingNote with the reader's questions (P2-05, re-aimed P10-09e)", () => {
  // Re-aimed (§1c) from "without questions the note is what it was": the note is now the title line, however the extras are given.
  it("without questions the note is the title line — however the extras are given", () => {
    expect(shape(readingNote(ROSE, NOW))).toEqual(TITLE_LINE);
    expect(shape(readingNote(ROSE))).toEqual(TITLE_LINE);
    expect(shape(readingNote(ROSE, {}))).toEqual(TITLE_LINE);
    expect(shape(readingNote(ROSE, { questions: [] }))).toEqual(TITLE_LINE);
    expect(shape(readingNote(ROSE, { questions: [], forYourQuestions: ANSWERS }))).toEqual(TITLE_LINE);
    expect(shape(readingNote(ROSE, { forYourQuestions: ANSWERS }))).toEqual(TITLE_LINE);
    // The note's own fields are unchanged, too.
    const plain = readingNote(ROSE, { now: NOW, forYourQuestions: ANSWERS });
    expect(plain).toMatchObject({ title: ROSE.title, paperId: ROSE.id, createdAt: NOW, updatedAt: NOW });
    expect(Object.keys(plain.sources)).toEqual(["rose2024applications"]);
  });

  it("takes the time as a string (as before) or as `now` inside the extras", () => {
    expect(readingNote(ROSE, NOW)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
    expect(readingNote(ROSE, { now: NOW })).toMatchObject({ createdAt: NOW, updatedAt: NOW });
    expect(readingNote(ROSE, { now: NOW, questions: QUESTIONS, forYourQuestions: ANSWERS })).toMatchObject({
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  // Re-aimed (§1c) from the five tests that pinned "My questions → what it said" (its entries, the questions alone,
  // matching an answer to its question, the 'abstract' fallback, the unverified line) and the Markdown cross-check
  // with the reading export: the section is no longer made, so none of its words reach the note or its Markdown.
  it("makes no 'My questions → what it said' from the questions or the report's answers: no section, verdict, evidence or quote", () => {
    const note = readingNote(ROSE, {
      now: NOW,
      questions: [...QUESTIONS, "  does IT discuss   recycling? "],
      forYourQuestions: ANSWERS,
    });
    expect(shape(note)).toEqual(TITLE_LINE);
    const md = toMarkdown(note);
    for (const word of ["My questions", "Does the method improve retention?", "Answered", "Retention improved", "does not address", ">"]) {
      expect(md).not.toContain(word);
    }
  });

  it("places no word of Peer's prose in the note: not an answer's text, not a Read next reason", () => {
    const note = readingNote(ROSE, { now: NOW, questions: QUESTIONS, forYourQuestions: ANSWERS });
    const text = note.blocks.map((b) => b.text).join("\n");

    for (const entry of ANSWERS) {
      for (const answer of entry.answers) expect(text).not.toContain(answer.text);
      for (const next of entry.readNext) expect(text).not.toContain(next.why);
    }
    expect(text).not.toContain("Read next");
    // Nothing in it is a prompt either.
    expect(note.blocks.some((b) => b.hint)).toBe(false);
  });
});
