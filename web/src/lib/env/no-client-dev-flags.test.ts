import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ABC-freemium 1-16 · R-ENT-3 (as amended by Ruling 2 point 2).
 *
 * **A's scan 2, turned from a grep into a gate.** The requirement's intent is
 * that *no code shipped to the browser decides whether AI is available by
 * testing `NODE_ENV`*. Round-1 A found six such tests; a human running a grep
 * once a round is the only thing that would notice a seventh appearing, and a
 * grep is not a gate.
 *
 * The allow-list below is every remaining occurrence in non-test source, each
 * with the reason it is allowed. **All four are server-only.** Adding a file
 * here is a decision: if the new occurrence ships to the browser and gates AI,
 * entitlement, or an AI-dependent UI state, it belongs in `aiAvailability`
 * instead (R-ENT-3), and the escape clause in Ruling 2 point 2 applies — stop
 * and record rather than widening this list.
 */
const ALLOWED: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "src/lib/env/local-dev.ts",
    why: "THE shared predicate. Server-side; the single home of the three-condition test that registry.ts, ai-request.ts and resolveEntitlement all read.",
  },
  {
    file: "src/app/auth/callback/route.ts",
    why: "Server route. Chooses the redirect origin after OAuth; nothing to do with AI.",
  },
  {
    file: "src/lib/opportunities/pool-cache-disk.ts",
    why: "Server-side cache adapter. Decides whether pools persist to disk; nothing to do with AI.",
  },
  {
    file: "src/lib/opportunities/pool-cache-runtime.ts",
    why: "Server-side cache selection, disk vs Supabase; nothing to do with AI.",
  },
];

const NEEDLE = 'process.env.NODE_ENV === "development"';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/** A's own mechanical filter: drop lines that are comments. */
function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

describe("no client code decides AI availability from NODE_ENV", () => {
  it("has no development test outside the allow-list", () => {
    const root = path.join(process.cwd(), "src");
    const found = new Set<string>();

    for (const file of sourceFiles(root)) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (isComment(line)) continue;
        if (!line.includes(NEEDLE)) continue;
        found.add(path.relative(process.cwd(), file).replace(/\\/g, "/"));
      }
    }

    const allowed = new Set(ALLOWED.map((entry) => entry.file));
    const unexpected = [...found].filter((file) => !allowed.has(file)).sort();

    expect(unexpected).toEqual([]);
  });

  it("keeps the allow-list honest — every entry still has an occurrence", () => {
    // Without this, an entry that was cleaned up long ago sits here forever and
    // quietly re-authorises the same file if it comes back.
    for (const { file } of ALLOWED) {
      const full = path.join(process.cwd(), file);
      expect(fs.existsSync(full), `${file} is on the allow-list but is gone`).toBe(
        true,
      );
      const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
      const hit = lines.some((line) => !isComment(line) && line.includes(NEEDLE));
      expect(hit, `${file} is on the allow-list but no longer matches`).toBe(true);
    }
  });
});
