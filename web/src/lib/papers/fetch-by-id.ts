import { XMLParser } from "fast-xml-parser";
import type { RawItem } from "@/lib/sources/types";
import {
  openAlexWorkToRawItem,
  type OpenAlexWork,
} from "@/lib/utils/openalex";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import { fetchSemanticScholarText } from "./enrich";

const MAILTO = process.env.OPENALEX_EMAIL ?? "peer@example.com";

async function fetchOpenAlexPaper(workId: string): Promise<RawItem | null> {
  const url = `https://api.openalex.org/works/${encodeURIComponent(workId)}?mailto=${encodeURIComponent(MAILTO)}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const work = (await res.json()) as OpenAlexWork;
    const item = openAlexWorkToRawItem(work);

    // Publishers like Nature / Science don't license abstracts to OpenAlex.
    // Fill in via Semantic Scholar — try OpenAlex ID first, then DOI. Only a
    // real abstract becomes `item.abstract`; the machine TLDR, when that is
    // all S2 has, travels separately as `item.tldr` so the page can label it.
    if (!item.abstract) {
      const externalIds = [`OpenAlex:${workId}`];
      if (item.metadata.doi) {
        const cleanedDoi = item.metadata.doi.replace(
          /^https?:\/\/(?:dx\.)?doi\.org\//i,
          "",
        );
        externalIds.push(`DOI:${cleanedDoi}`);
      }
      for (const externalId of externalIds) {
        const found = await fetchSemanticScholarText(externalId);
        if (!found) continue;
        if (found.tldr && !item.tldr) item.tldr = found.tldr;
        if (found.abstract) {
          item.abstract = found.abstract;
          break;
        }
      }
    }
    return item;
  } catch (err) {
    console.error("[papers/by-id] openalex error:", err);
    return null;
  }
}

interface ArxivEntry {
  id: string;
  published: string;
  title: string;
  summary: string;
  author: { name: string } | { name: string }[];
  category?: { "@_term": string } | { "@_term": string }[];
  "arxiv:primary_category"?: { "@_term": string };
  link?:
    | { "@_href": string; "@_rel"?: string }
    | { "@_href": string; "@_rel"?: string }[];
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

async function fetchArxivPaper(arxivId: string): Promise<RawItem | null> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const parsed = parser.parse(xml);
    const entries: ArxivEntry[] = asArray(parsed?.feed?.entry);
    if (entries.length === 0) return null;
    const e = entries[0];
    const authors = asArray(e.author).map((a) => cleanDisplayText(a.name)).filter(Boolean);
    const categories = asArray(e.category).map((c) => cleanDisplayText(c["@_term"])).filter(Boolean);
    const links = asArray(e.link);
    const absLink =
      links.find((l) => l["@_rel"] === "alternate")?.["@_href"] ?? e.id;
    return {
      id: `arxiv:${arxivId}`,
      source: "arxiv",
      title: cleanDisplayText(e.title),
      authors,
      abstract: cleanDisplayTextOrUndefined(e.summary),
      url: absLink,
      publishedAt: e.published,
      venue: "arXiv",
      tags: categories.length > 0 ? categories : undefined,
      metadata: {
        arxivCategory: cleanDisplayTextOrUndefined(e["arxiv:primary_category"]?.["@_term"]),
      },
    };
  } catch (err) {
    console.error("[papers/by-id] arxiv error:", err);
    return null;
  }
}

export async function fetchPaperById(id: string): Promise<RawItem | null> {
  if (id.startsWith("openalex:")) {
    return fetchOpenAlexPaper(id.slice("openalex:".length));
  }
  if (id.startsWith("arxiv:")) {
    return fetchArxivPaper(id.slice("arxiv:".length));
  }
  return null;
}
