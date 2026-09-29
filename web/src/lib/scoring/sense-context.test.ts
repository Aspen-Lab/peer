import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { scoreItems, REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT } from "./combine";
import {
  scoreKeyword,
  isShortOrAmbiguous,
  senseContextGate,
  selfDeclaresDifferentSense,
  matchesFullNameOrFormula,
  SENSE_CONTEXT_DEMOTED_GROUNDING,
  SENSE_CONTEXT_FIXED_FLOOR,
  SENSE_CONTEXT_OVERLAP_FLOOR,
  SENSE_CONTEXT_FIXED_RESCUE,
  SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE,
  SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT,
  REQUIRED_TAG_T2_GROUNDING,
  REQUIRED_TAG_T3_GROUNDING,
} from "./keyword";
import { canonicalize, termSpecificity } from "./term-expand";

// SENSE-CONTEXT (ABC-JEV-INTEGRATION.md §1ap + AMENDMENT) — the guide's
// §5.1 test plan (docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md),
// implemented against fixtures re-verified this session (C phase 1/1b/2)
// rather than assumed from the guide's own text. Test numbers below match
// the guide's own numbering; test 4 (the flipped clinical-electrolyte
// fixture) lives in required-gate.test.ts, rewritten in place per the hard
// constraint (never delete, rewrite with a comment naming §1ap). Test 9
// (SEM sense case unchanged) is not duplicated here — it is already
// covered by required-gate.test.ts's own, unmodified "SEM sense case"
// describe block: this file's new code only ever runs inside the per-topic
// loop over `literalMustTopics`, which already has any sense-selected bare
// "sem"/"conflict" stripped out before this code ever sees it (§1.3 of the
// guide, re-verified by reading senses.ts and combine.ts in phase 1) — so
// those existing tests passing unmodified already proves disjointness.

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

describe("test 1 — isShortOrAmbiguous: Option C tag-shape test (§1ap.1)", () => {
  it("classifies each measured tag shape correctly", () => {
    expect(isShortOrAmbiguous("electrolyte")).toBe(true); // 1 token
    expect(isShortOrAmbiguous("solid state")).toBe(true); // 2 tokens
    expect(isShortOrAmbiguous("LCO")).toBe(true); // canonicalizes to 1 token ("lco")
    expect(isShortOrAmbiguous("solid-state battery electrolyte")).toBe(false); // 4 tokens, specific
    // The "or all-generic" clause (§2.3 of the guide): a 3+-token tag built
    // entirely from the existing GENERIC_TERMS vocabulary is still short.
    expect(isShortOrAmbiguous("data analysis systems")).toBe(true);
  });
});

describe("shipped constants (§1ap AMENDMENT 4 — pool-independent gate, grid-measured on the production reference table, docs/jev-abc/SENSE-CONTEXT-C2-20260928T205712Z.md task 3)", () => {
  it("the combined-gate floors and SENSE_CONTEXT_DEMOTED_GROUNDING match the chosen grid point", () => {
    expect(SENSE_CONTEXT_FIXED_FLOOR).toBe(0.015);
    expect(SENSE_CONTEXT_OVERLAP_FLOOR).toBe(0.1);
    expect(SENSE_CONTEXT_FIXED_RESCUE).toBe(0.1);
    expect(SENSE_CONTEXT_DEMOTED_GROUNDING).toBe(0.25);
  });
});

