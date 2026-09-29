import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { scoreItems, REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT } from "./combine";
import {
  scoreKeyword,
  isShortOrAmbiguous,
  senseContextGate,
  selfDeclaresDifferentSense,
  SENSE_CONTEXT_DEMOTED_GROUNDING,
  SENSE_CONTEXT_FIXED_FLOOR,
  SENSE_CONTEXT_OVERLAP_FLOOR,
  SENSE_CONTEXT_FIXED_RESCUE,
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

  it("protective: an unrelated hyphenated word sharing the tag's own token as a mere PREFIX ('state-of-the-art') is not stripped -- exact-token membership, not substring", () => {
    // If the strip set matched by substring/prefix instead of exact tokens,
    // "state-of-the-art" (tag "solid state" contributes the token "state")
    // would be wrongly removed too, silently discarding real shared
    // vocabulary and making an unrelated paper's context agreement look
    // weaker than it truly is. Proven by direct substitution: swapping the
    // shared phrase for an unrelated control of the same shape must LOWER
    // both metrics -- if "state-of-the-art" were being stripped, its
    // presence or absence would make no difference at all.
    const context = "Our lab pursues a state-of-the-art approach to catalysis research and reaction engineering.";
    const withSharedPhrase = item("state-of-the-art-shared", {
      title: "Reaction Engineering Advances",
      abstract: "This work applies a state-of-the-art approach to catalysis in reaction engineering.",
    });
    const withoutSharedPhrase = item("state-of-the-art-control", {
      title: "Reaction Engineering Advances",
      abstract: "This work applies a completely conventional approach to catalysis in reaction engineering.",
    });
    const gateWith = senseContextGate(withSharedPhrase, "solid state", context);
    const gateWithout = senseContextGate(withoutSharedPhrase, "solid state", context);
    expect(gateWith.fixedSim).toBeGreaterThan(gateWithout.fixedSim);
    expect(gateWith.overlapSim).toBeGreaterThan(gateWithout.overlapSim);
  });
});
