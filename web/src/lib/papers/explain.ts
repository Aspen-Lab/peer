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
//     (the first answer, both of its parts) clipped to 841 characters and each later
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
// P3-07 (ruling §1h.9; user decision §1a.14) makes the answers short and exact —
// "never a long exposition unless the reader asks for one":
//
//   - `EXPLAIN_BREVITY_RULES`: the rule sentences both system prompts carry (the
//     fewest words that are exact, no preamble, never restate the question or where
//     the passage sits, no background beyond the passage, one idea a sentence, the
//     author's own phrase quoted, the reader's language);
//   - the caps are enforced here whatever the model wrote: a reply is three sentences
//     and 560 characters, or — when the reader asked for more, `detail` — eight and
//     1,400; every cut is made after a whole sentence, never inside one and never
//     inside a quotation (`wholeSentences`); a lone sentence over the cap is cut at a
//     word and marked with an ellipsis, the one place a cut is inside a sentence;
//   - `asksForDetail`: the reader's last message asking for more in words, English
//     and Chinese, whole words only — `details` counts, and a hyphen next to the word is not
//     a boundary ("detail-free" is not a request) (the route ORs it with the body's
//     `detail` flag, the "Say more" button);
//   - a reply may carry a small table, `items` (`sanitizeItems`: at most four rows, each
//     cell at most twelve words and eighty characters, a row over the cap dropped,
//     never cut), and a row stays only when its term occurs in the passage, its
//     paragraph, the neighbours or the section (`groundExplainItems`, run by
//     `verifyExplainReply` with the scope it is given); with a table the prose is two
//     sentences;
//   - P4-00c (§1h.11 (a)): the first answer may carry the same table — `sanitizeExplainAnswer`
//     shapes it with the same `sanitizeItems`, `verifyExplainAnswer` grounds it with the same
//     `groundExplainItems` — and with a table each of its two parts is one sentence (two
//     without); the first prompt asks for it when the passage holds two or more terms or
//     quantities worth a row, and for none otherwise;
//   - `explainCacheKey` carries the long form, so a short and a long reply to the same
//     message are two entries.
//
// Pure apart from the hash and the clock the cache reads: no I/O, no logging.
// Server-side — the browser imports this module for its types only.

import { createHash } from "node:crypto";
import { cleanDisplayText } from "@/lib/text/clean";
import { locateSection, normalizeForMatch, sectionCorpus } from "./evidence";
import type { ExtractedDocument } from "./html-text";
import { openingOf, readableSections } from "./reading-map";
import { splitSentences } from "./skim";

/** Each of the two parts of a first answer: at most this many characters. */
const PART_CHARS = 420;

export const EXPLAIN_CAPS = {
  /** A passage is at most this long, after whitespace is collapsed. */
  passageChars: 1200,
  /** Each of the two parts is at most two sentences and this many characters. */
  partChars: PART_CHARS,
  /** P4-00c (§1h.11 (a)): the sentences a part may have — two, or one when the first answer
   *  carries a term table (the table takes the terms; the parts say the placing and the point). */
  partSentences: 2,
  itemsPartSentences: 1,
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
   *  of its parts joined (each up to `partChars`) by one space, so it is read to this
   *  length — at 400 the model that writes a follow-up never saw "Why it is here".
   *  P4-00c (§1h.11 (a)): `2 * partChars + 1`, the space included; at `2 * partChars` a
   *  first answer with both parts at their cap lost its last word (the 841 edge). */
  firstAnswerChars: 2 * PART_CHARS + 1,
  /** A reply is at most three sentences and this many characters. */
  replySentences: 3,
  replyChars: 560,
  /** P3-07 (§1h.9 (2)): when the reader asked for more — the "Say more" button, or
   *  words that ask — a reply may run to this many sentences and characters. */
  replyDetailSentences: 8,
  replyDetailChars: 1400,
  /** P3-07 (§1h.9 (3)): a reply's table has at most this many rows, each cell at
   *  most this many words and characters (a row over a cap is dropped, never cut),
   *  and with a table the prose is at most this many sentences. */
  itemRows: 4,
  itemWords: 12,
  itemChars: 80,
  itemsReplySentences: 2,
} as const;

