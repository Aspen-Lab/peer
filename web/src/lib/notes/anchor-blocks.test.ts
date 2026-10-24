import { afterEach, describe, expect, it } from "vitest";
import {
  anchorBlocks,
  anchorTextOnShow,
  blockAt,
  captionBlock,
  captionText,
  headingBlock,
  parseAnchorId,
  setBodyOnShow,
  type AnchorSection,
} from "./anchor-blocks";

// P11-27 rule 2 (owner items 5 and 8; round 1's walk X-4; ruling §1h.122): a selection in a figure's caption or in a section's heading is
// offered Take notes and Highlight like a paragraph's, so each caption and each heading needs an anchor of its own. The id keeps the shape every
// consumer of an anchor already reads (`paper-section-<k>-p<n>`): the section's blocks are its paragraphs (0 .. P − 1), then its heading (P), then
// its figures' captions in the order the section holds them (P + 1 + k). The text of a block is what the page draws: a caption is its label, then
// " · ", then its words (and the page of the PDF where the picture is not drawn). Every text is invented.

const SECTION: AnchorSection = {
  paragraphs: ["Creep limits the life.", "Grain boundaries carry the strain."],
  heading: "2 Methods",
  figures: [
    { label: "Figure 1", caption: "Creep against density.", imageUrl: "/f1.png", page: 3 },
    { label: "Figure 2", caption: "A sketch of the specimen." },
    { label: "Figure 3", caption: "", page: 5 },
  ],
};

afterEach(() => setBodyOnShow(null));

describe("captionText — the words the page draws in a figure's caption", () => {
  it("is the label, a middle dot, and the caption's words", () => {
    expect(captionText({ label: "Figure 1", caption: "Creep against density.", imageUrl: "/f1.png", page: 3 })).toBe("Figure 1 · Creep against density.");
  });

  it("is the label alone when the caption says nothing", () => {
    expect(captionText({ label: "Figure 3", caption: "", imageUrl: "/f3.png" })).toBe("Figure 3");
    expect(captionText({ label: "Figure 3", imageUrl: "/f3.png" })).toBe("Figure 3");
  });

  it("ends with the PDF page where the picture is not drawn (no picture, and a page to say)", () => {
    expect(captionText({ label: "Figure 2", caption: "A sketch.", page: 4 })).toBe("Figure 2 · A sketch. · p.4 of the PDF");
    expect(captionText({ label: "Figure 3", caption: "", page: 5 })).toBe("Figure 3 · p.5 of the PDF");
    // A picture that has a source is drawn: the page is not said.
    expect(captionText({ label: "Figure 1", caption: "A sketch.", imageUrl: "/f.png", page: 4 })).toBe("Figure 1 · A sketch.");
    expect(captionText({ label: "Figure 2", caption: "A sketch." })).toBe("Figure 2 · A sketch.");
  });
});

