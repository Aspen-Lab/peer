import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The owners' co-ownership agreement (Section 4.4) asks for a kept record of
 * every third-party component. The npm part of that record is the generated
 * table in docs/THIRD_PARTY_NOTICES.md; this test fails when it no longer
 * matches web/package-lock.json, so a dependency change cannot land without
 * its entry.
 *
 * Spawned, not imported, like `assert-byok-production-env.test.ts`: the
 * script's contract is an exit code, and `--check` calls `process.exit(1)`.
 * It lives under `src/` because Vitest only collects `src/**​/*.test.{ts,tsx}`.
 */

const SCRIPT = path.join(process.cwd(), "scripts", "third-party-list.mjs");

describe("third-party notices", () => {
  it("list every npm package in the lockfile with its license", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--check"], { encoding: "utf8" });
    // The script's own message says which command regenerates the table.
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });
});