// ── The answer, and what the route says ────────────────────────────────

/** The two parts. `here.evidence` is the paper's own sentence, verified; when
 *  it is absent `here.peer` is true and the page labels the prose as Peer's.
 *
 *  P4-00c (§1h.11 (a)): the first answer may carry the same small term table as a reply,
 *  `items` — at most four rows the paper grounds; with one, each part is one sentence. */
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
  items?: ExplainItem[];
}

/** One message of a thread, as the client sends it: the first answer is the
 *  first `peer` message; the last one is the reader's. */
export interface ExplainMessage {
  role: "reader" | "peer";
  text: string;
}

/** One row of a reply's table (P3-07, §1h.9 (3)): a term from the passage, what it
 *  means in this paper, how to read it — each a dozen words at most. */
export interface ExplainItem {
  term: string;
  here: string;
  read: string;
}

/** The model's reply to the reader's last message, sanitised and not yet
 *  verified: its words and, when it rests on the paper, one sentence of it —
 *  and, P3-07, a small table of at most four rows. */
export interface ExplainReply {
  reply: string;
  evidence?: string;
  items?: ExplainItem[];
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
  /** P3-07: the table, only the rows the paper grounds (`groundExplainItems`). */
  items?: ExplainItem[];
  /** P3-07: this reply is the long form — the reader asked for more, by the button or
   *  in words (the route sets it; it is never in a first answer). */
  detail?: true;
}

/** What `POST /api/papers/[id]/explain` answers (the status says the rest). */
export type ExplainResult =
  | { answer: ExplainAnswer; cached: boolean }
  | { turn: ExplainReplyTurn; cached: boolean }
  | { unavailable: true }
  | { error: "not_in_paper" }
  | { error: "thread_full" };

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
 * message, which is the first answer with both of its parts and the space between them, to 841. Anything else — not an
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

/**
 * The rules that make an answer short and exact (P3-07, §1h.9 (1); user decision
 * §1a.14), in the system prompt of the first answer and of every reply. The box
 * already shows the passage with its section and page, so none of that is said
 * again; the reader came for the meaning, so nothing else is.
 */
export const EXPLAIN_BREVITY_RULES = [
  "Answer in the fewest words that are still exact.",
  "No preamble.",
  "Never restate the question or say where the passage sits; the reader's box already shows the passage with its section and page.",
  "Give no general background beyond what the passage needs.",
  "One idea per sentence.",
  "When the meaning turns on the author's own phrase, quote that phrase exactly as the text supplied has it.",
  "Write in the reader's language; the paper's own sentences stay as they are.",
] as const;

