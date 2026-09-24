import { describe, it, expect } from "vitest";
import {
  applyOpportunityFacetPreferenceSignal,
  applyPreferenceSignal,
  applyUploadPreferenceSignal,
  cleanPreferenceLedger,
  FACET_PREFERENCE_BOOST_MAX,
  facetPreferenceReason,
  materiallyChangedByFacetPreference,
  opportunityFacetPreferenceConcept,
  opportunityFacetPreferenceConcepts,
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
const T14_MS = Date.parse("2026-01-15T00:00:00.000Z");
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

describe("applyOpportunityFacetPreferenceSignal", () => {
  it("records a facet click as separate weak evidence under the event origin", () => {
    const ledger = applyOpportunityFacetPreferenceSignal(
      undefined,
      "location",
      " Chicago ",
      { at: T0, origin: "event" },
    );
    const entry = ledger["event|facet:location:chicago"];

    expect(entry).toMatchObject({
      label: "Chicago",
      source: "opportunity_facet",
      origin: "event",
      positive: 0,
      negative: 0,
      facetPositive: 1,
      lastFacetAt: T0,
    });
  });

  it("keeps event and job facet evidence in their existing origin namespaces", () => {
    let ledger = applyOpportunityFacetPreferenceSignal(
      undefined,
      "format",
      "online",
      { at: T0, origin: "event" },
    );
    ledger = applyOpportunityFacetPreferenceSignal(
      ledger,
      "format",
      "online",
      { at: T0, origin: "job" },
    );

    expect(ledger["event|facet:format:online"].facetPositive).toBe(1);
    expect(ledger["job|facet:format:online"].facetPositive).toBe(1);
  });

  it("normalizes facet keys and ignores empty values", () => {
    expect(
      opportunityFacetPreferenceConcept("month", " 2026-08 "),
    ).toMatchObject({
      key: "facet:month:2026-08",
      label: "2026-08",
    });
    expect(
      applyOpportunityFacetPreferenceSignal(undefined, "location", "   ", {
        at: T0,
        origin: "job",
      }),
    ).toEqual({});
  });

  it("gives hybrid events all format concepts used by facet filtering", () => {
    expect(
      opportunityFacetPreferenceConcepts("events", {
        location: "Chicago, IL + Virtual",
        place: { city: "Chicago", region: "IL" },
        startDate: "2026-08-11",
        isOnline: true,
      }).map(({ key }) => key),
    ).toEqual([
      "facet:location:chicago",
      "facet:month:2026-08",
      "facet:format:hybrid",
      "facet:format:online",
      "facet:format:in-person",
    ]);
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

  it("caps the combined contribution of all facet history", () => {
    const facetConcepts = [
      opportunityFacetPreferenceConcept("location", "Chicago")!,
      opportunityFacetPreferenceConcept("month", "2026-08")!,
      opportunityFacetPreferenceConcept("format", "hybrid")!,
    ];
    let ledger = {};
    for (let count = 0; count < 20; count += 1) {
      for (const [group, value] of [
        ["location", "Chicago"],
        ["month", "2026-08"],
        ["format", "hybrid"],
      ] as const) {
        ledger = applyOpportunityFacetPreferenceSignal(
          ledger,
          group,
          value,
          { at: T0, origin: "event" },
        );
      }
    }

    const result = scorePreferenceMatch(
      itemWith(facetConcepts),
      prepareLedger(ledger),
      [],
      { now: T0_MS, targetKind: "event" },
    );
    expect(result.facetBoost).toBe(FACET_PREFERENCE_BOOST_MAX);
    expect(result.boost).toBe(FACET_PREFERENCE_BOOST_MAX);
  });

  it("decays facet evidence faster than explicit positive evidence", () => {
    const explicitConcept = concept("Chicago");
    const facetConcept = opportunityFacetPreferenceConcept(
      "location",
      "Chicago",
    )!;
    const explicitLedger = applyPreferenceSignal(
      undefined,
      [explicitConcept],
      "positive",
      { at: T0, origin: "event" },
    );
    const facetLedger = applyOpportunityFacetPreferenceSignal(
      undefined,
      "location",
      "Chicago",
      { at: T0, origin: "event" },
    );

    const explicitNow = scorePreferenceMatch(
      itemWith([explicitConcept]),
      prepareLedger(explicitLedger),
      [],
      { now: T0_MS, targetKind: "event" },
    ).boost;
    const explicitLater = scorePreferenceMatch(
      itemWith([explicitConcept]),
      prepareLedger(explicitLedger),
      [],
      { now: T14_MS, targetKind: "event" },
    ).boost;
    const facetNow = scorePreferenceMatch(
      itemWith([facetConcept]),
      prepareLedger(facetLedger),
      [],
      { now: T0_MS, targetKind: "event" },
    ).facetBoost;
    const facetLater = scorePreferenceMatch(
      itemWith([facetConcept]),
      prepareLedger(facetLedger),
      [],
      { now: T14_MS, targetKind: "event" },
    ).facetBoost;

    expect(facetLater).toBeLessThan(facetNow);
    expect(facetLater / facetNow).toBeLessThan(
      explicitLater / explicitNow,
    );
  });

  it("never lets one facet click counteract an explicit dismissal", () => {
    const dismissed = concept("solid-state battery");
    const chicago = opportunityFacetPreferenceConcept(
      "location",
      "Chicago",
    )!;
    let ledger = applyOpportunityFacetPreferenceSignal(
      undefined,
      "location",
      "Chicago",
      { at: T0, origin: "event" },
    );
    ledger = applyPreferenceSignal(ledger, [dismissed], "negative", {
      at: T0,
      origin: "event",
    });

    const result = scorePreferenceMatch(
      itemWith([dismissed, chicago]),
      prepareLedger(ledger),
      [],
      { now: T0_MS, targetKind: "event" },
    );
    expect(result.penalty).toBeLessThan(1);
    expect(result.facetBoost).toBe(0);
    expect(result.boost).toBe(0);
    expect(result.matchedFacetPositive).toEqual([]);
  });

  it("does not leak facet evidence across opportunity origins", () => {
    const chicago = opportunityFacetPreferenceConcept(
      "location",
      "Chicago",
    )!;
    const eventLedger = applyOpportunityFacetPreferenceSignal(
      undefined,
      "location",
      "Chicago",
      { at: T0, origin: "event" },
    );
    const jobResult = scorePreferenceMatch(
      itemWith([chicago]),
      prepareLedger(eventLedger),
      [],
      { now: T0_MS, targetKind: "job" },
    );

    expect(jobResult.facetBoost).toBe(0);
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

describe("facet preference explanations", () => {
  it("only treats a two-place rise or a top-10 crossing as material", () => {
    expect(materiallyChangedByFacetPreference(4, 2)).toBe(true);
    expect(materiallyChangedByFacetPreference(10, 9)).toBe(true);
    expect(materiallyChangedByFacetPreference(4, 3)).toBe(false);
    expect(materiallyChangedByFacetPreference(2, 2)).toBe(false);
    expect(materiallyChangedByFacetPreference(2, 3)).toBe(false);
  });

  it("uses the first auditable matched facet in the card reason", () => {
    expect(facetPreferenceReason([" Chicago ", "hybrid"])).toBe(
      "Because you often view Chicago",
    );
    expect(facetPreferenceReason([])).toBeUndefined();
  });
});

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

// ── Directional origin influence (papers → events → jobs) ──────

describe("origin-aware ledger", () => {
  const ml = concept("machine learning");

  it("namespaces job/event entries so they never collide with paper entries", () => {
    let ledger = applyPreferenceSignal({}, [ml], "positive", { at: T0 });
    ledger = applyPreferenceSignal(ledger, [ml], "negative", {
      at: T0,
      origin: "job",
    });
    expect(Object.keys(ledger).sort()).toEqual([
      `job|${ml.key}`,
      ml.key,
    ].sort());
    expect(ledger[ml.key].positive).toBe(1);
    expect(ledger[ml.key].negative).toBe(0);
    expect(ledger[`job|${ml.key}`].negative).toBe(1);
    expect(ledger[`job|${ml.key}`].origin).toBe("job");
  });

  it("job feedback never affects paper scoring", () => {
    const ledger = applyPreferenceSignal({}, [ml], "negative", {
      at: T0,
      origin: "job",
    });
    const score = scorePreferenceMatch(itemWith([ml]), prepareLedger(ledger), [], {
      now: T0_MS,
    });
    expect(score.penalty).toBe(1);
    expect(score.matchedNegative).toEqual([]);
  });

  it("paper feedback flows into event scoring more strongly than job scoring", () => {
    const ledger = applyPreferenceSignal({}, [ml], "positive", { at: T0 });
    const prepared = prepareLedger(ledger);
    const eventScore = scorePreferenceMatch(itemWith([ml]), prepared, [], {
      now: T0_MS,
      targetKind: "event",
    });
    const jobScore = scorePreferenceMatch(itemWith([ml]), prepared, [], {
      now: T0_MS,
      targetKind: "job",
    });
    const paperScore = scorePreferenceMatch(itemWith([ml]), prepared, [], {
      now: T0_MS,
    });
    expect(eventScore.boost).toBeGreaterThan(0);
    expect(jobScore.boost).toBeGreaterThan(0);
    expect(paperScore.boost).toBeGreaterThan(eventScore.boost);
    expect(eventScore.boost).toBeGreaterThan(jobScore.boost);
  });

  it("event feedback leaks weakly into jobs but not into events from jobs", () => {
    const fromEvent = applyPreferenceSignal({}, [ml], "positive", {
      at: T0,
      origin: "event",
    });
    const fromJob = applyPreferenceSignal({}, [ml], "positive", {
      at: T0,
      origin: "job",
    });
    const jobScore = scorePreferenceMatch(itemWith([ml]), prepareLedger(fromEvent), [], {
      now: T0_MS,
      targetKind: "job",
    });
    const eventScore = scorePreferenceMatch(itemWith([ml]), prepareLedger(fromJob), [], {
      now: T0_MS,
      targetKind: "event",
    });
    expect(jobScore.boost).toBeGreaterThan(0);
    expect(eventScore.boost).toBe(0);
  });

  it("allows negative evidence on required topics for job origin (protection is paper-only)", () => {
    const ledger = applyPreferenceSignal({}, [ml], "negative", {
      at: T0,
      origin: "job",
      requiredTopics: ["machine learning"],
    });
    expect(ledger[`job|${ml.key}`].negative).toBe(1);
    const jobScore = scorePreferenceMatch(
      itemWith([ml]),
      prepareLedger(ledger),
      ["machine learning"],
      { now: T0_MS, targetKind: "job" },
    );
    expect(jobScore.penalty).toBeLessThan(1);
  });

  it("cleanPreferenceLedger preserves origin and survives roundtrip", () => {
    const ledger = applyPreferenceSignal({}, [ml], "positive", {
      at: T0,
      origin: "event",
    });
    const cleaned = cleanPreferenceLedger(JSON.parse(JSON.stringify(ledger)));
    expect(cleaned[`event|${ml.key}`].origin).toBe("event");
  });
});
