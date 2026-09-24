/**
 * The Next-side broker client. This is the ONLY production path that can
 * ever reach a real Jev call in this codebase (ABC-JEV-INTEGRATION.md
 * §1p.H(3), BINDING: "NO direct-key path anywhere in web/" — `jev-client.ts`
 * is exercised in `web/` by tests only). This file never reads the raw Jev
 * provider credential (that name is deliberately not spelled out even in
 * this comment — a structural test asserts the substring is absent from
 * this file's own text, not merely "not read") and never references Jev's
 * own domain directly — it only knows about a caller-supplied broker URL
 * and broker secret, and forwards to the Supabase Edge Function at
 * `web/supabase/functions/jev-broker/` (§0.7), which alone holds the real
 * key.
 *
 * Gated behind a server-only flag (`PEER_JEV_BROKER`, literal "on" only,
 * default off — mirrors `dashboardLedgerEnabled()`'s exact convention).
 * Nothing calls this function yet; wiring it into the pipeline is P3-S5.
 *
 * Flow, in order, on every path including error paths (docs/jev-abc/
 * P3-S3S4-C-*.md has the full reasoning for each design choice below):
 *  1. Flag off -> `{status: "disabled"}`, no reservation, no fetch.
 *  2. **Entitlement gate (P3-S4-FIX, Round 3 — docs/jev-abc/
 *     P3-S4-A-20260924T0905Z.md Finding 1, ABC-JEV-INTEGRATION.md §1p.H(2)):**
 *     `options.entitled` must be `true` -> refused ->
 *     `{status: "not_entitled"}`, no reservation, no fetch. This is a
 *     capability-like boolean the CALLER computes server-side from the
 *     verified session/profile (e.g. `resolveEntitlement(ownerId)` in
 *     `@/lib/entitlement/resolve`, typically `effectivePlan !== "free"`) and
 *     passes in — this module never computes it itself and never reads it
 *     from client input, the same "server-derived, never client-supplied"
 *     treatment `ownerId` already gets. Checked BEFORE `reserveJevCall` so an
 *     unentitled caller costs nothing, not even a reservation attempt.
 *  3. `reserveJevCall` (`security/jev-broker-auth.ts`) -> refused ->
 *     `{status: "reservation_refused", reason}`, no fetch. This is checked
 *     STRICTLY before any HTTP attempt on every path.
 *  4. Build the Jev wire request locally (`buildJevRequest`, already
 *     available here with no Deno restriction) and POST
 *     `{ownerId, wireRequest}` to the broker, secret as an `Authorization:
 *     Bearer` header (mirrors the existing `CRON_SECRET` pattern in
 *     `dispatch-digests/route.ts`) — NEVER in the URL.
 *  5. Map the broker's HTTP response to the same typed results `callJev`
 *     itself produces (`JevCallResult`) — the broker already ran the real
 *     `callJev` server-side and forwards its result verbatim on 200; a
 *     broker-level pre-flight rejection (bad secret, owner not found, the
 *     broker's OWN independent cap re-check) maps through the same
 *     fault-shaped statuses `jev-client.ts` already defines.
 *
 * DESIGN CHOICE: the return type is `JevCallResult` PLUS three broker-specific
 * statuses (`disabled`, `not_entitled`, `reservation_refused`) rather than
 * shoehorning those pre-flight outcomes into an existing Jev fault code — see
 * the checkpoint for the full reasoning (debuggability: a future caller can
 * distinguish "Jev is rate-limiting us" from "our own budget guard fired"
 * from "this owner isn't entitled to spend at all").
 */

import { reserveJevCall, type ReserveJevCallRefusalReason } from "@/lib/security/jev-broker-auth";
import type { CounterStore } from "@/lib/usage/counters";
import { buildJevRequest } from "./jev-contract";
import type { JevCallResult } from "./jev-client";
import type { DecisionRequest } from "./types";

export type BrokerFetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type BrokerCallResult =
  | JevCallResult
  | { status: "disabled" }
  | { status: "not_entitled" }
  | { status: "reservation_refused"; reason: ReserveJevCallRefusalReason };

