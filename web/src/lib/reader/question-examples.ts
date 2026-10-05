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

type ProfileFields = Partial<Pick<UserProfile, "currentProject" | "currentChallenges" | "researchTopics" | "preferredMethods">>;

/** Two examples are the same question when they read the same, case aside. */
function sameKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
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
   *  empty, already offered, or the list is full. */
  const offer = (list: string[], max: number, text: string) => {
    if (list.length >= max) return;
    const example = text.trim().slice(0, MAX_QUESTION_CHARS).trim();
    const key = sameKey(example);
    if (!example || seen.has(key)) return;
    seen.add(key);
    list.push(example);
  };

  // 1. The reader's own questions on other papers, the most recent first.
  const earlier: string[] = [];
  Object.entries(byPaper)
    .filter(([id]) => id !== paperId)
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    .forEach(([, entry]) => {
      for (const question of entry.items) offer(earlier, MAX_EARLIER, question);
    });

  // 2. The profile, asked as questions, in a fixed order.
  const fromProfile: string[] = [];
  const asked = (values: readonly string[], template: (value: string) => string) => {
    for (const value of values) {
      const phrase = value.trim();
      if (phrase) offer(fromProfile, MAX_PROFILE, template(phrase));
    }
  };
  asked(phrasesFromText(profile.currentChallenges, 4), ASK.examples.challenge);
  asked(phrasesFromText(profile.currentProject, 2), ASK.examples.project);
  asked((profile.researchTopics ?? []).slice(0, 2), ASK.examples.topic);
  asked((profile.preferredMethods ?? []).slice(0, 2), ASK.examples.method);

  return [
    ...(earlier.length > 0 ? [{ label: ASK.fromEarlier, items: earlier }] : []),
    ...(fromProfile.length > 0 ? [{ label: ASK.fromProfile, items: fromProfile }] : []),
  ];
}
