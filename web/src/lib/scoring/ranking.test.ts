// Ranking, measured against a real day.
//
// __fixtures__/pool-2026-09-07.json is the candidate pool a reader whose
// topics are "diffusion models" and "protein structure prediction" actually
// drew on 7 September 2026, labelled by hand:
//   core  — their own subject: structure prediction, or generative models
//           applied to molecules and biology
//   craft — advances in diffusion models themselves, whatever the application
//   off   — matched a topic word and belongs to another field entirely: an
//           art installation, the C/O ratios of Uranus, an FKPP travelling
//           wave, 3D duet singing animation
//
// Twenty-four of the forty candidates are off. What the ranking does with
// them is the whole question, so the assertions are about the shape of the
// result — how far a reader gets before the first stranger — and never about
// an exact order, which would pin the fixture rather than the behaviour.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { dropStale } from "@/lib/feed/freshness";
import { poolPercentile, scoreItems } from "./combine";

interface Labelled {
  id: string;
  source: string;
  title: string;
  abstract: string;
  tags: string[];
  venue: string;
  publishedAt: string;
  label: "core" | "craft" | "off";
}

const pool: Labelled[] = JSON.parse(
  readFileSync(new URL("./__fixtures__/pool-2026-09-07.json", import.meta.url), "utf8"),
);

const items: RawItem[] = pool.map((p) => ({
  id: p.id,
  source: p.source as RawItem["source"],
  title: p.title,
  authors: [],
  abstract: p.abstract,
  tags: p.tags,
  url: "",
  publishedAt: p.publishedAt,
  venue: p.venue,
  metadata: {},
}));

const labelOf = new Map(pool.map((p) => [p.id, p.label]));
const TOPICS = ["diffusion models", "protein structure prediction"];
// The day itself, so recency scores as it did — the fixture is a snapshot.
const NOW = Date.parse("2026-09-07T09:00:00Z");

// The pipeline's own order: the ceiling decides what a daily briefing may
// contain, then the pool is ranked (feed/pipeline.ts buildPaperPool).
function rank() {
  const fresh = dropStale(items, "week", NOW);
  return scoreItems(fresh, { topics: TOPICS }, undefined, NOW).map((s) => ({
    id: s.id,
    title: s.title,
    label: labelOf.get(s.id)!,
    score: s.score,
    breakdown: s.scoreBreakdown,
  }));
}

describe("poolPercentile", () => {
  it("places each value by what it beats, and ties together", () => {
    expect(poolPercentile([])).toEqual([]);
    expect(poolPercentile([0.4])).toEqual([1]);
    expect(poolPercentile([0, 1, 0.5])).toEqual([0, 1, 0.5]);
    expect(poolPercentile([0, 0, 0, 1])).toEqual([0, 0, 0, 1]);
  });
});

describe("today's briefing", () => {
  const ranked = rank();
  const briefing = ranked.slice(0, 10);
  const onTopic = (l: string) => l === "core" || l === "craft";

  it("drops only what is too old to be news", () => {
    const stale = pool.filter(
      (p) => (NOW - Date.parse(p.publishedAt)) / 86_400_000 > 60,
    );
    expect(stale.length).toBeGreaterThan(0);
    expect(ranked.length).toBe(pool.length - stale.length);
  });

  it("opens with the reader's own subject", () => {
    expect(briefing.slice(0, 2).every((p) => p.label === "core")).toBe(true);
  });

  it("does not mistake a name-drop for a subject", () => {
    // Both of these matched "protein structure prediction" on one sentence
    // that names it as an example of something else; both used to outrank
    // papers actually about it.
    const nameDrops = ranked.filter((p) => /Earthquake Aftershock|^Reservoir:/.test(p.title));
    expect(nameDrops.length).toBe(2);
    for (const paper of nameDrops) {
      expect(ranked.indexOf(paper)).toBeGreaterThanOrEqual(8);
    }
  });

  it("gets the reader past the first half of the briefing before a stranger", () => {
    // As shipped, the sixth card was novel view synthesis and the seventh an
    // art installation; a reader met the noise before the halfway point.
    const firstOff = ranked.findIndex((p) => p.label === "off");
    expect(firstOff).toBeGreaterThanOrEqual(5);
  });

  it("keeps most of the briefing on topic", () => {
    expect(briefing.filter((p) => onTopic(p.label)).length).toBeGreaterThanOrEqual(7);
  });

  it("carries no paper the reader would call old news", () => {
    // Semantic Scholar answers a dateless query with the field's classics.
    for (const paper of briefing) {
      const age = (NOW - Date.parse(pool.find((p) => p.id === paper.id)!.publishedAt)) / 86_400_000;
      expect(age).toBeLessThan(365);
    }
  });

  it("ranks relevance above age, which is the change", () => {
    // The pool holds fresher off-topic papers than several core ones; if age
    // still led, these would invert.
    const rankOf = (id: string) => ranked.findIndex((p) => p.id === id);
    const core = pool.filter((p) => p.label === "core");
    const off = pool.filter((p) => p.label === "off");
    const medianCore = core.map((p) => rankOf(p.id)).sort((a, b) => a - b)[Math.floor(core.length / 2)];
    const medianOff = off.map((p) => rankOf(p.id)).sort((a, b) => a - b)[Math.floor(off.length / 2)];
    expect(medianCore).toBeLessThan(medianOff);
  });

  it("uses the whole range of the relevance signal", () => {
    // The defect was a signal squeezed into a tenth of the score's range.
    const t = ranked.map((p) => p.breakdown.topicality);
    expect(Math.max(...t)).toBe(1);
    expect(Math.min(...t)).toBe(0);
  });
});
