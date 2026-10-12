import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as calendarDate from "@/lib/local-calendar-date";
import * as poolCache from "@/lib/opportunities/pool-cache";

/**
 * P9-35 · §1h.60 (the owner's decision §1a.18 (f): jobs and events are stopped).
 *
 * `no-opportunity-sources.test.ts` (P9-33) keeps the job and event *sources*
 * out of the tree. This file keeps out what they left behind in the shared
 * definitions: the `Job` / `Event` shapes, the facet code that counted and
 * filtered their listings, the salary parser, the date helpers only they used,
 * and the pool-cache halves that stored their pools. These are placement
 * rules, so they read the tree (and, for a module's public surface, the
 * module). A test may name a thing to say it must not exist.
 */

const WEB = process.cwd();

function exists(relative: string): boolean {
  return fs.existsSync(path.join(WEB, relative));
}

function read(relative: string): string {
  return fs.readFileSync(path.join(WEB, relative), "utf8");
}

describe("what the stopped jobs and events feeds left in the shared definitions is gone", () => {
  it("the facet counting and filtering of job and event listings is gone", () => {
    expect(exists("src/lib/opportunities/facets.ts")).toBe(false);
    expect(exists("src/lib/opportunities/facets.test.ts")).toBe(false);
  });

  it("the pool cache stores a paper pool and nothing else: no event or job pool, no guard for one, no weekly key", () => {
    for (const name of ["isCachedEventPool", "isCachedJobPool", "localIsoWeek"]) {
      expect(name in poolCache, name).toBe(false);
    }
    const source = read("src/lib/opportunities/pool-cache.ts");
    expect(source).not.toMatch(/lib\/(events|jobs)\/types/);
    expect(source).not.toMatch(/CachedEventPool|CachedJobPool|OpportunitySurface|OpportunityFacet/);
  });

  it("the ISO-week helper the weekly job and event pools used is gone; the local date stays", () => {
    expect("localIsoWeek" in calendarDate).toBe(false);
    expect(typeof calendarDate.localCalendarDate).toBe("function");
  });
});
