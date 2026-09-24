import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UPGRADE_HREF } from "./upgrade-destination";

/**
 * ABC-freemium 7-02(a) · Ruling 18 point 5 · Ruling 19 point 2(a).
 *
 * **The constant is worth nothing if a call site can quietly retype the
 * string.** `QuotaNotice` pointing at `/settings` was exactly that failure with
 * three hand-typed copies instead of one shared value, and it survived five
 * rounds. This is the scan that stops a fourth surface reintroducing a literal.
 *
 * The comment filter is `ui-vocabulary.test.ts`'s, unchanged: a line whose
 * first non-space characters are `//`, `*` or `/*` is prose, not a destination.
 * `welcome/completeness.ts` documents the shareable query in its docblock and
 * that is the one place the string legitimately appears as English.
 */

const LITERAL = "/welcome?step=ai";

/** Where the literal is allowed to live: the module that defines it. */
const OWNER = "src/lib/navigation/upgrade-destination.ts";

interface Hit {
  file: string;
  line: number;
  text: string;
}

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

function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

function toPosix(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function survivingLiterals(): Hit[] {
  const found: Hit[] = [];
  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const rel = toPosix(file);
    if (rel === OWNER) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (isComment(line) || !line.includes(LITERAL)) return;
      found.push({ file: rel, line: index + 1, text: line.trim() });
    });
  }
  return found;
}

describe("one upgrade destination, one place (7-02a)", () => {
  it("is the route the two honest surfaces already used", () => {
    // Ruling 18's ruled direction: unify on the destination that is real, not
    // on the one two of three surfaces happened to share by accident.
    expect(UPGRADE_HREF).toBe(LITERAL);
  });

  it("has zero surviving literals outside the module that defines it", () => {
    const survivors = survivingLiterals()
      .map((hit) => `${hit.file}:${hit.line} ${hit.text}`)
      .sort();

    expect(survivors).toEqual([]);
  });

  // A third case was written here and deliberately removed rather than
  // repaired: "no reference left to `/settings`". It fired on the JSX comment
  // in `quota-notice.tsx` that RECORDS the defect — prose the reader can never
  // see — and the only ways to make it pass were to stop naming the bug in the
  // comment or to widen the comment filter to JSX openers, which §3 forbids
  // doing inline. It was also redundant: the dead-link scan of 7-02(c) resolves
  // EVERY internal link against the real route tree with no allowlist, so it
  // catches `/settings` and every other dead route, generally instead of by
  // name. One general guard beats one general guard plus a brittle specific
  // one.
});
