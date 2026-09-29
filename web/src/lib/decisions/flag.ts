/**
 * P3-S5 — the Jev SHADOW feature flag plus its server-only broker config
 * reader (ABC-JEV-INTEGRATION.md §4 Round 3 "P3-S5 DESIGN RULING",
 * 2026-09-24T11:29:31Z; docs/jev-abc/P3-B-20260924T0525Z.md §0.5).
 *
 * Deliberately separate from `PEER_JEV_BROKER` (`decisions/broker-client.ts`'s
 * `jevBrokerEnabled()`): the broker flag says "the broker PATH may be used at
 * all" (e.g. by a future direct feature), the shadow flag says "route.ts may
 * additionally schedule background shadow calls after a response." Both must
 * be "on" before route.ts ever schedules one — see route.ts's gating.
 *
 * Same literal-`"on"`-only convention as `jevBrokerEnabled()` and
 * `dashboardLedgerEnabled()` (`dashboard/ledger-flag.ts`): anything else
 * (unset, "true", "1", a typo) keeps today's behavior exactly. Never
 * `NEXT_PUBLIC_` — every name here is a server-only read
 * (ABC-JEV-INTEGRATION.md §0.1/§1p.H(3): nothing Jev-related may reach the
 * browser bundle).
 */

import { jevBrokerEnabled } from "./broker-client";
import { jevDirectConfigured } from "./jev-direct-client";

/** ABC-JEV-INTEGRATION.md §1p.H(1) — the default daily count-based caps. */
export const DEFAULT_JEV_PER_USER_DAILY_CAP = 50;
export const DEFAULT_JEV_GLOBAL_DAILY_CAP = 2000;

/** Literal `"on"` only — same convention as `jevBrokerEnabled()`. */
export function jevShadowEnabled(): boolean {
  return process.env.PEER_JEV_SHADOW?.trim().toLowerCase() === "on";
}

export type JevShadowConfig =
  | { status: "unconfigured" }
  | {
      status: "configured";
      brokerUrl: string;
      brokerSecret: string;
      perUserDailyCap: number;
      globalDailyCap: number;
    };

/**
 * A cap string that doesn't parse to a positive finite integer falls back to
 * the documented default rather than disabling the whole feature — a cap is
 * a safety ceiling, not a correctness precondition, so a misconfigured cap
 * must not silently break shadow mode entirely. Fractional values are
 * truncated rather than rejected (`"12.9"` -> `12`).
 */
function parseCap(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Missing or blank `PEER_JEV_BROKER_URL`/`PEER_JEV_BROKER_SECRET` ->
 * `"unconfigured"`: callers (route.ts, the shadow runner) must make no
 * reservation and no call in this case — this function itself never reads a
 * counter or opens a connection, it is a pure `process.env` read. Never
 * `NEXT_PUBLIC_` — `PEER_JEV_BROKER_SECRET` in particular must never reach
 * the browser bundle (ABC-JEV-INTEGRATION.md §0.7); the raw Jev API key
 * itself never lives anywhere in `web/` at all (§1p.H(3)) — only the
 * broker secret (this server's credential to ITS OWN Supabase Edge
 * Function) is read here.
 *
 * JEV-DIRECT (§1aa) note: this function's OWN caps fields stay exactly as
 * they were — still bundled inside the `"configured"` branch, still
 * requiring the broker URL+secret to be set. That is correct for a caller
 * that specifically wants the BROKER's config. A caller that just wants the
 * caps, regardless of transport, should use `readJevCaps()` below instead —
 * that is the one this item's direct path (and the transport-agnostic hook
 * input in `route.ts`) actually uses.
 */
export function readJevShadowConfig(): JevShadowConfig {
  const brokerUrl = process.env.PEER_JEV_BROKER_URL?.trim();
  const brokerSecret = process.env.PEER_JEV_BROKER_SECRET?.trim();
  if (!brokerUrl || !brokerSecret) return { status: "unconfigured" };
  return {
    status: "configured",
    brokerUrl,
    brokerSecret,
    perUserDailyCap: parseCap(process.env.PEER_JEV_PER_USER_DAILY_CAP, DEFAULT_JEV_PER_USER_DAILY_CAP),
    globalDailyCap: parseCap(process.env.PEER_JEV_GLOBAL_DAILY_CAP, DEFAULT_JEV_GLOBAL_DAILY_CAP),
  };
}

