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
// question like any other once there — the field settles it on that line's
// blur or Enter (§1g.11).
//
// P1-09b (§1f.20 amendment): the challenges and the project are asked by
// their multi-word phrases — a single keyword ("growth") makes a vague,
// odd-sounding example — and fall back to one single word only when the text
// has no multi-word phrase at all. Topics and methods are the reader's own
// entries and stay as typed. Each source has its own cap, so every source
// gets a slot before the total of eight.

import type { UserProfile } from "@/types";
import { phrasesFromText } from "@/lib/feed/profile-compiler";
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

/** P1-09b: a free-text field's multi-word phrases, in `phrasesFromText`'s
 *  order; its first single word only when it has no multi-word phrase. The
 *  default `max` (8) lets `phrasesFromText` return up to four chunk phrases,
 *  more than either source's cap. */
function phrasesFirst(text: string | undefined): string[] {
  const phrases = phrasesFromText(text);
  const multiWord = phrases.filter((phrase) => /\s/.test(phrase.trim()));
  return multiWord.length > 0 ? multiWord : phrases.slice(0, 1);
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
  asked(phrasesFirst(profile.currentChallenges), ASK.examples.challenge, MAX_PER_SOURCE.challenges);
  asked(phrasesFirst(profile.currentProject), ASK.examples.project, MAX_PER_SOURCE.project);
  asked(profile.researchTopics ?? [], ASK.examples.topic, MAX_PER_SOURCE.topics);
  asked(profile.preferredMethods ?? [], ASK.examples.method, MAX_PER_SOURCE.methods);

  return [
    ...(earlier.length > 0 ? [{ label: ASK.fromEarlier, items: earlier }] : []),
    ...(fromProfile.length > 0 ? [{ label: ASK.fromProfile, items: fromProfile }] : []),
  ];
}
