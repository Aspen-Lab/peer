import { describe, expect, it } from "vitest";
import { computeRetrievalIdentityFingerprint, type RetrievalIdentityInput } from "./retrieval-identity";

// P2-S7 (Round 3) — F-A-P2-06 (safe half) / acceptance 8-identity. Pure unit
// tests only; this module is never wired into a live cache in this slice
// (§1k) — see retrieval-identity.ts's own header for the full boundary.

function baseInput(): RetrievalIdentityInput {
  return {
    provider: "openalex",
    channel: "works-semantic-search",
    query: "  Lithium  Ion   Battery Degradation  ",
    semanticDefinitionVersion: "concept-v3",
    language: "en",
    dateInterval: { fromUtc: "2026-01-01T00:00:00Z", toUtc: "2026-09-01T00:00:00Z" },
    filters: { topics: ["T123", "T456"], venueType: "journal" },
    page: 1,
    caps: 50,
    schemaVersion: 2,
    scope: { kind: "private", ownerId: "owner-1", projectId: "project-a" },
    refreshEpochUtc: 1780000000,
  };
}

describe("computeRetrievalIdentityFingerprint", () => {
  it("is stable: the same input (fresh object each time) always yields the same digest", () => {
    const a = computeRetrievalIdentityFingerprint(baseInput());
    const b = computeRetrievalIdentityFingerprint(baseInput());
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.fingerprintVersion).toBe(1);
  });

  it("is unaffected by filter key order or a multi-value filter's own element order", () => {
    const a = computeRetrievalIdentityFingerprint({
      ...baseInput(),
      filters: { topics: ["T123", "T456"], venueType: "journal" },
    });
    const b = computeRetrievalIdentityFingerprint({
      ...baseInput(),
      filters: { venueType: "journal", topics: ["T456", "T123"] },
    });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("changes the digest for every single distinguishing field, and every variant is pairwise distinct", () => {
    const base = baseInput();
    const baseFp = computeRetrievalIdentityFingerprint(base).fingerprint;

    const variants: Record<string, RetrievalIdentityInput> = {
      provider: { ...base, provider: "semantic_scholar" },
      channel: { ...base, channel: "works-keyword-search" },
      query: { ...base, query: "a totally different query" },
      semanticDefinitionVersionChanged: { ...base, semanticDefinitionVersion: "concept-v4" },
      semanticDefinitionVersionAbsent: { ...base, semanticDefinitionVersion: undefined },
      language: { ...base, language: "zh" },
      dateFrom: { ...base, dateInterval: { fromUtc: "2026-02-01T00:00:00Z", toUtc: base.dateInterval.toUtc } },
      dateTo: { ...base, dateInterval: { fromUtc: base.dateInterval.fromUtc, toUtc: "2026-10-01T00:00:00Z" } },
      filterValueChanged: { ...base, filters: { topics: ["T123", "T456"], venueType: "conference" } },
      filterSetChanged: { ...base, filters: { topics: ["T123"], venueType: "journal" } },
      filtersAbsent: { ...base, filters: undefined },
      page: { ...base, page: 2 },
      caps: { ...base, caps: 100 },
      schemaVersion: { ...base, schemaVersion: 3 },
      ownerId: { ...base, scope: { kind: "private", ownerId: "owner-2", projectId: "project-a" } },
      projectIdAbsent: { ...base, scope: { kind: "private", ownerId: "owner-1" } },
      refreshEpoch: { ...base, refreshEpochUtc: 1790000000 },
    };

    const fingerprints = new Set<string>([baseFp]);
    for (const [name, variant] of Object.entries(variants)) {
      const fp = computeRetrievalIdentityFingerprint(variant).fingerprint;
      expect(fp, `variant "${name}" must differ from base`).not.toBe(baseFp);
      fingerprints.add(fp);
    }
    // Every variant is pairwise distinct from every other variant too, not just from base.
    expect(fingerprints.size).toBe(Object.keys(variants).length + 1);
  });

  it("produces a different digest for public vs private scope with otherwise identical fields", () => {
    const base = baseInput();
    const privateFp = computeRetrievalIdentityFingerprint(base).fingerprint;
    const publicFp = computeRetrievalIdentityFingerprint({
      ...base,
      scope: { kind: "public", eligibility: "reviewed" },
    }).fingerprint;
    expect(publicFp).not.toBe(privateFp);
  });

  it("produces different digests for two different owners", () => {
    const base = baseInput();
    const owner1Fp = computeRetrievalIdentityFingerprint(base).fingerprint;
    const owner2Fp = computeRetrievalIdentityFingerprint({
      ...base,
      scope: { kind: "private", ownerId: "owner-2", projectId: "project-a" },
    }).fingerprint;
    expect(owner1Fp).not.toBe(owner2Fp);
  });

  it("echoes the scope kind it was computed from", () => {
    const base = baseInput();
    const priv = computeRetrievalIdentityFingerprint(base);
    expect(priv.scopeKind).toBe("private");
    const pub = computeRetrievalIdentityFingerprint({ ...base, scope: { kind: "public", eligibility: "reviewed" } });
    expect(pub.scopeKind).toBe("public");
  });

  it('never yields a public fingerprint when eligibility is missing or not exactly "reviewed"', () => {
    const base = baseInput();
    expect(() =>
      computeRetrievalIdentityFingerprint({
        ...base,
        scope: { kind: "public" } as unknown as RetrievalIdentityInput["scope"],
      }),
    ).toThrow();
    expect(() =>
      computeRetrievalIdentityFingerprint({
        ...base,
        scope: { kind: "public", eligibility: "pending" } as unknown as RetrievalIdentityInput["scope"],
      }),
    ).toThrow();
  });

  it("rejects a private scope with no ownerId rather than silently fingerprinting an unowned recipe", () => {
    const base = baseInput();
    expect(() =>
      computeRetrievalIdentityFingerprint({
        ...base,
        scope: { kind: "private", ownerId: "" },
      }),
    ).toThrow();
    expect(() =>
      computeRetrievalIdentityFingerprint({
        ...base,
        scope: { kind: "unknown" } as unknown as RetrievalIdentityInput["scope"],
      }),
    ).toThrow();
  });
});
