// P2-05 (§1g.6, §3d 12): the reader's questions in a paper's own reading note.
// "My questions → what it said" appears only when the reader has questions;
// without them the note is what it was. Every word Peer places in a note is
// the paper's own (a verbatim quote with its attribution), the reader's own
// question, or a label — never Peer's answer prose. Questions here are synthetic.

import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { buildReading, describeAvailability } from "@/lib/papers/reading";
import type { ReadingMap } from "@/lib/papers/reading-map";
import { readingToMarkdown, type MarkdownQuestionAnswers } from "@/lib/papers/reading-markdown";
import normalPaperJson from "@/lib/papers/__fixtures__/abstract-normal-W7204479535.paper.json";
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

// The note as it stood before P2-05, pinned.
const TODAY = [
  { type: "paper", text: "", cite: "rose2024applications" },
  { type: "quote", text: "Machine learning is used across fields. This paper surveys its applications. …" },
  { type: "h2", text: "What it claims" },
  { type: "bullet", text: "", hint: "The claim, in your own words" },
  { type: "h2", text: "How" },
  { type: "text", text: "", hint: "Method, data, setup — what you would need to repeat it" },
  { type: "h2", text: "What I think" },
  { type: "text", text: "", hint: "Where it is strong or weak for your work" },
  { type: "h2", text: "Questions" },
  { type: "bullet", text: "", hint: "What you would check next" },
];

