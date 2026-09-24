import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLocalDevRuntime } from "@/lib/env/local-dev";
import { resolveEntitlement } from "@/lib/entitlement/resolve";
import type { Entitlement } from "@/lib/entitlement/types";
import {
  endOfUtcHour,
  getCounterStore,
  rateKey,
  underLimit,
} from "@/lib/usage/counters";

function hasSupabaseAuthConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

function deployedRuntimeNeedsAuth(): boolean {
  return Boolean(
    process.env.NODE_ENV === "production" ||
      process.env.VERCEL ||
      process.env.VERCEL_ENV,
  );
}

/**
 * ABC-freemium 1-01 — the three-condition body moved to `lib/env/local-dev.ts`
 * so this, `canUseLocalServerProvider` and `resolveEntitlement` cannot drift
 * apart. Local name and meaning unchanged.
 */
function isLocalDevelopment(): boolean {
  return isLocalDevRuntime();
}

/**
 * The synthesised id for a runtime that has no sign-in mechanism configured —
 * a self-hosted instance or the test process. See the branch that uses it.
 */
const LOCAL_NO_AUTH_USER_ID = "local-no-auth";

/** What a route gets when the request is allowed to proceed. */
export interface EntitledAiRequest {
  /** Null only in local development, where there is no Supabase session. */
  user: { id: string } | null;
  entitlement: Entitlement;
}

/**
 * ABC-freemium 1-06 · R-SEC-2, R-SEC-3, R-KEY-2 — **one shared check, and it
 * runs BEFORE `resolveProvider`.**
 *
 * What was wrong: every AI route resolved a provider first and only then asked
 * whether the caller was allowed one. Three of them (`digest`, `jobs/report`,
 * `events/report`) returned their degraded payload *before* reaching the guard
 * at all, so they answered a stranger 200 and never authenticated. That is
 * harmless only while no provider ever resolves; the moment R-KEY-1 makes one
 * always resolve it becomes an open door.
 *
 * Returns either a `NextResponse` the route must return unchanged, or the user
 * and their entitlement. **`supabase.auth.getUser()` is called exactly once per
 * request** — it is a network round trip, and calling it here and again in the
 * route would double it on every feed load.
 *
 * The 503 and 401 shapes below are the ones `protectAiRequest` already
 * returned, byte for byte, including `Cache-Control: no-store`.
 */
export interface RequireEntitledAiRequestOptions {
  /**
   * **R-ENT-4 — "signed-out users get tier-0 behaviour everywhere, no system
   * spend — unchanged."**
   *
   * Set by the three feed routes, and only by them. Without it a signed-out
   * visitor would get a 401 where today they get a working feed built from free
   * structured sources, which is not "unchanged" and is not tier-0 behaviour.
   * R-SEC-3 says a non-entitled `aiTier: 2` is **downgraded**, not rejected, and
   * `entitledAiTier` below is what downgrades it: an anonymous entitlement has a
   * ceiling of 0, so such a request never reaches `resolveProvider` and never
   * carries `systemSearchAllowed`. Nothing operator-funded is reachable, which
   * is what D8 is protecting.
   *
   * Every other AI route leaves this unset and answers a stranger 401 — that is
   * D8 read plainly for routes whose entire purpose is a model's answer, and it
   * is what Ruling 3 point 7 predicts for `digest`, `jobs/report` and
   * `events/report`.
   */
  allowAnonymous?: boolean;
}

