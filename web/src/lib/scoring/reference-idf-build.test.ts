import { describe, expect, it } from "vitest";
import { tokenize as shippedTokenize } from "./tokenize";
// scripts/ is deliberately outside src/ (off the request path, plain Node ESM, no
// "@/" alias configured for it); see build-reference-idf.mjs's own header for why
// this repo keeps that script as a verbatim tokenizer port instead of importing
// tokenize.ts directly. (A2 review, LOW-2: an eslint-disable comment previously sat
// here for `import/no-relative-packages` — removed after confirming that rule never
// actually fires on a relative path import in the first place, so the comment was
// itself the whole source of the "+1 unused eslint-disable directive" warning.)
import { tokenize as portTokenize } from "../../../scripts/build-reference-idf.mjs";
import referenceIdfTable from "./reference-idf.json";

// DRIFT TRIPWIRE (ABC-JEV-INTEGRATION.md §1ap AMENDMENT 4, phase-2 instruction 3) —
// web/scripts/build-reference-idf.mjs keeps its OWN copy of tokenize.ts's tokenizer
// (this repo has no tsx/ts-node dependency and no existing precedent of a .ts script
// under web/scripts/, so build-reference-idf.mjs stays a plain .mjs like every other
// script there, rather than importing the real .ts module directly). That copy can
// silently drift from the shipped tokenizer the moment someone edits tokenize.ts
// (e.g. the STOPWORDS list, or the character-class regex) without updating the
// build script to match — reference-idf.json's weights would then no longer agree
// with what the runtime gate actually tokenizes. This test imports BOTH tokenizers
// and asserts they produce IDENTICAL output on a fixed, varied sample, so that kind
// of drift fails the suite immediately instead of silently degrading the gate.
describe("reference-IDF build/runtime tokenizer agreement (drift tripwire)", () => {
  const samples = [
    "Solid-state battery electrolyte interfaces for electric-vehicle applications.",
    "We report a high-voltage LiCoO2 (LCO) cathode with a stable interface.",
    "Light cycle oil upgrading to high quality fuels and petrochemicals: a review.",
    "Serum electrolyte imbalance in critically ill patients — a clinical review.",
    "Ionic conductivity, dendrite growth, and interfacial stability in Li-ion cells.",
    "Numbers123 and short a an of words; punctuation!? should be handled the same way.",
    "Mixed-CASE Text With Hyphen-ated Compound-Words and 4.6V voltages.",
    "",
  ];

  it("produces byte-identical token arrays for every sample", () => {
    for (const sample of samples) {
      expect(portTokenize(sample)).toEqual(shippedTokenize(sample));
    }
  });

  it("agrees on a combined multi-sentence document (title + abstract shape)", () => {
    const combined = samples.join(" ");
    expect(portTokenize(combined)).toEqual(shippedTokenize(combined));
  });
});

describe("shipped reference-idf.json shape (sanity, not a rebuild)", () => {
  it("is a flat token -> positive-number map with no source text leaked in", () => {
    const entries = Object.entries(referenceIdfTable as Record<string, number>);
    expect(entries.length).toBeGreaterThan(1000);
    for (const [token, weight] of entries.slice(0, 500)) {
      expect(token).not.toMatch(/\s/); // a real token never contains whitespace
      expect(typeof weight).toBe("number");
      expect(weight).toBeGreaterThan(0);
    }
  });

  it("stays within the ~300KB build target", () => {
    const bytes = Buffer.byteLength(JSON.stringify(referenceIdfTable), "utf8");
    expect(bytes).toBeLessThanOrEqual(300 * 1024);
  });
});
