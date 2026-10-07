import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  armEveryOperatorSearchCredential,
  OPERATOR_SENTINEL,
  USER_SENTINEL,
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveProvider: vi.fn(),
  realResolveProvider: vi.fn(),
  // The figure route's extractor is the one thing that route does after its gate,
  // and it fetches: stubbed, so the hourly-limit cases below make no network call.
  extractFigure: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));
vi.mock("@/lib/figures/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/figures/extract")>()),
  extractFigure: mocks.extractFigure,
}));

// The registry's `resolveProvider` is a spy that defaults to "no model", so the
// subject is the GUARD, not what a provider would have returned. The real
// function is kept alongside it for the one case that drives the real ladder
// with a company key sitting in the environment.
vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  mocks.realResolveProvider.mockImplementation(actual.resolveProvider);
  return { ...actual, resolveProvider: mocks.resolveProvider };
});

import { POST as digestPost } from "./digest/route";
import { GET as figureGet } from "./figure/route";
import { POST as papersReportPost } from "./papers/report/route";
import { getCounterStore, rateKey, resetCounterStoreForTests } from "@/lib/usage/counters";

/**
 * ABC-freemium 2-06 · R-SEC-2, R-SEC-3, R-TEST-1 · Ruling 2 point 7.
 *
 * **The persona pass for the AI routes, in one runnable place.** Peer holds no
 * model key, so there are three readers, not five:
 *
 *  - **signed out** — 401. The reports are for signed-in readers, and before
 *    1-06 these routes answered a stranger 200 and never authenticated.
 *  - **signed in, no key of their own** — the reading without a model. No
 *    provider is resolved from anything but the request, and nothing leaves the
 *    process.
 *  - **signed in, with their own key** — the key from the request is the only
 *    thing handed to `resolveProvider`.
 *
 * Every case runs with company credentials in the environment
 * (`OPERATOR_SENTINEL` for the search keys and the old default model key), so
 * "zero requests carrying a company credential" is a statement about the code,
 * not about an empty environment. A test that asserted zero with nothing
 * configured would pass whether or not the guard existed.
 */

type Handler = (request: NextRequest) => Promise<Response>;

interface RouteCase {
  name: string;
  handler: Handler;
  path: string;
  body: Record<string, unknown>;
}

const ROUTES: RouteCase[] = [
  {
    name: "POST /api/digest",
    handler: digestPost as Handler,
    path: "/api/digest",
    body: { papers: [{ id: "p:1", title: "A paper", abstract: "text" }] },
  },
  {
    name: "POST /api/papers/report",
    handler: papersReportPost as Handler,
    path: "/api/papers/report",
    body: {
      paper: {
        id: "p:1",
        title: "A paper",
        // Required by the shallow report builder, which a keyless reader reaches.
        summaryExperimentKeywords: [],
        authors: [],
      },
    },
  },
];

function request(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the AI routes, driven through the real handlers", () => {
  let fetchSpy: { mock: { calls: unknown[][] } };

  /** Outgoing requests whose URL, headers or body carry the sentinel. */
  function requestsCarrying(sentinel: string): string[] {
    return fetchSpy.mock.calls
      .map((call) => JSON.stringify(call))
      .filter((serialised) => serialised.includes(sentinel));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetCounterStoreForTests();
    deleteSpendableKeys();
    deployedRuntimeEnv(vi.stubEnv);
    // The company's keys ARE set (see the file comment).
    vi.stubEnv("GOOGLE_API_KEY", OPERATOR_SENTINEL);
    armEveryOperatorSearchCredential(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedOut());
    mocks.resolveProvider.mockReturnValue(null);
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetCounterStoreForTests();
    vi.restoreAllMocks();
  });

  for (const route of ROUTES) {
    describe(route.name, () => {
      it("answers a signed-out visitor 401, before any provider is resolved", async () => {
        const response = await route.handler(request(route.path, route.body));

        expect(response.status).toBe(401);
        // R-SEC-2's ordering property: the guard runs BEFORE `resolveProvider`.
        // A route that resolved first would have obtained a provider and only
        // then discovered it should not have.
        expect(mocks.resolveProvider).not.toHaveBeenCalled();
      });

      it("sends nothing carrying a company credential for a signed-out visitor", async () => {
        await route.handler(request(route.path, route.body));

        expect(requestsCarrying(OPERATOR_SENTINEL)).toEqual([]);
      });

      it("gives a signed-in reader with no key the reading without a model, and resolves from the request alone", async () => {
        mocks.getUser.mockResolvedValue(signedIn("user-1"));

        const response = await route.handler(request(route.path, route.body));

        expect(response.status).toBe(200);
        // No override in the request means none is handed over: the registry
        // is asked about the request and nothing else.
        expect(mocks.resolveProvider).toHaveBeenCalled();
        for (const call of mocks.resolveProvider.mock.calls) {
          expect(call).toEqual([null]);
        }
        expect(requestsCarrying(OPERATOR_SENTINEL)).toEqual([]);
      });

      it("ignores a company GOOGLE_API_KEY in the environment: through the REAL registry, a keyless reader gets no model and nothing leaves the process", async () => {
        // The case the whole change exists for. With the old system default, a
        // `GOOGLE_API_KEY` in the environment made `resolveProvider(null)` return
        // a live Gemini provider for every signed-in reader, and the model call
        // went out on the company's account.
        mocks.getUser.mockResolvedValue(signedIn("user-1"));
        mocks.resolveProvider.mockImplementation(mocks.realResolveProvider);

        const response = await route.handler(request(route.path, route.body));

        expect(response.status).toBe(200);
        expect(fetchSpy.mock.calls).toEqual([]);
        expect(requestsCarrying(OPERATOR_SENTINEL)).toEqual([]);
      });

      it("hands a signed-in reader's own key, and only that, to the registry", async () => {
        mocks.getUser.mockResolvedValue(signedIn("user-1"));
        const llmOverride = { provider: "openai", apiKey: USER_SENTINEL };

        await route.handler(request(route.path, { ...route.body, llmOverride }));

        expect(mocks.resolveProvider).toHaveBeenCalled();
        for (const call of mocks.resolveProvider.mock.calls) {
          expect(call).toEqual([llmOverride]);
        }
      });
    });
  }
});