describe("the section's blocks — paragraphs, then the heading, then the captions", () => {
  it("puts the heading right after the paragraphs and each caption after it, in the figures' order", () => {
    expect(headingBlock(SECTION)).toBe(2);
    expect(captionBlock(SECTION, 0)).toBe(3);
    expect(captionBlock(SECTION, 1)).toBe(4);
    expect(captionBlock(SECTION, 2)).toBe(5);
  });

  it("reads each block's kind and text", () => {
    expect(blockAt(SECTION, 0)).toEqual({ kind: "paragraph", text: "Creep limits the life." });
    expect(blockAt(SECTION, 1)).toEqual({ kind: "paragraph", text: "Grain boundaries carry the strain." });
    expect(blockAt(SECTION, 2)).toEqual({ kind: "heading", text: "2 Methods" });
    expect(blockAt(SECTION, 3)).toEqual({ kind: "caption", text: "Figure 1 · Creep against density." });
    expect(blockAt(SECTION, 4)).toEqual({ kind: "caption", text: "Figure 2 \u00b7 A sketch of the specimen." });
    expect(blockAt(SECTION, 5)).toEqual({ kind: "caption", text: "Figure 3 · p.5 of the PDF" });
  });

  it("has no block past the last caption, none below 0, none that is not a whole number, and none for no section", () => {
    expect(blockAt(SECTION, 6)).toBeUndefined();
    expect(blockAt(SECTION, -1)).toBeUndefined();
    expect(blockAt(SECTION, 1.5)).toBeUndefined();
    expect(blockAt(undefined, 0)).toBeUndefined();
  });

  it("lists every block in order, for the search by quote", () => {
    expect(anchorBlocks(SECTION).map((one) => one.kind)).toEqual(["paragraph", "paragraph", "heading", "caption", "caption", "caption"]);
    expect(anchorBlocks(SECTION)[2].text).toBe("2 Methods");
    expect(anchorBlocks(undefined)).toEqual([]);
  });

  it("is the section's paragraphs alone for a section the page gave no heading and no figures (a body of the old shape)", () => {
    const old = { paragraphs: ["One.", "Two."] };
    expect(anchorBlocks(old).map((one) => one.text)).toEqual(["One.", "Two."]);
    expect(blockAt(old, 2)).toBeUndefined();
  });

  it("reads only the paragraph asked for: the happy path of a resolve touches nothing else", () => {
    const reads: string[] = [];
    const paragraphs = new Proxy(["a", "b", "c"], {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.push(key);
        return Reflect.get(target, key);
      },
    });
    expect(blockAt({ paragraphs }, 1)?.text).toBe("b");
    expect(reads).toEqual(["1"]);
  });

  it("is not taken in by a stored reading of another shape: a heading that is not words and figures that are not a list are no blocks", () => {
    const odd = { paragraphs: ["One."], heading: 7, figures: "no" } as unknown as AnchorSection;
    expect(anchorBlocks(odd).map((one) => one.kind)).toEqual(["paragraph", "heading"]);
    expect(blockAt(odd, 1)).toEqual({ kind: "heading", text: "" });
    // A figure that is not one keeps its slot (the ids after it do not shift) and has no words.
    const broken = { paragraphs: ["One."], figures: [null, { label: 3 }, { label: "Figure 3", caption: "Ok." }] } as unknown as AnchorSection;
    expect(blockAt(broken, 2)).toBeUndefined();
    expect(blockAt(broken, 3)).toBeUndefined();
    expect(blockAt(broken, 4)).toEqual({ kind: "caption", text: "Figure 3 \u00b7 Ok." });
    expect(anchorBlocks(broken)).toHaveLength(5);
  });
});

describe("parseAnchorId — the one shape every anchor has", () => {
  it("reads the section and the block of `paper-section-<k>-p<n>`", () => {
    expect(parseAnchorId("paper-section-2-p4")).toEqual({ section: 2, index: 4 });
    expect(parseAnchorId("paper-section-10-p0")).toEqual({ section: 10, index: 0 });
  });

  it("is null for anything else: a section, a Summary block, the answers, a negative index", () => {
    for (const id of ["paper-section-2", "summary-skim", "answers-block", "paper-section--1-p-1", "paper-section-2-p", "x-paper-section-2-p1"]) {
      expect(parseAnchorId(id), id).toBeNull();
    }
  });
});

describe("the body on show — what a note taken on a block reads its words from", () => {
  const BODY = [{ paragraphs: ["Intro."] }, SECTION];

  it("gives the text of the block an anchor id names, once the page has said which body it shows", () => {
    setBodyOnShow(BODY);
    expect(anchorTextOnShow("paper-section-1-p2")).toBe("2 Methods");
    expect(anchorTextOnShow("paper-section-1-p3")).toBe("Figure 1 · Creep against density.");
    expect(anchorTextOnShow("paper-section-1-p0")).toBe("Creep limits the life.");
    expect(anchorTextOnShow("paper-section-0-p0")).toBe("Intro.");
  });

  it("is undefined for a block the body does not hold, an id that is not a block's, and a page that shows no body", () => {
    expect(anchorTextOnShow("paper-section-1-p2")).toBeUndefined();
    setBodyOnShow(BODY);
    expect(anchorTextOnShow("paper-section-1-p9")).toBeUndefined();
    expect(anchorTextOnShow("paper-section-7-p0")).toBeUndefined();
    expect(anchorTextOnShow("summary-skim")).toBeUndefined();
    setBodyOnShow(null);
    expect(anchorTextOnShow("paper-section-1-p2")).toBeUndefined();
  });
});
