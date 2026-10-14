// The shapes a note can start in. Every word placed here is the paper's own
// (its record, its abstract) or a heading; what the reader is meant to write
// is a PROMPT — shown in an empty block, never stored as text, never exported.
// P2-05 added the reader's own questions and, under each, the verdict and the
// paper's verbatim sentences that answer it; P10-09e moved those answers to the
// paper's own page, under the question, and made the paper's reading note the title
// line and what the reader and the sticky notes add — see `readingNote`.

import type { MarkdownQuestionAnswers } from "@/lib/papers/reading-markdown";
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

/** What a paper's own notes were once offered besides its record (P2-05). */
export interface ReadingNoteExtras {
  /** @deprecated P10-09e: not read — the answers stand on the paper's page. Kept so the callers still compile. */
  questions?: readonly string[];
  /** @deprecated P10-09e: not read. */
  forYourQuestions?: readonly MarkdownQuestionAnswers[];
  now?: string;
}

/** A paper's own notes (P10-09e, B13 / B14): the title line, and nothing after it. The sticky notes append under it
 *  as the reader makes them, and the reader writes where they like — Peer places no abstract, no quote, no prompt and
 *  no empty section in it, and (the answers now stand on the paper's page, under each question) no "My questions →
 *  what it said". The paper stays in `sources` under its citation key, so `[@key]` still cites it.
 *
 *  A note made before this (the old template) is left as it is. The second argument is the time, as a string (how it
 *  was first written), or an object that may carry it as `now`; the questions in it are no longer read. */
export function readingNote(paper: Citable, extras: ReadingNoteExtras | string = {}): Note {
  const options: ReadingNoteExtras = typeof extras === "string" ? { now: extras } : extras;
  const now = options.now ?? new Date().toISOString();
  const { sources } = citing([paper]);
  const blocks: Block[] = [block("h1", paper.title)];
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
