import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CachedPaperPool, PoolCache } from "./pool-cache";
import { PAPER_POOL_KEY_PREFIX } from "./pool-cache";
import { serializeFeedIntent, type NormalizedFeedIntent } from "@/lib/feed/intent";

/**
 * A capability created on the server after authenticating its owner.  The
 * WeakSet makes plain request-shaped objects (including body/query values)
 * invalid at runtime: only this module can mint a usable scope for a process.
 */
export interface TrustedPaperCacheScope {
  readonly ownerId: string;
  readonly identity: string;
}

export interface PaperCacheScopeInput {
  ownerId: string;
  project?: string;
  challenge?: string;
  topics?: readonly string[];
  softTopics?: readonly string[];
  methods?: readonly string[];
  seedTexts?: readonly string[];
  exclusions?: readonly string[];
  controls?: unknown;
  intent?: NormalizedFeedIntent;
  aiTier: 0 | 1 | 2;
  policyVersion?: string;
}

const trustedScopes = new WeakSet<object>();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value]
      .map((item) => canonical(item))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return typeof value === "string" ? value.trim() : value;
}

export function createTrustedPaperCacheScope(
  input: PaperCacheScopeInput,
): TrustedPaperCacheScope {
  const ownerId = input.ownerId.trim();
  if (!ownerId) throw new Error("A trusted paper cache scope requires an owner");
  const identity = createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          project: input.project,
          challenge: input.challenge,
          topics: input.topics,
          softTopics: input.softTopics,
          methods: input.methods,
          seedTexts: input.seedTexts,
          exclusions: input.exclusions,
          controls: input.controls,
          intent: input.intent ? serializeFeedIntent(input.intent) : undefined,
          aiTier: input.aiTier,
          policyVersion: input.policyVersion ?? "paper-private-v1",
        }),
      ),
    )
    .digest("hex");
  const scope = Object.freeze({ ownerId, identity });
  trustedScopes.add(scope);
  return scope;
}

export function isTrustedPaperCacheScope(
  value: unknown,
): value is TrustedPaperCacheScope {
  return typeof value === "object" && value !== null && trustedScopes.has(value);
}

export const ephemeralPaperPoolCache: PoolCache = {
  async get() {
    return null;
  },
  async set() {
    // Deliberately no-op: an unauthenticated or unscoped paper request must
    // never turn into a durable personal-membership cache entry.
  },
};

interface PrivatePoolResult {
  data: { payload: unknown } | null;
  error: unknown;
}

interface PrivatePoolClient {
  from(table: "private_paper_pools"): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): Promise<PrivatePoolResult> };
      };
    };
    upsert(
      row: { owner_id: string; scope_key: string; payload: CachedPaperPool; created_at: string },
      options: { onConflict: string },
    ): Promise<{ error: unknown }>;
  };
}

function configuredPrivatePoolClient(): PrivatePoolClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    return createAdminClient() as unknown as PrivatePoolClient;
  } catch {
    return null;
  }
}

/** Server-only adapter for owner-qualified private paper membership/reasons. */
export class PrivatePaperPoolCache implements PoolCache {
  private readonly client: PrivatePoolClient | null;

  constructor(private readonly scope: TrustedPaperCacheScope, client = configuredPrivatePoolClient()) {
    this.client = client;
  }

  async get(key: string): Promise<CachedPaperPool | null> {
    if (!this.client || !key.startsWith(PAPER_POOL_KEY_PREFIX)) return null;
    try {
      const { data, error } = await this.client
        .from("private_paper_pools")
        .select("payload")
        .eq("owner_id", this.scope.ownerId)
        .eq("scope_key", key)
        .maybeSingle();
      const payload = data?.payload;
      if (
        error ||
        !payload ||
        typeof payload !== "object" ||
        (payload as { surface?: unknown }).surface !== "papers"
      ) {
        return null;
      }
      return payload as CachedPaperPool;
    } catch {
      return null;
    }
  }

  async set(key: string, pool: CachedPaperPool): Promise<void> {
    if (!this.client || !key.startsWith(PAPER_POOL_KEY_PREFIX)) return;
    try {
      await this.client.from("private_paper_pools").upsert(
        {
          owner_id: this.scope.ownerId,
          scope_key: key,
          payload: pool,
          created_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,scope_key" },
      );
    } catch {
      // A private-cache outage falls through to a request-local fresh build.
    }
  }
}
