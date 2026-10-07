import { sanitizePlace } from "@/lib/opportunities/structured-extract";
import { routeSafeId, stripHtml, truncateText } from "@/lib/opportunities/shared";
import { normalizeSalary } from "@/lib/opportunities/salary";
import type { JobSourceAdapter, JobsQuery, RawJobItem } from "../types";

// JSearch (OpenWeb Ninja via RapidAPI) aggregates Google for Jobs — the widest
// coverage (LinkedIn/Indeed/Glassdoor) but a tiny free quota, so it is BYOK:
// the reader's own RapidAPI key travels in the request (`apiKeys.jsearchApiKey`)
// and nothing else enables it. Peer reads no company key from the environment
// (JSearch bills per request); with no key in the request the adapter returns
// nothing. Long revalidate to conserve the reader's quota.
const REVALIDATE_SECONDS = 12 * 60 * 60;

interface JSearchJob {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_description?: string;
  job_apply_link?: string;
  job_posted_at_datetime_utc?: string;
  job_employment_type?: string;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
  job_salary_currency?: string | null;
  job_highlights?: { Qualifications?: string[] };
}

interface JSearchResponse {
  data?: JSearchJob[];
}

export function jsearchJobToRawItem(job: JSearchJob): RawJobItem | null {
  const title = job.job_title?.trim();
  const url = job.job_apply_link?.trim();
  const id = job.job_id?.trim();
  if (!title || !url || !id) return null;
  const location = [job.job_city, job.job_state, job.job_country]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");
  const salary = normalizeSalary({
    min: job.job_min_salary,
    max: job.job_max_salary,
    currency: job.job_salary_currency,
    period: job.job_salary_period,
  });
  return {
    id: `jsearch:${routeSafeId(String(id))}`,
    source: "jsearch",
    title,
    // B8-03 (round 8): was "|| Unknown company" - a fabricated placeholder
    // Ruling 26 already rejected in jobweb.ts, copy-pasted here unaudited.
    // `company` is already optional; absence is honest, a made-up string
    // is not.
    company: job.employer_name?.trim() || undefined,
    location: location || (job.job_is_remote ? "Remote" : ""),
    place:
      job.job_city || job.job_state || job.job_country
        ? sanitizePlace({
            city: job.job_city?.trim() || undefined,
            region: job.job_state?.trim() || undefined,
            country: job.job_country?.trim() || undefined,
          })
        : undefined,
    isRemote: Boolean(job.job_is_remote),
    description: truncateText(stripHtml(job.job_description)),
    url,
    postedAt: job.job_posted_at_datetime_utc,
    employmentType: job.job_employment_type,
    salaryMin: salary?.min,
    salaryMax: salary?.max,
    salaryCurrency: salary?.currency,
    salaryPeriod: salary?.period,
    tags: (job.job_highlights?.Qualifications ?? []).slice(0, 6),
  };
}

function jsearchKey(query: JobsQuery): string | undefined {
  return query.apiKeys?.jsearchApiKey?.trim() || undefined;
}

async function fetchImpl(query: JobsQuery): Promise<RawJobItem[]> {
  const apiKey = jsearchKey(query);
  if (!apiKey) return [];

  const q = query.queries[0] ?? query.topics[0] ?? "";
  if (!q) return [];
  const params = new URLSearchParams({ query: q, num_pages: "1" });
  try {
    const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
      signal: AbortSignal.timeout(7000),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      console.error("[jobs/jsearch] non-ok response:", res.status);
      return [];
    }
    const data = (await res.json()) as JSearchResponse;
    return (data.data ?? [])
      .map(jsearchJobToRawItem)
      .filter((item): item is RawJobItem => item !== null)
      .slice(0, query.limit);
  } catch (err) {
    console.error("[jobs/jsearch] fetch error:", err);
    return [];
  }
}

export const jsearch: JobSourceAdapter = {
  id: "jsearch",
  enabled: (query) => Boolean(jsearchKey(query)),
  fetch: fetchImpl,
};
