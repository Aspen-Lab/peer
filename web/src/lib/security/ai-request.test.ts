import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

// ABC-freemium 1-06 — the guard reads a session to resolve an entitlement, so
// the session is what a test has to control.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));

import {
  entitledAiTier,
  protectAiRequest,
  requireEntitledAiRequest,
} from "./ai-request";
import { ANONYMOUS_ENTITLEMENT, type Entitlement } from "@/lib/entitlement/types";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue(signedOut());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("protectAiRequest", () => {
  it("keeps local next dev available without cloud auth", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    await expect(protectAiRequest("test")).resolves.toBeNull();
  });

  it("fails closed when a deployment has no auth configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const response = await protectAiRequest("test");
    expect(response?.status).toBe(503);
  });
});

/**
 * ABC-freemium 1-06 · R-SEC-2, R-SEC-3, R-KEY-2.
 */
describe("requireEntitledAiRequest", () => {
  it("returns an entitlement, not null, in local development", async () => {
    // The old guard's only success value was `null` — there was nothing to
    // carry a plan. Ruling 3 point 2 makes the unset local default `free` with a
    // synthesised `dev-local` user, so the developer still gets the model (D1)
    // and does not get the system search key.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");

    const result = await requireEntitledAiRequest("test");

    expect(result).not.toBeInstanceOf(NextResponse);
    const { entitlement } = result as { entitlement: Entitlement };
    expect(entitlement.effectivePlan).toBe("paid");
    expect(entitlement.userId).toBe("dev-local");
    expect(entitlement.systemSearchAllowed).toBe(false);
  });

  it("answers a signed-out caller 401 in a deployed runtime", async () => {
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedOut());

    const result = await requireEntitledAiRequest("test");

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
    expect((result as NextResponse).headers.get("Cache-Control")).toBe(
      "no-store",
    );
  });

  it("lets a signed-out caller through when the route allows it", async () => {
    // R-ENT-4 — "signed-out users get tier-0 behaviour everywhere ...
    // unchanged". Only the three feed routes pass this, and `entitledAiTier`
    // then caps them at 0 so nothing operator-funded is reachable.
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedOut());

    const result = await requireEntitledAiRequest("test", 60, {
      allowAnonymous: true,
    });

    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { entitlement: Entitlement }).entitlement).toBe(
      ANONYMOUS_ENTITLEMENT,
    );
  });

  it("returns the signed-in user and their entitlement", async () => {
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedIn("user-7"));

    const result = await requireEntitledAiRequest("test");

    expect(result).not.toBeInstanceOf(NextResponse);
    const typed = result as { user: { id: string }; entitlement: Entitlement };
    expect(typed.user.id).toBe("user-7");
    // One tier: no table here, and a signed-in reader still resolves the single plan.
    expect(typed.entitlement.effectivePlan).toBe("paid");
    expect(typed.entitlement.userId).toBe("user-7");
  });

  it("reads the session exactly once per request", async () => {
    // `getUser()` is a network round trip. Reading it in the guard and again in
    // the route would double it on every feed load.
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedIn("user-7"));

    await requireEntitledAiRequest("test");

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });
});

describe("entitledAiTier (R-SEC-3)", () => {
  function entitlement(overrides: Partial<Entitlement>): Entitlement {
    return { ...ANONYMOUS_ENTITLEMENT, ...overrides };
  }

  it("caps a signed-out caller at 0 however loudly the body asks", () => {
    expect(entitledAiTier(2, ANONYMOUS_ENTITLEMENT)).toBe(0);
    expect(entitledAiTier(99, ANONYMOUS_ENTITLEMENT)).toBe(0);
  });

  it("lets any signed-in user reach tier 2, free included", () => {
    // D1 — the ceiling is `userId !== null`, NOT `effectivePlan`. A later round
    // will be tempted to tighten this to `paid`; that would break D1.
    expect(entitledAiTier(2, entitlement({ userId: "u1", plan: "free" }))).toBe(2);
    expect(entitledAiTier(2, entitlement({ userId: "u1", plan: "paid" }))).toBe(2);
  });

  it("treats the requested tier as an upper bound, never a grant", () => {
    expect(entitledAiTier(0, entitlement({ userId: "u1" }))).toBe(0);
    expect(entitledAiTier(1, entitlement({ userId: "u1" }))).toBe(1);
    expect(entitledAiTier(undefined, entitlement({ userId: "u1" }))).toBe(0);
    expect(entitledAiTier(-5, entitlement({ userId: "u1" }))).toBe(0);
  });
});
