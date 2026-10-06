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
  it("turns challenges, project, topics and methods into questions with the fixed templates, in that order, each source within its own cap", () => {
    const [group] = exampleQuestions({ profile, byPaper: {}, paperId: PAPER });

    expect(group.label).toBe("From your profile");
    expect(group.items).toEqual([
      "Does this help with Dendrite growth in lithium anodes?",
      "Does this help with electrolyte decomposition at high voltage?",
      "How does this relate to Solid-state batteries for electric aircraft?",
      "How does this relate to We test sulfide electrolytes?",
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
