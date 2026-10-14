import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P10-09f (walk X-A4, BACKLOG-68; rule 4): the deleted "Terms to know" strip left dead code behind — the body's
// `termMark` prop and its <mark> branch, `--color-term-mark` in the stylesheet, and comments naming the strip.
// They go with the feature. The pins read the sources (the strip's own absence is `no-terms-strip.test.tsx`'s).

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("the Terms strip's dead code is gone", () => {
  it("paper-body.tsx has no termMark prop, no term <mark> branch and no TermOccurrence import", () => {
    const body = read("src/components/reader/paper-body.tsx");
    expect(body).not.toMatch(/termMark|data-term-mark|MarkedParagraph|TermOccurrence/);
    expect(body).not.toContain("term-mark");
  });

  it("globals.css has no --color-term-mark in any palette block, and no comment naming the strip at the token", () => {
    const css = read("src/app/globals.css");
    expect(css).not.toContain("term-mark");
    expect(css).not.toContain("the Terms to know highlight");
  });

  it("the files that only mentioned the strip in a comment no longer do", () => {
    for (const file of [
      "src/components/reader/use-reader-tab.ts",
      "src/components/reader/use-reader-tab.test.ts",
      "src/app/papers/[id]/page.paragraph-guide.test.ts",
      "src/lib/papers/terms.ts",
    ]) {
      expect(read(file), file).not.toContain("Terms to know");
    }
  });
});
