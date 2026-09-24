/**
 * The one place any operator-funded **search** credential or capability may be
 * turned into "this reader may spend it".
 *
 * ABC-freemium 1-05 / 2-04 · R-KEY-3 (amended 2026-09-05), R-POOL-3, R-ENT-4,
 * and the key half of R-SEC-2 · Ruling 5 point 2 · Ruling 6 points 3–4.
 *
 * What was wrong: three readers, identical in shape, each `request key || env
 * key` — `jobs/sources/jobweb.ts`, `events/sources/eventweb.ts` and
 * `sources/web-search.ts`. Nothing in that path read `aiTier`, a session or an
 * entitlement, so a stranger with a `curl` and no account spent the operator's
 * search credits: seven outgoing searches on the events feed, two on jobs, from
 * an unauthenticated request that never entered the LLM branch the sign-in guard
 * sits in.
 *
 * It was also wider than it looked. `query.webSearch` is only shaped as
 * `{ tavilyApiKey }` when the user has the Tavily connector switched **on**;
 * with it switched off the old readers still fell through to the operator's key.
 * A user who deliberately turned the connector off was still spending it.
 *
 * ── THE DEFAULT IS `false`, AND THAT IS NOT A STYLE CHOICE ───────────────────
 *
 * `systemSearchAllowed` is passed in, never inferred, and every caller that does
 * not pass it gets `false`. Two pipelines run outside a user's own request —
 * `api/jobs/dispatch-digests` (the nightly cron, per enrolled user) and
 * `api/test-digest`. A default of `true` would hand the cron the operator's key
 * on behalf of every enrolled user, silently, at scale. That is D9's exact
 * nightmare, and it is the reason this reads a flag rather than an environment.
 *
 * ── WHAT THE FIELD SHOWS WHEN EVERY CANDIDATE IS REJECTED ────────────────────
 *
 * `{ provenance: "none" }` with no keys, which lands on plumbing that already
 * exists: `resolveSearchProvider` returns `null`, `fetchImpl` returns `[]`
 * (`jobweb.ts` / `eventweb.ts`, both `if (!provider) return [];`) and the
 * pipeline serves the structured sources it already has. That is R-POOL-3's
 * "jobs and events still respond from the free structured sources immediately",
 * and it is today's behaviour for a keyless user. **No error branch belongs
 * here.**
 *
 * ── 2-04: THE GATE COVERS FOUR PROVIDERS, NOT ONE ────────────────────────────
 *
 * Round 2 found the same defect three more times. Only the system Tavily key
 * was behind `systemSearchAllowed`; **Brave, Vertex AI Search and Gemini
 * grounding were all read straight from the environment**, so on any runtime
 * where one of those names is set, an anonymous caller spent the operator's
 * search budget with no gate, no breaker and no usage row. Ruling 5 point 2
 * makes them one mechanism:
 *
 *  - one predicate — `systemSearchAllowed && <the credential exists>`;
 *  - one breaker — the 500/day cap, charged for **any** of the four;
 *  - one usage row — carrying the provider's **name**, not a hard-coded
 *    `"tavily"`.
 *
 * **The gate goes on the AVAILABILITY INPUTS, and that is load-bearing.**
 * Rewriting the auto preference order alone closes nothing: for jobs and events
 * the pipeline sets an explicit `provider` from the server's own environment, so
 * `resolveWebSearchProvider` returns from its explicit branch before any
 * ordering clause runs. Both branches read the same `availability` object, so
 * gating that object closes both at once.
 *
 * ── 5-01: D2a REMOVES THE SYSTEM BRANCH; THE GATE STAYS ──────────────────────
 *
 * The owner decided (D2a, Ruling 12) that **the operator never pays for search,
 * for anyone, on any plan**. So `resolveSystemSearchKeys` is now BYOK-or-nothing:
 * it never reads `process.env.TAVILY_API_KEY`, and `operatorSearchAvailability`
 * answers `false` for both capabilities unconditionally.
 *
 * **What did NOT go, and must not (Ruling 13 point 3).** `systemSearchAllowed`
 * stays on the input, because it is the ONLY gate on the Brave env read below.
 * With the Tavily branch gone the field *looks* dead; deleting it would re-open
 * `BRAVE_SEARCH_API_KEY` as an unconditional operator-funded read on any
 * self-host or developer machine — verbatim the hole 2-04 closed, and Ruling 5
 * point 2's reason still holds: a ban on Vercel is not a gate on a self-host.
 * The protective test for exactly this lives in `system-key.test.ts`.
 *
 * `provenance: "system"` and `isOperatorFundedSearch`'s `=== "system"` test stay
 * in the code as unreachable arms — Ruling 12 point 2's "wired to a hard `false`,
 * not deleted", so reversing the decision is one constant rather than a rebuild.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────
 *
 * **Adzuna, JSearch and USAJobs** (Ruling 6 point 4). They read
 * `request key || operator env key` in the same shape, but they are the free
 * structured backbone of the jobs surface and their keys buy free-tier quota
 * rather than per-call billing. Gating them would kill the free product's jobs
 * sources. They stay env-only, bounded by the existing per-user hourly buckets,
 * and they are **not** on the build guard's ban list either. **Threshold:** if
 * any of the three ever starts billing per request, it joins this mechanism the
 * same round.
 */