export interface JevCapsConfig {
  perUserDailyCap: number;
  globalDailyCap: number;
}

/**
 * JEV-DIRECT (§1aa point 2) — the Jev daily caps, readable regardless of
 * transport. `readJevShadowConfig()` above only exposes caps bundled inside
 * its `"configured"` branch, which requires the broker URL+secret to be
 * set — a direct-only deployment (key set in Vercel, broker URL/secret never
 * set) would then have no way to read the real caps at all, and the shadow
 * hook could never build. This reads the SAME two env vars with the SAME
 * `parseCap` fallback and the SAME defaults — generalizing WHO can reach the
 * caps, never what they are or how they are enforced (`reserveJevCall`'s
 * per-user-then-global order and fail-closed behaviour are untouched by this
 * item — ABC-JEV-INTEGRATION.md §1aa point 2: "stay exactly as they are").
 */
export function readJevCaps(): JevCapsConfig {
  return {
    perUserDailyCap: parseCap(process.env.PEER_JEV_PER_USER_DAILY_CAP, DEFAULT_JEV_PER_USER_DAILY_CAP),
    globalDailyCap: parseCap(process.env.PEER_JEV_GLOBAL_DAILY_CAP, DEFAULT_JEV_GLOBAL_DAILY_CAP),
  };
}

// ---------------------------------------------------------------------------
// JEV-DIRECT (§1aa) — the transport switch. Decides which of the two
// independently-gated paths (broker: `PEER_JEV_BROKER` + broker URL/secret;
// direct: `JEV_API_KEY`) a Jev call should use. `PEER_JEV_BROKER`'s existing
// meaning is untouched — it still only means "the broker path may be used at
// all"; this switch decides which of the two reachable paths wins.
// Design: docs/jev-abc/JEV-DIRECT-B-20260927T013846Z.md §3.
// ---------------------------------------------------------------------------

export type JevTransport = "direct" | "broker" | "disabled";

/** `"direct"`/`"broker"` (trimmed, case-insensitive) only — anything else (unset, blank, a typo) is "no override," never a crash and never a silent third meaning. */
function normalizedTransportOverride(): "direct" | "broker" | null {
  const raw = process.env.PEER_JEV_TRANSPORT?.trim().toLowerCase();
  return raw === "direct" || raw === "broker" ? raw : null;
}

function brokerReachable(): boolean {
  return jevBrokerEnabled() && readJevShadowConfig().status === "configured";
}

/**
 * Resolves from `process.env` only, once per call. Callers (`route.ts`
 * today) call this ONCE per request and thread the result down through
 * `ShadowRunnerOptions.transport`/`dispatchJevCall`'s options rather than
 * having a deeper layer (`shadow.ts`, `jev-dispatch.ts`) re-read the
 * environment itself — `shadow.ts`'s own module doc comment already commits
 * to "never reads `process.env` itself... resolved by `flag.ts` and handed
 * in by the caller," and this preserves that for the transport decision too
 * (see this item's checkpoint for why re-resolving internally would also
 * have broken `shadow.test.ts`'s existing broker-transport fixtures, which
 * set `PEER_JEV_BROKER="on"` and pass `brokerUrl`/`brokerSecret` as plain
 * options without ever setting the two broker env vars).
 *
 * No override -> `"direct"` when `JEV_API_KEY` is set (§1aa point 3's own
 * stated default), else `"broker"` when `PEER_JEV_BROKER` is `"on"` AND
 * `readJevShadowConfig()` reports `"configured"` (URL+secret both present),
 * else `"disabled"`.
 *
 * An explicit `PEER_JEV_TRANSPORT` override forces one of the two transports
 * but can never FABRICATE its prerequisite: overriding to `"direct"` with no
 * key is still `"disabled"`; overriding to `"broker"` with the broker
 * unconfigured is still `"disabled"`. This lets an operator force the
 * dormant broker path back on during an incident without having to unset
 * `JEV_API_KEY` in Vercel (ABC-JEV-INTEGRATION.md §1ab P3).
 */