describe("test 2 — cold-start bypass: a reader with no other declared context is unaffected (§1ap.2, protective)", () => {
  it("a real electrolyte positive still qualifies at full T1 grounding when no other context is declared", () => {
    // Real OpenAlex item (openalex:W7204140156), from B's saved out/raw-P4.json.
    const paper = item("electrolyte-cold-start", {
      title:
        "Electrolyte Engineering Challenges and Opportunities for Next‐Generation Aqueous Ammonium‐Ion Batteries",
      abstract:
        "Aqueous ammonium‐ion batteries (AAIBs) have emerged as a promising post‐lithium energy‐storage " +
        "technology, combining intrinsic safety with sustainable viability. However, unlike other " +
        "aqueous‐ion batteries, the engineering of AAIB electrolytes confronts a fundamental dilemma.",
    });
    // No seedTexts/methods/venues/other topics -> pText reduces to exactly
    // "electrolyte" -> stripping its own tokens leaves nothing -> bypass.
    const scored = scoreItems([paper], { topics: ["electrolyte"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["electrolyte-cold-start"]);
    expect(scored[0].matchedKeywords).toEqual(["electrolyte"]);
    const specificity = termSpecificity(canonicalize("electrolyte"));
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(specificity / 1.5, 4); // full T1 title grounding, undemoted
  });
});

describe("test 3 — genuine positives keep their literal-match evidence at the shipped floor (§1ap, protective)", () => {
  it("a real solid-state-battery positive is NOT demoted when a battery context is declared", () => {
    // Real OpenAlex item (openalex:W7208706349), from B's saved out/raw-P1a.json.
    const paper = item("solid-state-genuine", {
      title:
        "A source-linked database of all-solid-state battery electrolyte formulations and performance metrics",
      abstract:
        "This is a source-linked database of all-solid-state battery (ASSB) electrolyte formulations and " +
        "their reported electrochemical performance, extracted from 1,000 peer-reviewed publications.",
    });
    const scored = scoreItems(
      [paper],
      { topics: ["solid state"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["solid-state-genuine"]);
    expect(scored[0].matchedKeywords).toEqual(["solid state"]);
    const specificity = termSpecificity(canonicalize("solid state"));
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(specificity / 1.5, 4); // undemoted
  });
});

describe("test 5 — real wrong-domain negative, 'solid state' (REQUIRED-GATE-A's F2 finding, live evidence)", () => {
  it("a real quantum-physics 'valence-bond-solid state' paper is demoted, not admitted at full strength", () => {
    // Real arXiv item (arxiv:2609.26941) -- the live evidence that started
    // this whole item (ABC-JEV-INTEGRATION.md §5 row SENSE-CONTEXT).
    const paper = item("quantum-solid-state", {
      title: "Measurement-Only Dynamical Phase Transitions in Spin-1 Chains",
      abstract:
        "We study measurement-only dynamics in an interacting spin-1 chain, using forced, normalized " +
        "local projections rather than Born-rule-sampled measurement outcomes. Starting from the " +
        "nearest-neighbor (NN) Affleck-Kennedy-Lieb-Tasaki (AKLT) Haldane symmetry-protected topological " +
        "state, we show that competing local projectors drive this order toward three distinct dynamical " +
        "phases: a featureless topologically trivial product state, an explicitly dimerized " +
        "valence-bond-solid state, and a topologically trivial next-nearest-neighbor (NNN) AKLT state " +
        "consisting of two interwoven Haldane chains.",
      tags: ["quant-ph"],
    });
    const scored = scoreItems(
      [paper],
      { topics: ["solid state"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["quantum-solid-state"]);
    expect(scored[0].matchedKeywords).toEqual(["solid state"]); // §1ap.3 — demoted, not dropped
    const specificity = termSpecificity(canonicalize("solid state"));
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(specificity / 1.5);
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo((specificity * SENSE_CONTEXT_DEMOTED_GROUNDING) / 1.5, 4);
  });
});

describe("test 6 — real wrong-domain negative, 'LCO' (petroleum), + protective sibling", () => {
  it("CONTRACT CHANGED (§1ap AMENDMENT 4 ruling 4): a real petroleum 'light cycle oil (LCO)' paper that self-declares the pair is now a hard non-match, not merely demoted", () => {
    // Real OpenAlex item (openalex:W2897424722). Round 1 (this test's original
    // form) demoted this item via the statistical context gate alone. Round 2
    // adds rule (c): this paper's own text explicitly declares "light cycle
    // oil (LCO)" — an abbreviation pair whose long form does NOT match "LCO"'s
    // known expansion ("lithium cobalt oxide") — so it is now a HARD NON-MATCH
    // (contributes nothing, not even a demoted `matched` entry), stronger and
    // more precise than a statistical demotion for exactly this shape of
    // evidence (an explicit self-declaration, not a proxy). Verified directly
    // against `selfDeclaresDifferentSense` in test 14 below; the pure
    // statistical-DEMOTE mechanism (no self-declared abbreviation involved) is
    // still exercised end-to-end by test 5's real "solid state" negative,
    // untouched by this change.
    const paper = item("petroleum-lco", {
      title: "Separation of aromatic components from light cycle oil by solvent extraction",
      abstract:
        "To improve the versatility of light cycle oil (LCO), separation of aromatic compounds from LCO " +
        "by solvent extraction was investigated. LCO was analyzed to identify 35 components: 19 aromatics " +
        "and 16 alkanes. The batch liquid–liquid equilibrium extraction of LCO was performed using " +
        "furfural, sulfolane, and methanol as extraction solvents.",
      tags: ["Sulfolane", "Chemistry", "Solvent", "Extraction (chemistry)", "Light crude oil", "Solvent extraction"],
    });
    const scored = scoreItems([paper], { topics: ["LCO"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    expect(scored).toEqual([]); // rule (c): contributes nothing, dropped entirely
  });

  it("protective sibling: the real LCO T2 fixture (required-gate.test.ts's own paper, full real text) still qualifies at full grounding with the same battery context declared", () => {
    // Same real OpenAlex item (openalex:W7166694764) required-gate.test.ts's
    // own T2 describe block uses, now with its FULL real abstract and source
    // tags (not the shortened excerpt round 1 used) — confirms this check
    // doesn't collaterally demote a genuine self-declared-abbreviation match.
    // UPDATED per §1ap AMENDMENT 4: the shortened excerpt this test used in
    // round 1 no longer clears the pool-independent gate on its own (it is
    // short enough that stripping "LCO"'s own tokens leaves too little
    // vocabulary to agree with the reader's declared work) — but the item's
    // REAL, complete text does, confirmed against the actual saved fetch
    // rather than assumed; a real production candidate always carries its
    // full abstract and source tags, so this is the faithful fixture.
    const paper = item("lco-t2-protective", {
      title:
        "Spatial Heterogeneity of the Fluorine-to-Lithium Ratio as a Descriptor of Battery Failure by Laser-Induced XUV Spectroscopy (LIXS)",
      abstract:
        "Fluorine-containing phases are closely linked to electrolyte decomposition, interphase formation, " +
        "and failure processes in Li-ion batteries, yet their spatially resolved analysis in composite " +
        "cathodes remains difficult. Here, laser-induced XUV spectroscopy (LIXS) was used to map " +
        "fluorine- and lithium-related emission lines in composite lithium cobalt oxide cathodes (LCO). " +
        "The study used the fluorine emission line at λ = 12.72 nm and the lithium emission line at " +
        "λ = 13.42 nm and applied them to pristine, formed, aged, and failed LCO cathodes. A " +
        "matrix-matched calibration using seven Li metal oxide cathode materials at three fluorine " +
        "levels showed increasing fluorine-related intensity within each matrix, along with pronounced " +
        "matrix specificity and dispersion. This indicated that fluorine quantification in composite " +
        "cathodes is influenced by matrix effects, non-thermal equilibrium plasma behavior, and " +
        "heterogeneity of polyvinylidene fluoride (PVDF) containing fluorine-bearing phases. In the " +
        "mapped cathodes, the F/Li intensity ratio provided the most sensitive descriptor of " +
        "degradation, showing increasing imbalance and greater spatial heterogeneity from pristine to " +
        "failed electrodes. LIXS is therefore advantageous for comparative mapping of light-element/" +
        "halogen heterogeneity in battery cathodes, where reliable fluorine quantification across " +
        "chemically distinct composite materials remains intrinsically difficult.",
      tags: [
        "Cathode", "Fluorine", "Polyvinylidene fluoride", "Composite number", "Lithium fluoride",
        "Spectroscopy", "Electrolyte", "Lithium (medication)", "Analytical Chemistry (journal)",
        "Advancements in Battery Materials",
      ],
    });
    // Note (matches required-gate.test.ts's own comment on this exact
    // fixture): the abstract contains BOTH "(LCO)" and the spelled-out
    // "lithium cobalt oxide", so T1 itself already fires via the 2-mention
    // abstract branch (grounding 0.7, not a 1.0 title match) — the
    // UNDEMOTED baseline for this fixture, verified below by comparing
    // against a guaranteed-bypass (no declared context) run of the SAME
    // item, rather than assuming a hand-computed "full grounding" value.
    const bypassed = scoreItems([paper], { topics: ["LCO"] }, undefined, now);
    const scored = scoreItems([paper], { topics: ["LCO"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["lco-t2-protective"]);
    expect(scored[0].matchedKeywords).toEqual(["LCO"]);
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4); // not demoted
    // Direct assertion (A2 review, LOW-3): the score-equals-bypass-baseline check
    // above proves this indirectly (it only matches if rule (c) never intervened),
    // but a direct call is more legible and does not depend on reading the
    // grounding-computation code path to see why the indirect proof works.
    expect(selfDeclaresDifferentSense(paper, "LCO").differs).toBe(false);
  });
});

describe("test 7 — T4 backdoor closed: a short/ambiguous tag's similarity-only admission is gated too (§1ap.4)", () => {
  it("a constructed T1/T2/T3-miss item that clears T4's OWN floor alone no longer qualifies once the context gate is wired in", () => {
    // Constructed, not real: verified this session (checkpoint's phase-2
    // notes) that under DEMOTE, a T1-hit item never even reaches T4 at all
    // (kw.score is already > 0, so combine.ts's `kw.score === 0` guard
    // skips T4 entirely) — so a genuine T4-only test needs an item that
    // truly never says "solid state" contiguously anywhere, which none of
    // B's real fetched negatives for THIS tag happen to be (all either
    // literally contain the phrase, or fail T4's OWN pre-existing floor
    // before the new gate is even relevant). Scatters "solid" and "state"
    // non-adjacently (T1/T2/T3 all miss) with enough density for T4's own
    // simTopic floor to clear on its own, and shares NO vocabulary with a
    // battery persona once "solid"/"state" are stripped (verified: gate
    // sim = 0) — a clean, direct test of the mechanism itself.
    const paper = item("scattered-wrong-domain", {
      title: "Optical measurements of a solid sample across temperature and pressure",
      abstract:
        "We measured the optical absorption spectrum of a solid crystalline sample across a range of " +
        "temperatures and pressures, tracking how its electronic state evolves near a structural phase " +
        "transition using synchrotron X-ray diffraction and Raman spectroscopy. The solid remained in a " +
        "single state throughout the measurement, with no evidence of a first-order transition.",
    });
    // Genuine filler must itself qualify for tag "solid state" (unlike
    // required-gate.test.ts's electrolyte-tag "filler-battery", which never
    // says "solid" or "state" and so cannot serve as a same-pool comparison
    // here) — reuses test 3's own real, in-window positive.
    const genuineFiller = item("filler-solid-state", {
      title:
        "A source-linked database of all-solid-state battery electrolyte formulations and performance metrics",
      abstract:
        "This is a source-linked database of all-solid-state battery (ASSB) electrolyte formulations and " +
        "their reported electrochemical performance.",
    });
    const scored = scoreItems(
      [paper, genuineFiller],
      { topics: ["solid state"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    // The wrong-domain item is gone entirely; the genuine battery paper
    // (admitted via plain T1) remains.
    expect(scored.map((s) => s.id)).toEqual(["filler-solid-state"]);
  });
});

describe("test 8 — long/specific tags are completely unaffected (protective, §2.1)", () => {
  it("a 4-word tag scores byte-identically with and without the SENSE-CONTEXT code path present", () => {
    const paper = item("long-tag-unaffected", {
      title: "Solid-state battery electrolyte review of recent progress",
      abstract: "A review of solid-state battery electrolyte materials and their performance.",
    });
    const withoutSenseContext = scoreKeyword(paper, ["solid-state battery electrolyte"], {
      grounded: true,
      extendedRequiredMatch: true,
    });
    // Even an adversarial, totally unrelated context text must not matter —
    // proves the tag-shape gate itself (not merely coincidental agreement)
    // is what exempts a long tag.
    const withSenseContext = scoreKeyword(paper, ["solid-state battery electrolyte"], {
      grounded: true,
      extendedRequiredMatch: true,
      senseContext: { contextText: "a completely unrelated context sharing no vocabulary at all" },
    });
    expect(withSenseContext.score).toBe(withoutSenseContext.score);
    expect(withSenseContext.matched).toEqual(withoutSenseContext.matched);
  });
});

describe("test 10 — exclusions stay hard even for a would-be-demoted match (§1ap, protective)", () => {
  it("an excluded term still drops a candidate that would otherwise be demoted-but-qualified", () => {
    const paper = item("excluded-demoted", {
      title: "Serum electrolyte imbalance in critically ill patients: a review",
      abstract: "We evaluated serum electrolyte imbalance among critically ill patients.",
    });
    const scored = scoreItems(
      [paper],
      { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT], exclusions: ["review"] },
      undefined,
      now,
    );
    expect(scored).toEqual([]);
  });
});

describe("test 11 — ranking invariant: a demoted hit never outranks a context-passing hit at equal specificity (§1ap.3)", () => {
  it("the demoted grounding constant stays below every other grounding value in the system (structural, not just sampled)", () => {
    // termSpecificity is constant for a given canonical tag, so "equal
    // specificity" reduces to a grounding comparison. T1's OWN lowest
    // grounding (a passing single mention, not even a title hit) is 0.4 —
    // SENSE_CONTEXT_DEMOTED_GROUNDING must stay below that for the
    // invariant to hold in general, not just for one hand-picked fixture.
    expect(SENSE_CONTEXT_DEMOTED_GROUNDING).toBeLessThan(0.4);
    expect(SENSE_CONTEXT_DEMOTED_GROUNDING).toBeLessThan(REQUIRED_TAG_T2_GROUNDING);
    expect(SENSE_CONTEXT_DEMOTED_GROUNDING).toBeLessThan(REQUIRED_TAG_T3_GROUNDING);
  });

  it("end-to-end: a context-passing title match outranks a demoted title match of the same tag", () => {
    const contextPassing = item("context-passing", {
      title:
        "A source-linked database of all-solid-state battery electrolyte formulations and performance metrics",
      abstract:
        "This is a source-linked database of all-solid-state battery (ASSB) electrolyte formulations and " +
        "their reported electrochemical performance.",
    });
    const demoted = item("demoted", {
      title: "Measurement-Only Dynamical Phase Transitions in Spin-1 Chains",
      abstract:
        "We study measurement-only dynamics in an interacting spin-1 chain... an explicitly dimerized " +
        "valence-bond-solid state, and a topologically trivial next-nearest-neighbor AKLT state.",
    });
    const scored = scoreItems(
      [contextPassing, demoted],
      { topics: ["solid state"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    const passingScore = scored.find((s) => s.id === "context-passing")!.scoreBreakdown.keyword;
    const demotedScore = scored.find((s) => s.id === "demoted")!.scoreBreakdown.keyword;
    expect(passingScore).toBeGreaterThan(demotedScore);
  });

  it("§1ap AMENDMENT 2(ii): the FINAL combined score also demotes a fully-demoted item, in a realistic mixed pool — unstripped topicality can no longer rescue it", () => {
    // FIXTURE STRENGTHENED per B2 round-2 §5.1
    // (docs/jev-abc/SENSE-CONTEXT-B2-20260928T202118Z.md): fresh A's own mutation
    // sweep found the ORIGINAL version of this fixture did not actually detect
    // removing the AMENDMENT 2(ii) penalty (hard-coding it to 1 left all tests
    // green) — keyword-level demotion ALONE already sank the spin-chain item to
    // percentile 0 in that pool, so the final-score penalty had nothing left to
    // rescue it FROM. Root cause: real production `pText` also folds in
    // `briefToSeedTexts`/`generatedQueries`, which repeats the Required topic's
    // own phrasing across many query fragments — the ORIGINAL fixture's `pText`
    // (just the tag + BATTERY_PROJECT_TEXT) understated that repetition. Two
    // changes reproduce the real dynamic, verified this session: (1) an extra
    // seedTexts entry that repeats "solid state" the way generatedQueries does
    // (a direct, honest proxy for production, not a contrivance); (2) two of the
    // four genuine papers are deliberately OLDER and from a slightly
    // lower-weighted source than the very fresh, arxiv-sourced spin-chain paper —
    // not every genuine match is published yesterday on arXiv. Without BOTH
    // changes the spin-chain item does not actually contest first place, so the
    // assertion below would pass even with the penalty removed.
    const GENERATED_QUERIES_PROXY =
      "solid state battery review. solid state electrolyte materials review. " +
      "recent advances in solid state battery technology. solid state ionic conductors.";
    // Live-check evidence (this item's own checkpoint, phase 2): in a real
    // signed-out "solid state" + battery-project request, this exact real
    // paper's keyword score correctly dropped to the demoted value, but it
    // still ranked #6 of 10 because scoreBreakdown.topicality (unstripped
    // tfidf similarity to pText) stayed high — a paper centrally, densely
    // about "solid state" physics shares heavy raw vocabulary with a pText
    // that itself repeats "solid state" many times. AMENDMENT 2(ii) closes
    // that: `kw.fullyDemoted` (true here — its ONE Required-tag match is
    // demoted and there is no other) multiplies the FINAL combined score by
    // SENSE_CONTEXT_DEMOTED_GROUNDING too, not just the keyword component.
    const spinChain = item("spin-chain-physics", {
      source: "arxiv",
      title: "Measurement-Only Dynamical Phase Transitions in Spin-1 Chains",
      abstract:
        "We study measurement-only dynamics in an interacting spin-1 chain, using forced, normalized " +
        "local projections rather than Born-rule-sampled measurement outcomes. Starting from the " +
        "nearest-neighbor (NN) Affleck-Kennedy-Lieb-Tasaki (AKLT) Haldane symmetry-protected topological " +
        "state, we show that competing local projectors drive this order toward three distinct dynamical " +
        "phases: a featureless topologically trivial product state, an explicitly dimerized " +
        "valence-bond-solid state, and a topologically trivial next-nearest-neighbor (NNN) AKLT state " +
        "consisting of two interwoven Haldane chains.",
      tags: ["quant-ph"],
      publishedAt: "2026-09-22",
    });
    // A realistic pool: several genuine, real solid-state-battery papers, two of
    // them deliberately older and from a lower-weighted source (see comment above).
    const genuinePool = [
      item("genuine-1", {
        title:
          "A source-linked database of all-solid-state battery electrolyte formulations and performance metrics",
        abstract:
          "This is a source-linked database of all-solid-state battery (ASSB) electrolyte formulations and " +
          "their reported electrochemical performance, extracted from 1,000 peer-reviewed publications.",
      }),
      item("genuine-2", {
        title:
          "Enhancing Interfacial Stability Between NASICON‐Type Solid‐State Electrolyte and Lithium Metal Anode via Multifunctional Synergistic Interface Engineering",
        abstract:
          "Li 1.3 Al 0.3 Ti 1.7 (PO 4 ) 3 (LATP)‐based all‐solid‐state lithium metal batteries (ASSLMBs) hold " +
          "exceptional promise for achieving high energy density and excellent safety, yet their practical " +
          "application is severely hindered by critical interfacial issues.",
      }),
      item("genuine-3", {
        source: "semantic_scholar",
        publishedAt: "2026-06-01",
        title: "Optimal Fast Charging of All-Solid-State Batteries under Cathode Transport Constraints",
        abstract:
          "We develop a physics-based model of all-solid-state battery fast charging, identifying cathode " +
          "transport as the binding constraint on achievable charge rates while avoiding lithium plating.",
      }),
      item("genuine-4", {
        source: "semantic_scholar",
        publishedAt: "2026-05-15",
        title: "Microstructure-Resolved Impedance Modeling of Solid-State Batteries",
        abstract:
          "We present a microstructure-resolved impedance model for solid-state batteries, connecting " +
          "grain-boundary resistance in the solid electrolyte to measurable cell-level impedance spectra.",
      }),
    ];
    const scored = scoreItems(
      [spinChain, ...genuinePool],
      { topics: ["solid state"], seedTexts: [BATTERY_PROJECT_TEXT, GENERATED_QUERIES_PROXY] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id).sort()).toEqual(
      ["spin-chain-physics", "genuine-1", "genuine-2", "genuine-3", "genuine-4"].sort(),
    );
    const spinChainScored = scored.find((s) => s.id === "spin-chain-physics")!;
    const genuineScores = scored.filter((s) => s.id !== "spin-chain-physics");
    expect(genuineScores.length).toBe(4);
    for (const genuine of genuineScores) {
      expect(spinChainScored.score).toBeLessThan(genuine.score);
    }
    // Confirms the mechanism, not just the outcome: this item really is
    // fully demoted (no rescue path left), and the physics paper is
    // genuinely last by FINAL rank, not merely low.
    expect(spinChainScored.matchedKeywords).toEqual(["solid state"]);
    expect(scored[scored.length - 1].id).toBe("spin-chain-physics");
  });
});

describe("test 12 — REQUIRED-GATE-FLOOR-TEST boundary pair (folded per §1ap.7, closes REQUIRED-GATE-A's F1 gap)", () => {
  it("admission genuinely flips with REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT's value, built in a small 2-item pool", () => {
    // F1 asked for "a fixture whose admission genuinely flips with the
    // floor" — REQUIRED-GATE-C's own tests never had one (only a literal
    // constant-value check). B's guide picked two real electrolyte papers
    // for this, but re-verifying this session (checkpoint's phase-2 notes)
    // found that choice structurally unworkable under DEMOTE: for a
    // SINGLE-WORD tag, T4's own anchor (`simTopic > 0`) can only ever be
    // satisfied by an item that literally contains that exact word — but
    // then T1 already matches it too (same tokenization basis), so
    // `kw.score` is never 0 and T4 never runs. B's own guide explicitly
    // allows this substitution ("either tag long or short does not matter
    // for what F1 was actually testing... whether FLOOR_PROJECT's VALUE is
    // exercised") — this uses the LONG, SENSE-CONTEXT-exempt tag already
    // used elsewhere in this file, via scattered (non-adjacent) word
    // overlap, so the test is also fully isolated from the new gate by
    // construction. Both fixtures were verified this session to have
    // simTopic > 0 and < FLOOR_TOPIC (0.15) — so the split genuinely comes
    // from FLOOR_PROJECT, not the topic anchor.
    const admits = item("floor-admit", {
      title:
        "Ionic conductivity and interfacial stability in lithium and sodium-ion cathode chemistries for a next-generation battery",
      abstract:
        "We report ionic conductivity and interfacial stability measurements across lithium and " +
        "sodium-ion cathode chemistries for electric-vehicle applications, with attention to electrode " +
        "degradation and dendrite growth suppression during extended cycling.",
    });
    const rejects = item("floor-reject", {
      title: "Zoning board survey of warehouse siting preferences near a battery recycling depot",
      abstract:
        "We survey municipal zoning board preferences for warehouse and logistics-hub siting near an " +
        "industrial recycling depot, covering traffic-permit timelines, noise-ordinance variances, and " +
        "property-tax abatement negotiations with neighboring landowners.",
    });
    const scored = scoreItems(
      [admits, rejects],
      { topics: ["solid-state battery electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    // At today's REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT, exactly one admits.
    expect(scored.map((s) => s.id)).toEqual(["floor-admit"]);
    expect(scored[0].matchedKeywords).toEqual([]); // T4-only, no literal evidence
    // Ties the pass directly to the live exported constant, not a
    // hard-coded 0.05: if the constant were ever raised above this
    // fixture's own project-similarity, this assertion — not just the
    // membership check above — would fail too.
    expect(scored[0].scoreBreakdown.tfidf).toBeGreaterThanOrEqual(REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT);
  });
});

describe("test 13 — pool-size invariance (§1ap AMENDMENT 4, closes fresh A's FINDING 1)", () => {
  // Fresh A's review (docs/jev-abc/SENSE-CONTEXT-A-20260928T195116Z.md) measured the
  // ROUND-1 gate's verdict on this exact real item flipping between pool sizes: PASS
  // (full strength, wrong) at 2/4 items, FAIL (demoted, correct) at 7+ — because its
  // IDF came from `buildIndex(items)`, built fresh from whatever pool happened to be
  // fetched that day. This test would have FAILED under that gate; it passes under
  // AMENDMENT 4's replacement because `senseContextGate` no longer takes a pool/index
  // argument at all — every input is the one item, the reader's context text, or the
  // fixed shipped table.
  function filler(n: number): RawItem[] {
    return Array.from({ length: n }, (_, i) =>
      item(`filler-${i}`, {
        title: `Unrelated survey paper number ${i} on an unconnected subject`,
        abstract: `A filler abstract about topic ${i}, sharing no vocabulary with batteries or the reader's declared work.`,
      }),
    );
  }

  it("a real wrong-domain negative gets the identical demoted keyword score at pool size 3 and 100+", () => {
    // Real arXiv item (arxiv:2609.26941), same text as test 5.
    const negative = item("quantum-solid-state-invariance", {
      title: "Measurement-Only Dynamical Phase Transitions in Spin-1 Chains",
      abstract:
        "We study measurement-only dynamics in an interacting spin-1 chain, using forced, normalized " +
        "local projections rather than Born-rule-sampled measurement outcomes. Starting from the " +
        "nearest-neighbor (NN) Affleck-Kennedy-Lieb-Tasaki (AKLT) Haldane symmetry-protected topological " +
        "state, we show that competing local projectors drive this order toward three distinct dynamical " +
        "phases: a featureless topologically trivial product state, an explicitly dimerized " +
        "valence-bond-solid state, and a topologically trivial next-nearest-neighbor (NNN) AKLT state " +
        "consisting of two interwoven Haldane chains.",
      tags: ["quant-ph"],
    });
    const profile = { topics: ["solid state"], seedTexts: [BATTERY_PROJECT_TEXT] };
    const smallPool = scoreItems([negative, ...filler(2)], profile, undefined, now);
    const largePool = scoreItems([negative, ...filler(120)], profile, undefined, now);
    const smallResult = smallPool.find((s) => s.id === "quantum-solid-state-invariance")!;
    const largeResult = largePool.find((s) => s.id === "quantum-solid-state-invariance")!;
    expect(smallResult.scoreBreakdown.keyword).toBeCloseTo(largeResult.scoreBreakdown.keyword, 10);
    // Genuinely demoted at BOTH sizes, not merely equal by coincidence.
    const specificity = termSpecificity(canonicalize("solid state"));
    expect(smallResult.scoreBreakdown.keyword).toBeCloseTo((specificity * SENSE_CONTEXT_DEMOTED_GROUNDING) / 1.5, 10);
  });

  it("a real genuine positive gets the identical undemoted keyword score at pool size 3 and 100+", () => {
    // Real OpenAlex item (openalex:W7208706349), same text as test 3.
    const positive = item("solid-state-genuine-invariance", {
      title:
        "A source-linked database of all-solid-state battery electrolyte formulations and performance metrics",
      abstract:
        "This is a source-linked database of all-solid-state battery (ASSB) electrolyte formulations and " +
        "their reported electrochemical performance, extracted from 1,000 peer-reviewed publications.",
    });
    const profile = { topics: ["solid state"], seedTexts: [BATTERY_PROJECT_TEXT] };
    const smallPool = scoreItems([positive, ...filler(2)], profile, undefined, now);
    const largePool = scoreItems([positive, ...filler(120)], profile, undefined, now);
    const smallResult = smallPool.find((s) => s.id === "solid-state-genuine-invariance")!;
    const largeResult = largePool.find((s) => s.id === "solid-state-genuine-invariance")!;
    expect(smallResult.scoreBreakdown.keyword).toBeCloseTo(largeResult.scoreBreakdown.keyword, 10);
    const specificity = termSpecificity(canonicalize("solid state"));
    expect(smallResult.scoreBreakdown.keyword).toBeCloseTo(specificity / 1.5, 10); // undemoted at both sizes
  });

  it("senseContextGate itself: fixedSim and overlapSim are byte-identical regardless of how it is called (no pool input exists to vary)", () => {
    const negative: RawItem = {
      id: "direct-call-check",
      source: "openalex",
      title: "Measurement-Only Dynamical Phase Transitions in Spin-1 Chains",
      authors: [],
      abstract: "valence-bond-solid state quantum spin chain measurement",
      tags: [],
      url: "https://example.test/direct-call-check",
      publishedAt: "2026-09-20",
      metadata: {},
    };
    const first = senseContextGate(negative, "solid state", BATTERY_PROJECT_TEXT);
    const second = senseContextGate(negative, "solid state", BATTERY_PROJECT_TEXT);
    expect(first).toEqual(second);
  });
});

describe("test 14 — rule (c): self-declared different expansion (§1ap AMENDMENT 4 ruling 4, narrowed)", () => {
  const protectiveCases: [string, string][] = [
    ["high-voltage LiCoO2 (LCO)", "We report a high-voltage LiCoO2 (LCO) cathode with a stable interface."],
    ["layered LiCoO2 (LCO)", "Surface coating of layered LiCoO2 (LCO) improves cycling at 4.6 V."],
    [
      "composite lithium cobalt oxide cathodes (LCO)",
      "Emission lines in composite lithium cobalt oxide cathodes (LCO).",
    ],
  ];
  it.each(protectiveCases)("does NOT fire on the protective string: %s", (_label, title) => {
    const paper = item("protective", { title, abstract: "" });
    expect(selfDeclaresDifferentSense(paper, "LCO").differs).toBe(false);
  });

  it("does NOT fire on the manager's own counterexample buried in a longer sentence (regex-check.mjs)", () => {
    // The exact false-positive path B's ORIGINAL (unnarrowed) design would have
    // hit: the shared T2 extractor's long-form window can include up to 5
    // unrelated preceding words with no check that they spell the abbreviation.
    const paper = item("manager-counterexample", {
      title: "We report a high-voltage LiCoO2 (LCO) cathode with a stable interface.",
      abstract: "",
    });
    expect(selfDeclaresDifferentSense(paper, "LCO").differs).toBe(false);
  });

  it("FIRES on two real petroleum 'light cycle oil (LCO)' negatives (openalex, B's saved set)", () => {
    const first = item("lco-petroleum-1", {
      title: "Light Cycle Oil Upgrading to High Quality Fuels and Petrochemicals: A Review",
      abstract: "This review covers the processing of light cycle oil (LCO) into higher-value fuel fractions.",
    });
    const second = item("lco-petroleum-2", {
      title: "Light Cycle Oil Upgrading to Benzene, Toluene, and Xylenes by Hydrocracking: Studies",
      abstract: "Hydrocracking studies on the upgrading of light cycle oil (LCO) to aromatic products.",
    });
    // `declaredLongForm` is the FULL captured long-form window (up to 5 words),
    // not just the matched initials-spelling run inside it — only `differs`/
    // `applies` are the contract callers act on.
    expect(selfDeclaresDifferentSense(first, "LCO")).toMatchObject({ applies: true, differs: true });
    expect(selfDeclaresDifferentSense(second, "LCO")).toMatchObject({ applies: true, differs: true });
    expect(selfDeclaresDifferentSense(first, "LCO").declaredLongForm).toContain("light cycle oil");
    expect(selfDeclaresDifferentSense(second, "LCO").declaredLongForm).toContain("light cycle oil");
  });

  it("is inert for tags with no catalogued abbreviation (electrolyte, solid state)", () => {
    const paper = item("no-abbreviation-tag", {
      title: "Serum electrolyte imbalance and solid state physics have nothing to do with LCO",
      abstract: "",
    });
    expect(selfDeclaresDifferentSense(paper, "electrolyte")).toEqual({ applies: false, differs: false });
    expect(selfDeclaresDifferentSense(paper, "solid state")).toEqual({ applies: false, differs: false });
  });

  it("end-to-end via scoreKeyword: a fired rule (c) contributes NOTHING (not even a demotion) for that tag", () => {
    // Real petroleum item that self-declares a DIFFERENT expansion of "LCO" --
    // exercises the "differs:true -> non-match" path through the actual
    // production entry point, not just the standalone function above.
    const petroleum = item("lco-petroleum-e2e", {
      title: "Light Cycle Oil Upgrading to High Quality Fuels and Petrochemicals: A Review",
      abstract: "This review covers the processing of light cycle oil (LCO) into higher-value fuel fractions.",
    });
    const result = scoreKeyword(petroleum, ["LCO"], {
      grounded: true,
      extendedRequiredMatch: true,
      senseContext: { contextText: BATTERY_PROJECT_TEXT },
    });
    expect(result.matched).toEqual([]); // non-match, not even a demoted entry
    expect(result.score).toBe(0);
  });
});

describe("test 15 — G3 combined-gate components are each load-bearing (§1ap AMENDMENT 4 ruling 6)", () => {
  it("dropping the overlap requirement would wrongly admit a real solid-state residual at full strength", () => {
    // Real OpenAlex item (openalex:W7213934440), the NAMED residual from
    // ABC-JEV-INTEGRATION.md §1ap AMENDMENT 4 ruling 1(c) — clears the fixed
    // floor and the fixed rescue does NOT save it (fixedSim between the two),
    // so only the overlap requirement is what demotes it. Text pulled verbatim
    // from the saved scratchpad fetch, not retyped.
    const residual = item("defect-induced-melting", {
      title: "Defect-Induced Melting and Solid-State Amorphization",
      abstract:
        "Despite the strong interest in melting over the past 100 years, a general theory for the " +
        "crystal-liquid transition has not been established [1]. Lattice instability models, which are " +
        "either vibrational [2], elastic [3], isochoric [4], defective [5] or entropic [6] in nature, all " +
        "predict a melting point somewhat above the experimentally observed thermodynamic melting " +
        "temperature. Here I present a model of melting that is driven by the incorporation into the " +
        "lattice of randomly frozen-in defects, yielding a generic melting diagram that can characterize " +
        "the static disorder present in solid-state amorphization, the thermodynamic stability of small " +
        "clusters and nanocrystalline materials, and the frustration present in spin glasses.",
      tags: [
        "Isochoric process", "Melting point", "Melting-point depression", "Amorphous solid",
        "Crystal (programming language)", "Phase diagram", "Melting curve analysis",
        "Enthalpy of fusion", "Triple point", "Material Dynamics and Properties",
      ],
    });
    const gate = senseContextGate(residual, "solid state", BATTERY_PROJECT_TEXT);
    expect(gate.bypass).toBe(false);
    expect(gate.fixedSim).toBeGreaterThanOrEqual(SENSE_CONTEXT_FIXED_FLOOR); // clears the low floor alone
    expect(gate.fixedSim).toBeLessThan(SENSE_CONTEXT_FIXED_RESCUE); // the rescue path does NOT save it
    expect(gate.overlapSim).toBeLessThan(SENSE_CONTEXT_OVERLAP_FLOOR); // this is what actually demotes it
    expect(gate.pass).toBe(false); // shipped verdict: demoted
    // Direct proof the overlap requirement is load-bearing: a hypothetical
    // "fixed floor alone" gate (G1) would wrongly pass this real item.
    expect(gate.fixedSim >= SENSE_CONTEXT_FIXED_FLOOR).toBe(true);
  });

  it("dropping the fixed-rescue path would wrongly demote a real genuine LCO positive it alone keeps", () => {
    // Real OpenAlex item, a genuine LCO (lithium cobalt oxide) paper whose raw
    // token overlap with the battery-project context falls just short of the
    // overlap floor, but whose fixed-table cosine clears the higher rescue
    // floor on its own -- exactly the trade-off SENSE_CONTEXT_FIXED_RESCUE
    // exists for (measured, docs/jev-abc/SENSE-CONTEXT-C2-20260928T205712Z.md
    // task 3: LCO positive retention 66%→91% versus the plain AND alone).
    const rescued = item("lco-rescue-only", {
      title: "Rapid electrothermal rejuvenation of spent lithium cobalt oxide cathode",
      abstract:
        "A rapid electrothermal method heals spent cathodes. With heteroatom doping, the rejuvenated " +
        "cathodes show improved performance at 4.6 V. This low-cost, eco-friendly method supports " +
        "sustainable high-performance lithium-ion battery supply.",
      // Real source tags matter here (unlike most other fixtures in this file):
      // they are part of what the gate tokenizes, and this fixture's abstract
      // alone is short enough that omitting them changes which side of the
      // rescue floor it lands on — verified against the actual saved fetch.
      tags: [
        "Rejuvenation", "Cathode", "Cobalt", "Cobalt oxide", "Lithium (medication)",
        "Materials science", "Metallurgy", "Oxide", "Chemistry", "Extraction and Separation Processes",
      ],
    });
    const gate = senseContextGate(rescued, "LCO", BATTERY_PROJECT_TEXT);
    expect(gate.bypass).toBe(false);
    // SENSE-CONTEXT-EVIDENCE (§1bg) — REWRITTEN: the document-frequency cut
    // (SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT) removes common connector
    // words from BOTH sides of the overlap axis, which shrinks its
    // denominator (the smaller token set) enough that this fixture's own
    // overlap ratio now ALSO clears the floor — it no longer isolates the
    // rescue path alone the way it did before this item. The item still
    // passes at full strength via BOTH paths now (a strictly SAFER outcome,
    // not a weaker one); the next test proves the rescue floor is still
    // independently load-bearing elsewhere in the real system.
    expect(gate.overlapSim).toBeGreaterThanOrEqual(SENSE_CONTEXT_OVERLAP_FLOOR);
    expect(gate.fixedSim).toBeGreaterThanOrEqual(SENSE_CONTEXT_FIXED_RESCUE); // the rescue path still clears on its own
    expect(gate.pass).toBe(true); // shipped verdict: full strength, undemoted
  });

  it("SENSE-CONTEXT-EVIDENCE (§1bg): the fixed-rescue path is still independently load-bearing under the new axis (real solid-state positive)", () => {
    // Real arXiv item (arxiv:2604.26545), from this item's own saved
    // out/raw-P2.json pool. SENSE-CONTEXT-EVIDENCE (§1bg point 12) —
    // REPLACED again: the P=25 fixture (arxiv:2606.31261) stopped isolating
    // this property once the cut narrowed to P=10 (a gentler cut keeps MORE
    // words on the overlap axis, so that fixture's own overlapSim rose to
    // 0.231 -- above the floor, the AND path clears it too now). This
    // fixture's overlap-axis token set still shares only a small remainder
    // with the battery-project context under P=10 (overlapSim 0.077, below
    // the 0.10 floor -- the AND path's own floor still cannot clear it),
    // while its fixed-table cosine clears the rescue floor comfortably on
    // its own (0.248) -- verified directly against the real exported gate
    // before trusting it, same discipline as every prior swap of this test.
    const rescued = item("solid-state-rescue-only", {
      source: "arxiv",
      title: "Physics-based modeling of cyclic and calendar aging of LIBs with Si-Gr composite anodes",
      abstract:
        "Higher energy density and longer lifetime are the requirements for next-generation lithium-ion " +
        "batteries. A promising anode material is silicon, which offers high specific capacity, but its " +
        "significant volume change during lithiation and delithiation enormously reduces battery " +
        "lifetime. A physical understanding of the processes degrading the battery is key to mitigate " +
        "this effect and advance in the field. We develop a physics-based model to describe degradation " +
        "during battery cycling under various protocols and storage conditions, with varying check-up " +
        "(CU) frequencies. The model can disentangle basic degradation mechanisms, such as the growth of " +
        "the Solid-Electrolyte Interphase (SEI), from silicon mechanisms, such as particle cracking, SEI " +
        "growth on cracks, and loss of active material (LAM). We investigate the impact of CUs on the " +
        "observed storage degradation and the reason behind the increased degradation in batteries, " +
        "including silicon in the anode. Additionally, we relate the observed degradation to operating " +
        "conditions, enabling future optimization of battery use and design.",
    });
    const gate = senseContextGate(rescued, "solid state", BATTERY_PROJECT_TEXT);
    expect(gate.bypass).toBe(false);
    expect(gate.overlapSim).toBeLessThan(SENSE_CONTEXT_OVERLAP_FLOOR); // the AND-only path would reject it
    expect(gate.fixedSim).toBeGreaterThanOrEqual(SENSE_CONTEXT_FIXED_RESCUE); // the rescue path alone saves it
    expect(gate.pass).toBe(true); // shipped verdict: full strength, undemoted
  });
});

describe("test 16 — rule (c) also applies on the T4 path (§1ap AMENDMENT 5 finding 1, HIGH-1 fix)", () => {
  // A2's review (docs/jev-abc/SENSE-CONTEXT-A2-20260928T215456Z.md, FINDING HIGH-1)
  // found that combine.ts's T4 (similarity-only) admission loop never called
  // `selfDeclaresDifferentSense` — so an item rule (c) correctly flags as the wrong
  // sense on the T1/T2/T3 path (contributing nothing there, per AMENDMENT 4.4) could
  // fall straight through to T4 for the SAME tag (T4 runs exactly when
  // `kw.score === 0`) and be admitted there at full strength, with `matchedKeywords`
  // empty (no textual evidence claimed) — a silent, full-strength admission of a
  // paper the reader's own tag disagrees with. AMENDMENT 5 ruling: "contributes
  // nothing for that paper" covers every tier. Constructed, minimal fixtures (the
  // shortest text found that reproduces both the self-declaration AND clears the
  // statistical gate on its own — real, shorter saved fixtures either don't clear
  // the gate or don't self-declare a disagreeing pair; see the C2 checkpoint for the
  // direct sim computation that verified this before writing the test).
  const wrongSense = item("t4-wrong-sense-lco", {
    title: "Light cycle oil (LCO) processing for solid-state battery electrolyte interfaces",
    abstract:
      "We study light cycle oil (LCO) refining relevant to solid-state battery electrolyte interfaces, " +
      "improving ionic conductivity and interfacial stability between electrode materials and " +
      "electrolytes while suppressing dendrite growth.",
  });
  // Protective twin: IDENTICAL shape and surrounding vocabulary, only the declared
  // long form changes to the tag's own known expansion (agrees, rule (c) does not
  // fire) — isolates rule (c)'s agree/disagree distinction as the one thing that
  // changes the outcome, not the vocabulary the statistical gate reacts to.
  const rightSense = item("t4-right-sense-lco", {
    title: "Lithium cobalt oxide (LCO) processing for solid-state battery electrolyte interfaces",
    abstract:
      "We study lithium cobalt oxide (LCO) synthesis relevant to solid-state battery electrolyte " +
      "interfaces, improving ionic conductivity and interfacial stability between electrode materials " +
      "and electrolytes while suppressing dendrite growth.",
  });

  it("confirms the fixture shape: rule (c) differs on the wrong-sense item, agrees on the protective twin", () => {
    expect(selfDeclaresDifferentSense(wrongSense, "LCO").differs).toBe(true);
    expect(selfDeclaresDifferentSense(rightSense, "LCO").differs).toBe(false);
  });

  it("the self-declared-wrong-sense item is NOT admitted by scoreItems for tag 'LCO', even though it clears the statistical gate on its own", () => {
    const scored = scoreItems([wrongSense], { topics: ["LCO"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    // Sanity: confirms this fixture really would reach and clear T4's statistical
    // gate (the failure mode HIGH-1 describes), so an empty result below is the
    // rule (c) T4 check firing, not an accident of the fixture failing the gate too.
    const gate = senseContextGate(wrongSense, "LCO", BATTERY_PROJECT_TEXT);
    expect(gate.pass).toBe(true);
    expect(scored).toEqual([]); // rule (c) on the T4 path: contributes nothing, not admitted
  });

  it("protective twin: the agreeing item IS admitted normally (full T1 grounding, not gated by T4 at all)", () => {
    const scored = scoreItems([rightSense], { topics: ["LCO"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["t4-right-sense-lco"]);
    expect(scored[0].matchedKeywords).toEqual(["LCO"]); // real textual evidence claimed
  });
});

describe("test 17 — SENSE-CONTEXT-R3 (§1ax ruling 1): the strip set also removes a tag's hyphen-joined spelling", () => {
  // Two live wrong-domain "solid state" residuals the pre-fix strip set let
  // through at full strength (real evidence, docs/jev-abc/SENSE-CONTEXT-R3-B-
  // 20260929T075345Z.md §1 + this item's own checkpoint re-measurement): both
  // papers share their heaviest token with the reader's own project text,
  // "solid-state" (an ordinary hyphenated English adjective), but the pre-fix
  // strip set only ever held the SPACE-joined forms {"solid","state","states"}
  // (`expandTerm` canonicalizes first, and canonicalization turns hyphens into
  // spaces) -- so "solid-state" tokenized as ONE token and was never removed,
  // inflating the context-agreement gate as if it were genuine shared
  // vocabulary. The enriched seed-text list below is the reader's REAL,
  // deduped `seedTexts` (`briefToSeedTexts` -> the private `cleanList`,
  // combine.ts's private `senseContextText`) for a request with the battery
  // project text and Required tag "solid state" -- reproduced byte-for-byte
  // (independently verified against the live recorded kwScores, 0.6 and
  // 0.4667, and against the guide's own counterfactual fixedSim/overlapSim
  // values before trusting it). Plain BATTERY_PROJECT_TEXT alone is NOT
  // enough to reproduce this residual -- its similarity to these two papers
  // is already below the rescue floor without the extra generated-query-style
  // repetition real production adds, so a test built on it would pass even
  // without this fix and would not actually be regression-testing anything.
  const ENRICHED_SOLID_STATE_SEED_TEXTS = [
    BATTERY_PROJECT_TEXT,
    "solid state",
    "research",
    "solid-state",
    "battery",
    "materials",
    "focused",
    `solid state ${BATTERY_PROJECT_TEXT}`,
    "solid state research",
    "solid state solid-state",
  ];

  it("real residual: a molecular quantum-optical-storage paper (arxiv:2609.28271) is demoted, not admitted at full strength", () => {
    const paper = item("quantum-storage-r3", {
      source: "arxiv",
      title: "Broadband Quantum Optical Storage with Chemically Engineered Molecular Eu^3+ Complex",
      abstract:
        "Broadband quantum memory devices are essential elements for future quantum networks. Here we " +
        "propose a broadband quantum memory scheme called Hole Anti-hole Grating Echo Memory (HAGEM) for " +
        "rare-earth ions in solids. We provide a Eu^3+ molecular complex with special hyperfine level " +
        "structures of which the hyperfine level separations are in a specific mathematical correlation " +
        "that can be obtained by harnessing chemical engineering. Using the memory protocol and material, " +
        "we experimentally demonstrate a quantum optical storage efficiency of 14.9% and a memory " +
        "bandwidth of 200MHz, which can easily be extended to a few GHz. With this demonstration, we show " +
        "the first quantum application enabled by molecular engineering which cannot be achieved by any " +
        "other existing Eu^3+ solid-state materials. In addition, we provide a framework for the chemical " +
        "engineering of solid-state materials with rare-earth ions for quantum applications consisting of " +
        "material design, synthesis & characterization techniques, and analytical methods for the quantum " +
        "properties of rare-earth (RE) ions in solids. This work establishes a new direction in which " +
        "molecular rare-earth ions can be used for a wide range of quantum applications, which cannot be " +
        "realized by existing solid-state materials. This will greatly facilitate the development of " +
        "molecular quantum emitter systems for real world applications.",
      tags: ["quant-ph", "physics.chem-ph"],
    });
    const scored = scoreItems(
      [paper],
      { topics: ["solid state"], seedTexts: ENRICHED_SOLID_STATE_SEED_TEXTS },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["quantum-storage-r3"]); // stays qualified (DEMOTE, not DROP)
    expect(scored[0].matchedKeywords).toEqual(["solid state"]);
    const specificity = termSpecificity(canonicalize("solid state"));
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo((specificity * SENSE_CONTEXT_DEMOTED_GROUNDING) / 1.5, 4);
  });

  it("real residual: a Thorium-229 phonomagnetometer paper (arxiv:2609.30901) is demoted, not admitted at full strength", () => {
    const paper = item("phonomagnetometer-r3", {
      source: "arxiv",
      title: "Thorium-229 as a Phonomagnetometer",
      abstract:
        "Thorium-229 possesses the only known low-energy nuclear transition suitable for spectroscopy " +
        "with narrowband VUV lasers. While previous experiments have focused on application as a nuclear " +
        "clock, this transition also offers a route to high-accuracy magnetometry. Experimental " +
        "observations of magnetic fields generated by phonons carrying angular momentum remain " +
        "inconclusive, highlighting the need for quantitative tests of the underlying physical " +
        "mechanisms. In this article, we propose doping thorium-229 into a solid-state host to probe " +
        "phonomagnetic fields in situ. We identify Na2ThF6, a chiral stoichiometric thorium compound, as " +
        "a promising host material and evaluate its spectroscopic sensitivity to magnetic interactions " +
        "under two excitation schemes: driving degenerate phonon modes with a circularly polarized " +
        "laser, and applying a temperature gradient. Density functional theory simulations combined with " +
        "quantitative estimates suggest that the temperature-gradient scheme yields a magnetic signal " +
        "that appears too weak to be measurable, while a circularly polarized, high-intensity THz/VUV " +
        "pump-probe driven phonomagnetic response may approach the shot-noise-limited detection " +
        "threshold. While experimental challenges remain, the unique suitability of thorium-229 provides " +
        "a testable pathway toward detecting phonomagnetic fields in a solid-state platform.",
      tags: ["cond-mat.mtrl-sci"],
    });
    const scored = scoreItems(
      [paper],
      { topics: ["solid state"], seedTexts: ENRICHED_SOLID_STATE_SEED_TEXTS },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["phonomagnetometer-r3"]);
    expect(scored[0].matchedKeywords).toEqual(["solid state"]);
    const specificity = termSpecificity(canonicalize("solid state"));
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo((specificity * SENSE_CONTEXT_DEMOTED_GROUNDING) / 1.5, 4);
  });

  it("protective: a genuine short real solid-state-battery paper that writes bare 'solid-state' (not 'all-solid-state') stays at full strength", () => {
    // Real OpenAlex item (openalex:W7212228226), from this item's own saved
    // positive set -- picked because it is short and writes the BARE
    // hyphenated adjective ("Solid-State Batteries" in the title, "solid-state
    // batteries" in the abstract), unlike test 3's fixture, which only ever
    // writes the longer "all-solid-state" token -- a different token the
    // pre-fix strip set already missed too, so it never exercised this fix
    // either way and cannot stand in for this protective case.
    const paper = item("genuine-bare-hyphen-r3", {
      title:
        "Lithium Metal Electroplating Kinetics in Porous Anodes for Lithium-Reservoir-Free Solid-State Batteries",
      abstract:
        "Li-reservoir-free (anode-free) solid-state batteries store no excess Li, so the cell can " +
        "exhibit high energy density compared to Li ion batteries, but cycle life is determined by the " +
        "reversibility of Li plating and stripping.Because the cathode is the only Li source, an average " +
        "Coulombic efficiency short of 100% causes rapid",
    });
    const scored = scoreItems(
      [paper],
      { topics: ["solid state"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["genuine-bare-hyphen-r3"]);
    expect(scored[0].matchedKeywords).toEqual(["solid state"]);
    const specificity = termSpecificity(canonicalize("solid state"));
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(specificity / 1.5, 4); // undemoted, full T1 strength
  });

  it("generalizes to another multi-word tag: a synthetic 'machine learning' tag closes the identical hyphen leak", () => {
    // Constructed, not real (no catalogued real residual for this tag exists
    // -- the point is to prove the fix lives in the general strip-set
    // builder, not a "solid state"-only patch). The wrong-domain paper is
    // genuinely about land-tenure/wildlife-survey methodology and shares NO
    // vocabulary with the reader's machine-learning research context except
    // the incidental, hyphenated mention of the tag's own name -- verified
    // directly (this item's checkpoint) that this exact pair clears the
    // gate's rescue AND overlap floors BEFORE the fix (fixedSim 0.122,
    // overlapSim 0.143 -- wrongly undemoted) and drops to zero shared
    // vocabulary AFTER it (fixedSim 0, overlapSim 0).
    const context = "PhD research on machine-learning methods for protein folding prediction.";
    const wrongDomain = item("machine-learning-wrong-domain", {
      title: "Automated Bird Species Identification from Citizen-Science Photographs",
      abstract:
        "We built a machine-learning photograph classifier to identify bird species from " +
        "citizen-science submissions across several national parks and coastal wetlands.",
    });
    const gate = senseContextGate(wrongDomain, "machine learning", context);
    expect(gate.bypass).toBe(false);
    expect(gate.fixedSim).toBe(0);
    expect(gate.overlapSim).toBe(0);
    expect(gate.pass).toBe(false); // demoted -- the hyphenated tag name is stripped, no vocabulary left to agree on
  });

  it("protective: an unrelated hyphenated word sharing the tag's own token as a mere PREFIX ('state-dependent') is not stripped -- exact-token membership, not substring", () => {
    // If the strip set matched by substring/prefix instead of exact tokens,
    // a hyphenated word built from the tag's own token ("solid state"
    // contributes "state") would be wrongly removed too, silently
    // discarding real shared vocabulary and making an unrelated paper's
    // context agreement look weaker than it truly is. Proven by direct
    // substitution: swapping the shared phrase for an unrelated control of
    // the same shape must LOWER both metrics -- if the phrase were being
    // stripped, its presence or absence would make no difference at all.
    //
    // SENSE-CONTEXT-EVIDENCE (§1bg) — REWRITTEN fixture: the original used
    // "state-of-the-art" and a short, plain control sentence, but
    // "state-of-the-art" itself (6.561) sat just BELOW the document-
    // frequency cut as first shipped (P=25, 6.784) -- excluded from the
    // overlap axis either way, so its presence/absence stopped moving
    // `overlapSim` at all, and (in this short a fixture) both sides'
    // remaining vocabulary happened to fully overlap regardless, saturating
    // the ratio at 1.0 either way. (The cut has SINCE narrowed to P=10,
    // 5.742 -- §1bg point 12 -- under which "state-of-the-art" would stay
    // on the axis; kept on "state-dependent" anyway, below, since an unseen
    // token is immune to any future table or percentile change.)
    // Replaced with "state-dependent" (not in the shipped table, so it
    // keeps the table's own max weight and reliably stays ON the axis) and
    // gave each side one piece of its OWN exclusive, high-weight vocabulary
    // ("thermodynamics" only in the context; "crystallography" only in the
    // items) so neither side's overlap set is trivially a full subset of
    // the other's -- verified directly against the real exported gate
    // (0.667 vs 0.5 overlap, 0.576 vs 0.415 fixed) before trusting it.
    const context =
      "Our lab pursues a state-dependent approach to catalysis and thermodynamics for reaction engineering.";
    const withSharedPhrase = item("state-dependent-shared", {
      title: "Reaction Engineering Advances",
      abstract:
        "This work applies a state-dependent approach to catalysis and crystallography for reaction engineering.",
    });
    const withoutSharedPhrase = item("state-dependent-control", {
      title: "Reaction Engineering Advances",
      abstract:
        "This work applies a completely conventional approach to catalysis and crystallography for reaction engineering.",
    });
    const gateWith = senseContextGate(withSharedPhrase, "solid state", context);
    const gateWithout = senseContextGate(withoutSharedPhrase, "solid state", context);
    expect(gateWith.fixedSim).toBeGreaterThan(gateWithout.fixedSim);
    expect(gateWith.overlapSim).toBeGreaterThan(gateWithout.overlapSim);
  });
});

// SENSE-CONTEXT-EVIDENCE (ABC-JEV-INTEGRATION.md §1bg) — the fold TOKENIZE-PLURALS
// built and reverted (§1be) is now shipped, TOGETHER with a document-frequency cut
// on the overlap axis (the reader's own filler words, e.g. "while"/"focused", drop
// out of it) and a skip rule for a literal match that came through a tag's full
// spelled-out name or chemical formula rather than its bare abbreviation. Guide:
// docs/jev-abc/SENSE-CONTEXT-EVIDENCE-B-20260929T163908Z.md.

describe("test 18 — the 3 parked TOKENIZE-PLURALS-EVIDENCE specs, re-targeted at the shipped fix (§1bg point 8)", () => {
  // Real OpenAlex item (openalex:W7202367926), from B's saved out/raw-P4.json
  // (title only -- this source record carries no abstract). Verbatim from
  // docs/jev-abc/TOKENIZE-PLURALS-C-20260929T141909Z.md's "Deferred specs"
  // section, re-confirmed here against the shipped mechanism (fold + cut),
  // not the naive fold-only version that checkpoint measured.
  const hydrogelElectrolyte = item("plural-only-hydrogel-electrolyte", {
    title:
      "Anti‑freezing cyclodextrin‑modified cellulose eutectic hydrogel electrolytes for ultralong " +
      "cycling low‑temperature zinc‑ion batteries",
    abstract: "",
  });
  // Real PubMed item (pubmed:39215244), from B's saved
  // out/sc-neg-electrolyte-clinical-pubmed.json -- a genuinely wrong-domain
  // (clinical, not battery) real negative that must stay rejected either way.
  const clinicalElectrolyteDisorders = item("plural-only-clinical-electrolyte-disorders", {
    title: "Electrolyte disorders related emergencies in children.",
    abstract:
      "This article provides a comprehensive overview of electrolyte and water homeostasis in pediatric " +
      "patients, focusing on some of the common serum electrolyte abnormalities encountered in clinical " +
      "practice. We will discuss the pathophysiology, clinical manifestations, diagnostic approaches, and " +
      "treatment strategies for each electrolyte disorder. This article aims to enhance the clinical " +
      "approach to pediatric patients with electrolyte imbalance-related emergencies.",
  });

  it("the genuine hydrogel-electrolyte paper now passes the context check (was demoted)", () => {
    const gate = senseContextGate(hydrogelElectrolyte, "electrolyte", BATTERY_PROJECT_TEXT);
    expect(gate.bypass).toBe(false);
    expect(gate.pass).toBe(true);
  });

  it("the real clinical-electrolyte negative STILL fails the context check -- the fold is not a general loosening", () => {
    const gate = senseContextGate(clinicalElectrolyteDisorders, "electrolyte", BATTERY_PROJECT_TEXT);
    expect(gate.bypass).toBe(false);
    expect(gate.pass).toBe(false);
  });

  it("end to end: the hydrogel paper is no longer fully demoted in the final blended score", () => {
    const scored = scoreItems(
      [hydrogelElectrolyte],
      { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual([hydrogelElectrolyte.id]);
    expect(scored[0].matchedKeywords).toEqual(["electrolyte"]);
    const specificity = termSpecificity(canonicalize("electrolyte"));
    const fullGroundingScore = (specificity * 1) / 1.5; // T1 title match, undemoted
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(fullGroundingScore, 4);
  });

  // Honest finding from mutation-testing this item: the 3 specs above (kept
  // verbatim from the deferred checkpoint) turn out to ALSO pass without the
  // fold once the document-frequency cut is active -- the hydrogel paper's
  // one strong shared word with BATTERY_PROJECT_TEXT ("batteries") already
  // matches identically in both texts without folding, so the cut alone
  // (not uniquely the fold) explains their post-fix numbers. Constructed to
  // isolate the fold itself, with no other confound: the ONLY word the two
  // texts share is the same root in different grammatical number, chosen
  // above the document-frequency cut so folding -- not the cut -- is what
  // decides it. Verified directly (fixedSim/overlapSim 0/0 unfolded, 0.341/1
  // folded).
  it("the fold itself is load-bearing, isolated from the cut and the skip rule", () => {
    const context = "Our lab investigates cathode stability under cycling.";
    const pluralOnly = item("fold-isolated-cathodes", {
      title: "A survey of cathodes reported across the literature",
      abstract: "",
    });
    const gate = senseContextGate(pluralOnly, "electrolyte", context);
    expect(gate.bypass).toBe(false);
    expect(gate.pass).toBe(true);
  });
});

describe("test 19 — the overlap-axis document-frequency cut is pinned (§1bg points 1-2, narrowed to P=10 by §1bg point 12)", () => {
  it("today's cut is the table's 10th-percentile weight, 5.742 -- a table rebuild must trip this and force a re-measure", () => {
    // Narrowed from the original P=25 (6.784): a real-paper SET diff (not a
    // count diff) found genuine electrolyte papers demoted at p25; the
    // manager's sweep of {5,8,10,12,15,20,25} picked P=10 as the point
    // nearest the middle of the table's own gap between this reader's
    // non-topical words (at/below "focused" 5.126) and domain words (from
    // "electrode" 6.091) -- see keyword.ts's own doc comment for the full
    // reasoning and the accepted cost this still carries.
    expect(SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE).toBe(10);
    expect(SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT).toBeCloseTo(5.742, 3);
  });
});

describe("test 20 — SENSE-CONTEXT-EVIDENCE's target defect: a full-name match skips the check (§1bg point 3)", () => {
  // Real OpenAlex item (openalex:W7213893763), from the live LCO response this
  // item exists to fix (<scratchpad>/prod-lco-resp-3.json) -- matched via the
  // spelled-out full name "lithium cobalt oxide" (title and abstract both),
  // never demoted before this fix despite being unambiguously the right sense.
  const rightSenseFullName = item("lco-full-name-live-defect", {
    title:
      "A Proof-of-Concept Study on Leaching of Lithium Cobalt Oxide with Electrogenerated Leaching Agents " +
      "from CO2, O2, and H2O",
    abstract:
      "Abstract To leach the metals from lithium cobalt oxide (LCO) from batteries more sustainably, the " +
      "application of electrochemically generated leaching agents from mainly CO2, O2, and H2O is " +
      "presented. Therefore, CO2 was reduced to formic acid/formate and O2 was reduced to H2O2, each with " +
      "high Faradaic efficiency (> 85%) at gas diffusion electrodes. Formate and H2O2 were used " +
      "individually or together to leach lithium and cobalt from LCO. When used together, mainly lithium " +
      "was extracted while cobalt precipitated as insoluble cobalt phosphate, which allows efficient " +
      "separation. Furthermore, lithium and cobalt could be leached almost quantitatively (Co: 99.6 +/- " +
      "2.2%, Li: 92.7 +/- 1.7%) by acidification with remarkably low amounts of sulfuric acid. In " +
      "summary, this innovative feasibility study demonstrates that electrochemically generated leaching " +
      "agents from air and water are a promising alternative to the conventional leaching methods.",
    tags: [
      "Cobalt", "Leaching (pedology)", "Cobalt oxide", "Sulfuric acid", "Formate", "Formic acid", "Oxide",
      "Lithium cobalt oxide", "Extraction and Separation Processes", "Metal Extraction and Bioleaching",
    ],
  });
  // Real arXiv item (arxiv:2608.18563), same live response -- a completely
  // different compound (the La2CuO4 cuprate) that also happens to abbreviate
  // to "LCO" and must stay demoted: it never spells out "lithium cobalt
  // oxide" or "LiCoO2" anywhere, so the skip rule must not touch it.
  const wrongSenseCuprate = item("lco-cuprate-stays-demoted", {
    source: "arxiv",
    title: "Magnetism and Electrical Conduction in Lightly-Doped Single-Layer High-Tc Cuprate La2CuO4+δ",
    abstract:
      "The temperature dependences of magnetization and electrical resistivity as well as their magnetic " +
      "field dependences have been examined in lightly-doped single-layer cuprate La2CuO4+δ (LCO, " +
      "hole-doping level p (2δ) cong 0.03) single crystals, in comparison with those in the extremely low " +
      "doping region of p lesssim 0.015 to uncover the intrinsic magnetism and electrical conduction of " +
      "the Cu-O plane that exhibits both antiferromagnetic (AF) and superconducting (SC) orders " +
      "simultaneously. In p cong 0.03 SC LCO, the sub-lattice moments on Cu sites and their AF couplings " +
      "are only sim 15% smaller than those of the Mott-insulator parent material, suggesting that the " +
      "localization of Cu 3d electrons remains very strong. Furthermore, we report that in the SC LCO, " +
      "two-dimensional AF spin correlations develop rapidly from T* cong 280 K towards Neel temperature " +
      "TN = 266 K, where the out-of-plane resistivity starts to decrease largely. This might be " +
      "responsible for the AF ordering at such a high temperature in the SC single-layer cuprate with p " +
      "cong 0.03.",
    tags: ["cond-mat.supr-con"],
  });

  it("the right-sense paper reaches FULL STRENGTH (the live defect this item exists to fix)", () => {
    const scored = scoreItems([rightSenseFullName], { topics: ["LCO"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([rightSenseFullName], { topics: ["LCO"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual([rightSenseFullName.id]);
    expect(scored[0].matchedKeywords).toEqual(["LCO"]);
    // Full strength = identical to the no-context-declared (bypass) baseline.
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4);
    expect(matchesFullNameOrFormula(rightSenseFullName, "LCO")).toBe(true);
    // Honest note, found by execution while mutation-testing this item: for
    // THIS specific real paper, the skip rule is not the only thing that now
    // rescues it -- once folded and cut, its own statistical gate also
    // independently clears the AND path (fixedSim 0.0496 >= 0.015, overlapSim
    // 0.1111 >= 0.10), so removing the skip rule alone does not flip THIS
    // fixture (both mechanisms happen to agree on this one real paper). The
    // next test uses a minimal, deliberately thin-vocabulary fixture that
    // isolates the skip rule as the ONLY thing keeping it undemoted.
  });

  it("SENSE-CONTEXT-EVIDENCE (§1bg): a minimal full-name/formula-only match, with no other shared vocabulary, is rescued ONLY by the skip rule", () => {
    // Constructed to isolate the skip rule: a single full-name mention and
    // nothing else that overlaps BATTERY_PROJECT_TEXT at all (verified
    // directly: senseContextGate on this fixture is fixedSim=0, overlapSim=0
    // -- the statistical gate fails outright, so ONLY the skip rule can save
    // it). This is the fixture the skip-rule mutation must flip.
    const minimalFullName = item("lco-minimal-full-name", {
      title: "Structural analysis of lithium cobalt oxide thin films",
      abstract: "",
    });
    const minimalFormula = item("lco-minimal-formula", {
      title: "Structural analysis of LiCoO2 thin films by electron diffraction",
      abstract: "",
    });
    for (const paper of [minimalFullName, minimalFormula]) {
      const gate = senseContextGate(paper, "LCO", BATTERY_PROJECT_TEXT);
      expect(gate.pass).toBe(false); // the statistical axis alone would demote it
      const scored = scoreItems([paper], { topics: ["LCO"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
      const bypassed = scoreItems([paper], { topics: ["LCO"] }, undefined, now);
      expect(scored[0].matchedKeywords).toEqual(["LCO"]);
      expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4); // full strength
    }
  });

  it("the wrong-sense cuprate STAYS demoted -- the skip rule never fires for it (bare-form-only match)", () => {
    expect(matchesFullNameOrFormula(wrongSenseCuprate, "LCO")).toBe(false);
    const scored = scoreItems([wrongSenseCuprate], { topics: ["LCO"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([wrongSenseCuprate], { topics: ["LCO"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual([wrongSenseCuprate.id]);
    expect(scored[0].matchedKeywords).toEqual(["LCO"]); // demoted, not dropped
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword);
  });
});

describe("test 21 — skip-rule classifier: matchesFullNameOrFormula (§1bg point 3)", () => {
  it("a bare-form-only match does NOT skip the check", () => {
    const bareOnly = item("lco-bare-only", {
      title: "A degradation study of the LCO cathode under fast-charging conditions",
      abstract: "We cycle LCO cathodes at high rate and report capacity fade for the LCO cell chemistry.",
    });
    expect(matchesFullNameOrFormula(bareOnly, "LCO")).toBe(false);
  });

  it("a full-name-only match (never the bare abbreviation) skips", () => {
    const fullNameOnly = item("lco-full-name-only", {
      title: "Degradation of lithium cobalt oxide cathodes under fast-charging conditions",
      abstract: "We cycle lithium cobalt oxide cathodes at high rate and report capacity fade.",
    });
    expect(matchesFullNameOrFormula(fullNameOnly, "LCO")).toBe(true);
  });

  it("a chemical-formula-only match (LiCoO2, never 'LCO' or the full name) skips", () => {
    const formulaOnly = item("lco-formula-only", {
      title: "Degradation of LiCoO2 cathodes under fast-charging conditions",
      abstract: "We cycle LiCoO2 cathodes at high rate and report capacity fade for this cell chemistry.",
    });
    expect(matchesFullNameOrFormula(formulaOnly, "LCO")).toBe(true);
  });

  it("a real petroleum 'light cycle oil (LCO)' negative is never classified full-form for the battery tag", () => {
    // Real OpenAlex item (openalex:W2897424722), the same real text test 6
    // uses -- self-declares an abbreviation pair, but "light cycle oil" is
    // not one of LCO's known expansions, so it must never be misread as
    // agreeing evidence by this classifier either.
    const petroleum = item("petroleum-lco-classifier", {
      title: "Separation of aromatic components from light cycle oil by solvent extraction",
      abstract:
        "To improve the versatility of light cycle oil (LCO), separation of aromatic compounds from LCO " +
        "by solvent extraction was investigated. LCO was analyzed to identify 35 components: 19 aromatics " +
        "and 16 alkanes.",
    });
    expect(matchesFullNameOrFormula(petroleum, "LCO")).toBe(false);
  });

  it("is inert for tags with no catalogued abbreviation (electrolyte, solid state)", () => {
    const paper = item("no-abbreviation-tag-skip-rule", {
      title: "Serum electrolyte imbalance and solid state physics have nothing to do with lithium cobalt oxide",
      abstract: "",
    });
    expect(matchesFullNameOrFormula(paper, "electrolyte")).toBe(false);
    expect(matchesFullNameOrFormula(paper, "solid state")).toBe(false);
  });

  it("rule (c) keeps precedence: a self-declared DIFFERENT expansion is a hard non-match even when the tag's true full name also appears elsewhere in the same paper", () => {
    // Constructed: the paper self-declares "light cycle oil (LCO)" (rule (c)
    // fires -- a disagreeing expansion) AND separately mentions "lithium
    // cobalt oxide" elsewhere (which would, on its own, satisfy the skip
    // rule). Rule (c) runs first and unconditionally `continue`s past the
    // topic in scoreKeyword's loop, so the skip rule never gets a chance to
    // run at all -- the item contributes nothing, exactly as rule (c) alone
    // would produce.
    const both = item("rule-c-precedence", {
      title: "Comparing light cycle oil (LCO) refining byproducts against lithium cobalt oxide battery scrap",
      abstract:
        "This survey contrasts petroleum light cycle oil (LCO) composition with unrelated lithium cobalt " +
        "oxide battery recycling streams, two unconnected industrial byproduct classes.",
    });
    expect(selfDeclaresDifferentSense(both, "LCO").differs).toBe(true);
    expect(matchesFullNameOrFormula(both, "LCO")).toBe(true); // the classifier alone WOULD skip
    const result = scoreKeyword(both, ["LCO"], {
      grounded: true,
      extendedRequiredMatch: true,
      senseContext: { contextText: BATTERY_PROJECT_TEXT },
    });
    expect(result.matched).toEqual([]); // rule (c) wins: contributes nothing, not even demoted
    expect(result.score).toBe(0);
  });
});

describe("test 22 — a sampled negatives tripwire, one real negative per tag (§1bg point 8)", () => {
  it("a real clinical-electrolyte negative still fails the context check", () => {
    // Real PubMed item (pubmed:18486713), from out/sc-neg-electrolyte-clinical-pubmed.json.
    const paper = item("neg-sample-electrolyte", {
      source: "pubmed",
      title: "Approach to fluid and electrolyte disorders and acid-base problems.",
      abstract:
        "Employing a systematic approach to the interpretation of serum chemistries is the most effective " +
        "way to ensure abnormalities are detected and correctly interpreted. This article reviews a " +
        "series of steps that can be used in both the outpatient and inpatient settings. These steps " +
        "will help to ensure the clinician identifies not only overt abnormalities but also subtle " +
        "disturbances that may lay hidden in a routine set of serum chemistry values.",
      tags: [
        "Acid-Base Imbalance", "Acute Disease", "Chlorides", "Chronic Disease", "Humans", "Hyperkalemia",
        "Hypernatremia", "Hypokalemia", "Hyponatremia", "Water-Electrolyte Balance", "Water-Electrolyte Imbalance",
      ],
    });
    const gate = senseContextGate(paper, "electrolyte", BATTERY_PROJECT_TEXT);
    expect(gate.bypass).toBe(false);
    expect(gate.pass).toBe(false);
  });

  it("a real physics 'solid state' negative still fails the context check", () => {
    // Real OpenAlex item (openalex:W1639895858), from out/sc-neg-solid-state-openalex.json.
    const paper = item("neg-sample-solid-state", {
      title: "Valence-Bond-Solid state entanglement in a 2-D Cayley tree",
      abstract:
        "The Valence-Bond-Solid (VBS) states are in general ground states for certain gapped models. We " +
        "consider the entanglement of VBS states on a two-dimensional Cayley tree. We show that the " +
        "entropy of the reduced density operator does not depend on the whole size of the Cayley tree. We " +
        "also show that asymptotically, the entropy is liearly proportional to the number of singlet " +
        "states cut by the reduced density operator of the VBS state.",
      tags: [
        "Quantum entanglement", "Singlet state", "Operator (biology)", "Valence bond theory",
        "Entropy (arrow of time)", "Valence (chemistry)", "Physics", "Quantum mechanics", "Mathematics", "Quantum",
      ],
    });
    const gate = senseContextGate(paper, "solid state", BATTERY_PROJECT_TEXT);
    expect(gate.bypass).toBe(false);
    expect(gate.pass).toBe(false);
  });

  it("a real petroleum 'LCO' negative still fails the context check (same real text as test 6/14)", () => {
    // Real OpenAlex item (openalex:W2897424722), from out/sc-neg-lco-openalex.json.
    const paper = item("neg-sample-lco", {
      title: "Separation of aromatic components from light cycle oil by solvent extraction",
      abstract:
        "To improve the versatility of light cycle oil (LCO), separation of aromatic compounds from LCO " +
        "by solvent extraction was investigated. LCO was analyzed to identify 35 components: 19 aromatics " +
        "and 16 alkanes. The batch liquid–liquid equilibrium extraction of LCO was performed using " +
        "furfural, sulfolane, and methanol as extraction solvents.",
      tags: ["Sulfolane", "Chemistry", "Solvent", "Extraction (chemistry)", "Light crude oil", "Solvent extraction"],
    });
    // Direct axis check -- independent of rule (c), which already separately
    // intercepts this exact fixture (test 6/14).
    const gate = senseContextGate(paper, "LCO", BATTERY_PROJECT_TEXT);
    expect(gate.bypass).toBe(false);
    expect(gate.pass).toBe(false);
  });
});

// SENSE-CONTEXT-EVIDENCE (§1bg point 12) — the cut narrowed from P=25 to
// P=10 after a real-paper SET diff (not the count diff test 18-22 above
// were written against) found genuine electrolyte papers demoted at p25.
// Reader context throughout: the SAME `BATTERY_PROJECT_TEXT` constant every
// other electrolyte test in this file already uses (not the enriched
// solid-state-specific seed-text list test 17 builds for the R3 residuals).

describe("test 23 — P=10 protective tests from real saved papers (§1bg point 12c)", () => {
  it("openalex:W7172267740 (PVA gel polymer electrolytes) stays at full strength at P=10", () => {
    // Real OpenAlex item, title-only (no abstract in the saved record). The
    // one genuine core-topic loss the manager's sweep found at p20/p25 --
    // must stay undemoted at the shipped P=10.
    const paper = item("p10-protective-w7172267740", {
      title:
        "Size-dependent ionic mobility enhancement in graphene-oxide-doped PVA gel polymer electrolytes: " +
        "a generalized transport model",
      abstract: "",
    });
    const scored = scoreItems([paper], { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([paper], { topics: ["electrolyte"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual([paper.id]);
    expect(scored[0].matchedKeywords).toEqual(["electrolyte"]);
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(bypassed[0].scoreBreakdown.keyword, 4);
  });

  it("openalex:W7204716846 (electrolytic plasma treatment of metals) stays demoted at P=10 -- never promoted to a wrong-field full-strength gain", () => {
    // Real OpenAlex item -- metallurgy/surface-finishing, not battery
    // materials. One of the 2 wrong-field papers the manager's sweep found
    // promoted to full strength at p20/p25; must stay demoted at p10 (0
    // wrong-field gains is one of the confirmed bars for this cut).
    const paper = item("p10-protective-w7204716846", {
      title: "Effect of Electrolyte Composition on Electrolytic Plasma Treatment of Metals",
      abstract:
        "Abstract Experimental studies and analysis of the results of electrolyte-plasma treatment of " +
        "copper, steel, and brass products using an electric discharge with weak and strong electrolytes " +
        "were conducted. The samples were treated by immersing a metal anode (the product being treated) " +
        "in a liquid (non-metallic) cathode. The surfaces of the metals were analyzed before and after " +
        "treatment with various electrolyte solutions.",
    });
    const scored = scoreItems([paper], { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([paper], { topics: ["electrolyte"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual([paper.id]);
    expect(scored[0].matchedKeywords).toEqual(["electrolyte"]);
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword);
  });

  it("arxiv:2608.14351 (propylene epoxidation electrocatalysts) stays demoted at P=10 -- never promoted to a wrong-field full-strength gain", () => {
    // Real arXiv item -- industrial catalysis, not battery materials. The
    // other of the 2 wrong-field papers the manager's sweep found promoted
    // to full strength at p20/p25; must stay demoted at p10.
    const paper = item("p10-protective-arxiv260814351", {
      source: "arxiv",
      title: "Multidimensional Design of Metal-Nitrogen-Carbon Electrocatalysts for Direct Propylene Epoxidation",
      abstract:
        "Propylene oxide is a major industrial chemical whose production currently relies on hazardous " +
        "chlorine- or peroxide-based oxidants. Direct electrochemical epoxidation using water as the " +
        "oxygen source offers a sustainable alternative, but controlling oxygen-atom transfer against the " +
        "competing oxygen evolution reaction remains a fundamental challenge. Here, we show that propylene " +
        "epoxidation selectivity cannot be described by oxygen binding energy alone, but is jointly " +
        "governed by oxygen adsorption, the potential of zero charge, and applied potential. By combining " +
        "theoretical calculations with pH-field-coupled microkinetic modeling across 41 metal-nitrogen-" +
        "carbon single-atom catalysts, we first identified an optimal oxygen-binding window and Co as the " +
        "most favorable metal center. We then found that peripheral substituents can tune the PZC while " +
        "largely preserving the optimal oxygen adsorption energetics, thereby providing an independent " +
        "design dimension to further optimize the already favorable Co active site. This sequential, " +
        "multidimensional design strategy identified CoPc-NH2-CNT as the optimal catalyst, delivering a " +
        "record PO Faradaic efficiency of 70-80 percent for direct propylene epoxidation in aqueous " +
        "electrolyte under ambient conditions. These results establish interfacial electrostatics as an " +
        "independently tunable design dimension for controlling selective oxygen-atom transfer in " +
        "electrocatalysis.",
    });
    const scored = scoreItems([paper], { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([paper], { topics: ["electrolyte"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual([paper.id]);
    expect(scored[0].matchedKeywords).toEqual(["electrolyte"]);
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword);
  });

  it("arxiv:2609.08721 (TEMPO catholytes) stays DEMOTED at P=10 -- accepted cost, §1bg.12b", () => {
    // Real arXiv item -- a genuine aqueous redox-flow battery electrolyte-
    // degradation paper, adjacent to but not the reader's own solid-state
    // chemistry. This is the ONE named, accepted cost of shipping P=10
    // (keyword.ts's own doc comment on SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE
    // gives the full reasoning and the threshold for B to revisit). A T1
    // literal hit is never dropped -- it stays qualified, just demoted.
    // Tripwire, not a claim of correctness: if this ever asserts full
    // strength again without a deliberate axis redesign, the cut has
    // silently moved and needs the same re-measurement this ruling required.
    const paper = item("p10-accepted-cost-arxiv260908721", {
      source: "arxiv",
      title: "Competing Ring-Opening and Hofmann Elimination Pathways in Aqueous TEMPO Catholytes: A First-Principles Study",
      abstract:
        "Aqueous redox-flow batteries based on TEMPO derivatives are promising for large-scale energy " +
        "storage, but their practical use is limited by the chemical instability of the oxidized N " +
        "-oxoammonium state. In this work, we investigate the degradation of five TEMPO derivatives using " +
        "ab initio molecular dynamics combined with enhanced sampling. Two proposed degradation " +
        "mechanisms, ring opening and Hofmann elimination, are examined and their corresponding " +
        "activation free energies are compared. For all derivatives considered, ring opening exhibits a " +
        "lower activation free energy than Hofmann elimination, identifying it as the kinetically " +
        "preferred degradation pathway. The magnitude of the ring-opening barrier, however, varies " +
        "significantly between molecules, showing that different functionalizations strongly influence " +
        "its stability toward degradation. The predicted preference for ring opening is consistent with " +
        "available experimental studies, which have identified or inferred ring-opening degradation for " +
        "several TEMPO-based catholytes. These results provide an atomistic picture of degradation " +
        "pathways that are difficult to resolve experimentally and highlight the importance of molecular " +
        "structure in controlling the kinetic stability of TEMPO derivatives in aqueous electrolytes.",
    });
    const scored = scoreItems([paper], { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const bypassed = scoreItems([paper], { topics: ["electrolyte"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual([paper.id]); // qualified, not dropped
    expect(scored[0].matchedKeywords).toEqual(["electrolyte"]);
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(bypassed[0].scoreBreakdown.keyword); // demoted
  });

  it("openalex:W7203865202 (proton-conducting electrolytes for reversible solid oxide cells) stays DEMOTED at P=10 -- accepted cost 2, §1bg.13c", () => {
    // Real OpenAlex item -- a genuine electrolyte-materials review, but for a
    // fuel-cell/electrolyzer device class (protons, 400-600 C ceramics), not
    // the reader's own lithium/sodium-ion battery focus. A third real loss a
    // fresh A2 found by execution that this file's own tooling (the STOP
    // round's sweep script) had silently dropped from its loss/gain tables
    // instead of flagging -- see keyword.ts's own doc comment on
    // SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE for the full accepted-cost
    // reasoning and the §1bg.12b threshold this does NOT cross (an adjacent
    // device class, not the reader's own core topic). Same treatment as the
    // arxiv:2609.08721 tripwire above: a T1 literal hit is never dropped, it
    // stays qualified, just demoted. Tripwire, not a claim of correctness --
    // if this ever asserts full strength again without a deliberate axis
    // redesign, the cut has silently moved and needs the same re-measurement
    // this ruling required.
    const paper = item("p10-accepted-cost2-w7203865202", {
      title: "Recent Advances and Future Perspectives of Proton-Conducting Electrolytes for Reversible Solid Oxide Cells",
      abstract:
        "Proton-conducting reversible solid oxide cells (P-RSOCs) are emerging as a transformative " +
        "platform for efficient and flexible conversion between electricity and chemical fuels, " +
        "including hydrogen and syngas. Their intermediate-temperature operation (400-600 °C) offers " +
        "a compelling combination of high energy efficiency, rapid reaction kinetics, and strong " +
        "compatibility with renewable electricity and industrial waste heat, positioning P-RSOCs as a " +
        "promising technology for a carbon-neutral energy future. At the heart of these devices lies " +
        "the proton-conducting electrolyte, which governs proton transport, chemical stability, " +
        "interfacial compatibility, and long-term durability. Despite remarkable advances in " +
        "electrolyte development, fundamental challenges in understanding and controlling proton " +
        "transport, chemical stability, and electrode-electrolyte interactions continue to constrain " +
        "practical deployment. This review presents a comprehensive and critical assessment of the " +
        "current state of proton-conducting electrolytes for P-RSOCs, with emphasis on proton " +
        "transport mechanisms, composition-structure-property relationships, stability limitations, " +
        "and interfacial compatibility. We examine advances in perovskite-based and emerging " +
        "alternative electrolyte families, while highlighting key strategies─including aliovalent " +
        "doping, interfacial engineering, microstructure design, and advanced fabrication─for " +
        "overcoming persistent limitations. Emerging operando characterization and computational " +
        "approaches are further discussed as powerful tools for uncovering dynamic transport and " +
        "degradation mechanisms and accelerating materials discovery. By integrating fundamental " +
        "insights with materials-design strategies, this review identifies critical knowledge gaps " +
        "and opportunities to guide the development of robust, high-performance electrolytes. " +
        "Ultimately, we envision that such advances will help unlock the full potential of P-RSOCs as " +
        "a versatile platform for sustainable energy conversion, storage, and renewable-fuel " +
        "production.",
    });
    // METHOD NOTE (§1bg.13a): this is a real REVIEW-type paper (its own
    // title says "Review"), and the sibling tests' bypass technique
    // (`scoreItems([paper], {topics:["electrolyte"]})` with no seedTexts)
    // silently returns an EMPTY array for it -- combine.ts's own
    // `shouldPushReviewPaper` pass-2 filter reads that same (here, empty)
    // `seedTexts` field for an unrelated purpose and drops review-flagged
    // items unless they directly match real declared project text. This is
    // exactly the confound A2 found in the implementer's own measurement
    // tooling (§1bg.13, Findings) -- reproduced live here by this very
    // fixture. Fixed the same way A2 fixed it: compare via `scoreKeyword()`
    // DIRECTLY (the function the fold/cut/skip-rule actually live inside),
    // never through `combine.ts`, so `shouldPushReviewPaper` never runs.
    const scored = scoreItems([paper], { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] }, undefined, now);
    const direct = scoreKeyword(paper, ["electrolyte"], {
      grounded: true,
      extendedRequiredMatch: true,
      senseContext: { contextText: BATTERY_PROJECT_TEXT },
    });
    const ceiling = scoreKeyword(paper, ["electrolyte"], {
      grounded: true,
      extendedRequiredMatch: true,
      senseContext: { contextText: "" }, // empty context -> senseContextGate's own bypass path, full grounding
    });
    expect(scored.map((s) => s.id)).toEqual([paper.id]); // qualified, not dropped from the real pipeline
    expect(scored[0].matchedKeywords).toEqual(["electrolyte"]);
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(direct.score, 10); // scoreItems agrees with the direct call
    expect(direct.score).toBeLessThan(ceiling.score); // demoted
  });
});
