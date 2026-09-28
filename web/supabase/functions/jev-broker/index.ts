/**
 * Thin Supabase Edge Function entry — the Edge-side reader of the real Jev
 * API key, used only when Peer's transport switch selects the broker. Since
 * the user's 2026-09-26 reversal (ABC-JEV-INTEGRATION.md §1aa) the Next
 * server can also read the key itself, in web/src/lib/decisions/
 * jev-direct-client.ts (the default transport); this function stays in the
 * tree, dormant until selected. JEV-DIRECT (§1aa): comment corrected,
 * behaviour unchanged. Everything it needs to actually MAKE
 * the call is imported from the byte-parity copies alongside this file
 * (types.ts / rubric.ts / jev-contract.ts / jev-client.ts — see
 * ../../../src/lib/decisions/broker-parity.test.ts, which proves those
 * copies are identical to their web/src/lib/decisions/ sources plus exactly
 * one documented, mechanical import-specifier normalization).
 *
 * RUNTIME VERIFICATION IS BLOCKED for this whole campaign (no Deno/Supabase
 * CLI available) — this file is written to the best of the available
 * documentation and this codebase's own established conventions, but has
 * never actually been run. It is deliberately kept small so the untested
 * surface stays minimal. Nothing may deploy this function or set any secret
 * without separate, explicit user authorization (ABC-JEV-INTEGRATION.md
 * §1r.3). Excluded from the web/ TypeScript project (web/tsconfig.json) and
 * from web/ eslint (web/eslint.config.mjs) — it is Deno code, not Next code.
 *
 * Request contract (matches web/src/lib/decisions/broker-client.ts exactly
 * — both sides of this contract are written together in this slice, since
 * the function itself cannot be exercised to discover its real shape):
 *   POST, `Authorization: Bearer <the broker secret>`,
 *   body `{ ownerId: string, wireRequest: JevWireRequest }`.
 *
 * Response contract:
 *   401 — secret missing or does not match.
 *   400 — malformed request body.
 *   403 `owner_not_found` — ownerId does not resolve to a real user. Existence
 *        only — see the P3-S4-FIX STOP comment at the check site below for
 *        why this function does not ALSO verify entitlement, and where that
 *        check actually lives today.
 *   429 — this function's OWN independent per-user/global cap check refused
 *         the call (defense-in-depth: it does not trust that the Next side
 *         already reserved correctly — ABC-JEV-INTEGRATION.md §1p.H(2)
 *         "must not trust an owner id on the secret alone beyond those
 *         checks").
 *   200 — body is exactly a `JevCallResult` (see jev-client.ts) — validated
 *         structured decisions only, never prompt/state text.
 */

// deno-lint-ignore-file
// @ts-nocheck -- Deno-only globals (`Deno`, the esm.sh import) are not
// resolvable by the web/ TypeScript project, which excludes this whole
// directory (web/tsconfig.json). This file has never been type-checked or
// run by any tool in this campaign — see the module doc comment above.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callJev } from "./jev-client.ts";
import { edgeGlobalDayKey, edgePerUserDayKey } from "./counter-keys.ts";
import type { JevWireRequest } from "./jev-contract.ts";

const DEFAULT_PER_USER_DAILY_CAP = 50;
const DEFAULT_GLOBAL_DAILY_CAP = 2000;

