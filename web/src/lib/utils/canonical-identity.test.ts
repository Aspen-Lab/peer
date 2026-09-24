import { describe, expect, it } from "vitest";
import {
  canonicalPaperKey,
  idFormKeys,
  isDeliveredIdentity,
  normalizeDoi,
  normalizeTitle,
  sameCanonicalWork,
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

describe("sameCanonicalWork", () => {
  it("is true when both items share a real id-form key", () => {
    const a = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W1",
      doi: "10.1000/shared",
      title: "Neural Networks For Climate Modeling A Survey",
    });
    const b = canonicalPaperKey({
      source: "semantic_scholar",
      id: "semantic_scholar:S2X",
      doi: "10.1000/SHARED",
      title: "Neural networks for climate modeling — a survey (extended)",
    });
    expect(
      sameCanonicalWork({ identity: a }, { identity: b }),
    ).toBe(true);
  });

  it("is false on conflicting dois even when title/year/author all match (preprint vs published)", () => {
    const a = canonicalPaperKey({
      source: "arxiv",
      id: "arxiv:2409.11111",
      doi: "10.48550/arxiv.2409.11111",
      title: "Efficient Transformer Architectures For Long Context Reasoning",
    });
    const b = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W999",
      doi: "10.1109/tpami.2024.123456",
      title: "Efficient Transformer Architectures For Long Context Reasoning",
    });
    expect(
      sameCanonicalWork(
        { identity: a, publishedYear: 2024, firstAuthorSurname: "Third" },
        { identity: b, publishedYear: 2024, firstAuthorSurname: "Third" },
      ),
    ).toBe(false);
  });

  it("is true via normalized title + year within 1 + same first-author surname when neither has an id", () => {
    const a = canonicalPaperKey({
      source: "dblp",
      id: "dblp:x/1",
      title: "Scalable Graph Neural Networks For Molecular Property Prediction",
    });
    const b = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W2",
      title: "Scalable Graph Neural Networks For Molecular Property Prediction",
    });
    expect(
      sameCanonicalWork(
        { identity: a, publishedYear: 2022, firstAuthorSurname: "Fifth" },
        { identity: b, publishedYear: 2023, firstAuthorSurname: "Fifth" },
      ),
    ).toBe(true);
  });

  it("is false when the year gap exceeds 1", () => {
    const a = canonicalPaperKey({
      source: "dblp",
      id: "dblp:x/1",
      title: "Comprehensive Review Of Battery Degradation Mechanisms",
    });
    const b = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W2",
      title: "Comprehensive Review Of Battery Degradation Mechanisms",
    });
    expect(
      sameCanonicalWork(
        { identity: a, publishedYear: 2015, firstAuthorSurname: "First" },
        { identity: b, publishedYear: 2023, firstAuthorSurname: "Second" },
      ),
    ).toBe(false);
  });

  it("is false when the first-author surname differs", () => {
    const a = canonicalPaperKey({
      source: "dblp",
      id: "dblp:x/1",
      title: "Comprehensive Review Of Battery Degradation Mechanisms",
    });
    const b = canonicalPaperKey({
      source: "openalex",
      id: "openalex:W2",
      title: "Comprehensive Review Of Battery Degradation Mechanisms",
    });
    expect(
      sameCanonicalWork(
        { identity: a, publishedYear: 2021, firstAuthorSurname: "First" },
        { identity: b, publishedYear: 2021, firstAuthorSurname: "Second" },
      ),
    ).toBe(false);
  });

  it("is false when the title has too few qualifying tokens to alias, even with matching year/author", () => {
    const a = canonicalPaperKey({ source: "dblp", id: "dblp:x/1", title: "Editorial" });
    const b = canonicalPaperKey({ source: "openalex", id: "openalex:W2", title: "Editorial" });
    expect(
      sameCanonicalWork(
        { identity: a, publishedYear: 2021, firstAuthorSurname: "Same" },
        { identity: b, publishedYear: 2021, firstAuthorSurname: "Same" },
      ),
    ).toBe(false);
  });

  it("never throws on empty inputs", () => {
    const empty = canonicalPaperKey({});
    expect(() => sameCanonicalWork({ identity: empty }, { identity: empty })).not.toThrow();
  });
});
