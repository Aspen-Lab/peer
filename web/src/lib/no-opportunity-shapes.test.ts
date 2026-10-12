import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as calendarDate from "@/lib/local-calendar-date";
import * as format from "@/lib/format";
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

  it("lib/jobs and lib/events are gone: their type files had no reader left", () => {
    expect(exists("src/lib/jobs")).toBe(false);
    expect(exists("src/lib/events")).toBe(false);
  });

  it("the salary parser of the job listings is gone", () => {
    expect(exists("src/lib/opportunities/salary.ts")).toBe(false);
    expect(exists("src/lib/opportunities/salary.test.ts")).toBe(false);
  });

  it("the shared types name no event, no job, no listing facet and no feed-item kind", () => {
    const source = read("src/types/index.ts");
    for (const name of [
      "interface Event",
      "interface Job",
      "EventType",
      "eventTypes",
      "EventFee",
      "EventOrg",
      "EventPerson",
      "RoleKind",
      "OpportunityPlace",
      "OpportunityFormat",
      "OpportunityFacetCounts",
      "OpportunityFacetSelection",
      "FeedItemKind",
    ]) {
      expect(source, name).not.toContain(name);
    }
  });

  it("a ledger entry has no origin field, and still names the concept sources a stored entry may carry", () => {
    const source = read("src/types/index.ts");
    const entry = source.slice(
      source.indexOf("export interface PreferenceLedgerEntry"),
      source.indexOf("export type PreferenceLedger ="),
    );
    expect(entry).not.toMatch(/\borigin\??:/);
    // Entries in a reader's stored ledger, or in a backup file, may carry them;
    // dropping a member would make the type refuse what is already stored.
    for (const member of ["job_tag", "event_topic", "opportunity_facet"]) {
      expect(source, member).toContain(`"${member}"`);
    }
  });

  it("the shared formatter keeps what the papers use and loses the ten the job and event listings used", () => {
    for (const name of [
      "formatDateRange",
      "formatWeekdayRange",
      "daysUntil",
      "formatDayDistance",
      "formatDaysLeft",
      "formatDaysAgo",
      "formatAgeInWords",
      "formatMatchPct",
      "isMonthGranularity",
      "dateClaimEndMs",
    ]) {
      expect(name in format, name).toBe(false);
    }
    for (const name of ["parseDate", "formatDate", "formatTimeAgo", "formatDayAge", "formatCount"]) {
      expect(typeof (format as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});
