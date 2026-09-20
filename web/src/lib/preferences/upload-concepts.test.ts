import { describe, expect, it } from "vitest";
import { extractUploadConcepts, matchesUploadedPaper } from "./upload-concepts";
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
  it("refuses a different DOI, unrelated title or unreadable title", () => {
    expect(matchesUploadedPaper({ title: doc.title, doi: "10.1234/a" }, doc.title, "10.1234/a")).toBe(true);
    expect(matchesUploadedPaper({ title: doc.title, doi: "10.1234/a" }, doc.title, "10.1234/b")).toBe(false);
    expect(matchesUploadedPaper({ title: doc.title }, "A marine biology investigation")).toBe(false);
    expect(matchesUploadedPaper({ title: doc.title }, "")).toBe(false);
  });
});
