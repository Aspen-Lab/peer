import { describe, expect, it } from "vitest";
import * as ledgerModule from "./ledger";
import {
  applyPreferenceSignal,
  cleanPreferenceLedger,
  preferenceKey,
  prepareLedger,
  scorePreferenceMatch,
  setTermLean,
  summarizePreferenceLedger,
  type PreparedLedger,
} from "./ledger";
import { useProfileStore } from "@/store/profile";
import type { PreferenceConcept, PreferenceLedger, PreferenceLedgerEntry } from "@/types";
import type { RawItem } from "@/lib/sources/types";

/**
 * P9-35 · §1h.60 (the owner's decision §1a.18 (f): jobs and events are stopped).
 *
 * Older builds wrote ledger entries from a reader's dismissals of jobs and
 * events under `job|…` / `event|…` keys with an `origin` of `"job"` / `"event"`.
 * An entry with an origin counted for nothing on a paper (its influence there
 * was 0). **The same entry with its origin dropped is a paper entry**, and it
 * would lift a paper that shares its concept by 0.1049 (of a 0.18 maximum). So
 * the origin is never dropped on its own: the entry is deleted when the ledger
 * is cleaned, and every reader and every writer cleans first.
 */

const T0 = "2026-01-01T00:00:00.000Z";
const T0_MS = Date.parse(T0);

function concept(label: string): PreferenceConcept {
  return {
    key: preferenceKey(label, "openalex_topic", `t-${label}`),
    label,
    source: "openalex_topic",
  };
}

function paperWith(signals: PreferenceConcept[]): RawItem {
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

/** What an older build stored: namespaced key, origin, three likes. */
function legacyEntries(
  origin: "job" | "event",
  c: PreferenceConcept,
  withOrigin = true,
): PreferenceLedger {
  const key = `${origin}|${c.key}`;
  return {
    [key]: {
      key,
      label: c.label,
      source: origin === "job" ? "job_tag" : "event_topic",
      ...(withOrigin ? { origin } : {}),
      positive: 3,
      negative: 0,
      lastPositiveAt: T0,
      lastSeenAt: T0,
    },
  } as unknown as PreferenceLedger;
}

const ml = concept("machine learning");
const physics = concept("solid state physics");

function paperLedger(): PreferenceLedger {
  return applyPreferenceSignal({}, [physics], "positive", { at: T0 });
}

describe("legacy event and job ledger entries are deleted, never kept without their origin", () => {
  it.each(["job", "event"] as const)(
    "cleanPreferenceLedger deletes an entry recorded from a %s and keeps the paper entry beside it",
    (origin) => {
      const stored = { ...paperLedger(), ...legacyEntries(origin, ml) };
      // The device blob and the server's jsonb are JSON: nothing survives a trip.
      const cleaned = cleanPreferenceLedger(JSON.parse(JSON.stringify(stored)));

      expect(Object.keys(cleaned)).toEqual([physics.key]);
      expect(cleaned[physics.key].positive).toBe(1);
    },
  );

  it.each(["job", "event"] as const)(
    "a paper that shares the concept of a legacy %s entry gets no boost from it",
    (origin) => {
      const prepared = prepareLedger(legacyEntries(origin, ml));
      const score = scorePreferenceMatch(paperWith([ml]), prepared, [], { now: T0_MS });

      expect(prepared.size).toBe(0);
      expect(score.boost).toBe(0);
      expect(score.penalty).toBe(1);
      expect(score.matchedPositive).toEqual([]);
    },
  );

  it("is deleted rather than de-origined: the same entry as a paper entry would lift a paper by 0.1049", () => {
    // The hazard the deletion answers, built by hand past the cleaner: the
    // entry with `origin` removed and everything else as stored.
    const entry = Object.values(legacyEntries("job", ml, false))[0] as PreferenceLedgerEntry;
    const uncleaned: PreparedLedger = {
      byKey: { [entry.key]: entry },
      byLabel: new Map([[ml.label, [entry]]]),
      size: 1,
    };
    const leaked = scorePreferenceMatch(paperWith([ml]), uncleaned, [], { now: T0_MS });
    expect(leaked.boost).toBeCloseTo(0.1049, 3);

    // The real path: the cleaner deletes it, so the paper's boost stays 0.
    const real = scorePreferenceMatch(
      paperWith([ml]),
      prepareLedger(legacyEntries("job", ml, false)),
      [],
      { now: T0_MS },
    );
    expect(real.boost).toBe(0);
  });

  it("deletes an entry in the job| / event| namespace even when its origin field is missing", () => {
    const stored = { ...legacyEntries("job", ml, false), ...legacyEntries("event", ml, false) };
    expect(cleanPreferenceLedger(stored)).toEqual({});
  });

  it("deletes an entry stored under a job| record key even when its own key field is a plain key", () => {
    // Without the origin and with a plain `key`, this would be read as a paper
    // entry for the concept; the record key is the only trace of where it came from.
    const stored = {
      [`job|${ml.key}`]: {
        key: ml.key,
        label: ml.label,
        source: "openalex_topic",
        positive: 3,
        negative: 0,
        lastSeenAt: T0,
      },
    } as unknown as PreferenceLedger;

    expect(cleanPreferenceLedger(stored)).toEqual({});
    expect(scorePreferenceMatch(paperWith([ml]), prepareLedger(stored), [], { now: T0_MS }).boost).toBe(0);
  });

  it("every write starts from a clean ledger: a like and a lean carry no legacy entry forward", () => {
    const stored = { ...paperLedger(), ...legacyEntries("job", ml), ...legacyEntries("event", ml) };

    const liked = applyPreferenceSignal(stored, [concept("catalysis")], "positive", { at: T0 });
    expect(Object.keys(liked).some((key) => key.startsWith("job|") || key.startsWith("event|"))).toBe(false);
    expect(Object.keys(liked)).toHaveLength(2);

    const leaned = setTermLean(stored, "catalysis", "more", T0);
    expect(Object.keys(leaned).some((key) => key.startsWith("job|") || key.startsWith("event|"))).toBe(false);
  });

  it("the profile screen's summary lists nothing a legacy entry holds", () => {
    const stored = { ...paperLedger(), ...legacyEntries("job", ml) };
    const { liked, disliked } = summarizePreferenceLedger(stored, T0_MS);

    expect(liked.map((row) => row.label)).toEqual([physics.label]);
    expect(disliked).toEqual([]);
  });
});

describe("the ledger and the profile store know no event or job surface", () => {
  it("the ledger module exports no event, job or facet-click helper", () => {
    for (const name of [
      "originInfluence",
      "conceptsFromJob",
      "conceptsFromEvent",
      "feedbackSnapshotForJob",
      "feedbackSnapshotForEvent",
      "applyOpportunityFacetPreferenceSignal",
      "opportunityFacetPreferenceConcept",
      "opportunityFacetPreferenceConcepts",
      "materiallyChangedByFacetPreference",
      "facetPreferenceReason",
      "FACET_PREFERENCE_BOOST_MAX",
    ]) {
      expect(name in ledgerModule, name).toBe(false);
    }
  });

  it("the profile store has no action that records a job, an event or a facet click", () => {
    const state = useProfileStore.getState() as unknown as Record<string, unknown>;
    for (const name of [
      "recordEventPreference",
      "recordJobPreference",
      "recordOpportunityFacetPreference",
    ]) {
      expect(name in state, name).toBe(false);
    }
    // ...and the paper action stays.
    expect(typeof state.recordPaperPreference).toBe("function");
  });
});
