// The sentence under a card's title, decided for the whole board at once.
//
// A field's repetition is invisible from inside the card carrying it —
// `plate-terms.ts` argues the same thing about the plate's words and allocates
// them across the briefing for the same reason. Three cards saying "Matches
// your interest in machine learning." carry zero bits each, and the card that
// says it cannot know.

import type { Paper } from "@/types";
import { pickSkimSentence } from "@/lib/papers/skim";

export function resolvePaperTileSummary(
  paper: Pick<Paper, "summaryIntro" | "summaryResultDiscussion">,
  storedSummary?: string,
): string | null {
  // A real digest sentence still wins when a key is configured.
  const digestSentence = storedSummary?.trim();
  if (digestSentence) return digestSentence;

  // Without one, read the whole abstract and pick the sentence that says what
  // the paper did. This used to take `summaryIntro` — the first one or two
  // sentences — which for an academic abstract is the motivation, and reads
  // identically across every paper in a field.
  const skim = pickSkimSentence(paper.summaryIntro, paper.summaryResultDiscussion);
  if (skim) return skim;

  // No reason line here. `relevanceReason` is Peer's own sentence about its
  // own matching, and for a one-topic reader it is byte-identical on every
  // paper of the day (`scoring/reason.ts`). Nor "Open this paper for details."
  // — that describes the affordance the reader is already looking at, on an
  // element that is a link. Absence is no line, never a made-up one;
  // `lib/reader/recommendation.ts` decided this for the reading page first.
  return null;
}

/** Lowercase, collapse whitespace, drop a trailing date clause, so two lines
 *  that differ only in "today" vs "1 week ago" still compare equal. */
function fold(line: string): string {
  return line
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;]?\s*(today|yesterday|\d+\s*(day|days|week|weeks|mo|month|months|y)\+?\s*ago)\s*\.?$/u, "")
    .trim();
}

/**
 * The board's lines, with any sentence more than half of it is carrying
 * suppressed on EVERY card that carries it — not all-but-one. The first of
 * three identical sentences is no more informative than the third.
 *
 * More than half, not "more than one": a reader with two topics gets two
 * clusters of five, and a `> 1` threshold would blank the whole board.
 */
export function briefingTileLines(
  papers: Paper[],
  stored: Record<string, string | undefined>,
): Record<string, string | null> {
  const lines = new Map<string, string | null>();
  const counts = new Map<string, number>();
  for (const paper of papers) {
    const line = resolvePaperTileSummary(paper, stored[paper.id]);
    lines.set(paper.id, line);
    if (line) {
      const key = fold(line);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const limit = papers.length / 2;
  const out: Record<string, string | null> = {};
  for (const [id, line] of lines) {
    out[id] = line && (counts.get(fold(line)) ?? 0) > limit ? null : line;
  }
  return out;
}
