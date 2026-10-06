// Paragraph gists (P3-03; ruling §1h.6; user decision §1a.8; §3d 5, Tier 2
// half): under each section the map lists one line per paragraph — the
// paragraph's own opening, the paper's words, verbatim (Tier 0, `openingOf`).
// This is Peer's line after it: one gist of at most twelve words, condensed
// from that opening — which the prompt names as the paragraph's topic sentence
// — and the paragraph itself, in plain words.
//
// The model is asked for every gist at once, one small call per document; the
// server keeps only what it can stand behind:
//
//   - `gistCandidates`: the paragraphs the pass is asked about — exactly the
//     body's paragraphs that have an opening, with their place (`sectionId`,
//     `paragraphIndex`) the way the map names it, so a gist lands on the line
//     it belongs to;
//   - `buildParagraphGuidePrompt`: the paper's title and the candidates in
//     document order, each bounded; nothing about the reader is a parameter;
//   - `sanitizeParagraphGuide`: whitelists the schema, keeps only an entry that
//     names a candidate, cleans the words, and DROPS (never cuts) a gist over
//     twelve words or 120 characters;
//   - `groundedGist` / `verifyParagraphGuide`: a gist must share at least two
//     content words with its own paragraph, or it is dropped — a line the paper
//     does not support is no line;
//   - the memory (`createParagraphGuideCache`) is keyed by the document's hash
//     alone and holds the finished guide: nothing about a reader is in a key or
//     an entry (§1g.4).
//
// The gist is Peer's, never the paper's: the page labels it (`PEERS_READING`)
// and never lets it replace, shorten or restyle the opening.
//
// Pure — no I/O, no `node:` import, no logging — so the browser may import it;
// today it imports types only. The hash is the route's (`explainDocHash`).

import { cleanDisplayText } from "@/lib/text/clean";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import { normalizeForMatch } from "./evidence";
import type { ExtractedDocument } from "./html-text";
import { openingOf, readableSections } from "./reading-map";

export const GUIDE_CAPS = {
  /** A paragraph is sent clipped to this many characters, at a word. */
  paragraphChars: 1200,
  /** More candidate paragraphs than this and the pass is skipped. */
  maxParagraphs: 120,
  /** A gist is at most this many words and this many characters — over either, it is dropped. */
  gistWords: 12,
  gistChars: 120,
  titleChars: 300,
  /** A gist must share this many distinct content words with its paragraph. */
  sharedWords: 2,
  /** A content word has at least this many letters. */
  wordLetters: 4,
  /** The server's memory of guides: how many documents, and for how long. */
  cacheEntries: 32,
  cacheTtlMs: 60 * 60 * 1000,
} as const;

/** The gists of one document: `gists[sectionId][paragraphIndex]`. Over the wire
 *  the index is a string key; indexing with the number is the same. */
export type GistRecord = Record<string, Record<number, string>>;

/** What `POST /api/papers/[id]/paragraph-guide` answers a guide with. */
export interface ParagraphGuide {
  docHash: string;
  gists: GistRecord;
}

/** What the route says (the status says the rest). `skipped`: the document has
 *  more paragraphs than the pass takes; `unavailable`: no model could write, or
 *  it said nothing usable. */
export type ParagraphGuideResult =
  | { guide: ParagraphGuide; cached: boolean }
  | { skipped: "too_many_paragraphs" }
  | { unavailable: true; quota?: QuotaSignal };

// ── The paragraphs the pass is asked about ─────────────────────────────

export interface GistCandidate {
  /** The section's id and its place in the rendered body (`reading.body[k]`). */
  sectionId: string;
  sectionIndex: number;
  /** The paragraph's index in the body section — the map's `index`. */
  paragraphIndex: number;
  /** The paragraph's opening, as the map holds it: the paper's words, verbatim. */
  opening: string;
  /** The paragraph as the body renders it, clipped to 1,200 characters at a word. */
  paragraph: string;
}

/** `text` cut to at most `max` characters, at the last space when there is one. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const space = text.lastIndexOf(" ", max);
  return (space > 0 ? text.slice(0, space) : text.slice(0, max)).trimEnd();
}

/**
 * Every paragraph of the rendered body that has an opening, in reading order —
 * the paragraphs the map shows a line for, and so the only ones a gist can
 * belong to. The abstract is not part of the body, and a paragraph whose
 * sentences are all field openers has no opening and no candidate.
 */
export function gistCandidates(doc: ExtractedDocument): GistCandidate[] {
  const out: GistCandidate[] = [];
  readableSections(doc).forEach(({ id, paragraphs }, sectionIndex) => {
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const opening = openingOf(paragraph);
      if (opening === null) return;
      out.push({ sectionId: id, sectionIndex, paragraphIndex, opening, paragraph: cutAtWord(paragraph, GUIDE_CAPS.paragraphChars) });
    });
  });
  return out;
}

