import type { SourceAdapter, SourceQuery, RawItem } from "./types";
import {
  isOperatorFundedSearch,
  operatorSearchAvailability,
  resolveSystemSearchKeys,
} from "@/lib/search/system-key";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import { recordUsageEvent } from "@/lib/usage/events";
import { consumeForcedRebuild } from "@/lib/usage/rebuild-breaker";
import {
  geminiSearchDeadline,
  resolveWebSearchProvider,
  searchGemini,
} from "./gemini-search";
import { searchVertex } from "./vertex-search";

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  profile?: {
    name?: string;
  };
}

interface BraveResponse {
  web?: {
    results?: BraveResult[];
  };
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

async function fetchImpl(query: SourceQuery): Promise<RawItem[]> {
  const searchQueries = buildSearchQueries(query);
  if (searchQueries.length === 0) return [];

  const limit = query.limit ?? 20;
  // ABC-freemium 1-05 · R-KEY-3 · D3 — this used to be
  // "the request key, or else the operator's environment key", unconditionally.
  //
  // **On this surface the flag is always `false`, and gating alone is not the
  // whole fix.** A user's own Tavily key cannot reach here at all:
  // `feed/pipeline.ts` builds the papers web options with
  // `webSearchOptions(req.searchConnectors)`, which returns only `{ provider }`
  // and never a `tavilyApiKey`, and `store/feed.ts` sends no `searchConnectors`
  // for papers by design. So the only Tavily key this line could ever have
  // reached was the operator's — for every plan, including paid. D3 says the
  // papers surface costs zero paid search, which makes its
  // `systemSearchAllowed` permanently false. That is D3 implemented, not
  // reversed.
  const keys = resolveSystemSearchKeys({
    requestTavilyKey: query.webSearch?.tavilyApiKey,
    systemSearchAllowed: query.webSearch?.systemSearchAllowed === true,
  });
  const braveKey = keys.brave;
  const requestTavilyKey = query.webSearch?.tavilyApiKey?.trim();
  const tavilyKey = keys.tavily;
  // ABC-freemium 2-04 · Ruling 6 point 3 — THE PAPERS SURFACE SPENDS NOTHING ON
  // ANY OPERATOR KEY, IN ANY RUNTIME.
  //
  // This early return used to call `isGeminiSearchAvailable()` and
  // `isVertexSearchAvailable()` **directly from the environment**, so the hard
  // `systemSearchAllowed: false` that `feed/pipeline.ts` passes was permanent
  // only for Tavily. Brave came from an ungated env read, and these two walked
  // straight past the flag — meaning that on a self-host or a developer machine
  // with any of those three names set, this source ran operator-funded search
  // for an anonymous caller, with no gate, no breaker and no usage row.
  //
  // Ruling 6 point 3 accepted the consequence explicitly: the papers `web`
  // source now returns `[]` in local development too, not only in production.
  // Rulings 75 and 79c of the report-parity loop, which kept it alive locally
  // through grounding, are **superseded for this surface** by D3 and Ruling 3
  // point 5. The gate stays one predicate with no runtime test inside a spend
  // path, which is the shape 1-06 and R-ENT-5 spent a round removing.
  const availability = operatorSearchAvailability({
    systemSearchAllowed: query.webSearch?.systemSearchAllowed === true,
  });
  if (
    !braveKey &&
    !tavilyKey &&
    !availability.geminiAvailable &&
    !availability.vertexAvailable
  ) {
    return [];
  }

  const perQuery = Math.max(3, Math.ceil(Math.min(limit, 20) / searchQueries.length));
  const all: RawItem[] = [];
  const provider = resolveProvider(query, availability, {
    braveKeyPresent: Boolean(braveKey),
    tavilyKeyPresent: Boolean(tavilyKey),
    requestTavilyKeyPresent: Boolean(requestTavilyKey),
  });
  if (!provider) return [];

  // ABC-freemium 2-04 — the breaker and the R-METER-2 row, which this file had
  // NEITHER of before (grepped: no `consumeForcedRebuild`, no
  // `recordUsageEvent` anywhere in it). Under Ruling 6 point 3 the gate above
  // makes `operatorFunded` unreachable today, and that is exactly why it is
  // here: **if this surface is ever un-gated, it is metered from the first
  // request rather than from the round after someone notices.** A gate without
  // metering behind it is how the same defect comes back wearing a new name.
  //
  // **ABC-freemium 6-01 · Ruling 14 point 3 — THIS CALL SITE IS UNREACHABLE,
  // and it is KEPT on purpose (Ruling 12 point 2).** The chain, end to end:
  // `systemSearchAllowed` is a hard `false` on every producer (D2a), so
  // `resolveSystemSearchKeys` returns no Brave key and Tavily can only be
  // `"byok"` or `"none"`; `operatorSearchAvailability` is frozen false for
  // both providers; so the only provider selectable here is Tavily with
  // `provenance: "byok"`, and `isOperatorFundedSearch` answers `false` for
  // exactly that pair. `operatorFunded` is therefore never `true` and the
  // breaker below never runs. Deleting it would remove the metering that has
  // to exist BEFORE the gate is ever reopened, not the round after.
  //
  // **If operator-funded search is restored, this counter must be SPLIT — do
  // not just flip the flag.** These sites are dead because no operator-funded
  // provider can be *selected*, not because anything refuses them:
  // `isOperatorFundedSearch` still returns `true` for Brave, Vertex and
  // Gemini. Reopening the gate would start charging **search fan-outs** to a
  // counter named `forced_rebuilds_today`, which re-creates the exact
  // false-audit defect 6-01 exists to fix, in reverse.
  const operatorFunded = isOperatorFundedSearch(provider, keys);
  if (operatorFunded) {
    const allowed = await consumeForcedRebuild(
      query.webSearch?.userId ?? null,
      searchQueries.length,
      undefined,
      "papers",
    );
    // The same degraded value a keyless reader already gets: the paper
    // pipeline serves its other sources. No error, no new shape.
    if (!allowed) return [];
  }
  const deadlineAt = geminiSearchDeadline();

  // Fan the per-query fetches out concurrently (like the other source
  // adapters) instead of awaiting them one at a time. Promise.allSettled
  // preserves input order and isolates a single slow/failed query, so the
  // whole source no longer blocks on the slowest one — and one query timing
  // out no longer drops the rest.
  const settled = await Promise.allSettled(
    searchQueries.map((searchQuery) => {
      const paperQuery = `${searchQuery} paper OR preprint OR arxiv`;
      if (provider === "vertex") return fetchVertex(paperQuery, limit, deadlineAt, query.webSearch);
      if (provider === "gemini") return fetchGemini(paperQuery, limit, deadlineAt, query.webSearch);
      return provider === "brave"
        ? fetchBrave(paperQuery, perQuery, braveKey!)
        : fetchTavily(paperQuery, perQuery, tavilyKey, query.webSearch);
    }),
  );
  for (const result of settled) {
    if (result.status === "fulfilled") all.push(...result.value);
  }

  // 2-04 · R-METER-2 — the row this file never wrote, carrying the provider's
  // own name. Unreachable today for the same reason as the breaker above.
  if (operatorFunded) {
    recordUsageEvent({
      user_id: query.webSearch?.userId ?? null,
      kind: "search",
      surface: "papers",
      query_count: searchQueries.length,
      provider,
      ok: true,
      byok: false,
    });
  }

  return uniqueById(all).slice(0, limit);
}

async function fetchBrave(query: string, limit: number, apiKey: string): Promise<RawItem[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(limit),
    freshness: "pm",
  });
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      console.error("[web-search] brave non-ok response:", res.status);
      return [];
    }
    const data = (await res.json()) as BraveResponse;
    return (data.web?.results ?? []).map((item) => braveToRawItem(item)).filter((item): item is RawItem => item !== null);
  } catch (err) {
    console.error("[web-search] brave fetch error:", err);
    return [];
  }
}

