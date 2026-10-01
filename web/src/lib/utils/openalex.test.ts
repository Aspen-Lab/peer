import { describe, expect, it } from "vitest";
import {
  EXCLUDED_OPENALEX_TYPES,
  isExcludedOpenAlexRawItem,
  isExcludedOpenAlexType,
  openAlexWorkToRawItem,
  type OpenAlexWork,
} from "./openalex";
import type { RawItem } from "@/lib/sources/types";

// DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl,
// docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md): a signed-out Papers
// feed showed one Figshare DATASET record twice (a version-DOI pair),
// because every OpenAlex adapter fetched only the legacy `type_crossref`
// field, which came back absent on every live-probed work in that
// investigation — so `metadata.workType` was a dead field for every
// OpenAlex item Peer has ever fetched, and nothing ever excluded a
// non-paper record from the feed. These tests cover the revived field
// (`workType` prefers OpenAlex's own `type`, falling back to
// `type_crossref`) and the shared exclusion check every OpenAlex adapter now
// applies right after fetching, before scoring/dedupe ever sees a record.
// See the C checkpoint (docs/jev-abc/DATASET-RECORDS-C-20260930T034606Z.md)
// for the full 25-value type table and the one-line reason behind every
// kept/dropped value.

function work(overrides: Partial<OpenAlexWork> = {}): OpenAlexWork {
  return {
    id: "https://openalex.org/W1",
    title: "A Fixture Work",
    publication_date: "2026-01-01",
    authorships: [],
    primary_location: null,
    abstract_inverted_index: null,
    cited_by_count: 0,
    doi: null,
    ...overrides,
  };
}

describe("openAlexWorkToRawItem — metadata.workType prefers `type`, falls back to `type_crossref` (DATASET-RECORDS)", () => {
  it("reads workType from `type` when present, even when type_crossref also carries a value (mutation target: reverting the `??` order turns this red)", () => {
    const item = openAlexWorkToRawItem(
      work({ type: "preprint", type_crossref: "posted-content" }),
    );
    expect(item.metadata.workType).toBe("preprint");
  });

  it("falls back to `type_crossref` when `type` is absent — protects the fallback in case OpenAlex ever repopulates the legacy field for some record type this investigation didn't sample", () => {
    const item = openAlexWorkToRawItem(work({ type_crossref: "journal-article" }));
    expect(item.metadata.workType).toBe("journal-article");
  });

  it("is undefined when neither `type` nor `type_crossref` is present", () => {
    const item = openAlexWorkToRawItem(work({}));
    expect(item.metadata.workType).toBeUndefined();
  });

  it("passes through OpenAlex's own casing unchanged (only the exclusion check below lowercases for its own comparison)", () => {
    const item = openAlexWorkToRawItem(work({ type: "Dataset" }));
    expect(item.metadata.workType).toBe("Dataset");
  });
});

