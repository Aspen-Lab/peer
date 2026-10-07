// The shapes a note can start in. Every word placed here is the paper's own
// (its record, its abstract) or a heading; what the reader is meant to write
// is a PROMPT — shown in an empty block, never stored as text, never exported.
// P2-05 adds the reader's own questions and, under each, the verdict and the
// paper's verbatim sentences that answer it — never Peer's answer prose.

import { questionEntryLines, type MarkdownQuestionAnswers } from "@/lib/papers/reading-markdown";
import type { Block, Citable, Note, Source } from "./types";
import { block, newId } from "./blocks";
import { keyFor, sourceOf } from "./cite";

function stamp(now: string) {
  return { id: newId(), createdAt: now, updatedAt: now };
}

function citing(papers: Citable[]): { sources: Record<string, Source>; keys: string[] } {
  const sources: Record<string, Source> = {};
  const keys: string[] = [];
  for (const paper of papers) {
    const key = keyFor(paper, sources);
    sources[key] = sourceOf(paper, key);
    keys.push(key);
  }
  return { sources, keys };
}

/** The opening of an abstract — its first two sentences, in its own words,
 *  with the cut marked. */
export function abstractOpening(abstract?: string, sentences = 2): string | null {
  const clean = abstract?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const parts = clean.match(/[^.!?]+[.!?]+(?=\s|$)/g);
  if (!parts || parts.length <= sentences) {
    return clean.length > 600 ? `${clean.slice(0, 599).trimEnd()} …` : clean;
  }
  return `${parts.slice(0, sentences).join("").trim()} …`;
}

export function blankNote(now = new Date().toISOString()): Note {
  return { ...stamp(now), title: "", blocks: [block("text")], sources: {} };
}

/** What a paper's own notes can start with besides its record (P2-05). */
export interface ReadingNoteExtras {
  /** The reader's settled questions for this paper (never the gist). */
  questions?: readonly string[];
  /** The deep report's answers to them. Used only for the questions asked. */
  forYourQuestions?: readonly MarkdownQuestionAnswers[];
  now?: string;
}

/** A question on one line: trimmed, runs of whitespace collapsed. */
function tidy(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

/** A question as two texts are compared (§1g.12): tidy and case-insensitive. */
function same(question: string): string {
  return tidy(question).toLowerCase();
}

/** "My questions → what it said": per question, the reader's own words, the
 *  verdict, and the paper's sentence behind each answer with where it sits —
 *  the words of the Markdown export. Nothing at all without questions. */
function questionBlocks(
  questions: readonly string[],
  answers: readonly MarkdownQuestionAnswers[],
): Block[] {
  const asked = questions.map(tidy).filter(Boolean);
  if (asked.length === 0) return [];
  const byQuestion = new Map<string, MarkdownQuestionAnswers>();
  for (const entry of answers) if (!byQuestion.has(same(entry.question))) byQuestion.set(same(entry.question), entry);
  const blocks: Block[] = [block("h2", "My questions → what it said")];
  for (const question of asked) {
    blocks.push(block("h3", question));
    const entry = byQuestion.get(same(question));
    if (!entry) continue;
    const lines = questionEntryLines({ ...entry, question });
    blocks.push(block("text", lines.verdict));
    for (const answer of lines.answers) if (answer.quote) blocks.push(block("quote", answer.quote));
  }
  return blocks;
}

/** A paper's own notes: its card, the opening of its abstract, the reader's
 *  questions with what the paper said to each (when there are any), and four
 *  headings to answer under.
 *
 *  The second argument is the time, as a string (how it was first written), or
 *  an object that may carry it as `now` beside the reader's questions. */
export function readingNote(paper: Citable, extras: ReadingNoteExtras | string = {}): Note {
  const options: ReadingNoteExtras = typeof extras === "string" ? { now: extras } : extras;
  const now = options.now ?? new Date().toISOString();
  const { sources, keys } = citing([paper]);
  const opening = abstractOpening(paper.abstract);
  const blocks: Block[] = [
    block("paper", "", { cite: keys[0] }),
    ...(opening ? [block("quote", opening)] : []),
    ...questionBlocks(options.questions ?? [], options.forYourQuestions ?? []),
    block("h2", "What it claims"),
    block("bullet", "", { hint: "The claim, in your own words" }),
    block("h2", "How"),
    block("text", "", { hint: "Method, data, setup — what you would need to repeat it" }),
    block("h2", "What I think"),
    block("text", "", { hint: "Where it is strong or weak for your work" }),
    block("h2", "Questions"),
    block("bullet", "", { hint: "What you would check next" }),
  ];
  return { ...stamp(now), title: paper.title, blocks, sources, paperId: paper.id };
}

function perPaper(keys: string[], hint: string): Block[] {
  return keys.map((key) => block("text", `[@${key}] `, { hint }));
}

/** A related-work section: one paragraph per paper, each opening on its
 *  citation, between the thread that ties them and where yours sits. */
export function relatedWorkDraft(papers: Citable[], now = new Date().toISOString()): Note {
  const { sources, keys } = citing(papers);
  const blocks: Block[] = [
    block("text", "", { hint: "The thread that ties these together, in a sentence or two" }),
    ...perPaper(keys, "what it does, and how your work differs"),
    block("text", "", { hint: "Where your work sits among them" }),
  ];
  return { ...stamp(now), title: "Related work", blocks, sources };
}

/** A paper's skeleton: the sections a paper has, with the chosen papers
 *  already cited under related work. */
export function outlineDraft(papers: Citable[], now = new Date().toISOString()): Note {
  const { sources, keys } = citing(papers);
  const section = (title: string, hint: string): Block[] => [
    block("h2", title),
    block("text", "", { hint }),
  ];
  const blocks: Block[] = [
    ...section("Abstract", "Problem, approach, result, why it matters — four sentences"),
    ...section("1 Introduction", "The problem, why it is still open, what you contribute"),
    block("h2", "2 Related work"),
    ...(keys.length > 0
      ? perPaper(keys, "what it does, and how your work differs")
      : [block("text", "", { hint: "The work yours builds on — type @ to cite a paper" })]),
    ...section("3 Method", "What you did, precisely enough to repeat"),
    ...section("4 Experiments", "Data, baselines, metrics"),
    ...section("5 Results", "What came out, against the baselines"),
    ...section("6 Discussion", "What it means, and where it stops holding"),
    ...section("7 Conclusion", "The contribution, in one paragraph"),
  ];
  return { ...stamp(now), title: "", blocks, sources };
}
