/**
 * Proves `web/supabase/functions/jev-broker/{types,rubric,jev-contract,
 * jev-client}.ts` are exactly their `web/src/lib/decisions/` sources, plus
 * exactly one documented, mechanical transform: every RELATIVE sibling
 * import among this same set of four files gains an explicit `.ts`
 * extension (Deno's module resolution requires it; a bundler's does not).
 * Nothing else may differ — if a future edit to a source file's LOGIC is
 * not mirrored into its copy, this test fails, since the transformed source
 * and the actual copy-file content are compared byte-for-byte.
 *
 * The Edge Function's own runtime is BLOCKED this campaign (no Deno CLI) —
 * this test is the only verification these copies get, so it is
 * deliberately strict rather than a loose "looks similar" check.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DECISIONS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FUNCTION_DIR = path.join(DECISIONS_DIR, "../../../supabase/functions/jev-broker");

const COPIED_FILES = ["types.ts", "rubric.ts", "jev-contract.ts", "jev-client.ts"] as const;

/** Only relative specifiers naming one of these four sibling modules gain a `.ts` extension — nothing else is touched. */
const RELATIVE_SPECIFIER = /from (["'])\.\/(types|rubric|jev-contract|jev-client)\1/g;

function normalizeForDeno(source: string): string {
  return source.replace(RELATIVE_SPECIFIER, (_match: string, quote: string, name: string) => `from ${quote}./${name}.ts${quote}`);
}

describe("broker-parity — supabase/functions/jev-broker's copies match web/src/lib/decisions exactly", () => {
  it.each(COPIED_FILES)("%s is byte-identical to its source, plus exactly the documented .ts specifier normalization", (file) => {
    const sourceContent = readFileSync(path.join(DECISIONS_DIR, file), "utf8");
    const copyContent = readFileSync(path.join(FUNCTION_DIR, file), "utf8");
    expect(copyContent).toBe(normalizeForDeno(sourceContent));
  });

  it("normalization is idempotent — applying it a second time changes nothing further (proves it isn't silently under- or over-matching)", () => {
    for (const file of COPIED_FILES) {
      const sourceContent = readFileSync(path.join(DECISIONS_DIR, file), "utf8");
      const onceNormalized = normalizeForDeno(sourceContent);
      const twiceNormalized = normalizeForDeno(onceNormalized);
      expect(twiceNormalized).toBe(onceNormalized);
    }
  });

  it("types.ts has no relative sibling imports of its own, so its copy is completely untouched — including its @/lib/feed/* type-only imports, left unresolved by design (erased before Deno's module resolution ever runs; UNVERIFIED, no Deno runtime available)", () => {
    const typesSource = readFileSync(path.join(DECISIONS_DIR, "types.ts"), "utf8");
    const typesCopy = readFileSync(path.join(FUNCTION_DIR, "types.ts"), "utf8");
    expect(typesCopy).toBe(typesSource);
    expect(typesCopy).toContain('from "@/lib/feed/intent"');
    expect(typesCopy).toContain('from "@/lib/feed/senses"');
  });

  it("every copied file's relative imports carry an explicit .ts extension", () => {
    for (const file of COPIED_FILES) {
      const copyContent = readFileSync(path.join(FUNCTION_DIR, file), "utf8");
      const relativeImports = copyContent.match(/from ["']\.\/[^"']+["']/g) ?? [];
      for (const importLine of relativeImports) {
        expect(importLine).toMatch(/\.ts["']$/);
      }
    }
  });

  it("the copy directory contains exactly the 4 pure-core files plus the thin index.ts entry — no stray or missing files", () => {
    const entries = readdirSync(FUNCTION_DIR).sort();
    // P3-S4-FIX2 (F-M-P3-01): counter-keys.ts is a pure Edge-only module, not a parity copy of a web/src file
    expect(entries).toEqual(["counter-keys.ts", "index.ts", "jev-client.ts", "jev-contract.ts", "rubric.ts", "types.ts"]);
  });
});