describe("isExcludedOpenAlexType — the excluded-type set (DATASET-RECORDS §1bl)", () => {
  // Every type this item's checkpoint decided to DROP. One test per type, per
  // the guide's own instruction ("every excluded type you add has a test").
  const droppedTypes = [
    "dataset",
    "paratext",
    "peer-review",
    "erratum",
    "retraction",
    "libguides",
    "supplementary-materials",
    "software",
  ];

  // A representative span of KEPT types — the ones explicitly ruled to keep
  // (article/review/preprint/book-chapter), the ones explicitly ruled
  // borderline-keep (conference-abstract/book/dissertation/report), and the
  // new leads this checkpoint found and deliberately left alone (letter,
  // standard, reference-entry, other, data-paper, software-paper, editorial,
  // book-review, conference-paper). Protects against someone widening the
  // excluded set ad hoc later and silently dropping legitimate content.
  const keptTypes = [
    "article",
    "review",
    "preprint",
    "book-chapter",
    "conference-abstract",
    "book",
    "dissertation",
    "report",
    "conference-paper",
    "letter",
    "standard",
    "reference-entry",
    "other",
    "data-paper",
    "software-paper",
    "editorial",
    "book-review",
  ];

  it.each(droppedTypes)(
    "drops a work of confirmed non-paper type %s (mutation target: emptying EXCLUDED_OPENALEX_TYPES turns every one of these red)",
    (t) => {
      expect(isExcludedOpenAlexType(work({ type: t }))).toBe(true);
    },
  );

  it.each(keptTypes)("keeps a work of type %s — never excluded", (t) => {
    expect(isExcludedOpenAlexType(work({ type: t }))).toBe(false);
  });

  it("is case-insensitive against OpenAlex's own casing (defensive — OpenAlex's own values are lowercase-kebab in practice)", () => {
    expect(isExcludedOpenAlexType(work({ type: "DATASET" }))).toBe(true);
    expect(isExcludedOpenAlexType(work({ type: "Article" }))).toBe(false);
  });

  it("falls back to type_crossref for the exclusion check too — the same preference metadata.workType uses", () => {
    expect(isExcludedOpenAlexType(work({ type_crossref: "dataset" }))).toBe(true);
  });

  it("is false when neither `type` nor `type_crossref` is present — never excludes an untyped record", () => {
    expect(isExcludedOpenAlexType(work({}))).toBe(false);
  });

  it("EXCLUDED_OPENALEX_TYPES pins the exact shipped set — a table-level tripwire so any future change is deliberate, not accidental", () => {
    expect(Array.from(EXCLUDED_OPENALEX_TYPES).sort()).toEqual(droppedTypes.slice().sort());
  });
});

// DATASET-RECORDS (§1bl.8 AMENDMENT) — the RawItem-keyed sibling check that
// feed/dedup.ts's dedupItems applies as the single pipeline choke point.
describe("isExcludedOpenAlexRawItem — the pipeline choke point's own check (DATASET-RECORDS §1bl.8)", () => {
  function rawItem(overrides: Partial<RawItem> & { source: RawItem["source"] }): RawItem {
    return {
      id: "openalex:W1",
      title: "A Fixture Item",
      authors: [],
      url: "https://example.com/paper",
      publishedAt: "2026-01-01",
      metadata: {},
      ...overrides,
    };
  }

  it("excludes an openalex-sourced item whose workType is a dropped type", () => {
    expect(
      isExcludedOpenAlexRawItem(rawItem({ source: "openalex", metadata: { workType: "dataset" } })),
    ).toBe(true);
  });

  it("keeps an openalex-sourced item whose workType is a kept type", () => {
    expect(
      isExcludedOpenAlexRawItem(rawItem({ source: "openalex", metadata: { workType: "article" } })),
    ).toBe(false);
  });

  it("keeps an openalex-sourced item with no workType at all (never excludes an untyped record)", () => {
    expect(isExcludedOpenAlexRawItem(rawItem({ source: "openalex", metadata: {} }))).toBe(false);
  });

  it("is case-insensitive, same as isExcludedOpenAlexType", () => {
    expect(
      isExcludedOpenAlexRawItem(rawItem({ source: "openalex", metadata: { workType: "DATASET" } })),
    ).toBe(true);
  });

  // The cross-source guard: PubMed's own `pubtype` vocabulary legitimately
  // includes a value literally named "Dataset" (B's original investigation,
  // Task 1) — completely unrelated to OpenAlex's lowercase-kebab `type`.
  // This item must NEVER be excluded by this function; source scoping is
  // what protects it, not the workType string itself.
  it("never excludes a non-openalex item, even one whose own workType string coincidentally matches a dropped OpenAlex type name", () => {
    expect(
      isExcludedOpenAlexRawItem(
        rawItem({ id: "pubmed:1", source: "pubmed", metadata: { workType: "Dataset" } }),
      ),
    ).toBe(false);
    expect(
      isExcludedOpenAlexRawItem(
        rawItem({ id: "dblp:1", source: "dblp", metadata: { workType: "dataset" } }),
      ),
    ).toBe(false);
  });

  it.each(["arxiv", "semantic_scholar", "dblp", "pubmed", "web", "hn"] as const)(
    "never excludes any %s-sourced item regardless of workType",
    (source) => {
      expect(isExcludedOpenAlexRawItem(rawItem({ source, metadata: { workType: "dataset" } }))).toBe(
        false,
      );
    },
  );
});
