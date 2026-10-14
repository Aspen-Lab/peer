import { describe, expect, it } from "vitest";
import {
  PEER_MATCH_MIN_TERMS,
  buildExplainPrompt,
  buildExplainReplyPrompt,
  matchPeerWords,
  type PeerWordsMatch,
} from "./explain";
import type { ExtractedDocument } from "./html-text";

// P10-38 (BACKLOG-75; ruling §1h.102): a selection of Peer's own words (a line of the Summary, an answer) carries the body paragraph
// that best matches it, so the explanation's quote from the paper can be verified against it as a selection in the body already can.
// The match is the Tier 0 route's own scoring (idf over the paper's sections, the terms meeting in one paragraph) with a floor; no
// model call. Everything below is invented text.

const TUNGSTEN = "Tungsten additions delayed plate formation, and the rafting ratio stayed below 0.3 for 200 hours.";
const PARTIAL = "The plate was polished before each test and then etched in a mild acid.";
const ONE_WORD = "Tungsten was supplied as a powder by the workshop.";

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 4,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "Tungsten additions delayed plate formation in a nickel alloy under creep." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: "Hot turbine blades creep slowly under load and lose their shape over many hours.\n\nWe ask whether a heavy element can slow the loss." },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: `${PARTIAL}\n\n${ONE_WORD}\n\nSpecimens were machined from a single casting.` },
    { id: "s3", heading: "3 Results", canonical: "results", page: 3, text: `The first specimen crept at 1100 C for a week.\n\n${TUNGSTEN}` },
    { id: "s4", heading: "4 Discussion", canonical: "discussion", page: 4, text: "We read the delay as a slower approach to the equilibrium shape of the plates." },
  ],
};

const SUMMARY_WORDS = "Tungsten slowed plate formation, so the rafting ratio stays low for longer.";

describe("matchPeerWords — the body paragraph that best matches Peer's words (P10-38, rule 1)", () => {
  it("finds the paragraph that holds several of the words' terms together, with its section and place", () => {
    const match = matchPeerWords(doc, SUMMARY_WORDS);

    expect(match).toEqual({ sectionId: "s3", heading: "3 Results", paragraphIndex: 1, paragraph: TUNGSTEN } satisfies PeerWordsMatch);
  });

  it("prefers the paragraph where more of the terms meet over an earlier one that holds fewer", () => {
    const match = matchPeerWords(doc, "A polished plate of tungsten in the rafting ratio test");

    expect(match?.paragraph).toBe(TUNGSTEN);
  });

  it("has a floor: a paragraph that shares only one term with the words is no match", () => {
    expect(PEER_MATCH_MIN_TERMS).toBe(2);
    expect(matchPeerWords(doc, "Tungsten powder arrived late, so nothing else mattered in the budget")?.paragraph).not.toBe(ONE_WORD);
    expect(matchPeerWords(doc, "Tungsten budget schedule invoices")).toBeNull();
  });

  it("is null for words with nothing in common with the body, for words too vague to route, and for no words", () => {
    expect(matchPeerWords(doc, "Quantum gravity reconciles relativity with measurement theory.")).toBeNull();
    expect(matchPeerWords(doc, "Tungsten")).toBeNull();
    expect(matchPeerWords(doc, "the and of")).toBeNull();
    expect(matchPeerWords(doc, "   ")).toBeNull();
    expect(matchPeerWords(doc, "")).toBeNull();
  });

  it("looks in the body only: the abstract is not a paragraph a quote could be verified against", () => {
    expect(matchPeerWords({ ...doc, sections: [doc.sections[0], doc.sections[4]] }, "Tungsten additions delayed plate formation under creep")).toBeNull();
  });

  it("is the same answer twice and changes nothing it is given", () => {
    const before = JSON.stringify(doc);

    expect(matchPeerWords(doc, SUMMARY_WORDS)).toEqual(matchPeerWords(doc, SUMMARY_WORDS));
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("the prompts carry the matched paragraph (P10-38, rule 1)", () => {
  const paper = { title: "Rafting under creep in a nickel alloy", abstract: "This paper studies rafting in a nickel superalloy under creep." };
  const map = [{ heading: "1 Introduction", opening: "Hot turbine blades creep slowly under load." }, { heading: "3 Results", opening: null }];
  const matched: PeerWordsMatch = { sectionId: "s3", heading: "3 Results", paragraphIndex: 1, paragraph: TUNGSTEN };
  const first = (over: { matched?: PeerWordsMatch | null } = {}) =>
    JSON.parse(buildExplainPrompt({ paper, map, passage: SUMMARY_WORDS, peerWords: "summary", ...over }).userPrompt) as Record<string, unknown>;

  it("puts the paragraph and its section in `context`, the passage still Peer's own words", () => {
    const body = first({ matched });

    expect(body.context).toEqual({ section: "3 Results", paragraph: TUNGSTEN });
    expect(body.passage).toBe(SUMMARY_WORDS);
    expect(String(body.passageFrom)).toContain("Peer's own words about this paper");
  });

  it("lets the quote come from that paragraph, still never from Peer's passage, and offers no table", () => {
    const body = first({ matched });
    const schema = body.outputSchema as { here: { evidence: string } };

    expect(schema.here.evidence).toContain("context.paragraph");
    expect(JSON.stringify(body.rules)).toContain("context.paragraph");
    expect(JSON.stringify(body.rules)).toMatch(/never quote it/);
    expect(body.outputSchema).not.toHaveProperty("items");
  });

  it("cuts a very long paragraph to the same bound a paper passage's paragraph has", () => {
    const body = first({ matched: { ...matched, paragraph: "word ".repeat(1000) } }) as { context: { paragraph: string } };

    expect(body.context.paragraph.length).toBeLessThanOrEqual(2000);
  });

  it("is the prompt it was with no match: a null match and an absent one build the same bytes", () => {
    const without = buildExplainPrompt({ paper, map, passage: SUMMARY_WORDS, peerWords: "summary" });

    expect(buildExplainPrompt({ paper, map, passage: SUMMARY_WORDS, peerWords: "summary", matched: null })).toEqual(without);
    expect(JSON.parse(without.userPrompt)).not.toHaveProperty("context");
  });

  it("carries it in a reply's prompt too, and not when there is none", () => {
    const thread = [{ role: "peer" as const, text: "Plates are flat layers." }, { role: "reader" as const, text: "What is a plate?" }];
    const reply = (over: { matched?: PeerWordsMatch | null } = {}) =>
      JSON.parse(buildExplainReplyPrompt({ paper, map, passage: SUMMARY_WORDS, peerWords: "answer", thread, ...over }).userPrompt) as Record<string, unknown>;

    expect(reply({ matched }).context).toEqual({ section: "3 Results", paragraph: TUNGSTEN });
    expect(JSON.stringify((reply({ matched }).outputSchema as { evidence: string }).evidence)).toContain("context.paragraph");
    expect(reply({ matched: null })).not.toHaveProperty("context");
    expect(reply()).not.toHaveProperty("context");
  });
});
