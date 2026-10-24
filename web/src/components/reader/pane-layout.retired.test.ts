import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as paneLayout from "./pane-layout";

// P11-17c rule 5 (C P11-16 "For the manager"; ruling §1h.117): `defaultsFit` stated a fact — all three panes pinned at their defaults fit from
// 1144 css px — and decided the first visit until C P11-16 pinned it at every width from 1024 (ruling §1h.115 item 4). Since then nothing imports
// it but its own test, so it was retired with that test (`pane-layout.test.ts`, its describe "defaultsFit": one case, "is true from 1144 css px and
// false below it").
//
// P11-20 rule 3 (C P11-17c "For the manager" 6; ruling §1h.118): the other number that stated the same fact, `PINNED_DEFAULTS_MIN_VIEWPORT_PX`
// (1144), had no importer outside its own tests either — the first visit is pinned at every width from 1024 — and is retired the same way, with its
// tests: this file's case "the fact it stated is still held by a number: all three panes pinned at their defaults need 1144", and the 1144 lines of
// `pane-layout.test.ts`'s case "all three panes pinned at the defaults need 1144 px; the narrowest panes need less than the shell's minimum" (re-aimed:
// the narrowest panes' 984 and 792 stay). This pins their absence: not exported, not used, not defined again. (This file names them only to forbid them.)

const RETIRED = ["defaultsFit", "PINNED_DEFAULTS_MIN_VIEWPORT_PX"] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("defaultsFit and PINNED_DEFAULTS_MIN_VIEWPORT_PX are retired (rulings §1h.117, §1h.118)", () => {
  for (const name of RETIRED) {
    it(`pane-layout.ts exports no ${name}, and does not define it`, () => {
      expect(Object.keys(paneLayout)).not.toContain(name);
      const source = readFileSync(resolve(process.cwd(), "src/components/reader/pane-layout.ts"), "utf8");
      expect(source).not.toMatch(new RegExp(`function\\s+${name}\\b|const\\s+${name}\\b`));
    });
  }

  it("no file under src/ imports or defines it, and no source file names it outside a comment (this test names it only to forbid it)", () => {
    const root = resolve(process.cwd(), "src");
    const self = resolve(process.cwd(), "src/components/reader/pane-layout.retired.test.ts");
    const users = sourceFiles(root)
      .filter((file) => file !== self)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        if (/\.test\.tsx?$/.test(file)) return RETIRED.some((name) => new RegExp(`import[^;]*\\b${name}\\b[^;]*from|const\\s+${name}\\b|function\\s+${name}\\b`).test(text));
        return new RegExp(`\\b(${RETIRED.join("|")})\\b`).test(text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));
      })
      .map((file) => relative(root, file));
    expect(users).toEqual([]);
  });
});
