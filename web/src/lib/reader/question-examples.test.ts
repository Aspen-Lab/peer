import { describe, expect, it } from "vitest";
import { specificTerms } from "@/lib/papers/reading-map";
import type { PaperQuestions } from "@/store/reading-questions";
import { ASK } from "@/components/reader/copy";
import { exampleQuestions } from "./question-examples";

// P1-09 (user decision §1a.7, ruling §1f.20): the example tags under "Before
// you read" come only from the reader — the questions they wrote on earlier
// papers, and their own profile turned into questions by fixed templates.
// Nothing generic, nothing invented.

const PAPER = "openalex:W1";
const empty = { currentProject: "", currentChallenges: "", researchTopics: [] as string[], preferredMethods: [] as string[] };
const entry = (items: string[], updatedAt: string): PaperQuestions => ({ items, gist: false, updatedAt });

describe("exampleQuestions — from the reader's earlier questions", () => {
  it("lists the distinct questions of every other paper, newest first, at most six; this paper's own are not examples", () => {
    const byPaper = {
      "openalex:W2": entry(["Why does the anode crack?", "How fast does it fade?"], "2026-10-02T00:00:00.000Z"),
      "openalex:W3": entry(["Does tungsten delay rafting?", "why does the ANODE crack?"], "2026-10-04T00:00:00.000Z"),
      [PAPER]: entry(["A question on this very paper?"], "2026-10-05T00:00:00.000Z"),
      "openalex:W4": entry(["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"], "2026-09-01T00:00:00.000Z"),
    };
    const groups = exampleQuestions({ profile: empty, byPaper, paperId: PAPER });

    expect(groups).toEqual([
      {
        label: ASK.fromEarlier,
        items: ["Does tungsten delay rafting?", "why does the ANODE crack?", "How fast does it fade?", "Q1?", "Q2?", "Q3?"],
      },
    ]);
    expect(ASK.fromEarlier).toBe("From your earlier questions");
  });

  it("has no earlier group without other papers' questions, and nothing at all with nothing to draw on", () => {
    const own = { [PAPER]: entry(["A question on this very paper?"], "2026-10-05T00:00:00.000Z") };
    expect(exampleQuestions({ profile: empty, byPaper: own, paperId: PAPER })).toEqual([]);
    expect(exampleQuestions({ profile: empty, byPaper: {}, paperId: PAPER })).toEqual([]);
    expect(exampleQuestions({ profile: { ...empty, researchTopics: ["creep"] }, byPaper: own, paperId: PAPER }).map((g) => g.label)).toEqual([ASK.fromProfile]);
  });
});

describe("exampleQuestions — from the reader's profile", () => {
  const profile = {
    currentChallenges: "Dendrite growth in lithium anodes, electrolyte decomposition at high voltage",
    currentProject: "Solid-state batteries for electric aircraft. We test sulfide electrolytes.",
    researchTopics: ["solid electrolytes", "battery safety", "a third topic"],
    preferredMethods: ["impedance spectroscopy", "cryo-EM", "XRD"],
  };

  // P1-09b (§1f.20 amendment): rewritten to the new contract. Before, the
  // challenges' single keywords "dendrite" and "growth" and the project's
  // "solid-state" took three of the eight slots and the methods never fitted;
  // now the multi-word phrases come first and every source has its own slots.
  // P1-09c (§1f.20 (5)): the project's second sentence "We test sulfide
  // electrolytes" is a sentence fragment, not a phrase, so it is no longer an
  // example; the project gives one example, not two.
  it("turns challenges, project, topics and methods into questions with the fixed templates, in that order, each source within its own cap", () => {
    const [group] = exampleQuestions({ profile, byPaper: {}, paperId: PAPER });

    expect(group.label).toBe("From your profile");
    expect(group.items).toEqual([
      "Does this help with Dendrite growth in lithium anodes?",
      "Does this help with electrolyte decomposition at high voltage?",
      "How does this relate to Solid-state batteries for electric aircraft?",
      "What does it say about solid electrolytes?",
      "What does it say about battery safety?",
      "Could I use impedance spectroscopy here?",
    ]);
    expect(ASK.examples.method("XRD")).toBe("Could I use XRD here?");
  });

  // P1-09b: rewritten to the new caps — topics two, methods one (was two).
  it("takes the topics and methods as typed: two topics and one method at most", () => {
    const [group] = exampleQuestions({
      profile: { ...empty, researchTopics: ["creep", "rafting", "oxidation"], preferredMethods: ["XRD", "SEM", "TEM"] },
      byPaper: {},
      paperId: PAPER,
    });

    expect(group.items).toEqual([
      "What does it say about creep?",
      "What does it say about rafting?",
      "Could I use XRD here?",
    ]);
  });

  it("de-duplicates case-insensitively within the profile group and against the earlier questions", () => {
    const groups = exampleQuestions({
      profile: { ...empty, researchTopics: ["Creep", "creep"], preferredMethods: ["XRD"] },
      byPaper: { "openalex:W2": entry(["what does it say about CREEP?"], "2026-10-02T00:00:00.000Z") },
      paperId: PAPER,
    });

    expect(groups).toEqual([
      { label: ASK.fromEarlier, items: ["what does it say about CREEP?"] },
      { label: ASK.fromProfile, items: ["Could I use XRD here?"] },
    ]);
  });

  it("cuts an example to the question line's 200 characters, and skips an empty field", () => {
    const [group] = exampleQuestions({
      profile: { ...empty, researchTopics: ["x".repeat(300), "  "], preferredMethods: [""] },
      byPaper: {},
      paperId: PAPER,
    });

    expect(group.items).toHaveLength(1);
    expect(group.items[0].length).toBe(200);
    expect(group.items[0].startsWith("What does it say about xxx")).toBe(true);
  });

  it("an empty profile has no profile group", () => {
    expect(exampleQuestions({ profile: empty, byPaper: {}, paperId: PAPER })).toEqual([]);
    expect(exampleQuestions({ profile: {}, byPaper: {}, paperId: PAPER })).toEqual([]);
  });

  it("a template example built from a two-word phrase routes: at least two specific terms, the phrase's own among them", () => {
    const cases: Array<[string, string[]]> = [
      [ASK.examples.challenge("dendrite growth"), ["dendrite", "growth"]],
      [ASK.examples.project("sulfide electrolytes"), ["sulfide", "electrolytes"]],
      [ASK.examples.topic("grain boundaries"), ["grain", "boundaries"]],
      [ASK.examples.method("impedance spectroscopy"), ["impedance", "spectroscopy"]],
    ];
    for (const [example, words] of cases) {
      const terms = specificTerms(example);
      expect(terms.length).toBeGreaterThanOrEqual(2);
      expect(terms).toEqual(expect.arrayContaining(words));
    }
  });
});

