import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P11-06 (the owner's item 3, rule 2): back on the paper from "Back to paper", the tab and the place are
// restored once. `Reader` cannot be mounted in this Node-only suite (no jsdom: see page.test.tsx), so what the
// restore does is tested in `lib/notes/return-to-paper.test.ts` as functions over a fake page; this file holds
// the page's one call to its join, by reading the source, the way page.decided.test.ts does.

const source = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

describe("the page's one call", () => {
  it("is made once, in Reader, with the page's own reading, body, tab and tab switch", () => {
    expect(source.match(/useRestoreReaderPlace\(/g)).toHaveLength(1);
    expect(source).toContain("useRestoreReaderPlace({ paperId: paper.id, ready: fromServer, hasBody, tab, select: selectTab });");
    expect(source).toMatch(/import \{ useRestoreReaderPlace \} from "@\/lib\/notes\/return-to-paper";/);
  });

  it("comes after the tab hook it hands the switch of, inside Reader", () => {
    const tabHook = source.indexOf("useReaderTab({");
    const call = source.indexOf("useRestoreReaderPlace({");
    const reader = source.indexOf("function Reader({");

    expect(reader).toBeGreaterThan(-1);
    expect(tabHook).toBeGreaterThan(reader);
    expect(call).toBeGreaterThan(tabHook);
  });

  it("is a few lines: the page's hunk is the import, a comment and the call", () => {
    const lines = source.split("\n").filter((line) => /P11-06|useRestoreReaderPlace/.test(line));

    expect(lines.length).toBeLessThanOrEqual(5);
  });
});
