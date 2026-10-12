import { describe, expect, it } from "vitest";
import type { Job } from "@/types";
import {
  countJobFacets,
  countOpportunityFacets,
  DEFAULT_JOB_FACET_SELECTION,
  filterJobsByFacets,
  filterOpportunitiesByFacets,
  opportunityFormat,
  parseOpportunityFacetSelection,
} from "./facets";

// P9-33: the three "opportunity feed facet contract" cases that stood here ran
// `runEventsPipeline` and `runJobsPipeline` through a stubbed source. Both
// pipelines were deleted (§1h.60), and those cases went with them. Every case
// below calls the pure counting and filtering in `facets.ts` and is unchanged.

const FACET_JOBS: Job[] = [
  {
    id: "intern-chicago",
    roleTitle: "Battery Research Intern",
    companyOrLab: "Peer Lab",
    location: "Chicago, IL",
    place: { city: "Chicago", country: "United States" },
    isRemote: false,
    keyRequirements: [],
    matchReason: "Match",
    postedDate: "2026-07-29T12:00:00.000Z",
    roleKind: "internship",
    visa: { state: "sponsors", country: "United States" },
  },
  {
    id: "staff-berlin",
    roleTitle: "Battery Scientist",
    companyOrLab: "Peer Lab",
    location: "Berlin, Germany",
    place: { city: "Berlin", country: "Germany" },
    isRemote: false,
    keyRequirements: [],
    matchReason: "Match",
    postedDate: "2026-07-20T12:00:00.000Z",
    roleKind: "staff",
    visa: { state: "wont-sponsor", country: "Germany" },
  },
  {
    id: "postdoc-remote",
    roleTitle: "Electrochemistry Postdoc",
    companyOrLab: "Peer Lab",
    location: "Remote",
    isRemote: true,
    keyRequirements: [],
    matchReason: "Match",
    postedDate: "2026-06-01T12:00:00.000Z",
    roleKind: "postdoc",
  },
];

describe("job opportunity facets", () => {
  const nowMs = new Date("2026-07-30T12:00:00.000Z").getTime();

  it("narrows the pool by role kind", () => {
    expect(
      filterJobsByFacets(FACET_JOBS, {
        ...DEFAULT_JOB_FACET_SELECTION,
        roleKinds: ["internship"],
      }).map((job) => job.id),
    ).toEqual(["intern-chicago"]);
  });

  it("narrows the pool by visa state", () => {
    expect(
      filterJobsByFacets(FACET_JOBS, {
        ...DEFAULT_JOB_FACET_SELECTION,
        visaStates: ["wont-sponsor"],
      }).map((job) => job.id),
    ).toEqual(["staff-berlin"]);
  });

  it("keeps the pool when an only-location has zero results today", () => {
    expect(
      filterJobsByFacets(FACET_JOBS, {
        ...DEFAULT_JOB_FACET_SELECTION,
        locations: ["Tokyo"],
        locationMode: "only",
      }),
    ).toEqual(FACET_JOBS);
  });

  it("counts internships separately and counts both city and country", () => {
    const counts = countJobFacets(FACET_JOBS, nowMs);

    expect(counts.roleKinds.internship).toBe(1);
    expect(counts.locations).toMatchObject({
      Chicago: 1,
      "United States": 1,
      Berlin: 1,
      Germany: 1,
    });
    expect(counts.when).toEqual({
      any: 3,
      "24h": 1,
      "7d": 1,
      "30d": 2,
    });
  });

  it("uses authorised countries as a safe default with an override", () => {
    const selection = { ...DEFAULT_JOB_FACET_SELECTION };

    expect(
      filterJobsByFacets(FACET_JOBS, selection, {
        authorisedCountries: [],
      }),
    ).toEqual(FACET_JOBS);
    expect(
      filterJobsByFacets(FACET_JOBS, selection, {
        authorisedCountries: ["United States"],
      }).map((job) => job.id),
    ).toEqual(["intern-chicago", "postdoc-remote"]);
    expect(
      filterJobsByFacets(
        FACET_JOBS,
        { ...selection, includeVisaMismatch: true },
        { authorisedCountries: ["United States"] },
      ),
    ).toEqual(FACET_JOBS);

    const visaCountryOnly = {
      ...FACET_JOBS[1],
      id: "staff-visa-country-only",
      place: undefined,
      location: "Remote",
    };
    expect(
      filterJobsByFacets([visaCountryOnly], selection, {
        authorisedCountries: ["United States"],
      }),
    ).toEqual([]);
  });
});

describe("opportunity facet counting", () => {
  it("counts city before country, calendar month, and event format", () => {
    const counts = countOpportunityFacets("events", [
      {
        location: "Chicago, IL + Virtual",
        place: { city: "Chicago", country: "United States" },
        startDate: "2026-09-10",
        isOnline: true,
      },
      {
        location: "chicago",
        place: { city: "chicago", country: "United States" },
        startDate: "2026-09-28T12:00:00Z",
        isOnline: false,
      },
      {
        location: "Online",
        place: { country: "Germany" },
        startDate: "October 5, 2026",
        isOnline: true,
      },
      {
        location: "Online",
        startDate: "2026-10-18",
        isOnline: true,
      },
      {
        location: "See event page",
        startDate: "",
        isOnline: false,
      },
    ]);

    expect(counts.location).toEqual({ Chicago: 2, Germany: 1 });
    expect(counts.month).toEqual({ "2026-09": 2, "2026-10": 2 });
    expect(counts.format).toEqual({
      "in-person": 2,
      online: 1,
      hybrid: 2,
    });
  });

  it("treats remote jobs as online unless the posting says hybrid", () => {
    expect(
      opportunityFormat("jobs", {
        location: "Remote — United States",
        place: { country: "United States" },
        isRemote: true,
      }),
    ).toBe("online");
    expect(
      opportunityFormat("jobs", {
        location: "Hybrid in Chicago",
        place: { city: "Chicago" },
        isRemote: false,
      }),
    ).toBe("hybrid");
  });

  it("sanitizes selections and lets hybrid events match online and city", () => {
    expect(
      parseOpportunityFacetSelection({
        location: [" Chicago ", "chicago", 42],
        month: ["2026-09"],
        format: ["online", "invalid"],
      }),
    ).toEqual({
      location: ["Chicago"],
      month: ["2026-09"],
      format: ["online"],
    });

    const hybrid = {
      location: "Chicago, IL + Virtual",
      place: { city: "Chicago", region: "IL" },
      date: "2026-09-10",
      isOnline: true,
    };
    expect(
      filterOpportunitiesByFacets("events", [hybrid], {
        location: ["Chicago"],
        month: ["2026-09"],
        format: ["online"],
      }),
    ).toEqual([hybrid]);
    expect(
      filterOpportunitiesByFacets("events", [hybrid], {
        location: ["Berlin"],
        format: ["online"],
      }),
    ).toEqual([]);
  });
});