/**
 * P4-00c · B1 (A's P4-00b) · ruling §1h.10 — **the hourly limit is the one bound
 * on a reader's loop, so the number and the scope are pinned for every route that
 * carries one.**
 *
 * After P4-00 nothing else bounds a signed-in reader's requests to Peer's server
 * (the full-text fetch, the PDF parse, the figure fetch): no allowance, no day
 * cap. Each route's `requireAiRequest(scope, limit)` is that bound. The explain
 * and paragraph-guide gates are held in their own gate suites; these two were
 * held by nothing, so a limit of 200 or a scope swapped between the two left the
 * whole suite green (A's mutations M9 and M10).
 *
 * Each case drives the real handler as a signed-in reader with a pinned clock
 * (the key carries the UTC hour), and reads the counter store the way the gate
 * writes it: `rate:<scope>:<user>:<hour>`, and no other key.
 */
describe("the hourly limit of the report and figure routes", () => {
  const NOW = new Date("2026-10-07T09:20:00.000Z");
  // The rest of the UTC hour, in seconds: what the 429's `Retry-After` carries.
  const RETRY_AFTER = "2400";

  interface LimitCase {
    name: string;
    scope: string;
    limit: number;
    call: () => Promise<Response>;
  }

  const CASES: LimitCase[] = [
    {
      name: "POST /api/papers/report",
      scope: "paper-report",
      limit: 20,
      call: () =>
        papersReportPost(
          request("/api/papers/report", {
            paper: { id: "p:1", title: "A paper", summaryExperimentKeywords: [], authors: [] },
          }),
        ),
    },
    {
      name: "GET /api/figure",
      scope: "figure",
      limit: 60,
      call: () =>
        figureGet(new NextRequest("http://localhost/api/figure?id=paper-1&url=https%3A%2F%2Fexample.org%2Fp")),
    },
  ];

  let increment: { mock: { calls: unknown[][] } };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    deleteSpendableKeys();
    deployedRuntimeEnv(vi.stubEnv);
    // The store is chosen from the environment, so reset it after the stubs and
    // spy on the instance the gate will get.
    resetCounterStoreForTests();
    increment = vi.spyOn(getCounterStore(), "increment");
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    mocks.resolveProvider.mockReturnValue(null);
    mocks.extractFigure.mockResolvedValue({ imageUrl: null, status: "no_figures" });
    // No test here may reach the network.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetCounterStoreForTests();
    vi.restoreAllMocks();
  });

  /** The keys the gate has incremented so far, in order. */
  function countedKeys(): unknown[] {
    return increment.mock.calls.map((call) => call[0]);
  }

  /** What the reader has used this hour under one scope, as the store holds it. */
  async function used(scope: string, userId: string): Promise<number> {
    return (await getCounterStore().read(rateKey(scope, userId, NOW), NOW)).value;
  }

  for (const { name, scope, limit, call } of CASES) {
    describe(name, () => {
      it(`answers a signed-in reader's first ${limit} calls an hour, and the next one 429 with the rest of the hour in Retry-After`, async () => {
        for (let i = 0; i < limit; i += 1) {
          expect((await call()).status).toBe(200);
        }
        const over = await call();

        expect(over.status).toBe(429);
        expect(over.headers.get("retry-after")).toBe(RETRY_AFTER);
        // The report route marks its own answers private; either way it is never cached.
        expect(over.headers.get("cache-control")).toMatch(/no-store/);
      });

      it(`counts each call under the reader's own hour for "${scope}" and under no other key`, async () => {
        await call();
        await call();
        await call();

        const key = rateKey(scope, "reader-1", NOW);
        expect(key).toBe(`rate:${scope}:reader-1:2026-10-07T09`);
        expect(countedKeys()).toEqual([key, key, key]);
        expect(await used(scope, "reader-1")).toBe(3);
      });

      it("holds each reader to their own count: one reader at the limit does not refuse the next", async () => {
        for (let i = 0; i < limit + 1; i += 1) await call();
        expect((await call()).status).toBe(429);

        mocks.getUser.mockResolvedValue(signedIn("reader-2"));

        expect((await call()).status).toBe(200);
        expect(await used(scope, "reader-2")).toBe(1);
        expect(await used(scope, "reader-1")).toBe(limit + 2);
      });

      it("starts a new count when the hour turns over", async () => {
        for (let i = 0; i < limit + 1; i += 1) await call();
        expect((await call()).status).toBe(429);

        vi.setSystemTime(new Date("2026-10-07T10:00:00.000Z"));

        expect((await call()).status).toBe(200);
        expect(countedKeys().at(-1)).toBe(`rate:${scope}:reader-1:2026-10-07T10`);
      });
    });
  }
});
