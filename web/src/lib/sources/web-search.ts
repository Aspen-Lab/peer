import type { SourceAdapter, SourceQuery, RawItem } from "./types";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import {
  geminiSearchDeadline,
  isGeminiSearchAvailable,
  resolveWebSearchProvider,
  searchGemini,
} from "./gemini-search";
import {
  collectSearchResults,
  searchHttpFailure,
} from "./search-failure";
import { isVertexSearchAvailable, searchVertex } from "./vertex-search";

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
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  const requestTavilyKey = query.webSearch?.tavilyApiKey?.trim();
  const tavilyKey = requestTavilyKey || process.env.TAVILY_API_KEY;
  // RULING 75 — the key gate now admits the gemini provider too. Without this
  // the paper surface returned `[]` here the moment Tavily was disabled. The
  // credit migration adds vertex on the same footing: a configured Search App
  // is a usable search capability exactly as Vertex credentials are.
  if (
    !braveKey &&
    !tavilyKey &&
    !isGeminiSearchAvailable() &&
    !isVertexSearchAvailable()
  ) {
    return [];
  }

  const perQuery = Math.max(3, Math.ceil(Math.min(limit, 20) / searchQueries.length));
  const all: RawItem[] = [];
  const provider = resolveProvider(query, {
    braveKeyPresent: Boolean(braveKey),
    tavilyKeyPresent: Boolean(tavilyKey),
    requestTavilyKeyPresent: Boolean(requestTavilyKey),
  });
  if (!provider) return [];
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
  // Rejections used to be dropped here, which is how a provider that answered
  // nothing but errors still looked like a quiet day on the web.
  // `collectSearchResults` re-raises only when EVERY query failed.
  for (const rows of collectSearchResults(provider, "web-search", settled)) {
    all.push(...rows);
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
    if (!res.ok) throw await searchHttpFailure("brave", res);
    const data = (await res.json()) as BraveResponse;
    return (data.web?.results ?? []).map((item) => braveToRawItem(item)).filter((item): item is RawItem => item !== null);
  } catch (err) {
    console.error("[web-search] brave fetch error:", err);
    throw err;
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
    if (!res.ok) throw await searchHttpFailure("tavily", res);
    const data = (await res.json()) as TavilyResponse;
    return (data.results ?? []).map((item) => tavilyToRawItem(item)).filter((item): item is RawItem => item !== null);
  } catch (err) {
    // Rethrown, not swallowed — see sources/search-failure.ts. An empty array
    // here is the paper surface saying "the web has nothing on this topic".
    console.error("[web-search] tavily fetch error:", err);
    throw err;
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
  availability: {
    braveKeyPresent: boolean;
    tavilyKeyPresent: boolean;
    requestTavilyKeyPresent: boolean;
  },
): "brave" | "tavily" | "gemini" | "vertex" | null {
  return resolveWebSearchProvider(query.webSearch?.provider, {
    geminiAvailable: isGeminiSearchAvailable(),
    vertexAvailable: isVertexSearchAvailable(),
    ...availability,
  });
}

function uniqueById(items: RawItem[]): RawItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export const webSearch: SourceAdapter = {
  id: "web",
  fetch: fetchImpl,
};
