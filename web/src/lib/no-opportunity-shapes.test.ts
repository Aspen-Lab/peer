import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

describe("what the stopped jobs and events feeds left in the shared definitions is gone", () => {
  it("the facet counting and filtering of job and event listings is gone", () => {
    expect(exists("src/lib/opportunities/facets.ts")).toBe(false);
    expect(exists("src/lib/opportunities/facets.test.ts")).toBe(false);
  });
});
