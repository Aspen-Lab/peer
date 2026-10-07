import type { SourceAdapter, SourceQuery, RawItem } from "./types";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import {
  collectSearchResults,
  searchHttpFailure,
} from "./search-failure";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

/**
 * The papers `web` source: a Tavily search on **the reader's own key**, and
 * nothing else.
 *
 * Peer funds no search for anyone. There is no server key to fall back to
 * (`TAVILY_API_KEY` is read by no code and banned on Vercel), no Brave, and no
 * Google-hosted engine, so a query that carries no reader key returns `[]` — the
 * same degraded value a keyless reader has always got, and the paper pipeline
 * serves its other sources.
 *
 * **On this surface that is every query today.** `feed/pipeline.ts` builds the
 * `web` source's options with no key in them, and `store/feed.ts` sends no
 * `searchConnectors` for papers by design: the paper surface does not spend the
 * reader's Tavily quota either (the one Tavily channel it had was deleted for
 * buying a number nothing displayed). The Tavily branch below is what a reader's
 * key would run on if that is ever turned back on.
 */
async function fetchImpl(query: SourceQuery): Promise<RawItem[]> {
  const searchQueries = buildSearchQueries(query);
  if (searchQueries.length === 0) return [];

  const limit = query.limit ?? 20;
  const tavilyKey = query.webSearch?.tavilyApiKey?.trim();
  if (!tavilyKey) return [];

  const perQuery = Math.max(3, Math.ceil(Math.min(limit, 20) / searchQueries.length));
  const all: RawItem[] = [];

  // Fan the per-query fetches out concurrently (like the other source
  // adapters) instead of awaiting them one at a time. Promise.allSettled
  // preserves input order and isolates a single slow/failed query, so the
  // whole source no longer blocks on the slowest one — and one query timing
  // out no longer drops the rest.
  const settled = await Promise.allSettled(
    searchQueries.map((searchQuery) =>
      fetchTavily(`${searchQuery} paper OR preprint OR arxiv`, perQuery, tavilyKey, query.webSearch),
    ),
  );
  // Rejections used to be dropped here, which is how a provider that answered
  // nothing but errors still looked like a quiet day on the web.
  // `collectSearchResults` re-raises only when EVERY query failed.
  for (const rows of collectSearchResults("tavily", "web-search", settled)) {
    all.push(...rows);
  }

  return uniqueById(all).slice(0, limit);
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

function uniqueById(items: RawItem[]): RawItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export const webSearch: SourceAdapter = {
  id: "web",
  fetch: fetchImpl,
};
