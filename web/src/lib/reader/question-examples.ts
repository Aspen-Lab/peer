// The example tags under "Before you read" (P1-09; user decision §1a.7,
// ruling §1f.20).
//
// Every example is the reader's own: a question they wrote on an earlier
// paper, or their profile — challenges, project, topics, methods — asked as a
// question by a fixed English template (`ASK.examples`). Nothing generic and
// nothing invented; a reader with no profile and no earlier questions gets
// no examples at all. Pure: the page builds them from its two stores.
//
// An example only ever fills a line when the reader clicks it, and it is a
// question like any other once there — it settles with the box as a whole
// (§1g.18), like every question the reader types.
//
// P1-09b (§1f.20 amendment): the challenges and the project are asked by
// their multi-word phrases — a single keyword ("growth") makes a vague,
// odd-sounding example — and fall back to one single word only when the text
// has no multi-word phrase at all. Topics and methods are the reader's own
// entries and stay as typed. Each source has its own cap, so every source
// gets a slot before the total of eight.
//
// P1-09c (§1f.20 (5)): `phrasesFromText` calls any chunk of ten words or fewer
// a phrase, so a sentence ("We test sulfide electrolytes") could become an
// example, and a one-sentence text fell back to a keyword that routes on
// nothing ("Does this help with study?"). A multi-word phrase is now offered
// only when it has two to six words and none of them is a pronoun or an
// auxiliary; the single-word fallback only when its finished question has a
// specific route term. A source with nothing acceptable gives no example.
//
// P2-08b (§1g.19 b, F5; BACKLOG-09 closes into this): a chunk rejected as
// sentence-like leaves no fallback word behind ("We test sulfide
// electrolytes." no longer yields "relate to test"); a multi-word phrase must
// itself yield a specific route term; function and question words ("and",
// "why", "how"…) are sentence words; the fallback word is trimmed of edge
// punctuation and is offered only when the text has no multi-word chunk at all.

import type { UserProfile } from "@/types";
import { phrasesFromText } from "@/lib/feed/profile-compiler";
import { specificTerms } from "@/lib/papers/reading-map";
import { MAX_QUESTION_CHARS, type PaperQuestions } from "@/store/reading-questions";
import { ASK } from "@/components/reader/copy";

export interface ExampleGroup {
  label: string;
  items: string[];
}

/** Questions from earlier papers, newest first. */
const MAX_EARLIER = 6;
/** Questions from the profile, in all. */
const MAX_PROFILE = 8;
/** Questions from each profile source (P1-09b), in the order they are asked;
 *  together they fill the eight. */
const MAX_PER_SOURCE = { challenges: 3, project: 2, topics: 2, methods: 1 } as const;

type ProfileFields = Partial<Pick<UserProfile, "currentProject" | "currentChallenges" | "researchTopics" | "preferredMethods">>;

/** Two examples are the same question when they read the same, case aside. */
function sameKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/** P1-09c: the words that make a chunk a sentence ("we test …", "it is …")
 *  rather than a phrase. Compared lower-cased, without edge punctuation. */
const SENTENCE_WORDS: ReadonlySet<string> = new Set([
  "we", "i", "our", "you", "your", "they", "it", "its", "this", "that", "these", "those",
  "he", "she", "is", "are", "was", "were", "be", "will", "can", "do", "does",
  // P2-08b (F5): conjunctions and question words begin or join clauses.
  "and", "or", "but", "why", "how", "what", "when", "where", "which", "who",
]);
const MIN_PHRASE_WORDS = 2;
const MAX_PHRASE_WORDS = 6;

/** P1-09c: two to six words, none of them a pronoun or an auxiliary. */
function isPhrase(candidate: string): boolean {
  const words = candidate.trim().split(/\s+/).filter(Boolean);
  return (
    words.length >= MIN_PHRASE_WORDS &&
    words.length <= MAX_PHRASE_WORDS &&
    words.every((word) => !SENTENCE_WORDS.has(word.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")))
  );
}

/** An edge-trimmed word: no punctuation before its first or after its last letter or digit. */
function trimEdges(word: string): string {
  return word.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** P1-09b/c, P2-08b: a free-text field's acceptable multi-word phrases, in
 *  `phrasesFromText`'s order — each only when its finished question
 *  (`template(phrase)`) has a specific route term. When a multi-word chunk was
 *  rejected (a sentence, too long, a function word in it, nothing to route on),
 *  nothing else is offered: its keywords are not examples. Only a text with no
 *  multi-word chunk at all falls back to its first single word, edge-trimmed,
 *  and then only when the finished question has a specific route term, so a
 *  stoplist or generic word ("study", "energy") is not an example. The default
 *  `max` (8) lets `phrasesFromText` return up to four chunk phrases, more than
 *  either source's cap. */
function phrasesFirst(text: string | undefined, template: (value: string) => string): string[] {
  const candidates = phrasesFromText(text);
  const phrases = candidates.filter((candidate) => isPhrase(candidate) && specificTerms(template(candidate.trim())).length > 0);
  if (phrases.length > 0) return phrases;
  if (candidates.some((candidate) => /\s/.test(candidate.trim()))) return [];
  const word = candidates.map(trimEdges).find((candidate) => candidate !== "");
  return word !== undefined && specificTerms(template(word)).length > 0 ? [word] : [];
}

export function exampleQuestions({
  profile,
  byPaper,
  paperId,
}: {
  profile: ProfileFields;
  byPaper: Readonly<Record<string, PaperQuestions>>;
  paperId: string;
}): ExampleGroup[] {
  const seen = new Set<string>();
  /** Adds `text` (cut to a question line's 200 characters) unless it is
   *  empty, already offered, or the list is full; true when it was added. */
  const offer = (list: string[], max: number, text: string): boolean => {
    if (list.length >= max) return false;
    const example = text.trim().slice(0, MAX_QUESTION_CHARS).trim();
    const key = sameKey(example);
    if (!example || seen.has(key)) return false;
    seen.add(key);
    list.push(example);
    return true;
  };

  // 1. The reader's own questions on other papers, the most recent first.
  const earlier: string[] = [];
  Object.entries(byPaper)
    .filter(([id]) => id !== paperId)
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    .forEach(([, entry]) => {
      for (const question of entry.items) offer(earlier, MAX_EARLIER, question);
    });

  // 2. The profile, asked as questions, in a fixed order, each source within
  //    its own cap. An example already offered does not use up a slot.
  const fromProfile: string[] = [];
  const asked = (values: readonly string[], template: (value: string) => string, cap: number) => {
    let added = 0;
    for (const value of values) {
      if (added >= cap) break;
      const phrase = value.trim();
      if (phrase && offer(fromProfile, MAX_PROFILE, template(phrase))) added += 1;
    }
  };
  asked(phrasesFirst(profile.currentChallenges, ASK.examples.challenge), ASK.examples.challenge, MAX_PER_SOURCE.challenges);
  asked(phrasesFirst(profile.currentProject, ASK.examples.project), ASK.examples.project, MAX_PER_SOURCE.project);
  asked(profile.researchTopics ?? [], ASK.examples.topic, MAX_PER_SOURCE.topics);
  asked(profile.preferredMethods ?? [], ASK.examples.method, MAX_PER_SOURCE.methods);

  return [
    ...(earlier.length > 0 ? [{ label: ASK.fromEarlier, items: earlier }] : []),
    ...(fromProfile.length > 0 ? [{ label: ASK.fromProfile, items: fromProfile }] : []),
  ];
}
