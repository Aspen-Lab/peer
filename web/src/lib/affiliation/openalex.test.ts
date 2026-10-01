import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveAuthor,
  fetchAdvisorSeeds,
  fetchCitationNeighborhood,
} from "./openalex";

// P2-S4a-FIX (Round 3) — F-A-P2S4a-01/02, ABC-JEV-INTEGRATION.md §1p.B(3).
// This file did not exist before this fix (see this slice's checkpoint
// DESIGN CHOICES for why it is being added now: `channels.test.ts` mocks
// the whole `@/lib/affiliation/openalex` module, so it cannot exercise this
// file's REAL fetch/header/retry/failure-contract wiring — only a direct
// test of this file can). No live call, ever — every test stubs
// `globalThis.fetch`.
//
// Covers, for all 3 exported functions: the key sent as `Authorization:
// Bearer`, never a URL parameter; the SAME `revalidate`/429-retry the
// keyless path already gets (previously silently dropped/never applied
// once a key was configured — NEW FINDING #1 in
// docs/jev-abc/P2-S4a-A-20260924T100013Z.md). `fetchCitationNeighborhood`
// additionally gets the P2-S2 typed-failure contract (throw on a real
// error, `[]` reserved for a genuine empty result) so its caller
// (`feed/pipeline.ts`'s `seed_citations` channel) can tell a real outage
// apart from a quiet day — `resolveAuthor`/`fetchAdvisorSeeds` keep their
// existing swallow-to-null/empty contract unchanged (out of this fix's
// scope; see checkpoint).

const worksFixture = {
  results: [
    {
      id: "https://openalex.org/W999",
      title: "A Real Cited Paper",
      publication_date: "2026-01-01",
      authorships: [],
      doi: null,
    },
  ],
};

const authorsFixture = {
  results: [
    {
      id: "https://openalex.org/A123",
      display_name: "Paul V. Braun",
      works_count: 400,
      last_known_institutions: [{ display_name: "University of Illinois" }],
      affiliations: [],
      x_concepts: [],
    },
  ],
};