describe("readingNote with the reader's questions (P2-05)", () => {
  it("without questions the note is what it was — however the extras are given", () => {
    expect(shape(readingNote(ROSE, NOW))).toEqual(TODAY);
    expect(shape(readingNote(ROSE))).toEqual(TODAY);
    expect(shape(readingNote(ROSE, {}))).toEqual(TODAY);
    expect(shape(readingNote(ROSE, { questions: [] }))).toEqual(TODAY);
    // An answer set with no questions asked adds nothing: the section is the reader's.
    expect(shape(readingNote(ROSE, { questions: [], forYourQuestions: ANSWERS }))).toEqual(TODAY);
    expect(shape(readingNote(ROSE, { forYourQuestions: ANSWERS }))).toEqual(TODAY);
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

  it("adds My questions → what it said after the abstract opening, one entry per question: the verdict and the quoted evidence per answer", () => {
    const note = readingNote(ROSE, { now: NOW, questions: QUESTIONS, forYourQuestions: ANSWERS });

    expect(shape(note)).toEqual([
      TODAY[0],
      TODAY[1],
      { type: "h2", text: "My questions → what it said" },
      { type: "h3", text: "Does the method improve retention?" },
      { type: "text", text: "Answered" },
      { type: "quote", text: "Retention improved after the treatment. — §2 Results · p.7" },
      { type: "quote", text: "The gain held at follow-up. — §3 Follow-up · p.9" },
      { type: "h3", text: "Does it discuss recycling?" },
      { type: "text", text: "This paper does not address: Does it discuss recycling?" },
      ...TODAY.slice(2),
    ]);
  });

  it("places no word of Peer's prose in the note: not an answer's text, not a Read next reason", () => {
    const note = readingNote(ROSE, { now: NOW, questions: QUESTIONS, forYourQuestions: ANSWERS });
    const text = note.blocks.map((b) => b.text).join("\n");

    for (const entry of ANSWERS) {
      for (const answer of entry.answers) expect(text).not.toContain(answer.text);
      for (const next of entry.readNext) expect(text).not.toContain(next.why);
    }
    expect(text).not.toContain("Read next");
    // The prompts are still prompts: empty text with a hint.
    for (const b of note.blocks.filter((x) => x.hint)) expect(b.text).toBe("");
  });

  it("lists the questions alone when no report has come back: the entry is the question, nothing under it", () => {
    const note = readingNote(ROSE, { now: NOW, questions: QUESTIONS });

    expect(shape(note)).toEqual([
      TODAY[0],
      TODAY[1],
      { type: "h2", text: "My questions → what it said" },
      { type: "h3", text: "Does the method improve retention?" },
      { type: "h3", text: "Does it discuss recycling?" },
      ...TODAY.slice(2),
    ]);
  });

  it("follows the reader's questions: an answer finds its question by its text (case and spacing aside); an answer for a question no longer asked is left out", () => {
    const note = readingNote(ROSE, {
      now: NOW,
      questions: ["  does IT discuss   recycling? ", "Is it cheap?"],
      forYourQuestions: ANSWERS,
    });

    expect(shape(note).slice(2, 6)).toEqual([
      { type: "h2", text: "My questions → what it said" },
      // The reader's own words head the entry, as they typed them…
      { type: "h3", text: "does IT discuss recycling?" },
      // …and the sentence reads the same question.
      { type: "text", text: "This paper does not address: does IT discuss recycling?" },
      // No answer for a question that was not asked of the report.
      { type: "h3", text: "Is it cheap?" },
    ]);
    expect(note.blocks.map((b) => b.text).join("\n")).not.toContain("Retention improved");
  });

  it("falls back to 'abstract' with no section named, and leaves the page off when it is not known", () => {
    const note = readingNote(ROSE, {
      now: NOW,
      questions: ["Is it cheap?"],
      forYourQuestions: [
        {
          question: "Is it cheap?",
          verdict: "partly",
          answers: [
            { text: "Peer says it is.", evidence: "It is cheap." },
            { text: "Peer says so too.", evidence: "It is cheap in bulk.", evidenceWhere: "RESULTS AND DISCUSSION" },
          ],
          readNext: [],
        },
      ],
    });

    expect(shape(note).slice(2, 7)).toEqual([
      { type: "h2", text: "My questions → what it said" },
      { type: "h3", text: "Is it cheap?" },
      { type: "text", text: "Partly answered" },
      { type: "quote", text: "It is cheap. — abstract" },
      { type: "quote", text: "It is cheap in bulk. — §Results and Discussion" },
    ]);
  });

  // P2-08b (§1g.21 (2)): the note says what the page and the export say for an
  // entry whose answers all failed verification — through the same
  // `questionEntryLines` — with no quote under it and never "does not address".
  it("prints the unverified line, with no quote under it, the same words as the page and the export (P2-08b)", () => {
    const note = readingNote(ROSE, {
      now: NOW,
      questions: [QUESTIONS[0]],
      forYourQuestions: [{ question: QUESTIONS[0], verdict: "unverified", answers: [], readNext: [{ sectionId: "s2", why: "It reports the result.", kind: "answer" }] }],
    });

    expect(shape(note).slice(2, 5)).toEqual([
      { type: "h2", text: "My questions → what it said" },
      { type: "h3", text: "Does the method improve retention?" },
      { type: "text", text: "Peer could not verify an answer in the paper's own words." },
    ]);
    const text = note.blocks.map((b) => b.text).join("\n");
    expect(text).not.toContain("does not address");
    expect(text).not.toContain("It reports the result.");
    // The abstract's opening is the note's only quote: no answer sits under the verdict.
    expect(note.blocks.filter((b) => b.type === "quote")).toHaveLength(1);
  });

  it("exports as Markdown the way the reading export says it: the same verdict lines and the same quoted evidence", () => {
    const note = readingNote(ROSE, { now: NOW, questions: QUESTIONS, forYourQuestions: ANSWERS });
    const exported = toMarkdown(note);

    expect(exported).toContain("## My questions → what it said");
    expect(exported).toContain("### Does the method improve retention?");
    expect(exported).toContain("> Retention improved after the treatment. — §2 Results · p.7");

    // Cross-check with the reading export for the same answers.
    const paper = normalPaperJson as unknown as Paper;
    const map: ReadingMap = {
      sections: [
        { id: "s1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 2, words: 260, minutes: 2, paragraphs: [] },
        { id: "s2", heading: "2 Results", canonical: "results", role: "evidence", page: 7, words: 460, minutes: 3, paragraphs: [] },
        { id: "s3", heading: "3 Follow-up", canonical: "body", role: "body", page: 9, words: 520, minutes: 4, paragraphs: [] },
      ],
      totalMinutes: 9,
    };
    const reading = { ...buildReading(paper, null, new Date(NOW)), map };
    const sentences = describeAvailability({ reading, report: null, providerConfigured: true, profileHasProject: false, modelFailed: false });
    const reportMd = readingToMarkdown(paper, reading, { forYourQuestions: ANSWERS }, sentences, new Date(NOW), QUESTIONS);
    const quotes = note.blocks.filter((b) => b.type === "quote").slice(1);
    expect(quotes).toHaveLength(2);
    for (const quote of quotes) expect(reportMd).toContain(`> ${quote.text}`);
    for (const line of ["Answered", "This paper does not address: Does it discuss recycling?"]) {
      expect(note.blocks.some((b) => b.type === "text" && b.text === line)).toBe(true);
      expect(reportMd.split("\n")).toContain(line);
    }
  });
});
