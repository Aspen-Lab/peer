/**
 * `resolveEntitlement` — the one server-side answer to "what is this request
 * allowed to spend?".
 *
 * ABC-freemium 1-01 · R-ENT-2, R-ENT-5.
 *
 * **It takes a user id and nothing else.** Never a request body, never a profile
 * object the browser sent. That is the whole of R-SEC-3 at this layer: if the
 * only input is an id that came from `supabase.auth.getUser()`, no field a
 * client can set can raise its own plan. Callers obtain the id from
 * `getUser()` and from nowhere else.
 *
 * It lives here rather than in `lib/security/` because routes, the profile
 * route and the counter store all read it, and `lib/security/ai-request.ts`
 * imports `next/server` — which would drag `NextResponse` into anything that
 * only wants to know the plan.
 *
 * **It must work against a schema that does not have the columns yet.** Nobody
 * in this loop can apply the 1-13 migration, so a Supabase error on `plan` is
 * treated exactly like a missing row: fall through to `free`. Everything keeps
 * working at `free` until an admin applies the migration and sets a plan by
 * hand (D7).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { isLocalDevRuntime } from "@/lib/env/local-dev";
import {
  ANONYMOUS_ENTITLEMENT,
  FREE_DEEP_REPORTS_PER_MONTH,
  TRIAL_DEEP_REPORTS_TOTAL,
  asPlan,
  type Entitlement,
  type EntitlementSource,
  type Plan,
} from "./types";

/** The columns this module reads. Kept narrow so a widened row cannot leak. */
interface ProfilePlanRow {
  plan?: unknown;
  trial_started_at?: unknown;
  trial_ends_at?: unknown;
}

interface SupabaseSingleQuery {
  maybeSingle(): Promise<{ data: ProfilePlanRow | null; error: unknown }>;
}

interface SupabaseFilterQuery {
  eq(column: string, value: string): SupabaseSingleQuery;
}

export interface EntitlementSupabaseClient {
  from(table: string): { select(columns: string): SupabaseFilterQuery };
}

export interface ResolveEntitlementOptions {
  /**
   * Injected in tests, following `SupabasePoolCache`'s precedent: `undefined`
   * means "build the configured admin client", an explicit `null` means "behave
   * as though Supabase is unreachable".
   */
  client?: EntitlementSupabaseClient | null;
}

/**
 * The same predicate `pool-cache-supabase.ts` uses: an admin client exists only
 * when **both** variables are present, and a constructor throw is swallowed.
 * Reused rather than rewritten so there is one answer to "is Supabase here?".
 */
function configuredAdminClient(): EntitlementSupabaseClient | null {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  try {
    return createAdminClient() as unknown as EntitlementSupabaseClient;
  } catch {
    return null;
  }
}

