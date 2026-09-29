/**
 * JEV-DIRECT (§1aa) — the transport dispatcher. `docs/jev-abc/
 * JEV-DIRECT-B-20260927T013846Z.md` §3: reads the ALREADY-RESOLVED
 * transport and calls exactly one of `callJevViaBroker` (existing,
 * unchanged) or `callJevDirect` (new) — never both, never neither-then-guess.
 *
 * `options.transport` is a REQUIRED input, not something this module
 * resolves itself via a fresh `flag.ts#resolveJevTransport()` call. The
 * caller (`app/api/feed/route.ts` today) resolves it ONCE per request and
 * threads it down through `decisions/shadow.ts`'s `ShadowRunnerOptions`,
 * exactly like `entitled`/the daily caps already are. This matters for two
 * reasons, both recorded in this item's checkpoint: (1) `shadow.ts`'s own
 * module doc comment already commits to "never reads `process.env`
 * itself... resolved by `flag.ts` and handed in by the caller," and (2)
 * `shadow.test.ts`'s ~30 existing broker-transport fixtures set
 * `PEER_JEV_BROKER="on"` and pass `brokerUrl`/`brokerSecret` as plain
 * function options WITHOUT ever setting `PEER_JEV_BROKER_URL`/
 * `PEER_JEV_BROKER_SECRET` as real environment variables (only `route.ts`,
 * via `readJevShadowConfig()`, has ever read those two names) — a dispatcher
 * that re-derived transport from env internally would flip every one of
 * those cases to `"disabled"`, breaking ~30 verified tests for a reason
 * unrelated to this item.
 */

import type { CounterStore } from "@/lib/usage/counters";
import { callJevViaBroker, type BrokerCallResult, type BrokerFetchLike } from "./broker-client";
import type { JevTransport } from "./flag";
import { callJevDirect } from "./jev-direct-client";
import type { DecisionRequest } from "./types";

/**
 * Transport-neutral alias for `BrokerCallResult` — the shared result shape
 * now returned by two transports, not one. Kept `BrokerCallResult`'s own
 * name unchanged where it already lives, per the manager ruling
 * (ABC-JEV-INTEGRATION.md §1ab P4: renaming touches every verified import
 * site for no behaviour change); this is the new, transport-neutral name for
 * code (like this dispatcher) that talks about "a Jev call result" without
 * implying broker specifically.
 *
 * WARNING for a future reader: `jev-client.ts` separately exports its OWN,
 * narrower `JevCallResult` — the raw Jev fault-table type only
 * (ok/invalid_response/unauthorized/invalid_request/rate_limited/overloaded/
 * timeout/network_error/bad_json — no `disabled`/`not_entitled`/
 * `reservation_refused`). The two are DIFFERENT types that happen to share a
 * name in different modules. This alias lives here, not in
 * `broker-client.ts`, precisely because `broker-client.ts` already imports
 * `jev-client.ts`'s `JevCallResult` unaliased into its own module scope (to
 * build `BrokerCallResult`'s union) — declaring a second, different
 * `JevCallResult` there would be a duplicate-identifier compile error. Never
 * import both this alias and `jev-client.ts`'s `JevCallResult` unaliased into
 * the same file.
 */
export type JevCallResult = BrokerCallResult;

export interface JevDispatchOptions {
  /** Resolved ONCE by the caller via `flag.ts`'s `resolveJevTransport()` — this module never re-resolves it. */
  transport: JevTransport;
  /** The server-derived owner id (from the authenticated session) — never a client-supplied field. */
  ownerId: string;
  /** Server-derived entitlement decision, passed straight through to whichever transport runs. */
  entitled: boolean;
  perUserCap: number;
  globalCap: number;
  store: CounterStore;
  now?: Date;
  /** Defaults to the global `fetch` inside whichever transport runs. Tests always inject their own. */
  fetchImpl?: BrokerFetchLike;
  timeoutMs?: number;
  /** Broker-only. Required in practice when `transport` is `"broker"`; unused for `"direct"`/`"disabled"`. */
  brokerUrl?: string;
  brokerSecret?: string;
}

/**
 * Calls exactly one of `callJevDirect`/`callJevViaBroker` based on the
 * already-resolved `options.transport`. Returns `{status:"disabled"}` with
 * no reservation and no fetch when: `transport` is `"disabled"`, OR
 * `transport` is `"broker"` but `brokerUrl`/`brokerSecret` are missing (a
 * caller contract violation — `resolveJevTransport()` only ever returns
 * `"broker"` when `readJevShadowConfig()` already reports the URL+secret
 * present, so a caller that resolved transport correctly never hits this;
 * it exists so a caller bug fails closed instead of attempting a fetch to an
 * empty URL, never throws).
 */
export async function dispatchJevCall(
  request: DecisionRequest,
  options: JevDispatchOptions,
): Promise<JevCallResult> {
  if (options.transport === "disabled") return { status: "disabled" };

  if (options.transport === "direct") {
    return callJevDirect(request, {
      ownerId: options.ownerId,
      entitled: options.entitled,
      perUserCap: options.perUserCap,
      globalCap: options.globalCap,
      store: options.store,
      now: options.now,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  }

  // options.transport === "broker"
  if (!options.brokerUrl || !options.brokerSecret) return { status: "disabled" };
  return callJevViaBroker(request, {
    ownerId: options.ownerId,
    entitled: options.entitled,
    brokerUrl: options.brokerUrl,
    brokerSecret: options.brokerSecret,
    perUserCap: options.perUserCap,
    globalCap: options.globalCap,
    store: options.store,
    now: options.now,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
}
