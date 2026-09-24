// 2-01 (Ruling 9, §1j): a hard 401/402/403/451 used to mean "paywalled"
// everywhere it was checked, even on a host that is not a publisher at all
// (an aggregator like OpenAlex, arXiv, Semantic Scholar). Blocked-by-bot-check
// and paywalled-by-subscription are different facts and deserve different
// wording; this module is the one shared place that tells them apart, so the
// three call sites (`papers/full-text.ts`, `figures/extract.ts`,
// `figures/pdf-extract.ts`) each stop keeping their own copy of the list.

export type HardAccessVerdict = "paywalled" | "blocked" | null;

const HARD_ACCESS_STATUS_CODES = [401, 402, 403, 451];

// Ruling 9 (§1j) — closed by construction, not a heuristic. These are the
// aggregator/free hosts this codebase itself calls; a 401/402/403/451 from
// one of them is an anti-bot block, never a subscription gate. Do not widen
// this into an open-ended "looks free" guess — add a host only when the spec
// names it.
const AGGREGATOR_HOSTS: RegExp[] = [
  /(^|\.)openalex\.org$/i,
  /(^|\.)api\.openalex\.org$/i,
  /(^|\.)semanticscholar\.org$/i,
  /(^|\.)europepmc\.org$/i,
  /(^|\.)arxiv\.org$/i,
  /(^|\.)ar5iv\.labs\.arxiv\.org$/i,
  /(^|\.)osf\.io$/i,
  /(^|\.)biorxiv\.org$/i,
  /(^|\.)medrxiv\.org$/i,
  /(^|\.)ncbi\.nlm\.nih\.gov$/i, // also covers pmc.ncbi.nlm.nih.gov by suffix
];

export function isAggregatorHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return AGGREGATOR_HOSTS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

/**
 * Classifies a hard-access HTTP status against the URL it came from.
 * Returns `null` when `status` isn't one of the four hard-access codes at
 * all — callers keep their own existing handling for every other status
 * unchanged. Otherwise: `"blocked"` on an aggregator host (never a
 * subscription), `"paywalled"` everywhere else (a real publisher gate).
 */
export function classifyHardAccessStatus(url: string, status: number): HardAccessVerdict {
  if (!HARD_ACCESS_STATUS_CODES.includes(status)) return null;
  return isAggregatorHost(url) ? "blocked" : "paywalled";
}
