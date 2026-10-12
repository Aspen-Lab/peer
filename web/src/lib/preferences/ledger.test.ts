import { describe, it, expect } from "vitest";
import {
  applyPreferenceSignal,
  applyUploadPreferenceSignal,
  cleanPreferenceLedger,
  prepareLedger,
  preferenceKey,
  scorePreferenceMatch,
  summarizePreferenceLedger,
} from "./ledger";
import type { PreferenceConcept } from "@/types";
import type { RawItem } from "@/lib/sources/types";

// ── Fixtures ────────────────────────────────────────────────────

const T0 = "2026-01-01T00:00:00.000Z";
const T0_MS = Date.parse(T0);
// Two 60-day half-lives after T0.
const T120 = "2026-05-01T00:00:00.000Z";

function concept(label: string, id = `t-${label}`): PreferenceConcept {
  return {
    key: preferenceKey(label, "openalex_topic", id),
    label,
    source: "openalex_topic",
  };
}

function itemWith(signals: PreferenceConcept[]): RawItem {
  return {
    id: "openalex:W1",
    source: "openalex",
    title: "Test paper",
    authors: [],
    url: "",
    publishedAt: "",
    metadata: { preferenceSignals: signals },
  };
}

// ── preferenceKey / normalization ───────────────────────────────

describe("preferenceKey", () => {
  it("keys by OpenAlex id when available (so variants merge)", () => {
    expect(preferenceKey("Lithium cobalt oxide", "openalex_topic", "T123")).toBe(
      "openalex_topic:t123",
    );
    expect(
      preferenceKey("LCO", "openalex_topic", "https://openalex.org/T123"),
    ).toBe("openalex_topic:t123");
  });

  it("falls back to a normalized text key when no id", () => {
    expect(preferenceKey("Solid-State Battery!")).toBe("text:solid-state battery");
  });
});

// ── applyPreferenceSignal ───────────────────────────────────────

describe("applyPreferenceSignal", () => {
  it("accumulates positive evidence", () => {
    const c = concept("Lithium cobalt oxide");
    let ledger = applyPreferenceSignal(undefined, [c], "positive", { at: T0 });
    expect(ledger[c.key].positive).toBe(1);
    ledger = applyPreferenceSignal(ledger, [c], "positive", { at: T0 });
    expect(ledger[c.key].positive).toBe(2);
    expect(ledger[c.key].negative).toBe(0);
  });

  it("never records a negative against a required topic", () => {
    const c = concept("Lithium cobalt oxide");
    const ledger = applyPreferenceSignal(undefined, [c], "negative", {
      requiredTopics: ["lithium cobalt oxide"],
    });
    expect(Object.keys(ledger)).toHaveLength(0);
  });

  it("decays older evidence before adding new (half-life)", () => {
    const c = concept("solid state battery");
    let ledger = applyPreferenceSignal(undefined, [c], "positive", { at: T0 });
    // 120 days later = 2 half-lives → 1 * 0.25 = 0.25, then +1 = 1.25
    ledger = applyPreferenceSignal(ledger, [c], "positive", { at: T120 });
    expect(ledger[c.key].positive).toBeCloseTo(1.25, 2);
  });
});

// ── scorePreferenceMatch ────────────────────────────────────────

describe("scorePreferenceMatch", () => {
  it("is neutral when the ledger is empty", () => {
    const r = scorePreferenceMatch(itemWith([concept("anything")]), prepareLedger({}), [], {
      now: T0_MS,
    });
    expect(r.boost).toBe(0);
    expect(r.penalty).toBe(1);
  });

  it("boosts a net-positive concept and applies no penalty", () => {
    const c = concept("Lithium cobalt oxide");
    const ledger = applyPreferenceSignal(undefined, [c], "positive", { at: T0 });
    const r = scorePreferenceMatch(itemWith([c]), prepareLedger(ledger), [], { now: T0_MS });
    expect(r.boost).toBeGreaterThan(0);
    expect(r.penalty).toBe(1);
    expect(r.matchedPositive).toContain("Lithium cobalt oxide");
  });

  it("penalizes a net-negative concept", () => {
    const c = concept("cost analysis");
    let ledger = applyPreferenceSignal(undefined, [c], "negative", { at: T0 });
    ledger = applyPreferenceSignal(ledger, [c], "negative", { at: T0 });
    const r = scorePreferenceMatch(itemWith([c]), prepareLedger(ledger), [], { now: T0_MS });
    expect(r.penalty).toBeLessThan(1);
    expect(r.boost).toBe(0);
    expect(r.matchedNegative).toContain("cost analysis");
  });

  it("protects required topics from penalty at read time too", () => {
    const c = concept("Lithium cobalt oxide");
    // Negative was somehow recorded (e.g. before it became required); reading
    // with it as required must not penalize.
    const ledger = applyPreferenceSignal(undefined, [c], "negative", { at: T0 });
    const r = scorePreferenceMatch(itemWith([c]), prepareLedger(ledger), ["lithium cobalt oxide"], {
      now: T0_MS,
    });
    expect(r.penalty).toBe(1);
  });

  it("net sentiment protects a shared liked+disliked concept (item 1)", () => {
    const c = concept("solid state battery");
    // liked twice, disliked once → net positive → no penalty
    let ledger = applyPreferenceSignal(undefined, [c], "positive", { at: T0 });
    ledger = applyPreferenceSignal(ledger, [c], "positive", { at: T0 });
    ledger = applyPreferenceSignal(ledger, [c], "negative", { at: T0 });
    const r = scorePreferenceMatch(itemWith([c]), prepareLedger(ledger), [], { now: T0_MS });
    expect(r.penalty).toBe(1);
    expect(r.boost).toBeGreaterThan(0);
  });

  // 9-25 (Ruling 4): confirm — an upload-sourced concept has no OpenAlex
  // taxonomy id, so it can only ever match a candidate's title/abstract by
  // its own literal words. That match must be word-bounded (padded-space
  // `includes`, both sides run through the same `normalizePreferenceLabel`),
  // never a substring hit inside an unrelated, longer word.
  it("matches an upload-sourced concept's title text only at a word boundary, never inside a longer word", () => {
    const documentKey = "c".repeat(64);
    const ledger = applyUploadPreferenceSignal({}, [
      { key: preferenceKey("electrolyte", "uploaded_article"), label: "electrolyte", source: "uploaded_article", confidence: 0.8 },
    ], documentKey, T0);

    const candidateWithWord: RawItem = {
      id: "openalex:W2", source: "openalex", title: "A study of the electrolyte", authors: [],
      url: "", publishedAt: "", metadata: {},
    };
    const candidateWithoutWord: RawItem = {
      id: "openalex:W3", source: "openalex", title: "A study of a nonelectrolyte compound", authors: [],
      url: "", publishedAt: "", metadata: {},
    };
    const hit = scorePreferenceMatch(candidateWithWord, prepareLedger(ledger), [], { now: T0_MS });
    const miss = scorePreferenceMatch(candidateWithoutWord, prepareLedger(ledger), [], { now: T0_MS });
    expect(hit.boost).toBeGreaterThan(0);
    expect(hit.matchedPositive).toContain("electrolyte");
    expect(miss.boost).toBe(0);
    expect(miss.matchedPositive).toEqual([]);
  });
});