async function fetchTavily(
  query: string,
  limit: number,
  apiKey: string | undefined,
  options: SourceQuery["webSearch"],
): Promise<RawItem[]> {
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: limit,
        include_answer: false,
        include_domains: options?.includeDomains,
        exclude_domains: options?.excludeDomains,
      }),
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      console.error("[web-search] tavily non-ok response:", res.status);
      return [];
    }
    const data = (await res.json()) as TavilyResponse;
    return (data.results ?? []).map((item) => tavilyToRawItem(item)).filter((item): item is RawItem => item !== null);
  } catch (err) {
    console.error("[web-search] tavily fetch error:", err);
    return [];
  }
}

/**
 * RULING 75 — the gemini branch of the paper surface's fan-out.
 *
 * `searchGemini` returns the same `{title, url, snippet}` contract Tavily and
 * Brave are normalised to, so the only work here is the surface's own mapping.
 * `venue` is `"Web"` — the same string the Tavily branch uses, because a
 * grounded row carries no publisher name either. Brave's `profile.name` has no
 * analogue in grounding metadata and is NOT faked from the hostname.
 */
async function fetchGemini(
  query: string,
  limit: number,
  deadlineAt: number,
  options: SourceQuery["webSearch"],
): Promise<RawItem[]> {
  const results = await searchGemini(query, {
    excludeDomains: options?.excludeDomains,
    maxResults: limit,
    deadlineAt,
  });
  return results
    .map((result) => tavilyToRawItem({ title: result.title, url: result.url, content: result.snippet }))
    .filter((item): item is RawItem => item !== null);
}

