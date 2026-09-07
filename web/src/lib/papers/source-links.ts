// Source-link discovery for legal full-text. Given a paper's identifier
// (DOI / arXiv ID / OpenAlex ID / canonical URL), build a list of candidate
// HTML and PDF URLs in best-success-first order:
//
//   1. ar5iv (arXiv HTML rendering)         — easiest to parse
//   2. PMC HTML                             — clean JATS-style sections
//   3. bioRxiv/medRxiv full HTML            — Highwire templates
//   4. Open-access publisher HTML (PLOS, MDPI, etc.)
//   5. Unpaywall best_oa_location           — usually publisher / preprint
//   6. EuropePMC                            — backup
//   7. Direct PDF (input URL / publisher)   — last resort
//
// The orchestrator (`full-text.ts`) tries them in order and stops on first
// success.

const FETCH_TIMEOUT_MS = 8_000;

export type SourceLinkKind = "html" | "pdf";

export type SourceLinkLabel =
  | "arxiv-html"
  | "ar5iv"
  | "zenodo"
  | "pmc"
  | "biorxiv"
  | "publisher-html"
  | "unpaywall"
  | "europepmc"
  | "input"
  | "doi"
  | "derived";

export interface SourceLink {
  url: string;
  kind: SourceLinkKind;
  label: SourceLinkLabel;
  /** Lower is better; the orchestrator sorts ascending. */
  rank: number;
}

interface UnpaywallLocation {
  url?: string | null;
  url_for_pdf?: string | null;
  url_for_landing_page?: string | null;
  host_type?: string | null;
}

interface UnpaywallRecord {
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[] | null;
}

interface EuropePmcResult {
  pmcid?: string;
  fullTextUrlList?: {
    fullTextUrl?:
      | { documentStyle?: string; url?: string }
      | { documentStyle?: string; url?: string }[];
  };
}

interface CollectInput {
  url?: string | null;
  doi?: string | null;
  /** Bare arXiv ID (e.g. "2403.12345") if known. */
  arxivId?: string | null;
  /** Bare OpenAlex work ID (e.g. "W12345") if known. */
  openAlexId?: string | null;
}

async function timedFetch(url: string, headers: HeadersInit = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "PeerBot/0.1 (+https://peer.research)",
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        ...headers,
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function cleanDoi(doi: string): string {
  return doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim();
}

function inferKind(url: string): SourceLinkKind {
  return /\.pdf(?:$|[?#])/i.test(url) ? "pdf" : "html";
}

function pmcIdFromUrl(url: string): string | null {
  const match = url.match(/PMC\d+/i);
  return match ? match[0].toUpperCase() : null;
}

function arxivIdFromUrl(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]+(?:v\d+)?)/i);
  return match ? match[1] : null;
}

function arxivIdFromDoi(doi: string): string | null {
  const match = cleanDoi(doi).match(/^10\.48550\/arxiv\.([0-9]{4}\.[0-9]+(?:v\d+)?)/i);
  return match ? match[1] : null;
}

function validApiEmail(): string | null {
  const email = (process.env.UNPAYWALL_EMAIL ?? process.env.OPENALEX_EMAIL ?? "").trim();
  if (!email || !/@/.test(email) || /example\.com$/i.test(email)) return null;
  return email;
}

