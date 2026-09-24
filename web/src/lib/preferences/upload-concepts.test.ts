import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { extractUploadConcepts, matchUploadedPaper, UPLOAD_CONCEPT_EXTRACTION_VERSION } from "./upload-concepts";
import { applyUploadPreferenceSignal, applyPreferenceSignal, cleanPreferenceLedger, removeUploadPreferenceSignal, summarizePreferenceLedger, scorePreferenceMatch, prepareLedger } from "./ledger";
import { compileSearchBrief } from "@/lib/feed/profile-compiler";
import { derivePoolCacheKey } from "@/lib/opportunities/pool-cache";

const doc = { title: "Solid electrolytes for lithium metal batteries", source: "pdf" as const, figureCaptions: [], sections: [
  { heading: "Abstract", canonical: "abstract", text: "Solid electrolytes improve lithium metal batteries. Solid electrolytes support lithium transport." },
  { heading: "Methods", canonical: "methods", text: "Impedance spectroscopy measures lithium transport. Impedance spectroscopy measures conductivity." },
  { heading: "References", canonical: "references", text: "Marine biology. Marine biology. Marine biology. Marine biology." },
] };
const key = "a".repeat(64);
const at = "2026-09-19T00:00:00Z";

describe("uploaded article learning", () => {
  it("extracts real phrases and provenance, ignoring references", () => {
    const concepts = extractUploadConcepts(doc);
    expect(concepts.some((c) => c.label === "solid electrolytes")).toBe(true);
    expect(concepts.some((c) => c.label === "impedance spectroscopy")).toBe(true);
    expect(concepts.some((c) => /marine|biology/.test(c.label))).toBe(false);
    expect(concepts.every((c) => c.source === "uploaded_article" && c.section && (c.confidence ?? 0) <= 1)).toBe(true);
    expect(extractUploadConcepts({ ...doc, title: "", sections: [] })).toEqual([]);
  });
  it("counts one document once, decays it, and can remove only its evidence", () => {
    const concepts = extractUploadConcepts(doc);
    const initial = applyUploadPreferenceSignal({}, concepts, key, at);
    expect(applyUploadPreferenceSignal(initial, concepts, key, "2026-09-20T00:00:00Z")).toEqual(initial);
    expect(cleanPreferenceLedger(initial)).toEqual(initial);
    const first = summarizePreferenceLedger(initial, Date.parse(at)).liked[0].weight;
    const later = summarizePreferenceLedger(initial, Date.parse(at) + 60 * 86400_000).liked[0].weight;
    expect(later).toBeCloseTo(first / 2);
    const liked = applyPreferenceSignal(initial, [concepts[0]], "positive", { at });
    const removed = removeUploadPreferenceSignal(liked, key);
    expect(Object.keys(removed)).toEqual([concepts[0].key]);
    expect(removed[concepts[0].key].positive).toBe(1);
  });
  it("boosts a matching title even when the source has no taxonomy tags, within existing limits", () => {
    const ledger = applyUploadPreferenceSignal({}, extractUploadConcepts(doc), key, at);
    const score = scorePreferenceMatch({ id: "new", source: "openalex", title: "Solid electrolytes with fast lithium transport", authors: [], url: "", publishedAt: "", metadata: {} }, prepareLedger(ledger), [], { now: Date.parse(at) });
    expect(score.boost).toBeGreaterThan(0);
    expect(score.boost).toBeLessThanOrEqual(0.18);
    expect(score.matchedPositive).toContain("solid electrolytes");
  });
  it("adds bounded discovery terms without replacing declared topics or sharing another user's pool", () => {
    const ledger = applyUploadPreferenceSignal({}, extractUploadConcepts(doc), key);
    const brief = compileSearchBrief({ topics: ["batteries"], preferenceLedger: ledger });
    expect(brief.coreTopics).toEqual(["batteries"]);
    expect(brief.generatedQueries.some((q) => q.startsWith("batteries "))).toBe(true);
    expect(brief.generatedQueries.length).toBeLessThanOrEqual(10);
    const common = { surface: "papers" as const, requiredTopics: ["batteries"] };
    expect(derivePoolCacheKey(common)).not.toBe(derivePoolCacheKey({ ...common, uploadInterests: ["solid electrolytes"] }));
  });
  // 9-31 (A9-09): rewritten from a boolean `matchesUploadedPaper` to the
  // three-band `matchUploadedPaper`; a verified DOI or a strong title
  // overlap is now "doi"/"strong" (the old `true`), and a mismatched DOI or
  // a weak/absent title overlap is "reject" (the old `false`) — same cases,
  // read off the new `.band` field instead of a plain boolean.
  it("refuses a different DOI, unrelated title or unreadable title", () => {
    expect(matchUploadedPaper({ title: doc.title, doi: "10.1234/a" }, doc.title, "10.1234/a").band).toBe("doi");
    expect(matchUploadedPaper({ title: doc.title, doi: "10.1234/a" }, doc.title, "10.1234/b").band).toBe("reject");
    expect(matchUploadedPaper({ title: doc.title }, "A marine biology investigation").band).toBe("reject");
    expect(matchUploadedPaper({ title: doc.title }, "").band).toBe("reject");
  });

  it("9-31: bands on title overlap alone (no DOI on either side)", () => {
    // Strong: every word overlaps.
    expect(matchUploadedPaper({ title: doc.title }, doc.title).band).toBe("strong");
    // Confirm: partial overlap — shares only "solid"/"batteries" (2 of the
    // original's 5 content words, fraction 2/5 = 0.4, inside [0.35, 0.6)).
    const confirmResult = matchUploadedPaper({ title: doc.title }, "Solid state ionic conductors for advanced batteries");
    expect(confirmResult.band).toBe("confirm");
    expect(confirmResult.overlap).toBeGreaterThanOrEqual(0.35);
    expect(confirmResult.overlap).toBeLessThan(0.6);
    // Reject: essentially no shared words.
    expect(matchUploadedPaper({ title: doc.title }, "A marine biology investigation").overlap).toBeLessThan(0.35);
  });

  it("9-31: a mismatched DOI rejects even when the title overlap would otherwise be strong", () => {
    // The exact case a title-only check would get wrong: identical titles,
    // but the DOIs disagree — the DOI must win.
    expect(matchUploadedPaper({ title: doc.title, doi: "10.1234/a" }, doc.title, "10.1234/different").band).toBe("reject");
  });
});

