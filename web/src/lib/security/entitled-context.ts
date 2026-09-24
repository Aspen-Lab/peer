import type { Entitlement } from "@/lib/entitlement/types";

/**
 * ABC-freemium 3-02 · R-SEC-2 · Ruling 7 point 3 · Ruling 9 point 5 — **the
 * chokepoint's guard becomes a compile error instead of a grep.**
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────
 *
 * Every route that can spend the operator's money already carries the
 * entitlement check, and round-3 A drove all nine and measured reachability at
 * **nil**. So nothing was wrong. What was missing is that nothing *stopped* it
 * going wrong: `resolveProvider(override?, ctx?)` had both parameters optional
 * and every field of `ctx` optional, so a new caller that simply forgot the
 * context compiled, ran, and spent — and the only thing standing between that
 * and a bill was a **regex** (`spend-scans.test.ts` scan 4), which bans the
 * zero-argument form and nothing else. Two production callers already passed no
 * context at all and scan 4 read 0, correctly, because it was never looking for
 * them. That is the difference between "correct" and "cannot be made incorrect
 * by accident", and it is the whole of this item.
 *
 * ── HOW THE BRAND WORKS ──────────────────────────────────────────────────────
 *
 * `entitledBrand` is a module-private `unique symbol` that is **never
 * exported**. A value of type `EntitledContext` therefore cannot be written
 * down outside this file — not by getting every visible field right, not by
 * inventing a symbol of your own. The only ways to obtain one are
 * `entitledContext()`, which takes a real `Entitlement` (and the only honest
 * source of one is `requireEntitledAiRequest`), and the loudly-named test
 * escape hatch at the bottom.
 *
 * The type carries no secret. It is a **claim about provenance**: "an
 * entitlement check ran above me and this is what it decided."
 *
 * ── WHAT IT DOES NOT DO, MEASURED RATHER THAN ASSUMED ────────────────────────
 *
 * Round-3 B attacked this design in a throwaway harness on this repo's own
 * compiler before it was recommended. Three attacks still compile, and pretending
 * otherwise would be worse than the hole:
 *
 *  1. **Spread-and-tamper** — `{ ...real, userId: "someone-else" }` compiles. A
 *     brand proves provenance, not that the fields were not edited afterwards.
 *     The meters would attribute to the wrong user; it cannot create spend that
 *     was not already authorised.
 *  2. **An explicit `as EntitledContext` cast** compiles, as it does for every
 *     branded type in every TypeScript codebase. The win is that it is now
 *     **greppable** — a reviewer can find every place provenance was asserted
 *     rather than proved. Scan 6 below looks for it.
 *  3. **A helper declaring `ctx?: EntitledContext`** compiles and re-opens the
 *     hole exactly as it stood before this item. This is the one real
 *     regression risk, so `spend-scans.test.ts` scan 6 bans the optional shape
 *     outright; without that scan this module buys nothing a year from now.
 *
 * ── WHY A STANDALONE MODULE ──────────────────────────────────────────────────
 *
 * Not an addition to `ai-request.ts`: that file imports `@/lib/supabase/server`,
 * and `registry.ts` imports nothing from `lib/security` today. Keeping the brand
 * in its own module keeps Supabase out of the provider registry's import graph.
 * The shape deliberately mirrors `@/lib/figures/match-context`, which is the
 * precedent Ruling 7 point 3 names and which already carries the same written
 * rationale for being required rather than optional.
 */
declare const entitledBrand: unique symbol;

/**
 * Whose entitled request a provider acquisition is running for.
 *
 * The three fields are the ones `resolveProvider` has always read; what is new
 * is that they arrive **branded**, so they cannot have come from anywhere but
 * an entitlement check.
 */
export type EntitledContext = {
  /** From the entitlement resolved by `requireEntitledAiRequest`. */
  readonly userId: string | null;
  /** True when the call runs on the reader's own key (D2a's only search path). */
  readonly byok: boolean;
  /** The route or helper doing the spending, for the usage row. */
  readonly path: string;
} & { readonly [entitledBrand]: true };

