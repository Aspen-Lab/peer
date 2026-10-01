import { describe, expect, it } from "vitest";
import {
  canonicalPaperKey,
  idFormKeys,
  isDeliveredIdentity,
  normalizeDoi,
  normalizeTitle,
  type CanonicalIdentity,
} from "./canonical-identity";

// P2-S1 (Round 3): shared canonical paper identity, per ABC-JEV-INTEGRATION.md
// §1p.A. Reused by dedupe (dedup.test.ts) and, later, by the P4 delivery
// ledger — this file is the one place identity behavior is specified and
// tested, so both callers can trust it without re-deriving DOI/title rules.

describe("normalizeDoi", () => {
  it("lowercases and passes through a bare DOI", () => {
    expect(normalizeDoi("10.1000/XYZ123")).toBe("10.1000/xyz123");
  });

  it("strips an https://doi.org/ prefix", () => {
    expect(normalizeDoi("https://doi.org/10.1000/xyz123")).toBe("10.1000/xyz123");
  });

  it("strips an http://dx.doi.org/ prefix", () => {
    expect(normalizeDoi("http://dx.doi.org/10.1000/xyz123")).toBe("10.1000/xyz123");
  });

  it("strips an https://dx.doi.org/ prefix", () => {
    expect(normalizeDoi("https://dx.doi.org/10.1000/xyz123")).toBe("10.1000/xyz123");
  });

  it("strips a doi: prefix", () => {
    expect(normalizeDoi("doi:10.1000/xyz123")).toBe("10.1000/xyz123");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDoi("  10.1000/xyz123  ")).toBe("10.1000/xyz123");
  });

  it("returns undefined for a malformed DOI instead of throwing", () => {
    expect(normalizeDoi("not-a-doi")).toBeUndefined();
    expect(normalizeDoi("10.abc/xyz")).toBeUndefined();
    expect(normalizeDoi("10.1000/has a space")).toBeUndefined();
  });

  it("returns undefined for empty/undefined/null input without throwing", () => {
    expect(() => normalizeDoi(undefined)).not.toThrow();
    expect(() => normalizeDoi(null)).not.toThrow();
    expect(() => normalizeDoi("")).not.toThrow();
    expect(normalizeDoi(undefined)).toBeUndefined();
    expect(normalizeDoi(null)).toBeUndefined();
    expect(normalizeDoi("")).toBeUndefined();
    expect(normalizeDoi("   ")).toBeUndefined();
  });
});

describe("normalizeTitle", () => {
  it("lowercases, turns punctuation into spaces, and collapses whitespace", () => {
    expect(normalizeTitle("Neural Networks: A Survey!!")).toBe("neural networks a survey");
  });

  it("returns an empty string for empty/undefined input", () => {
    expect(normalizeTitle("")).toBe("");
    expect(normalizeTitle(undefined)).toBe("");
  });
});

