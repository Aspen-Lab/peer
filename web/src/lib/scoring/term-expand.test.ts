import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { passesRequiredGate, toScoringItem } from "@/lib/opportunities/shared";
import { scoreKeyword } from "./keyword";
import {
  ABBREVIATION_GROUPS,
  canonicalize,
  expandTerm,
  termMatches,
  termSpecificity,
} from "./term-expand";

function paper(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "paper:test",
    source: "openalex",
    title: "Unrelated title",
    authors: [],
    abstract: "",
    url: "https://example.test",
    publishedAt: "2026-01-01",
    tags: [],
    metadata: {},
    ...overrides,
  };
}

describe("canonicalize and termMatches", () => {
  it("matches battery against batteries", () => {
    expect(
      termMatches(
        canonicalize("International Conference on Batteries and Fuel Cells"),
        "battery",
      ),
    ).toBe(true);
  });

  it("treats solid-state and solid state as the same term", () => {
    expect(
      termMatches(
        canonicalize("Solid-State Battery Research Summit"),
        "solid state battery",
      ),
    ).toBe(true);
  });

  it("matches lithium ion against li-ion through bidirectional expansion", () => {
    expect(
      termMatches(canonicalize("Advances in Li-ion transport"), "lithium ion"),
    ).toBe(true);
  });

  // A generic word DOES match literally — termMatches is context-free on
  // purpose. What must not happen is a lone generic match being accepted as
  // proof of relevance, which is the gate's job, not the matcher's.
  it.each([
    "prepare marketing materials for the launch",
    "course materials will be provided",
    "training materials and onboarding docs",
  ])("a lone generic match never opens the relevance gate: %s", (text) => {
    const scoped = scoreKeyword(
      toScoringItem({
        id: "x",
        title: text,
        text,
        summary: text,
        tags: [],
      }),
      ["materials"],
      { scope: "titleAndSummary" },
    );
    expect(scoped.matched).toEqual(["materials"]);
    expect(passesRequiredGate(["materials"], scoped, scoped)).toBe(false);
  });

  it("a specific term does open the gate", () => {
    const text = "Solid-State Battery Summit 2026";
    const scoped = scoreKeyword(
      toScoringItem({ id: "y", title: text, text, summary: text, tags: [] }),
      ["solid state battery"],
      { scope: "titleAndSummary" },
    );
    expect(passesRequiredGate(["solid state battery"], scoped, scoped)).toBe(true);
  });

  it.each([
    ["solid electrolyte", "IEEE SE 2026: Conference on Software Engineering"],
    ["cyclic voltammetry", "Research Scientist — please send your CV to apply"],
  ])(
    "two-letter acronyms are not aliases, so %s does not match unrelated prose",
    (term, text) => {
      expect(termMatches(canonicalize(text), term)).toBe(false);
    },
  );

  it("still allows materials in a domain-specific phrase", () => {
    expect(
      termMatches(canonicalize("battery materials research"), "materials"),
    ).toBe(true);
  });

  it.each(["region", "fashion"])("does not match ion inside %s", (text) => {
    expect(termMatches(canonicalize(text), "ion")).toBe(false);
  });
});

describe("expandTerm", () => {
  it("does not globally expand ambiguous SEM outside a selected domain sense", () => {
    expect(expandTerm("scanning electron microscopy")).not.toContain("sem");
    expect(termMatches(canonicalize("SEM results"), "scanning electron microscopy")).toBe(false);
  });

  it("inflects the final word in both directions", () => {
    expect(expandTerm("cathode")).toContain("cathodes");
    expect(expandTerm("batteries")).toContain("battery");
    expect(expandTerm("DFT matrix")).toContain("dft matrices");
  });

  it.each(ABBREVIATION_GROUPS.map((group) => [group] as const))(
    "expands every abbreviation group bidirectionally: %j",
    (group) => {
      const canonicalGroup = Array.from(
        new Set(group.map((value) => canonicalize(value))),
      );
      for (const source of canonicalGroup) {
        const expanded = expandTerm(source);
        for (const target of canonicalGroup) {
          expect(expanded).toContain(target);
        }
      }
    },
  );

  it("does not singularize short forms that end in s", () => {
    expect(expandTerm("EIS")).not.toContain("ei");
    expect(expandTerm("XPS")).not.toContain("xp");
  });
});

describe("termSpecificity", () => {
  it("weights multi-word, rare, and generic terms as documented", () => {
    expect(termSpecificity("solid state battery")).toBe(1);
    expect(termSpecificity("topochemical")).toBe(0.7);
    expect(termSpecificity("battery")).toBe(0.5);
    expect(termSpecificity("materials")).toBe(0.3);
  });
});

describe("scoreKeyword", () => {
  it("does not dilute a strong match when unrelated topics are added", () => {
    const item = paper({ title: "Solid-state battery summit" });
    const focused = scoreKeyword(item, ["solid state battery"]);
    const broad = scoreKeyword(item, [
      "solid state battery",
      "electroplating",
      "XRD",
      "reliability",
      "topochemical",
    ]);
    expect(broad.score).toBe(focused.score);
    expect(broad.score).toBeCloseTo(2 / 3);
  });

  it("saturates after two strong matches", () => {
    const result = scoreKeyword(
      paper({ title: "Solid-state battery molten salt summit" }),
      ["solid state battery", "molten salt"],
    );
    expect(result.score).toBe(1);
  });

  it("keeps the paper default scope compatible with abstracts and tags", () => {
    expect(
      scoreKeyword(
        paper({ abstract: "Operando cathode characterization" }),
        ["operando"],
      ).matched,
    ).toEqual(["operando"]);
    expect(
      scoreKeyword(paper({ tags: ["electrochemistry"] }), ["electrochemistry"])
        .matched,
    ).toEqual(["electrochemistry"]);
  });

  it("limits the opportunity gate to title, summary, and tags", () => {
    const item = toScoringItem({
      id: "job:test",
      title: "Research Scientist",
      text: "The full description mentions batteries much later.",
      summary: "Solid electrolyte development",
      tags: ["electrochemistry"],
    });

    expect(
      scoreKeyword(item, ["battery"], { scope: "titleAndSummary" }).score,
    ).toBe(0);
    expect(
      scoreKeyword(item, ["solid electrolyte"], {
        scope: "titleAndSummary",
      }).matched,
    ).toEqual(["solid electrolyte"]);
    expect(
      scoreKeyword(item, ["electrochemistry"], {
        scope: "titleAndSummary",
      }).matched,
    ).toEqual(["electrochemistry"]);
    expect(scoreKeyword(item, ["battery"]).matched).toEqual(["battery"]);
  });
});
