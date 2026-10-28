import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bySourceId, isRegisteredSource, sources } from "./index";
import type { SourceId } from "./types";

// Every `SourceId`, written out: the type cannot be listed at runtime. `web`
// stays an id (the database's check constraint lists it) after its Tavily
// adapter was deleted.
const ALL_SOURCE_IDS: SourceId[] = [
  "openalex",
  "arxiv",
  "semantic_scholar",
  "dblp",
  "pubmed",
  "web",
  "hn",
];

describe("the source registry after Tavily's removal", () => {
  it("has an adapter for every source id but web, and none for web", () => {
    expect(Object.keys(bySourceId).sort()).toEqual(
      ALL_SOURCE_IDS.filter((id) => id !== "web").sort(),
    );
    expect(sources.map((adapter) => adapter.id)).not.toContain("web");
    for (const [id, adapter] of Object.entries(bySourceId)) {
      expect(adapter.id, id).toBe(id);
    }
  });

  it("isRegisteredSource is true exactly for the ids with an adapter", () => {
    expect(ALL_SOURCE_IDS.filter(isRegisteredSource).sort()).toEqual(
      Object.keys(bySourceId).sort(),
    );
    expect(isRegisteredSource("web")).toBe(false);
  });

  it("the deleted web-search adapter is not on disk", () => {
    const files = readdirSync(join(process.cwd(), "src/lib/sources"));
    expect(files.filter((name) => /web-search|tavily/i.test(name))).toEqual([]);
  });
});
