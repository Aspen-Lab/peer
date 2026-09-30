import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { scoreItems } from "./combine";
import {
  matchesFamilyMember,
  scoreKeyword,
  selfDeclaresDifferentSense,
  senseContextGate,
} from "./keyword";
import { canonicalize, expandTerm, termSpecificity } from "./term-expand";

// NMC-HYPONYM (ABC-JEV-INTEGRATION.md §1bu, ruling on
// docs/jev-abc/NMC-HYPONYM-B-20260930T111311Z.md) — a Required tag "NMC"
// already matched every SEPARATED spelling of a stoichiometry ("NMC 811",
// "NMC-811") through plain T1 (a separator canonicalizes to a space, so the
// bare word "nmc" stands alone). The real gap was the GLUED spelling
// ("NMC811", no separator — also the more common real-world spelling), and
// "NCM" was not linked to "NMC" at all. This file is the regression/
// protective suite for that item, scoped to §1bu's own ruled test list, one
// dedicated file per §1au/LCO-FORMULA's own precedent (lco-formula.test.ts).
// Digit range is EXACTLY 3 throughout (§1bu ruling 2, narrowed from the
// guide's own 3-4 proposal) — a 4th digit is the shape of a year or a
// meeting name ("NMC2019"), not a stoichiometry, and must never match.

const now = Date.parse("2026-09-28T00:00:00Z");

function item(id: string, overrides: Partial<RawItem> = {}): RawItem {
  return {
    id,
    source: "openalex",
    title: "Unrelated title",
    authors: [],
    abstract: "",
    tags: [],
    url: `https://example.test/${id}`,
    publishedAt: "2026-09-20",
    metadata: {},
    ...overrides,
  };
}

const BATTERY_PROJECT_TEXT =
  "PhD research on solid-state battery materials, focused on lithium and sodium-ion cathode and " +
  "electrolyte interfaces for electric-vehicle batteries. Improving ionic conductivity and " +
  "interfacial stability between solid electrolytes and electrode materials while suppressing " +
  "dendrite growth.";

// Q4 test 1 (guide) — zero new test code needed here: term-expand.test.ts's
// existing `it.each(ABBREVIATION_GROUPS.map(...))` parameterized test already
// asserts every group member expands to every other member bidirectionally,
// so adding the "ncm" literal to the "nmc" group is automatically covered by
// that pre-existing test the moment it runs against the updated group.

