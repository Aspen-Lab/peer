import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAIN_DEFAULT_LEVEL, PLAIN_LEVELS, isPlainLevel } from "./plain-levels";
import * as plain from "./plain";

// P4-01 (blueprint §3.6; user decision §1a.5 (b)): the three levels of "Say it plainly".
// The list is the one the browser (the store, the button) and the server (the route, the
// prompt) both read, so it lives in a module with no import at all: `plain.ts` hashes with
// `node:crypto` and imports `explain.ts`, which the browser's bundle must never pull in.

describe("the three levels", () => {
  it("are high school, undergrad and graduate, in that order, and undergrad is the default", () => {
    expect([...PLAIN_LEVELS]).toEqual(["highschool", "undergrad", "graduate"]);
    expect(PLAIN_DEFAULT_LEVEL).toBe("undergrad");
    expect(PLAIN_LEVELS).toContain(PLAIN_DEFAULT_LEVEL);
  });

  it("are recognised by `isPlainLevel`, and nothing else is", () => {
    for (const level of PLAIN_LEVELS) expect(isPlainLevel(level)).toBe(true);
    for (const other of ["phd", "Undergrad", "", " undergrad", "undergrad ", 1, null, undefined, {}, ["undergrad"], true]) {
      expect(isPlainLevel(other)).toBe(false);
    }
  });

  it("are the same list `plain.ts` hands the server (re-exported, not copied)", () => {
    expect(plain.PLAIN_LEVELS).toBe(PLAIN_LEVELS);
    expect(plain.PLAIN_DEFAULT_LEVEL).toBe(PLAIN_DEFAULT_LEVEL);
    expect(plain.isPlainLevel).toBe(isPlainLevel);
  });

  it("sit in a module with no import, so the browser can take the list without the server's code", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/papers/plain-levels.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/node:/);
  });
});
