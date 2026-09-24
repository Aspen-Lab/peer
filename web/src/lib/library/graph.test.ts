import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { buildLibraryGraph, libraryEntryOf, type LibraryEntry } from "./graph";

function paper(id: string, keywords: string[], text: string): Paper {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    relevanceReason: "",
    venue: "Venue",
    source: "other",
    summaryIntro: text,
    summaryExperimentKeywords: keywords,
    summaryResultDiscussion: "",
    isSaved: false,
  };
}

const TEXT =
  "We study graph neural networks for protein folding with diffusion models and transformers.";

describe("libraryEntryOf", () => {
  it("keeps only terms grounded in the paper's own words", () => {
    // OpenAlex put "Generative grammar" on a protein-folding paper once; a
    // term that is nowhere in the paper's text never reaches the library.
    const entry = libraryEntryOf(
      paper("a", ["graph neural networks", "Generative grammar", "cs.LG"], TEXT),
      "2026-09-17",
    );
    expect(entry.terms).toEqual(["graph neural networks"]);
  });
});

describe("buildLibraryGraph", () => {
  const entry = (
    id: string,
    terms: string[],
    readAt = "2026-09-10",
    filed: string[] = [],
  ): LibraryEntry => ({
    id,
    title: `Paper ${id}`,
    venue: "Venue",
    readAt,
    filed,
    terms,
  });

  it("links papers only through a term they both carry", () => {
    const graph = buildLibraryGraph({
      library: [entry("a", ["diffusion models"]), entry("b", ["diffusion models"])],
      saved: [],
      today: [],
      readIds: {},
      readerTopics: [],
    });
    const concept = graph.nodes.find((n) => n.kind === "concept");
    expect(concept?.label).toBe("diffusion models");
    expect(graph.links).toHaveLength(2);
  });

  it("drops a concept only one paper carries — it links nothing", () => {
    const graph = buildLibraryGraph({
      library: [entry("a", ["diffusion models"]), entry("b", ["transformers"])],
      saved: [],
      today: [],
      readIds: {},
      readerTopics: [],
    });
    expect(graph.nodes.filter((n) => n.kind === "concept")).toHaveLength(0);
    // The papers themselves stay: they are the library, linked or not.
    expect(graph.nodes.filter((n) => n.kind === "paper")).toHaveLength(2);
  });

  it("files the reader's own topic under the reader's wording, even for one paper", () => {
    const graph = buildLibraryGraph({
      library: [entry("a", ["Protein Folding"])],
      saved: [],
      today: [],
      readIds: {},
      readerTopics: ["protein folding"],
    });
    const topic = graph.nodes.find((n) => n.kind === "topic");
    expect(topic?.label).toBe("protein folding");
  });

  it("puts today's unread papers in only when they connect to something", () => {
    const graph = buildLibraryGraph({
      library: [entry("a", ["diffusion models"])],
      saved: [],
      today: [
        paper("t1", ["diffusion models"], TEXT),
        paper("t2", ["transformers"], TEXT),
      ],
      readIds: {},
      readerTopics: [],
    });
    const today = graph.nodes.filter((n) => n.kind === "paper" && n.state === "today");
    expect(today.map((n) => n.kind === "paper" && n.paperId)).toEqual(["t1"]);
  });

  it("marks a kept paper as saved whether or not it was read", () => {
    const kept = paper("s", ["diffusion models"], TEXT);
    const graph = buildLibraryGraph({
      library: [entry("a", ["diffusion models"])],
      saved: [kept],
      today: [],
      readIds: {},
      readerTopics: [],
    });
    const s = graph.nodes.find((n) => n.kind === "paper" && n.paperId === "s");
    expect(s && s.kind === "paper" && s.state).toBe("saved");
    expect(graph.counts.saved).toBe(1);
  });

  it("joins papers that ship no abstract through OpenAlex's own filing", () => {
    // The live case: three books with no abstract, so nothing is "in the
    // text", but OpenAlex filed two of them under the same topic.
    const graph = buildLibraryGraph({
      library: [
        entry("a", [], "2026-09-10", ["Machine Learning and Data Classification"]),
        entry("b", [], "2026-09-10", ["Machine Learning and Data Classification", "Gaussian Processes"]),
      ],
      saved: [],
      today: [],
      readIds: {},
      readerTopics: [],
    });
    const filed = graph.nodes.find((n) => n.kind === "concept");
    expect(filed && filed.kind === "concept" && filed.sources).toEqual(["filed"]);
    expect(filed?.label).toBe("Machine Learning and Data Classification");
  });

  it("puts a label that contains the reader's topic UNDER it, not into it", () => {
    // Two different corners of a field must not collapse into one hub.
    const graph = buildLibraryGraph({
      library: [
        entry("a", [], "2026-09-10", ["Machine Learning and Data Classification"]),
        entry("b", [], "2026-09-10", ["Machine Learning and Algorithms"]),
      ],
      saved: [],
      today: [],
      readIds: {},
      readerTopics: ["machine learning"],
    });
    const concepts = graph.nodes.filter((n) => n.kind === "concept").map((n) => n.label);
    expect(concepts).toEqual(
      expect.arrayContaining(["Machine Learning and Data Classification", "Machine Learning and Algorithms"]),
    );
    const contains = graph.links.filter((l) => l.kind === "contains");
    expect(contains).toHaveLength(2);
    expect(contains.every((l) => l.target === "t:topic:machine learning")).toBe(true);
  });

  it("caps the library at the newest entries and says how many it left out", () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      entry(`p${i}`, [], `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`),
    );
    const graph = buildLibraryGraph({
      library: many,
      saved: [],
      today: [],
      readIds: {},
      readerTopics: [],
    });
    expect(graph.counts.read).toBe(120);
    expect(graph.counts.omitted).toBe(10);
  });
});
