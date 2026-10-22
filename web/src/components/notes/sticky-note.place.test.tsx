import { beforeEach, describe, expect, it } from "vitest";
import { useWindows } from "@/lib/reader/windows";
import { useNotesStore } from "@/store/notes";
import { stickyAnchorId, takeStickyNote } from "./sticky-note";

// P10-09f (rule 1): "Take notes" hands the selection's place on to the note. The page gives `takeNote` the paragraph's
// text (the body it renders); the anchor then records where the words stand in it — `start` and `end` — beside the quote.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const PARAGRAPH = "Creep limits the life of hot parts. The finest grains crept fastest when annealed.";

describe("takeStickyNote — the anchor knows where the words are", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0, origin: null });
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

// P11-14 rule 2, defect (c) (B P11-03 §1.3): "Take notes" on a Summary or answer selection stored `paper-section--1-p-1` — the paper
// paragraph of a selection that has none (`sectionIndex` and `paragraphIndex` are −1 there) — an anchor that points nowhere. The
// selection carries its own `paragraphId` and `source`; the sticky anchors by them.
describe("takeStickyNote — a Summary or answer selection anchors where it is (P11-14, defect c)", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0, origin: null });
  });
  const anchorOf = (id: string | undefined) => Object.values(useNotesStore.getState().notes)[0].blocks.find((b) => b.id === id)?.anchor;
  const away = { sectionIndex: -1, paragraphIndex: -1, passage: "Seaweed mulch keeps more soil water" };

  it("a Summary selection stores its own block id, never paper-section--1-p-1", () => {
    const made = takeStickyNote({ ...away, source: "summary", paragraphId: "summary-intro" }, PAPER);
    expect(anchorOf(made?.id)?.paragraphId).toBe("summary-intro");
    expect(anchorOf(made?.id)?.paragraphId).not.toContain("paper-section--1");
  });

  it("an answer selection stores the answer's own id", () => {
    const made = takeStickyNote({ ...away, source: "answer", paragraphId: "answer-2" }, PAPER);
    expect(anchorOf(made?.id)?.paragraphId).toBe("answer-2");
  });

  it("a selection that is not the paper's and carries no id anchors at its source's name, still not at a paper paragraph", () => {
    expect(stickyAnchorId({ ...away, source: "summary" })).toBe("summary");
    expect(stickyAnchorId({ ...away, source: "answer" })).toBe("answer");
  });

  it("a paper selection anchors at its paragraph, as before, with or without the id it carries", () => {
    expect(stickyAnchorId({ sectionIndex: 1, paragraphIndex: 2, passage: "x" })).toBe("paper-section-1-p2");
    expect(stickyAnchorId({ sectionIndex: 1, paragraphIndex: 2, passage: "x", source: "paper", paragraphId: "paper-section-1-p2" })).toBe("paper-section-1-p2");
  });
});

// P11-14 rule 2, R-open (B P11-03 §3.3; O-6): the first card of an empty margin opens level with the selection that opened it, and later
// cards cascade from there.
describe("takeStickyNote — the first card opens level with its selection (R-open)", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0, origin: null });
  });
  const sel = (top: number) => ({ sectionIndex: 1, paragraphIndex: 2, passage: "finest grains crept", bounds: { left: 100, top, right: 300, bottom: top + 20 } });

  it("starts the cascade at the selection's first line, and the next sticky joins where the first stands", () => {
    takeStickyNote(sel(333), PAPER);
    expect(useWindows.getState().origin).toBe(333);
    takeStickyNote(sel(640), PAPER);
    expect(useWindows.getState().origin).toBe(333);
    expect(useWindows.getState().windows.map((w) => w.kind)).toEqual(["sticky", "sticky"]);
  });

  it("reads the selection's first line where it is now (measure), not where it was when the page last read it", () => {
    const measure = () => ({ rect: { left: 0, top: 0, right: 1, bottom: 1 }, bounds: { left: 100, top: 287, right: 300, bottom: 307 } });
    takeStickyNote({ ...sel(333), measure }, PAPER);
    expect(useWindows.getState().origin).toBe(287);
  });

  it("opens at the margin's top (no origin) when the selection has no place", () => {
    takeStickyNote({ sectionIndex: 1, paragraphIndex: 2, passage: "finest grains crept" }, PAPER);
    expect(useWindows.getState().origin).toBeNull();
  });
});
