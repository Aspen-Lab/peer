import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

// ABC-freemium 1-06 — the guard reads a session, so the session is what a test
// has to control.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));

import { aiTierCeiling, requireAiRequest, type AiRequest } from "./ai-request";

beforeEach(() => {
  vi.clearAllMocks();
  resetCounterStoreForTests();
  mocks.getUser.mockResolvedValue(signedOut());
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetCounterStoreForTests();
});

/**
 * ABC-freemium 1-06 · R-SEC-2, R-SEC-3, R-KEY-2.
 *
 * The shared check every AI route runs BEFORE `resolveProvider`: sign-in, then
 * the per-hour rate limit. It says nothing about a model — Peer holds none.
 */
describe("requireAiRequest", () => {
  it("keeps local next dev available without cloud auth", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    const result = await requireAiRequest("test");

    expect(result).not.toBeInstanceOf(NextResponse);
    // No session to read, and not anonymous: a developer's own machine.
    expect(result).toEqual({ user: null, anonymous: false });
  });

  it("fails closed when a deployment has no auth configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const response = await requireAiRequest("test");

    expect(response).toBeInstanceOf(NextResponse);
    expect((response as NextResponse).status).toBe(503);
  });

  it("lets a runtime with no sign-in configured at all through as a reader, not an anonymous caller", async () => {
    // A self-hosted copy or the test process: not deployed, no Supabase URL.
    // Treating this caller as anonymous would cap the tier at 0 and silently
    // stop a reader's own key working for self-hosters and every route test.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(await requireAiRequest("test", 60, { allowAnonymous: true })).toEqual({
      user: null,
      anonymous: false,
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("answers a signed-out caller 401 in a deployed runtime", async () => {
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedOut());

    const result = await requireAiRequest("test");

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
    expect((result as NextResponse).headers.get("Cache-Control")).toBe(
      "no-store",
    );
  });

  it("lets a signed-out caller through as anonymous when the route allows it", async () => {
    // R-ENT-4 — signed-out readers get the reading without a model, not a 401.
    // Only the feed route passes this, and `aiTierCeiling` then caps the caller
    // at 0 so no provider is ever resolved for them.
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedOut());

    const result = await requireAiRequest("test", 60, { allowAnonymous: true });

    expect(result).toEqual({ user: null, anonymous: true });
  });

  it("returns the signed-in user, who is not anonymous", async () => {
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedIn("user-7"));

    const result = await requireAiRequest("test");

    expect(result).toEqual({ user: { id: "user-7" }, anonymous: false });
  });

  it("reads the session exactly once per request", async () => {
    // `getUser()` is a network round trip. Reading it in the guard and again in
    // the route would double it on every feed load.
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedIn("user-7"));

    await requireAiRequest("test");

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });
});

describe("the hourly rate limit", () => {
  it("answers 429 with Retry-After once a reader passes the route's limit", async () => {
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedIn("user-7"));

    for (let i = 0; i < 3; i += 1) {
      expect(await requireAiRequest("limited", 3)).not.toBeInstanceOf(NextResponse);
    }
    const refused = await requireAiRequest("limited", 3);

    expect(refused).toBeInstanceOf(NextResponse);
    const response = refused as NextResponse;
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("counts per reader and per scope, not across them", async () => {
    deployedRuntimeEnv(vi.stubEnv);

    mocks.getUser.mockResolvedValue(signedIn("user-a"));
    await requireAiRequest("scope-one", 1);
    expect(await requireAiRequest("scope-one", 1)).toBeInstanceOf(NextResponse);

    // Another scope for the same reader, and the same scope for another reader,
    // each start from zero.
    expect(await requireAiRequest("scope-two", 1)).not.toBeInstanceOf(NextResponse);
    mocks.getUser.mockResolvedValue(signedIn("user-b"));
    expect(await requireAiRequest("scope-one", 1)).not.toBeInstanceOf(NextResponse);
  });

  it("does not count a signed-out caller on a route that allows one — there is no account to count against", async () => {
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedOut());

    for (let i = 0; i < 5; i += 1) {
      const result = await requireAiRequest("anon", 1, { allowAnonymous: true });
      expect(result).toEqual({ user: null, anonymous: true });
    }
  });
});

describe("aiTierCeiling (R-SEC-3)", () => {
  const anonymous: AiRequest = { user: null, anonymous: true };
  const reader: AiRequest = { user: { id: "u1" }, anonymous: false };
  const noSignInRuntime: AiRequest = { user: null, anonymous: false };

  it("caps an anonymous caller at 0 however loudly the body asks", () => {
    expect(aiTierCeiling(2, anonymous)).toBe(0);
    expect(aiTierCeiling(99, anonymous)).toBe(0);
  });

  it("lets a reader, and a runtime with no sign-in, reach tier 2", () => {
    expect(aiTierCeiling(2, reader)).toBe(2);
    expect(aiTierCeiling(2, noSignInRuntime)).toBe(2);
  });

  it("treats the requested tier as an upper bound, never a grant", () => {
    expect(aiTierCeiling(0, reader)).toBe(0);
    expect(aiTierCeiling(1, reader)).toBe(1);
    expect(aiTierCeiling(undefined, reader)).toBe(0);
    expect(aiTierCeiling(-5, reader)).toBe(0);
    expect(aiTierCeiling(99, reader)).toBe(2);
  });
});
