// Two-pass deep report generator.
//
// Pass 1 (the selected provider's economical model):
//   COMPRESS — read the long paper body, return tightly-relevant sentences
//   (novelty claims, key results, method highlights, comparisons to prior
//   work). This trims a 30k-token paper into ~1.5k tokens of signal.
//
// Pass 2 (the selected provider's stronger model):
//   EXTRACT — using the compressed signal + abstract + metadata, produce
//   the structured PaperReport: every claim with one sentence copied
//   character-for-character from the supplied text.
//
// Then verification: every claim's evidence sentence is looked up in the
// abstract and the extracted sections; a claim whose sentence is not there
// is dropped and counted (`evidence.ts`). Nothing unverified leaves here.
//
// For short papers (< ~10k chars body), Pass 1 is skipped and the raw text
// is sent directly to Pass 2 to save the extra round-trip.
//
// P2-01 (rulings §1g.1, §1g.2, §1g.4):
// - Pass 1 reads the paper by section (`[{ id, heading, text }]`) and answers
//   by section (`{ text, sectionId }`). It stays question-free, so its answer
//   is a function of the document and is kept in memory by the document's
//   hash for an hour.
// - Pass 1q, only when the reader asked something: the questions and the
//   sections the Tier 0 route marks for them → up to eight verbatim sentences
//   per question, each checked against the document. Kept by the document
//   and the (sorted) questions for an hour.
// - Every prompt is clipped in its body, never in its schema: the body is
//   cut to fit before the schema, the rules and the questions are appended.

import { createHash } from "node:crypto";
import type { Paper } from "@/types";
import { reportModelTier } from "@/lib/llm/provider-models";
import type { DigestProvider } from "@/lib/llm/providers/types";
import {
  emptyReport,
  sanitizePaperReport,
  type PaperReport,
  type PaperReportDepth,
  reviewPaperLabel,
} from "./report";
import { locateSection, sectionCorpus, verifyReportEvidence, type SectionCorpusEntry } from "./evidence";
import type { ExtractedDocument } from "./html-text";
import { readableSections, readingMapOf, routeByQuestions } from "./reading-map";

const PASS1_TRIGGER_CHARS = 10_000;
// S3 (2026-09-15 ruling): ~400k chars (~100k tokens) is the accepted budget
// for a full paper's body reaching pass 1 — was 60_000, which combined with
// the per-bucket clips this round also removed to under-feed a paper's real
// body (a 34-page paper's Conclusions section, in particular, never reached
// pass 1 at all: buildPass1Prompt only read four of the canonicalizer's
// buckets and this one wasn't among them).
const PASS1_MAX_INPUT_CHARS = 400_000;
const PASS2_MAX_INPUT_CHARS = 24_000;
/** §1g.10 (a): the question evidence's own budget in Pass 2, serialised —
 *  on top of the body's `PASS2_MAX_INPUT_CHARS`, never out of it. */
const PASS2_QUESTION_EVIDENCE_CHARS = 12_000;
/** §1g.1: the question pass reads at most this much body (the serialised sections). */
const PASS1Q_MAX_BODY_CHARS = 60_000;
/** §1g.1: sentences kept per question. */
const MAX_RELEVANT_PER_QUESTION = 8;
/** A sentence handed on is at most this long — Pass 1's own clip. */
const MAX_SENTENCE_CHARS = 360;
/** Defensive: the route caps the questions first (P2-03, §1g.4). */
const MAX_QUESTIONS = 5;
const MAX_QUESTION_CHARS = 200;
/** §1g.4: the server's memory of Pass 1 and Pass 1q. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 32;

/** One sentence Pass 1 picked, with the section it says it came from (when
 *  that is a section of this document). */
export interface SignalItem {
  text: string;
  sectionId?: string;
}

interface CompressedSignal {
  noveltyClaims: SignalItem[];
  keyResults: SignalItem[];
  methodHighlights: SignalItem[];
  priorWorkComparisons: SignalItem[];
}

/** A body section as a prompt carries it. */
interface BodySection {
  id: string;
  heading: string;
  text: string;
}

/** Pass 1q's answer, by the index of the question in the request: the
 *  document's own sentences that bear on it, each with its section. */
export type QuestionRelevant = Record<number, { text: string; sectionId: string }[]>;

interface BuildDeepReportArgs {
  paper: Paper;
  contextHint?: string;
  /**
   * The reader's current project and challenges, joined. Only when this is
   * non-empty does Pass 2 ask for `relationToYourWork`; the page has nothing
   * to relate the paper to otherwise, and a relation invented against an
   * empty profile is exactly the fabrication the old prompt produced.
   */
  project?: string;
  doc: ExtractedDocument;
  provider: DigestProvider;
  /**
   * P2-01 (§1g.1): the reader's questions about this paper. The route trims,
   * de-duplicates and caps them (P2-03); they are capped again here. With
   * none, Pass 1q never runs and Pass 2's prompt has no question in it.
   */
  questions?: readonly string[];
}

