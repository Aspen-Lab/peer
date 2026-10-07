import "server-only";

/**
 * The server-only direct Jev client, on the READER'S own key.
 *
 * Peer holds no Jev key. Jev is a bring-your-own-key option, like a model key:
 * the reader applies for a key with Jev, pastes it into their profile, and the
 * browser sends it with the paper request (`jevApiKey` in the request body).
 * This function receives it as a parameter and uses it for exactly one thing:
 * the `Authorization` header of the call to Jev. It reads nothing from the
 * environment (no company key, no broker secret), takes no entitlement flag,
 * reserves no daily budget and keeps no counter: the reader pays Jev directly,
 * and the bounds on what a runaway client can spend on that key are the hourly
 * request limit, the 50-candidate ceiling per build, the decision cache and the
 * stop-on-first-rejection rule in the caller.
 *
 * `import "server-only"` above is this Next version's own documented mechanism
 * (`web/node_modules/next/dist/docs/01-app/02-guides/data-security.md`) for
 * making an accidental import from a Client Component fail the BUILD rather
 * than merely a runtime check.
 *
 * It is a THIN wrapper over two building blocks that were already proven:
 * `buildJevRequest` (`jev-contract.ts`, the wire shape that leaves Peer) and
 * `callJev` (`jev-client.ts`, the HTTP transport, already proven never to leak
 * its `apiKey` parameter into any log line, error message or returned result).
 * It touches the key one way only (the `apiKey` argument handed to `callJev`),
 * with no template-literal error messages and no cache-key input, so it
 * inherits that never-leaks guarantee structurally.
 *
 * Flow:
 *  1. A blank or key-shaped-wrong value (`parseJevApiKey`, `jev-key.ts`) makes
 *     no call and answers `{status: "network_error"}`: the status for "no call
 *     was possible". The route never calls with such a value; this is the
 *     fail-closed answer for a caller bug.
 *  2. Build the wire request (`buildJevRequest`) and call `callJev`.
 *  3. Return `callJev`'s result UNCHANGED: every fault status it defines passes
 *     through with no remapping.
 *
 * Never throws: every failure is a typed `JevCallResult`.
 */

import { buildJevRequest } from "./jev-contract";
import { callJev, type FetchLike, type JevCallResult } from "./jev-client";
import { parseJevApiKey } from "./jev-key";
import type { DecisionRequest } from "./types";

export interface JevDirectClientOptions {
  /** The reader's own Jev key, as the browser sent it. Used for the `Authorization` header and nothing else. */
  apiKey: string;
  /** Defaults to the global `fetch`. Tests always inject their own. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Calls Jev with the reader's key. Never throws. */
export async function callJevDirect(
  request: DecisionRequest,
  options: JevDirectClientOptions,
): Promise<JevCallResult> {
  try {
    const apiKey = parseJevApiKey(options.apiKey);
    if (!apiKey) return { status: "network_error" };

    const { wireRequest } = buildJevRequest(request);
    return await callJev(wireRequest, {
      apiKey,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    // Final safety net for any truly unanticipated failure: never throws, no
    // matter what.
    return { status: "network_error" };
  }
}