const EXPLAIN_SYSTEM = [
  "You are Peer, a calm research assistant who sits beside a reader.",
  "The reader selected a passage of a paper and asked what it means.",
  "Explain it in plain English, for a thoughtful reader who is not in this field: first what the term or passage means in general, then why the author brings it up in this paper.",
  ...EXPLAIN_BREVITY_RULES,
  // P4-00c (§1h.11 (a)): the owner's standard — a placing sentence, then the compact table.
  "When the passage holds two or more terms or quantities worth a row each, add a small table of them (`items`) and keep each of the two parts to one sentence; when it does not, give no table.",
  "Never quote the paper except with words copied character-for-character from the text supplied.",
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
      meaning: "at most two sentences (one sentence when `items` is present), in plain words, saying what the selected term or passage means in general, as a good textbook would, not specific to this paper",
      here: {
        text: "at most two sentences (one sentence when `items` is present), in plain words, saying why the author brings it up at this point of this paper",
        evidence: "one sentence copied character-for-character from the paper's text in `context` that shows the author using it here",
      },
      items:
        "optional — include it only when the passage holds two or more terms or quantities worth a row each, otherwise leave this key out: at most four rows, each { term, here, read }; `term` is a word or phrase copied from the passage, `here` what it means in this paper, `read` how to read it; each cell at most twelve words",
    },
    rules: [
      "Return ONLY valid JSON.",
      "Use plain words a thoughtful non-specialist understands; define nothing with another unexplained term.",
      "`here.evidence` is one sentence copied character-for-character from `context.before`, `context.paragraph` or `context.after`. Do not paraphrase it, shorten it, or merge sentences.",
      "Omit `evidence` when no such sentence shows the author using it. Never quote the abstract or the section list; they are there for orientation only.",
      "With `items`, `meaning` and `here.text` are one sentence each: `meaning` quotes the author's own phrase when the meaning turns on it, and you leave the terms to the table.",
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
  ...EXPLAIN_BREVITY_RULES,
  "Never quote the paper except with words copied character-for-character from the text supplied.",
  "Do not fabricate numbers, citations or experimental details.",
  "Return only valid JSON.",
].join(" ");

/**
 * The system and user prompts for one reply in a thread (P3-02b): the same
 * bounded context as the first message, then the thread in order — each message
 * labelled by its role, at most 17, the first (the first answer) at most 841
 * characters and each later one at most 400, the latest kept — and the reader's
 * last message named as the one to answer, then the schema
 * and the rules, which are never what gets cut. Nothing about the reader is a
 * parameter but the words they sent in the thread. With `search` (P3-02c) the
 * one rule about the web is the search rule; nothing else changes.
 *
 * P3-07: the prompt names the cap that applies — three sentences and 560 characters,
 * or, with `detail` (the reader asked for more), eight and 1,400 — and offers the
 * optional table, `items`, for a reader who asks about several terms or quantities.
 * `detail` changes the cap and nothing else.
 */
export function buildExplainReplyPrompt(args: {
  paper: { title: string; abstract: string };
  map: readonly ExplainMapLine[];
  located: Pick<LocatedPassage, "paragraph" | "before" | "after">;
  passage: string;
  thread: readonly ExplainMessage[];
  /** P3-02c: this reply may use web search for general background. */
  search?: boolean;
  /** P3-07: the reader asked for more, so the reply may run to the long cap. */
  detail?: boolean;
}): { systemPrompt: string; userPrompt: string } {
  // The cap follows the message's place in the thread as sent: the first answer
  // keeps its 841 only while it is in the prompt, and once the oldest are dropped
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
      reply: args.detail
        ? "at most eight sentences and 1,400 characters, in plain words, answering the reader's last message about this passage; the reader asked for more, so give the detail they asked for"
        : "at most three sentences and 560 characters, in plain words, answering the reader's last message about this passage",
      evidence: "one sentence copied character-for-character from the paper's text in `context`, only when the reply rests on something the paper says; otherwise leave this key out",
      items:
        "optional — leave this key out unless the reader asks what several terms or quantities mean: at most four rows, each { term, here, read }; `term` is a word or phrase copied from the passage, `here` what it means in this paper, `read` how to read it; each cell at most twelve words",
    },
    rules: [
      "Return ONLY valid JSON.",
      args.detail
        ? "Answer `lastReaderMessage`, the reader's last message in `thread`, about the selected passage, in plain words a thoughtful non-specialist understands. The reader asked for more, so `reply` may run to at most eight sentences and 1,400 characters; still no preamble and one idea per sentence. The earlier messages are there for what has been said so far."
        : "Answer `lastReaderMessage`, the reader's last message in `thread`, about the selected passage, in at most three sentences (560 characters) of plain words a thoughtful non-specialist understands; the reader has not asked for more. The earlier messages are there for what has been said so far.",
      "With `items`, `reply` is at most two sentences: say what the passage reports, quoting the author's own phrase, and leave the terms to the table.",
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

// ── Whole sentences (P3-07) ────────────────────────────────────────────
// A cap on an answer's length is a cap on how much Peer says, not a cut through
// the middle of what it says: an answer is the leading sentences that fit, and a
// sentence is never left half. A quotation is never left half either — the author's
// phrase `“Grain 0.4. Cell 0.57”` is two sentences to a splitter and one thought to a
// reader, so the sentences of an open quotation go together or not at all.

/** Where a Chinese sentence ends: after 。！？ and any closing quote or bracket, before
 *  what follows (so "！？" stays one ending) — and after an ASCII "!" or "?" that the cleaner
 *  made of a full-width one, when Chinese text follows. The Latin splitter sees neither. */
const CJK_SENTENCE_BREAK = /(?<=[。！？][”’」』）)]*)(?=[^。！？”’」』）)\s])|(?<=[!?])(?=\p{Script=Han})/u;

