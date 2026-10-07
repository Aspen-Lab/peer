import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Peer has no model of its own, and no rendered string may say it does.**
 *
 * The copy used to promise "Peer's AI is included", "no key needed", a free
 * plan that "works with zero setup" and a price. A source scan is the right
 * gate because that copy lives in JSX, where no unit test reaches it, and it
 * reappears the way it first arrived: somebody writing a friendly sentence.
 *
 * The comment filter is `ui-vocabulary.test.ts`'s: a line whose first non-space
 * characters are `//`, `*`, `/*` or `{/*` is prose about the code, not copy.
 * (`lib/feed/ui-vocabulary.test.ts` separately bans the tier vocabulary and the
 * word "BYOK" in rendered strings.)
 */

const PHRASES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: "Peer's own model / Peer's AI",
    pattern: /Peer(?:&apos;|'|’)s (?:own )?(?:model|AI)\b/i,
  },
  { name: "AI is included", pattern: /\bAI is included\b/i },
  { name: "no key needed / no key is needed", pattern: /\bno key (?:is )?needed\b/i },
  { name: "zero setup", pattern: /\bzero setup\b/i },
  { name: "works free", pattern: /\bworks (?:fully )?free\b/i },
  { name: "Peer Pro", pattern: /\bPeer Pro\b/ },
  { name: "a trial of the plan", pattern: /\b(?:free trial|trial ends|days left)\b/i },
];

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
    trimmed.startsWith("/*") ||
    trimmed.startsWith("{/*")
  );
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (isComment(line) || !pattern.test(line)) return;
        found.push(`${rel}:${index + 1} ${line.trim()}`);
      });
  }
  return found.sort();
}

describe("no rendered string claims a model of Peer's own", () => {
  for (const { name, pattern } of PHRASES) {
    it(`has no "${name}" outside a comment`, () => {
      expect(offenders(pattern)).toEqual([]);
    });
  }
});
