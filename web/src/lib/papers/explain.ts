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
// P3-02b (ruling §1h.3) adds the thread: a reader may ask follow-ups about the
// same passage, up to eight, in a short conversation beside the text. The
// client sends the thread so far — the first answer as its first `peer`
// message, then each reader / Peer pair, ending with the reader's new message —
// so the server never has to remember a conversation:
//
//   - `readThread`: what the server reads of it — at most 17 messages, the first
//     (the first answer, both of its parts) clipped to 840 characters and each later
//     one to 400, anything malformed taken for no thread;
//   - `buildExplainReplyPrompt`: the same bounded context as the first message
//     plus the thread in order, each message labelled by its role, the reader's
//     last message named as the one to answer;
//   - `sanitizeExplainReply` / `verifyExplainReply`: the reply (at most three
//     sentences) and its quote, held to the paper exactly as the first answer's.
//
// P3-02c (ruling §1h.4 amendment) lets a reply search the web, for one message,
// when the reader turns that on and the provider can:
//
//   - `buildExplainReplyPrompt`'s `search` swaps the rule "do not search the web"
//     for one that allows web search for general background — and still says the
//     paper's own words come only from the context, the evidence is still one
//     sentence copied from it, and no URL or source is named;
//   - `explainCacheKey`'s `searched` keeps a searched reply apart from the same
//     thread answered without search: the memory must never hand a plain reply to
//     a request that asked to search, nor the reverse;
//   - `sanitizeExplainReply` drops any web address the model wrote into a reply: the
//     page never shows a link to a web source (the blueprint has no external
//     links), and the mark "searched the web" is the only trace of the search.
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
  /** P3-02b: a thread is at most this many messages (the first answer, then up
   *  to eight reader / Peer pairs), of which at most eight are the reader's,
   *  each after the first clipped to `messageChars`. */
  threadMessages: 17,
  threadReaderMessages: 8,
  messageChars: 400,
  /** P3-05 (§1h.8 (3), O8): the thread's first message is the first answer, both
   *  of its parts joined (each up to `partChars`), so it is read to this length —
   *  at 400 the model that writes a follow-up never saw "Why it is here". */
  firstAnswerChars: 840,
  /** A reply is at most three sentences and this many characters. */
  replySentences: 3,
  replyChars: 560,
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

/** One message of a thread, as the client sends it: the first answer is the
 *  first `peer` message; the last one is the reader's. */
export interface ExplainMessage {
  role: "reader" | "peer";
  text: string;
}

/** The model's reply to the reader's last message, sanitised and not yet
 *  verified: its words and, when it rests on the paper, one sentence of it. */
export interface ExplainReply {
  reply: string;
  evidence?: string;
}

/** A reply as the page shows it (P3-02b): Peer's words and, verified, the
 *  paper's own sentence with where it is from; otherwise `peer: true` and the
 *  page labels the prose as Peer's own reading. */
export interface ExplainReplyTurn {
  role: "peer";
  text: string;
  evidence?: string;
  evidenceWhere?: string;
  sectionId?: string;
  page?: number;
  peer?: true;
  /** P3-02c: whether this reply was written with web search. The route sets it on
   *  every reply it answers (`verifyExplainReply` leaves it to the route, which knows). */
  searched?: boolean;
}

/** What `POST /api/papers/[id]/explain` answers (the status says the rest). */
export type ExplainResult =
  | { answer: ExplainAnswer; cached: boolean }
  | { turn: ExplainReplyTurn; cached: boolean }
  | { unavailable: true; quota?: QuotaSignal }
  | { error: "not_in_paper" }
  | { error: "thread_full" }
  /** P3-02c: the charge was refused (429) — `exhausted`: the reader's day or the
   *  house's ceiling is spent; `unavailable`: the counter could not be read and
   *  nothing was spent. */
  | { error: "explain_exhausted"; reason: "exhausted" | "unavailable"; resetsAt: string };

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

