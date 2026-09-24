/**
 * Telling "the web returned nothing" apart from "the web search never ran".
 *
 * WHY THIS EXISTS. Every provider fetcher used to answer a failure the same way
 * it answers an empty result: `return []`. A pipeline cannot distinguish those,
 * so a dead credential produced a feed of zero rows with `errors: {}` beside it
 * — the report actively said nothing was wrong. Measured 2026-08-27: a Tavily
 * key past its pay-as-you-go limit answered `HTTP 433` to all sixteen queries,
 * every surface rendered empty, and the only trace anywhere was a silent
 * `if (!res.ok) return []`. The user could not have found that, and neither
 * could a maintainer reading the diagnostics.
 *
 * THE CONTRACT, in one line: a fetcher THROWS when the call failed and RETURNS
 * `[]` when the call succeeded and matched nothing. The fan-out then reports a
 * provider as broken only when EVERY query failed — one flaky query must never
 * take a surface down, which is why partial failure still yields results and is
 * merely logged.
 *
 * The thrown error travels the channel the pipelines already have: their
 * `Promise.allSettled` over sources writes `errors[sourceId]`, which is already
 * carried out in each feed response's `meta.errors`.
 */

/** Raised when a web-search provider failed on every query in a fan-out. */
export class WebSearchProviderError extends Error {
  readonly provider: string;

  constructor(provider: string, cause: unknown) {
    super(`${provider} web search failed for every query: ${describeCause(cause)}`);
    this.name = "WebSearchProviderError";
    this.provider = provider;
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return String(cause);
}

/**
 * Build the error for a non-ok provider response, keeping a slice of the body.
 *
 * The body is the half that names the actual problem — Tavily's 433 explains
 * the limit in prose, and a bare status code would have sent a reader hunting
 * for a network fault that was really a billing cap.
 */
export async function searchHttpFailure(
  provider: string,
  res: Response,
): Promise<Error> {
  const body = await res.text().catch(() => "");
  const detail = body.trim().replace(/\s+/g, " ").slice(0, 200);
  return new Error(
    `${provider} HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
  );
}

/**
 * Keep the results of a settled fan-out; throw when the provider answered
 * nothing but failures.
 *
 * `label` names the source for the log line, so one glance says which surface
 * degraded.
 */
export function collectSearchResults<T>(
  provider: string,
  label: string,
  settled: readonly PromiseSettledResult<T>[],
): T[] {
  const kept: T[] = [];
  const failures: unknown[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") kept.push(outcome.value);
    else failures.push(outcome.reason);
  }

  if (settled.length > 0 && kept.length === 0) {
    const error = new WebSearchProviderError(provider, failures[0]);
    console.error(`[${label}] ${error.message}`);
    throw error;
  }

  if (failures.length > 0) {
    // Survivable: some queries answered, so the surface still has rows. Say so
    // anyway — a provider degrading query-by-query is how a hard outage starts.
    console.warn(
      `[${label}] ${provider}: ${failures.length}/${settled.length} queries failed —`,
      failures[0],
    );
  }
  return kept;
}
