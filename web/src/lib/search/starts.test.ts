import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import type { LibraryEntry } from "@/lib/library/graph";
import {
  authorsFromShelf,
  MAX_RECENT,
  readRecent,
  RECENT_KEY,
  termsFromReading,
  withRecent,
  writeRecent,
} from "./starts";

function entry(id: string, terms: string[], filed: string[] = []): LibraryEntry {
  return { id, title: id, venue: "", readAt: "2026-09-01", filed, terms };
}

function paper(id: string, authors: string[], concepts: string[] = []): Paper {
  return {
    id,
    title: id,
    authors,
    relevanceReason: "",
    venue: "",
    source: "other",
    summaryIntro: "",
    summaryExperimentKeywords: [],
    summaryResultDiscussion: "",
    isSaved: true,
    preferenceSignals: concepts.map((label) => ({ key: label, label, source: "openalex_concept" as const })),
  } as Paper;
}

describe("terms from reading", () => {
  it("offers the threads two or more papers share, most-shared first", () => {
    const library = {
      a: entry("a", ["Graph neural networks", "Attention"]),
      b: entry("b", ["graph neural networks", "Protein folding"]),
      c: entry("c", ["Graph Neural Networks"], ["Protein folding"]),
    };
    expect(termsFromReading(library, [])).toEqual([
      { query: "Graph neural networks", count: 3 },
      { query: "Protein folding", count: 2 },
    ]);
  });

  it("counts a saved paper's concepts alongside the read ones", () => {
    const library = { a: entry("a", ["Turbulence"]) };
    const saved = [paper("s1", ["A"], ["Turbulence"])];
    expect(termsFromReading(library, saved)).toEqual([{ query: "Turbulence", count: 2 }]);
  });

  it("leaves out what the reader already declared as a topic", () => {
    const library = {
      a: entry("a", ["machine learning", "Attention"]),
      b: entry("b", ["Machine Learning", "Attention"]),
    };
    expect(termsFromReading(library, [], ["Machine learning"])).toEqual([{ query: "Attention", count: 2 }]);
  });

  it("says nothing about one paper's private vocabulary", () => {
    expect(termsFromReading({ a: entry("a", ["Only here"]) }, [])).toEqual([]);
  });
});

describe("people on the shelf", () => {
  it("names first authors, the most-kept first, and counts only repeats", () => {
    const saved = [
      paper("1", ["Ada Lovelace", "Someone Else"]),
      paper("2", ["Ada Lovelace"]),
      paper("3", ["Grace Hopper"]),
    ];
    expect(authorsFromShelf(saved)).toEqual([
      { query: "Ada Lovelace", count: 2 },
      { query: "Grace Hopper", count: undefined },
    ]);
  });

  it("takes one name from a byline that arrived as a single string", () => {
    const saved = [paper("1", ["Mrs. C. Surekha, Dr. Snehal Anandrao Lohi (Bode), Ms. S. Sathiya"])];
    expect(authorsFromShelf(saved)).toEqual([{ query: "Mrs. C. Surekha", count: undefined }]);
    expect(authorsFromShelf([paper("2", ["A. Author and B. Author"])])).toEqual([{ query: "A. Author", count: undefined }]);
  });

  it("survives a paper with no authors", () => {
    expect(authorsFromShelf([paper("1", [])])).toEqual([]);
  });
});

describe("recent searches", () => {
  const memory = () => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      raw: store,
    };
  };

  it("puts the newest first and folds an earlier spelling of it", () => {
    let list: string[] = [];
    list = withRecent(list, "attention");
    list = withRecent(list, "protein folding");
    list = withRecent(list, "Attention ");
    expect(list).toEqual(["Attention", "protein folding"]);
  });

  it("keeps eight, and ignores a query too short to have been a search", () => {
    let list: string[] = [];
    for (let i = 0; i < 12; i++) list = withRecent(list, `query ${i}`);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe("query 11");
    expect(withRecent(list, "a")).toBe(list);
  });

  it("round-trips through storage and clears when empty", () => {
    const s = memory();
    writeRecent(s, ["one", "two"]);
    expect(readRecent(s)).toEqual(["one", "two"]);
    writeRecent(s, []);
    expect(s.raw.has(RECENT_KEY)).toBe(false);
  });

  it("reads nothing from a corrupt or missing store", () => {
    const s = memory();
    s.setItem(RECENT_KEY, "{not json");
    expect(readRecent(s)).toEqual([]);
    s.setItem(RECENT_KEY, JSON.stringify([1, "", "ok"]));
    expect(readRecent(s)).toEqual(["ok"]);
    expect(readRecent(null)).toEqual([]);
  });
});
