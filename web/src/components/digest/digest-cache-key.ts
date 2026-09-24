import type { AiMode } from "@/lib/feed/ai-tier";

/**
 * The browser-side cache key for the daily digest.
 *
 * ABC-freemium 1-11 · R-UI-4.
 *
 * **What the risk here actually is, because the obvious reading is wrong.** The
 * digest only writes when `json.bullets?.length && !json.noLlm`, so a no-AI
 * digest is **never** cached and the stale-tier-0 poisoning cannot happen on
 * this surface. What can happen is the reverse: a digest written with **Peer's**
 * model served for twelve hours after the reader's entitlement changed, and one
 * browser profile's entry colliding across plans. The discriminator is required
 * either way; the reason is the opposite one.
 *
 * The `"tier0"` literal it replaces was also the last vocabulary R-UI-1 objects
 * to on this path — a cache string rather than a rendered one, so A correctly
 * did not count it, but there is no reason to keep it.
 *
 * The storage version is bumped in the same commit so pre-existing entries are
 * not simply re-read under their old keys.
 */
export const DIGEST_CACHE_STORAGE_KEY = "peer-digest-cache-v2";

export function digestCacheKey(input: {
  /** Sorted, joined paper ids — order-insensitive by construction upstream. */
  paperIds: string;
  contextLength: number;
  /** `simpleHash` returns a base-36 string, not a number. */
  contextHash: string;
  /** The reader's own provider id, when they supplied one. */
  overrideProvider?: string;
  aiMode: AiMode;
}): string {
  return `${input.paperIds}::${input.contextLength}:${input.contextHash}::${
    input.overrideProvider ?? input.aiMode
  }`;
}
