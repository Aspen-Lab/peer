import { beforeEach, describe, expect, it } from "vitest";
import { useWindows } from "@/lib/reader/windows";
import { useNotesStore } from "@/store/notes";
import { takeStickyNote } from "./sticky-note";

// P10-09f (rule 1): "Take notes" hands the selection's place on to the note. The page gives `takeNote` the paragraph's
// text (the body it renders); the anchor then records where the words stand in it — `start` and `end` — beside the quote.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const PARAGRAPH = "Creep limits the life of hot parts. The finest grains crept fastest when annealed.";

describe("takeStickyNote — the anchor knows where the words are", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });

  const anchorOf = (id: string | undefined) => Object.values(useNotesStore.getState().notes)[0].blocks.find((b) => b.id === id)?.anchor;

  it("stores start and end from the paragraph's text the page hands over", () => {
    const made = takeStickyNote({ sectionIndex: 1, paragraphIndex: 2, passage: "finest grains crept", paragraphText: PARAGRAPH }, PAPER);
    const anchor = anchorOf(made?.id);
    expect(anchor).toMatchObject({ paragraphId: "paper-section-1-p2", quote: "finest grains crept", n: 1, start: 40, end: 59 });
    expect(PARAGRAPH.slice(anchor!.start, anchor!.end)).toBe("finest grains crept");
  });

  it("keeps working, with no range, when the page hands no paragraph text", () => {
    const made = takeStickyNote({ sectionIndex: 1, paragraphIndex: 2, passage: "finest grains crept" }, PAPER);
    expect(anchorOf(made?.id)).toMatchObject({ quote: "finest grains crept", n: 1 });
    expect(anchorOf(made?.id)?.start).toBeUndefined();
  });
});
