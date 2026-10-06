import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
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
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
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
import { POST as papersReportPost } from "./papers/report/route";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

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
    vi.stubEnv("TAVILY_API_KEY", OPERATOR_SENTINEL);
    vi.stubEnv("BRAVE_SEARCH_API_KEY", OPERATOR_SENTINEL);
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