describe("canonicalPaperKey — key priority", () => {
  const LONG_TITLE = "Efficient Transformer Architectures For Long Context Reasoning";

  it("prefers doi: over every other id form", () => {
    const id = canonicalPaperKey({
      source: "arxiv",
      id: "arxiv:2409.11111",
      doi: "10.1000/aaa",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("doi:10.1000/aaa");
    expect(id.aliases).toContain("arxiv:2409.11111");
  });

  it("falls back to s2: when no doi is present", () => {
    const id = canonicalPaperKey({
      source: "semantic_scholar",
      id: "semantic_scholar:S2ABC",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("s2:S2ABC");
  });

  it("falls back to openalex: when no doi/s2 is present", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W123456789",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("openalex:W123456789");
  });

  it("falls back to arxiv: and strips a version suffix", () => {
    const id = canonicalPaperKey({
      source: "arxiv",
      id: "arxiv:2409.12345v2",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("arxiv:2409.12345");
  });

  it("falls back to pmid: when no doi/s2/openalex/arxiv is present", () => {
    const id = canonicalPaperKey({
      source: "pubmed",
      id: "pubmed:987654",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("pmid:987654");
  });

  it("falls back to title: when no id form is present at all", () => {
    const id = canonicalPaperKey({
      source: "dblp",
      id: "dblp:conf/xyz/2024",
      title: LONG_TITLE,
    });
    expect(id.key).toBe(`title:${normalizeTitle(LONG_TITLE)}`);
    expect(id.aliases).toEqual([]);
  });

  it("falls back to a stable, never-colliding item: key when nothing is usable, without throwing", () => {
    expect(() =>
      canonicalPaperKey({ source: "web", id: "web:xyz", title: "" }),
    ).not.toThrow();
    const id = canonicalPaperKey({ source: "web", id: "web:xyz", title: "" });
    expect(id.key).toBe("item:web:xyz");
    expect(id.aliases).toEqual([]);
  });

  it("always returns keyVersion 1", () => {
    const id = canonicalPaperKey({ source: "openalex", id: "openalex:W1", title: LONG_TITLE });
    expect(id.keyVersion).toBe(1);
  });
});

describe("canonicalPaperKey — cross-source externalIds bag", () => {
  it("pulls a doi out of externalIds when the item's own doi field is absent", () => {
    const id = canonicalPaperKey({
      source: "arxiv",
      id: "arxiv:2409.99999",
      externalIds: { doi: "10.1234/example" },
      title: "Efficient Transformer Architectures For Long Context Reasoning",
    });
    expect(id.key).toBe("doi:10.1234/example");
    expect(id.aliases).toContain("arxiv:2409.99999");
  });

  it("adds cross-referenced arxiv/pmid ids as aliases alongside the item's own s2: key", () => {
    const id = canonicalPaperKey({
      source: "semantic_scholar",
      id: "semantic_scholar:S2X",
      externalIds: { arxivId: "2409.12345", pmid: "123456" },
      title: "A Fairly Long And Distinctive Title Worth Aliasing",
    });
    expect(id.key).toBe("s2:S2X");
    expect(id.aliases).toEqual(
      expect.arrayContaining(["arxiv:2409.12345", "pmid:123456"]),
    );
  });
});

describe("canonicalPaperKey — title alias rules", () => {
  it("does not emit a title alias under 4 qualifying (length>=3) tokens", () => {
    // "on the use of ai" -> qualifying (len>=3) tokens: "the", "use" = 2 < 4
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W1",
      doi: "10.1000/short-title",
      title: "On The Use Of AI",
    });
    expect(id.aliases.some((a) => a.startsWith("title:"))).toBe(false);
  });

  it("emits a title alias at exactly 4 qualifying tokens", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W1",
      doi: "10.1000/four-token-title",
      title: "Deep Learning For Materials",
    });
    expect(id.aliases).toContain("title:deep learning for materials");
  });

  it("never emits a title alias for a generic single-word title", () => {
    const id = canonicalPaperKey({
      source: "dblp",
      id: "dblp:x/1",
      doi: "10.1000/editorial-2024",
      title: "Editorial",
    });
    expect(id.aliases.some((a) => a.startsWith("title:"))).toBe(false);
  });

  it("emits the title alias without a year, as normalized full text", () => {
    const id = canonicalPaperKey({
      source: "dblp",
      id: "dblp:x/2",
      title: "Battery Materials Discovery Via Machine Learning, 2024 Edition!",
    });
    expect(id.key).toBe(
      "title:battery materials discovery via machine learning 2024 edition",
    );
  });
});

// DEDUP-ANGEW (ABC-JEV-INTEGRATION.md §1aw,
// docs/jev-abc/DEDUP-ANGEW-B-20260929T064532Z.md): Wiley mints two parallel
// DOIs for the same peer-reviewed Angewandte Chemie article — an
// International Edition "anie" code and a German-language "ange" code,
// sharing the article's numeric suffix. Unit tests for the helper alone;
// the end-to-end merge (through dedupItems/clusterCanonicalWorks) is covered
// by dedup.test.ts's own DEDUP-ANGEW section.
describe("canonicalPaperKey — dual-edition Angewandte DOI alias (DEDUP-ANGEW)", () => {
  const LONG_TITLE = "Efficient Transformer Architectures For Long Context Reasoning";

  it("gives an ange DOI an extra doi: alias pointing at its anie sibling, without changing key", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_ANGE",
      doi: "10.1002/ange.5600863",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("doi:10.1002/ange.5600863");
    expect(id.aliases).toContain("doi:10.1002/anie.5600863");
  });

  it("adds no self-alias for an anie DOI — nothing to alias an anie record to", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_ANIE",
      doi: "10.1002/anie.5600863",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("doi:10.1002/anie.5600863");
    expect(id.aliases).not.toContain("doi:10.1002/anie.5600863");
    expect(id.aliases.some((a) => a.startsWith("doi:"))).toBe(false);
  });

  it("does not alias when the registrant is not 10.1002, even with the exact ange.<digits> shape", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_WRONG_REGISTRANT",
      doi: "10.9999/ange.5600863",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("doi:10.9999/ange.5600863");
    expect(id.aliases.some((a) => a.startsWith("doi:"))).toBe(false);
  });

  it('does not alias a DOI where "ange" is only a substring of a longer journal code', () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_SUBSTRING",
      doi: "10.1002/orange.5600863",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("doi:10.1002/orange.5600863");
    expect(id.aliases.some((a) => a.startsWith("doi:"))).toBe(false);
  });

  it("does not alias a suffix with a trailing non-digit (e.g. a supporting-information DOI) — accepted limitation, not a bug", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_SUPP_INFO",
      doi: "10.1002/ange.5600863.s1",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("doi:10.1002/ange.5600863.s1");
    expect(id.aliases.some((a) => a.startsWith("doi:"))).toBe(false);
  });

  it("two different Angewandte papers (different numeric suffixes) never alias to each other", () => {
    const first = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_N1",
      doi: "10.1002/ange.111111",
      title: LONG_TITLE,
    });
    const second = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_N2",
      doi: "10.1002/anie.222222",
      title: LONG_TITLE,
    });
    expect(first.aliases).toContain("doi:10.1002/anie.111111");
    expect(first.aliases).not.toContain("doi:10.1002/anie.222222");
    expect(second.key).toBe("doi:10.1002/anie.222222");
    expect(new Set([first.key, ...first.aliases])).not.toEqual(
      expect.arrayContaining([second.key]),
    );
  });

  it("is applied AFTER normalizeDoi, so an uppercase/prefixed input still aliases correctly (case/prefix-insensitive)", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_UPPER",
      doi: "https://doi.org/10.1002/ANGE.5600863",
      title: LONG_TITLE,
    });
    expect(id.key).toBe("doi:10.1002/ange.5600863");
    expect(id.aliases).toContain("doi:10.1002/anie.5600863");
  });
});

// DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl,
// docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md): Figshare mints a
// separate OpenAlex Work per version of the same deposited record, appending
// a plain textual ".v<N>" suffix onto the SAME base DOI. Unit tests for the
// helper alone; the end-to-end merge (through dedupItems/clusterCanonicalWorks)
// is covered by dedup.test.ts's own DATASET-RECORDS section.
describe("canonicalPaperKey — Figshare version-DOI alias (DATASET-RECORDS)", () => {
  const SHORT_TITLE = "O2-LCO-DATA";

  it("gives a versioned Figshare DOI an extra doi: alias pointing at its base sibling, without changing key", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_VERSIONED",
      doi: "10.6084/m9.figshare.33608659.v4",
      title: SHORT_TITLE,
    });
    expect(id.key).toBe("doi:10.6084/m9.figshare.33608659.v4");
    expect(id.aliases).toContain("doi:10.6084/m9.figshare.33608659");
  });

  it("adds no self-alias for an already-base (unversioned) Figshare DOI — nothing to alias it to", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_BASE",
      doi: "10.6084/m9.figshare.33608659",
      title: SHORT_TITLE,
    });
    expect(id.key).toBe("doi:10.6084/m9.figshare.33608659");
    expect(id.aliases.some((a) => a.startsWith("doi:"))).toBe(false);
  });

  it("does not alias when the registrant is not 10.6084, even with the exact .vN suffix shape", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_WRONG_REGISTRANT",
      doi: "10.5281/zenodo.22813654.v2",
      title: SHORT_TITLE,
    });
    expect(id.key).toBe("doi:10.5281/zenodo.22813654.v2");
    expect(id.aliases.some((a) => a.startsWith("doi:"))).toBe(false);
  });

  it("two different (unrelated) Figshare works never alias to each other", () => {
    const first = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_F1",
      doi: "10.6084/m9.figshare.11111.v1",
      title: SHORT_TITLE,
    });
    const second = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_F2",
      doi: "10.6084/m9.figshare.22222",
      title: SHORT_TITLE,
    });
    expect(first.aliases).toContain("doi:10.6084/m9.figshare.11111");
    expect(first.aliases).not.toContain("doi:10.6084/m9.figshare.22222");
    expect(second.key).toBe("doi:10.6084/m9.figshare.22222");
    expect(new Set([first.key, ...first.aliases])).not.toEqual(
      expect.arrayContaining([second.key]),
    );
  });

  it('does not alias a suffix that only LOOKS like a version marker without the exact ".v<digits>" trailing shape (accepted, safe-direction miss)', () => {
    const hyphenJoined = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_HYPHEN",
      doi: "10.6084/m9.figshare.12345-v4-experiment",
      title: SHORT_TITLE,
    });
    expect(hyphenJoined.aliases.some((a) => a.startsWith("doi:"))).toBe(false);

    const dotless = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_DOTLESS",
      doi: "10.6084/m9.figshare.12345v4",
      title: SHORT_TITLE,
    });
    expect(dotless.aliases.some((a) => a.startsWith("doi:"))).toBe(false);
  });

  it("is applied AFTER normalizeDoi, so an uppercase/prefixed input still aliases correctly (case/prefix-insensitive)", () => {
    const id = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W_UPPER",
      doi: "https://doi.org/10.6084/M9.FIGSHARE.33608659.V4",
      title: SHORT_TITLE,
    });
    expect(id.key).toBe("doi:10.6084/m9.figshare.33608659.v4");
    expect(id.aliases).toContain("doi:10.6084/m9.figshare.33608659");
  });
});

