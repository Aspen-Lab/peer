import { describe, expect, it } from "vitest";
import { compareChannels, type ChannelRun } from "./channel-comparison";

// P2-S5 (Round 3) — F-A-P2-04f / acceptance 4f. Deterministic fixture-based
// unit tests only; no network call, no live S2/OpenAlex access (BLOCKED
// pending §1o.5 authorization) — see channel-comparison.ts's own header.

/**
 * Six invented papers (A-F) spread across three channels:
 *   - "s2" (role keyword): A, B, F
 *   - "openalex" (role keyword): A, C, D, F
 *   - "openalex-semantic" (role semantic): D, E
 *
 * Paper A is the required case: it appears in "s2" and "openalex" under two
 * DIFFERENT per-source ids/sources, unified only by a shared (differently
 * cased) DOI. Paper F appears in "s2" and "openalex" with NO doi/externalIds
 * on either side at all, unified only by the title+year+author fallback tier
 * — proving the harness doesn't just do DOI matching.
 */
function buildFixture(): ChannelRun[] {
  return [
    {
      channel: "s2",
      role: "keyword",
      provider: "semantic_scholar",
      status: "ok",
      latencyMs: 120,
      requestCount: 3,
      items: [
        {
          source: "semantic_scholar",
          id: "semantic_scholar:S2aaa",
          doi: "10.1000/AAA-1",
          title: "Paper A Title About Batteries And Electrodes",
          year: 2020,
          authors: ["Alice Smith"],
          rank: 1,
        },
        {
          source: "semantic_scholar",
          id: "semantic_scholar:S2bbb",
          doi: "10.1000/bbb-2",
          title: "Paper B Title About Polymers And Coatings",
          year: 2021,
          authors: ["Bob Lee"],
          rank: 2,
        },
        {
          // Deliberately no source/id/doi/externalIds — this item has NO
          // id-form key at all, so it can only unify with its openalex
          // counterpart below via the title+year+author fallback tier, not
          // via any shared native id.
          title: "Paper F Broad Title About Materials Discovery",
          year: 2018,
          authors: ["Farah Ito"],
          rank: 3,
        },
      ],
    },
    {
      channel: "openalex",
      role: "keyword",
      provider: "openalex",
      status: "ok",
      latencyMs: 200,
      requestCount: 5,
      items: [
        {
          source: "openalex",
          id: "openalex:Waaa1",
          doi: "10.1000/aaa-1",
          title: "Paper A Title About Batteries And Electrodes",
          year: 2020,
          authors: ["Alice Smith"],
          rank: 2,
        },
        {
          source: "openalex",
          id: "openalex:Wccc1",
          doi: "10.1000/ccc-3",
          title: "Paper C Title About Ceramics Synthesis Routes",
          year: 2019,
          authors: ["Carol Young"],
          rank: 1,
        },
        {
          source: "openalex",
          id: "openalex:Wddd1",
          doi: "10.1000/ddd-4",
          title: "Paper D Title About Catalysis Reaction Pathways",
          year: 2022,
          authors: ["Dave King"],
          rank: 3,
        },
        {
          // Same deliberate omission as the "s2" copy above.
          title: "Paper F Broad Title About Materials Discovery",
          year: 2018,
          authors: ["Farah Ito"],
          rank: 4,
        },
      ],
    },
    {
      channel: "openalex-semantic",
      role: "semantic",
      provider: "openalex",
      status: "ok",
      latencyMs: 300,
      requestCount: 2,
      items: [
        {
          source: "openalex",
          id: "openalex:Wddd1",
          doi: "10.1000/ddd-4",
          title: "Paper D Title About Catalysis Reaction Pathways",
          year: 2022,
          authors: ["Dave King"],
          rank: 1,
        },
        {
          source: "openalex",
          id: "openalex:Weee1",
          doi: "10.1000/eee-5",
          title: "Paper E Title About Photovoltaic Device Stability",
          year: 2023,
          authors: ["Erin Park"],
          rank: 2,
        },
      ],
    },
  ];
}