// 9-21 (A9-04/A9-11): four self-made ExtractedDocument fixtures spanning the
// handoff §4.2 shapes the draft's own live check missed — a materials paper,
// a CS paper, a long wrapped title, and a reference-list decoy. Protective:
// each pins down a real, execution-confirmed candidate list (captured by
// running extractUploadConcepts directly, not guessed), so a future rewrite
// of the filter/facet rules can't silently let "three"/"nodes" back in.
describe("upload concept extraction quality (9-21)", () => {
  const materialsDoc: ExtractedDocument = {
    title: "Perovskite Oxide Cathodes for Solid State Batteries",
    source: "pdf",
    figureCaptions: [],
    sections: [
      { heading: "Abstract", canonical: "abstract", text: "Perovskite oxide cathodes improve solid state batteries. Perovskite oxide cathodes show high conductivity." },
      { heading: "Methods", canonical: "methods", text: "X-ray diffraction confirms the perovskite oxide structure. X-ray diffraction measures three distinct phases. There are three phases in total; each of the three phases was indexed separately." },
    ],
  };

  it("a materials paper: material/method facets, and a bare number word never survives", () => {
    const concepts = extractUploadConcepts(materialsDoc);
    // Repeated enough to have otherwise cleared the (title-or-count>=2) bar
    // as "three phases" — a number word anywhere in the phrase is rejected.
    expect(concepts.some((c) => /\bthree\b/.test(c.label))).toBe(false);
    const perovskite = concepts.find((c) => c.label === "perovskite oxide cathodes");
    expect(perovskite?.facet).toBe("material");
    expect(perovskite?.section).toBe("title");
    const diffraction = concepts.find((c) => c.label === "x-ray diffraction");
    expect(diffraction?.facet).toBe("method");
    expect(concepts.every((c) => c.extractionVersion === UPLOAD_CONCEPT_EXTRACTION_VERSION)).toBe(true);
  });

  const csDoc: ExtractedDocument = {
    title: "Graph Neural Network Benchmark for Node Classification",
    source: "pdf",
    figureCaptions: [],
    sections: [
      { heading: "Abstract", canonical: "abstract", text: "Graph neural network models improve node classification. Graph neural network models beat prior benchmark algorithms." },
      { heading: "Results", canonical: "results", text: "Our benchmark algorithm improves accuracy on four nodes. Each of the four nodes was tested twice; all four nodes converged. Nodes were checked for stability, and the nodes held up under load." },
    ],
  };

  it("a CS paper: method facet from algorithm/benchmark/network cues, no bare 'nodes' or number word", () => {
    const concepts = extractUploadConcepts(csDoc);
    // "nodes" alone is a single generic noun, not a known domain term
    // (term-expand.ts's abbreviation groups) — the exact A9-04 finding.
    // Repeated enough to have otherwise cleared the (title-or-count>=2) bar
    // as "nodes"/"four nodes" — neither may survive in any candidate.
    expect(concepts.some((c) => /\bnodes\b/.test(c.label))).toBe(false);
    expect(concepts.some((c) => /\bfour\b/.test(c.label))).toBe(false);
    const network = concepts.find((c) => c.label === "graph neural network");
    expect(network?.facet).toBe("method");
    expect(network?.section).toBe("title");
    // "node classification" (a real 2-word phrase from the title) survives
    // distinctly from the rejected bare "nodes" single token.
    expect(concepts.some((c) => c.label === "node classification")).toBe(true);
  });

  const wrappedTitleDoc: ExtractedDocument = {
    title: "Thermal Stability And Long Term Cycling Performance Of Layered Nickel Rich Cathode Materials",
    source: "pdf",
    figureCaptions: [],
    sections: [
      { heading: "Abstract", canonical: "abstract", text: "Layered nickel rich cathode materials show improved thermal stability. Layered nickel rich cathode materials retain capacity." },
    ],
  };

  it("keeps title-section provenance across a long, wrapped title", () => {
    const concepts = extractUploadConcepts(wrappedTitleDoc);
    const nickelRich = concepts.find((c) => c.label === "nickel rich cathode");
    expect(nickelRich?.section).toBe("title");
    expect(nickelRich?.facet).toBe("material");
    expect(concepts.some((c) => c.label === "thermal stability")).toBe(true);
  });

  const referenceDecoyDoc: ExtractedDocument = {
    title: "Lithium Metal Anode Protection Strategies",
    source: "pdf",
    figureCaptions: [],
    sections: [
      { heading: "Abstract", canonical: "abstract", text: "Lithium metal anode protection reduces dendrite growth. Lithium metal anode protection improves cycling." },
      { heading: "References", canonical: "references", text: "Quantum computing algorithms. Quantum computing algorithms. Quantum computing algorithms for optimization." },
    ],
  };

  it("never surfaces a term that only appears in the reference list", () => {
    const concepts = extractUploadConcepts(referenceDecoyDoc);
    expect(concepts.some((c) => c.label.includes("quantum"))).toBe(false);
    expect(concepts.some((c) => c.label.includes("lithium metal anode"))).toBe(true);
  });
});
