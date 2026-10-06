// "Explain this?" — the server's half (P3-02; ruling §1h.2; user decision
// §1a.10; blueprint §3.5 ⑤ 词, relaxed from a word to a passage).
//
// A reader selects a passage of the paper's body and asks what it means. The
// answer has two labelled parts: what the term or passage means in general,
// and why the author brings it up in THIS paper — the second carrying one
// sentence of the paper, verbatim, as its receipt. The model is asked for
// both; the server keeps only what it can stand behind:
//
//   - `clipPassage` / `locatePassage`: the passage is bounded to one paragraph's
//     worth and must actually be the paper's text — a selection that is not
//     in the body is refused by the route before any model is asked;
//   - `buildExplainPrompt`: the paper's title, abstract, the map's one line per
//     section, the paragraph around the passage and the passage — and nothing
//     about the reader (no profile, no project, no questions);
//   - `sanitizeExplainAnswer`: whitelists and caps, fabricates nothing;
//   - `verifyExplainAnswer`: the quote must be a whole sentence-sized stretch
//     of one section of the document (the P2 locator, `locateSection`); one the
//     paper does not hold is removed and the part is Peer's reading, labelled
//     as such by the page (`PEERS_READING`) — never shown as the paper's words;
//   - the cache is a memory of verified answers keyed by the document, the
//     passage and the thread (§1g.4): nothing about the reader is in a key or
//     an entry, so one reader's answer can only ever be another's cache hit for
//     the same words of the same paper.
//
// Pure apart from the hash and the clock the cache reads: no I/O, no logging.
// Server-side — the browser imports this module for its types only.

import { createHash } from "node:crypto";
import { cleanDisplayText } from "@/lib/text/clean";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import { locateSection, normalizeForMatch, sectionCorpus } from "./evidence";
import type { ExtractedDocument } from "./html-text";
import { openingOf, readableSections } from "./reading-map";
import { splitSentences } from "./skim";

export const EXPLAIN_CAPS = {
  /** A passage is at most this long, after whitespace is collapsed. */
  passageChars: 1200,
  /** Each of the two parts is at most two sentences and this many characters. */
  partChars: 420,
  evidenceChars: 400,
  titleChars: 300,
  abstractChars: 2500,
  /** The map's lines in the prompt, and the longest heading and opening. */
  mapLines: 80,
  headingChars: 120,
  openingChars: 160,
  /** The paragraph the passage sits in, and the one on either side of it. */
  paragraphChars: 2000,
  neighbourChars: 1500,
  /** The server's memory of answers: how many, and for how long. */
  cacheEntries: 64,
  cacheTtlMs: 60 * 60 * 1000,
} as const;

// ── The answer, and what the route says ────────────────────────────────

/** The two parts. `here.evidence` is the paper's own sentence, verified; when
 *  it is absent `here.peer` is true and the page labels the prose as Peer's. */
export interface ExplainAnswer {
  /** What the term or passage means in general. Peer's words. */
  meaning: string;
  /** Why the author brings it up here. */
  here: {
    text: string;
    evidence?: string;
    evidenceWhere?: string;
    sectionId?: string;
    page?: number;
    peer?: true;
  };
}

/** What `POST /api/papers/[id]/explain` answers (the status says the rest). */
export type ExplainResult =
  | { answer: ExplainAnswer; cached: boolean }
  | { unavailable: true; quota?: QuotaSignal }
  | { error: "not_in_paper" };

// ── Small text helpers ─────────────────────────────────────────────────

/** `text` cut to at most `max` characters, at the last space when there is one. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const space = text.lastIndexOf(" ", max);
  return (space > 0 ? text.slice(0, space) : text.slice(0, max)).trimEnd();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A short, one-way tag for a log line — enough to tell readers apart, never
 *  enough to name one. */
export function shortHash(text: string): string {
  return sha256(text).slice(0, 12);
}

// ── The passage ────────────────────────────────────────────────────────

/** The passage as it is used: whitespace collapsed, at most 1,200 characters,
 *  cut at a word boundary. */
export function clipPassage(passage: string): string {
  return cutAtWord(passage.replace(/\s+/g, " ").trim(), EXPLAIN_CAPS.passageChars);
}

export interface LocatedPassage {
  /** The section's id and its place in the rendered body (`reading.body[k]`). */
  sectionId: string;
  sectionIndex: number;
  paragraphIndex: number;
  /** The paragraph that holds the passage, as the body renders it. */
  paragraph: string;
  /** The paragraphs on either side of it within the section, when they exist. */
  before: string | null;
  after: string | null;
}

/**
 * The paragraph of the body that holds `passage` — the match the verifier
 * makes: normalised on both sides, so case, whitespace and a hyphenated line
 * break do not matter. The hinted paragraph is tried first (the browser knows
 * where the reader selected), then the rest of the hinted section, then the
 * whole body in reading order. The abstract is not part of the body, so a
 * passage found only there is not found. Null when nowhere: the selection was
 * not the paper's text.
 */
