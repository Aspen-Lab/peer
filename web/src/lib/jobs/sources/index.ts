import type { JobSourceAdapter, JobSourceId } from "../types";
import { remotive } from "./remotive";
import { arbeitnow } from "./arbeitnow";
import { himalayas } from "./himalayas";
import { adzuna } from "./adzuna";
import { usajobs } from "./usajobs";
import { jsearch } from "./jsearch";
import { jobweb } from "./jobweb";

/**
 * All job source adapters. Free/no-auth sources (remotive, arbeitnow,
 * himalayas) keep Tier 0 useful with zero keys; the rest enable themselves
 * only when the reader's own credentials are in the request (see each adapter's
 * `enabled()`). None reads a company key from the environment.
 */
export const jobSources: JobSourceAdapter[] = [
  remotive,
  arbeitnow,
  himalayas,
  adzuna,
  usajobs,
  jsearch,
  jobweb,
];

export const jobSourceById: Record<JobSourceId, JobSourceAdapter> = {
  remotive,
  arbeitnow,
  himalayas,
  adzuna,
  usajobs,
  jsearch,
  jobweb,
};