async function lookupUnpaywallLinks(doi: string): Promise<SourceLink[]> {
  const email = validApiEmail();
  if (!email) return [];

  const apiUrl = `https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi(doi))}?email=${encodeURIComponent(email)}`;
  const res = await timedFetch(apiUrl, { Accept: "application/json" });
  if (!res || !res.ok) return [];

  try {
    const data = (await res.json()) as UnpaywallRecord;
    const locations = [data.best_oa_location, ...asArray(data.oa_locations)].filter(
      (loc): loc is UnpaywallLocation => Boolean(loc),
    );

    const out: SourceLink[] = [];
    for (const loc of locations) {
      const baseRank = loc.host_type === "publisher" ? 50 : 60;
      if (loc.url_for_landing_page) {
        out.push({
          url: loc.url_for_landing_page,
          kind: "html",
          label: "unpaywall",
          rank: baseRank,
        });
      }
      if (loc.url_for_pdf) {
        out.push({
          url: loc.url_for_pdf,
          kind: "pdf",
          label: "unpaywall",
          rank: baseRank + 20,
        });
      }
      if (loc.url) {
        out.push({
          url: loc.url,
          kind: inferKind(loc.url),
          label: "unpaywall",
          rank: baseRank + 10,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function lookupEuropePmcLinks(doi: string): Promise<SourceLink[]> {
  const apiUrl =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search" +
    `?query=DOI:${encodeURIComponent(cleanDoi(doi))}&resultType=core&format=json`;
  const res = await timedFetch(apiUrl, { Accept: "application/json" });
  if (!res || !res.ok) return [];

  try {
    const data = (await res.json()) as {
      resultList?: { result?: EuropePmcResult[] };
    };
    const result = data.resultList?.result?.[0];
    if (!result) return [];

    const links: SourceLink[] = [];
    for (const entry of asArray(result.fullTextUrlList?.fullTextUrl)) {
      if (!entry.url) continue;
      links.push({
        url: entry.url,
        kind: inferKind(entry.url),
        label: "europepmc",
        rank: entry.documentStyle === "html" ? 25 : 45,
      });
    }
    if (result.pmcid) {
      links.push({
        url: `https://pmc.ncbi.nlm.nih.gov/articles/${result.pmcid}/`,
        kind: "html",
        label: "pmc",
        rank: 20,
      });
      links.push({
        url: `https://europepmc.org/articles/${result.pmcid}?pdf=render`,
        kind: "pdf",
        label: "europepmc",
        rank: 42,
      });
    }
    return links;
  } catch {
    return [];
  }
}

interface ZenodoRecord {
  files?: Array<{ key?: string | null; links?: { self?: string | null } | null }> | null;
}

/** Zenodo DOIs are `10.5281/zenodo.<record>`; the records API lists the files. */
export async function lookupZenodoLinks(doi: string): Promise<SourceLink[]> {
  const match = cleanDoi(doi).match(/^10\.5281\/zenodo\.(\d+)$/i);
  if (!match) return [];
  const res = await timedFetch(`https://zenodo.org/api/records/${match[1]}`, {
    Accept: "application/json",
  });
  if (!res || !res.ok) return [];
  try {
    const data = (await res.json()) as ZenodoRecord;
    const pdf = (data.files ?? []).find(
      (file) => /\.pdf$/i.test(file.key ?? "") && file.links?.self,
    );
    if (!pdf?.links?.self) return [];
    return [{ url: pdf.links.self, kind: "pdf", label: "zenodo", rank: 12 }];
  } catch {
    return [];
  }
}

const OPEN_ACCESS_HOSTS = [
  "journals.plos.org",
  "www.frontiersin.org",
  "frontiersin.org",
  "www.mdpi.com",
  "mdpi.com",
  "www.pnas.org",
  "pnas.org",
  "www.nature.com",
  "www.science.org",
  "advances.sciencemag.org",
];

function looksOpenAccessHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OPEN_ACCESS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Build the ordered list of candidate full-text URLs for a paper.
 *
 * Caller iterates in `rank` order and stops on first successful extraction.
 */
export async function collectSourceLinks(input: CollectInput): Promise<SourceLink[]> {
  const links = new Map<string, SourceLink>();
  const addLink = (link: SourceLink) => {
    const key = link.url.trim();
    if (!key) return;
    const existing = links.get(key);
    if (!existing || link.rank < existing.rank) links.set(key, link);
  };

  // ── 1. arXiv → arxiv.org/html first, then ar5iv, then the PDF.
  // arXiv has served its own LaTeXML render at /html/<id> since late 2023;
  // ar5iv lags and now answers many recent ids with a redirect to the abstract
  // stub, which is why it fell from first choice to second.
  const arxivId =
    input.arxivId ??
    (input.url ? arxivIdFromUrl(input.url) : null) ??
    (input.doi ? arxivIdFromDoi(input.doi) : null);
  if (arxivId) {
    addLink({
      url: `https://arxiv.org/html/${arxivId}`,
      kind: "html",
      label: "arxiv-html",
      rank: 5,
    });
    addLink({
      url: `https://ar5iv.labs.arxiv.org/html/${arxivId}`,
      kind: "html",
      label: "ar5iv",
      rank: 10,
    });
    addLink({
      url: `https://arxiv.org/pdf/${arxivId}`,
      kind: "pdf",
      label: "ar5iv",
      rank: 80,
    });
  }

  // ── 2. bioRxiv / medRxiv DOI → full HTML page
  if (input.doi) {
    const cleaned = cleanDoi(input.doi);
    if (/^10\.1101\//i.test(cleaned)) {
      for (const host of ["www.biorxiv.org", "www.medrxiv.org"]) {
        addLink({
          url: `https://${host}/content/${cleaned}v1.full`,
          kind: "html",
          label: "biorxiv",
          rank: 15,
        });
      }
    }
  }

  // ── 2b. Zenodo record → the deposited PDF. A Zenodo DOI resolves to a
  // landing page that reads as "full text" while holding only the record's
  // description, so the file itself has to outrank every HTML fallback.
  if (input.doi) {
    for (const link of await lookupZenodoLinks(input.doi)) addLink(link);
  }

  // ── 3. EuropePMC and PMC (HTML pages get rank 20–25)
  if (input.doi) {
    for (const link of await lookupEuropePmcLinks(input.doi)) addLink(link);
    for (const link of await lookupUnpaywallLinks(input.doi)) addLink(link);
  }

  // ── 4. Input URL — boost if it points at an OA host's HTML page
  if (input.url) {
    const kind = inferKind(input.url);
    const oa = looksOpenAccessHost(input.url);
    const pmcId = pmcIdFromUrl(input.url);
    addLink({
      url: input.url,
      kind,
      label: oa && kind === "html" ? "publisher-html" : "input",
      rank: oa && kind === "html" ? 30 : kind === "html" ? 70 : 85,
    });
    if (pmcId) {
      addLink({
        url: `https://europepmc.org/articles/${pmcId}?pdf=render`,
        kind: "pdf",
        label: "europepmc",
        rank: 42,
      });
    }
  }

  // ── 5. DOI landing page (publisher) — last HTML fallback
  if (input.doi) {
    addLink({
      url: `https://doi.org/${cleanDoi(input.doi)}`,
      kind: "html",
      label: "doi",
      rank: 90,
    });
  }

  return Array.from(links.values()).sort((a, b) => a.rank - b.rank);
}
