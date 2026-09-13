import { NextRequest, NextResponse } from "next/server";
import {
  reconstructAbstract,
  normalizeOpenAlexId,
} from "@/lib/utils/openalex";
import { cleanDisplayText } from "@/lib/text/clean";

const OPENALEX_API = "https://api.openalex.org/works";

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
    // The polite pool: OpenAlex throttles the anonymous pool hard (a 429 on
    // the second query, measured 2026-09-13) and a placeholder address is
    // one identity shared by every install. Every other OpenAlex caller in
    // lib/ reads OPENALEX_EMAIL; this one had it hardcoded.
    mailto: process.env.OPENALEX_EMAIL ?? "peer@example.com",
  });
  if (clauses.length > 0) params.set("filter", clauses.join(","));

  const res = await fetch(`${OPENALEX_API}?${params}`, {
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "OpenAlex API error", status: res.status },
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