/**
 * Mint a context from an entitlement an AI route has already resolved.
 *
 * `Entitlement` is the argument rather than a loose `userId` **on purpose**: the
 * only supported way to hold one is to have called `requireEntitledAiRequest`
 * (or `resolveEntitlement`, which it wraps), so the type of the parameter is
 * itself part of the claim. A caller with a bare string cannot reach this.
 */
export function entitledContext(
  entitlement: Entitlement,
  path: string,
  byok: boolean,
): EntitledContext {
  return {
    userId: entitlement.userId,
    byok,
    path,
  } as EntitledContext;
}

/**
 * ABC-freemium 3-02 — **the one named escape hatch, and it is named to be
 * greppable.**
 *
 * `registry.test.ts` invokes `resolveProvider` nine times to test the resolution
 * order itself; the persona and route suites mock it. None of them have an
 * `Entitlement` to hand, and building one would make those tests assert the
 * entitlement layer rather than the thing under test. So there is exactly one
 * way in from a test, it says `unsafe` in its own name, and any production use
 * of it is a one-word grep away.
 *
 * **Not for production code.** `spend-scans.test.ts` scan 6 fails the build if
 * this identifier appears outside a test file.
 */
export function unsafeEntitledContextForTests(
  fields: Partial<Omit<EntitledContext, typeof entitledBrand>> = {},
): EntitledContext {
  return {
    userId: fields.userId ?? null,
    byok: fields.byok ?? false,
    path: fields.path ?? "test",
  } as EntitledContext;
}

/**
 * ABC-freemium 3-02 · Ruling 9 point 5 — **the two pool-build closures, handled
 * without a signature cascade.**
 *
 * `applyTier2Rerank` and `generateSearchQueries` acquire a provider from inside
 * a pool build, where no entitled request is in scope at all. They are safe
 * today, and round-3 B measured *why* rather than assuming it: both sit behind a
 * **numeric tier ceiling** — `requestedTier >= 2` with every default `0`,
 * R-GUARD-1 covering `PEER_FEED_AI_TIER` on Vercel, and R-SEC-3 stopping a
 * request body raising the tier. So the guard on those two paths is real; it is
 * just a *different* guard, and that is the finding: the tree has two
 * enforcement mechanisms for one property and only one of them was visible at
 * the chokepoint.
 *
 * Threading a branded context through the pool builders to reach them would
 * widen request types and pipeline signatures and reach the digest cron — past
 * the boundary Ruling 7 point 3 draws. So the second parameter of
 * `resolveProvider` is **required but a union**: either a real entitled context,
 * or a written justification naming which other guard is doing the work and
 * where. The justification is a module-local object literal, so **no request
 * type widens, no pipeline signature changes, and the cron is untouched.**
 *
 * The `kind` is a closed union: inventing a new reason is a compile error, which
 * is the point. A reviewer can argue with a written claim; they cannot argue
 * with an absence.
 */
export type SpendJustification =
  | {
      /**
       * Reached only above a numeric AI-tier ceiling whose default is 0, so an
       * unentitled request cannot arrive here at all.
       */
      readonly kind: "entitlement-proved-by-tier-ceiling";
      /** Where the ceiling is enforced, so a reviewer can check it. */
      readonly where: string;
    }
  | {
      /**
       * Runs only on the reader's own key and can never be operator-funded.
       */
      readonly kind: "byok-only-never-operator-funded";
      readonly where: string;
    };

/**
 * What `resolveProvider` accepts: proof, or a named reason there is none.
 *
 * **Required, never optional.** An optional parameter here is precisely the
 * hole this item closes, which is why scan 6 bans `?: EntitledContext` and
 * `?: ProviderContext` in the same breath.
 */
export type ProviderContext = EntitledContext | SpendJustification;

/** Narrow a `ProviderContext` to the branded half. */
export function isEntitledContext(ctx: ProviderContext): ctx is EntitledContext {
  return !("kind" in ctx);
}