/**
 * F-M-P2S5-01 (Round 3) — the bridge-conflict reproduction from
 * ABC-JEV-INTEGRATION.md §1p.G: paper A (channel "s2", DOI 10.1111/aaa) and
 * paper C (channel "openalex", DOI 10.2222/ccc — a DIFFERENT, genuinely
 * conflicting DOI) share the exact same title/year/first-author. A third
 * channel ("dblp-keyword") returns an ID-less record B carrying that same
 * title/year/first-author, matching BOTH A and C on the weak (title+year+
 * author) tier alone. A private per-item union-find would transitively merge
 * A and C into one work via two separate pairwise unions through B, even
 * though comparing A and C directly correctly refuses to merge (they carry
 * conflicting real id-form keys). The corrected shared `clusterCanonicalWorks`
 * must keep all three as SEPARATE works instead: A and C's pass-1 clusters
 * conflict (both carry an id-form key of type "doi", different values), so
 * the whole weak-linked component (A, B, C) is blocked from merging at all.
 */
function buildBridgeConflictFixture(): ChannelRun[] {
  return [
    {
      channel: "s2",
      role: "keyword",
      status: "ok",
      items: [
        {
          source: "semantic_scholar",
          id: "semantic_scholar:S2bridge1",
          doi: "10.1111/aaa",
          title: "Bridge Conflict Title About Sodium Battery Cathodes",
          year: 2021,
          authors: ["Alice Smith"],
          rank: 1,
        },
      ],
    },
    {
      channel: "openalex",
      role: "keyword",
      status: "ok",
      items: [
        {
          source: "openalex",
          id: "openalex:Wbridge1",
          doi: "10.2222/ccc",
          title: "Bridge Conflict Title About Sodium Battery Cathodes",
          year: 2021,
          authors: ["Alice Smith"],
          rank: 1,
        },
      ],
    },
    {
      channel: "dblp-keyword",
      role: "keyword",
      status: "ok",
      items: [
        {
          // Deliberately no source/id/doi/externalIds — an ID-less bridge
          // record that matches BOTH the s2 and openalex items above by
          // title+year+first-author alone, and nothing else.
          title: "Bridge Conflict Title About Sodium Battery Cathodes",
          year: 2021,
          authors: ["Alice Smith"],
          rank: 1,
        },
      ],
    },
  ];
}

/**
 * F-M-P2S5-01 — a preprint (channel "arxiv-search") and its later, retitled
 * published version (channel "openalex") sharing only an arXiv id — no DOI
 * in common, different titles, and years one apart. This must unify via the
 * strong id-form-key link alone (§1p.G(1): "versions sharing e.g. an arXiv
 * id may merge even with different DOIs"), never via the title+year+author
 * weak-link tier, which wouldn't even fire here since the two titles differ.
 */
function buildPreprintPublishedFixture(): ChannelRun[] {
  return [
    {
      channel: "arxiv-search",
      role: "keyword",
      status: "ok",
      items: [
        {
          source: "arxiv",
          id: "arxiv:2101.01234",
          title: "Preprint Then Published Title About Lithium Diffusion",
          year: 2021,
          authors: ["Priya Rao"],
          rank: 1,
        },
      ],
    },
    {
      channel: "openalex",
      role: "keyword",
      status: "ok",
      items: [
        {
          source: "openalex",
          id: "openalex:Wpub1",
          doi: "10.3333/published-version",
          title: "Preprint Then Published Title About Lithium Diffusion (Journal Version)",
          year: 2022,
          authors: ["Priya Rao"],
          externalIds: { arxivId: "2101.01234" },
          rank: 1,
        },
      ],
    },
  ];
}

function find<T extends { channel: string }>(entries: T[], channel: string): T {
  const found = entries.find((e) => e.channel === channel);
  if (!found) throw new Error(`no entry for channel ${channel}`);
  return found;
}

