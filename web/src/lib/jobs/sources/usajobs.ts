import { routeSafeId, stripHtml, truncateText } from "@/lib/opportunities/shared";
import { parseStructuredLocation } from "@/lib/opportunities/structured-extract";
import { normalizeSalary } from "@/lib/opportunities/salary";
import type { JobSourceAdapter, JobsQuery, RawJobItem } from "../types";

// USAJobs: US federal research positions (NIH, NSF, national labs). Free key
// from developer.usajobs.gov. Requires the reader's own key and the registered
// email address (`apiKeys.usajobsApiKey` and `apiKeys.usajobsUserAgent`), both
// sent in the request; Peer reads neither from the environment.

interface UsaJobsDescriptor {
  PositionID?: string;
  PositionTitle?: string;
  OrganizationName?: string;
  PositionLocationDisplay?: string;
  PositionURI?: string;
  PublicationStartDate?: string;
  UserArea?: { Details?: { JobSummary?: string; MajorDuties?: string[] } };
  PositionSchedule?: Array<{ Name?: string }>;
  JobCategory?: Array<{ Name?: string }>;
  PositionRemuneration?: Array<{
    MinimumRange?: string;
    MaximumRange?: string;
    RateIntervalCode?: string;
  }>;
}

interface UsaJobsResponse {
  SearchResult?: {
    SearchResultItems?: Array<{ MatchedObjectDescriptor?: UsaJobsDescriptor }>;
  };
}

function usaJobsAmount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

export function usaJobsDescriptorToRawItem(
  descriptor: UsaJobsDescriptor,
): RawJobItem | null {
  const title = descriptor.PositionTitle?.trim();
  const url = descriptor.PositionURI?.trim();
  const id = descriptor.PositionID?.trim();
  if (!title || !url || !id) return null;
  const details = descriptor.UserArea?.Details;
  const summary = [details?.JobSummary, ...(details?.MajorDuties ?? [])]
    .filter(Boolean)
    .join("\n");
  const location =
    descriptor.PositionLocationDisplay?.trim() || "United States";
  const remuneration = descriptor.PositionRemuneration?.[0];
  const period =
    remuneration?.RateIntervalCode === "PA"
      ? "year"
      : remuneration?.RateIntervalCode === "PH"
        ? "hour"
        : remuneration?.RateIntervalCode === "PM"
          ? "month"
          : undefined;
  const salary = period
    ? normalizeSalary({
        min: usaJobsAmount(remuneration?.MinimumRange),
        max: usaJobsAmount(remuneration?.MaximumRange),
        currency: "USD",
        period,
      })
    : null;
  return {
    id: `usajobs:${routeSafeId(String(id))}`,
    source: "usajobs",
    title,
    company: descriptor.OrganizationName?.trim() || "U.S. Federal Government",
    location,
    place: parseStructuredLocation(location),
    isRemote: /\bremote\b/i.test(descriptor.PositionLocationDisplay ?? ""),
    description: truncateText(stripHtml(summary)),
    url,
    postedAt: descriptor.PublicationStartDate,
    employmentType: descriptor.PositionSchedule?.[0]?.Name,
    salaryMin: salary?.min,
    salaryMax: salary?.max,
    salaryCurrency: salary?.currency,
    salaryPeriod: salary?.period,
    tags: (descriptor.JobCategory ?? [])
      .map((c) => c.Name)
      .filter((t): t is string => Boolean(t && t.trim())),
  };
}

function usajobsCreds(query: JobsQuery): { apiKey?: string; userAgent?: string } {
  return {
    apiKey: query.apiKeys?.usajobsApiKey?.trim() || undefined,
    userAgent: query.apiKeys?.usajobsUserAgent?.trim() || undefined,
  };
}

async function fetchImpl(query: JobsQuery): Promise<RawJobItem[]> {
  const { apiKey, userAgent } = usajobsCreds(query);
  if (!apiKey || !userAgent) return [];

  const keyword = query.queries[0] ?? query.topics[0] ?? "";
  if (!keyword) return [];
  const params = new URLSearchParams({
    Keyword: keyword,
    ResultsPerPage: "50",
  });
  try {
    const res = await fetch(`https://data.usajobs.gov/api/search?${params}`, {
      headers: {
        Host: "data.usajobs.gov",
        "User-Agent": userAgent,
        "Authorization-Key": apiKey,
      },
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 3 * 60 * 60 },
    });
    if (!res.ok) {
      console.error("[jobs/usajobs] non-ok response:", res.status);
      return [];
    }
    const data = (await res.json()) as UsaJobsResponse;
    return (data.SearchResult?.SearchResultItems ?? [])
      .map((item) =>
        item.MatchedObjectDescriptor
          ? usaJobsDescriptorToRawItem(item.MatchedObjectDescriptor)
          : null,
      )
      .filter((item): item is RawJobItem => item !== null)
      .slice(0, query.limit);
  } catch (err) {
    console.error("[jobs/usajobs] fetch error:", err);
    return [];
  }
}

export const usajobs: JobSourceAdapter = {
  id: "usajobs",
  enabled: (query) => {
    const { apiKey, userAgent } = usajobsCreds(query);
    return Boolean(apiKey && userAgent);
  },
  fetch: fetchImpl,
};
