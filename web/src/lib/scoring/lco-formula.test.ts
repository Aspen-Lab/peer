import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { scoreItems } from "./combine";
import { scoreKeyword, selfDeclaresDifferentSense } from "./keyword";
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
