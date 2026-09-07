// The briefing's deck — the one sentence under the dateline.
//
// The page used to open with two lines of small print: the masthead's
// "Monday, September 7 · 10 papers · 9 unread" and a mono "matching diffusion
// models, protein structure prediction · synced 4m ago" — a status bar, not
// a front page. The date is the headline now, and everything the two lines
// said about the briefing is one sentence in reading type: "Ten papers on
// diffusion models and protein structure prediction — nine unread." Only the
// sync state stays small, because it is status.
//
// Pure: segments in, so the page can set the unread phrase in ink without
// the words living in JSX.

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Counts a sentence can carry as words; beyond ten, digits read better. */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

/** "A" · "A and B" · "A, B and C" — the reader's own topics, as prose. */
export function joinTopics(topics: readonly string[]): string {
  const clean = topics.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

export interface DeckSegment {
  text: string;
  /** "heading" is set in ink — the one phrase that changes as the reader reads. */
  tone: "muted" | "heading";
}

export function briefingDeck(input: {
  total: number;
  unread: number;
  topics: readonly string[];
  /** Papers not yet landed: the deck names what is being looked for. */
  loading: boolean;
}): DeckSegment[] {
  const topics = joinTopics(input.topics);
  const about = topics ? ` on ${topics}` : "";

  if (input.total === 0) {
    // Nothing to describe: the empty and error states have their own words.
    if (!input.loading) return [];
    return [{ text: `Looking for today's papers${about}.`, tone: "muted" }];
  }

  const count = numberWord(input.total);
  const lead = `${count.charAt(0).toUpperCase()}${count.slice(1)} paper${input.total === 1 ? "" : "s"}${about} — `;
  if (input.unread === 0) {
    return [
      { text: lead, tone: "muted" },
      { text: "all read", tone: "heading" },
      { text: ", back tomorrow.", tone: "muted" },
    ];
  }
  return [
    { text: lead, tone: "muted" },
    { text: `${numberWord(input.unread)} unread`, tone: "heading" },
    { text: ".", tone: "muted" },
  ];
}