/** The offset after the last character of each sentence of `text` (white space already
 *  collapsed): Chinese enders first, then the Latin splitter the rest of Peer uses. */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  let cursor = 0;
  for (const piece of text.split(CJK_SENTENCE_BREAK).flatMap(splitSentences)) {
    const at = text.indexOf(piece, cursor);
    if (at < 0) continue;
    cursor = at + piece.length;
    ends.push(cursor);
  }
  if (ends.length > 0) ends[ends.length - 1] = text.length;
  return ends;
}

/** Whether `text` ends inside a quotation: a double quote opened and not closed. */
function inQuotation(text: string): boolean {
  const straight = (text.match(/"/g) ?? []).length % 2 === 1;
  return straight || (text.match(/[“「『]/g) ?? []).length > (text.match(/[”」』]/g) ?? []).length;
}

interface SentenceGroup {
  end: number;
  sentences: number;
}

/** The sentences as groups that never end inside a quotation: those of a quotation that
 *  closes later in the text are one group. A quotation the text never closes holds nothing together. */
function quoteSafeGroups(text: string, ends: readonly number[]): SentenceGroup[] {
  const groups: SentenceGroup[] = [];
  let start = 0;
  for (let i = 0; i < ends.length; ) {
    let j = i;
    while (j < ends.length && inQuotation(text.slice(start, ends[j]))) j += 1;
    if (j >= ends.length) j = i;
    groups.push({ end: ends[j], sentences: j - i + 1 });
    start = ends[j];
    i = j + 1;
  }
  return groups;
}

/** `text` cut at a word to fit `max` characters, the cut marked with an ellipsis. */
function cutMarked(text: string, max: number): string {
  const room = max - 1;
  const space = text.lastIndexOf(" ", room);
  const cut = (space > 0 ? text.slice(0, space) : text.slice(0, room)).trimEnd().replace(/[,;:\u2013\u2014-]+$/u, "");
  return `${cut}…`;
}

/**
 * The leading whole sentences of `cleaned` — at most `maxSentences` of them and at
 * most `maxChars` characters — and nothing of the rest. A quotation is not split. When
 * not even the first sentence fits, that one sentence is cut at a word and the cut is
 * marked with "…": the only case in which Peer's words end inside a sentence, and it says so.
 */
function wholeSentences(cleaned: string, maxSentences: number, maxChars: number): string {
  if (!cleaned) return "";
  const ends = sentenceEnds(cleaned);
  const fitting = (groups: readonly SentenceGroup[]): number => {
    let kept = 0;
    let count = 0;
    for (const group of groups) {
      if (count + group.sentences > maxSentences || group.end > maxChars) break;
      count += group.sentences;
      kept = group.end;
    }
    return kept;
  };
  const grouped = fitting(quoteSafeGroups(cleaned, ends));
  if (grouped > 0) return cleaned.slice(0, grouped).trimEnd();
  // A quotation that does not fit whole is left out, as far as one sentence on its own fits.
  const plain = fitting(ends.map((end) => ({ end, sentences: 1 })));
  if (plain > 0) return cleaned.slice(0, plain).trimEnd();
  return cutMarked(cleaned.slice(0, ends[0] ?? cleaned.length), maxChars);
}

/** `cleanDisplayText`, but a bare underscore stays: it reads `f_cell` as a LaTeX subscript and
 *  hands back `fcell`, and the author's own notation is the thing an exact answer quotes. */
function tidy(text: string): string {
  return cleanDisplayText(text.replace(/_/g, "\uE000")).replace(/\uE000/g, "_");
}

/** Some of the model's words: cleaned, at most `sentences` whole sentences, at most `chars` characters. */
function words(value: unknown, sentences: number, chars: number): string {
  if (typeof value !== "string") return "";
  return wholeSentences(tidy(value).replace(/\s+/g, " ").trim(), sentences, chars);
}

/** One part of the answer: cleaned, at most `sentences` whole sentences (two, or one with a table),
 *  at most 420 characters. */
function part(value: unknown, sentences: number = EXPLAIN_CAPS.partSentences): string {
  return words(value, sentences, EXPLAIN_CAPS.partChars);
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
 *
 * P4-00c (§1h.11 (a)): the first answer may carry the reply's own table — `items`, shaped by
 * the same `sanitizeItems` (at most four rows, each cell a dozen words and eighty characters,
 * a row over a cap dropped, never cut) — and with a table each part is one sentence, as a
 * reply's prose is two (the table takes the terms). Without one, or when the shape sanitiser
 * empties it, the parts keep their two sentences. Whether a row is the paper's is the
 * verifier's question (`verifyExplainAnswer`).
 */
export function sanitizeExplainAnswer(raw: unknown): ExplainAnswer | null {
  if (!isRecord(raw) || !isRecord(raw.here)) return null;
  const items = sanitizeItems(raw.items);
  const sentences = items.length > 0 ? EXPLAIN_CAPS.itemsPartSentences : EXPLAIN_CAPS.partSentences;
  const meaning = part(raw.meaning, sentences);
  const text = part(raw.here.text, sentences);
  if (!meaning || !text) return null;
  const evidence = quoteAsSent(raw.here.evidence);
  return { meaning, here: evidence ? { text, evidence } : { text }, ...(items.length > 0 ? { items } : {}) };
}

/** The quote as the model sent it, for the verifier to match and the page to show: white space
 *  collapsed, at most 400 characters — and NOT cleaned. P4-00c (§1h.11 (d)): the cleaner turns the
 *  author's `f_cell` into `fcell` (it reads the underscore as a LaTeX subscript), so cleaning
 *  the quote here made the page show notation the paper does not have. The verifier matches on the
 *  cleaned forms (`normalizeForMatch` cleans both sides) and `displayQuote` decides what is shown. */
function quoteAsSent(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, EXPLAIN_CAPS.evidenceChars).trim() : "";
}

/** The most tokens of a section the alignment below will read: a quote is looked for in one section. */
const ALIGN_MAX_TOKENS = 40000;

/**
 * The paper's own characters for a quote that matched after cleaning but is not verbatim in the
 * section (it lost an underscore, changed case, dropped a citation): the run of the section's
 * words whose cleaned forms are the quote's cleaned words, one for one. Each word of the section
 * (white space already collapsed) is cleaned on its own; one that cleans to nothing — a citation
 * bracket — is passed over; one that cleans to several (`≤0.2` is `<=` and `0.2`) counts as
 * several. Null when no run lines up (a citation or a line-break hyphen spanning words cleans
 * differently one word at a time; Chinese has no words to line up) — the caller then falls back.
 */
function alignedOriginal(quote: string, flatSection: string): string | null {
  const wanted = normalizeForMatch(quote).split(" ").filter(Boolean);
  if (wanted.length === 0) return null;
  const tokens = flatSection.split(" ").filter(Boolean);
  if (tokens.length > ALIGN_MAX_TOKENS) return null;
  const parts: Array<{ word: string; at: number }> = [];
  tokens.forEach((token, at) => {
    for (const word of normalizeForMatch(token).split(" ")) if (word) parts.push({ word, at });
  });
  for (let start = 0; start + wanted.length <= parts.length; start += 1) {
    if (parts[start].word !== wanted[0]) continue;
    let k = 1;
    while (k < wanted.length && parts[start + k].word === wanted[k]) k += 1;
    if (k < wanted.length) continue;
    const span = tokens.slice(parts[start].at, parts[start + wanted.length - 1].at + 1).join(" ");
    return span.length <= EXPLAIN_CAPS.evidenceChars * 2 ? span : null;
  }
  return null;
}

/**
 * What a verified quote shows (P4-00c, §1h.11 (d)): the paper's own characters. In order — the
 * model's copy, when it is verbatim in the section (white space collapsed), which is the paper's
 * text by construction; else the paper's words found by lining up the cleaned words
 * (`alignedOriginal`), so a copy that lost an underscore or changed case still shows `f_cell` and
 * `α_1` as the paper has them; else, only when neither can be done, the model's own words
 * cleaned — with the underscore kept, as the prose and the table keep it (`tidy`).
 */
function displayQuote(quote: string, sectionText: string): string {
  const flat = sectionText.replace(/\s+/g, " ");
  if (flat.includes(quote)) return quote;
  return alignedOriginal(quote, flat) ?? tidy(quote).replace(/\s+/g, " ").trim().slice(0, EXPLAIN_CAPS.evidenceChars).trim();
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
    evidence: displayQuote(evidence, section.text),
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
 *
 * P4-00c: the table's rows are held to the paper as a reply's are (`groundExplainItems`, the
 * same function), in the `scope` the route gives — the passage and where it was found. Without
 * a scope there is nothing to hold a row to, so none is kept; with every row dropped the answer
 * has no `items`.
 */
export function verifyExplainAnswer(answer: ExplainAnswer, doc: ExtractedDocument, preferSectionId?: string, scope?: ExplainItemScope): ExplainAnswer {
  const { meaning, here } = answer;
  const placed = here.evidence ? placeQuote(here.evidence, doc, preferSectionId) : null;
  const verified: ExplainAnswer = placed ? { meaning, here: { text: here.text, ...placed } } : { meaning, here: { text: here.text, peer: true } };
  const items = answer.items && scope ? groundExplainItems(answer.items, doc, scope) : [];
  return items.length > 0 ? { ...verified, items } : verified;
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

// ── The term table (P3-07) ─────────────────────────────────────────────

const HAN_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/** A cell's length in words: runs of text between spaces, and Chinese or Japanese
 *  characters two to a word (they are written without spaces, and a dozen words of
 *  them is about two dozen characters — never looser than the 80-character cap). */
function wordCount(text: string): number {
  const cjk = text.match(HAN_OR_KANA)?.length ?? 0;
  const rest = text.replace(HAN_OR_KANA, " ").split(/\s+/).filter(Boolean).length;
  return rest + Math.ceil(cjk / 2);
}

/** One cell: cleaned, a web address taken out, within the caps — or "" (the row goes). Never cut. */
function itemCell(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = tidy(withoutWebAddresses(value)).replace(/\s+/g, " ").trim();
  if (!text || text.length > EXPLAIN_CAPS.itemChars || wordCount(text) > EXPLAIN_CAPS.itemWords) return "";
  return text;
}

/**
 * The model's table as the page may show it: at most four rows of `{ term, here, read }`,
 * each cell within a dozen words and eighty characters. A row with a cell over a cap, or
 * with a cell missing, is dropped — not cut; a term already in the table is not repeated
 * (say it once). Whether the term is the paper's is the verifier's question, not this one's.
 */
function sanitizeItems(raw: unknown): ExplainItem[] {
  if (!Array.isArray(raw)) return [];
  const rows: ExplainItem[] = [];
  const seen = new Set<string>();
  for (const row of raw as unknown[]) {
    if (!isRecord(row)) continue;
    const term = itemCell(row.term);
    const here = itemCell(row.here);
    const read = itemCell(row.read);
    if (!term || !here || !read) continue;
    const key = normalizeForMatch(term);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ term, here, read });
    if (rows.length === EXPLAIN_CAPS.itemRows) break;
  }
  return rows;
}

/**
 * Whitelist what the model sent as a reply: its words, cleaned, at most three whole
 * sentences and 560 characters — or, with `detail` (the reader asked for more), eight
 * and 1,400, and with a table two sentences either way (P3-07) — cut after a sentence,
 * never inside one; the quote a cleaned string of at most 400 characters, which the
 * sentence cap never touches; and the table, shaped (`sanitizeItems`). Whatever else the
 * model said — a place, a page, a "peer" flag — is dropped: only the verifier says where a
 * quote sits and which rows the paper grounds. Null without words.
 */
export function sanitizeExplainReply(raw: unknown, options: { detail?: boolean } = {}): ExplainReply | null {
  if (!isRecord(raw)) return null;
  const detail = options.detail === true;
  const items = sanitizeItems(raw.items);
  const sentences = items.length > 0 ? EXPLAIN_CAPS.itemsReplySentences : detail ? EXPLAIN_CAPS.replyDetailSentences : EXPLAIN_CAPS.replySentences;
  const chars = detail ? EXPLAIN_CAPS.replyDetailChars : EXPLAIN_CAPS.replyChars;
  const reply = words(typeof raw.reply === "string" ? withoutWebAddresses(raw.reply) : raw.reply, sentences, chars);
  if (!reply) return null;
  const evidence = quoteAsSent(raw.evidence);
  return { reply, ...(evidence ? { evidence } : {}), ...(items.length > 0 ? { items } : {}) };
}

/** Where a table's terms must be found: the passage the reader selected and the paragraph
 *  around it, its neighbours and the section it sits in (`located`). */
export interface ExplainItemScope {
  passage: string;
  located: Pick<LocatedPassage, "sectionId" | "paragraph" | "before" | "after">;
}

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Letters and digits of the scripts a paper's terms are written in; Chinese and Japanese
 *  have no word boundaries, so they never make a "longer word". */
const WORD_CHAR = "[\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}\\p{N}]";
const isWordChar = (char: string | undefined): boolean => char !== undefined && new RegExp(`^${WORD_CHAR}$`, "u").test(char);

/** Whether `term` occurs in `haystack` (both already normalised) as a word or phrase — not
 *  inside a longer word or number: "auge" is not in "gauge", "0.5" is not in "10.55". */
function occursAsWords(term: string, haystack: string): boolean {
  if (!term) return false;
  const chars = [...term];
  const before = isWordChar(chars[0]) ? `(?<!${WORD_CHAR})` : "";
  const after = isWordChar(chars[chars.length - 1]) ? `(?!${WORD_CHAR})` : "";
  return new RegExp(`${before}${escapeForRegExp(term)}${after}`, "u").test(haystack);
}

/**
 * The rows of a table the paper stands behind (P3-07, §1h.9 (3)): a row stays only when its
 * term occurs — after `normalizeForMatch` on both sides, so case, white space and a hyphenated
 * line break do not matter — in the passage, its paragraph, the paragraphs on either side of
 * it, or the section it sits in. A term found nowhere there is the model's, not the paper's:
 * the row goes. Order kept; nothing in the rows changed.
 */
export function groundExplainItems(items: readonly ExplainItem[], doc: ExtractedDocument, scope: ExplainItemScope): ExplainItem[] {
  const { located, passage } = scope;
  const section = sectionCorpus(doc).find((entry) => entry.id === located.sectionId)?.text ?? "";
  const haystacks = [passage, located.paragraph, located.before ?? "", located.after ?? ""].map(normalizeForMatch);
  haystacks.push(section);
  return items.filter((item) => {
    const term = normalizeForMatch(item.term);
    return term !== "" && haystacks.some((haystack) => occursAsWords(term, haystack));
  });
}

/**
 * Hold a reply's quote to the paper exactly as the first answer's is held:
 * found whole in one section, the place set from the document; otherwise — or
 * with no quote at all — the quote goes and `peer: true` says the page labels
 * the prose as Peer's own reading. The reply given is not changed.
 *
 * P3-07: the table's rows are held to the paper too (`groundExplainItems`), in the `scope`
 * the route gives — the passage and where it was found. Without a scope there is nothing
 * to hold a row to, so none is kept; with every row dropped the turn has no `items`.
 */
export function verifyExplainReply(reply: ExplainReply, doc: ExtractedDocument, preferSectionId?: string, scope?: ExplainItemScope): ExplainReplyTurn {
  const placed = reply.evidence ? placeQuote(reply.evidence, doc, preferSectionId) : null;
  const turn: ExplainReplyTurn = placed ? { role: "peer", text: reply.reply, ...placed } : { role: "peer", text: reply.reply, peer: true };
  const items = reply.items && scope ? groundExplainItems(reply.items, doc, scope) : [];
  return items.length > 0 ? { ...turn, items } : turn;
}

// ── Asking for more (P3-07) ────────────────────────────────────────────

/** A hyphen, in any of its three common forms (hyphen-minus, hyphen, non-breaking hyphen). */
const HYPHENS = "\\-\\u2010\\u2011";
/** English: whole words, any case. "more" counts only in "tell me more", "say more" and
 *  "more detail(s)" — "are there more papers?" is not a request for detail. P4-00c (§1h.11 (c)): the
 *  plural `details` counts ("give me the details"), and a hyphen next to the word is NOT a word
 *  boundary — "detail-free" and "non-detailed" are not requests; a hyphen inside a phrase the list
 *  names ("in-depth", "step-by-step") still joins its words. */
const DETAIL_ENGLISH = new RegExp(
  `(?<![\\p{L}\\p{N}${HYPHENS}])(?:detail|details|detailed|in[\\s${HYPHENS}]+depth|elaborate|expand|step[\\s${HYPHENS}]+by[\\s${HYPHENS}]+step|tell\\s+me\\s+more|say\\s+more|more\\s+details?)(?![\\p{L}\\p{N}${HYPHENS}])`,
  "iu",
);
/** Chinese has no word boundaries: the words are looked for as they stand. */
const DETAIL_CHINESE = /详细|展开|具体|深入|多说|讲讲/u;

/**
 * Whether a message asks Peer for more than a short answer, in words (§1h.9 (2)): detail,
 * details, detailed, in depth, elaborate, expand, step by step, tell me more, say more, more detail —
 * 详细, 展开, 具体, 深入, 多说, 讲讲. The route ORs it with the body's `detail` flag (the
 * "Say more" button); a message that only mentions more of something is not one.
 */
export function asksForDetail(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return DETAIL_ENGLISH.test(message) || DETAIL_CHINESE.test(message);
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
 * asked to search nor the reverse. P3-07: and whether the reply is the long form (the
 * reader asked for more), so a short and a long reply to the same message are two entries.
 * A hash of all of it — nothing in it is a reader's identity, and nothing of the passage or
 * the thread can be read back from it.
 */
export function explainCacheKey(docHash: string, passage: string, thread: readonly string[], searched = false, detail = false): string {
  return sha256(`${docHash}|${normalizeForMatch(passage)}|${sha256(JSON.stringify(thread))}${searched ? "|search" : ""}${detail ? "|detail" : ""}`);
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