export function locatePassage(
  doc: ExtractedDocument,
  passage: string,
  hint: { sectionId?: string; paragraphIndex?: number } = {},
): LocatedPassage | null {
  const wanted = normalizeForMatch(passage);
  if (!wanted) return null;
  const rendered = readableSections(doc);

  const order: Array<[number, number]> = [];
  const seen = new Set<string>();
  const push = (k: number, i: number) => {
    const key = `${k}:${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    order.push([k, i]);
  };
  const hinted = hint.sectionId ? rendered.findIndex((section) => section.id === hint.sectionId) : -1;
  if (hinted >= 0) {
    const index = hint.paragraphIndex;
    if (typeof index === "number" && Number.isInteger(index) && rendered[hinted].paragraphs[index] !== undefined) push(hinted, index);
    rendered[hinted].paragraphs.forEach((_, i) => push(hinted, i));
  }
  rendered.forEach((section, k) => section.paragraphs.forEach((_, i) => push(k, i)));

  for (const [k, i] of order) {
    const { id, paragraphs } = rendered[k];
    if (!normalizeForMatch(paragraphs[i]).includes(wanted)) continue;
    return {
      sectionId: id,
      sectionIndex: k,
      paragraphIndex: i,
      paragraph: paragraphs[i],
      before: paragraphs[i - 1] ?? null,
      after: paragraphs[i + 1] ?? null,
    };
  }
  return null;
}

// ── The prompt ─────────────────────────────────────────────────────────

export interface ExplainMapLine {
  heading: string;
  /** How the section's first paragraph opens (`openingOf`); null when it has none. */
  opening: string | null;
}

/** One line per section the body renders: its heading and how it opens — the
 *  map's own, from the same split the body and the map use. */
export function explainMapLines(doc: ExtractedDocument): ExplainMapLine[] {
  return readableSections(doc).map(({ section, paragraphs }) => ({
    heading: section.heading,
    opening: paragraphs.length > 0 ? openingOf(paragraphs[0]) : null,
  }));
}

const EXPLAIN_SYSTEM = [
  "You are Peer, a calm research assistant who sits beside a reader.",
  "The reader selected a passage of a paper and asked what it means.",
  "Explain it in plain English, for a thoughtful reader who is not in this field: first what the term or passage means in general, then why the author brings it up in this paper.",
  "Never quote the paper except with a sentence copied character-for-character from the text supplied.",
  "Do not fabricate numbers, citations or experimental details.",
  "Return only valid JSON.",
].join(" ");

/**
 * The system and user prompts for one explanation. The user prompt is the
 * paper's title, its abstract, the map's lines, the paragraph around the
 * passage and the passage, then the schema and the rules — every piece bounded
 * before it is serialised, so the schema and the rules are never what gets cut.
 * Nothing about the reader is a parameter, so nothing about the reader can be in it.
 */
export function buildExplainPrompt(args: {
  paper: { title: string; abstract: string };
  map: readonly ExplainMapLine[];
  located: Pick<LocatedPassage, "paragraph" | "before" | "after">;
  passage: string;
}): { systemPrompt: string; userPrompt: string } {
  const { paper, map, located } = args;
  const userPrompt = JSON.stringify({
    task: "Explain the reader's selected passage in two parts: what it means in general, and why the author brings it up here.",
    paper: {
      title: cutAtWord(cleanDisplayText(paper.title), EXPLAIN_CAPS.titleChars),
      abstract: cutAtWord(cleanDisplayText(paper.abstract), EXPLAIN_CAPS.abstractChars),
    },
    sections: map.slice(0, EXPLAIN_CAPS.mapLines).map((line) => ({
      heading: cutAtWord(line.heading, EXPLAIN_CAPS.headingChars),
      ...(line.opening ? { opening: cutAtWord(line.opening, EXPLAIN_CAPS.openingChars) } : {}),
    })),
    context: {
      ...(located.before ? { before: cutAtWord(located.before, EXPLAIN_CAPS.neighbourChars) } : {}),
      paragraph: cutAtWord(located.paragraph, EXPLAIN_CAPS.paragraphChars),
      ...(located.after ? { after: cutAtWord(located.after, EXPLAIN_CAPS.neighbourChars) } : {}),
    },
    passage: clipPassage(args.passage),
    outputSchema: {
      meaning: "at most two sentences, in plain words, saying what the selected term or passage means in general, as a good textbook would, not specific to this paper",
      here: {
        text: "at most two sentences, in plain words, saying why the author brings it up at this point of this paper",
        evidence: "one sentence copied character-for-character from the paper's text in `context` that shows the author using it here",
      },
    },
    rules: [
      "Return ONLY valid JSON.",
      "Use plain words a thoughtful non-specialist understands; define nothing with another unexplained term.",
      "`here.evidence` is one sentence copied character-for-character from `context.before`, `context.paragraph` or `context.after`. Do not paraphrase it, shorten it, or merge sentences.",
      "Omit `evidence` when no such sentence shows the author using it. Never quote the abstract or the section list; they are there for orientation only.",
      "No LaTeX, no links, no advice, no verdict on whether the reader should read on.",
    ],
  });
  return { systemPrompt: EXPLAIN_SYSTEM, userPrompt };
}

// ── The answer ─────────────────────────────────────────────────────────

/**
 * The model's text as JSON, or null: the whole text, the text with a code fence
 * stripped, or the first `{…}` block in it (a model may reason before or after
 * the object). The same three tries the report passes make; those keep theirs
 * private, so this is its own.
 */
export function parseModelJson(text: string): unknown {
  const candidates = [text.trim(), text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "").trim()];
  const block = text.match(/\{[\s\S]*\}/);
  if (block) candidates.push(block[0]);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** One part of the answer: cleaned, at most two sentences, at most 420 characters. */
function part(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = cleanDisplayText(value).replace(/\s+/g, " ").trim();
  return cutAtWord(splitSentences(cleaned).slice(0, 2).join(" "), EXPLAIN_CAPS.partChars);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whitelist what the model sent into an `ExplainAnswer`: both parts with
 * words, each at most two sentences; the quote a cleaned string of at most 400
 * characters. Whatever else the model said — a place, a page, a "peer" flag —
 * is dropped: only the verifier says where a quote sits. Null unless both
 * parts have words.
 */
export function sanitizeExplainAnswer(raw: unknown): ExplainAnswer | null {
  if (!isRecord(raw) || !isRecord(raw.here)) return null;
  const meaning = part(raw.meaning);
  const text = part(raw.here.text);
  if (!meaning || !text) return null;
  const evidence = typeof raw.here.evidence === "string" ? cleanDisplayText(raw.here.evidence).slice(0, EXPLAIN_CAPS.evidenceChars).trim() : "";
  return { meaning, here: evidence ? { text, evidence } : { text } };
}

/**
 * Hold `here.evidence` to the paper: one section of the document must hold
 * the whole quote (`locateSection`, the P2 rule — §1g.16), trying
 * `preferSectionId` first. Found: the section's id, heading and page are set
 * from the document, never from the model. Not found, or no quote at all: the
 * quote and every place go, and `here.peer` is true — the page labels the
 * prose as Peer's own reading, not as the paper's. The answer given is not changed.
 */
export function verifyExplainAnswer(answer: ExplainAnswer, doc: ExtractedDocument, preferSectionId?: string): ExplainAnswer {
  const { meaning, here } = answer;
  if (here.evidence) {
    const id = locateSection(here.evidence, sectionCorpus(doc), preferSectionId);
    if (id !== null) {
      const section = doc.sections.find((candidate, index) => (candidate.id ?? `s${index}`) === id);
      if (section) {
        return {
          meaning,
          here: {
            text: here.text,
            evidence: here.evidence,
            evidenceWhere: section.heading.trim() || section.canonical,
            sectionId: id,
            ...(typeof section.page === "number" ? { page: section.page } : {}),
          },
        };
      }
    }
  }
  return { meaning, here: { text: here.text, peer: true } };
}

// ── The server's memory (§1g.4) ────────────────────────────────────────

/** The document's hash — the first part of every key. The document alone: the
 *  same paper read by two readers has the same hash. */
export function explainDocHash(doc: ExtractedDocument): string {
  return sha256(JSON.stringify(doc));
}

/**
 * The key an answer is remembered under: the document's hash, the passage as
 * the verifier reads it, and a hash of the thread so far (empty for the first
 * message; P3-02b's turns change it). A hash of all three — nothing in it is
 * the reader's, and nothing of the passage can be read back from it.
 */
export function explainCacheKey(docHash: string, passage: string, thread: readonly string[]): string {
  return sha256(`${docHash}|${normalizeForMatch(passage)}|${sha256(JSON.stringify(thread))}`);
}

/** The counter an explanation is counted on: one reader, one UTC day. It
 *  counts only (§1h.2: no charge in P3-02); nothing reads it for a decision. */
export function explainDayKey(userId: string, now: Date): string {
  return `explain_turns:${userId}:${now.toISOString().slice(0, 10)}`;
}

export interface ExplainCache {
  get(key: string): ExplainAnswer | undefined;
  set(key: string, answer: ExplainAnswer): void;
  size(): number;
  clear(): void;
}

/**
 * In this process only: at most `max` verified answers for at most `ttlMs`,
 * the oldest forgotten first. Holds answers and keys — never a passage, never
 * a reader.
 */
export function createExplainCache(
  options: { max?: number; ttlMs?: number; now?: () => number } = {},
): ExplainCache {
  const max = options.max ?? EXPLAIN_CAPS.cacheEntries;
  const ttlMs = options.ttlMs ?? EXPLAIN_CAPS.cacheTtlMs;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; answer: ExplainAnswer }>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return hit.answer;
    },
    set(key, answer) {
      entries.delete(key);
      entries.set(key, { at: now(), answer });
      while (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    size: () => entries.size,
    clear: () => entries.clear(),
  };
}

/** The route's own memory. */
export const explainCache: ExplainCache = createExplainCache();
