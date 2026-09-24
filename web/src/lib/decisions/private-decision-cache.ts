/**
 * Owner-scoped, Supabase-backed decision cache. Mirrors
 * `opportunities/private-paper-cache.ts`'s `PrivatePaperPoolCache` exactly in
 * shape and fail-soft behavior (docs/jev-abc/P3-B-20260924T0525Z.md DESIGN
 * §4 / F-A-P3-03): any Supabase outage or misconfiguration degrades a read
 * to a miss and a write to a silent no-op — a private-cache outage must fall
 * through to "call Jev fresh" (or "no decision this run" if Jev is also
 * unreachable), never throw into a caller deciding whether to call Jev.
 *
 * DESIGN CHOICE (docs/jev-abc/P3-S3S4-C-*.md): unlike `PrivatePaperPoolCache`,
 * this class takes a plain `ownerId: string` rather than a capability-minting
 * wrapper (`TrustedPaperCacheScope`). `deriveDecisionCacheKey`
 * (decision-cache.ts) already takes `ownerId` as an explicit, required,
 * hashed component, so the same protection against accidental owner-mixing
 * already exists at the key-derivation call site; a second wrapper type is
 * not needed and is not in this slice's allowed-file list. The `owner_id`
 * column below is still an independent, non-hashed filter on every read and
 * write — belt AND suspenders, not a replacement for either.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { DecisionCache } from "./decision-cache";
import type { DecisionResult } from "./types";

interface PrivateDecisionSelectResult {
  data: { payload: unknown } | null;
  error: unknown;
}

interface PrivateDecisionClient {
  from(table: "private_decisions"): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): Promise<PrivateDecisionSelectResult> };
      };
    };
    upsert(
      row: { owner_id: string; scope_key: string; payload: DecisionResult; created_at: string },
      options: { onConflict: string },
    ): Promise<{ error: unknown }>;
  };
}

function configuredPrivateDecisionClient(): PrivateDecisionClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    return createAdminClient() as unknown as PrivateDecisionClient;
  } catch {
    return null;
  }
}

/** Never trusts a stored payload's shape blindly — a differently-shaped row (e.g. from a future schema change) is treated as a miss, not a crash. */
function isDecisionResultShaped(value: unknown): value is DecisionResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { paperId?: unknown; answers?: unknown; modelId?: unknown; usage?: unknown };
  return (
    typeof candidate.paperId === "string" &&
    Array.isArray(candidate.answers) &&
    typeof candidate.modelId === "string" &&
    (candidate.usage === null || typeof candidate.usage === "object")
  );
}

/** Server-only adapter for owner-qualified private decision-cache entries. */
export class PrivateDecisionCache implements DecisionCache {
  private readonly client: PrivateDecisionClient | null;

  constructor(private readonly ownerId: string, client = configuredPrivateDecisionClient()) {
    this.client = client;
  }

  async get(key: string): Promise<DecisionResult | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client
        .from("private_decisions")
        .select("payload")
        .eq("owner_id", this.ownerId)
        .eq("scope_key", key)
        .maybeSingle();
      const payload = data?.payload;
      if (error || !isDecisionResultShaped(payload)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async set(key: string, result: DecisionResult): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from("private_decisions").upsert(
        {
          owner_id: this.ownerId,
          scope_key: key,
          payload: result,
          created_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,scope_key" },
      );
    } catch {
      // A private-cache outage falls through to a request-local fresh Jev call.
    }
  }
}
