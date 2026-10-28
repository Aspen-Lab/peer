import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADD_KEY_HREF, SIGN_IN_HREF, paperReturnPath, signInHref } from "./add-key-destination";

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

  // `dead-links.test.ts` cannot resolve a destination held in a constant, so the
  // sign-in link's is resolved here: the Profile page, whose first block is the
  // Account section with the sign-in buttons.
  it("the sign-in destination for a reader with a key who is signed out is the Profile page, a real route", () => {
    expect(SIGN_IN_HREF).toBe("/profile");
    expect(fs.existsSync(path.join(process.cwd(), "src/app/profile/page.tsx"))).toBe(true);
    const profile = fs.readFileSync(path.join(process.cwd(), "src/app/profile/page.tsx"), "utf8");
    expect(profile).toContain("<AccountSection");
  });

  // The paper page's "Sign in" asks to come back to the paper:
  // `/profile?return=<encodeURIComponent('/papers/' + encodeURIComponent(id))>`.
  describe("the way back to a paper after sign-in", () => {
    const IDS = ["openalex:W7204479535", "arxiv:2609.02113", "upload:0123456789abcdef", "arxiv:hep-th/9901001", "a?b#c d"];

    it("a paper's path is /papers/ and its id as one encoded segment, which the page decodes back to the id", () => {
      expect(paperReturnPath("openalex:W7204479535")).toBe("/papers/openalex%3AW7204479535");
      for (const id of IDS) {
        const back = paperReturnPath(id);
        const segment = back.slice("/papers/".length);
        expect(back.startsWith("/papers/")).toBe(true);
        expect(segment).not.toMatch(/[/?#\s]/);
        expect(decodeURIComponent(segment)).toBe(id);
      }
    });

    it("the sign-in link carries it as one `return` value that reads back exactly", () => {
      for (const id of IDS) {
        const href = signInHref(paperReturnPath(id));
        const url = new URL(href, "https://peer.homes");
        expect(url.pathname).toBe(SIGN_IN_HREF);
        expect([...url.searchParams.keys()]).toEqual(["return"]);
        expect(url.searchParams.get("return")).toBe(paperReturnPath(id));
      }
      expect(signInHref("/papers/openalex%3AW1")).toBe("/profile?return=%2Fpapers%2Fopenalex%253AW1");
    });

    it("with no path to come back to, it is the plain Profile link", () => {
      expect(signInHref()).toBe(SIGN_IN_HREF);
      expect(signInHref("")).toBe(SIGN_IN_HREF);
    });
  });

  // A "no reference left to `/settings`" case was written for the earlier
  // version of this file and deliberately removed rather than repaired: it
  // fired on a JSX comment that RECORDED the defect, and it was redundant. The
  // dead-link scan (`dead-links.test.ts`) resolves EVERY internal link against
  // the real route tree with no allowlist, so it catches `/settings` and every
  // other dead route, generally instead of by name.
});
