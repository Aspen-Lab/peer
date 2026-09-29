/**
 * The actual Jev HTTP transport. Deliberately Deno-portable: no `next/*`,
 * no `@/lib/supabase/*`, no `process.env` reads — every runtime import
 * below is a relative sibling file, and this file receives its API key
 * only as a `callJev(...)` parameter (ABC-JEV-INTEGRATION.md §1p.H(3),
 * BINDING: "NO direct-key path anywhere in web/" — `jev-client.ts` is
 * exercised in `web/` by tests only; a real key, if this is ever
 * duplicated into a Supabase Edge Function per P3-S4, is supplied by
 * whatever calls this function, never read from an environment variable
 * inside it).
 *
 * Maps every HTTP/network outcome to a typed, NEVER-THROWING result — see
 * the fault table in docs/jev-abc/P3-B-20260924T0525Z.md DESIGN §3. Retries
 * only 429/rate_limited and 529/overloaded, a small bounded number of
 * times with backoff; every other fault returns immediately.
 *
 * SAFETY: the API key is used only to build the `Authorization` header. It
 * is never interpolated into any returned status/detail string and never
 * logged — see `jev-client.test.ts`'s dedicated leak test.
 */

import { validateJevResponse, type JevWireRequest } from "./jev-contract";
import { JEV_MODEL_ID } from "./rubric";
import type { DecisionAnswer, DecisionUsage } from "./types";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** VERIFIED — docs.typesafe.ai/api. */
export const DEFAULT_JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

const DEFAULT_TIMEOUT_MS = 15_000;

/** Only these two statuses retry, per the fault table — everything else returns immediately. */
const RETRYABLE_STATUSES = new Set([429, 529]);
/** Small, fixed, bounded backoff — at most 2 retries (3 attempts total), never unbounded. */
const RETRY_DELAYS_MS = [500, 1_500] as const;

export type JevCallResult =
  | { status: "ok"; modelId: string; answers: DecisionAnswer[]; usage: DecisionUsage }
  | { status: "invalid_response"; detail: string }
  | { status: "unauthorized" }
  | { status: "invalid_request" }
  | { status: "rate_limited" }
  | { status: "overloaded" }
  | { status: "timeout" }
  | { status: "network_error" }
  | { status: "bad_json" };

export interface CallJevOptions {
  apiKey: string;
  /** Defaults to the global `fetch`. Tests always inject their own. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  endpoint?: string;
  /** Defaults to a real `setTimeout`-based wait (works with `vi.useFakeTimers()`). Injectable so a test can skip real/fake-timer ceremony entirely for the retry-backoff path. */
  sleepImpl?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface ResolvedOptions {
  apiKey: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  endpoint: string;
}

type AttemptOutcome =
  | { kind: "response"; response: Response }
  | { kind: "timeout" }
  | { kind: "network_error" };

/** One HTTP attempt, AbortController-based timeout. Never throws — every failure becomes a typed outcome. */
async function attemptFetch(wireRequest: JevWireRequest, options: ResolvedOptions): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(wireRequest),
      signal: controller.signal,
    });
    return { kind: "response", response };
  } catch {
    // An aborted fetch rejects too — distinguish "we timed out" from any
    // other network failure by checking whether OUR OWN controller fired.
    return controller.signal.aborted ? { kind: "timeout" } : { kind: "network_error" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 200 with a body — parse and validate. Every other documented status maps directly; anything undocumented is treated conservatively as a network-level surprise, never crashes. */
async function interpretResponse(
  response: Response,
  wireRequest: JevWireRequest,
): Promise<Exclude<JevCallResult, { status: "ok" }> | { status: "ok"; modelId: string; answers: DecisionAnswer[]; usage: Omit<DecisionUsage, "latencyMs"> }> {
  if (response.status === 401) return { status: "unauthorized" };
  if (response.status === 422) return { status: "invalid_request" };
  if (response.status === 429) return { status: "rate_limited" };
  if (response.status === 529) return { status: "overloaded" };
  if (response.status !== 200) return { status: "network_error" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "bad_json" };
  }

  const validated = validateJevResponse(body, { modelId: JEV_MODEL_ID, questions: wireRequest.questions });
  if (!validated.ok) return { status: "invalid_response", detail: validated.detail };
  return { status: "ok", modelId: validated.modelId, answers: validated.answers, usage: validated.usage };
}

async function runWithRetries(wireRequest: JevWireRequest, resolved: ResolvedOptions, sleep: (ms: number) => Promise<void>) {
  let attempt = 0;
  for (;;) {
    const outcome = await attemptFetch(wireRequest, resolved);
    if (outcome.kind === "timeout") return { status: "timeout" as const };
    if (outcome.kind === "network_error") return { status: "network_error" as const };

    const { response } = outcome;
    if (RETRYABLE_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      attempt += 1;
      continue;
    }
    return interpretResponse(response, wireRequest);
  }
}

/**
 * Calls Jev over HTTP and returns a typed, NEVER-THROWING result — see the
 * fault table this maps (module doc comment above). `wireRequest` should be
 * exactly what `jev-contract.ts`'s `buildJevRequest` produced; this
 * function does not build or truncate anything, it only transports and
 * validates.
 */
export async function callJev(wireRequest: JevWireRequest, options: CallJevOptions): Promise<JevCallResult> {
  const resolved: ResolvedOptions = {
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl ?? (fetch as FetchLike),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    endpoint: options.endpoint ?? DEFAULT_JEV_ENDPOINT,
  };
  const sleep = options.sleepImpl ?? defaultSleep;
  const start = Date.now();

  try {
    const result = await runWithRetries(wireRequest, resolved, sleep);
    if (result.status !== "ok") return result;
    return {
      status: "ok",
      modelId: result.modelId,
      answers: result.answers,
      usage: { ...result.usage, latencyMs: Date.now() - start },
    };
  } catch {
    // Final safety net for any truly unanticipated failure (e.g. a
    // fetchImpl that throws in a way none of the above anticipated). Never
    // throws, no matter what.
    return { status: "network_error" };
  }
}
