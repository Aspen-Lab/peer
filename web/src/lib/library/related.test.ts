import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import type { LibraryEntry } from "./graph";
import { relatedInLibrary, topicsOf } from "./related";

function paper(id: string, topics: string[], concepts: string[] = [], title = id): Paper {
  return {
    id,
    title,
    authors: [],
    relevanceReason: "",
    venue: "",
    source: "other",
    summaryIntro: "",
    summaryExperimentKeywords: [],
    summaryResultDiscussion: "",
    isSaved: true,
    preferenceSignals: [
      ...topics.map((label) => ({ key: label, label, source: "openalex_topic" as const })),
      ...concepts.map((label) => ({ key: label, label, source: "openalex_concept" as const })),
    ],
  } as Paper;
}

function entry(id: string, filed: string[], terms: string[] = [], readAt = "2026-09-01"): LibraryEntry {
  return { id, title: `Read ${id}`, venue: "", readAt, filed, terms };
}

describe("topicsOf", () => {
  it("collects filed topics and concepts once each, as the record spells them", () => {
    expect(topicsOf(paper("p", ["Machine Learning", "Protein folding"], ["machine learning", "Turbulence"]))).toEqual([
      "Machine Learning",
      "Protein folding",
      "Turbulence",
    ]);
  });
});

describe("relatedInLibrary", () => {
  const me = paper("me", ["Machine Learning", "Protein folding"]);

  it("finds what was read under the same topics, nearest first", () => {
    const library = {
      a: entry("a", ["Machine Learning"]),
      b: entry("b", ["Protein folding"], ["machine learning"], "2026-09-10"),
      c: entry("c", ["Quantum optics"]),
    };
    const out = relatedInLibrary(me, library, []);
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
    expect(out[0].shared).toEqual(["Machine Learning", "Protein folding"]);
    expect(out[0].kind).toBe("read");
  });

  it("counts the shelf, and says kept when a paper is both read and kept", () => {
    const library = { a: entry("a", ["Machine Learning"]) };
    const saved = [paper("a", ["Machine Learning"]), paper("s", ["Protein folding"])];
    const out = relatedInLibrary(me, library, saved);
    expect(out.find((r) => r.id === "a")?.kind).toBe("saved");
    expect(out.find((r) => r.id === "s")?.shared).toEqual(["Protein folding"]);
  });

  it("is never its own neighbour, and says nothing without topics", () => {
    expect(relatedInLibrary(me, { me: entry("me", ["Machine Learning"]) }, [paper("me", ["Machine Learning"])])).toEqual([]);
    expect(relatedInLibrary(paper("bare", []), { a: entry("a", ["Machine Learning"]) }, [])).toEqual([]);
  });

  it("keeps to the limit", () => {
    const library = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`r${i}`, entry(`r${i}`, ["Machine Learning"])]));
    expect(relatedInLibrary(me, library, [], 3)).toHaveLength(3);
  });
});