/** More than 120 candidate paragraphs: the pass is skipped and the client asks nothing more. */
export function tooManyParagraphs(doc: ExtractedDocument): boolean {
  return gistCandidates(doc).length > GUIDE_CAPS.maxParagraphs;
}

// ── The prompt ─────────────────────────────────────────────────────────

const GUIDE_SYSTEM = [
  "You are Peer, a calm research assistant who sits beside a reader.",
  "For each paragraph of a paper you write one very short gist, so the reader can see what the paragraph is about before reading it.",
  "A paragraph's first sentences are its topic sentence: condense the gist from it, using the rest of the paragraph only to check it.",
  "Never quote the paper at length. Do not fabricate facts, numbers or citations.",
  "Return only valid JSON.",
].join(" ");

/**
 * The system and user prompts for the one pass: the paper's title, the
 * candidates in document order — each with its topic sentence (the opening) and
 * its text, at most 1,200 characters, at most 120 of them — then the schema and
 * the rules, which are never what gets cut. The only inputs are the title and
 * the candidates, so nothing about the reader can be in it.
 */
export function buildParagraphGuidePrompt(args: {
  paper: { title: string };
  candidates: readonly GistCandidate[];
}): { systemPrompt: string; userPrompt: string } {
  const userPrompt = JSON.stringify({
    task: "Write one gist for every paragraph in `paragraphs`.",
    paper: { title: cutAtWord(cleanDisplayText(args.paper.title), GUIDE_CAPS.titleChars) },
    paragraphs: args.candidates.slice(0, GUIDE_CAPS.maxParagraphs).map((candidate) => ({
      sectionId: candidate.sectionId,
      paragraphIndex: candidate.paragraphIndex,
      topicSentence: candidate.opening,
      text: cutAtWord(candidate.paragraph, GUIDE_CAPS.paragraphChars),
    })),
    outputSchema: {
      gists: [
        {
          sectionId: "copied from the paragraph",
          paragraphIndex: "copied from the paragraph, a number",
          gist: "at most 12 words, in plain words, saying what the paragraph is about",
        },
      ],
    },
    rules: [
      "Return ONLY valid JSON of the shape in `outputSchema`: one entry per paragraph, in order, `sectionId` and `paragraphIndex` copied exactly from the paragraph.",
      `Each \`gist\` is at most ${GUIDE_CAPS.gistWords} words of plain English, condensed from that paragraph's \`topicSentence\` (its topic sentence) and checked against its \`text\`.`,
      "Add no new facts, and no number, name or claim the paragraph does not state. Reuse the paragraph's own key words.",
      "Do not copy the topic sentence; say it shorter. No LaTeX, no links, no advice, no verdict on whether the reader should read the paragraph.",
      "Leave a paragraph out rather than guess.",
    ],
  });
  return { systemPrompt: GUIDE_SYSTEM, userPrompt };
}

/**
 * How many tokens the answer may take: a gist entry is about forty tokens with
 * its keys, so the allowance grows with the paragraphs asked about — a fixed
 * small one would cut the JSON off mid-list on a real paper and lose every gist.
 */
export function gistMaxTokens(paragraphs: number): number {
  return Math.min(8000, Math.max(600, 200 + 45 * Math.max(0, Math.floor(paragraphs))));
}

// ── The answer ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The paragraph index an entry names: a whole number, or a string of digits. */
function indexOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

/** A gist the page may show: cleaned, whitespace collapsed, at most twelve words
 *  and 120 characters — or null. Over either limit it is dropped, never cut. */
function cleanGist(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const gist = cleanDisplayText(value).replace(/\s+/g, " ").trim();
  if (!gist || gist.length > GUIDE_CAPS.gistChars) return null;
  if (gist.split(" ").length > GUIDE_CAPS.gistWords) return null;
  return gist;
}

/**
 * Whitelist what the model sent into `{ [sectionId]: { [paragraphIndex]: gist } }`:
 * only an entry that names a candidate (an unknown section, a paragraph with no
 * opening or an index that is not a whole number are dropped), with a gist of
 * words, at most twelve and 120 characters. When the model names a paragraph more
 * than once, the first GROUNDED gist (`groundedGist`, in that paragraph) wins
 * (P3-05, §1h.8 (4)): a gist the paragraph does not support never keeps a grounded
 * one out, and a later grounded gist never replaces an earlier grounded one. With
 * none grounded the first is kept, for `verifyParagraphGuide` to drop.
 * Anything that is not the schema is no guide: `{}`.
 */
