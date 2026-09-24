// Shared HTTP helper for source adapters: per-call timeout + one short
// retry on 429 honoring Retry-After (capped). Returns the Response so
// callers can decide how to consume the body.
//
// P2-S4a-FIX (Round 3) — F-A-P2S4a-01, ABC-JEV-INTEGRATION.md §1p.B(3). The
// optional `headers` option is purely additive: omitted (every call site
// before this fix, and every keyless call after it), `init`/`retryInit`
// carry no `headers` key at all — not even `{}` — so behaviour is
// byte-identical to before this option existed. When given, it is applied
// on BOTH the first attempt and the 429-retry attempt, so a caller that needs
// an auth header (e.g. an optional `OPENALEX_API_KEY` sent as
// `Authorization: Bearer`) gets the SAME revalidate/retry treatment a
// headerless call already gets, instead of having to hand-rewrite this
// whole function just to add one header — which is exactly what 4 call
// sites previously did, each silently dropping `revalidate` and the 429
// retry once a key was configured (docs/jev-abc/P2-S4a-A-20260924T100013Z.md
// NEW FINDING #1).
export async function sourceFetch(
  url: string,
  options: { timeoutMs?: number; revalidate?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 7000;
  const init: RequestInit & { next?: { revalidate?: number } } = {
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (options.revalidate !== undefined) {
    init.next = { revalidate: options.revalidate };
  }
  if (options.headers !== undefined) {
    init.headers = options.headers;
  }

  let res = await fetch(url, init);
  if (res.status !== 429) return res;

  const retryAfter = Number(res.headers.get("Retry-After"));
  const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1000, 1500)
    : 500;
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const retryInit: RequestInit & { next?: { revalidate?: number } } = {
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (options.revalidate !== undefined) {
    retryInit.next = { revalidate: options.revalidate };
  }
  if (options.headers !== undefined) {
    retryInit.headers = options.headers;
  }
  res = await fetch(url, retryInit);
  return res;
}