/**
 * The vertex branch of the paper surface's fan-out.
 *
 * Identical in shape to `fetchGemini` because `searchVertex` returns the same
 * `{title, url, snippet}` contract — the ONLY difference that reaches this
 * surface is which engine (and which bill) produced the rows. `venue` stays
 * `"Web"` for the same reason it does on the Tavily and gemini branches: an
 * indexed web row carries no publisher name, and inventing one from the
 * hostname is the mistake Ruling 75 already refused.
 */
async function fetchVertex(
  query: string,
  limit: number,
  deadlineAt: number,
  options: SourceQuery["webSearch"],
): Promise<RawItem[]> {
  const results = await searchVertex(query, {
    excludeDomains: options?.excludeDomains,
    maxResults: limit,
    deadlineAt,
  });
  return results
    .map((result) => tavilyToRawItem({ title: result.title, url: result.url, content: result.snippet }))
    .filter((item): item is RawItem => item !== null);
}

function braveToRawItem(result: BraveResult): RawItem | null {
  const title = cleanDisplayText(result.title);
  const url = cleanDisplayText(result.url);
  if (!title || !url) return null;
  return {
    id: `web:${url}`,
    source: "web",
    title,
    authors: [],
    abstract: cleanDisplayTextOrUndefined(result.description),
    url,
    publishedAt: "",
    venue: cleanDisplayTextOrUndefined(result.profile?.name),
    tags: ["web mention"],
    metadata: {},
  };
}

function tavilyToRawItem(result: TavilyResult): RawItem | null {
  const title = cleanDisplayText(result.title);
  const url = cleanDisplayText(result.url);
  if (!title || !url) return null;
  return {
    id: `web:${url}`,
    source: "web",
    title,
    authors: [],
    abstract: cleanDisplayTextOrUndefined(result.content),
    url,
    publishedAt: "",
    venue: "Web",
    tags: ["web mention"],
    metadata: {},
  };
}

function buildSearchQueries(query: SourceQuery): string[] {
  const source = query.queries?.length ? query.queries : query.topics;
  return Array.from(new Set(source.map((q) => q.trim()).filter(Boolean))).slice(0, 4);
}

// RULING 75 — the order now lives in `gemini-search.ts` so all three surfaces
// share one implementation instead of three copies that can drift. With Vertex
// absent this returns exactly what the previous local version returned.
function resolveProvider(
  query: SourceQuery,
  // 2-04 — the two operator capabilities are PASSED IN, gated, rather than read
  // from the environment here. This function used to call
  // `isGeminiSearchAvailable()` and `isVertexSearchAvailable()` directly, which
  // is the second of the two ungated reads in this file.
  operatorAvailability: { geminiAvailable: boolean; vertexAvailable: boolean },
  keyAvailability: {
    braveKeyPresent: boolean;
    tavilyKeyPresent: boolean;
    requestTavilyKeyPresent: boolean;
  },
): "brave" | "tavily" | "gemini" | "vertex" | null {
  return resolveWebSearchProvider(query.webSearch?.provider, {
    ...operatorAvailability,
    ...keyAvailability,
  });
}

function uniqueById(items: RawItem[]): RawItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export const webSearch: SourceAdapter = {
  id: "web",
  fetch: fetchImpl,
};
