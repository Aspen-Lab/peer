/**
 * `meterProvider` — wrap a provider so every call it makes is recorded.
 *
 * ABC-freemium 1-03 · R-METER-1.
 *
 * Applied at `resolveProvider`'s single return point, which is the only place a
 * provider is ever obtained (checked: no module outside `lib/llm/providers/`
 * constructs one). That is why R-METER-1 asks for a wrapper rather than a user
 * id threaded through thirteen call sites.
 *
 * **The three things it must not break**, each an assertion in `metered.test.ts`:
 *
 *  1. **Method presence is copied, never assumed.** `generateJsonText` and
 *     `generateVisionJsonText` are optional on `DigestProvider`, and eleven call
 *     sites decide whether to degrade by testing for them —
 *     `provider?.generateJsonText` is what makes `digest`, the three report
 *     routes and `papers/report` return their no-LLM payload. DeepSeek
 *     deliberately has no `generateVisionJsonText`. A wrapper that defined both
 *     unconditionally would turn "degrade cleanly" into "call a method the
 *     provider cannot serve".
 *  2. **`id` survives.** It is part of the `DigestProvider` contract and is
 *     asserted in the registry and route tests.
 *  3. **A throw still throws.** Every existing catch/degrade path depends on it.
 *
 * **One row per PROVIDER REQUEST — never two, never zero** (ABC-freemium 2-05 ·
 * Ruling 6 point 5, which amends Ruling 5 point 6 rather than reversing it).
 *
 * A "call" for billing purposes is one HTTP request to a model. The providers
 * already call `logLlmUsage` on both success and failure, and that is where the
 * token counts are, so the provider stays the writer whenever it logged. The
 * wrapper is the **backstop**: it writes exactly one row when the provider
 * wrote none, on either exit.
 *
 * Two consequences worth stating rather than leaving to be rediscovered:
 *
 *  - **"Never two" means never two rows for one provider request.** Both Gemini
 *    providers loop over a model fallback chain and log per attempt, so one
 *    `generateJsonText` that falls back from model A to model B writes two rows.
 *    That is correct: two requests were billed. It is the ledger doing its job.
 *  - **"Never zero" was a real hole and is now closed by construction.** The
 *    check used to sit in a `catch`, so a provider that returned successfully
 *    without logging was silently unmetered.
 *
 * `resolveProvider` stays **synchronous**: this is pure object construction and
 * the recording inside `logLlmUsage` is fire-and-forget, so nothing becomes
 * async and none of the eleven un-awaited call sites change.
 *
 * ── SPEND-CAP — the reservation hook (ABC-JEV-INTEGRATION.md §1v R9) ────────
 *
 * For a non-BYOK call, and only when `PEER_COMPANY_SPEND_CAP` is `"on"`,
 * `meterCall` reserves an estimated worst-case cost BEFORE `fn.apply` and
 * settles it once, in `finally`, after every chain attempt inside `fn` has
 * finished (see `usage/company-budget.ts`'s header for the full design and
 * why settlement cannot live inside `logLlmUsage` itself). Default OFF is
 * exactly today's code path: the `if` below is never entered, so there is no
 * config read and no counter call at all — a protective test in
 * `metered.test.ts` asserts this directly.
 */
import { recordUsageEvent, recordUsageEventAwaited } from "@/lib/usage/events";
import {
  withUsageContext,
  type UsageCallScope,
  type UsageContext,
} from "@/lib/usage/context";
import {
  companySpendCapEnabled,
  reserveCompanySpendForCall,
  settleCompanySpend,
  CompanySpendCapRefusedError,
  type CompanyBudgetCallShape,
} from "@/lib/usage/company-budget";
import type { ModelTier } from "./types";
import type { DigestProvider } from "./types";

/**
 * Builds the estimator's call shape from the exact arguments a call site
 * passed, keyed off `fallbackPath` (`meterProvider`'s own per-method literal:
 * `"digest"`, `"json"`, `"vision"`, or `"test-connection"`) — measured from
 * the real, already-built prompt, never a second hand-maintained ceiling.
 */
function companyBudgetShapeFor(fallbackPath: string, args: unknown[]): CompanyBudgetCallShape {
  const opts = (args[0] ?? {}) as Record<string, unknown>;
  switch (fallbackPath) {
    case "digest":
      return { method: "digest", papers: opts.papers, contextHint: opts.contextHint };
    case "json":
      return {
        method: "json",
        systemPrompt: typeof opts.systemPrompt === "string" ? opts.systemPrompt : "",
        userPrompt: typeof opts.userPrompt === "string" ? opts.userPrompt : "",
        maxTokens: typeof opts.maxTokens === "number" ? opts.maxTokens : undefined,
        tier: opts.tier as ModelTier | undefined,
      };
    case "vision":
      return {
        method: "vision",
        systemPrompt: typeof opts.systemPrompt === "string" ? opts.systemPrompt : "",
        userPrompt: typeof opts.userPrompt === "string" ? opts.userPrompt : "",
        maxTokens: typeof opts.maxTokens === "number" ? opts.maxTokens : undefined,
        tier: opts.tier as ModelTier | undefined,
        imageCount: Array.isArray(opts.images) ? opts.images.length : 0,
      };
    default:
      return { method: "test-connection" };
  }
}

