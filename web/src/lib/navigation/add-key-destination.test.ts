import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADD_KEY_HREF } from "./add-key-destination";

/**
 * **The constant is worth nothing if a call site can quietly retype the
 * string.** A call to action pointing at `/settings` (a route that never
 * existed) was exactly that failure with three hand-typed copies instead of one
 * shared value, and it survived five rounds. This is the scan that stops a
 * second surface reintroducing a literal.
 *
 * The comment filter is `ui-vocabulary.test.ts`'s, unchanged: a line whose
 * first non-space characters are `//`, `*` or `/*` is prose, not a destination.
 * `welcome/completeness.ts` documents the shareable query in its docblock and
 * that is the one place the string legitimately appears as English.
 */

const LITERAL = "/welcome?step=ai";

/** Where the literal is allowed to live: the module that defines it. */
const OWNER = "src/lib/navigation/add-key-destination.ts";

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

describe("one add-a-key destination, one place", () => {
  it("is the welcome wizard's AI step, the page where a key is added", () => {
    expect(ADD_KEY_HREF).toBe(LITERAL);
  });

  it("has zero surviving literals outside the module that defines it", () => {
    const survivors = survivingLiterals()
      .map((hit) => `${hit.file}:${hit.line} ${hit.text}`)
      .sort();

    expect(survivors).toEqual([]);
  });

  // A "no reference left to `/settings`" case was written for the earlier
  // version of this file and deliberately removed rather than repaired: it
  // fired on a JSX comment that RECORDED the defect, and it was redundant. The
  // dead-link scan (`dead-links.test.ts`) resolves EVERY internal link against
  // the real route tree with no allowlist, so it catches `/settings` and every
  // other dead route, generally instead of by name.
});