export function sanitizeParagraphGuide(raw: unknown, candidates: readonly GistCandidate[]): GistRecord {
  const out: GistRecord = {};
  if (!isRecord(raw) || !Array.isArray(raw.gists)) return out;
  const paragraphs = new Map(candidates.map((candidate) => [`${candidate.sectionId}\u0000${candidate.paragraphIndex}`, candidate.paragraph]));
  for (const item of raw.gists as unknown[]) {
    if (!isRecord(item) || typeof item.sectionId !== "string") continue;
    const index = indexOf(item.paragraphIndex);
    const paragraph = index === null ? undefined : paragraphs.get(`${item.sectionId}\u0000${index}`);
    if (index === null || paragraph === undefined) continue;
    const gist = cleanGist(item.gist);
    if (gist === null) continue;
    const section = (out[item.sectionId] ??= {});
    const kept = section[index];
    if (kept === undefined || (!groundedGist(kept, paragraph) && groundedGist(gist, paragraph))) section[index] = gist;
  }
  return out;
}

// ── Grounding ──────────────────────────────────────────────────────────

/** Words that carry no content however long they are: function words, and the
 *  verbs a gist and a paper both lean on ("shows", "using"). */
const STOPWORDS = new Set(
  (
    "about above after again against also although always among another around because been before being below between both " +
    "could does done down during each either else even ever every from further have having here hers herself himself however " +
    "into itself just like made make many might more most much must neither none nor once only other others ought over " +
    "same shall should since some such than that their theirs them themselves then there therefore these they this those " +
    "though through thus under until upon used uses using very were what when where whether which while whom whose will " +
    "with within without would yours yourself paper papers study studies section sections author authors show shows shown " +
    "describe describes described explain explains explained discuss discusses discussed present presents presented"
  ).split(" "),
);

/** The content words of some text, as the verifier reads it (`normalizeForMatch`:
 *  case, Unicode, citations and a hyphenated line break folded): runs of at least
 *  four letters that are not stopwords. A hyphenated compound counts as the one
 *  word the fold makes of it and as the words it is made of. */
function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  const letters = new RegExp(`\\p{L}{${GUIDE_CAPS.wordLetters},}`, "gu");
  for (const view of [normalizeForMatch(text), normalizeForMatch(text.replace(/[-‐‑‒–—―−]/g, " "))]) {
    for (const word of view.match(letters) ?? []) {
      if (!STOPWORDS.has(word)) words.add(word);
    }
  }
  return words;
}

/**
 * Whether a gist is grounded in its paragraph: it shares at least two distinct
 * content words with it (four letters or more, not a stopword). A gist the
 * paragraph does not support is not Peer reading this paragraph at all.
 */
export function groundedGist(gist: string, paragraph: string): boolean {
  const mine = contentWords(gist);
  if (mine.size === 0) return false;
  const theirs = contentWords(paragraph);
  let shared = 0;
  for (const word of mine) {
    if (theirs.has(word) && ++shared >= GUIDE_CAPS.sharedWords) return true;
  }
  return false;
}

/** Drop every gist that is not grounded in its own paragraph, and every entry
 *  that names no candidate; a section left with none is left out. */
export function verifyParagraphGuide(guide: GistRecord, candidates: readonly GistCandidate[]): GistRecord {
  const paragraphs = new Map(candidates.map((candidate) => [`${candidate.sectionId}\u0000${candidate.paragraphIndex}`, candidate.paragraph]));
  const out: GistRecord = {};
  for (const [sectionId, section] of Object.entries(guide)) {
    for (const [index, gist] of Object.entries(section)) {
      const paragraph = paragraphs.get(`${sectionId}\u0000${index}`);
      if (paragraph === undefined || !groundedGist(gist, paragraph)) continue;
      (out[sectionId] ??= {})[Number(index)] = gist;
    }
  }
  return out;
}

// ── The server's memory (§1g.4) ────────────────────────────────────────

export interface ParagraphGuideCache {
  get(docHash: string): ParagraphGuide | undefined;
  set(docHash: string, guide: ParagraphGuide): void;
  size(): number;
  clear(): void;
}

/**
 * In this process only: at most `max` finished guides for at most `ttlMs`, the
 * oldest forgotten first, keyed by the document's hash and nothing else. A
 * guide is a gist for each of some paragraphs of the document — there is no
 * reader, question or passage in it, so one reader's guide can only ever be
 * another's hit for the same document.
 */
export function createParagraphGuideCache(
  options: { max?: number; ttlMs?: number; now?: () => number } = {},
): ParagraphGuideCache {
  const max = options.max ?? GUIDE_CAPS.cacheEntries;
  const ttlMs = options.ttlMs ?? GUIDE_CAPS.cacheTtlMs;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; guide: ParagraphGuide }>();
  return {
    get(docHash) {
      const hit = entries.get(docHash);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        entries.delete(docHash);
        return undefined;
      }
      return hit.guide;
    },
    set(docHash, guide) {
      entries.delete(docHash);
      entries.set(docHash, { at: now(), guide });
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
export const paragraphGuideCache: ParagraphGuideCache = createParagraphGuideCache();
