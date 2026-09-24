import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { Entitlement } from "@/lib/entitlement/types";

/**
 * Whose request a figure matcher is running for.
 *
 * ABC-freemium 1-07 · R-SEC-1. The two matchers used to call
 * `resolveProvider()` with no arguments — they were the only two no-argument
 * acquisitions in the tree, reached from `GET /api/figure`, which had no
 * authentication of any kind. R-SEC-1 requires them to "never resolve a server
 * provider without an authenticated request context passed in explicitly", so
 * this type is a **required** argument on both.
 *
 * Required, not optional, on purpose: an optional context would make A's scan-4
 * count zero today and non-zero the first time someone adds a caller who forgets
 * it. A new caller now has to state whose request this is before it compiles.
 *
 * ── ABC-freemium 3-02 · R-SEC-2 · Ruling 7 point 3 ──────────────────────────
 *
 * **It now carries the `Entitlement` rather than a copied `userId`.** 1-07 made
 * the context required, which stopped a caller *forgetting* it; it did not stop
 * a caller **inventing** one. `{ userId: null, byok: false }` satisfied the old
 * shape and compiled, so the figure chain could acquire a provider on a hand-made
 * context that no entitlement check had ever seen. An `Entitlement` can only come
 * from `requireEntitledAiRequest` / `resolveEntitlement`, so carrying it is what
 * turns "somebody remembered to pass something" into "a check ran".
 *
 * The entitlement is held rather than a pre-minted `EntitledContext` because the
 * two matchers meter under **different paths** (`figure:semantic`,
 * `figure:vision`), so each mints its own.
 */
export interface FigureMatchContext {
  /**
   * The resolved entitlement from the route's single check. Its `userId` is
   * from `supabase.auth.getUser()` only.
   */
  entitlement: Entitlement;
  /** True when the call runs on the reader's own key. */
  byok: boolean;
  /** The reader's BYOK override, when they supplied one. */
  override?: ProviderOverrideConfig | null;
}