function totalBodyChars(doc: ExtractedDocument): number {
  return doc.sections.reduce((sum, section) => sum + section.text.length, 0);
}

/** The whole abstract as the mapper split it — the corpus a Tier-1 claim must quote. */
function fullAbstract(paper: Paper): string {
  return [paper.summaryIntro, paper.summaryResultDiscussion].filter(Boolean).join(" ");
}

/**
 * P2-01 (§1g.1): every section of the body, in the paper's own order, as
 * `{ id, heading, text }` — the id the section has, or the one
 * `withSectionIds` would give it (`s<index>`, as the reading map does).
 *
 * The abstract is left out: it travels as `paper.abstract` (a Tier-1 claim
 * quotes that). Every other section is in, whatever its bucket — the S3
 * (2026-09-15) guarantee that a paper's conclusion, limitations or `body`
 * catch-all reaches Pass 1, which a fixed list of bucket names once broke.
 * A section with no text is not a section a model can read.
 */
function bodySections(doc: ExtractedDocument): BodySection[] {
  const out: BodySection[] = [];
  doc.sections.forEach((section, index) => {
    if (section.canonical === "abstract" || !section.text.trim()) return;
    out.push({ id: section.id ?? `s${index}`, heading: section.heading, text: section.text });
  });
  return out;
}

/** `text` cut to at most `cap` characters, from its start. */
function cutTo(text: string, cap: number): string {
  return text.length > cap ? text.slice(0, cap) : text;
}

/**
 * §1g.2: clip the body, never the schema. `texts` are the body's units (its
 * sections, or Pass 1's sentences); `build` puts them back into the finished
 * prompt — schema, rules and questions included — whose `size` must not pass
 * `budget`. When it would, every unit longer than a common cap is cut to it,
 * from its start, with the cap the largest that fits: the longest are cut
 * first and furthest, and a short section is never touched. Nothing but the
 * body's text changes. When even an empty body is over the budget (the fixed
 * part alone is), the prompt goes with an empty body rather than a cut schema.
 */
function fitTexts<T>(
  texts: readonly string[],
  build: (texts: string[]) => T,
  size: (built: T) => number,
  budget: number,
): T {
  return build(fitCut(texts, (cut) => size(build(cut)), budget));
}

/** `fitTexts`' cut itself: the body's units as they fit `budget` under `size`. */
function fitCut(texts: readonly string[], size: (texts: string[]) => number, budget: number): string[] {
  if (size([...texts]) <= budget) return [...texts];
  let lo = 0;
  let hi = texts.reduce((longest, text) => Math.max(longest, text.length), 0);
  while (lo < hi) {
    const cap = Math.ceil((lo + hi) / 2);
    if (size(texts.map((text) => cutTo(text, cap))) <= budget) lo = cap;
    else hi = cap - 1;
  }
  return texts.map((text) => cutTo(text, lo));
}

/**
 * §1g.10 (a): Pass 1q's sentences within their own budget. While the
 * serialised block is over it, the question whose list is longest loses its
 * last sentence — whole sentences only, never a cut inside one — so the
 * lists come down together from the longest; a list left empty goes.
 */
