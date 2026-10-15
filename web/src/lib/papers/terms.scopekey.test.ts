import { describe, expect, it } from "vitest";
import type { FullTextResult } from "./full-text";
import type { ExtractedDocument, ExtractedSection } from "./html-text";
import { buildReading } from "./reading";
import { paperDefinedTermsInReading, routeTermScope, termScopeKey, termScopeOfKey } from "./terms";
import type { Paper } from "@/types";

// P7-13 (R11b, the owner's R11): the page re-scanned the paper for the terms it defines every
// time the route object changed, and `routeTermScope` returns a NEW `{ sectionIds }` object on
// every call — so every keystroke in "Before you read" re-ran the five definition patterns over
// the scoped sections (19-44 ms on a paper of the owner's size, P7-02 §9(b)). The page now keys
// that scan on `termScopeKey`: the SET of sections in the scope, as a string. A keystroke that
// does not change which sections are read or background leaves the key, and so the scan, alone.
// Pure; no model, no DOM.

const entry = (question: string, sections: Record<string, { tier: string }>, vague = false) => ({ question, vague, sections });

describe("termScopeKey — a scope named by which sections are in it", () => {
  it("is the empty string for no scope, an empty one, and a scope of nothing", () => {
    expect(termScopeKey(undefined)).toBe("");
    expect(termScopeKey({ sectionIds: [] })).toBe("");
  });

  it("does not depend on the order the sections were found in, or on repeats", () => {
    expect(termScopeKey({ sectionIds: ["s2", "s1", "s3"] })).toBe(termScopeKey({ sectionIds: ["s1", "s2", "s3"] }));
    expect(termScopeKey({ sectionIds: ["s1", "s1", "s2"] })).toBe(termScopeKey({ sectionIds: ["s2", "s1"] }));
  });

  it("differs when the set differs", () => {
    const keys = [["s1"], ["s2"], ["s1", "s2"], ["s1", "s2", "s3"], ["s10"], ["s1", "s20"]].map((sectionIds) => termScopeKey({ sectionIds }));

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("");
  });

  it("cannot be confused by an id that holds the separator someone else might pick", () => {
    expect(termScopeKey({ sectionIds: ["a,b"] })).not.toBe(termScopeKey({ sectionIds: ["a", "b"] }));
    expect(termScopeKey({ sectionIds: ["a\nb"] })).not.toBe(termScopeKey({ sectionIds: ["a", "b"] }));
  });

  it("gives the same string for two calls of routeTermScope on routes that read the same sections — the stable key the page's memo needs", () => {
    const typing = (question: string) =>
      routeTermScope({ vague: false, byQuestion: [entry("Q1", { s1: { tier: "read" }, s4: { tier: "background" } }), entry(question, { s2: { tier: "read" }, s9: { tier: "skim" } })] });
    const first = typing("Which orientation");
    const second = typing("Which orientation improves capacity");

    // The scope objects are two objects (the reason the page used to re-scan)…
    expect(second).not.toBe(first);
    // …and one key.
    expect(termScopeKey(second)).toBe(termScopeKey(first));
  });

  it("changes when a keystroke makes a question read another section", () => {
    const before = routeTermScope({ vague: false, byQuestion: [entry("Q1", { s1: { tier: "read" } })] });
    const after = routeTermScope({ vague: false, byQuestion: [entry("Q1", { s1: { tier: "read" }, s3: { tier: "background" } })] });

    expect(termScopeKey(after)).not.toBe(termScopeKey(before));
  });

  it("is a string, so React compares it by value", () => {
    expect(typeof termScopeKey({ sectionIds: ["s1"] })).toBe("string");
    expect(Object.is(termScopeKey({ sectionIds: ["s1", "s2"] }), termScopeKey({ sectionIds: ["s2", "s1"] }))).toBe(true);
  });
});

describe("termScopeOfKey — the scope back from its key", () => {
  it("is undefined for the empty key (the default scope then applies)", () => {
    expect(termScopeOfKey("")).toBeUndefined();
  });

  it("holds the same sections the key was made from, whatever order they came in", () => {
    const scope = termScopeOfKey(termScopeKey({ sectionIds: ["s3", "s1", "s2"] }));

    expect([...scope!.sectionIds].sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("round-trips ids that hold commas, quotes and line breaks", () => {
    const ids = ['a,b', 'c"d', "e\nf", "g"];
    const scope = termScopeOfKey(termScopeKey({ sectionIds: ids }));

    expect([...scope!.sectionIds].sort()).toEqual([...ids].sort());
  });
});

describe("the terms read through a key are the terms read through the scope", () => {
  type Draft = Pick<ExtractedSection, "heading" | "canonical" | "text"> & { page?: number };
  const docOf = (...sections: Draft[]): ExtractedDocument => ({
    source: "pdf",
    figureCaptions: [],
    sections: sections.map((section, index) => ({ ...section, id: `s${index}` })),
  });
  const paper: Paper = {
    id: "upload:00000000000000bb", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const readingOf = (doc: ExtractedDocument) =>
    buildReading(
      paper,
      { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } } as FullTextResult,
      new Date("2026-10-11T00:00:00.000Z"),
    );
  const doc = docOf(
    { heading: "Abstract", canonical: "abstract", text: "Nothing." },
    { heading: "1 Introduction", canonical: "introduction", text: "Quantum Processing Units (QPU) are the target hardware.", page: 1 },
    { heading: "2 Methods", canonical: "methods", text: "We define dwell fatigue as cycling with a hold at peak load.", page: 2 },
    { heading: "3 Results", canonical: "results", text: "The creep rate, defined as the strain accumulated per hour, rose with stress.", page: 3 },
  );

  it.each([[["s1"]], [["s3", "s1"]], [["s2", "s3"]], [["s1", "s2", "s3"]]])("scope %j", (sectionIds) => {
    const reading = readingOf(doc);
    const scope = { sectionIds };

    expect(paperDefinedTermsInReading(reading, termScopeOfKey(termScopeKey(scope)))).toEqual(paperDefinedTermsInReading(reading, scope));
  });

  it("no scope: the default scope, the same terms", () => {
    const reading = readingOf(doc);

    expect(paperDefinedTermsInReading(reading, termScopeOfKey(termScopeKey(undefined)))).toEqual(paperDefinedTermsInReading(reading));
  });
});