describe("affiliation/openalex — key handling and fetch mechanics (P2-S4a-FIX)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("resolveAuthor / searchAuthors", () => {
    it("sends Authorization: Bearer and never puts the key in the URL when OPENALEX_API_KEY is set", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-1");
      let capturedUrl = "";
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify(authorsFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await resolveAuthor("Paul Braun", "Illinois");

      expect(capturedUrl).not.toContain("affiliation-secret-1");
      expect(new Headers(capturedHeaders).get("Authorization")).toBe(
        "Bearer affiliation-secret-1",
      );
    });

    it("sends no Authorization header when OPENALEX_API_KEY is unset (byte-identical to before this fix)", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "");
      let capturedHeaders: HeadersInit | undefined;
      let called = false;
      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        called = true;
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify(authorsFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await resolveAuthor("Paul Braun", "Illinois");

      expect(called).toBe(true);
      expect(capturedHeaders).toBeUndefined();
    });

    it("keeps the revalidate: 86400 data-cache option on the keyed path (previously silently dropped)", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-2");
      let capturedInit: (RequestInit & { next?: { revalidate?: number } }) | undefined;
      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init as RequestInit & { next?: { revalidate?: number } };
        return new Response(JSON.stringify(authorsFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await resolveAuthor("Paul Braun", "Illinois");

      expect(capturedInit?.next?.revalidate).toBe(86_400);
    });

    it("retries once on 429 on the keyed path (previously never retried once keyed)", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-3");
      let call = 0;
      globalThis.fetch = vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response("rate limited", { status: 429 });
        return new Response(JSON.stringify(authorsFixture), { status: 200 });
      }) as unknown as typeof fetch;

      const result = await resolveAuthor("Paul Braun", "Illinois");

      expect(call).toBe(2);
      expect(result?.displayName).toBe("Paul V. Braun");
    });
  });

  describe("fetchAdvisorSeeds", () => {
    it("sends Authorization: Bearer and never puts the key in the URL when OPENALEX_API_KEY is set", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-4");
      let capturedUrl = "";
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify(worksFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await fetchAdvisorSeeds("A123", "battery interfaces");

      expect(capturedUrl).not.toContain("affiliation-secret-4");
      expect(new Headers(capturedHeaders).get("Authorization")).toBe(
        "Bearer affiliation-secret-4",
      );
    });

    it("sends no Authorization header when OPENALEX_API_KEY is unset", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "");
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify(worksFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await fetchAdvisorSeeds("A123", "battery interfaces");

      expect(capturedHeaders).toBeUndefined();
    });

    it("keeps the revalidate: 86400 data-cache option on the keyed path", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-5");
      let capturedInit: (RequestInit & { next?: { revalidate?: number } }) | undefined;
      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init as RequestInit & { next?: { revalidate?: number } };
        return new Response(JSON.stringify(worksFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await fetchAdvisorSeeds("A123", "battery interfaces");

      expect(capturedInit?.next?.revalidate).toBe(86_400);
    });

    it("retries once on 429 on the keyed path", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-6");
      let call = 0;
      globalThis.fetch = vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response("rate limited", { status: 429 });
        return new Response(JSON.stringify(worksFixture), { status: 200 });
      }) as unknown as typeof fetch;

      const seeds = await fetchAdvisorSeeds("A123", "battery interfaces");

      expect(call).toBe(2);
      expect(seeds.workIds).toEqual(["W999"]);
    });
  });

  describe("fetchCitationNeighborhood", () => {
    it("sends Authorization: Bearer and never puts the key in the URL when OPENALEX_API_KEY is set", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-7");
      let capturedUrl = "";
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify(worksFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await fetchCitationNeighborhood(["W1"]);

      expect(capturedUrl).not.toContain("affiliation-secret-7");
      expect(new Headers(capturedHeaders).get("Authorization")).toBe(
        "Bearer affiliation-secret-7",
      );
    });

    it("sends no Authorization header when OPENALEX_API_KEY is unset (byte-identical to before this fix)", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "");
      let capturedHeaders: HeadersInit | undefined;
      let called = false;
      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        called = true;
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify(worksFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await fetchCitationNeighborhood(["W1"]);

      expect(called).toBe(true);
      expect(capturedHeaders).toBeUndefined();
    });

    it("keeps the revalidate: 21600 data-cache option on the keyed path (previously silently dropped)", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-8");
      let capturedInit: (RequestInit & { next?: { revalidate?: number } }) | undefined;
      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init as RequestInit & { next?: { revalidate?: number } };
        return new Response(JSON.stringify(worksFixture), { status: 200 });
      }) as unknown as typeof fetch;

      await fetchCitationNeighborhood(["W1"]);

      expect(capturedInit?.next?.revalidate).toBe(21_600);
    });

    it("retries once on 429 on the keyed path (previously never retried once keyed)", async () => {
      vi.stubEnv("OPENALEX_API_KEY", "affiliation-secret-9");
      let call = 0;
      globalThis.fetch = vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response("rate limited", { status: 429 });
        return new Response(JSON.stringify(worksFixture), { status: 200 });
      }) as unknown as typeof fetch;

      const items = await fetchCitationNeighborhood(["W1"]);

      expect(call).toBe(2);
      expect(items.map((i) => i.id)).toEqual(["openalex:W999"]);
    });

    // P2-S4a-FIX — F-A-P2S4a-02. Before this fix, every failure (non-2xx OR
    // network error) was swallowed internally to `[]`, indistinguishable
    // from a genuine "no citing papers yet" result — so the pipeline's new
    // `seed_citations` channel-status reporting could never see a real
    // outage here, no matter what pipeline.ts did with the promise.
    it("throws instead of resolving [] on a non-2xx response (new P2-S2-style failure contract)", async () => {
      globalThis.fetch = vi.fn(
        async () => new Response("upstream exploded", { status: 500 }),
      ) as unknown as typeof fetch;

      await expect(fetchCitationNeighborhood(["W1"])).rejects.toThrow();
    });

    it("throws instead of resolving [] on a network error", async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.openalex.org");
      }) as unknown as typeof fetch;

      await expect(fetchCitationNeighborhood(["W1"])).rejects.toThrow(
        /ENOTFOUND|openalex/i,
      );
    });

    it("still resolves [] when the API answers 200 with zero citing papers (unchanged, genuine-empty contract)", async () => {
      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      ) as unknown as typeof fetch;

      const items = await fetchCitationNeighborhood(["W1"]);
      expect(items).toEqual([]);
    });

    it("still resolves [] without any network call when seedWorkIds is empty (unchanged)", async () => {
      const spy = vi.fn();
      globalThis.fetch = spy as unknown as typeof fetch;

      const items = await fetchCitationNeighborhood([]);
      expect(items).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

// DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl.8 AMENDMENT,
// docs/jev-abc/DATASET-RECORDS-A-20260930T041130Z.md Finding 1): a fresh A
// found this file feeds the same scored Papers candidate pool the three
// source adapters feed (fetchCitationNeighborhood — the advisor citation
// neighbourhood at build time, and the liked-paper seed citation
// neighbourhood at read time), but its own WORK_SELECT never fetched
// OpenAlex's own `type` and it applied no filter — so a dataset reached the
// feed through this path exactly as before the round-1 fix.
describe("affiliation/openalex — DATASET-RECORDS (§1bl.8 AMENDMENT)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function datasetWorksFixture(type: string) {
    return {
      results: [
        {
          id: "https://openalex.org/W_DATASET_PROBE",
          title: "O2-LCO-DATA",
          publication_date: "2026-01-01",
          authorships: [],
          doi: "10.6084/m9.figshare.33608659",
          type,
        },
      ],
    };
  }

  it("sends `type` in fetchCitationNeighborhood's select parameter", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchCitationNeighborhood(["W1"]);

    const select = new URL(capturedUrl).searchParams.get("select") ?? "";
    expect(select.split(",")).toContain("type");
  });

  it("sends `type` in fetchAdvisorSeeds's select parameter too (same shared WORK_SELECT)", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(worksFixture), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchAdvisorSeeds("A123", "battery interfaces");

    const select = new URL(capturedUrl).searchParams.get("select") ?? "";
    expect(select.split(",")).toContain("type");
  });

  it("populates metadata.workType from the fetched `type` on a citation-neighbourhood item", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(datasetWorksFixture("dataset")), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await fetchCitationNeighborhood(["W1"]);
    expect(items).toHaveLength(1);
    expect(items[0].metadata.workType).toBe("dataset");
  });

  // Deliberately pinning the DESIGN CHOICE, not a bug: this file applies no
  // filter of its own (§1bl.8 AMENDMENT's ruling (c) — "the exclusion is
  // applied at ONE pipeline choke point," not a fourth adapter-level copy).
  // A dataset-typed item survives THIS function unfiltered; it is
  // `feed/dedup.ts`'s `dedupItems` (via `isExcludedOpenAlexRawItem`) that
  // excludes it before the candidate ever reaches scoring — see
  // `dedup.test.ts`'s own "DATASET-RECORDS §1bl.8" section for that half of
  // the proof. If this test ever needs to change to assert exclusion
  // HERE instead, that is a deliberate architecture change, not a drive-by
  // fix — update the choke-point comments in this file, utils/openalex.ts
  // and feed/dedup.ts together.
  it("does NOT filter a dataset-typed item itself — the pipeline choke point downstream is what excludes it", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(datasetWorksFixture("dataset")), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await fetchCitationNeighborhood(["W1"]);
    expect(items.map((i) => i.id)).toEqual(["openalex:W_DATASET_PROBE"]);
  });
});