function meterCall<A extends unknown[], R>(
  provider: DigestProvider,
  ctx: UsageContext,
  fallbackPath: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const scope: UsageCallScope = { ...ctx, recorded: false };

    // SPEND-CAP · R9 — default OFF short-circuits this whole block: no config
    // read, no counter call, `scope.companyReservation` stays undefined.
    if (!ctx.byok && companySpendCapEnabled()) {
      const shape = companyBudgetShapeFor(fallbackPath, args);
      const reservation = await reserveCompanySpendForCall(shape, provider.id, ctx.userId, new Date());
      if (!reservation.ok) {
        // §2.7 — the audit trail for a spend cap, awaited like every other
        // breaker row in this codebase (`deep-report-quota.ts`,
        // `rebuild-breaker.ts`): losing it to a cold shutdown would leave a
        // trip with no record. Reuses the existing free-text `path` field
        // rather than a new column.
        await recordUsageEventAwaited({
          user_id: ctx.userId,
          kind: "breaker",
          path: `company-spend:${reservation.reason}`,
          ok: false,
          byok: ctx.byok,
        });
        throw new CompanySpendCapRefusedError(reservation.reason);
      }
      scope.companyReservation = reservation.reservation;
    }

    const started = Date.now();
    let ok = false;
    try {
      const result = await withUsageContext(scope, () =>
        fn.apply(provider, args),
      );
      ok = true;
      return result;
    } finally {
      // ABC-freemium 2-05 · R-METER-1 · Ruling 5 point 6 — AT LEAST ONE ROW PER
      // CALL, on BOTH exits.
      //
      // This block used to live in a `catch`, so it only ever fired on a throw.
      // A provider that returned successfully **without** calling `logLlmUsage`
      // was silently unmetered, and nothing in the type system or the tests
      // would have said so. All five registered providers log today, so the
      // hole is latent rather than live — but "every provider remembers" is not
      // a property a wrapper should rely on, and a sixth provider is exactly
      // when it would be forgotten.
      //
      // `scope.recorded` still suppresses this whenever the provider wrote its
      // own row, so this adds no duplicate — it only covers the provider that
      // logged nothing at all. The provider stays the preferred writer because
      // it is the only place that HAS the token counts: they come out of each
      // SDK's own response object at the point of the call, and the wrapper
      // sees only the method's return value (a bare `string` for
      // `generateJsonText`).
      //
      // `finally` does not swallow, so point 3 of the header — a throw still
      // throws — is unchanged, and `metered.test.ts`'s re-throw case is the net
      // under that.
      if (!scope.recorded) {
        recordUsageEvent({
          user_id: ctx.userId,
          kind: "llm",
          path: ctx.path ?? fallbackPath,
          provider: provider.id,
          model: null,
          latency_ms: Date.now() - started,
          ok,
          byok: ctx.byok,
        });
      }

      // SPEND-CAP · R10 — settle EXACTLY ONCE per call, after every chain
      // attempt inside `fn` has already accumulated its actual cost onto
      // `scope.companyReservation.settlement` (from `logLlmUsage`). Never
      // awaited: a slow settlement write must not add latency to a request
      // that already has its answer, matching `recordUsageEvent`'s own
      // fire-and-forget contract one block above.
      if (scope.companyReservation) {
        void settleCompanySpend(scope.companyReservation, new Date());
      }
    }
  };
}

export function meterProvider(
  provider: DigestProvider,
  ctx: UsageContext,
): DigestProvider {
  const metered: DigestProvider = {
    id: provider.id,
    generateDigest: meterCall(
      provider,
      ctx,
      "digest",
      provider.generateDigest,
    ),
    testConnection: meterCall(
      provider,
      ctx,
      "test-connection",
      provider.testConnection,
    ),
  };

  // P3-02c: a capability flag is copied the same way — present only when the
  // wrapped provider has it. The route reads it to decide whether a turn searched
  // (and so what it costs); a wrapper that rebuilt the object without it would
  // turn every Gemini provider into one that "cannot search".
  if (provider.supportsWebSearch === true) {
    metered.supportsWebSearch = true;
  }

  // Point 1 above: define these only when the wrapped provider has them.
  if (typeof provider.generateJsonText === "function") {
    metered.generateJsonText = meterCall(
      provider,
      ctx,
      "json",
      provider.generateJsonText,
    );
  }
  if (typeof provider.generateVisionJsonText === "function") {
    metered.generateVisionJsonText = meterCall(
      provider,
      ctx,
      "vision",
      provider.generateVisionJsonText,
    );
  }

  return metered;
}