// ── The thread (P3-02b) ────────────────────────────────────────────────

/** What the server read of a request's `thread`. */
export interface ReadThread {
  /** The messages, in order — the first clipped to `EXPLAIN_CAPS.firstAnswerChars`
   *  (it is the first answer), each later one to `EXPLAIN_CAPS.messageChars` —
   *  empty for no thread. */
  messages: ExplainMessage[];
  /** How many of them are the reader's (counted before the length rule, so a
   *  thread past the cap can be told to be full). */
  readers: number;
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** How long a thread's message may be: the first (index 0) is the first answer, both
 *  parts of it; every later one is a reader's question or a short reply. */
const messageCap = (index: number): number => (index === 0 ? EXPLAIN_CAPS.firstAnswerChars : EXPLAIN_CAPS.messageChars);

/**
 * The thread a request carries, or none. An array of `{ role, text }` with a
 * role of `reader` or `peer` and words in the text; each text has its
 * whitespace collapsed and is clipped at a word to 400 characters — the first
 * message, which is the first answer with both of its parts, to 840. Anything else — not an
 * array, a message that is not an object, a role that is neither, a text that is
 * not words — is no thread at all, never a partial one. At most 17 messages are
 * read (the first answer, then up to eight pairs): a longer thread is none too,
 * unless it holds more than eight reader messages, which `readers` still says so
 * the route can answer that the thread is full.
 */
export function readThread(value: unknown): ReadThread {
  const none: ReadThread = { messages: [], readers: 0 };
  if (!Array.isArray(value)) return none;
  const messages: ExplainMessage[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item)) return none;
    const { role, text } = item;
    if ((role !== "reader" && role !== "peer") || typeof text !== "string") return none;
    const clipped = cutAtWord(collapse(text), messageCap(messages.length));
    if (!clipped) return none;
    messages.push({ role, text: clipped });
  }
  const readers = messages.filter((message) => message.role === "reader").length;
  return messages.length > EXPLAIN_CAPS.threadMessages ? { messages: [], readers } : { messages, readers };
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
  const userPrompt = JSON.stringify({
    task: "Explain the reader's selected passage in two parts: what it means in general, and why the author brings it up here.",
    ...promptContext(args),
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

/** What both prompts share: the title, the abstract, the map's lines and the
 *  paragraph around the passage — every piece bounded before it is serialised. */
function promptContext(args: {
  paper: { title: string; abstract: string };
  map: readonly ExplainMapLine[];
  located: Pick<LocatedPassage, "paragraph" | "before" | "after">;
}) {
  const { paper, map, located } = args;
  return {
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
  };
}

const EXPLAIN_REPLY_SYSTEM = [
  "You are Peer, a calm research assistant who sits beside a reader.",
  "The reader selected a passage of a paper and is asking follow-up questions about it.",
  "Answer the reader's last message about that passage in plain English, for a thoughtful reader who is not in this field.",
  "Never quote the paper except with a sentence copied character-for-character from the text supplied.",
  "Do not fabricate numbers, citations or experimental details.",
  "Return only valid JSON.",
].join(" ");

/**
 * The system and user prompts for one reply in a thread (P3-02b): the same
 * bounded context as the first message, then the thread in order — each message
 * labelled by its role, at most 17, the first (the first answer) at most 840
 * characters and each later one at most 400, the latest kept — and the reader's
 * last message named as the one to answer, then the schema
 * and the rules, which are never what gets cut. Nothing about the reader is a
 * parameter but the words they sent in the thread. With `search` (P3-02c) the
 * one rule about the web is the search rule; nothing else changes.
 */
export function buildExplainReplyPrompt(args: {
  paper: { title: string; abstract: string };
  map: readonly ExplainMapLine[];
  located: Pick<LocatedPassage, "paragraph" | "before" | "after">;
  passage: string;
  thread: readonly ExplainMessage[];
  /** P3-02c: this reply may use web search for general background. */
  search?: boolean;
}): { systemPrompt: string; userPrompt: string } {
  // The cap follows the message's place in the thread as sent: the first answer
  // keeps its 840 only while it is in the prompt, and once the oldest are dropped
  // no later message is read at its length.
  const dropped = Math.max(0, args.thread.length - EXPLAIN_CAPS.threadMessages);
  const thread = args.thread
    .slice(dropped)
    .map((message, index) => ({ role: message.role, text: cutAtWord(collapse(message.text), messageCap(dropped + index)) }));
  const last = [...thread].reverse().find((message) => message.role === "reader");
  const userPrompt = JSON.stringify({
    task: "Answer the reader's last message in `thread` about the selected passage.",
    ...promptContext(args),
    passage: clipPassage(args.passage),
    thread,
    lastReaderMessage: last?.text ?? "",
    outputSchema: {
      reply: "at most three sentences, in plain words, answering the reader's last message about this passage",
      evidence: "one sentence copied character-for-character from the paper's text in `context`, only when the reply rests on something the paper says; otherwise leave this key out",
    },
    rules: [
      "Return ONLY valid JSON.",
      "Answer `lastReaderMessage`, the reader's last message in `thread`, about the selected passage, in at most three sentences of plain words a thoughtful non-specialist understands. The earlier messages are there for what has been said so far.",
      "`evidence` is one sentence copied character-for-character from `context.before`, `context.paragraph` or `context.after`, and only when the reply rests on something the paper says. Do not paraphrase it, shorten it, or merge sentences.",
      "Omit `evidence` when the reply does not rest on a sentence of the paper. Never quote the abstract, the section list or the thread.",
      args.search
        ? "You may use web search for general background. The paper's own words still come only from `context`; `evidence` is still one sentence copied from it. Name no URL and no source by name. No advice, no verdict on whether the reader should read on."
        : "Do not search the web or rely on anything outside the text supplied. No advice, no verdict on whether the reader should read on.",
      "No LaTeX, no links.",
    ],
  });
  return { systemPrompt: EXPLAIN_REPLY_SYSTEM, userPrompt };
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

/** Some of the model's words: cleaned, at most `sentences` sentences, at most `chars` characters. */
function words(value: unknown, sentences: number, chars: number): string {
  if (typeof value !== "string") return "";
  const cleaned = cleanDisplayText(value).replace(/\s+/g, " ").trim();
  return cutAtWord(splitSentences(cleaned).slice(0, sentences).join(" "), chars);
}

/** One part of the answer: cleaned, at most two sentences, at most 420 characters. */
function part(value: unknown): string {
  return words(value, 2, EXPLAIN_CAPS.partChars);
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

/** Where in the document a quote sits, from the document and never from the
 *  model: the whole quote must be in one section (`locateSection`, the P2
 *  rule — §1g.16), `preferSectionId` tried first. Null when no section holds it. */
function placeQuote(
  evidence: string,
  doc: ExtractedDocument,
  preferSectionId?: string,
): { evidence: string; evidenceWhere: string; sectionId: string; page?: number } | null {
  const id = locateSection(evidence, sectionCorpus(doc), preferSectionId);
  if (id === null) return null;
  const section = doc.sections.find((candidate, index) => (candidate.id ?? `s${index}`) === id);
  if (!section) return null;
  return {
    evidence,
    evidenceWhere: section.heading.trim() || section.canonical,
    sectionId: id,
    ...(typeof section.page === "number" ? { page: section.page } : {}),
  };
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
  const placed = here.evidence ? placeQuote(here.evidence, doc, preferSectionId) : null;
  if (placed) return { meaning, here: { text: here.text, ...placed } };
  return { meaning, here: { text: here.text, peer: true } };
}

// ── The reply (P3-02b) ─────────────────────────────────────────────────

/** A web address: a scheme, or `www.`, then everything up to a space or a closing bracket. */
const WEB_ADDRESS = /(?:https?:\/\/|www\.)[^\s)\]>"']+/gi;

/**
 * The model's words with every web address taken out (P3-02c). A reply written
 * with web search may name where it read something; the page shows no link to a
 * web source, and the mark "searched the web" is the only trace — so the address
 * goes, and a sentence's closing punctuation that the address had swallowed stays.
 */
function withoutWebAddresses(text: string): string {
  return text
    .replace(WEB_ADDRESS, (address) => /[.,;:!?]+$/.exec(address)?.[0] ?? "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Whitelist what the model sent as a reply: its words, cleaned, at most three
 * sentences and 560 characters; the quote a cleaned string of at most 400
 * characters. Whatever else the model said — a place, a page, a "peer" flag —
 * is dropped: only the verifier says where a quote sits. Null without words.
 */
export function sanitizeExplainReply(raw: unknown): ExplainReply | null {
  if (!isRecord(raw)) return null;
  const reply = words(typeof raw.reply === "string" ? withoutWebAddresses(raw.reply) : raw.reply, EXPLAIN_CAPS.replySentences, EXPLAIN_CAPS.replyChars);
  if (!reply) return null;
  const evidence = typeof raw.evidence === "string" ? cleanDisplayText(raw.evidence).slice(0, EXPLAIN_CAPS.evidenceChars).trim() : "";
  return evidence ? { reply, evidence } : { reply };
}

/**
 * Hold a reply's quote to the paper exactly as the first answer's is held:
 * found whole in one section, the place set from the document; otherwise — or
 * with no quote at all — the quote goes and `peer: true` says the page labels
 * the prose as Peer's own reading. The reply given is not changed.
 */
export function verifyExplainReply(reply: ExplainReply, doc: ExtractedDocument, preferSectionId?: string): ExplainReplyTurn {
  const placed = reply.evidence ? placeQuote(reply.evidence, doc, preferSectionId) : null;
  if (placed) return { role: "peer", text: reply.reply, ...placed };
  return { role: "peer", text: reply.reply, peer: true };
}

// ── The server's memory (§1g.4) ────────────────────────────────────────

/** The document's hash — the first part of every key. The document alone: the
 *  same paper read by two readers has the same hash. */
export function explainDocHash(doc: ExtractedDocument): string {
  return sha256(JSON.stringify(doc));
}

/**
 * The key an answer is remembered under: the document's hash, the passage as
 * the verifier reads it, and a hash of the thread's texts in order (empty for
 * the first message; every message of a thread changes it), and — P3-02c — whether
 * the reply searched the web: the same thread answered with and without search
 * are two entries, so the memory never hands a plain reply to a request that
 * asked to search nor the reverse. A hash of all of it — nothing in it is a
 * reader's identity, and nothing of the passage or the thread can be read back
 * from it.
 */
export function explainCacheKey(docHash: string, passage: string, thread: readonly string[], searched = false): string {
  return sha256(`${docHash}|${normalizeForMatch(passage)}|${sha256(JSON.stringify(thread))}${searched ? "|search" : ""}`);
}

/** What the memory holds: a first answer, or (P3-02b) a reply turn — both
 *  verified, both under a hash key. */
export type ExplainCached = ExplainAnswer | ExplainReplyTurn;

export interface ExplainCache {
  get(key: string): ExplainCached | undefined;
  set(key: string, answer: ExplainCached): void;
  size(): number;
  clear(): void;
}

/**
 * In this process only: at most `max` verified answers (or replies) for at most
 * `ttlMs`, the oldest forgotten first. Holds answers and keys — never a
 * passage, never a reader.
 */
export function createExplainCache(
  options: { max?: number; ttlMs?: number; now?: () => number } = {},
): ExplainCache {
  const max = options.max ?? EXPLAIN_CAPS.cacheEntries;
  const ttlMs = options.ttlMs ?? EXPLAIN_CAPS.cacheTtlMs;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; answer: ExplainCached }>();
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
