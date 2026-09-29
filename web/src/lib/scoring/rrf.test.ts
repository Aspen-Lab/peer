import { describe, expect, it } from "vitest";
import { fuseRankings, type RRFCandidate, type RRFChannelInput } from "./rrf";

// P2-S6 (Round 3) — F-A-P2-05, ABC-JEV-INTEGRATION.md §1p.B(1) and the
// P2-S6 RULING (§4). Every fixture below identifies a paper by a unique DOI
// only (no title/year/authors), so `canonicalPaperKey` resolves a single,
// predictable `doi:10.1000/<id>` key with NO title alias — this guarantees
// `clusterCanonicalWorks`'s weak-link (title+year+author) tier can never
// accidentally bridge two fixture papers that are meant to stay distinct.

function doi(id: string): RRFCandidate {
  return { doi: `10.1000/${id}` };
}
function keyOf(id: string): string {
  return `doi:10.1000/${id}`;
}

describe("scoring/rrf — fuseRankings", () => {
  describe("stage 2: cross-channel fusion (hand-computed)", () => {
    it("3 channels, overlapping and non-overlapping candidates: exact fused order and scores", () => {
      // Channel A: p1(1), p2(2), p3(3)
      // Channel B: p2(1), p4(2)
      // Channel C: p3(1), p1(2)
      // k = 60 (default).
      // p1 = A-rank1 (1/61) + C-rank2 (1/62)
      // p2 = A-rank2 (1/62) + B-rank1 (1/61)   -- an EXACT tie with p1 (same two fractions)
      // p3 = A-rank3 (1/63) + C-rank1 (1/61)
      // p4 = B-rank2 (1/62)
      const channels: RRFChannelInput[] = [
        { channel: "A", queries: [[doi("p1"), doi("p2"), doi("p3")]] },
        { channel: "B", queries: [[doi("p2"), doi("p4")]] },
        { channel: "C", queries: [[doi("p3"), doi("p1")]] },
      ];
      const result = fuseRankings(channels);

      const p1Score = 1 / 61 + 1 / 62;
      const p2Score = 1 / 62 + 1 / 61;
      const p3Score = 1 / 63 + 1 / 61;
      const p4Score = 1 / 62;

      // p1 and p2 tie exactly; deterministic tie-break by key
      // ("doi:10.1000/p1" < "doi:10.1000/p2") puts p1 first.
      expect(result.map((r) => r.key)).toEqual(
        [keyOf("p1"), keyOf("p2"), keyOf("p3"), keyOf("p4")],
      );
      expect(result[0].fusedScore).toBeCloseTo(p1Score, 12);
      expect(result[1].fusedScore).toBeCloseTo(p2Score, 12);
      expect(result[2].fusedScore).toBeCloseTo(p3Score, 12);
      expect(result[3].fusedScore).toBeCloseTo(p4Score, 12);
      expect(result[0].fusedScore).toBe(result[1].fusedScore); // exact tie, not float luck

      // Provenance: fused score + [{channel, rank}], sorted by channel then rank.
      expect(result[0].channels).toEqual([
        { channel: "A", rank: 1 },
        { channel: "C", rank: 2 },
      ]);
      expect(result[1].channels).toEqual([
        { channel: "A", rank: 2 },
        { channel: "B", rank: 1 },
      ]);
      expect(result[3].channels).toEqual([{ channel: "B", rank: 2 }]);
    });
  });

  describe("stage 1: within-channel fold", () => {
    it("10 synonym queries on one channel do not out-vote a single-query channel", () => {
      const fillers = ["f1", "f2", "f3", "f4"].map(doi);
      const p1 = doi("p1");
      const p2 = doi("p2");
      const oneQuery = [...fillers, p1]; // p1 sits at rank 5 in every synonym query
      const openalex: RRFChannelInput = {
        channel: "openalex",
        queries: Array.from({ length: 10 }, () => oneQuery),
      };
      const arxiv: RRFChannelInput = { channel: "arxiv", queries: [[p2]] }; // p2 at rank 1

      const result = fuseRankings([openalex, arxiv]);
      const keys = result.map((r) => r.key);

      // Correct fold: p1's openalex contribution is 1/(60+5) exactly ONCE —
      // never 10x summed — so p2 (a single rank-1 vote) outranks it.
      expect(keys.indexOf(keyOf("p2"))).toBeLessThan(keys.indexOf(keyOf("p1")));
      const p1Result = result.find((r) => r.key === keyOf("p1"))!;
      expect(p1Result.fusedScore).toBeCloseTo(1 / 65, 12);
      expect(p1Result.channels).toEqual([{ channel: "openalex", rank: 5 }]);
    });

    it("the same paper appearing twice within one query still folds to its best rank", () => {
      const p1 = doi("p1");
      // p1 appears at rank 1 AND (spuriously) again at rank 3 in the same query.
      const query = [p1, doi("other"), p1];
      const channel: RRFChannelInput = { channel: "openalex", queries: [query] };
      const result = fuseRankings([channel]);
      const p1Result = result.find((r) => r.key === keyOf("p1"))!;
      expect(p1Result.channels).toEqual([{ channel: "openalex", rank: 1 }]);
    });
  });

  describe("determinism", () => {
    it("same input in shuffled channel order produces byte-identical output", () => {
      const channels: RRFChannelInput[] = [
        { channel: "A", queries: [[doi("p1"), doi("p2"), doi("p3")]] },
        { channel: "B", queries: [[doi("p2"), doi("p4")]] },
        { channel: "C", queries: [[doi("p3"), doi("p1")]] },
      ];
      const [a, b, c] = channels;

      const r1 = fuseRankings([a, b, c]);
      const r2 = fuseRankings([c, b, a]);
      const r3 = fuseRankings([b, a, c]);

      expect(r2).toEqual(r1);
      expect(r3).toEqual(r1);
    });
  });

  describe("per-channel cap", () => {
    it("neutral default (no cap): a work found by two channels outranks a single-channel work", () => {
      const openalex: RRFChannelInput = { channel: "openalex", queries: [[doi("p1"), doi("p2"), doi("p3")]] };
      const arxiv: RRFChannelInput = { channel: "arxiv", queries: [[doi("p3")]] };
      const result = fuseRankings([openalex, arxiv]);
      expect(result[0].key).toBe(keyOf("p3"));
    });

    it("cap:2 on a channel drops its 3rd-ranked candidate's vote, changing the fused outcome", () => {
      const openalexNoCap: RRFChannelInput = { channel: "openalex", queries: [[doi("p1"), doi("p2"), doi("p3")]] };
      const arxiv: RRFChannelInput = { channel: "arxiv", queries: [[doi("p3")]] };

      const withoutCap = fuseRankings([openalexNoCap, arxiv]);
      // p3 = 1/63 (openalex rank3) + 1/61 (arxiv rank1) — highest score, wins.
      expect(withoutCap[0].key).toBe(keyOf("p3"));
      expect(withoutCap[0].fusedScore).toBeCloseTo(1 / 63 + 1 / 61, 12);

      const openalexCapped: RRFChannelInput = { ...openalexNoCap, cap: 2 };
      const withCap = fuseRankings([openalexCapped, arxiv]);
      // p3's openalex vote (rank 3) is dropped by the cap — p3 now has only
      // arxiv's 1/61, exactly tying p1's sole (openalex rank1) 1/61; the
      // deterministic key tie-break ("doi:10.1000/p1" < "doi:10.1000/p3")
      // puts p1 first.
      expect(withCap[0].key).toBe(keyOf("p1"));
      const p3Capped = withCap.find((r) => r.key === keyOf("p3"))!;
      expect(p3Capped.fusedScore).toBe(withCap[0].fusedScore);
      expect(p3Capped.channels).toEqual([{ channel: "arxiv", rank: 1 }]); // openalex vote gone
    });

    it("cap <= 0 behaves as the neutral 'no cap' default", () => {
      const openalex: RRFChannelInput = { channel: "openalex", queries: [[doi("p1"), doi("p2"), doi("p3")]], cap: 0 };
      const arxiv: RRFChannelInput = { channel: "arxiv", queries: [[doi("p3")]] };
      const result = fuseRankings([openalex, arxiv]);
      expect(result[0].key).toBe(keyOf("p3"));
    });
  });

  describe("exploration slots", () => {
    it("neutral default (0 slots, unset): pure fused-score order", () => {
      const openalex: RRFChannelInput = {
        channel: "openalex",
        queries: [[doi("p1"), doi("p2"), doi("p3"), doi("p4")]],
      };
      expect(fuseRankings([openalex]).map((r) => r.key)).toEqual(
        ["p1", "p2", "p3", "p4"].map(keyOf),
      );
      expect(fuseRankings([openalex], { explorationSlots: 0 }).map((r) => r.key)).toEqual(
        ["p1", "p2", "p3", "p4"].map(keyOf),
      );
    });

    it("explorationSlots:1 promotes the channel's weakest voting candidate to the front", () => {
      const openalex: RRFChannelInput = {
        channel: "openalex",
        queries: [[doi("p1"), doi("p2"), doi("p3"), doi("p4")]],
      };
      const result = fuseRankings([openalex], { explorationSlots: 1 });
      // p4 (openalex's worst-ranked, rank 4) is reserved to the front instead
      // of naturally sorting last.
      expect(result.map((r) => r.key)).toEqual(["p4", "p1", "p2", "p3"].map(keyOf));
    });
  });

  describe("degenerate inputs", () => {
    it("a single channel degrades to that channel's own order", () => {
      const openalex: RRFChannelInput = { channel: "openalex", queries: [[doi("p1"), doi("p2"), doi("p3")]] };
      const result = fuseRankings([openalex]);
      expect(result.map((r) => r.key)).toEqual(["p1", "p2", "p3"].map(keyOf));
      expect(result.map((r) => r.fusedScore)).toEqual([1 / 61, 1 / 62, 1 / 63]);
    });

    it("an empty channel contributes nothing and never crashes", () => {
      const openalex: RRFChannelInput = { channel: "openalex", queries: [[doi("p1"), doi("p2")]] };
      const empty: RRFChannelInput = { channel: "citation", queries: [] };
      const result = fuseRankings([openalex, empty]);
      expect(result.map((r) => r.key)).toEqual(["p1", "p2"].map(keyOf));
      expect(result.every((r) => r.channels.every((c) => c.channel !== "citation"))).toBe(true);
    });

    it("a channel whose only query is an empty array contributes nothing and never crashes", () => {
      const openalex: RRFChannelInput = { channel: "openalex", queries: [[doi("p1")]] };
      const empty: RRFChannelInput = { channel: "semantic", queries: [[]] };
      const result = fuseRankings([openalex, empty]);
      expect(result.map((r) => r.key)).toEqual([keyOf("p1")]);
    });

    it("zero channels: empty result, no crash", () => {
      expect(fuseRankings([])).toEqual([]);
    });
  });

  describe("k parameter", () => {
    it("k is a tunable parameter, not hardcoded (default 60)", () => {
      const openalex: RRFChannelInput = { channel: "openalex", queries: [[doi("p1")]] };
      const withDefaultK = fuseRankings([openalex]);
      const withK10 = fuseRankings([openalex], { k: 10 });
      expect(withDefaultK[0].fusedScore).toBeCloseTo(1 / 61, 12);
      expect(withK10[0].fusedScore).toBeCloseTo(1 / 11, 12);
    });
  });

  describe("identity matching reuses the shared canonical-identity/clustering rule", () => {
    it("two channels' copies of the same paper under DIFFERENT id-form types still fuse into one work", () => {
      // Same paper: one channel only saw its arXiv id, another only its PMID —
      // no shared id-form key — but title+year+first-author weak-links them
      // (mirrors feed/dedup.ts's own weak-link tier, via the same shared
      // clusterCanonicalWorks helper).
      const arxivCopy: RRFCandidate = {
        title: "Diffusion Models For Battery Electrolyte Discovery",
        year: 2026,
        authors: ["Alice Smith"],
        externalIds: { arxivId: "2409.00001" },
      };
      const pmidCopy: RRFCandidate = {
        title: "Diffusion Models For Battery Electrolyte Discovery",
        year: 2026,
        authors: ["Alice Smith"],
        externalIds: { pmid: "12345678" },
      };
      const channelA: RRFChannelInput = { channel: "arxiv", queries: [[arxivCopy]] };
      const channelB: RRFChannelInput = { channel: "pubmed", queries: [[pmidCopy]] };

      const result = fuseRankings([channelA, channelB]);
      expect(result).toHaveLength(1); // fused into ONE work, not two
      expect(result[0].fusedScore).toBeCloseTo(1 / 61 + 1 / 61, 12);
      expect(result[0].channels.map((c) => c.channel).sort()).toEqual(["arxiv", "pubmed"]);
    });

    // DEDUP-FIX (version rule, ABC-JEV-INTEGRATION.md §4 Round 3 "manager
    // smoke check... version rule ruled", 2026-09-24T20:30:13Z, revising
    // §1p.A(1)/§1p.G(2)): this test used to assert that a differing DOI
    // alone kept a same-title/year/author pair as 2 separate fused works
    // ("a genuine conflict... never merged"). The ruling revises that: a DOI
    // mismatch alone is no longer a conflict once title+alias+author+year
    // already match, so this pair is now a VERSION match and fuses into ONE
    // work crediting both channels — the same outcome as the
    // different-id-form-TYPES case just above.
    it("a same-title/year/author pair with two different DOIs is a version match and fuses into ONE work crediting both channels", () => {
      const preprint: RRFCandidate = {
        title: "Diffusion Models For Battery Electrolyte Discovery",
        year: 2026,
        authors: ["Alice Smith"],
        doi: "10.1000/preprint-x",
      };
      const published: RRFCandidate = {
        title: "Diffusion Models For Battery Electrolyte Discovery",
        year: 2026,
        authors: ["Alice Smith"],
        doi: "10.1000/published-y",
      };
      const channelA: RRFChannelInput = { channel: "arxiv", queries: [[preprint]] };
      const channelB: RRFChannelInput = { channel: "openalex", queries: [[published]] };

      const result = fuseRankings([channelA, channelB]);
      expect(result).toHaveLength(1); // fused into ONE work, not two
      expect(result[0].fusedScore).toBeCloseTo(1 / 61 + 1 / 61, 12);
      expect(result[0].channels.map((c) => c.channel).sort()).toEqual(["arxiv", "openalex"]);
    });
  });
});
