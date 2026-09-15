import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";

/**
 * ABC-freemium 1-09 · R-TEST-1, R-SEC-1, Ruling 2 point 7.
 *
 * `GET /api/figure` had **no authentication of any kind** and no test file at
 * all. It reaches a provider through `extractFigure` -> `chooseCandidate` -> the
 * semantic and vision matchers, which were the only two no-argument
 * `resolveProvider()` calls in the tree.
 *
 * **The money rule.** This suite drives the real handler and does not mock the
 * provider registry, so after item 1-11 an unmocked `resolveProvider()` would
 * return a live provider on the operator's real key. `vitest.setup.ts` deletes
 * `GOOGLE_API_KEY` before every suite and every test; `deleteSpendableKeys()`
 * below is the belt-and-braces call, and the "no model call" assertion is what
 * would catch a regression.
 */

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));

import { GET } from "./route";

const outgoing: string[] = [];

function recordingFetch(): typeof fetch {
  return vi.fn(async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as Request)?.url ?? "");
    outgoing.push(url);
    // Nothing usable comes back, so the deterministic extractor finds no
    // candidates and the route answers with its "no figure" result rather than
    // reaching for a model to choose between candidates it does not have.
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

function request(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/figure");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  outgoing.length = 0;
  deleteSpendableKeys();
  vi.stubGlobal("fetch", recordingFetch());
  deployedRuntimeEnv(vi.stubEnv);
  mocks.getUser.mockResolvedValue(signedOut());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/figure", () => {
  it("still rejects a request with no id before doing anything", () => {
    // The 400 must stay ahead of the guard: a malformed request is not an
    // authentication problem, and answering 401 to it would be a worse message.
    return GET(request({})).then(async (response) => {
      expect(response.status).toBe(400);
      expect(mocks.getUser).not.toHaveBeenCalled();
    });
  });

  it("answers a signed-out visitor 401 and fetches nothing", async () => {
    // R-SEC-1 / D8. Before this item the same request ran the whole extractor
    // and could reach a model, with no account involved.
    mocks.getUser.mockResolvedValue(signedOut());

    const response = await GET(request({ id: "paper-1", url: "https://example.org/p" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in before using an AI feature",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Nothing upstream was touched, so an unauthenticated caller cannot make
    // this route fetch on their behalf either.
    expect(outgoing).toEqual([]);
  });

  it("serves a signed-in reader without making a model call", async () => {
    // The degraded figure path is a real answer, not an error: with no provider
    // available the matchers return null and the deterministic extractor decides
    // on its own.
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));

    const response = await GET(request({ id: "paper-1", url: "https://example.org/p" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(typeof body.status).toBe("string");
    // No `GOOGLE_API_KEY` in this process, so `resolveProvider` returns null and
    // no request can have gone to a model endpoint.
    expect(
      outgoing.filter((url) => /googleapis|openai|anthropic|deepseek|dashscope/i.test(url)),
    ).toEqual([]);
  });
});