describe("isDeliveredIdentity", () => {
  const identity: CanonicalIdentity = {
    key: "doi:10.1000/aaa",
    keyVersion: 1,
    aliases: ["arxiv:2409.11111", "title:some long distinctive title here"],
  };

  it("is true when the identity's key is in the delivered set", () => {
    expect(isDeliveredIdentity(identity, new Set(["doi:10.1000/aaa"]))).toBe(true);
  });

  it("is true when any alias is in the delivered set (looser on purpose, §1p.A)", () => {
    expect(
      isDeliveredIdentity(identity, new Set(["title:some long distinctive title here"])),
    ).toBe(true);
    expect(isDeliveredIdentity(identity, new Set(["arxiv:2409.11111"]))).toBe(true);
  });

  it("is false when neither the key nor any alias intersects", () => {
    expect(isDeliveredIdentity(identity, new Set(["doi:10.9999/zzz"]))).toBe(false);
  });

  it("is false against an empty set and never throws", () => {
    expect(() => isDeliveredIdentity(identity, new Set())).not.toThrow();
    expect(isDeliveredIdentity(identity, new Set())).toBe(false);
  });
});

describe("idFormKeys", () => {
  it("excludes title: and item: forms, keeping only real id-form keys", () => {
    const identity: CanonicalIdentity = {
      key: "doi:10.1000/aaa",
      keyVersion: 1,
      aliases: ["s2:S2X", "title:some distinctive title text here"],
    };
    expect(idFormKeys(identity)).toEqual(
      expect.arrayContaining(["doi:10.1000/aaa", "s2:S2X"]),
    );
    expect(idFormKeys(identity)).not.toContain("title:some distinctive title text here");
  });

  it("returns an empty array for a title-only or item-only identity", () => {
    expect(
      idFormKeys({ key: "title:some distinctive title text here", keyVersion: 1, aliases: [] }),
    ).toEqual([]);
    expect(idFormKeys({ key: "item:web:xyz", keyVersion: 1, aliases: [] })).toEqual([]);
  });
});

// R3-CLEANUP-3 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX fresh
// A: FAILED_REVIEW... narrowed conflict rule ruled", 2026-09-24T21:21:36Z,
// "remove the unused sameCanonicalWork"): the `describe("sameCanonicalWork",
// ...)` block that used to live here (7 tests) tested a function removed as
// dead code from canonical-identity.ts — grep-confirmed zero production
// callers, independently by three separate checkpoints (DEDUP-FIX C,
// DEDUP-FIX fresh A, and this C). The dedupe rule it encoded is superseded
// three times over (DEDUP-FIX, then DEDUP-FIX2, then DEDUP-FIX3's structural
// pairwise rule) and now lives, correctly, in feed/paper-identity.ts's
// `clusterCanonicalWorks`/`weakPairMatch`/`clustersFullyMatch`
// — see paper-identity.test.ts and dedup.test.ts for its equivalent, current
// coverage (the DEDUP-FIX3-tagged cases there specifically).
