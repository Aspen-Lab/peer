import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const migrations = path.join(process.cwd(), "supabase", "migrations");

function readMigration(name: string): string {
  return fs.readFileSync(path.join(migrations, name), "utf8");
}

function readMigrationBytes(name: string): Buffer {
  return fs.readFileSync(path.join(migrations, name));
}

function readUpstreamMigrationBytes(name: string): Buffer {
  return execFileSync(
    "git",
    ["show", `origin/freemium-round10:web/supabase/migrations/${name}`],
    { encoding: "buffer" },
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const exactUpstreamMigrations = {
  "20260904000000_usage_counters.sql": "11e257eb0f472d86cd0d8bfccbd31392586f3ef27baee93171f85817d74e34ff",
  "20260904000100_usage_events.sql": "d965a3bac8a21121bce31ee59b5061584ebf9f2b3a765c64d8d48e831ae0c673",
  "20260904000200_profile_plan.sql": "38951eaa6656616f8595f7b4ce0a7f61b302080d3c1e09f4f766bac5ac9fdb78",
} as const;

describe("upstream Supabase security foundation", () => {
  it("retains the three upstream migrations byte-for-byte, including rationale comments", () => {
    for (const [name, expectedSha] of Object.entries(exactUpstreamMigrations)) {
      const local = readMigrationBytes(name);
      const upstream = readUpstreamMigrationBytes(name);
      expect(sha256(upstream)).toBe(expectedSha);
      expect(local).toEqual(upstream);
    }
  });

  it("keeps counter storage private and its increment RPC service-role-only", () => {
    const sql = readMigration("20260904000000_usage_counters.sql");
    expect(sql).toContain("alter table public.usage_counters enable row level security");
    expect(sql).toContain("revoke all on table public.usage_counters from anon, authenticated");
    expect(sql).toContain("grant execute on function public.increment_usage_counter");
    expect(sql).toContain("to service_role");
  });

  it("keeps usage events inaccessible to browser roles", () => {
    const sql = readMigration("20260904000100_usage_events.sql");
    expect(sql).toContain("alter table public.usage_events enable row level security");
    expect(sql).toContain("revoke all on table public.usage_events from anon, authenticated");
    expect(sql).not.toMatch(/^\s*(credential|api_key)\s+(text|varchar)/im);
  });

  it("keeps profile plan fields server-owned while later migrations retain their own grants", () => {
    const plan = readMigration("20260904000200_profile_plan.sql");
    const intent = readMigration("20260922010000_profile_feed_intent.sql");
    expect(plan).toContain("revoke update, insert on public.profiles from anon, authenticated");
    expect(plan).toContain("column_name not in ('plan', 'trial_started_at', 'trial_ends_at', 'plan_updated_at')");
    expect(intent).toContain("grant update (feed_intent) on public.profiles to authenticated");
    expect(intent).toContain("grant insert (feed_intent) on public.profiles to authenticated");
  });
});