describe("family -> member glued admission (§1bu ruling 1/2) — real fragments, cited by OpenAlex id", () => {
  it("real fixture (openalex:W4415333146): a title that only ever glues \"NMC811\" (no space) now qualifies tag \"NMC\"", () => {
    // Verbatim real title fragment, verified against <scratchpad>/nmc-q3a-output.txt
    // (Q3a of the guide). The paper's title alone is the shortest real
    // fragment that reproduces the gain — this is the exact paper
    // LCO-FORMULA-B's own §3 NMC section independently also found as a "+1
    // gain" (an independent re-discovery, per the guide).
    const paper = item("nmc-family-gain-1", {
      title: "Early-Stage Thermal Safety Evaluation of the NMC811/LLZO/Li Solid-State Battery Chemistry",
    });
    const result = scoreKeyword(paper, ["NMC"], { extendedRequiredMatch: true });
    expect(result.matched).toEqual(["NMC"]);
    expect(result.score).toBeGreaterThan(0);
    expect(matchesFamilyMember(paper, canonicalize("NMC"))).toBe(true);
    const scored = scoreItems([paper], { topics: ["NMC"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["nmc-family-gain-1"]);
  });

  it("real fixture (openalex:W4411046382): an abstract-only glued \"NCM622\" mention (title never says NMC/NCM at all) now qualifies tag \"NCM\"", () => {
    // Verbatim real title + the guide's own quoted abstract fragment
    // (ellipses trimmed, capitalized for standalone use), verified against
    // <scratchpad>/nmc-q3a-output.txt.
    const paper = item("nmc-family-gain-2", {
      title: "Structural Repair of Spent Layered Cathode Materials for Lithium-Ion Batteries",
      abstract: "Thermal solid-state structural repair of spent LiNi0.6Co0.2Mn0.2O2 (NCM622).",
    });
    const result = scoreKeyword(paper, ["NCM"], { extendedRequiredMatch: true });
    expect(result.matched).toEqual(["NCM"]);
    expect(result.score).toBeGreaterThan(0);
    expect(matchesFamilyMember(paper, canonicalize("NCM"))).toBe(true);
    const scored = scoreItems([paper], { topics: ["NCM"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["nmc-family-gain-2"]);
  });

  it("the same W4411046382 fixture also qualifies tag \"NMC\" — the family synonym and the glued pattern combine regardless of which prefix the reader typed or the paper used", () => {
    const paper = item("nmc-family-gain-2-cross", {
      title: "Structural Repair of Spent Layered Cathode Materials for Lithium-Ion Batteries",
      abstract: "Thermal solid-state structural repair of spent LiNi0.6Co0.2Mn0.2O2 (NCM622).",
    });
    const scored = scoreItems([paper], { topics: ["NMC"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["nmc-family-gain-2-cross"]);
    expect(scored[0].matchedKeywords).toEqual(["NMC"]);
  });
});

describe("one-way protection (§1bu ruling 1(b), the brief's core requirement)", () => {
  it("a member tag \"NMC811\" does NOT match text containing only the bare family word \"NMC\"", () => {
    const familyOnly = item("nmc811-vs-bare-family", {
      title: "Cycling performance of NMC cathodes under fast-charge protocols",
    });
    expect(matchesFamilyMember(familyOnly, canonicalize("NMC811"))).toBe(false);
    const scored = scoreItems([familyOnly], { topics: ["NMC811"] }, undefined, now);
    expect(scored).toEqual([]);
  });

  it("a member tag \"NMC811\" does NOT match text containing only a DIFFERENT member, \"NMC622\" (cross-member independence)", () => {
    const differentMember = item("nmc811-vs-nmc622", {
      title: "Structural evolution of NMC622 cathodes during extended cycling",
    });
    expect(matchesFamilyMember(differentMember, canonicalize("NMC811"))).toBe(false);
    const scored = scoreItems([differentMember], { topics: ["NMC811"] }, undefined, now);
    expect(scored).toEqual([]);
  });

  it("structural proof, not just one fixture: isNmcFamilyTag is false for every member canonical form, so matchesFamilyMember short-circuits before reading any text", () => {
    for (const memberTag of ["NMC811", "NMC622", "NMC532", "NMC111", "NCM811"]) {
      expect(matchesFamilyMember(item("x", { title: "NMC811 NMC622 NMC532 NMC111 NCM811 NMC NCM" }), canonicalize(memberTag))).toBe(false);
    }
  });
});

describe("member self-synonymy (§1bu ruling 1(c)) — digit-preserving, never the bare family form", () => {
  it("tag \"NMC811\" matches text containing only \"NCM811\" (same digits, swapped prefix)", () => {
    const paper = item("ncm811-only", { title: "Degradation mechanisms of NCM811 cathodes at high voltage" });
    const scored = scoreItems([paper], { topics: ["NMC811"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["ncm811-only"]);
  });

  it("tag \"NCM811\" matches text containing only \"NMC811\" (the reverse direction)", () => {
    const paper = item("nmc811-only", { title: "Degradation mechanisms of NMC811 cathodes at high voltage" });
    const scored = scoreItems([paper], { topics: ["NCM811"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["nmc811-only"]);
  });

  it("tag \"NMC811\" does NOT match \"NCM622\" — the sibling rule is digit-preserving, not a blanket member alias", () => {
    const paper = item("ncm622-only", { title: "Thermal stability of NCM622 cathode powders" });
    const scored = scoreItems([paper], { topics: ["NMC811"] }, undefined, now);
    expect(scored).toEqual([]);
  });

  it("expandTerm(\"nmc811\") contains \"ncm811\" but never the bare family form or a different composition", () => {
    const expanded = expandTerm("NMC811");
    expect(expanded).toContain("ncm811");
    expect(expanded).not.toContain("nmc");
    expect(expanded).not.toContain("ncm");
    expect(expanded).not.toContain("ncm622");
    expect(expanded).not.toContain("nmc622");
  });
});

describe("SENSE-CONTEXT skip for the glued path (§1bu ruling 4, mirrors matchesFullNameOrFormula's precedent)", () => {
  it("a minimal glued-member-only match, with no other shared vocabulary, is rescued ONLY by the skip rule (not by the statistical gate)", () => {
    // Constructed to isolate the skip rule, the same shape
    // sense-context.test.ts's own "minimal full-name/formula" fixture uses:
    // a single glued mention and nothing else that overlaps
    // BATTERY_PROJECT_TEXT at all.
    const minimalFamilyMember = item("nmc-minimal-family-member", {
      title: "Structural analysis of NMC811 thin films",
      abstract: "",
    });
    const gate = senseContextGate(minimalFamilyMember, "NMC", BATTERY_PROJECT_TEXT);
    expect(gate.pass).toBe(false); // the statistical axis alone would demote it
    const scored = scoreItems([minimalFamilyMember], { topics: ["NMC"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([minimalFamilyMember], { topics: ["NMC"] }, undefined, now);
    expect(scored[0].matchedKeywords).toEqual(["NMC"]);
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4); // full strength
  });
});

describe("bare-acronym protection is unchanged — non-regression (§1bu ruling 4's second half)", () => {
  // Constructed (not tied to a specific OpenAlex id — the guide's own Q3c
  // finding named these two collision shapes by execution but did not cite
  // ids for them), modeled on Q3c's own finding: the historical US National
  // Meteorological Center, and a crystallography space-group symbol
  // fragment ("P42/ncm") — neither ever glues a 3-digit stoichiometry
  // suffix to the acronym, so `matchesFamilyMember` never fires for either;
  // both are still literal T1 matches (still `matched`) but must stay
  // DEMOTED, not dropped, against a real battery researcher's declared
  // context — completely unchanged by this item.
  const meteorologyParagraph = item("meteorology-bare-nmc", {
    title: "Verification of the NMC Global Forecast System for Mesoscale Weather Prediction",
    abstract: "The NMC model's skill in predicting synoptic-scale pressure systems over North America is assessed.",
  });
  const crystallographyParagraph = item("crystallography-bare-ncm", {
    title: "Structural Phase Transition Analysis in a Perovskite Oxide with Cmca-P42/ncm Symmetry",
    abstract: "Group-subgroup relations for the P42/ncm space group are used to model the low-temperature phase.",
  });

  it("the meteorology-shaped paragraph is still a literal T1 match for tag \"NMC\" but stays demoted", () => {
    expect(matchesFamilyMember(meteorologyParagraph, canonicalize("NMC"))).toBe(false);
    const scored = scoreItems([meteorologyParagraph], { topics: ["NMC"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([meteorologyParagraph], { topics: ["NMC"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["meteorology-bare-nmc"]);
    expect(scored[0].matchedKeywords).toEqual(["NMC"]); // demoted, not dropped
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword);
  });

  it("the \"P42/ncm\" fixture is still a literal T1 match for tag \"NCM\" but stays demoted", () => {
    expect(matchesFamilyMember(crystallographyParagraph, canonicalize("NCM"))).toBe(false);
    const scored = scoreItems([crystallographyParagraph], { topics: ["NCM"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([crystallographyParagraph], { topics: ["NCM"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["crystallography-bare-ncm"]);
    expect(scored[0].matchedKeywords).toEqual(["NCM"]);
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword);
  });

  it("the \"P42/ncm\" fixture also stays demoted for tag \"NMC\" — the new \"ncm\" synonym inherits the SAME, already-mitigated protection, not a new unprotected gap", () => {
    const scored = scoreItems([crystallographyParagraph], { topics: ["NMC"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([crystallographyParagraph], { topics: ["NMC"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["crystallography-bare-ncm"]);
    expect(scored[0].matchedKeywords).toEqual(["NMC"]);
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword);
  });
});

describe("rule (c) — a genuinely NEW surface for \"ncm\" (§1bu ruling, Q4 test 7)", () => {
  it("a self-declared pair using \"NCM\" as the abbreviation with a disagreeing long form is a hard non-match (could not fire before this item)", () => {
    // "North Central Mountains (NCM)" -- initials N-C-M spell "ncm", but the
    // long form shares no words with any known nmc/ncm expansion. Before
    // this item, hasKnownAbbreviationExpansion("ncm") was false (no group
    // contained "ncm" at all), so selfDeclaresDifferentSense could never
    // fire for an "NCM" tag; it is now reachable the same way it already is
    // for "NMC".
    const paper = item("ncm-rule-c", {
      title: "Land use patterns across the North Central Mountains (NCM) region show significant variation.",
    });
    expect(selfDeclaresDifferentSense(paper, "NCM").differs).toBe(true);
    const scored = scoreItems([paper], { topics: ["NCM"] }, undefined, now);
    expect(scored).toEqual([]);
  });
});

describe("termSpecificity / KNOWN_SHORT_FORMS parity for \"ncm\" (§1bu, Q4 test 8)", () => {
  it("\"ncm\" scores termSpecificity 0.7, matching \"nmc\"'s existing treatment", () => {
    expect(termSpecificity("ncm")).toBe(0.7);
    expect(termSpecificity("ncm")).toBe(termSpecificity("nmc"));
  });
});

describe("card sentence is unchanged for a family->member admission (§1bu ruling 1(e), Q4 test 9)", () => {
  it("a member-matched item's relevanceReason reads the reader's own tag (\"NMC\"), never the matched variant (\"NMC811\")", () => {
    const paper = item("nmc-card-sentence", { title: "Cycling behavior of NMC811 cathodes under fast charging" });
    const scored = scoreItems([paper], { topics: ["NMC"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["nmc-card-sentence"]);
    expect(scored[0].matchedKeywords).toEqual(["NMC"]);
    expect(scored[0].relevanceReason).toContain("Matches your interest in NMC.");
    expect(scored[0].relevanceReason).not.toContain("NMC811");
  });
});

describe("digit range is EXACTLY 3, not 3-4 (§1bu ruling 2)", () => {
  it("\"NMC2019\" (4 digits, a meeting/year shape) does NOT match tag \"NMC\"", () => {
    const paper = item("nmc2019-year-shape", {
      title: "Proceedings of the NMC2019 International Conference on Materials Science",
    });
    expect(matchesFamilyMember(paper, canonicalize("NMC"))).toBe(false);
    const scored = scoreItems([paper], { topics: ["NMC"] }, undefined, now);
    expect(scored).toEqual([]);
  });

  it("\"NCM2020\" (4 digits) does NOT match tag \"NCM\" either", () => {
    const paper = item("ncm2020-year-shape", {
      title: "NCM2020 workshop proceedings on regional planning",
    });
    expect(matchesFamilyMember(paper, canonicalize("NCM"))).toBe(false);
    const scored = scoreItems([paper], { topics: ["NCM"] }, undefined, now);
    expect(scored).toEqual([]);
  });
});
