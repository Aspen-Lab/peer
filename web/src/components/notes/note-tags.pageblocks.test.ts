import { describe, expect, it, vi } from "vitest";
import * as anchorBlocks from "@/lib/notes/anchor-blocks";
import { highlightIsLost } from "./highlight-row";
import * as tags from "./note-tags";

// P11-28 (owner item 8; round 1 Theme B readers r1, r2; ruling §1h.123 (c)): what the notes' tags and rows know of a highlight on a Summary block or an
// answer. (1) The ids that name a page block are one definition, `lib/notes/anchor-blocks.ts`'s, which the tags and the store share. (2) A page block's words
// are the page's, not the paper's body: a row whose highlight is on one is never "not in this version of the paper" for the body the reader last had (the body
// does not hold the Summary's words), and the notes page keeps its square for it. (3) The painter of a page block's marks needs to know the paper on show:
// the page already registers it with the Summary's host, so the host tells it.
// Every text is invented.

describe("the ids of the page's blocks", () => {
  it("are one definition: the tags re-export the lib's", () => {
    expect(tags.SUMMARY_ID_PREFIX).toBe(anchorBlocks.SUMMARY_ID_PREFIX);
    expect(tags.ANSWERS_BLOCK_ID).toBe(anchorBlocks.ANSWERS_BLOCK_ID);
    expect(tags.SUMMARY_ID_PREFIX).toBe("summary-");
    expect(tags.ANSWERS_BLOCK_ID).toBe("answers-block");
  });
});

describe("passageIsLost for a page block", () => {
  const body = [{ paragraphs: ["Nothing of the summary is said here."] }];
  const anchor = (paragraphId: string) => ({ paperId: "p1", paragraphId, quote: "deeper layers held water", n: 0, start: 10, end: 34 });

  it("is never lost for a body that does not hold the block's words: the body is the paper's, the block is the page's", () => {
    for (const id of ["summary-proposal", "summary-abstract", "answers-block"]) expect(tags.passageIsLost(anchor(id), "h1", {}, body), id).toBe(false);
  });

  it("is not lost either when the reading page told it so, nobody tells it for a page block", () => {
    expect(tags.passageIsLost(anchor("summary-proposal"), "h1", { h1: true }, body)).toBe(false);
  });

  it("is still lost for a paragraph of the paper that the body does not hold — as it was", () => {
    expect(tags.passageIsLost(anchor("paper-section-0-p0"), "h1", {}, body)).toBe(true);
    expect(tags.passageIsLost(anchor("paper-section-0-p0"), "h1", { h1: true }, null)).toBe(true);
  });
});

describe("highlightIsLost for a page block (the notes window's and the notes page's row)", () => {
  const body = [{ paragraphs: ["Nothing of the summary is said here."] }];
  const spot = (paragraphId: string) => ({ paperId: "p1", paragraphId, quote: "deeper layers held water", start: 10, end: 34 });

  it("keeps its square: the row does not say the passage is gone", () => {
    expect(highlightIsLost("h1", spot("summary-proposal"), {}, body)).toBe(false);
    expect(highlightIsLost("h1", spot("answers-block"), {}, body)).toBe(false);
  });

  it("says it of a paragraph of the paper the body does not hold, as before", () => {
    expect(highlightIsLost("h1", spot("paper-section-0-p0"), {}, body)).toBe(true);
  });
});

describe("the Summary's host tells the painter which paper is on show", () => {
  it("registering publishes the paper; taking the registration off takes it back — and a registration that has been replaced takes nothing", () => {
    expect(tags.useBlockPaper.getState().paperId).toBeNull();
    const reveal = () => {};
    const off = tags.registerSummaryHost({ paperId: "p1", reveal });
    expect(tags.useBlockPaper.getState().paperId).toBe("p1");
    const next = tags.registerSummaryHost({ paperId: "p2", reveal });
    expect(tags.useBlockPaper.getState().paperId).toBe("p2");
    off();
    expect(tags.useBlockPaper.getState().paperId).toBe("p2");
    next();
    expect(tags.useBlockPaper.getState().paperId).toBeNull();
  });
});

describe("going to a highlight on a page block", () => {
  /** An element with a scroll and a class list, answering `querySelectorAll` with the marks it is given. */
  interface Box {
    scrollIntoView: ReturnType<typeof vi.fn>;
    classes: Set<string>;
    classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void };
    querySelectorAll: () => Box[];
  }
  function box(marks: Box[] = []): Box {
    const classes = new Set<string>();
    return {
      scrollIntoView: vi.fn(),
      classes,
      classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
      querySelectorAll: () => marks,
    };
  }
  const goal = (paragraphId: string) => ({ paperId: "p1", paragraphId, highlightId: "h1" });
  const go = (target: Box | null, paragraphId: string) =>
    tags.goToPassage(goal(paragraphId), { doc: { getElementById: () => target } as unknown as Document, navigate: () => {} });

  it("scrolls to the first of its marks, centred — a tall block (the answers) can hold the words far below its top — and flashes the marks, not the block", () => {
    const [one, two] = [box(), box()];
    const block = box([one, two]);
    go(block, "answers-block");
    expect(one.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(block.scrollIntoView).not.toHaveBeenCalled();
    expect([...one.classes]).toContain("outline-accent");
    expect([...two.classes]).toContain("outline-accent");
    expect(block.classes.size).toBe(0);
  });

  it("scrolls to the block's top and flashes the block when none of its marks is drawn (the words are not in the block now), as it did", () => {
    const block = box();
    go(block, "summary-method");
    expect(block.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect([...block.classes]).toContain("bg-accent-dim");
  });

  it("scrolls a paragraph's highlight to the paragraph's top, as it did", () => {
    const [mark, paragraph] = [box(), box()];
    paragraph.querySelectorAll = () => [mark];
    go(paragraph, "paper-section-1-p2");
    expect(paragraph.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(mark.scrollIntoView).not.toHaveBeenCalled();
    expect([...mark.classes]).toContain("outline-accent");
  });
});