function fitRelevant(relevant: QuestionRelevant, budget: number = PASS2_QUESTION_EVIDENCE_CHARS): QuestionRelevant {
  const lists = new Map(Object.entries(relevant).map(([key, list]) => [key, [...list]]));
  const size = () => JSON.stringify(Object.fromEntries(lists)).length;
  while (lists.size > 0 && size() > budget) {
    let longestKey: string | undefined;
    let longest = -1;
    for (const [key, list] of lists) {
      const weight = JSON.stringify(list).length;
      if (weight > longest) {
        longest = weight;
        longestKey = key;
      }
    }
    if (longestKey === undefined) break;
    const list = lists.get(longestKey) ?? [];
    list.pop();
    if (list.length === 0) lists.delete(longestKey);
  }
  return Object.fromEntries(lists) as QuestionRelevant;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ── The server's memory of the first passes (§1g.4) ────────────────────
//
// In this process only, an hour, at most 32 entries each, the oldest
// forgotten first. Pass 1's entry is keyed by the document alone and holds
// only sentences of the document: nothing about the reader is in it. Pass
// 1q's is keyed by the document and a hash of the sorted questions, and holds
// sentences of the document by the questions' sorted position — the
// questions' text is in neither the key nor the entry.

interface Remembered<T> {
  at: number;
  value: T;
}

const PASS1_CACHE = new Map<string, Remembered<CompressedSignal>>();
const PASS1Q_CACHE = new Map<string, Remembered<SortedRelevant>>();

function recall<T>(cache: Map<string, Remembered<T>>, key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function remember<T>(cache: Map<string, Remembered<T>>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  const candidates = [
    text.trim(),
    text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "").trim(),
  ];
  const blockMatch = text.match(/\{[\s\S]*\}/);
  if (blockMatch) candidates.push(blockMatch[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

/** An item's sentence and the id it names: a bare string (Pass 1's old
 *  form) or `{ text, sectionId }`. */
function itemOf(entry: unknown): { text: string; sectionId?: string } {
  if (typeof entry === "string") return { text: entry.trim() };
  if (entry && typeof entry === "object") {
    const { text, sectionId } = entry as { text?: unknown; sectionId?: unknown };
    return {
      text: typeof text === "string" ? text.trim() : "",
      ...(typeof sectionId === "string" ? { sectionId } : {}),
    };
  }
  return { text: "" };
}

/** §1g.1: Pass 1's sentences with their sections. A bare string is still
 *  read; an id that is not a section of this document is dropped and the
 *  sentence kept. */
function signalItems(value: unknown, ids: ReadonlySet<string>, max = 6, maxLen = MAX_SENTENCE_CHARS): SignalItem[] {
  if (!Array.isArray(value)) return [];
  const out: SignalItem[] = [];
  for (const entry of value) {
    if (out.length >= max) break;
    const { text, sectionId } = itemOf(entry);
    if (text.length < 12) continue;
    out.push({
      text: text.length > maxLen ? text.slice(0, maxLen) : text,
      ...(sectionId !== undefined && ids.has(sectionId) ? { sectionId } : {}),
    });
  }
  return out;
}

const EMPTY_SIGNAL: CompressedSignal = {
  noveltyClaims: [],
  keyResults: [],
  methodHighlights: [],
  priorWorkComparisons: [],
};

/** Null when the answer is not JSON at all (then nothing is remembered). */
function parseCompressedSignal(text: string, ids: ReadonlySet<string>): CompressedSignal | null {
  const json = safeJson(text);
  if (!json) return null;
  return {
    noveltyClaims: signalItems(json.noveltyClaims, ids),
    keyResults: signalItems(json.keyResults, ids),
    methodHighlights: signalItems(json.methodHighlights, ids),
    priorWorkComparisons: signalItems(json.priorWorkComparisons, ids),
  };
}

/** One output item of a pass that quotes the paper by section. */
const QUOTED_ITEM = (what: string) => ({
  text: `${what}, copied verbatim`,
  sectionId: "the `id` of the section the sentence is from",
});

function buildPass1Prompt(paper: Paper, doc: ExtractedDocument): string {
  const sections = bodySections(doc);
  const assemble = (texts: string[]) =>
    JSON.stringify({
      task:
        "Extract sentences from this paper's body that carry SIGNAL — what is novel, what was found, what was used, and what differs from prior work. Use only sentences that appear in the supplied sections; do not paraphrase. Quote each sentence exactly as written, with the id of the section it is from.",
      paper: {
        title: paper.title,
        venue: paper.venue,
      },
      sections: sections.map((section, i) => ({ ...section, text: texts[i] })),
      outputSchema: {
        noveltyClaims: [QUOTED_ITEM("a sentence from the paper that states what is new about this work — typically in the introduction and discussion (max 6)")],
        keyResults: [QUOTED_ITEM("a sentence stating a concrete result, number, or measurement — typically in results/discussion (max 6)")],
        methodHighlights: [QUOTED_ITEM("a sentence naming a specific experiment, instrument, dataset, control, ablation, measurement, simulation, or evaluation protocol used (max 6)")],
        priorWorkComparisons: [QUOTED_ITEM("a sentence that explicitly contrasts this work with prior approaches (max 6)")],
      },
      rules: [
        "Return ONLY valid JSON.",
        "Each item's `text` must be a verbatim sentence from the supplied sections.",
        "Each item's `sectionId` is the `id` of the section the sentence was copied from.",
        "Skip generic background sentences; only include sentences that show contribution, finding, method, or comparison.",
      ],
    });
  return fitTexts(sections.map((section) => section.text), assemble, (prompt) => prompt.length, PASS1_MAX_INPUT_CHARS);
}

const PASS1_SYSTEM = [
  "You are Peer, a careful research assistant.",
  "Your job: read a paper's body sections and extract verbatim signal sentences.",
  "Do not paraphrase. Do not invent. Return only valid JSON.",
].join(" ");

/**
 * Pass 1, or its answer from the last hour for the same document (§1g.4).
 * The prompt carries no question and nothing about the reader.
 */
async function runPass1(
  paper: Paper,
  doc: ExtractedDocument,
  provider: DigestProvider,
  docHash: string,
): Promise<CompressedSignal> {
  if (!provider.generateJsonText) return EMPTY_SIGNAL;
  const cached = recall(PASS1_CACHE, docHash);
  if (cached) return cached;
  const raw = await provider.generateJsonText({
    systemPrompt: PASS1_SYSTEM,
    userPrompt: buildPass1Prompt(paper, doc),
    maxTokens: 1800,
    tier: "small",
  });
  const signal = parseCompressedSignal(raw, new Set(bodySections(doc).map((section) => section.id)));
  if (!signal) return EMPTY_SIGNAL;
  remember(PASS1_CACHE, docHash, signal);
  return signal;
}

// ── Pass 1q: the questions' own sentences (§1g.1) ──────────────────────

/** Sentences by the question's place in the sorted question list. */
type SortedRelevant = { text: string; sectionId: string }[][];

const PASS1Q_SYSTEM = [
  "You are Peer, a careful research assistant.",
  "Your job: for each of the reader's questions, find the sentences in the supplied sections that bear on it.",
  "Copy each sentence verbatim. Do not paraphrase, do not invent, do not answer the questions. Return only valid JSON.",
].join(" ");

/**
 * The sections the Tier 0 route marks `read` or `skim` for any question — the
 * same route the page draws (`routeByQuestions` over the rendered body; the
 * map is `buildReadingMap(doc)`, made from the one split) — or, when it marks
 * none, every section.
 */
function questionSections(doc: ExtractedDocument, questions: readonly string[]): BodySection[] {
  const rendered = readableSections(doc);
  const route = routeByQuestions(readingMapOf(rendered), rendered, questions);
  const marked = new Set<string>();
  for (const entry of route.byQuestion) {
    for (const [id, section] of Object.entries(entry.sections)) {
      if (section.tier === "read" || section.tier === "skim") marked.add(id);
    }
  }
  const all = bodySections(doc);
  return marked.size > 0 ? all.filter((section) => marked.has(section.id)) : all;
}

function buildQuestionPrompt(paper: Paper, sections: BodySection[], questions: readonly string[]): string {
  const fitted = fitTexts(
    sections.map((section) => section.text),
    (texts) => sections.map((section, i) => ({ ...section, text: texts[i] })),
    (body) => JSON.stringify(body).length,
    PASS1Q_MAX_BODY_CHARS,
  );
  return JSON.stringify({
    task:
      "For each of the reader's questions, list the sentences of the supplied sections that bear on it — that answer it, partly answer it, or state what it asks about. Copy each sentence exactly as written, with the id of its section. Do not answer the questions and do not write anything of your own.",
    paper: { title: paper.title },
    questions,
    sections: fitted,
    outputSchema: {
      questionRelevant: {
        "<the index of the question in `questions`, from 0>": [
          QUOTED_ITEM(`a sentence that bears on that question (max ${MAX_RELEVANT_PER_QUESTION} per question)`),
        ],
      },
    },
    rules: [
      "Return ONLY valid JSON.",
      "Each `text` is a verbatim sentence from the supplied sections; each `sectionId` is the `id` of the section it was copied from.",
      `At most ${MAX_RELEVANT_PER_QUESTION} sentences per question; an empty list is correct when no sentence bears on it.`,
    ],
  });
}

/**
 * Pass 1q's answer, each sentence held to the document: a sentence no
 * section holds verbatim is dropped and counted; a wrong `sectionId` is
 * corrected to the section that holds it; a repeated sentence is kept once;
 * at most eight per question. Null when the answer is not JSON at all.
 */
function parseQuestionRelevant(
  text: string,
  count: number,
  corpus: readonly SectionCorpusEntry[],
): { relevant: SortedRelevant; dropped: number } | null {
  const json = safeJson(text);
  if (!json) return null;
  const relevant: SortedRelevant = Array.from({ length: count }, () => []);
  let dropped = 0;
  const raw = json.questionRelevant;
  if (raw && typeof raw === "object") {
    const lists: [string, unknown][] = Array.isArray(raw) ? raw.map((list, i) => [String(i), list]) : Object.entries(raw);
    for (const [key, list] of lists) {
      const q = Number(key);
      if (!Number.isInteger(q) || q < 0 || q >= count || !Array.isArray(list)) continue;
      const kept = relevant[q];
      for (const entry of list) {
        if (kept.length >= MAX_RELEVANT_PER_QUESTION) break;
        const { text: sentence, sectionId } = itemOf(entry);
        if (!sentence) continue;
        const located = locateSection(sentence, corpus, sectionId);
        if (!located) {
          dropped += 1;
          continue;
        }
        const clipped = sentence.length > MAX_SENTENCE_CHARS ? sentence.slice(0, MAX_SENTENCE_CHARS) : sentence;
        if (kept.some((item) => item.text === clipped)) continue;
        kept.push({ text: clipped, sectionId: located });
      }
    }
  }
  return { relevant, dropped };
}

/** The questions as Pass 1q sees and the cache keys them: once each, sorted. */
function sortedQuestions(questions: readonly string[]): string[] {
  return [...new Set(questions)].sort();
}

/**
 * Pass 1q, or its answer from the last hour for the same document and the
 * same questions in any order (§1g.4). Never throws: a failed pass leaves
 * Pass 2 without `questionRelevant` and is not remembered. No log line
 * carries a question — only the paper's id and counts.
 */
async function runQuestionPass(args: {
  paper: Paper;
  doc: ExtractedDocument;
  questions: readonly string[];
  provider: DigestProvider;
  docHash: string;
}): Promise<QuestionRelevant> {
  const { paper, doc, questions, provider, docHash } = args;
  const sorted = sortedQuestions(questions);
  const key = `${docHash}|${sha256(sorted.join("\n"))}`;
  let relevant = recall(PASS1Q_CACHE, key);
  if (!relevant && provider.generateJsonText) {
    try {
      const raw = await provider.generateJsonText({
        systemPrompt: PASS1Q_SYSTEM,
        userPrompt: buildQuestionPrompt(paper, questionSections(doc, sorted), sorted),
        maxTokens: 3000,
        tier: "small",
      });
      const parsed = parseQuestionRelevant(raw, sorted.length, sectionCorpus(doc));
      if (parsed) {
        relevant = parsed.relevant;
        remember(PASS1Q_CACHE, key, relevant);
        if (parsed.dropped > 0) {
          console.warn(
            `[papers/deep-report] ${paper.id}: question pass dropped ${parsed.dropped} sentence(s) without verbatim support`,
          );
        }
      }
    } catch (err) {
      // The error's message may quote the prompt, and the prompt holds the
      // reader's questions: only the kind of failure is logged.
      console.warn(
        `[papers/deep-report] ${paper.id}: question pass failed (${err instanceof Error ? err.name : typeof err})`,
      );
    }
  }
  const out: QuestionRelevant = {};
  const found = relevant;
  if (found) {
    questions.forEach((question, i) => {
      const items = found[sorted.indexOf(question)];
      if (items && items.length > 0) out[i] = items;
    });
  }
  return out;
}

/** §1g.1 / P2-03: trimmed, empties dropped, at most five of at most 200 characters. */
function cleanQuestions(questions: readonly string[] | undefined): string[] {
  return (questions ?? [])
    .map((question) => (typeof question === "string" ? question.trim() : ""))
    .filter((question) => question.length > 0)
    .slice(0, MAX_QUESTIONS)
    .map((question) => question.slice(0, MAX_QUESTION_CHARS));
}

/**
 * The Pass-2 schema. `limitations` and `nextStep` exist only here — they need
 * the full text. `relationToYourWork` is in the schema only when the reader
 * has a project; otherwise the key is absent so the model is never invited
 * to invent one. Every claim carries `evidence`, one sentence copied from the
 * supplied text, and `verifyReportEvidence` holds it to that.
 */
function buildPass2Prompt(args: {
  paper: Paper;
  contextHint?: string;
  project?: string;
  doc: ExtractedDocument;
  signal: CompressedSignal | null;
  isReview: boolean;
  /** P2-01 (§1g.1): the reader's questions, and Pass 1q's sentences for them
   *  by question index — absent on a short paper, where Pass 1q does not run
   *  and the whole body is here (§1g.10 b). P2-02 (§1g.3): with questions the
   *  schema asks for the answers. */
  questions: readonly string[];
  questionRelevant?: QuestionRelevant;
}): string {
  const { paper, contextHint, project, doc, signal, isReview, questions, questionRelevant } = args;
  const sections = bodySections(doc);

  // Decide what body context to feed: compressed signal when available, else
  // every section verbatim — this branch only runs when pass 1 was skipped
  // for being short (bodyChars <= PASS1_TRIGGER_CHARS), so "every section" is
  // already a bounded amount of text, not a second copy of the 400k budget.
  // S3: previously four named buckets each clipped to 6000 chars, which
  // re-clipped an already-short paper's body for no reason and dropped the
  // same buckets buildPass1Prompt used to drop (conclusion, limitations, …).
  // P2-01 (§1g.1): the sections go as `[{ id, heading, text }]`, and Pass 1's
  // sentences keep their `sectionId`, with the outline (`sections: [{ id,
  // heading }]`) beside them so an id names a part of the paper.
  const groups = signal
    ? [signal.noveltyClaims, signal.keyResults, signal.methodHighlights, signal.priorWorkComparisons]
    : [];
  const units: readonly { text: string }[] = signal ? groups.flat() : sections;
  const bodyOf = (texts: string[]): unknown => {
    let k = 0;
    const put = <T extends { text: string }>(item: T): T => ({ ...item, text: texts[k++] });
    if (!signal) return sections.map(put);
    const [noveltyClaims, keyResults, methodHighlights, priorWorkComparisons] = groups.map((group) => group.map(put));
    return {
      noveltyClaims,
      keyResults,
      methodHighlights,
      priorWorkComparisons,
      sections: sections.map(({ id, heading }) => ({ id, heading })),
    };
  };

  const figureCaptions = doc.figureCaptions.slice(0, 8).map((cap) => ({
    label: cap.label,
    caption: cap.caption.slice(0, 300),
  }));

  const evidenceRule =
    "one sentence copied character-for-character from the supplied text (or the abstract) that supports `text`";

  const relationSchema = project
    ? {
        relationToYourWork: {
          basedOn: "the reader's project text, copied back",
          items: [
            {
              text: "one sentence relating a specific finding or method of this paper to the reader's project (max 3 items)",
              evidence: evidenceRule,
            },
          ],
        },
      }
    : {};

  // A review or survey has no headline result to report; its body sections
  // are the report. The key is offered only then, so a research paper is
  // never invited to invent a table of contents.
  const reviewSchema = isReview
    ? {
        reviewContents: {
          sections: [
            {
              heading: "exact section title from the paper body",
              summary: "1-2 sentences summarising the key point of that section (list 4-8 major body sections, using the paper's own section names)",
            },
          ],
        },
      }
    : {};

  // P2-02 (§1g.3): asked only when the reader asked — the
  // `relationToYourWork` pattern. Without questions none of this is in the
  // prompt, and a report the model volunteers it in drops it (sanitizer).
  const asking = questions.length > 0;
  const evidenceBlock = questionRelevant ? fitRelevant(questionRelevant) : undefined;
  const questionSchema = {
    forYourQuestions: [
      {
        question: "the reader's question, copied back — one entry per question in `readerQuestions`, in the same order",
        verdict: "answered | partly | not_addressed — whether THIS paper answers the question",
        answers: [
          {
            text: "one plain sentence answering the question from this paper (max 3 items)",
            evidence: evidenceRule,
            sectionId: "the `id` of the section the evidence sentence is from",
          },
        ],
        readNext: [
          {
            sectionId: "the `id` of a section to read for this question (max 4 items)",
            why: "one line, at most 160 characters, on what the reader finds there",
            kind: "answer | background",
          },
        ],
      },
    ],
    terms: [
      {
        term: "a term the reader needs to follow these answers (max 8 items)",
        definition: "one plain sentence, at most 160 characters",
        evidence: "the paper's own sentence defining the term, copied character-for-character; omit the key when the paper does not define it",
      },
    ],
  };
  const questionRules = [
    "`forYourQuestions` has one entry per question in `readerQuestions`, in the same order, with `question` copied back.",
    "Each answer's `evidence` is one sentence copied character-for-character from the supplied text; omit an answer you cannot support that way.",
    "Each `sectionId` is the `id` of a section of the paper as given in `body`.",
    "`verdict` is `not_addressed` when this paper does not address the question; its `answers` is then empty.",
    '`readNext.kind` is "answer" for a section that answers the question, and "background" for a section needed to understand an answer though it does not mention the question.',
    "A term's `definition` is the paper's own where the paper defines the term, with that sentence as `evidence`; otherwise it is Peer's own words and carries no `evidence`.",
    evidenceBlock
      ? "`questionRelevant` holds sentences of the paper chosen for each question, by its index in `readerQuestions`; quote from them or from `body`."
      : "The whole paper is in `body`; quote from there.",
  ];

  const assemble = (texts: string[], asked: boolean) => JSON.stringify({
    task: isReview
      ? "Create a structured Peer DEEP paper report for a REVIEW or SURVEY from the supplied paper body (or compressed signal) and abstract. List the body's major sections in `reviewContents.sections` using the paper's own section names. Every claim item carries an `evidence` sentence copied character-for-character from the supplied text; omit any item you cannot support that way. Do not fabricate numbers."
      : "Create a structured Peer DEEP paper report from the supplied paper body (or compressed signal) and abstract. Every claim item carries an `evidence` sentence copied character-for-character from the supplied text; omit any item you cannot support that way. Every key result also carries a `novelty` line saying what is new about THIS result compared to prior approaches. Do not fabricate numbers; if a number is not in the supplied text, omit it.",
    userContext: contextHint || "",
    ...(project ? { readerProject: project } : {}),
    paper: {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue,
      abstract: fullAbstract(paper),
    },
    body: bodyOf(texts),
    figureCaptions,
    ...(asked ? { readerQuestions: questions, ...(evidenceBlock ? { questionRelevant: evidenceBlock } : {}) } : {}),
    outputSchema: {
      skim: [
        {
          text: "one plain sentence a reader uses to decide whether to open the paper — the finding, not the topic (max 3 items)",
          evidence: evidenceRule,
        },
      ],
      whatItProposes: {
        summary: "one plain paragraph, at most 2 sentences, describing what the paper does. Do not include the method list here.",
        methods: [
          {
            text: "one concrete method sentence naming the actual experiment, instrument, dataset, control, ablation, measurement, simulation, or evaluation protocol used (max 4 items)",
            evidence: evidenceRule,
          },
        ],
        newHere: [
          "a short 'new here' line — the novelty, stated only where it differs from `summary`; omit entirely if there is nothing to add beyond the summary (max 2 items)",
        ],
      },
      resultsAndSignificance: {
        summary: "2-3 sentences explaining the headline result and why it matters.",
        keyResults: [
          {
            title: "short label",
            detail:
              "one concrete result sentence grounded in the supplied text (report two to four key results when the paper states at least two distinct findings; a single-finding paper may report just one)",
            evidence: evidenceRule,
            novelty: "one sentence saying what specifically is new about THIS result compared to prior work",
          },
        ],
      },
      ...reviewSchema,
      limitations: [
        {
          text: "one limitation the authors themselves state — only what the authors state, nothing inferred (max 3 items; omit the key if the authors state none)",
          evidence: evidenceRule,
        },
      ],
      nextStep: {
        text: "one concrete experiment or check the reader could run next, tied to a sentence of the paper; omit the key if none",
        evidence: evidenceRule,
      },
      ...relationSchema,
      ...(asked ? questionSchema : {}),
    },
    rules: [
      "Return ONLY valid JSON.",
      "`evidence` is one sentence copied character-for-character from the supplied text (or the abstract). Do not paraphrase it, shorten it, or merge sentences.",
      "Omit any claim item you cannot support with such a sentence. An empty array is correct when nothing qualifies.",
      "`newHere` (proposal) and `novelty` (per result) are Peer's reading and carry no evidence sentence; keep them specific and grounded in the supplied text, never generic.",
      "Do not repeat a sentence from `summary` inside `newHere`; if the novelty is not separable from the summary, leave `newHere` empty.",
      "No sentence in `summary` or `newHere` exceeds about 25 words; use plain, high-school-reading-level wording.",
      "`limitations` holds only what the authors state; do not infer weaknesses.",
      ...(project
        ? ["`relationToYourWork.basedOn` is the reader's project text copied back."]
        : []),
      ...(asked ? questionRules : []),
    ],
  });
  // §1g.2: the body is cut to fit; the schema and the rules are appended
  // whole. §1g.10 (a): the body's budget is measured as if there were no
  // questions, so they never cost it a character; the questions, their
  // schema and rules, and the question evidence (its own 12 000) come on top.
  const cut = fitCut(units.map((unit) => unit.text), (texts) => assemble(texts, false).length, PASS2_MAX_INPUT_CHARS);
  return assemble(cut, asking);
}

const PASS2_SYSTEM = [
  "You are Peer, a careful research assistant.",
  "Write a structured deep paper report grounded in the supplied body text.",
  "Every claim carries an `evidence` sentence copied character-for-character from the supplied text; a claim without one is omitted.",
  "Be specific: name the actual technique, finding, or comparison rather than generic phrases.",
  "Keep proposal, method and novelty separate: proposal says what the paper tries to do; methods say what experiments or evaluations were actually used; novelty says what is new against prior work, in one or two sentences.",
  "Do not fabricate numbers, citations, or experimental details.",
  "Return only valid JSON.",
].join(" ");

async function runPass2(args: {
  paper: Paper;
  contextHint?: string;
  project?: string;
  doc: ExtractedDocument;
  signal: CompressedSignal | null;
  questions: readonly string[];
  questionRelevant?: QuestionRelevant;
  provider: DigestProvider;
}): Promise<PaperReport | null> {
  if (!args.provider.generateJsonText) return null;

  const prompt = buildPass2Prompt({
    paper: args.paper,
    contextHint: args.contextHint,
    project: args.project,
    doc: args.doc,
    signal: args.signal,
    isReview: reviewPaperLabel(args.paper) !== null,
    questions: args.questions,
    questionRelevant: args.questionRelevant,
  });
  const raw = await args.provider.generateJsonText({
    systemPrompt: PASS2_SYSTEM,
    userPrompt: prompt,
    // Room for the restored sections: novelty, per-result novelty, the fit
    // block and, on a review, its contents.
    maxTokens: 3200,
    tier: reportModelTier(),
  });
  const parsed = safeJson(raw);
  if (!parsed) return null;
  // §1g.3: the answers are kept only against the request's own questions.
  return sanitizePaperReport(parsed, { questions: args.questions });
}

/**
 * Produce a deep, body-grounded, evidence-verified paper report. Returns null
 * on any LLM failure so the caller can fall back to the abstract-only path.
 */
export async function generateDeepReport(
  args: BuildDeepReportArgs,
): Promise<PaperReport | null> {
  const { paper, contextHint, doc, provider } = args;
  const project = args.project?.trim() || undefined;
  const questions = cleanQuestions(args.questions);
  if (!provider.generateJsonText) return null;
  if (doc.sections.length === 0) return null;

  try {
    const bodyChars = totalBodyChars(doc);
    const runsPass1 = bodyChars > PASS1_TRIGGER_CHARS;
    // §1g.10 (b): on a short paper Pass 2 reads every sentence, so there is
    // no question pass either; the server verifies the answers anyway.
    const runsQuestionPass = runsPass1 && questions.length > 0;
    // §1g.4: the memory's key — the document itself, nothing about the reader.
    const docHash = runsPass1 ? sha256(JSON.stringify(doc)) : "";
    // Independent of each other, so side by side: Pass 1 never sees a
    // question, Pass 1q runs only when there is one.
    const [signal, questionRelevant] = await Promise.all([
      runsPass1 ? runPass1(paper, doc, provider, docHash) : Promise.resolve(null),
      runsQuestionPass
        ? runQuestionPass({ paper, doc, questions, provider, docHash })
        : Promise.resolve(undefined),
    ]);

    const report = await runPass2({
      paper,
      contextHint,
      project,
      doc,
      signal,
      questions,
      questionRelevant,
      provider,
    });
    if (!report) return null;

    // The model was never asked for a relation without a project; should it
    // volunteer one anyway, it is not kept. With a project, `basedOn` is the
    // project text the server holds, not the model's echo of it.
    if (!project) {
      delete report.relationToYourWork;
    } else if (report.relationToYourWork) {
      report.relationToYourWork.basedOn = project.slice(0, 200);
    }

    const verified = verifyReportEvidence(report, {
      abstract: fullAbstract(paper),
      doc,
    });
    if (verified.dropped > 0) {
      console.warn(
        `[papers/deep-report] ${paper.id}: dropped ${verified.dropped} claim(s) without verbatim support`,
      );
    }

    return {
      ...verified.report,
      depth: "deep" as PaperReportDepth,
      sourceKind: doc.source,
      provenance: {
        ...verified.report.provenance,
        basis: "model-fulltext",
        sourceKind: doc.source,
        ...(typeof doc.pageCount === "number" ? { pageCount: doc.pageCount } : {}),
      },
    };
  } catch (err) {
    // Only the kind of the error is logged, questions or not (§1g.4 — no
    // question in any log line; §1h.16 (a)). The prompt holds the paper's
    // text, which for a standalone upload is a private PDF's, and a provider's
    // error may quote the prompt back in its message (the OpenAI provider
    // keeps part of an error body there), so the message never reaches a log.
    console.error(
      "[papers/deep-report] generation failed:",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
}

/** Heuristic budget guard so callers can refuse to deep-read silly-long inputs. */
export function isWithinDeepReportBudget(doc: ExtractedDocument): boolean {
  return totalBodyChars(doc) > 800;
}

/**
 * The report for a paper whose full text the publisher blocked and whose
 * abstract-tier model call also produced nothing: empty, with the notice the
 * page turns into its availability sentence. Nothing is written in its place.
 */
export function buildPaywalledFallback(notice: string): PaperReport {
  return { ...emptyReport("fallback"), paywallNotice: notice };
}