function endOfUtcDay(now: Date): Date {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

function envNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Constant-time secret comparison (ABC-JEV-INTEGRATION.md §1p.H(2), BINDING:
 * "compared in constant time... never `===`"). Deno has no direct
 * equivalent of Node's `crypto.timingSafeEqual`, and comparing raw strings
 * of possibly-different length leaks length via early return either way —
 * so both sides are first hashed to a FIXED-length digest (SHA-256, 32
 * bytes) with the standard Web Crypto API, and the digests are compared
 * byte-by-byte with no early exit. This sidesteps the unequal-length
 * precondition `timingSafeEqual` itself requires, without needing it.
 */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

/**
 * This function's OWN independent reservation re-check. Deliberately NOT a
 * copy of web/src/lib/usage/counters.ts (that file is Node/Next-shaped — it
 * imports the Node admin client and several unrelated counter helpers this
 * function does not need) — instead, a small, self-contained call to the
 * SAME underlying SQL function (`increment_usage_counter`, from migration
 * 20260904000000_usage_counters.sql) that counters.ts itself calls, but
 * against this function's OWN `jev-edge:<owner>:<UTC-day>` /
 * `jev-edge:all:<UTC-day>` keys (./counter-keys.ts) — a SEPARATE namespace
 * from the Next side's `jev:<owner>:<UTC-day>` / `jev:all:<UTC-day>`
 * (web/src/lib/security/jev-broker-auth.ts). Before this fix both sides
 * reserved the SAME keys, so one brokered call incremented each counter
 * twice and every configured cap was silently halved (manager finding
 * F-M-P3-01, ABC-JEV-INTEGRATION.md §4 2026-09-24T11:29:31Z entry; ruling
 * corrects §1p.H(1)/(2)). Each side now reserves exactly one unit per call,
 * in its own namespace: the Next side's count is what actually bounds real
 * end-to-end spend for a normal request, and this function's own count
 * independently bounds what a leaked PEER_JEV_BROKER_SECRET could spend
 * entirely on its own — unchanged defense-in-depth reasoning, §1p.I's
 * accepted-cost analysis still stands. Both sides read caps from the same
 * env var names (PEER_JEV_PER_USER_DAILY_CAP, PEER_JEV_GLOBAL_DAILY_CAP) but
 * apply them to their own separate counters. Fails CLOSED: any RPC error, or
 * either count exceeding its cap, refuses the call. Keeping this cap
 * numerically in sync with whatever the Next side is configured with is an
 * operational concern for whoever wires real deployment — out of scope
 * here, since nothing is deployed in this campaign.
 */
async function reserveBoth(
  admin: ReturnType<typeof createClient>,
  ownerId: string,
  now: Date,
): Promise<{ ok: boolean }> {
  const windowEndsAt = endOfUtcDay(now).toISOString();
  const perUserKey = edgePerUserDayKey(ownerId, now);
  const globalKey = edgeGlobalDayKey(now);
  const perUserCap = envNumber("PEER_JEV_PER_USER_DAILY_CAP", DEFAULT_PER_USER_DAILY_CAP);
  const globalCap = envNumber("PEER_JEV_GLOBAL_DAILY_CAP", DEFAULT_GLOBAL_DAILY_CAP);

  // P3-S4-FIX (Round 3): per-user reservation FIRST, in isolation — mirrors
  // web/src/lib/security/jev-broker-auth.ts's reserveJevCall exactly, for
  // the same reason (a per-user refusal must never touch the shared global
  // counter — docs/jev-abc/P3-S4-A-20260924T0905Z.md Finding 2, the
  // budget-griefing gap). Previously both RPCs ran unconditionally via
  // Promise.all. Static-review-only change; this function's runtime stays
  // BLOCKED this campaign (no Deno/Supabase CLI available).
  const perUserReading = await admin.rpc("increment_usage_counter", {
    p_key: perUserKey,
    p_window_ends_at: windowEndsAt,
    p_by: 1,
  });
  if (perUserReading.error) return { ok: false };
  const perUserValue = Number(perUserReading.data);
  if (!Number.isFinite(perUserValue)) return { ok: false };
  if (perUserValue > perUserCap) return { ok: false };

  // Only reserve the shared global counter once the per-user reservation is
  // known to be within cap. Not rolled back if this refuses (same
  // safe-direction, bounded-cost, no-rollback design as the Next side).
  const globalReading = await admin.rpc("increment_usage_counter", {
    p_key: globalKey,
    p_window_ends_at: windowEndsAt,
    p_by: 1,
  });
  if (globalReading.error) return { ok: false };
  const globalValue = Number(globalReading.data);
  if (!Number.isFinite(globalValue)) return { ok: false };
  if (globalValue > globalCap) return { ok: false };
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }

  const brokerSecret = Deno.env.get("PEER_JEV_BROKER_SECRET") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const providedSecret = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";

  if (!brokerSecret || !(await constantTimeEqual(providedSecret, brokerSecret))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  let body: { ownerId?: unknown; wireRequest?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }
  const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
  const wireRequest = body.wireRequest as JevWireRequest | undefined;
  if (!ownerId || !wireRequest || typeof wireRequest !== "object") {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  // Owner existence check. NOTE — a documented simplification, not hidden:
  // this checks only that the owner id resolves to a real auth user. The
  // error below is named `owner_not_found`, not `owner_not_entitled`
  // (P3-S4-FIX Finding 3, docs/jev-abc/P3-S4-A-20260924T0905Z.md — the old
  // name overstated what this check actually does).
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(ownerId);
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "owner_not_found" }), { status: 403 });
  }

  // P3-S4-FIX (Round 3) STOP — entitlement check deliberately NOT added
  // here; a recorded gap, not an oversight. BINDING ABC-JEV-INTEGRATION.md
  // §1p.H(2) asks this function to also verify the owner is ENTITLED, using
  // the SAME rules as web/src/lib/entitlement/resolve.ts, shared in via a
  // byte-parity copy of its pure logic (this campaign's established pattern
  // for ./types.ts / ./rubric.ts / ./jev-contract.ts / ./jev-client.ts,
  // proven by web/src/lib/decisions/broker-parity.test.ts). That rule is not
  // copyable under this slice's file constraints:
  //   - resolve.ts's actual computation (an owner's stored `plan` +
  //     `trial_ends_at` + a mode -> `effectivePlan`, in a function called
  //     `fromStoredPlan`) is NOT exported from resolve.ts, so nothing can
  //     import it, let alone copy it as a standalone unit.
  //   - It calls resolve.ts's OWN exported `entitlementMode()` internally,
  //     which reads `process.env.PEER_ENTITLEMENT_MODE` directly inside its
  //     body instead of taking the mode as a parameter — copied verbatim
  //     that read cannot resolve in Deno, and "pass the mode in instead"
  //     would require refactoring resolve.ts itself.
  //   - This slice may IMPORT web/src/lib/entitlement/* but may NOT edit it
  //     (no new exports, no refactor), and hand-reimplementing the
  //     tiered/trial-expiry rule a second time here was explicitly ruled
  //     out: two divergent copies of entitlement logic is worse than a
  //     recorded gap.
  // Full reasoning: docs/jev-abc/P3-S4-FIX-C-*.md, DESIGN CHOICES §A.
  //
  // Current enforcement layer instead: web/src/lib/decisions/broker-client.ts
  // (`callJevViaBroker`) now REQUIRES a server-derived `entitled` boolean
  // (computed by the caller via `resolveEntitlement()`) and refuses before
  // ever reaching this function (P3-S4-FIX Finding 1, Next-side half). This
  // function's own check stays existence-only, so the gap is real: a leaked
  // `PEER_JEV_BROKER_SECRET` plus any existing ownerId still bypasses tier
  // gating at THIS layer, bounded only by the per-user/global caps below.
  const reservation = await reserveBoth(admin, ownerId, new Date());
  if (!reservation.ok) {
    return new Response(JSON.stringify({ error: "cap_exceeded" }), { status: 429 });
  }

  const apiKey = Deno.env.get("JEV_API_KEY") ?? "";
  const result = await callJev(wireRequest, { apiKey, fetchImpl: fetch });

  // "validated structured decisions only (no prompt text)" — `result` is
  // already exactly the typed, validated JevCallResult shape; the request's
  // own `state`/prompt content is never echoed back here.
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
