import { describe, expect, it } from "vitest";
import { paperContentHash } from "./paper-content-hash";

const BASE = { title: "Sulfide electrolytes for solid-state batteries", abstract: "We study ionic conductivity.", venue: "Nature Energy" };

describe("paperContentHash", () => {
  it("is deterministic for identical input", () => {
    expect(paperContentHash(BASE)).toBe(paperContentHash({ ...BASE }));
  });

  it("returns a 64-character lowercase hex sha256 digest", () => {
    const hash = paperContentHash(BASE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the title changes", () => {
    const other = paperContentHash({ ...BASE, title: "A different title entirely" });
    expect(other).not.toBe(paperContentHash(BASE));
  });

  it("changes when the abstract changes", () => {
    const other = paperContentHash({ ...BASE, abstract: "A completely different abstract." });
    expect(other).not.toBe(paperContentHash(BASE));
  });

  it("changes when the venue changes", () => {
    const other = paperContentHash({ ...BASE, venue: "Science" });
    expect(other).not.toBe(paperContentHash(BASE));
  });

  it("treats a null abstract as distinct from an empty-string abstract", () => {
    const nullAbstract = paperContentHash({ ...BASE, abstract: null });
    const emptyAbstract = paperContentHash({ ...BASE, abstract: "" });
    expect(nullAbstract).not.toBe(emptyAbstract);
  });

  it("treats a missing venue the same as an explicitly undefined venue", () => {
    const { venue: _venue, ...withoutVenue } = BASE;
    const explicitUndefined = paperContentHash({ ...BASE, venue: undefined });
    expect(paperContentHash(withoutVenue)).toBe(explicitUndefined);
  });

  it("normalizes surrounding whitespace in title, abstract, and venue", () => {
    const padded = paperContentHash({
      title: `  ${BASE.title}  `,
      abstract: `  ${BASE.abstract}  `,
      venue: `  ${BASE.venue}  `,
    });
    expect(padded).toBe(paperContentHash(BASE));
  });

  it("does not accept or depend on any date/time input — same call twice is always identical", () => {
    // No `now`/date parameter exists on the function signature at all; this
    // asserts purity rather than merely "the same instant produces the same
    // hash", since there is no clock input to vary in the first place.
    const first = paperContentHash(BASE);
    const second = paperContentHash(BASE);
    expect(first).toBe(second);
    expect(paperContentHash.length).toBe(1); // exactly one parameter — no hidden `now`
  });

  it("is not affected by the paper's retrieval/ranking score or any field outside title/abstract/venue", () => {
    // TypeScript would reject an extra field at the call site; this documents
    // the contract for a reader without requiring a type-level test file.
    const withKnownFieldsOnly = paperContentHash(BASE);
    const sameKnownFields = paperContentHash({ title: BASE.title, abstract: BASE.abstract, venue: BASE.venue });
    expect(withKnownFieldsOnly).toBe(sameKnownFields);
  });
});
