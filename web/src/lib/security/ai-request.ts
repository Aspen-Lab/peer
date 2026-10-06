import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLocalDevRuntime } from "@/lib/env/local-dev";
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
 * The three-condition body lives in `lib/env/local-dev.ts` so this and
 * `canUseLocalServerProvider` cannot drift apart. Local name and meaning
 * unchanged.
 */
function isLocalDevelopment(): boolean {
  return isLocalDevRuntime();
}

/** What a route gets when the request is allowed to proceed. */
export interface AiRequest {
  /**
   * The signed-in reader. Null when nobody is signed in: local development, a
   * runtime with no sign-in configured at all (a self-hosted copy, the test
   * process), or an anonymous caller on a route that allows one.
   */
  user: { id: string } | null;
  /**
   * True only for a caller the route chose to let through signed out
   * (`allowAnonymous`). Such a caller is held to the reading without a model
   * (`aiTierCeiling`). A runtime with no sign-in at all is NOT anonymous:
   * nobody can be anything else there, so a reader's own key works for
   * self-hosters and for every route test.
   */
  anonymous: boolean;
}

/**
 * ABC-freemium 1-06 · R-SEC-2, R-SEC-3, R-KEY-2 — **one shared check, and it
 * runs BEFORE `resolveProvider`.**
 *
 * What was wrong: every AI route resolved a provider first and only then asked
 * whether the caller was allowed one. Three of them returned their degraded
 * payload *before* reaching the guard at all, so they answered a stranger 200
 * and never authenticated. The check is unconditional now, so a signed-out
 * caller gets the shared 401 rather than a result built by an unauthenticated
 * request.
 *
 * It is a sign-in check and an hourly rate limit, nothing about a model: Peer
 * holds no model key of its own, so what a signed-in reader runs is on their own
 * key. What it still protects is Peer's server (the report and figure routes
 * make it fetch an address the caller names, and the PDF parse is not free) and
 * the reader from a runaway loop on their own key. The limit is per account,
 * which is why it needs a signed-in user.
 *
 * Returns either a `NextResponse` the route must return unchanged, or the user.
 * **`supabase.auth.getUser()` is called exactly once per request** — it is a
 * network round trip, and calling it here and again in the route would double it
 * on every feed load.
 *
 * The 503 and 401 shapes below carry `Cache-Control: no-store`.
 */
export interface RequireAiRequestOptions {
  /**
   * **R-ENT-4 — signed-out readers get the reading without a model everywhere.**
   *
   * Set by the feed route, and only by it. Without it a signed-out visitor would
   * get a 401 where they get a working feed built from free structured sources.
   * R-SEC-3 says a requested `aiTier: 2` from such a caller is **downgraded**,
   * not rejected, and `aiTierCeiling` below is what downgrades it: an anonymous
   * caller has a ceiling of 0, so the request never reaches `resolveProvider`.
   *
   * Every other route leaves this unset and answers a stranger 401: they are
   * routes whose entire purpose is a model's answer, or that fetch a page the
   * caller names.
   */
  allowAnonymous?: boolean;
}

export async function requireAiRequest(
  scope: string,
  limitPerHour = 30,
  options: RequireAiRequestOptions = {},
): Promise<AiRequest | NextResponse> {
  // Local development has no Supabase session, so there is no user to read and
  // no stranger to keep out.
  if (isLocalDevelopment()) {
    return { user: null, anonymous: false };
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
    // way to be anything else. Treating the caller as anonymous would cap
    // `aiTierCeiling` at 0 and silently stop a reader's own key working for
    // self-hosters and for every route test; `deployedRuntimeNeedsAuth()` is
    // what keeps this unreachable from a deployment.
    return { user: null, anonymous: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    if (options.allowAnonymous) {
      return { user: null, anonymous: true };
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
  // themselves are passed by each route (60/h feeds, 20/h reports).
  //
  // The window is a fixed UTC clock hour carried in the key rather than an hour
  // rolling from the user's first request. A user who sends 60 requests at 10:59
  // can send 60 more at 11:00; that is the trade for a counter that survives a
  // cold start. **Fails open** — an unreachable store must not answer 429 to
  // every signed-in user (see `counters.ts`).
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

  return { user: { id: user.id }, anonymous: false };
}

/**
 * R-SEC-3 — **the requested tier is an upper bound, never a grant.**
 *
 * A request body asks for a tier; it cannot raise its own. An anonymous caller
 * (a feed request with no session) is capped at 0, so such a request never
 * reaches `resolveProvider` however the body is worded. Everyone else gets what
 * they asked for, and whether a model then runs is decided by whether a key of
 * the reader's own resolves.
 */
export function aiTierCeiling(
  requestedAiTier: number | undefined,
  request: Pick<AiRequest, "anonymous">,
): 0 | 1 | 2 {
  const requested = Math.max(0, Math.min(2, requestedAiTier ?? 0));
  return (request.anonymous ? 0 : requested) as 0 | 1 | 2;
}
