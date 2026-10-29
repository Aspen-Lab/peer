import { describe, expect, it } from "vitest";
import { block } from "./blocks";
import { toMarkdown, toPlainText, toPrintHtml, toWordHtml } from "./export";
import type { Note } from "./types";

describe("portable nested note lists", () => {
  it("uses two-space Markdown nesting and preserves the hierarchy in every export", () => {
    const note: Note = { id: "nested", title: "Nested", sources: {}, createdAt: "2026-10-23", updatedAt: "2026-10-23", blocks: [block("bullet", "parent"), block("bullet", "child", { indent: 1 }), block("bullet", "leaf", { indent: 2 })] };
    expect(toMarkdown(note)).toContain("- parent\n  - child\n    - leaf");
    expect(toPlainText(note)).toContain("- parent\n  - child\n    - leaf");
    for (const html of [toWordHtml(note), toPrintHtml(note)]) {
      expect(html.match(/<ul>/g)).toHaveLength(3);
      expect(html).toContain("child");
    }
  });
});