// P1-09b (§1f.20 amendment, from C's P1-09 observations 1 and 3): the
// challenges and the project are asked by their multi-word phrases; a single
// word only when the text has no phrase at all. Each source has its own cap —
// challenges 3, project 2, topics 2, methods 1 — so every source gets a slot
// before the total of eight.
describe("exampleQuestions — phrases first, a cap per source (P1-09b)", () => {
  const phraseOf = (example: string, template: (value: string) => string): string | null => {
    const [before, after] = template("\u0000").split("\u0000");
    return example.startsWith(before) && example.endsWith(after)
      ? example.slice(before.length, example.length - after.length)
      : null;
  };

  it("a challenge or project text with a multi-word phrase yields no single-word example", () => {
    const [group] = exampleQuestions({
      profile: {
        ...empty,
        currentChallenges: "Dendrite growth in lithium anodes, electrolyte decomposition at high voltage",
        currentProject: "Solid-state batteries for electric aircraft",
      },
      byPaper: {},
      paperId: PAPER,
    });
    const phrases = group.items
      .map((item) => phraseOf(item, ASK.examples.challenge) ?? phraseOf(item, ASK.examples.project))
      .filter((phrase): phrase is string => phrase !== null);

    expect(phrases).toEqual([
      "Dendrite growth in lithium anodes",
      "electrolyte decomposition at high voltage",
      "Solid-state batteries for electric aircraft",
    ]);
    expect(phrases.every((phrase) => /\s/.test(phrase))).toBe(true);
    expect(group.items).not.toContain("Does this help with dendrite?");
    expect(group.items).not.toContain("Does this help with growth?");
    expect(group.items).not.toContain("How does this relate to solid-state?");
  });

  it("a source with no multi-word phrase still yields one example, from its first word", () => {
    const [challengesOnly] = exampleQuestions({
      profile: { ...empty, currentChallenges: "creep; rafting; oxidation" },
      byPaper: {},
      paperId: PAPER,
    });
    const [projectOnly] = exampleQuestions({
      profile: { ...empty, currentProject: "Superalloys." },
      byPaper: {},
      paperId: PAPER,
    });

    expect(challengesOnly.items).toEqual(["Does this help with creep?"]);
    expect(projectOnly.items).toEqual(["How does this relate to Superalloys?"]);
  });

  it("caps each source — challenges 3, project 2, topics 2, methods 1 — so every source has a slot within the eight", () => {
    const [group] = exampleQuestions({
      profile: {
        currentChallenges: "grain growth at high temperature, crack initiation near pores, oxide scale spallation, creep rupture life",
        currentProject: "thermal barrier coatings, bond coat oxidation, nickel base superalloys",
        researchTopics: ["creep", "rafting", "oxidation"],
        preferredMethods: ["XRD", "SEM", "TEM"],
      },
      byPaper: {},
      paperId: PAPER,
    });

    expect(group.items).toEqual([
      "Does this help with grain growth at high temperature?",
      "Does this help with crack initiation near pores?",
      "Does this help with oxide scale spallation?",
      "How does this relate to thermal barrier coatings?",
      "How does this relate to bond coat oxidation?",
      "What does it say about creep?",
      "What does it say about rafting?",
      "Could I use XRD here?",
    ]);
    expect(group.items).toHaveLength(8);
  });

  it("an example already offered does not use up its source's slot", () => {
    const groups = exampleQuestions({
      profile: { ...empty, researchTopics: ["creep", "rafting", "oxidation"] },
      byPaper: { "openalex:W2": entry(["What does it say about creep?"], "2026-10-02T00:00:00.000Z") },
      paperId: PAPER,
    });

    expect(groups).toEqual([
      { label: ASK.fromEarlier, items: ["What does it say about creep?"] },
      { label: ASK.fromProfile, items: ["What does it say about rafting?", "What does it say about oxidation?"] },
    ]);
  });

  it("routes on the phrase's own words: the templates' words are not route terms", () => {
    const cases: Array<[string, string[]]> = [
      [ASK.examples.challenge("dendrite growth"), ["dendrite", "growth"]],
      [ASK.examples.project("sulfide electrolytes"), ["sulfide", "electrolytes"]],
      [ASK.examples.topic("grain boundaries"), ["grain", "boundaries"]],
      [ASK.examples.method("impedance spectroscopy"), ["impedance", "spectroscopy"]],
    ];
    for (const [example, words] of cases) expect(specificTerms(example)).toEqual(words);
    // A one-word phrase leaves a single term: the example is vague, honestly.
    expect(specificTerms(ASK.examples.challenge("growth"))).toEqual(["growth"]);
    expect(specificTerms(ASK.examples.project("solid-state"))).toEqual(["solid-state"]);
    expect(specificTerms(ASK.examples.topic("creep"))).toEqual(["creep"]);
    expect(specificTerms(ASK.examples.method("XRD"))).toEqual(["xrd"]);
  });
});