describe("compareChannels", () => {
  it("reports explicit no_data for zero channel inputs, not a zeroed-out comparison", () => {
    const result = compareChannels([]);
    expect(result.availability).toBe("no_data");
    if (result.availability === "no_data") {
      expect(result.reason.toLowerCase()).toContain("no data");
    }
  });

  it("reports explicit no_data when every channel failed or was never run", () => {
    const result = compareChannels([
      { channel: "s2", status: "failed", items: [] },
      { channel: "openalex", status: "not_run", items: [] },
    ]);
    expect(result.availability).toBe("no_data");
  });

  it("computes exact per-channel, pairwise, exclusive and union counts, matching a paper across channels by DOI under different per-source ids and another by title+year+author with no id at all", () => {
    const result = compareChannels(buildFixture());
    expect(result.availability).toBe("ok");
    if (result.availability !== "ok") return;

    // 6 distinct works total: A, B, C, D, E, F.
    expect(result.works).toHaveLength(6);

    // Paper A: found by s2 AND openalex, under different ids/sources, unified by DOI.
    const workA = result.works.find((w) => w.channels.includes("s2") && w.channels.includes("openalex") && w.channels.length === 2 && w.contributions.some((c) => c.channel === "s2" && c.rank === 1));
    expect(workA).toBeDefined();
    expect(workA?.key).toBe("doi:10.1000/aaa-1");

    // Paper F: found by s2 AND openalex, no doi/externalIds anywhere — must still unify via title+year+author.
    const workF = result.works.find((w) => w.key.startsWith("title:paper f broad title"));
    expect(workF).toBeDefined();
    expect(workF?.channels.sort()).toEqual(["openalex", "s2"]);

    expect(result.perChannel).toHaveLength(3);
    expect(find(result.perChannel, "s2").uniqueWorkCount).toBe(3); // A, B, F
    expect(find(result.perChannel, "openalex").uniqueWorkCount).toBe(4); // A, C, D, F
    expect(find(result.perChannel, "openalex-semantic").uniqueWorkCount).toBe(2); // D, E

    expect(result.skippedChannels).toEqual([]);

    expect(result.pairwiseOverlap).toHaveLength(3);
    const s2VsOpenalex = result.pairwiseOverlap.find((p) => p.channelA === "openalex" && p.channelB === "s2");
    expect(s2VsOpenalex).toEqual({ channelA: "openalex", channelB: "s2", overlapCount: 2, aOnlyCount: 2, bOnlyCount: 1, unionCount: 5 });
    const s2VsSemantic = result.pairwiseOverlap.find((p) => p.channelA === "openalex-semantic" && p.channelB === "s2");
    expect(s2VsSemantic).toEqual({ channelA: "openalex-semantic", channelB: "s2", overlapCount: 0, aOnlyCount: 2, bOnlyCount: 3, unionCount: 5 });
    const openalexVsSemantic = result.pairwiseOverlap.find((p) => p.channelA === "openalex" && p.channelB === "openalex-semantic");
    expect(openalexVsSemantic).toEqual({ channelA: "openalex", channelB: "openalex-semantic", overlapCount: 1, aOnlyCount: 3, bOnlyCount: 1, unionCount: 5 });

    expect(find(result.exclusive, "s2").exclusiveCount).toBe(1); // B
    expect(find(result.exclusive, "openalex").exclusiveCount).toBe(1); // C
    expect(find(result.exclusive, "openalex-semantic").exclusiveCount).toBe(1); // E

    expect(result.union.totalUniqueWorkCount).toBe(6);
    expect(result.union.gainOverChannel).toEqual({ s2: 3, openalex: 2, "openalex-semantic": 4 });

    expect(result.relevance).toBe("unlabeled");
  });

  it("distinguishes a real zero (ok, empty) from a failed channel and a not-run channel, and never lets a failed channel's items leak into counts", () => {
    const runs: ChannelRun[] = [
      {
        channel: "ok-with-data",
        status: "ok",
        latencyMs: 50,
        requestCount: 1,
        items: [{ source: "openalex", id: "openalex:Wxxx1", doi: "10.1000/xxx-9", title: "Paper X Title About Solid Electrolytes", year: 2020, authors: ["X Y"], rank: 1 }],
      },
      { channel: "ok-empty", status: "ok", latencyMs: 80, requestCount: 4, items: [] },
      {
        channel: "failed-channel",
        status: "failed",
        items: [{ source: "openalex", id: "openalex:Wzzz1", doi: "10.1000/zzz-1", title: "Should never be counted", year: 2020, rank: 1 }],
      },
      { channel: "not-run-channel", status: "not_run", items: [] },
    ];
    const result = compareChannels(runs);
    expect(result.availability).toBe("ok");
    if (result.availability !== "ok") return;

    expect(find(result.perChannel, "ok-with-data")).toMatchObject({ uniqueWorkCount: 1, status: "ok", latencyMs: 50, requestCount: 1 });
    expect(find(result.perChannel, "ok-empty")).toMatchObject({ uniqueWorkCount: 0, status: "ok", latencyMs: 80, requestCount: 4 });
    expect(find(result.perChannel, "failed-channel")).toMatchObject({ uniqueWorkCount: "channel not run", status: "failed", latencyMs: "no data", requestCount: "no data" });
    expect(find(result.perChannel, "not-run-channel")).toMatchObject({ uniqueWorkCount: "channel not run", status: "not_run" });

    expect(result.skippedChannels).toEqual([
      { channel: "failed-channel", status: "failed" },
      { channel: "not-run-channel", status: "not_run" },
    ]);

    // The failed channel's item must never appear in `works`, even though it was present in the input.
    expect(result.works).toHaveLength(1);
    expect(result.works[0].channels).toEqual(["ok-with-data"]);
  });

  it("builds a role breakdown only when roles are given, generalizing the seed-vs-keyword example to any two role names", () => {
    const seedVsKeyword: ChannelRun[] = [
      {
        channel: "s2-seed-recs",
        role: "seed",
        status: "ok",
        items: [{ source: "openalex", id: "openalex:Wggg1", doi: "10.1000/ggg-7", title: "Paper G Title About Sodium Ion Cathodes", year: 2021, rank: 1 }],
      },
      {
        channel: "openalex-keyword",
        role: "keyword",
        status: "ok",
        items: [
          { source: "openalex", id: "openalex:Wggg1", doi: "10.1000/ggg-7", title: "Paper G Title About Sodium Ion Cathodes", year: 2021, rank: 2 },
          { source: "openalex", id: "openalex:Whhh1", doi: "10.1000/hhh-8", title: "Paper H Title About Anode Degradation Modes", year: 2021, rank: 1 },
        ],
      },
    ];
    const result = compareChannels(seedVsKeyword);
    expect(result.availability).toBe("ok");
    if (result.availability !== "ok") return;

    expect(result.roleBreakdown).toBeDefined();
    const rb = result.roleBreakdown!;
    expect(rb.roles).toEqual([
      { role: "keyword", channels: ["openalex-keyword"], uniqueWorkCount: 2 },
      { role: "seed", channels: ["s2-seed-recs"], uniqueWorkCount: 1 },
    ]);
    expect(rb.pairwiseOverlap).toEqual([
      { channelA: "keyword", channelB: "seed", overlapCount: 1, aOnlyCount: 1, bOnlyCount: 0, unionCount: 2 },
    ]);
    expect(rb.exclusive).toEqual([
      { channel: "keyword", exclusiveCount: 1 },
      { channel: "seed", exclusiveCount: 0 },
    ]);

    // No role given anywhere -> roleBreakdown must be absent, not an empty/zeroed object.
    const noRoles = compareChannels([{ channel: "x", status: "ok", items: [{ id: "a:1", title: "irrelevant title text here totally", rank: 1 }] }]);
    expect(noRoles.availability).toBe("ok");
    if (noRoles.availability === "ok") expect(noRoles.roleBreakdown).toBeUndefined();
  });

  it("computes relevant-only counts when independent labels are supplied, and reports the literal string 'unlabeled' when they are absent", () => {
    const withoutLabels = compareChannels(buildFixture());
    expect(withoutLabels.availability).toBe("ok");
    if (withoutLabels.availability === "ok") expect(withoutLabels.relevance).toBe("unlabeled");

    // A and C are independently labelled relevant; B is labelled explicitly NOT relevant;
    // D, E, F are left unlabeled entirely (never treated as "not relevant").
    const result = compareChannels(buildFixture(), {
      relevanceLabels: {
        "doi:10.1000/aaa-1": true,
        "doi:10.1000/ccc-3": true,
        "doi:10.1000/bbb-2": false,
      },
    });
    expect(result.availability).toBe("ok");
    if (result.availability !== "ok") return;
    expect(result.relevance).not.toBe("unlabeled");
    const relevance = result.relevance;
    if (relevance === "unlabeled") return;

    expect(relevance.labeledWorkCount).toBe(3); // A, B, C
    expect(relevance.unlabeledWorkCount).toBe(3); // D, E, F

    expect(find(relevance.perChannel, "s2").uniqueWorkCount).toBe(1); // A only (B labelled false)
    expect(find(relevance.perChannel, "openalex").uniqueWorkCount).toBe(2); // A, C
    expect(find(relevance.perChannel, "openalex-semantic").uniqueWorkCount).toBe(0); // D unlabeled

    expect(find(relevance.exclusive, "s2").exclusiveCount).toBe(0); // A shared with openalex
    expect(find(relevance.exclusive, "openalex").exclusiveCount).toBe(1); // C
    expect(find(relevance.exclusive, "openalex-semantic").exclusiveCount).toBe(0);

    expect(relevance.union.totalUniqueWorkCount).toBe(2); // A, C
    expect(relevance.union.gainOverChannel).toEqual({ s2: 1, openalex: 0, "openalex-semantic": 2 });
  });

  it("produces byte-identical output regardless of channel or item input order (deterministic ordering)", () => {
    const original = buildFixture();
    const reordered: ChannelRun[] = [...original].reverse().map((run) => ({
      ...run,
      items: [...run.items].reverse(),
    }));

    const a = compareChannels(original);
    const b = compareChannels(reordered);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("F-M-P2S5-01: keeps two conflicting-DOI papers as DIFFERENT works even when a third, ID-less channel record title-matches both (no transitive bridge merge through a shared union-find)", () => {
    const result = compareChannels(buildBridgeConflictFixture());
    expect(result.availability).toBe("ok");
    if (result.availability !== "ok") return;

    // Three separate works: the s2 copy (DOI aaa), the openalex copy (DOI
    // ccc), and the ID-less dblp-keyword bridge record. None may merge with
    // either of the other two: A and C's pass-1 clusters conflict (both
    // carry a real "doi" id-form key, with different values), so per
    // §1p.G(3) the WHOLE weak-linked component (A, B, C all share the same
    // title+year+author) is blocked from merging — never just two of the
    // three pairwise-outvoting the conflict.
    expect(result.works).toHaveLength(3);

    const workWithS2 = result.works.find((w) => w.channels.includes("s2"));
    const workWithOpenalex = result.works.find((w) => w.channels.includes("openalex"));
    const workWithBridge = result.works.find((w) => w.channels.includes("dblp-keyword"));
    expect(workWithS2).toBeDefined();
    expect(workWithOpenalex).toBeDefined();
    expect(workWithBridge).toBeDefined();

    // The required assertion: A (s2 / DOI aaa) and C (openalex / DOI ccc)
    // are never the same work.
    expect(workWithS2).not.toBe(workWithOpenalex);
    expect(workWithS2?.channels).toEqual(["s2"]);
    expect(workWithOpenalex?.channels).toEqual(["openalex"]);
    expect(workWithBridge?.channels).toEqual(["dblp-keyword"]);

    expect(find(result.perChannel, "s2").uniqueWorkCount).toBe(1);
    expect(find(result.perChannel, "openalex").uniqueWorkCount).toBe(1);
    expect(find(result.perChannel, "dblp-keyword").uniqueWorkCount).toBe(1);
    expect(result.union.totalUniqueWorkCount).toBe(3);
  });

  it("F-M-P2S5-01: the bridge-conflict fixture produces byte-identical output regardless of channel/item order", () => {
    const original = buildBridgeConflictFixture();
    const reordered: ChannelRun[] = [...original].reverse().map((run) => ({
      ...run,
      items: [...run.items].reverse(),
    }));

    const a = compareChannels(original);
    const b = compareChannels(reordered);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    expect(a.availability).toBe("ok");
    if (a.availability !== "ok") return;
    expect(a.works).toHaveLength(3);
  });

  it("F-M-P2S5-01: unifies a preprint and its later, retitled published version across two channels via a shared arXiv id alone (strong link), even though titles differ and years are one apart", () => {
    const result = compareChannels(buildPreprintPublishedFixture());
    expect(result.availability).toBe("ok");
    if (result.availability !== "ok") return;

    expect(result.works).toHaveLength(1);
    expect(result.works[0].channels).toEqual(["arxiv-search", "openalex"]);
    expect(find(result.perChannel, "arxiv-search").uniqueWorkCount).toBe(1);
    expect(find(result.perChannel, "openalex").uniqueWorkCount).toBe(1);
    expect(result.union.totalUniqueWorkCount).toBe(1);
  });
});
