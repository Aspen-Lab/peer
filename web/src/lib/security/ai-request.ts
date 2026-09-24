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

function isLocalDevelopment(): boolean {
  return isLocalDevRuntime();
}

const LOCAL_NO_AUTH_USER_ID = "local-no-auth";

export interface EntitledAiRequest {
  user: { id: string } | null;
  entitlement: Entitlement;
}

export interface RequireEntitledAiRequestOptions {
  allowAnonymous?: boolean;
}

/** Resolve server authority before any provider is considered. */
export async function requireEntitledAiRequest(
  scope: string,
  limitPerHour = 30,
  options: RequireEntitledAiRequestOptions = {},
): Promise<EntitledAiRequest | NextResponse> {
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

  const now = new Date();
  const reading = await getCounterStore().increment(
    rateKey(scope, user.id, now),
    endOfUtcHour(now),
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
 */
export async function protectAiRequest(
  scope: string,
  limitPerHour = 30,
): Promise<NextResponse | null> {
  const result = await requireEntitledAiRequest(scope, limitPerHour);
  return result instanceof NextResponse ? result : null;
}

/** The requested tier is an upper bound; request data is never a grant. */
export function entitledAiTier(
  requestedAiTier: number | undefined,
  entitlement: Entitlement,
): 0 | 1 | 2 {
  const requested = Math.max(0, Math.min(2, requestedAiTier ?? 0));
  const ceiling = entitlement.userId !== null ? 2 : 0;
  return Math.min(requested, ceiling) as 0 | 1 | 2;
}