// P1-09c (§1f.20 (5), from C's two P1-09b observations): `phrasesFromText`
// treats any chunk of ten words or fewer as a phrase, so a sentence ("We test
// sulfide electrolytes") became an example, and a one-sentence text fell back
// to a generic keyword ("Does this help with study?"). A multi-word phrase is
// now offered only when it has 2–6 words and none is a pronoun or auxiliary;
// the single-word fallback only when its question has a specific route term.
describe("exampleQuestions — sentence fragments and generic words (P1-09c)", () => {
  const itemsOf = (profile: Partial<typeof empty>): string[] =>
    exampleQuestions({ profile: { ...empty, ...profile }, byPaper: {}, paperId: PAPER }).flatMap((group) => group.items);

  it("a sentence fragment is not a phrase: it is skipped and the project example is built from the next acceptable phrase", () => {
    // The fragment is the second chunk: it is rejected, and the slot it would
    // have taken is not filled by a single word.
    expect(itemsOf({ currentProject: "Solid-state batteries for electric aircraft. We test sulfide electrolytes." })).toEqual([
      "How does this relate to Solid-state batteries for electric aircraft?",
    ]);
    // The fragment is the first chunk: the next two acceptable phrases fill
    // the project's two slots; a rejected phrase does not use one.
    expect(itemsOf({ currentProject: "We test sulfide electrolytes. Thermal barrier coatings. Bond coat oxidation" })).toEqual([
      "How does this relate to Thermal barrier coatings?",
      "How does this relate to Bond coat oxidation?",
    ]);
    // The same rule for the challenges.
    expect(itemsOf({ currentChallenges: "We test sulfide electrolytes, grain boundary sliding" })).toEqual([
      "Does this help with grain boundary sliding?",
    ]);
  });

  it("a phrase has two to six words: six are offered, seven are rejected and the next phrase is used", () => {
    expect(itemsOf({ currentChallenges: "Dendrite growth in lithium metal anodes, electrolyte decomposition" })).toEqual([
      "Does this help with Dendrite growth in lithium metal anodes?",
      "Does this help with electrolyte decomposition?",
    ]);
    expect(itemsOf({ currentChallenges: "Dendrite growth in lithium metal anodes cycling, electrolyte decomposition" })).toEqual([
      "Does this help with electrolyte decomposition?",
    ]);
  });

  it("no word of a phrase may be one of the 23 pronouns and auxiliaries, in any case; a longer word that starts with one is fine", () => {
    const words = [
      "we", "i", "our", "you", "your", "they", "it", "its", "this", "that", "these", "those",
      "he", "she", "is", "are", "was", "were", "be", "will", "can", "do", "does",
    ];
    expect(words).toHaveLength(23);
    for (const word of words) {
      for (const cased of [word, word.toUpperCase()]) {
        expect(itemsOf({ currentProject: `Thermal ${cased} coatings, bond coat oxidation` }), cased).toEqual([
          "How does this relate to bond coat oxidation?",
        ]);
      }
    }
    // "Wearable", "itinerant" and "dopants" start with "we", "it" and "do".
    expect(itemsOf({ currentProject: "Wearable itinerant dopants, bond coat oxidation" })).toEqual([
      "How does this relate to Wearable itinerant dopants?",
      "How does this relate to bond coat oxidation?",
    ]);
  });

  it("a one-sentence challenges text whose only keyword is generic yields no challenge example at all", () => {
    // No comma: one chunk of eight words, rejected (it has "we" and is longer
    // than six words); the fallback keyword is "study", which routes on nothing.
    expect(specificTerms(ASK.examples.challenge("study"))).toEqual([]);
    expect(itemsOf({ currentChallenges: "We study how dendrites nucleate under fast charging" })).toEqual([]);
    expect(
      exampleQuestions({
        profile: { ...empty, currentChallenges: "We study how dendrites nucleate under fast charging" },
        byPaper: {},
        paperId: PAPER,
      }),
    ).toEqual([]);
    // The project source follows the same rule.
    expect(itemsOf({ currentProject: "We study how dendrites nucleate under fast charging" })).toEqual([]);
  });

  it("a stoplist word or a generic word is never the single-word example; a specific word still is", () => {
    for (const word of ["Study.", "Work.", "Results.", "Energy.", "Materials."]) {
      expect(itemsOf({ currentChallenges: word }), word).toEqual([]);
      expect(itemsOf({ currentProject: word }), word).toEqual([]);
    }
    expect(itemsOf({ currentChallenges: "creep; rafting; oxidation" })).toEqual(["Does this help with creep?"]);
    expect(itemsOf({ currentProject: "Superalloys." })).toEqual(["How does this relate to Superalloys?"]);
    for (const example of ["Does this help with creep?", "How does this relate to Superalloys?"]) {
      expect(specificTerms(example).length).toBeGreaterThanOrEqual(1);
    }
  });

  // P2-08b (§1g.19 b, F5; BACKLOG-09 closes into this): no fallback word from a
  // chunk that was rejected as sentence-like; a multi-word phrase must yield a
  // specific route term; function and question words are sentence words; the
  // single-word fallback is only for a text with no multi-word chunk at all.
  it("a rejected sentence gives no keyword example: A's 'We test sulfide electrolytes.' (was 'relate to test')", () => {
    expect(itemsOf({ currentProject: "We test sulfide electrolytes." })).toEqual([]);
    expect(itemsOf({ currentChallenges: "We test sulfide electrolytes." })).toEqual([]);
  });

  it("function and question words are sentence words: A's 'Rapid capacity fade, and why' keeps the phrase and loses 'and why'", () => {
    expect(itemsOf({ currentChallenges: "Rapid capacity fade, and why" })).toEqual(["Does this help with Rapid capacity fade?"]);
    expect(itemsOf({ currentChallenges: "and why" })).toEqual([]);
    for (const word of ["and", "or", "but", "why", "how", "what", "when", "where", "which", "who"]) {
      expect(itemsOf({ currentChallenges: `${word} fade` }), word).toEqual([]);
    }
  });

  it("a multi-word phrase with no route term gives nothing: 'the study results' is not an example", () => {
    expect(specificTerms(ASK.examples.challenge("the study results"))).toEqual([]);
    expect(itemsOf({ currentChallenges: "the study results" })).toEqual([]);
    expect(itemsOf({ currentProject: "the study results" })).toEqual([]);
  });

  it("a long sentence of nine words gives no keyword example (was 'help with improving')", () => {
    expect(itemsOf({ currentChallenges: "improving cycle life of high nickel cathodes under fast charging" })).toEqual([]);
  });

  it("good phrases are still offered, and a bare word still is when the text has no multi-word chunk at all", () => {
    expect(itemsOf({ currentChallenges: "dendrite growth, interface resistance" })).toEqual([
      "Does this help with dendrite growth?",
      "Does this help with interface resistance?",
    ]);
    expect(itemsOf({ currentChallenges: "dendrites" })).toEqual(["Does this help with dendrites?"]);
    expect(itemsOf({ currentProject: "Superalloys." })).toEqual(["How does this relate to Superalloys?"]);
  });

  it("topics and methods stay as the reader typed them, whatever they are", () => {
    expect(itemsOf({ researchTopics: ["study", "we are testing it"], preferredMethods: ["it"] })).toEqual([
      "What does it say about study?",
      "What does it say about we are testing it?",
      "Could I use it here?",
    ]);
  });
});
