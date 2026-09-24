import { NextRequest, NextResponse } from "next/server";
import {
  reconstructAbstract,
  normalizeOpenAlexId,
} from "@/lib/utils/openalex";
import { cleanDisplayText } from "@/lib/text/clean";

const OPENALEX_API = "https://api.openalex.org/works";
/** The polite pool's address — the same `OPENALEX_EMAIL` every other OpenAlex
 *  call in the codebase sends. This route alone had the placeholder written
 *  in, so its requests went to the common pool whatever was configured. */
const MAILTO = process.env.OPENALEX_EMAIL ?? "peer@example.com";

const RETRY_AFTER_MS = 400;
/** The longest a `Retry-After` header is honoured. Past this the reader has
 *  already been told the search did not answer, and can ask again. */
const RETRY_AFTER_MAX_MS = 2_000;

/** Whether the answer is worth asking for again: a server error, or the rate
 *  limit — OpenAlex's is ten a second per address, and a briefing's figure
 *  lookups can spend that in one burst, so the search that follows them is
 *  refused for a moment and fine right after. Any other 4xx is our request
 *  being wrong, and asking twice will not make it right. */
function retryable(res: Response): boolean {
  return res.status >= 500 || res.status === 429;
}

function retryDelay(res: Response | null): number {
  const header = Number(res?.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, RETRY_AFTER_MAX_MS);
  return RETRY_AFTER_MS;
}

/** The upstream call, tried twice when the first answer is retryable.
 *  `null` when even the retry could not connect. */
async function fetchUpstream(url: string): Promise<Response | null> {
  const attempt = () => fetch(url, { next: { revalidate: 300 } });
  let first: Response | null = null;
  try {
    first = await attempt();
    if (!retryable(first)) return first;
  } catch {
    first = null;
  }
  await new Promise((r) => setTimeout(r, retryDelay(first)));
  try {
    return await attempt();
  } catch {
    return first;
  }
}

const SORT_MAP = {
  relevance: "relevance_score:desc",
  cited: "cited_by_count:desc",
  newest: "publication_date:desc",
} as const;

const SOURCE_TYPE_MAP: Record<string, string> = {
  journal: "journal",
  conference: "conference",
  arxiv: "repository",
};

interface OpenAlexAuthor {
  author_position: string;
  author: { display_name: string };
}

interface OpenAlexWork {
  id: string;
  title: string;
  publication_date: string | null;
  authorships: OpenAlexAuthor[];
  primary_location: {
    source?: {
      display_name: string;
      type?: string | null;
      host_organization_name?: string | null;
    } | null;
  } | null;
  open_access?: { is_oa?: boolean } | null;
  abstract_inverted_index: Record<string, number[]> | null;
  cited_by_count: number;
  doi: string | null;
}

function classifySourceType(
  rawType: string | null | undefined,
  hostName: string | null | undefined,
): "journal" | "conference" | "arxiv" | "repository" | null {
  if (!rawType) return null;
  if (rawType === "journal") return "journal";
  if (rawType === "conference") return "conference";
  if (rawType === "repository") {
    const host = (hostName || "").toLowerCase();
    if (host.includes("arxiv")) return "arxiv";
    return "repository";
  }
  return null;
}

function clampYear(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1900 || n > 2100) return null;
  return n;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const page = parseInt(sp.get("page") || "1", 10);
  const perPage = Math.min(parseInt(sp.get("per_page") || "20", 10), 50);

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [], total: 0 });
  }

  const sortKey = (sp.get("sort") || "relevance") as keyof typeof SORT_MAP;
  const sort = SORT_MAP[sortKey] ?? SORT_MAP.relevance;

  const from = clampYear(sp.get("from"));
  const to = clampYear(sp.get("to"));
  const oa = sp.get("oa") === "1";
  const minCitesRaw = parseInt(sp.get("cites") || "0", 10);
  const minCites = [10, 50, 100].includes(minCitesRaw) ? minCitesRaw : 0;

  const srcRaw = (sp.get("src") || "").split(",").filter(Boolean);
  const sources = srcRaw
    .map((s) => SOURCE_TYPE_MAP[s])
    .filter((s): s is string => Boolean(s));

  const venueRaw = (sp.get("venue") || "").trim();
  const venue = venueRaw.replace(/[,|]/g, " ").slice(0, 80);

  const clauses: string[] = [];
  if (from) clauses.push(`from_publication_date:${from}-01-01`);
  if (to) clauses.push(`to_publication_date:${to}-12-31`);
  if (oa) clauses.push("is_oa:true");
  if (minCites > 0) clauses.push(`cited_by_count:>${minCites}`);
  if (sources.length > 0) {
    clauses.push(`primary_location.source.type:${sources.join("|")}`);
  }
  if (venue) {
    clauses.push(`primary_location.source.display_name.search:${venue}`);
  }

  const params = new URLSearchParams({
    search: q,
    page: String(page),
    per_page: String(perPage),
    select:
      "id,title,publication_date,authorships,primary_location,open_access,abstract_inverted_index,cited_by_count,doi",
    sort,
    mailto: MAILTO,
  });
  if (clauses.length > 0) params.set("filter", clauses.join(","));

  // The first request for a query came back 429 often enough to notice — on
  // one afternoon, four of the first five searches, each answered in 150ms
  // and each fine when asked again a moment later. One retry, after the
  // pause the server names or a short one of our own.
  const res = await fetchUpstream(`${OPENALEX_API}?${params}`);

  if (!res || !res.ok) {
    return NextResponse.json(
      { error: "OpenAlex API error", status: res?.status ?? 0 },
      { status: 502 },
    );
  }

  const data = await res.json();
  const works: OpenAlexWork[] = data.results || [];

  const papers = works.map((w) => ({
    id: normalizeOpenAlexId(w.id),
    title: cleanDisplayText(w.title),
    authors: w.authorships
      .map((a) => a.author.display_name)
      .map(cleanDisplayText)
      .filter(Boolean),
    abstract: cleanDisplayText(reconstructAbstract(w.abstract_inverted_index)),
    venue: cleanDisplayText(w.primary_location?.source?.display_name),
    sourceType: classifySourceType(
      w.primary_location?.source?.type ?? null,
      w.primary_location?.source?.host_organization_name ?? null,
    ),
    isOpenAccess: !!w.open_access?.is_oa,
    publishedDate: w.publication_date || null,
    citationCount: w.cited_by_count || 0,
    doi: w.doi || null,
    url: w.doi
      ? `https://doi.org/${w.doi.replace("https://doi.org/", "")}`
      : w.id,
    source: "openalex" as const,
  }));

  return NextResponse.json({
    results: papers,
    total: data.meta?.count || 0,
    page,
    perPage,
  });
}
