import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// P9-30 (§1h.59 (d), from B P9-25 §5.4's note): the Vercel project's Root
// Directory is `web/`, and Vercel reads `vercel.json` from the Root Directory.
// The daily upload-purge cron sat in a `vercel.json` at the REPOSITORY root, so
// Vercel never saw its `crons` and the purge was not scheduled. The config now
// lives at `web/vercel.json`. This pins both halves so the two can never drift:
// the cron is in the file Vercel reads, and no copy sits where Vercel does not
// look (a root file would look live while being ignored, and mislead the next
// reader into thinking the schedule is on).
//
// Vitest runs with `process.cwd()` = `web/`.
const webConfigPath = path.join(process.cwd(), "vercel.json");
const rootConfigPath = path.join(process.cwd(), "..", "vercel.json");

describe("P9-30: the Vercel config lives in the project's Root Directory (web/)", () => {
  it("web/vercel.json exists and parses as JSON", () => {
    expect(fs.existsSync(webConfigPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(webConfigPath, "utf8")) as unknown;
    expect(parsed).toBeTypeOf("object");
    expect(parsed).not.toBeNull();
  });

  it("lists the daily purge-uploads cron, once, at 03:17 UTC", () => {
    const config = JSON.parse(fs.readFileSync(webConfigPath, "utf8")) as {
      crons?: { path: string; schedule: string }[];
    };
    expect(Array.isArray(config.crons)).toBe(true);
    const purge = (config.crons ?? []).filter((entry) => entry.path === "/api/jobs/purge-uploads");
    expect(purge).toEqual([{ path: "/api/jobs/purge-uploads", schedule: "17 3 * * *" }]);
  });

  it("the cron's path is a route that exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/app/api/jobs/purge-uploads/route.ts"))).toBe(true);
  });

  it("no vercel.json remains at the repository root (Vercel does not read it there)", () => {
    expect(fs.existsSync(rootConfigPath)).toBe(false);
  });
});
