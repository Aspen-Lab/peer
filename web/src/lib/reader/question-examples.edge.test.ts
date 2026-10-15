import { describe, expect, it, vi } from "vitest";

// P2-08b (§1g.19 b, F5): the single-word fallback is trimmed of edge
// punctuation before it is asked about. The real `phrasesFromText` already
// splits its chunks on punctuation, so the case is not reachable through it;
// it is cheap, ruled, and tested where it can be reached — with the chunker
// replaced by a stub that hands back a word with a stray full stop.
vi.mock("@/lib/feed/profile-compiler", () => ({
  phrasesFromText: (text: string | undefined) => (text ? [text] : []),
}));

import { exampleQuestions } from "./question-examples";

const empty = { currentProject: "", currentChallenges: "", researchTopics: [] as string[], preferredMethods: [] as string[] };
const itemsOf = (profile: Partial<typeof empty>): string[] =>
  exampleQuestions({ profile: { ...empty, ...profile }, byPaper: {}, paperId: "openalex:W1" }).flatMap((group) => group.items);

describe("the single-word fallback's edge punctuation (P2-08b, F5)", () => {
  it("trims it: 'growth.' is asked about as 'growth'", () => {
    expect(itemsOf({ currentChallenges: "dendrites." })).toEqual(["Does this help with dendrites?"]);
    expect(itemsOf({ currentChallenges: "(creep)" })).toEqual(["Does this help with creep?"]);
  });

  it("offers nothing for a word that is only punctuation", () => {
    expect(itemsOf({ currentChallenges: "..." })).toEqual([]);
  });
});
