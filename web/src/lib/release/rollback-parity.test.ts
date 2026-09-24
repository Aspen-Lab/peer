/**
 * Proves every campaign migration under web/supabase/migrations/2026092*.sql
 * has a matching, same-stem rollback file in web/supabase/rollback/, and
 * that every rollback file carries the required disclosure header. This is
 * the only mechanical guard against a concurrent writer (this campaign, or
 * a later one) adding a new migration without an accompanying rollback
 * design — see web/supabase/rollback/README.md for what these files are
 * (and are not) for.
 *
 * Nothing in this repo ever applies a file in web/supabase/rollback/
 * automatically — no script, no CI step, no Supabase CLI migration runner
 * looks at that folder. This test only checks that the files EXIST and
 * carry the disclosure header; it never parses SQL semantics and never
 * runs any SQL. (A separate, manual sweep — not this test — greps
 * package.json/CI/Supabase config for the word "rollback" to confirm
 * nothing auto-runs these files; see docs/JEV-RELEASE-READINESS.md.)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RELEASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(RELEASE_DIR, "../../../supabase/migrations");
const ROLLBACK_DIR = path.join(RELEASE_DIR, "../../../supabase/rollback");

/** Same glob scope this release-readiness slice uses everywhere else: `web/supabase/migrations/2026092*.sql`. */
function campaignMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.startsWith("2026092") && name.endsWith(".sql"))
    .sort();
}

function rollbackFileNameFor(migrationFile: string): string {
  return `${migrationFile.replace(/\.sql$/, "")}_rollback.sql`;
}

/** The exact phrase every rollback file's header must contain, verbatim (em dash, not a hyphen). */
const REQUIRED_HEADER_PHRASE = "NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY";

describe("rollback parity — every 2026-09-2x migration has an authored-only rollback file", () => {
  const migrations = campaignMigrationFiles();

  it("finds at least one campaign migration to check (a canary in case the glob or directory ever moves)", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it.each(migrations)("%s has a same-stem rollback file in web/supabase/rollback/", (migrationFile) => {
    const rollbackPath = path.join(ROLLBACK_DIR, rollbackFileNameFor(migrationFile));
    expect(existsSync(rollbackPath)).toBe(true);
  });

  it.each(migrations)("%s's rollback file states it is not a migration and is never applied automatically", (migrationFile) => {
    const rollbackPath = path.join(ROLLBACK_DIR, rollbackFileNameFor(migrationFile));
    expect(existsSync(rollbackPath)).toBe(true);
    const content = readFileSync(rollbackPath, "utf8");
    expect(content).toContain(REQUIRED_HEADER_PHRASE);
  });

  it("web/supabase/rollback/ has no stray *_rollback.sql file without a matching forward migration", () => {
    expect(existsSync(ROLLBACK_DIR)).toBe(true);
    const expected = new Set(migrations.map(rollbackFileNameFor));
    const actual = readdirSync(ROLLBACK_DIR).filter((name) => name.endsWith("_rollback.sql"));
    for (const file of actual) {
      expect(expected.has(file)).toBe(true);
    }
  });

  it("web/supabase/rollback/ has exactly one rollback file per campaign migration — counts match", () => {
    expect(existsSync(ROLLBACK_DIR)).toBe(true);
    const actual = readdirSync(ROLLBACK_DIR).filter((name) => name.endsWith("_rollback.sql"));
    expect(actual.length).toBe(migrations.length);
  });
});