// ── summarizePreferenceLedger ───────────────────────────────────

describe("summarizePreferenceLedger", () => {
  it("splits and sorts liked vs disliked by decayed net", () => {
    const loved = concept("Lithium cobalt oxide");
    const mild = concept("thin films");
    const disliked = concept("cost analysis");
    let ledger = applyPreferenceSignal(undefined, [loved], "positive", { at: T0 });
    ledger = applyPreferenceSignal(ledger, [loved], "positive", { at: T0 });
    ledger = applyPreferenceSignal(ledger, [loved], "positive", { at: T0 });
    ledger = applyPreferenceSignal(ledger, [mild], "positive", { at: T0 });
    ledger = applyPreferenceSignal(ledger, [disliked], "negative", { at: T0 });

    const { liked, disliked: down } = summarizePreferenceLedger(ledger, T0_MS);
    expect(liked[0].label).toBe("Lithium cobalt oxide"); // strongest first
    expect(liked.map((r) => r.label)).toContain("thin films");
    expect(down[0].label).toBe("cost analysis");
    expect(down[0].weight).toBeGreaterThan(0);
  });
});

// ── cleanPreferenceLedger ───────────────────────────────────────

describe("cleanPreferenceLedger", () => {
  it("drops malformed entries and coerces counts", () => {
    const clean = cleanPreferenceLedger({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      good: { key: "text:battery", label: "battery", source: "paper_keyword", positive: 2, negative: 0, lastSeenAt: T0 } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      missingLabel: { key: "text:x", positive: 9 } as any,
    });
    expect(clean["text:battery"].positive).toBe(2);
    expect(clean.missingLabel).toBeUndefined();
  });
});

// ── Event and job entries (stopped feeds, P9-35) ───────────────

describe("event and job entries from an older build", () => {
  const ml = concept("machine learning");

  // RE-AIMED, NOT DELETED (was "job feedback never affects paper scoring"):
  // the property stays and now holds by deletion. An entry recorded from a job
  // is a raw object here, because the type no longer carries `origin`.
  it("job feedback never affects paper scoring", () => {
    const stored = {
      [`job|${ml.key}`]: {
        key: `job|${ml.key}`,
        label: ml.label,
        source: "openalex_topic",
        origin: "job",
        positive: 0,
        negative: 1,
        lastNegativeAt: T0,
        lastSeenAt: T0,
      },
    } as unknown as Parameters<typeof prepareLedger>[0];
    const score = scorePreferenceMatch(itemWith([ml]), prepareLedger(stored), [], {
      now: T0_MS,
    });
    expect(score.penalty).toBe(1);
    expect(score.matchedNegative).toEqual([]);
  });

  // RE-AIMED, NOT DELETED (was "cleanPreferenceLedger preserves origin and
  // survives roundtrip"): the cleaner used to keep the origin; it now deletes
  // the entry that carries one (`ledger.opportunity.test.ts` pins why).
  it("cleanPreferenceLedger deletes an entry that carries an event origin, and survives a roundtrip", () => {
    const stored = {
      [`event|${ml.key}`]: {
        key: `event|${ml.key}`,
        label: ml.label,
        source: "openalex_topic",
        origin: "event",
        positive: 1,
        negative: 0,
        lastSeenAt: T0,
      },
    };
    const cleaned = cleanPreferenceLedger(JSON.parse(JSON.stringify(stored)));
    expect(cleaned).toEqual({});
  });
});
