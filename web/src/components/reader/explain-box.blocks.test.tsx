import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";
import { requestExplanation } from "./explain-box";

// P11-42 (round 2, Theme B readers r1, r2, r3; ruling §1h.139 (b)): the request the page makes for a selection in a figure's caption or a section's heading is the
// one it makes for a paragraph's — the paper, the passage, the section's id, the block's number in it (`paragraphIndex`: the paragraphs, then the heading, then the
// captions; `lib/notes/anchor-blocks.ts`) and an empty thread. It says nothing of the kind of block: the route reads that from the number. Every text is invented.

const paper: Paper = {
  id: "upload:0123456789abcdef", title: "A paper", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answer: { meaning: "A share.", here: { text: "It compares.", peer: true } }, cached: false }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const bodyOf = (fetchMock: ReturnType<typeof stubFetch>, call = 0) => JSON.parse(String((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

describe("requestExplanation — a caption's or a heading's selection (P11-42 rule 2)", () => {
  it("posts the same fields as a paragraph's selection, the block's number in place of the paragraph's, and no word about the block's kind", async () => {
    const fetchMock = stubFetch();
    const place = { sectionIndex: 1, passage: "Figure 2 · Rafting ratio against creep time" };
    await requestExplanation({ paper, selection: { ...place, paragraphIndex: 1 }, sectionId: "s2" });
    await requestExplanation({ paper, selection: { ...place, paragraphIndex: 3, source: "paper", paragraphId: "paper-section-1-p3", block: "caption" } as never, sectionId: "s2" });
    await requestExplanation({ paper, selection: { ...place, passage: "2 Methods", paragraphIndex: 2, source: "paper", paragraphId: "paper-section-1-p2", block: "heading" } as never, sectionId: "s2" });

    expect(bodyOf(fetchMock, 0)).toEqual({ paper, passage: place.passage, sectionId: "s2", paragraphIndex: 1, thread: [] });
    expect(bodyOf(fetchMock, 1)).toEqual({ paper, passage: place.passage, sectionId: "s2", paragraphIndex: 3, thread: [] });
    expect(bodyOf(fetchMock, 2)).toEqual({ paper, passage: "2 Methods", sectionId: "s2", paragraphIndex: 2, thread: [] });
    expect(Object.keys(bodyOf(fetchMock, 1))).toEqual(Object.keys(bodyOf(fetchMock, 0)));
  });
});

describe("the gate in the box (P11-42 rule 2)", () => {
  it("the box has no gate on a selection's block any more: no `isExplainable`, no `blocked` constant", () => {
    const box = readFileSync(resolve(process.cwd(), "src/components/reader/explain-box.tsx"), "utf8").replace(/\s+/g, " ");

    expect(box).not.toContain("isExplainable");
    expect(box).not.toContain("const blocked");
    expect(box).toContain("const target = given;");
  });
});
