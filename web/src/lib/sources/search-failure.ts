/**
 * Telling "the source returned nothing" apart from "the source call failed".
 *
 * WHY THIS EXISTS. Every provider fetcher used to answer a failure the same way
 * it answers an empty result: `return []`. A pipeline cannot distinguish those,
 * so a dead credential produced a feed of zero rows with `errors: {}` beside it
 * — the report actively said nothing was wrong. Measured 2026-08-27, on the
 * Tavily web-search source Peer had then (since removed): a key past its
 * pay-as-you-go limit answered `HTTP 433` to all sixteen queries, every surface
 * rendered empty, and the only trace anywhere was a silent
 * `if (!res.ok) return []`. The user could not have found that, and neither
 * could a maintainer reading the diagnostics.
 *
 * THE CONTRACT, in one line: a fetcher THROWS when the call failed and RETURNS
 * `[]` when the call succeeded and matched nothing.
 *
 * The thrown error travels the channel the pipelines already have: their
 * `Promise.allSettled` over sources writes `errors[sourceId]`, which is already
 * carried out in each feed response's `meta.errors`.
 *
 * (The fan-out helper and its error class, which reported a web-search provider
 * as broken only when every query of a fan-out failed, went with the Tavily
 * source, their one caller.)
 */

/**
 * Build the error for a non-ok provider response, keeping a slice of the body.
 *
 * The body is the half that names the actual problem — the 433 above explained
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
