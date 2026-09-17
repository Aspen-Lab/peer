// What Peer looks for before the reader has said anything.
//
// The product used to open on a seven-step wizard: a first visitor saw a form,
// not a paper, and had to describe their research before Peer would show them
// what it does. Now the first visit is a briefing — a sample across a few broad
// fields — and the setup happens against real papers, one choice at a time.
//
// These are deliberately broad and deliberately few. They are a SAMPLE, never
// presented as "your briefing": the strip above the cards says so, and the
// deck's "on <topics>" clause is dropped while they are in use, because naming
// them there would read as a claim about the reader.

export const STARTER_TOPICS: readonly string[] = [
  "machine learning",
  "neuroscience",
  "molecular biology",
  "materials science",
  "climate science",
  "quantum computing",
];

/** The key the feed store loads under while no topic has been chosen. */
export const STARTER_TOPICS_KEY = "\u0000starter";

/** True when the reader has not chosen a topic yet, so the sample is showing. */
export function isStarterFeed(activeTopics: readonly string[]): boolean {
  return activeTopics.filter((t) => t.trim().length > 0).length === 0;
}

/** The reader's own topics, or the sample while they have none. */
export function topicsOrStarter(activeTopics: readonly string[]): string[] {
  const own = activeTopics.map((t) => t.trim()).filter(Boolean);
  return own.length > 0 ? own : [...STARTER_TOPICS];
}