function deepReportBudget(effectivePlan: Plan): number {
  switch (effectivePlan) {
    case "paid":
      return Number.POSITIVE_INFINITY;
    case "trial":
      return TRIAL_DEEP_REPORTS_TOTAL;
    default:
      return FREE_DEEP_REPORTS_PER_MONTH;
  }
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Build the derived half of an entitlement from a stored plan.
 *
 * D5 — expiry is computed **at read time**, never written back. A trial whose
 * `trial_ends_at` has passed reads as `free` on the very next request, with no
 * migration, no cron and no chance of a row that says `trial` outliving its
 * dates.
 */
function fromStoredPlan(
  plan: Plan,
  trialEndsAtRaw: unknown,
  now: Date,
  userId: string | null,
  source: EntitlementSource,
): Entitlement {
  const trialEndsAt = isoOrNull(trialEndsAtRaw);
  const trialExpired =
    plan === "trial" &&
    (trialEndsAt === null || new Date(trialEndsAt).getTime() <= now.getTime());
  const effectivePlan: Plan = trialExpired ? "free" : plan;

  return {
    plan,
    effectivePlan,
    deepReportsBudget: deepReportBudget(effectivePlan),
    // ABC-freemium 5-02 · **D2a (Ruling 12) — HARD FALSE FOR EVERY PLAN.**
    // The owner removed operator-funded search entirely: the operator never pays
    // for search, for anyone, on any plan. Every user searches on their own
    // Tavily key (BYOK) or gets the free structured sources. This used to read
    // `effectivePlan !== "free"`, and no plan may bring it back — the resolver
    // it feeds has no system branch left to reach (`lib/search/system-key.ts`)
    // and the build guard bans `TAVILY_API_KEY` on Vercel. It stays a field
    // rather than becoming a literal at the call sites so that reversing D2a is
    // this one constant (Ruling 12 point 2).
    systemSearchAllowed: false,
    // D3: the forced pool rebuild is what a free user does not get, and it is
    // untouched by D2a (Ruling 12 point 5). It still reads `effectivePlan`, so
    // an expired trial loses "refresh now" the moment it expires. What changed
    // is only WHOSE key a granted rebuild spends — the reader's own, or none.
    poolRefreshAllowed: effectivePlan !== "free",
    trialEndsAt: effectivePlan === "trial" ? trialEndsAt : null,
    userId,
    source,
  };
}

/**
 * R-ENT-5 — the local-development override.
 *
 * Ruling 3 point 2: with `PEER_DEV_ENTITLEMENT` **unset** the local default is
 * `free` with a synthesised `dev-local` user, not `paid`. Under D1 a free user
 * still gets the system LLM, so the day-to-day developer loop is unchanged;
 * what a developer loses is the system Tavily key, which is exactly the leak
 * R-KEY-3 exists to close and which one line of `.env.local`
 * (`PEER_DEV_ENTITLEMENT=trial`) restores.
 *
 * An unrecognised value is **ignored, not defaulted** — a typo must never
 * silently grant `paid`.
 */
function devEntitlement(userId: string | null, now: Date): Entitlement {
  const plan = asPlan(process.env.PEER_DEV_ENTITLEMENT) ?? "free";
  // A trial asked for by a developer is always a *live* trial; there is no row
  // to carry dates, so give it the full window rather than an expired one.
  const trialEndsAt =
    plan === "trial"
      ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
      : null;
  return fromStoredPlan(
    plan,
    trialEndsAt,
    now,
    userId ?? "dev-local",
    "dev-override",
  );
}

/**
 * Resolve what `userId` may spend.
 *
 * Order, and each branch's reason:
 *   1. **Local development** (R-ENT-5). Checked first because a developer's
 *      machine has no Supabase auth at all, so "no user" there means "the
 *      developer", not "a stranger". Three conditions guard it and the build
 *      guard bans `PEER_DEV_ENTITLEMENT` on Vercel (1-10), so it cannot be
 *      reached from a deployment even if the variable is added to a running one.
 *   2. **No user** → the frozen anonymous entitlement (R-ENT-4).
 *   3. **A signed-in user** → the stored row, or `free` if anything at all goes
 *      wrong reading it.
 */
export async function resolveEntitlement(
  userId: string | null,
  now: Date = new Date(),
  options: ResolveEntitlementOptions = {},
): Promise<Entitlement> {
  if (isLocalDevRuntime()) return devEntitlement(userId, now);
  if (!userId) return ANONYMOUS_ENTITLEMENT;

  const client =
    options.client === undefined ? configuredAdminClient() : options.client;
  const freeFallback = fromStoredPlan("free", null, now, userId, "supabase");
  if (!client) return freeFallback;

  try {
    const { data, error } = await client
      .from("profiles")
      .select("plan, trial_started_at, trial_ends_at")
      .eq("user_id", userId)
      .maybeSingle();
    // "Column does not exist" arrives here as an error, not as a null row —
    // which is why the two cases are handled identically. Until the 1-13
    // migration is applied every signed-in user resolves `free`, by design.
    if (error || !data) return freeFallback;
    const plan = asPlan(data.plan);
    if (!plan) return freeFallback;
    return fromStoredPlan(plan, data.trial_ends_at, now, userId, "supabase");
  } catch {
    return freeFallback;
  }
}
