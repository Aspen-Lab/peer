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

  it("turns challenges, project, topics and methods into questions with the fixed templates, in that order, at most eight", () => {
    const [group] = exampleQuestions({ profile, byPaper: {}, paperId: PAPER });

    expect(group.label).toBe("From your profile");
    expect(group.items).toEqual([
      "Does this help with Dendrite growth in lithium anodes?",
      "Does this help with electrolyte decomposition at high voltage?",
      "Does this help with dendrite?",
      "Does this help with growth?",
      "How does this relate to Solid-state batteries for electric aircraft?",
      "How does this relate to solid-state?",
      "What does it say about solid electrolytes?",
      "What does it say about battery safety?",
    ]);
    // Eight in all: the methods did not fit.
    expect(group.items).toHaveLength(8);
    expect(ASK.examples.method("XRD")).toBe("Could I use XRD here?");
  });

  it("fills with methods when the rest leaves room, two of each at most", () => {
    const [group] = exampleQuestions({
      profile: { ...empty, researchTopics: ["creep", "rafting", "oxidation"], preferredMethods: ["XRD", "SEM", "TEM"] },
      byPaper: {},
      paperId: PAPER,
    });

    expect(group.items).toEqual([
      "What does it say about creep?",
      "What does it say about rafting?",
      "Could I use XRD here?",
      "Could I use SEM here?",
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
