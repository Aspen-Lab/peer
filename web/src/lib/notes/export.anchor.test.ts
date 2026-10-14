import { describe, expect, it } from "vitest";
import { block } from "./blocks";
import { toMarkdown } from "./export";
import type { Note } from "./types";

// P10-09a (ruling §1h.78 (f); the owner: "the quoted words are not exported"): a sticky note's `anchor` carries the
// passage's quote, but the quote is never a block's text, so no export carries it.

const QUOTE = "The finest grains crept fastest, a sentence from the paper.";

describe("an anchor never reaches an export", () => {
  const note: Note = {
    id: "n",
    title: "Paper",
    blocks: [
      block("h3", "Note 1", { anchor: { paperId: "p1", paragraphId: "paper-section-1-p2", quote: QUOTE, n: 1 } }),
      block("text", "my own words about it"),
    ],
    sources: {},
    stickyCount: 1,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  };

  it("writes the sticky's number and the reader's words, and not the quote", () => {
    const md = toMarkdown(note);
    expect(md).toContain("### Note 1");
    expect(md).toContain("my own words about it");
    expect(md).not.toContain("finest grains");
    expect(md).not.toContain("paper-section-1-p2");
  });
});