export function resolveJevTransport(): JevTransport {
  const override = normalizedTransportOverride();
  if (override === "direct") {
    return jevDirectConfigured() ? "direct" : "disabled";
  }
  if (override === "broker") {
    return brokerReachable() ? "broker" : "disabled";
  }
  if (jevDirectConfigured()) return "direct";
  if (brokerReachable()) return "broker";
  return "disabled";
}

// ---------------------------------------------------------------------------
// P3-S6 — the bounded Gemini decision fallback's OWN flag + caps
// (ABC-JEV-INTEGRATION.md §4 "P3-S6 RULING", 2026-09-24T14:35:58Z;
// §1p.H(5)). Deliberately SEPARATE from `PEER_JEV_SHADOW`/`jevShadowEnabled`
// above: the main Jev shadow can run with the fallback still off (today's
// only reachable state in production — no provider capability exists yet
// either, see `gemini-fallback.ts`'s `mintGeminiFallbackProviderCapability`).
// ---------------------------------------------------------------------------

/**
 * BINDING (ABC-JEV-INTEGRATION.md §1p.H(5): "<=5 per run"; §4 "P3-S6
 * RULING": "<= 5 per shadow run") — a hard ceiling from the manager's
 * ruling itself, NOT a proposed default. Lives here, not inside
 * `gemini-fallback.ts`, so `shadow.ts`, this file's own tests, and any
 * future caller all import the exact same single source of truth — the same
 * relationship `MAX_SHADOW_CANDIDATES` (`shadow.ts`) has to the main run,
 * just located in the config file instead because this slice's binding
 * design explicitly asks for "caps and the <=5-per-run bound from flag.ts
 * config."
 */
export const MAX_GEMINI_FALLBACK_PER_RUN = 5;

/**
 * PROPOSED defaults, NOT sourced/verified against any vendor doc — unlike
 * `DEFAULT_JEV_PER_USER_DAILY_CAP`/`DEFAULT_JEV_GLOBAL_DAILY_CAP` above
 * (still Peer's own choice, but at least sized against Jev's VERIFIED
 * per-call economics, docs/jev-abc/P3-B-20260924T0525Z.md JEV CONTRACT),
 * docs/jev-abc/P3-B-20260924T0525Z.md POLICY question 5 left the exact
 * numbers open ("Recommend: yes, add a daily breaker too... a per-run-only
 * cap does not bound a user who reloads the feed many times a day" — no
 * number proposed). Deliberately smaller than the main Jev caps: the
 * fallback only ever fires on an already-narrow subset (a candidate with an
 * `unknown` dimension, itself already bounded to `MAX_GEMINI_FALLBACK_PER_RUN`
 * per run), so its own daily ceiling should be smaller too, proportionate to
 * that narrower blast radius. Manager/product must confirm before any live
 * rollout — see this slice's checkpoint REMAINING section.
 */
export const DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP = 10;
export const DEFAULT_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP = 200;

/** Literal `"on"` only — same convention as `jevShadowEnabled()`/`jevBrokerEnabled()`. Own env var, `PEER_JEV_GEMINI_FALLBACK`, never `PEER_JEV_SHADOW`. */
export function geminiFallbackEnabled(): boolean {
  return process.env.PEER_JEV_GEMINI_FALLBACK?.trim().toLowerCase() === "on";
}

export type GeminiFallbackFlagConfig =
  | { status: "disabled" }
  | { status: "enabled"; perUserDailyCap: number; globalDailyCap: number };

/**
 * Bundles the flag + cap-parsing, mirroring `readJevShadowConfig()`'s shape.
 * `shadow.ts` calls this once per run — the one place this slice reads
 * `PEER_JEV_GEMINI_FALLBACK`/its cap env vars; `gemini-fallback.ts`'s
 * `runDecisionFallback` itself takes the resolved caps as a plain data
 * parameter and never reads `process.env`.
 */
export function readGeminiFallbackConfig(): GeminiFallbackFlagConfig {
  if (!geminiFallbackEnabled()) return { status: "disabled" };
  return {
    status: "enabled",
    perUserDailyCap: parseCap(
      process.env.PEER_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP,
      DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP,
    ),
    globalDailyCap: parseCap(
      process.env.PEER_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP,
      DEFAULT_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP,
    ),
  };
}
