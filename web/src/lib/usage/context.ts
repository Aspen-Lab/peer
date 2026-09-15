/**
 * Who a model call is being made for.
 *
 * ABC-freemium 1-03 · R-METER-1.
 *
 * The problem this solves: the providers already report the only facts worth
 * recording about a call — model, token counts, latency, ok — and they report
 * them from deep inside their own request handling, where no user id exists.
 * R-METER-1 says explicitly not to thread a user id through the thirteen places
 * that acquire a provider. So the metering wrapper puts the request's identity
 * into an async-local scope around each call, and `logLlmUsage` reads it back
 * out at the moment it already has the numbers.
 *
 * **`AsyncLocalStorage`, not a module variable.** A module-scope "current user"
 * would be read by whichever request happened to be running when the callback
 * resumed, so two concurrent feed loads would attribute each other's spend.
 * That is the kind of wrong value this round exists to remove. All callers are
 * server-side (checked: no client component imports the provider registry), so
 * `node:async_hooks` is available.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface UsageContext {
  /** From `supabase.auth.getUser()` only. Null for a library-level call. */
  userId: string | null;
  /** True when the call runs on the user's own key, so it costs the operator nothing. */
  byok: boolean;
  /** Logical call site, used only when the provider does not report a finer one. */
  path?: string;
}

/**
 * One call's scope. `recorded` is flipped by `logLlmUsage` so the wrapper knows
 * whether a row already exists for this call and does not write a second one —
 * R-METER-1 asks for **one** row per call, and every provider already logs both
 * its success and its failure.
 */
export interface UsageCallScope extends UsageContext {
  recorded: boolean;
}

const storage = new AsyncLocalStorage<UsageCallScope>();

export function withUsageContext<T>(scope: UsageCallScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function currentUsageContext(): UsageCallScope | undefined {
  return storage.getStore();
}
