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
 */
import { recordUsageEvent } from "@/lib/usage/events";
import {
  withUsageContext,
  type UsageCallScope,
  type UsageContext,
} from "@/lib/usage/context";
import type { DigestProvider } from "./types";

function meterCall<A extends unknown[], R>(
  provider: DigestProvider,
  ctx: UsageContext,
  fallbackPath: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const scope: UsageCallScope = { ...ctx, recorded: false };
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
