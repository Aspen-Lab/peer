import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import {
  scoreItems,
  REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT,
  REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC,
  REQUIRED_TAG_T4_WEIGHT,
} from "./combine";
import {
  matchesSelfDeclaredAbbreviation,
  matchesSourceTag,
  scoreKeyword,
  REQUIRED_TAG_T2_GROUNDING,
  REQUIRED_TAG_T3_GROUNDING,
  SENSE_CONTEXT_DEMOTED_GROUNDING,
} from "./keyword";
import { canonicalize, termSpecificity } from "./term-expand";
import { selectedSenseConcept } from "@/lib/feed/senses";

// REQUIRED-GATE (ABC-JEV-INTEGRATION.md §1ao/§1an) — tests 2-10 of
// docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md §4.1 (test 1, "T1
// unaffected", is covered by term-expand.test.ts/admission.test.ts/
// ranking.test.ts running unmodified — none of their ~15 scoreKeyword calls
// pass the new `extendedRequiredMatch` flag, so T1's own code path is
// untouched by construction).

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

describe("T2 — self-declared abbreviation", () => {
  it("real fixture: correctly extracts the LCO-defining pair, not the unrelated LIXS pair in the same abstract", () => {
    // Real OpenAlex item (openalex:W7166694764), verified in
    // docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md §2.4. The TITLE
    // self-declares an unrelated pair ("...XUV Spectroscopy (LIXS)"); the
    // regex must scan past it to the ABSTRACT's separate, genuinely
    // LCO-defining pair rather than stopping at the first match found.
    const paper = item("lco-t2-real", {
      title:
        "Spatial Heterogeneity of the Fluorine-to-Lithium Ratio as a Descriptor of Battery Failure by Laser-Induced XUV Spectroscopy (LIXS)",
      abstract:
        "Here, laser-induced XUV spectroscopy (LIXS) was used to map fluorine- and lithium-related " +
        "emission lines in composite lithium cobalt oxide cathodes (LCO).",
    });
    expect(matchesSelfDeclaredAbbreviation(paper, canonicalize("LCO"))).toBe(true);
    // Honest note (not hidden): T1 ALSO independently admits this exact
    // fixture, because the abstract's own "(LCO)" is itself a literal match
    // for the tag "LCO" — B measured the same redundancy on real data
    // (§2.4's "‡" footnote: T2/T3 always added 0 to the P-LCO total because
    // T1 already caught every in-window item there). This assertion checks
    // T2's REGEX EXTRACTION is correct (finds the right pair, not the
    // title's unrelated one), which is what could silently break; test 2c
    // below isolates T2 as the SOLE admitting technique.
    const scored = scoreItems([paper], { topics: ["LCO"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["lco-t2-real"]);
  });

  it("protective sibling: an unrelated self-declared pair does not falsely qualify a different tag", () => {
    const paper = item("unrelated-abbr", {
      title: "A survey of laser-induced XUV spectroscopy (LIXS) instrumentation",
      abstract: "This review covers detector design only; no cathode chemistry is discussed.",
    });
    expect(matchesSelfDeclaredAbbreviation(paper, canonicalize("LCO"))).toBe(false);
    const scored = scoreItems([paper], { topics: ["LCO"] }, undefined, now);
    expect(scored).toEqual([]);
  });

  it("isolates T2 as the SOLE admitting technique (mutation target: deleting the T2 branch must fail this)", () => {
    // `matchesSelfDeclaredAbbreviation` always reads item.title+item.abstract
    // directly, regardless of scope — but T1's own haystack under
    // `scope: "titleAndSummary"` swaps `abstract` out for a DIFFERENT field
    // (`gateText`, see keyword.ts's itemText()). Putting the self-declared
    // pair ONLY in `abstract` and scoring with that scope therefore makes T1
    // structurally unable to see it, while T2 (which ignores scope) still
    // finds it — a genuine, mutation-sensitive isolation of T2 from T1,
    // unlike the fixture above where the two happen to coincide.
    const paper = item("lco-t2-isolated", {
      title: "Recycling process for spent battery scrap",
      abstract: "A green-solvent route for lithium cobalt oxide (LCO) cathode recovery.",
    });
    const withT2 = scoreKeyword(paper, ["LCO"], {
      scope: "titleAndSummary",
      extendedRequiredMatch: true,
    });
    expect(withT2.score).toBeGreaterThan(0);
    expect(withT2.matched).toEqual(["LCO"]);
    const withoutExtension = scoreKeyword(paper, ["LCO"], {
      scope: "titleAndSummary",
    });
    expect(withoutExtension.score).toBe(0);
  });
});

describe("T3 — source-provided subject tag", () => {
  it("fires on a source-provided subject tag matching the Required tag", () => {
    const paper = item("lco-t3", {
      title: "Recycling process for spent cathode scrap",
      abstract: "A green-solvent recovery route for battery cathode materials.",
      tags: ["Lithium cobalt oxide"],
    });
    expect(matchesSourceTag(paper, canonicalize("LCO"))).toBe(true);
    const scored = scoreItems([paper], { topics: ["LCO"] }, undefined, now);
    expect(scored.map((s) => s.id)).toEqual(["lco-t3"]);
  });

  it("protective sibling: an unrelated source tag does not falsely qualify", () => {
    const paper = item("unrelated-tag", {
      title: "Recycling process for spent scrap",
      abstract: "A general recovery route for consumer electronics.",
      tags: ["Unrelated Concept"],
    });
    expect(matchesSourceTag(paper, canonicalize("LCO"))).toBe(false);
    const scored = scoreItems([paper], { topics: ["LCO"] }, undefined, now);
    expect(scored).toEqual([]);
  });

  it(
    "documented limitation, not a bug: itemText() already folds item.tags into T1's own haystack " +
      "in every scope, so unlike T2, T3 can never be isolated as the sole admitting technique for " +
      "the SAME item — matchesSourceTag's own doc comment records why, and B's real-data measurement " +
      "independently found T3adds = 0 in all four profiles for the same structural reason",
    () => {
      const paper = item("lco-t3-redundant-with-t1", {
        title: "Unrelated title",
        abstract: "",
        tags: ["Lithium cobalt oxide"],
      });
      // T3 says yes...
      expect(matchesSourceTag(paper, canonicalize("LCO"))).toBe(true);
      // ...but so does plain T1, on the exact same item, because tags are
      // already part of T1's haystack (pre-existing, unmodified behavior).
      const t1Only = scoreKeyword(paper, ["LCO"], {});
      expect(t1Only.score).toBeGreaterThan(0);
    },
  );
});

describe("T4 — tag-anchored topical similarity", () => {
  it("admits a real paraphrase with no literal Required-tag phrase (the original EMPTY-HOME regression)", () => {
    // Real OpenAlex item (openalex:W7212367127), verified in
    // docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md §2.4 and re-measured
    // (anchored) in docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md §1.
    // Never says "solid-state battery electrolyte" as one contiguous
    // phrase (no "battery" adjacent to "electrolyte"), so T1/T2/T3 all
    // miss; only T4's similarity floor admits it.
    const nasicon = item("nasicon", {
      title:
        "Enhancing Interfacial Stability Between NASICON‐Type Solid‐State Electrolyte and Lithium Metal Anode via Multifunctional Synergistic Interface Engineering",
      abstract:
        "Li 1.3 Al 0.3 Ti 1.7 (PO 4 ) 3 (LATP)‐based all‐solid‐state lithium metal batteries (ASSLMBs) hold " +
        "exceptional promise for achieving high energy density and excellent safety, yet their practical " +
        "application is severely hindered by critical interfacial issues, including poor contact, side " +
        "reactions, and dendrite growth. A flexible multifunctional composite interlayer is constructed " +
        "at the LATP/Li interface, guiding homogeneous Li deposition and stable cycling.",
    });
    const filler = item("filler-astronomy", {
      title: "A catalog of exoplanet transit timing variations from wide-field photometric surveys",
      abstract:
        "We present a statistical survey of transit timing variations across a large sample of " +
        "exoplanets, using ground-based photometric monitoring and orbital dynamics modeling.",
    });
    const scored = scoreItems(
      [nasicon, filler],
      { topics: ["solid-state battery electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["nasicon"]);
    // §1ao.8 — a T4-only qualification must add NOTHING to matchedKeywords:
    // no textual evidence, so the card must not claim a keyword the paper
    // does not contain.
    expect(scored[0].matchedKeywords).toEqual([]);
    expect(scored[0].score).toBeGreaterThan(0);
  });

  it("rejects the measured biofilm false positive under the TAG-ANCHORED rule (§1ao.1)", () => {
    // Real PubMed item (pubmed:42603427) — the exact false positive B found
    // under an UNANCHORED floor (simProject=0.079 alone cleared 0.05).
    // simTopic is 0 (never mentions "electrolyte" at all), so the anchor's
    // `simTopic > 0` requirement correctly rejects it even though it shares
    // enough generic scientific vocabulary with the project text to clear
    // FLOOR_PROJECT on its own. Re-confirmed in
    // docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md §1.
    const biofilm = item("biofilm", {
      title:
        "A proton-gated gold nanocluster platform for disrupting biofilm bioenergetics and suppressing virulence in bacterial infections.",
      abstract:
        "Current clinical management of periodontitis, a chronic inflammatory disease driven by " +
        "dysbiotic biofilms, faces a persistent challenge: biofilm-associated infections remain " +
        "difficult to eradicate owing to the resilient energy metabolism and high virulence of key " +
        "pathogens. We developed ultrasmall gold nanoclusters based on a bioenergetics-centered " +
        "Metabolic Trap paradigm.",
      tags: ["Journal Article"],
    });
    // A genuinely on-topic battery paper in the SAME pool, admitted via
    // plain T1 — proves the floor/anchor isn't simply rejecting everything.
    const genuine = item("filler-battery", {
      title:
        "Stable Li Plating and Stripping in LiPF6-Based Cyclic Ether Electrolytes for Lithium Metal Batteries",
      abstract:
        "We report a cyclic-ether electrolyte formulation for lithium metal batteries that " +
        "suppresses dendrite growth and enables stable long-term plating and stripping behavior.",
    });
    const scored = scoreItems(
      [biofilm, genuine],
      { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["filler-battery"]);
  });

  it(
    "test is parameterized on the named floor constants (mutation target: floorProject -> 0.0 " +
      "must make this WRONGLY pass, proving the test is sensitive to the threshold, not vacuous)",
    () => {
      expect(REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC).toBe(0.15);
      expect(REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT).toBe(0.05);
    },
  );

  describe("TOKENIZE-PLURALS (§1bd) — the fold applies at T4's own comparison", () => {
    // Real OpenAlex items (openalex:W4416056717, openalex:W7197006276),
    // verified in docs/jev-abc/TOKENIZE-PLURALS-B-20260929T141359Z.md §3.1
    // and independently re-measured through the real exported scoreItems
    // against the full saved P1 pool (27 in-window items) before shipping
    // this fix: both went from rejected (T4 simTopic 0, since neither paper
    // ever says "electrolyte" singular or "battery" at all — only the
    // plural "electrolytes") to admitted once the T4 comparison folds
    // plurals. Full real title+abstract text (not a trimmed excerpt) so the
    // fixture is exactly what was measured.
    const fastIonTransport = item("plural-only-fast-ion-transport", {
      title: "Microstructural insights into fast ion transport in solid electrolytes via multiscale modeling",
      abstract:
        "Abstract Improving solid electrolytes is critical for high-performance all-solid-state batteries, " +
        "yet the microstructural features that enable fast ion transport remain poorly understood. Here, we " +
        "use multiscale modeling to resolve polycrystalline ion transport from atomic-scale hopping at grain " +
        "boundaries to continuum-scale percolation, thereby providing insights into realistic solid-electrolyte " +
        "microstructures. Accurate lightweight machine-learning potentials are employed to integrate molecular " +
        "dynamics with finite element simulations. Grain boundaries exert opposite effects depending on the " +
        "bulk: enhancing ion diffusion in low-diffusivity phases but suppressing it in fast-diffusing ones. Our " +
        "results clarify the pivotal role of grain boundaries in ion transport and guide a priori microstructural " +
        "design of advanced solid electrolytes.",
    });
    const ramanLlzo = item("plural-only-raman-llzo", {
      title:
        "Raman Signatures of Lithium Ion Dynamics in LLZO Garnet Electrolytes: Atomistic Insights from MD-Raman Calculations",
      abstract:
        "Lithium lanthanum zirconate (LLZO) garnets are among the most promising solid electrolytes for " +
        "next-generation batteries owing to their high ionic conductivity, chemical stability, and " +
        "compatibility with lithium metal. Raman spectroscopy is commonly employed to distinguish the highly " +
        "conductive cubic phase from the poorly conductive tetragonal phase of LLZO. We show that the " +
        "contrasting ionic transport behavior across these LLZO variants is encoded in the vibrational " +
        "dynamics of the lithium sublattice, connecting Raman signatures to Li-ion dynamics in lithium garnet " +
        "electrolytes.",
    });
    const filler = item("filler-unrelated-astronomy", {
      title: "A catalog of exoplanet transit timing variations from wide-field photometric surveys",
      abstract:
        "We present a statistical survey of transit timing variations across a large sample of " +
        "exoplanets, using ground-based photometric monitoring and orbital dynamics modeling.",
    });

    it.each([
      ["plural-only-fast-ion-transport", fastIonTransport],
      ["plural-only-raman-llzo", ramanLlzo],
    ])(
      "%s: says 'electrolytes' (plural) only, never 'electrolyte' or 'battery' contiguous with the tag's other " +
        "words — T1/T2/T3 all miss; only T4 can admit it, and only once the fold lets 'electrolytes' agree with " +
        "the tag's singular 'electrolyte'",
      (_name, paper) => {
        const scored = scoreItems(
          [paper, filler],
          { topics: ["solid-state battery electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] },
          undefined,
          now,
        );
        expect(scored.map((s) => s.id)).toEqual([paper.id]);
        // §1ao.8 — still a T4-only qualification: no textual evidence, so
        // the card must not claim a keyword the paper does not contain.
        expect(scored[0].matchedKeywords).toEqual([]);
        expect(scored[0].score).toBeGreaterThan(0);
      },
    );
  });
});

describe("wrong-sense trap — SENSE-CONTEXT (§1ap) now demotes it; rewritten, not deleted", () => {
  it("a constructed clinical 'electrolyte' paper is DEMOTED (stays qualified, lower grounding), not dropped, once a battery context is declared", () => {
    // §1ap.3 — BINDING. This is the SAME fixture a previous version of this
    // test (pre-SENSE-CONTEXT) used to document an honest, un-fixed gap:
    // "clinical/other wrong-sense hits on a single literal word are
    // explicitly NOT fixed by REQUIRED-GATE (§1ao.2)... If SENSE-CONTEXT
    // ships, THIS test flips to asserting rejection and becomes that item's
    // acceptance test — do not delete it, rewrite its expectation." Per
    // §1ap.3 the flip is DEMOTE, not DROP: the tag genuinely is present, so
    // it stays in `matchedKeywords` (§1ao.8 — never state a false match:
    // the word really is there), but its grounding drops to
    // `SENSE_CONTEXT_DEMOTED_GROUNDING` because a battery-materials
    // reader's OTHER declared context (their project text) shares no real
    // vocabulary with a clinical electrolyte-imbalance paper once
    // "electrolyte" itself is stripped from both sides (§1ap.2). A
    // profile with NO declared context (as the original test had) would
    // instead bypass — see the cold-start test in sense-context.test.ts —
    // so this rewrite adds `seedTexts` to actually exercise the gate.
    const clinicalPaper = item("clinical-electrolyte", {
      title: "Serum electrolyte imbalance in critically ill patients: a retrospective cohort study",
      abstract:
        "We evaluated the prevalence of serum electrolyte imbalance among critically ill patients " +
        "admitted to intensive care.",
    });
    const scored = scoreItems(
      [clinicalPaper],
      { topics: ["electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["clinical-electrolyte"]);
    expect(scored[0].matchedKeywords).toEqual(["electrolyte"]);
    // Demoted grounding, not the full T1 title-match grounding (1) this
    // exact fixture would otherwise get (it names "electrolyte" in its
    // title).
    const specificity = termSpecificity(canonicalize("electrolyte"));
    const demotedScore = (specificity * SENSE_CONTEXT_DEMOTED_GROUNDING) / 1.5;
    const fullGroundingScore = (specificity * 1) / 1.5;
    expect(scored[0].scoreBreakdown.keyword).toBeCloseTo(demotedScore, 4);
    expect(scored[0].scoreBreakdown.keyword).toBeLessThan(fullGroundingScore);
  });
});

describe("SEM sense case — confirms the existing, unmodified mechanism on real data", () => {
  it("resolves a true materials-domain SEM abstract to exactAlias and admits it", () => {
    // Real OpenAlex item (openalex:W4417014624), from B's saved
    // out/raw-P3-true.json.
    const truePaper = item("sem-true", {
      title:
        "Development and validation of an interface for automated image acquisition during high-temperature environmental scanning electron microscopy experiments",
      abstract:
        "An interface that enables automatic image acquisition during high-temperature experiments " +
        "in an environmental SEM is developed. It is optimized to work on multiple regions of interest " +
        "at multiple magnifications, performing image focusing and automatic re-centering of regions.",
    });
    const scored = scoreItems(
      [truePaper],
      { topics: ["SEM"], selectedSenseConcepts: [selectedSenseConcept("materials.scanning_electron_microscopy")] },
      undefined,
      now,
    );
    expect(scored.map((s) => s.id)).toEqual(["sem-true"]);
  });

  it("resolves a real statistics-domain 'SEM' abstract to conflict and rejects it", () => {
    // Real OpenAlex item (openalex:W7138884338), from B's saved
    // out/raw-P3-wrong.json.
    const wrongPaper = item("sem-wrong", {
      title: "Consistent Partial Least Squares Structural Equation Modeling Using SmartPLS",
      abstract:
        "This article provides a comprehensive illustration of consistent partial least squares " +
        "structural equation modeling (PLSc-SEM), a variant of the original PLS-SEM method, which " +
        "corrects construct correlations for attenuation.",
    });
    const scored = scoreItems(
      [wrongPaper],
      { topics: ["SEM"], selectedSenseConcepts: [selectedSenseConcept("materials.scanning_electron_microscopy")] },
      undefined,
      now,
    );
    expect(scored).toEqual([]);
  });
});

describe("exclusions and honest emptiness stay hard under the new gate", () => {
  it("an explicit exclusion still drops a candidate that would otherwise qualify via T1", () => {
    const excluded = item("excluded", {
      title: "Solid electrolyte review",
      abstract: "A review of solid electrolyte materials.",
    });
    const scored = scoreItems(
      [excluded],
      { topics: ["solid electrolyte"], exclusions: ["review"] },
      undefined,
      now,
    );
    expect(scored).toEqual([]);
  });

  it("a pool with zero T1/T2/T3/T4 qualifiers returns an empty result, never padded", () => {
    const offTopic = item("off-topic", {
      title: "Sichuan's Advanced Manufacturing Industry Chain",
      abstract: "An economic policy overview with no materials-science content.",
    });
    const scored = scoreItems(
      [offTopic],
      { topics: ["solid-state battery electrolyte"], seedTexts: [BATTERY_PROJECT_TEXT] },
      undefined,
      now,
    );
    expect(scored).toEqual([]);
  });
});

describe("ranking order — T1 outranks a T4-only qualification at equal specificity", () => {
  it("the named weight constants keep T2/T3/T4 strictly below T1's effective unit weight", () => {
    // Direct, mutation-simple check: T1's contribution is
    // `termSpecificity * grounding` with grounding up to 1 (a title match).
    // Every other technique's multiplier must stay below 1 for the
    // invariant to hold in general, not just for one hand-picked fixture.
    expect(REQUIRED_TAG_T2_GROUNDING).toBeLessThan(1);
    expect(REQUIRED_TAG_T3_GROUNDING).toBeLessThan(1);
    expect(REQUIRED_TAG_T4_WEIGHT).toBeLessThan(1);
  });

  it("end-to-end: a T1 title match outranks a T4-only match on the same multi-word tag", () => {
    const tag = "solid state battery";
    const t1Item = item("t1-title-match", {
      title: "Solid state battery achieves record cycling stability",
      abstract: "We report a solid state battery with excellent performance.",
    });
    // Every content word of the tag is present, scattered and non-adjacent,
    // so cosine similarity to the tag is high (T4 admits) while the
    // CONTIGUOUS phrase never appears (T1/T2/T3 all miss).
    const t4OnlyItem = item("t4-scattered-match", {
      title: "Battery performance under state changes",
      abstract:
        "The battery. The state. Solid. Battery state observations. Solid battery notes. " +
        "State of the battery, solid throughout.",
    });
    const scored = scoreItems([t1Item, t4OnlyItem], { topics: [tag] }, undefined, now);
    expect(scored.map((s) => s.id).sort()).toEqual(["t1-title-match", "t4-scattered-match"]);
    // The invariant is about the KEYWORD component specifically (§1ao.3 —
    // "at equal specificity a T1 match outranks a T4-only match" is a
    // statement about termSpecificity/grounding vs. the T4 weight/margin,
    // not about the final blended score, which also mixes in tfidf
    // topicality/recency/source and can legitimately favor either item on
    // those unrelated axes). Asserted directly on `scoreBreakdown.keyword`
    // for that reason, matching the guide's own mutation target (4.2):
    // removing the ranking weight gap must make THIS comparison fail.
    const t1Score = scored.find((s) => s.id === "t1-title-match")!.scoreBreakdown.keyword;
    const t4Score = scored.find((s) => s.id === "t4-scattered-match")!.scoreBreakdown.keyword;
    expect(t1Score).toBeGreaterThan(t4Score);
    expect(scored.find((s) => s.id === "t4-scattered-match")!.matchedKeywords).toEqual([]);
  });
});
