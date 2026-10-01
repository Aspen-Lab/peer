import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { scoreItems } from "./combine";
import { matchesFullNameOrFormula, scoreKeyword, selfDeclaresDifferentSense } from "./keyword";
import { canonicalize, termMatches } from "./term-expand";

// LCO-FORMULA (ABC-JEV-INTEGRATION.md §1au, ruling on
// docs/jev-abc/LCO-FORMULA-B-20260928T234855Z.md) — `ABBREVIATION_GROUPS`
// (term-expand.ts) gained one bare chemical-formula alias per group: "licoo2"
// for LCO, "lifepo4" for LFP. Nothing added for NMC (§1au.2, design lead
// NMC-HYPONYM — a different, symmetric-expansion trade-off, not decided this
// round). This file is the regression/protective suite for that one-line
// change, scoped exactly to §1au.6's ruled test list — not the guide's own
// broader §4 proposal, which the ruling deliberately narrowed.

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

describe("LCO — confirmed-genuine gains from adding \"licoo2\" (guide §3)", () => {
  it("real fixture (openalex:W4403584989): a title that only ever says \"LiCoO2\" — never \"LCO\" or \"lithium cobalt oxide\" — now qualifies tag \"LCO\"", () => {
    // Verbatim real title, verified against <scratchpad>/out/tagged-LCO.json.
    // The paper's own abstract never mentions LCO/LiCoO2/lithium cobalt oxide
    // at all (it is about an inverse open-circuit-voltage curve model), so
    // the title alone is the shortest real fragment that reproduces the gain
    // — omitted here since it adds nothing this test needs.
    const paper = item("lco-gain-1", {
      title: "Inverse Open Circuit Voltage Curve Model for LiCoO2 Battery at Different Temperatures",
    });
    const result = scoreKeyword(paper, ["LCO"]);
    expect(result.matched).toEqual(["LCO"]);
    expect(result.score).toBeGreaterThan(0);
  });

  it("real fixture (openalex:W4412150737): an abstract-only \"LiCoO₂\" mention (unicode subscript), title has no LCO wording at all, now qualifies tag \"LCO\"", () => {
    // Verbatim closing sentence of the real abstract (shortest real fragment
    // that reproduces the gain), including the unicode-subscript spelling
    // "LiCoO₂" as the paper itself writes it — canonicalize()'s own
    // .normalize("NFKC") maps ₂ -> 2 independently of the adapters'
    // cleanDisplayText (guide §2), so this also exercises that normalization
    // path directly, not just the plain-ASCII case.
    const paper = item("lco-gain-2", {
      title: "Chemical design rules for low-resistivity electrode-electrolyte interfaces in all-solid-state lithium batteries",
      abstract:
        "Here, the Li/P ratio in lithium phosphate is optimized to achieve low-resistance interfaces with LiCoO₂, reaching >10 Ω·cm².",
    });
    const result = scoreKeyword(paper, ["LCO"]);
    expect(result.matched).toEqual(["LCO"]);
    expect(result.score).toBeGreaterThan(0);
    // End-to-end sanity (no declared context -> SENSE-CONTEXT bypasses, same
    // as today's behavior): the paper is actually retrievable, not just a
    // matcher-level true.
    const scored = scoreItems([paper], { topics: ["LCO"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["lco-gain-2"]);
  });
});

describe("LFP — confirmed-genuine gains from adding \"lifepo4\" (guide §3)", () => {
  it("real fixture (openalex:W7202113990): a title that only ever says \"LiFePO4\" — never \"LFP\" or \"lithium iron phosphate\" — now qualifies tag \"LFP\"", () => {
    // Verbatim real title, verified against <scratchpad>/out/raw-P4.json /
    // out/raw-P2.json.
    const paper = item("lfp-gain-1", {
      title:
        "Engineering durable interphases: Composite solid electrolyte membrane incorporating silicon-doped garnet-type Li7La3Zr2O12 (Si-LLZO) filler and dual-salt-added LiFePO4 functional cathode for solid-state lithium metal batteries (SSLMBs)",
    });
    const result = scoreKeyword(paper, ["LFP"]);
    expect(result.matched).toEqual(["LFP"]);
    expect(result.score).toBeGreaterThan(0);
    const scored = scoreItems([paper], { topics: ["LFP"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["lfp-gain-1"]);
  });

  it("real fixture (arxiv:2609.02209, the \"ProtoMI\" paper): a single abstract mention of \"LiFePO4\" in an otherwise ML/additive-discovery paper now qualifies tag \"LFP\"", () => {
    // Shortened from a real abstract sentence: the long chemical name that
    // precedes "(TNDB)" in the source is left out; the "LiFePO4" mention that
    // reproduces the gain is unchanged — the paper is fundamentally about a machine-
    // learning framework for electrolyte-additive discovery and validates
    // its result on LiFePO4||graphite cycling specifically, exactly as the
    // guide's §3 LFP section describes it.
    const paper = item("lfp-gain-2", {
      title: "Prototype-guided transfer of sparse literature knowledge for electrolyte additive discovery",
      abstract:
        "One representative candidate, TNDB, improves high-temperature LiFePO4||graphite cycling at 55 °C by 34.93% relative to the baseline electrolyte.",
    });
    const result = scoreKeyword(paper, ["LFP"]);
    expect(result.matched).toEqual(["LFP"]);
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("protective — the new formula aliases do not widen any unrelated match (§1au.3/.6)", () => {
  it("a saved real petroleum \"light cycle oil (LCO)\" negative still does not qualify tag \"LCO\" end-to-end (the item's own adversarial history)", () => {
    // Same real fixture already relied on in sense-context.test.ts's test 6/
    // test 14 — repeated here because THIS item's own change (adding
    // "licoo2") is what must be proven not to reopen it, not merely that
    // rule (c) still exists. Rule (c) is unaffected by this edit: "licoo2"
    // is single-word, so it can never enter knownExpansions (keyword.ts
    // filters to variants containing a space), and this paper never
    // mentions the formula at all.
    const petroleum = item("lco-petroleum-still-non-match", {
      title: "Separation of aromatic components from light cycle oil by solvent extraction",
      abstract:
        "To improve the versatility of light cycle oil (LCO), separation of aromatic compounds from LCO by solvent extraction was investigated.",
    });
    const scored = scoreItems(
      [petroleum],
      { topics: ["LCO"], seedTexts: [
        "PhD research on solid-state battery materials, focused on lithium and sodium-ion cathode and " +
          "electrolyte interfaces for electric-vehicle batteries.",
      ] },
      undefined,
      now,
    );
    expect(scored).toEqual([]);
  });

  it("a bare \"LiCoO2 (LCO)\" self-declaration still does not fire rule (c) — the formula alias did not change what counts as a known expansion", () => {
    // "licoo2" is excluded from `knownExpansions` in keyword.ts
    // (`expandTerm(tag).filter(v => v.includes(" "))` keeps only multi-word
    // variants), so rule (c)'s agree/disagree logic is byte-for-byte
    // unaffected by this item's edit. This directly targets the specific
    // string the guide itself names as the risk (§1au.6/guide §4.3),
    // distinct from the existing "high-voltage LiCoO2 (LCO)"/"layered
    // LiCoO2 (LCO)" fixtures already pinned in sense-context.test.ts.
    const paper = item("licoo2-bare-paren", {
      title: "Cycling performance of LiCoO2 (LCO) cathodes under fast-charge protocols",
    });
    expect(selfDeclaresDifferentSense(paper, "LCO").differs).toBe(false);
    // It still qualifies normally, through plain T1 (the bare "LCO" token is
    // literally present, same as before this fix) — confirms rule (c) not
    // firing is a genuine non-event, not masked by the paper failing to
    // qualify for an unrelated reason.
    expect(scoreKeyword(paper, ["LCO"]).matched).toEqual(["LCO"]);
  });

  it('pins today\'s behavior: "Li-CoO2" (a hyphen INSIDE the formula) is still not caught by the new alias — a named, accepted residual (§1au.3)', () => {
    // canonicalize()'s dash-collapse (\p{Pd} -> space) splits "Li-CoO2" into
    // two tokens ("li", "coo2"), so it never equals the single contiguous
    // token "licoo2" the new alias matches on (guide §2's own finding). This
    // pins the CURRENT behavior so a future change to canonicalize's
    // dash-handling is a deliberate, reviewed choice, not a silent drift.
    const paper = item("li-hyphen-coo2", {
      title: "Electrochemical performance of Li-CoO2 thin-film cathodes",
    });
    expect(scoreKeyword(paper, ["LCO"]).score).toBe(0);
    expect(termMatches(canonicalize(paper.title), "lco")).toBe(false);
  });
});

// NMC-HYPONYM ROUND 2 AMENDMENT (ABC-JEV-INTEGRATION.md §1bu.9, after the
// fresh A's FAILED_REVIEW, docs/jev-abc/NMC-HYPONYM-A-20260930T141756Z.md
// Check 1) — a side effect of that item's `matchesFullNameOrFormula`
// generalization (keyword.ts + term-expand.ts's `isKnownShortForm`, added
// to make the "nmc"/"ncm" pair's bare-acronym path correctly keep the
// context check): the SAME narrowing is also production-reachable for
// THIS file's own two formula tags, "licoo2" and "lifepo4" — the only two
// pre-existing `ABBREVIATION_GROUPS` tags besides "nmc"/"ncm" that are
// themselves single-token (so `isShortOrAmbiguous` is true for them,
// unlike a group's 3-4 word spelled-out name). Before this change, a
// Required tag "licoo2" (or "lifepo4") admitted via ONLY the bare acronym
// ("LCO"/"LFP" — itself a valid T1 variant of the formula tag, through the
// same group closure) unconditionally SKIPPED the SENSE-CONTEXT check,
// because the bare acronym counted as "not the literal queried tag" and
// therefore "strong evidence." That was never correct: a bare, ambiguous
// acronym is exactly the LOW-information evidence the check exists to
// double-check (§1bg point 3's own stated purpose; §1bu.3 states the same
// principle for the nmc/ncm case). Ruling: KEEP (safe, monotonic narrowing
// — 0 gained matches anywhere, pool MEMBERSHIP unchanged, only ranking for
// a disagreeing-context paper) — these tests close the "untested" half of
// the reviewer's finding. Constructed text: the reviewer's own cited real
// fragment (openalex:W7213392907) is a "NCM622" mention in the SAME
// sentence as a bare "LCO" word, about a DIFFERENT compound's formula, not
// LCO's own full name/formula — it does not give a minimal, isolated
// "bare-LCO-only, nothing else" fixture to reuse, so constructed text is
// used instead (the task's own stated alternative).
describe("NMC-HYPONYM ROUND 2 (§1bu.9) — the matchesFullNameOrFormula narrowing reaches \"licoo2\"/\"lifepo4\" as Required tags", () => {
  const AGREEING_CONTEXT =
    "PhD research on solid-state battery materials, focused on lithium and sodium-ion cathode and " +
    "electrolyte interfaces for electric-vehicle batteries. Improving ionic conductivity and " +
    "interfacial stability between solid electrolytes and electrode materials while suppressing " +
    "dendrite growth.";
  // Deliberately shares zero vocabulary with a battery-cathode paper (the
  // same isolation shape sense-context.test.ts's own fixtures use).
  const DISAGREEING_CONTEXT =
    "A study of migratory patterns among monarch butterflies across seasonal climate zones and wind currents.";

  describe('tag "licoo2" — bare "LCO" is the ONLY group evidence in the item text', () => {
    const bareOnly = item("licoo2-bare-only", {
      title: "Cycling performance of LCO cathodes under fast-charge protocols",
      abstract: "LCO cells were benchmarked against several alternative chemistries.",
    });
    const withLongName = item("licoo2-with-long-name", {
      title: "Cycling performance of LCO cathodes under fast-charge protocols",
      abstract: "LCO, also known as lithium cobalt oxide, was benchmarked against several alternative chemistries.",
    });
    const bareOnlyAgreeing = item("licoo2-bare-only-agreeing", {
      title: "Cycling performance of LCO cathodes under fast-charge protocols",
      abstract:
        "LCO cathode materials were paired with solid electrolyte interfaces to evaluate ionic conductivity " +
        "and interfacial stability while suppressing dendrite growth in lithium-ion batteries.",
    });

    it("(a) a disagreeing declared context now runs the check and DEMOTES the item, not drops it", () => {
      expect(matchesFullNameOrFormula(bareOnly, "licoo2")).toBe(false);
      const scored = scoreItems([bareOnly], { topics: ["licoo2"], seedTexts: [DISAGREEING_CONTEXT] }, undefined, now);
      const bypassed = scoreItems([bareOnly], { topics: ["licoo2"] }, undefined, now);
      expect(scored.map((s) => s.id)).toEqual([bareOnly.id]); // still admitted -- demoted, never dropped
      expect(scored[0].matchedKeywords).toEqual(["licoo2"]);
      // MUTATION CHECK (§1bu.9): restoring HEAD's literal-tag-only exclusion
      // makes matchesFullNameOrFormula(bareOnly, "licoo2") true again (the
      // bare "lco" variant would count as "not the literal tag" = strong
      // evidence), the skip fires, and this assertion goes red (full
      // strength instead of demoted).
      expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword);
    });

    it("(b) the SAME shape but with the long name (\"lithium cobalt oxide\") also present still SKIPS (full strength)", () => {
      expect(matchesFullNameOrFormula(withLongName, "licoo2")).toBe(true);
      const scored = scoreItems([withLongName], { topics: ["licoo2"], seedTexts: [DISAGREEING_CONTEXT] }, undefined, now);
      const bypassed = scoreItems([withLongName], { topics: ["licoo2"] }, undefined, now);
      expect(scored.map((s) => s.id)).toEqual([withLongName.id]);
      expect(scored[0].matchedKeywords).toEqual(["licoo2"]);
      expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4);
    });

    it("(c) the SAME bare-only shape under an AGREEING context stays at full strength (demotion is not indiscriminate)", () => {
      const scored = scoreItems([bareOnlyAgreeing], { topics: ["licoo2"], seedTexts: [AGREEING_CONTEXT] }, undefined, now);
      const bypassed = scoreItems([bareOnlyAgreeing], { topics: ["licoo2"] }, undefined, now);
      expect(scored.map((s) => s.id)).toEqual([bareOnlyAgreeing.id]);
      expect(scored[0].matchedKeywords).toEqual(["licoo2"]);
      expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4);
    });
  });

  describe('tag "lifepo4" — bare "LFP" is the ONLY group evidence in the item text', () => {
    const bareOnly = item("lifepo4-bare-only", {
      title: "Rate capability of LFP cathodes at high current density",
      abstract: "LFP electrodes were cycled at various C-rates to assess capacity retention.",
    });
    const withLongName = item("lifepo4-with-long-name", {
      title: "Rate capability of LFP cathodes at high current density",
      abstract: "LFP, or lithium iron phosphate, electrodes were cycled at various C-rates to assess capacity retention.",
    });
    const bareOnlyAgreeing = item("lifepo4-bare-only-agreeing", {
      title: "Rate capability of LFP cathodes at high current density",
      abstract:
        "LFP cathode materials were paired with solid electrolyte interfaces to evaluate ionic conductivity " +
        "and interfacial stability while suppressing dendrite growth in lithium-ion batteries.",
    });

    it("(a) a disagreeing declared context now runs the check and DEMOTES the item, not drops it", () => {
      expect(matchesFullNameOrFormula(bareOnly, "lifepo4")).toBe(false);
      const scored = scoreItems([bareOnly], { topics: ["lifepo4"], seedTexts: [DISAGREEING_CONTEXT] }, undefined, now);
      const bypassed = scoreItems([bareOnly], { topics: ["lifepo4"] }, undefined, now);
      expect(scored.map((s) => s.id)).toEqual([bareOnly.id]);
      expect(scored[0].matchedKeywords).toEqual(["lifepo4"]);
      // MUTATION CHECK (§1bu.9): same as the licoo2 case above.
      expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword);
    });

    it("(b) the SAME shape but with the long name (\"lithium iron phosphate\") also present still SKIPS (full strength)", () => {
      expect(matchesFullNameOrFormula(withLongName, "lifepo4")).toBe(true);
      const scored = scoreItems([withLongName], { topics: ["lifepo4"], seedTexts: [DISAGREEING_CONTEXT] }, undefined, now);
      const bypassed = scoreItems([withLongName], { topics: ["lifepo4"] }, undefined, now);
      expect(scored.map((s) => s.id)).toEqual([withLongName.id]);
      expect(scored[0].matchedKeywords).toEqual(["lifepo4"]);
      expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4);
    });

    it("(c) the SAME bare-only shape under an AGREEING context stays at full strength (demotion is not indiscriminate)", () => {
      const scored = scoreItems([bareOnlyAgreeing], { topics: ["lifepo4"], seedTexts: [AGREEING_CONTEXT] }, undefined, now);
      const bypassed = scoreItems([bareOnlyAgreeing], { topics: ["lifepo4"] }, undefined, now);
      expect(scored.map((s) => s.id)).toEqual([bareOnlyAgreeing.id]);
      expect(scored[0].matchedKeywords).toEqual(["lifepo4"]);
      expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4);
    });
  });
});