export interface SystemSearchKeyInput {
  /** The user's own Tavily key, from `query.webSearch.tavilyApiKey`. */
  requestTavilyKey?: string;
  /**
   * From `entitlement.systemSearchAllowed` — never from a request body, and
   * never defaulted to `true`.
   *
   * **5-01 / Ruling 13 point 3 — DO NOT DELETE THIS FIELD.** Under D2a it is
   * permanently `false` (see `entitlement/resolve.ts`), which makes it look
   * unused now that the system Tavily branch has gone. It is not: it is the one
   * and only gate on the `BRAVE_SEARCH_API_KEY` read below. Removing it re-opens
   * the hole 2-04 closed.
   */
  systemSearchAllowed: boolean;
}

export interface SystemSearchKeys {
  tavily?: string;
  brave?: string;
  /**
   * Where the **Tavily** key came from. `"none"` means no Tavily key was
   * resolved, whether or not a Brave key exists. A BYOK search costs the
   * operator nothing, so attributing it would be noise.
   *
   * **Its meaning is deliberately NOT widened to "the chosen provider's
   * provenance"** (2-04). Doing that would need the provider to be known before
   * the keys are resolved, which reverses the call order at all three adapters.
   * `isOperatorFundedSearch` below mixes the two facts at the one point of use
   * instead.
   *
   * **5-01 · D2a — `"system"` is now unreachable** and is kept on purpose
   * (Ruling 12 point 2). Nothing produces it; the arm stays so that reversing
   * D2a restores one branch rather than a type.
   */
  provenance: "byok" | "system" | "none";
}

export function resolveSystemSearchKeys(
  input: SystemSearchKeyInput,
): SystemSearchKeys {
  const requestTavilyKey = input.requestTavilyKey?.trim();
  // 2-04 — Brave is now behind the SAME gate as the system Tavily key. It used
  // to be read unconditionally and handed back on every branch, including
  // `provenance: "none"`, so an anonymous caller on a machine with
  // `BRAVE_SEARCH_API_KEY` set spent the operator's Brave credits. Gating it at
  // the env read makes `braveKeyPresent` correct at all three call sites with
  // no change to any of them.
  const brave = input.systemSearchAllowed
    ? process.env.BRAVE_SEARCH_API_KEY || undefined
    : undefined;

  if (requestTavilyKey) {
    return { tavily: requestTavilyKey, brave, provenance: "byok" };
  }
  // 5-01 · D2a (Ruling 12) — the system Tavily branch used to sit here:
  //   if (input.systemSearchAllowed && process.env.TAVILY_API_KEY) {
  //     return { tavily: process.env.TAVILY_API_KEY, ..., provenance: "system" };
  //   }
  // The operator now funds no search for anyone, so there is no server key to
  // fall through to. A reader with no key of their own gets `"none"`, which is
  // the honest answer this file already served them: `resolveSearchProvider`
  // returns `null`, `fetchImpl` returns `[]`, and the pipeline answers 200 from
  // the free structured sources. No error branch belongs here.
  return { brave, provenance: "none" };
}

/**
 * Whether this reader may spend the operator's Vertex project on search.
 *
 * Vertex AI Search and Gemini grounding are **capabilities rather than keys** —
 * their availability is "is a project configured", not "did a key resolve" — so
 * they cannot ride on `SystemSearchKeys`. They ride here instead, behind the
 * identical predicate, so that "who may spend the operator's search money" is
 * answered for all four providers in this one file.
 *
 * Three copies of `systemSearchAllowed && isXAvailable()` at three adapters is
 * how the fourth call site forgets; this is the one copy.
 */
export function operatorSearchAvailability(
  // The parameter is deliberately unread. It stays so that all three adapters
  // keep their call shape and so that restoring D2 is one edit in this body
  // rather than four at the call sites (Ruling 12 point 2).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _input: { systemSearchAllowed: boolean },
): { geminiAvailable: boolean; vertexAvailable: boolean } {
  // ABC-freemium 5-01 · D2a (Ruling 12) — FROZEN FALSE, unconditionally.
  //
  // Vertex AI Search and Gemini grounding are operator-funded capabilities, and
  // D2a says the operator funds no search for anyone on any plan. So this no
  // longer asks the environment whether a project is configured: the answer is
  // "no" even on a machine where one is. The parameter stays so that every call
  // site keeps its shape and re-enabling the decision is one edit here, not four.
  return { geminiAvailable: false, vertexAvailable: false };
}

/**
 * True when the search that is about to run is billed to the **operator**
 * rather than to the reader — so it must be charged to the 500/day breaker and
 * must write an R-METER-2 row naming the provider.
 *
 * Brave, Vertex and grounding are **always** operator-funded: there is no BYOK
 * path to any of them (`searchConnectors` carries only a Tavily key, and
 * `SystemSearchKeys` has no Brave request field). Tavily is the only provider
 * with two possible payers, which is what `provenance` records.
 *
 * **5-01 · D2a — this function now always answers `false` in practice.** Tavily
 * can only be `"byok"` or `"none"`, and the other three providers can no longer
 * be reached at all: `operatorSearchAvailability` is frozen `false` and Brave is
 * gated on a flag that is permanently `false`. The `=== "system"` test and the
 * `true` fall-through are kept as the reversal seam (Ruling 12 point 2), not
 * because either can fire.
 */
export function isOperatorFundedSearch(
  provider: "tavily" | "brave" | "vertex" | "gemini",
  keys: Pick<SystemSearchKeys, "provenance">,
): boolean {
  return provider === "tavily" ? keys.provenance === "system" : true;
}
