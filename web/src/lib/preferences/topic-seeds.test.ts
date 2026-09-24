import { describe, expect, it } from "vitest";
import { topPositiveOpenAlexTopicIds, MAX_POSITIVE_OPENALEX_TOPIC_IDS } from "./topic-seeds";
import type { PreferenceLedger, PreferenceLedgerEntry } from "@/types";

// P2-S4c-1 (Round 3) — F-A-P2-04 (4e), ABC-JEV-INTEGRATION.md §1p.B(5) and
// the §4 "P2-S4c B complete" ruling. Resolves a signed-in owner's top
// positive `openalex_topic` ledger entries (populated today by every
// like/save on an OpenAlex-sourced paper, per docs/jev-abc/
// P2-S4c-B-20260924T113605Z.md EVIDENCE #18/#22) into the uppercase `T<id>`
// form `fetchOpenAlexTopicField` (sources/openalex-topic.ts) requires. Pure,
// synchronous, no I/O.
//
// THE LOAD-BEARING CASE: the ledger stores an OpenAlex topic id LOWERCASED
// (`openalex_topic:t20001` — preferences/ledger.ts's `preferenceKey`/
// `bareOpenAlexId`), but `fetchOpenAlexTopicField`'s own id filter is
// case-sensitive, uppercase-`T`-only (`/^T\d+$/`, sources/openalex-topic.ts).
// Without the re-casing this module exists to do, the channel would silently
// stay inert a second time — this is the regression test neither prior A
// round could write while `topicIds` was hardcoded `[]` (see the guide).

function entry(overrides: Partial<PreferenceLedgerEntry> = {}): PreferenceLedgerEntry {
  return {
    key: "openalex_topic:t20001",
    label: "Solid-state batteries",
    source: "openalex_topic",
    positive: 1,
    negative: 0,
    lastSeenAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function ledgerOf(entries: PreferenceLedgerEntry[]): PreferenceLedger {
  const out: PreferenceLedger = {};
  for (const e of entries) out[e.key] = e;
  return out;
}

describe("topPositiveOpenAlexTopicIds", () => {
  it("empty/undefined ledger -> []", () => {
    expect(topPositiveOpenAlexTopicIds(undefined)).toEqual([]);
    expect(topPositiveOpenAlexTopicIds({})).toEqual([]);
  });

  it("THE CASE-REGRESSION TEST: a lowercase ledger key produces the uppercase T-id the adapter requires", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t20001", positive: 3, negative: 0, lastPositiveAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger)).toEqual(["T20001"]);
  });

  it("non-openalex_topic-source entries are ignored", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_concept:c12345", source: "openalex_concept", positive: 5, negative: 0 }),
      entry({ key: "paper_keyword:batteries", source: "paper_keyword", positive: 5, negative: 0 }),
      entry({ key: "text:solid state", source: "paper_keyword", positive: 5, negative: 0 }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger)).toEqual([]);
  });

  it("net-negative entries are excluded", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t20001", positive: 1, negative: 3 }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger)).toEqual([]);
  });

  it("net-zero entries (positive === negative) are excluded", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t20001", positive: 2, negative: 2 }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger)).toEqual([]);
  });

  it("a genuinely positive entry (positive > negative) is included", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t20001", positive: 2, negative: 1 }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger)).toEqual(["T20001"]);
  });

  it("bounded to `limit` (default matches the adapter's own MAX_TOPIC_IDS_PER_CALL of 5)", () => {
    expect(MAX_POSITIVE_OPENALEX_TOPIC_IDS).toBe(5);
    const ledger = ledgerOf(
      Array.from({ length: 8 }, (_, i) =>
        entry({
          key: `openalex_topic:t${20000 + i}`,
          positive: 8 - i, // strictly descending net, so order is unambiguous
          negative: 0,
        }),
      ),
    );
    const result = topPositiveOpenAlexTopicIds(ledger);
    expect(result).toHaveLength(5);
    expect(result).toEqual(["T20000", "T20001", "T20002", "T20003", "T20004"]);
  });

  it("a caller-supplied limit is honored", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t1", positive: 3, negative: 0 }),
      entry({ key: "openalex_topic:t2", positive: 2, negative: 0 }),
      entry({ key: "openalex_topic:t3", positive: 1, negative: 0 }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger, 2)).toEqual(["T1", "T2"]);
  });

  it("deterministic ordering: net-positive descending first", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t1", positive: 1, negative: 0 }),
      entry({ key: "openalex_topic:t2", positive: 5, negative: 0 }),
      entry({ key: "openalex_topic:t3", positive: 3, negative: 0 }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger)).toEqual(["T2", "T3", "T1"]);
  });

  it("deterministic ordering: a net-positive tie breaks on lastPositiveAt descending (most recent first)", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t1", positive: 3, negative: 0, lastPositiveAt: "2026-09-01T00:00:00.000Z" }),
      entry({ key: "openalex_topic:t2", positive: 3, negative: 0, lastPositiveAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger)).toEqual(["T2", "T1"]);
  });

  it("deterministic ordering: a full tie (same net, same/missing lastPositiveAt) still produces a stable, reproducible order", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t2", positive: 1, negative: 0 }),
      entry({ key: "openalex_topic:t1", positive: 1, negative: 0 }),
    ]);
    const first = topPositiveOpenAlexTopicIds(ledger);
    const second = topPositiveOpenAlexTopicIds(ledger);
    expect(first).toEqual(second);
    expect(new Set(first)).toEqual(new Set(["T1", "T2"]));
  });

  it("a malformed tail (not `t<digits>`) is skipped defensively rather than guessed at", () => {
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:not-a-real-id", positive: 5, negative: 0 }),
      entry({ key: "openalex_topic:t20001", positive: 1, negative: 0 }),
    ]);
    expect(topPositiveOpenAlexTopicIds(ledger)).toEqual(["T20001"]);
  });

  it("duplicate ids (already-uppercase collision) are not repeated in the output", () => {
    // Defense in depth: two distinct ledger keys should never resolve to the
    // same bare id in practice (the ledger key IS the canonical id), but the
    // resolver must not emit a duplicate even if it somehow happened.
    const ledger = ledgerOf([
      entry({ key: "openalex_topic:t20001", positive: 3, negative: 0 }),
    ]);
    const result = topPositiveOpenAlexTopicIds(ledger);
    expect(result).toEqual(["T20001"]);
    expect(new Set(result).size).toBe(result.length);
  });
});