export interface BrokerClientOptions {
  /** The server-derived owner id (from the authenticated session) — never a client-supplied field. */
  ownerId: string;
  /**
   * Server-derived entitlement decision (P3-S4-FIX Finding 1) — e.g. the
   * caller's own `resolveEntitlement(ownerId).effectivePlan !== "free"`.
   * Required, never defaulted, and never read from client input: a caller
   * that forgets to compute this must get a type error, not a silent `true`.
   * `callJevViaBroker` refuses before any reservation when this is `false`.
   */
  entitled: boolean;
  brokerUrl: string;
  /** `PEER_JEV_BROKER_SECRET` — passed in, never read from `process.env` inside this module. */
  brokerSecret: string;
  perUserCap: number;
  globalCap: number;
  store: CounterStore;
  now?: Date;
  /** Defaults to the global `fetch`. Tests always inject their own. */
  fetchImpl?: BrokerFetchLike;
  timeoutMs?: number;
}

const DEFAULT_BROKER_TIMEOUT_MS = 15_000;

/** Literal `"on"` only — the same convention as `dashboardLedgerEnabled()`. */
export function jevBrokerEnabled(): boolean {
  return process.env.PEER_JEV_BROKER?.trim().toLowerCase() === "on";
}

const KNOWN_JEV_CALL_STATUSES = new Set([
  "ok",
  "invalid_response",
  "unauthorized",
  "invalid_request",
  "rate_limited",
  "overloaded",
  "timeout",
  "network_error",
  "bad_json",
]);

/** Never blindly trusts the broker's own response body — validated the same way any untrusted JSON is validated in this codebase. */
function isJevCallResultShaped(value: unknown): value is JevCallResult {
  if (typeof value !== "object" || value === null) return false;
  const status = (value as { status?: unknown }).status;
  if (typeof status !== "string" || !KNOWN_JEV_CALL_STATUSES.has(status)) return false;
  if (status === "ok") {
    const candidate = value as { modelId?: unknown; answers?: unknown; usage?: unknown };
    return (
      typeof candidate.modelId === "string" &&
      Array.isArray(candidate.answers) &&
      typeof candidate.usage === "object" &&
      candidate.usage !== null
    );
  }
  return true;
}

type FetchOutcome = { kind: "response"; response: Response } | { kind: "timeout" } | { kind: "network_error" };

/** AbortController-based timeout, mirrors `jev-client.ts`'s own attempt pattern — never throws, every failure becomes a typed outcome. */
async function attemptBrokerFetch(
  url: string,
  body: string,
  secret: string,
  fetchImpl: BrokerFetchLike,
  timeoutMs: number,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body,
      signal: controller.signal,
    });
    return { kind: "response", response };
  } catch {
    return controller.signal.aborted ? { kind: "timeout" } : { kind: "network_error" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Given a validated `DecisionRequest`, reserves budget, then calls the
 * broker. Never throws — every failure is a typed `BrokerCallResult`.
 */
export async function callJevViaBroker(
  request: DecisionRequest,
  options: BrokerClientOptions,
): Promise<BrokerCallResult> {
  try {
    if (!jevBrokerEnabled()) return { status: "disabled" };
    // P3-S4-FIX Finding 1 — refuse BEFORE any counter reservation when the
    // caller-supplied entitlement decision is false. See BrokerClientOptions.
    if (!options.entitled) return { status: "not_entitled" };

    const reservation = await reserveJevCall(options.ownerId, {
      perUserCap: options.perUserCap,
      globalCap: options.globalCap,
      now: options.now,
      store: options.store,
    });
    if (!reservation.ok) {
      return { status: "reservation_refused", reason: reservation.reason };
    }

    const { wireRequest } = buildJevRequest(request);
    const body = JSON.stringify({ ownerId: options.ownerId, wireRequest });
    const fetchImpl = options.fetchImpl ?? (fetch as BrokerFetchLike);
    const timeoutMs = options.timeoutMs ?? DEFAULT_BROKER_TIMEOUT_MS;

    const outcome = await attemptBrokerFetch(options.brokerUrl, body, options.brokerSecret, fetchImpl, timeoutMs);
    if (outcome.kind === "timeout") return { status: "timeout" };
    if (outcome.kind === "network_error") return { status: "network_error" };

    const { response } = outcome;
    if (response.status === 401 || response.status === 403) return { status: "unauthorized" };
    if (response.status === 429) return { status: "rate_limited" };
    if (response.status !== 200) return { status: "network_error" };

    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch {
      return { status: "bad_json" };
    }

    if (!isJevCallResultShaped(parsedBody)) {
      return { status: "invalid_response", detail: "broker response body is not a recognizable JevCallResult" };
    }
    return parsedBody;
  } catch {
    // Final safety net for any truly unanticipated failure — never throws, no matter what.
    return { status: "network_error" };
  }
}