export async function requireEntitledAiRequest(
  scope: string,
  limitPerHour = 30,
  options: RequireEntitledAiRequestOptions = {},
): Promise<EntitledAiRequest | NextResponse> {
  // Local development has no Supabase session, so there is no user to read and
  // no stranger to keep out. R-ENT-5's `PEER_DEV_ENTITLEMENT` is what shapes
  // the developer's plan here; with it unset the entitlement is `free` with a
  // synthesised `dev-local` user (Ruling 3 point 2).
  if (isLocalDevelopment()) {
    return { user: null, entitlement: await resolveEntitlement(null) };
  }

  if (!hasSupabaseAuthConfig()) {
    if (deployedRuntimeNeedsAuth()) {
      return NextResponse.json(
        { error: "AI features require sign-in configuration" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    // A non-deployed runtime with **no sign-in mechanism at all** (no Supabase
    // URL configured, and not production or Vercel — the branch above answers
    // 503 for those). There is no stranger to keep out here because there is no
    // way to be anything else, so the caller is treated as one local free user
    // rather than as anonymous. Anonymous would cap `entitledAiTier` at 0 and
    // silently stop BYOK working for self-hosters and for every route test.
    //
    // `free` still means no system search key, and `deployedRuntimeNeedsAuth()`
    // is what keeps this unreachable from a deployment.
    return {
      user: null,
      entitlement: await resolveEntitlement(LOCAL_NO_AUTH_USER_ID),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    if (options.allowAnonymous) {
      return { user: null, entitlement: await resolveEntitlement(null) };
    }
    return NextResponse.json(
      { error: "Sign in before using an AI feature" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // ABC-freemium 1-02 · R-METER-3 — this was a module-scope `Map`, so a
  // serverless instance that had just started always saw zero and the limit was
  // per-instance rather than per-user. The shared store counts once per user
  // across every instance and survives a cold start.
  //
  // Increment first, then compare: the post-increment value is this caller's
  // own, so two instances cannot both see 59 and both proceed. The limits
  // themselves are unchanged — 60/h feeds, 20/h reports, passed by each route.
  //
  // The window is now a fixed UTC clock hour carried in the key rather than an
  // hour rolling from the user's first request. A user who sends 60 requests at
  // 10:59 can send 60 more at 11:00; that is the trade for a counter that
  // survives a cold start. **Fails open** — an unreachable store must not answer
  // 429 to every signed-in user (see `counters.ts`).
  const now = new Date();
  const reading = await getCounterStore().increment(
    rateKey(scope, user.id, now),
    endOfUtcHour(now),
    // `by` is spelled out because `now` follows it (2-01). One clock: the same
    // `now` that built the key also drives the store's housekeeping sweep.
    1,
    now,
  );

  if (!underLimit(reading, limitPerHour)) {
    const retryAfter = Math.max(
      1,
      Math.ceil((endOfUtcHour(now).getTime() - now.getTime()) / 1000),
    );
    return NextResponse.json(
      { error: "AI request limit reached. Try again later." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  return {
    user: { id: user.id },
    entitlement: await resolveEntitlement(user.id, now),
  };
}

/**
 * Protect an endpoint immediately before it spends a user's BYOK model key.
 * Tier 0 routes stay public; local `next dev` stays convenient.
 *
 * ABC-freemium 1-06 — kept, with its signature unchanged, as a thin wrapper that
 * discards the entitlement. Routes that only need "may this request proceed"
 * keep reading exactly as they did.
 */
export async function protectAiRequest(
  scope: string,
  limitPerHour = 30,
): Promise<NextResponse | null> {
  const result = await requireEntitledAiRequest(scope, limitPerHour);
  return result instanceof NextResponse ? result : null;
}

/**
 * R-SEC-3 — **the requested tier is an upper bound, never a grant.**
 *
 * The old line in each feed route was
 * `requestedAiTier >= 2 && !aiProvider ? 0 : requestedAiTier` — it downgraded
 * because *no provider resolved*, which stops being a defence the moment a
 * provider always resolves. This downgrades because the caller is *not
 * entitled*, which a request body cannot change.
 *
 * **The test is `userId !== null`, not `effectivePlan`.** D1 gives the system
 * LLM to every signed-in user, free included. A later round will be tempted to
 * "tighten" this to `paid`; that would break D1.
 */
export function entitledAiTier(
  requestedAiTier: number | undefined,
  entitlement: Entitlement,
): 0 | 1 | 2 {
  const requested = Math.max(0, Math.min(2, requestedAiTier ?? 0));
  const ceiling = entitlement.userId !== null ? 2 : 0;
  return Math.min(requested, ceiling) as 0 | 1 | 2;
}
