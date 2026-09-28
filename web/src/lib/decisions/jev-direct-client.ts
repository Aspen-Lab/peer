import "server-only";

/**
 * JEV-DIRECT (§1aa) — the server-only direct Jev client. The ONE file in
 * `web/` permitted to read `process.env.JEV_API_KEY`, mirroring exactly how
 * `broker-client.ts` is the one file permitted to hold
 * `PEER_JEV_BROKER_SECRET` — same pattern, new file, new secret
 * (`docs/jev-abc/JEV-DIRECT-B-20260927T013846Z.md` §4).
 *
 * `import "server-only"` above is this Next version's own documented
 * mechanism (`web/node_modules/next/dist/docs/01-app/02-guides/
 * data-security.md`) for making an accidental import from a Client
 * Component fail the BUILD rather than merely a runtime check — the
 * guarantee a `typeof window` check cannot give, since that only fires
 * after client code has already shipped.
 *
 * Reuses the exact same building blocks the broker path already proved out,
 * unchanged: `reserveJevCall` (`security/jev-broker-auth.ts`, same
 * `jev:<owner>:<day>`/`jev:all:<day>` counters, same per-user-then-global
 * order, same fail-closed behaviour — ABC-JEV-INTEGRATION.md §1aa point 2),
 * `buildJevRequest` (`jev-contract.ts`, the identical wire shape the broker
 * sends), and `callJev` (`jev-client.ts`, the real HTTP transport, already
 * proven never to leak its `apiKey` parameter into any log line, error
 * message, or returned result). This module is a THIN wrapper over all
 * three — it reads the key once, passes it straight into `callJev`, and
 * never touches it any other way (no template-literal error messages, no
 * cache-key input), so it inherits `callJev`'s never-leaks guarantee
 * structurally instead of needing a parallel proof from scratch.
 *
 * Flow, in order, on every path including error paths (mirrors
 * `broker-client.ts`'s `callJevViaBroker` exactly, minus the broker hop):
 *  1. `JEV_API_KEY` unset/blank -> `{status: "disabled"}`, no reservation,
 *     no fetch.
 *  2. Entitlement gate: `options.entitled` must be `true` -> refused ->
 *     `{status: "not_entitled"}`, no reservation, no fetch. Same
 *     server-derived, never-client-supplied treatment as the broker path.
 *  3. `reserveJevCall` -> refused -> `{status: "reservation_refused",
 *     reason}`, no fetch. Checked STRICTLY before any HTTP attempt.
 *  4. Build the wire request (`buildJevRequest`) and call `callJev` with the
 *     key read in step 0 — the same `wireRequest` the broker path would send
 *     Jev, byte-for-byte, just with one fewer hop.
 *  5. Return `callJev`'s result UNCHANGED — every fault status it defines
 *     passes through with no remapping (thin wrapper, not a reimplementation).
 *
 * Return type: `BrokerCallResult` (`broker-client.ts`) — the same shape
 * broker calls already return, now shared by a second transport. Kept the
 * existing name (manager ruling, ABC-JEV-INTEGRATION.md §1ab P4); the
 * transport-neutral alias `JevCallResult` lives in `jev-dispatch.ts`, not
 * here (see that file's own comment for why).
 */

import { reserveJevCall, type ReserveJevCallRefusalReason } from "@/lib/security/jev-broker-auth";
import type { CounterStore } from "@/lib/usage/counters";
import type { BrokerCallResult } from "./broker-client";
import { buildJevRequest } from "./jev-contract";
import { callJev, type FetchLike } from "./jev-client";
import type { DecisionRequest } from "./types";

export interface JevDirectClientOptions {
  /** The server-derived owner id (from the authenticated session) — never a client-supplied field. */
  ownerId: string;
  /** Server-derived entitlement decision — same contract as `BrokerClientOptions.entitled`. Required, never defaulted. */
  entitled: boolean;
  perUserCap: number;
  globalCap: number;
  store: CounterStore;
  now?: Date;
  /** Defaults to the global `fetch`. Tests always inject their own. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** The one place this module's source touches `process.env.JEV_API_KEY` — every other read in this file goes through this function, so the structural "reads it exactly once" test holds even though two exported functions need it. */
function readJevApiKey(): string | undefined {
  return process.env.JEV_API_KEY?.trim();
}

/** True exactly when `JEV_API_KEY` is set to a non-blank value. Used by `flag.ts`'s `resolveJevTransport()` to decide the direct transport is available. */
export function jevDirectConfigured(): boolean {
  return Boolean(readJevApiKey());
}

/**
 * Given a validated `DecisionRequest`, reserves budget, then calls Jev
 * directly. Never throws — every failure is a typed `BrokerCallResult`,
 * exactly mirroring `callJevViaBroker`'s own contract.
 */
export async function callJevDirect(
  request: DecisionRequest,
  options: JevDirectClientOptions,
): Promise<BrokerCallResult> {
  try {
    const apiKey = readJevApiKey();
    if (!apiKey) return { status: "disabled" };
    // Checked BEFORE any counter reservation — same order as
    // `callJevViaBroker`'s entitlement gate (P3-S4-FIX Finding 1).
    if (!options.entitled) return { status: "not_entitled" };

    const reservation = await reserveJevCall(options.ownerId, {
      perUserCap: options.perUserCap,
      globalCap: options.globalCap,
      now: options.now,
      store: options.store,
    });
    if (!reservation.ok) {
      return { status: "reservation_refused", reason: reservation.reason as ReserveJevCallRefusalReason };
    }

    const { wireRequest } = buildJevRequest(request);
    return await callJev(wireRequest, {
      apiKey,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    // Final safety net for any truly unanticipated failure — never throws,
    // no matter what. Mirrors `callJevViaBroker`'s own final catch.
    return { status: "network_error" };
  }
}
