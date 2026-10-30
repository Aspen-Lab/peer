import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { highlightBlock } from "@/lib/notes/blocks";
import { readingNote } from "@/lib/notes/templates";
import { markedPassages, noteSearchText } from "./note-preview";
import { NoteCard } from "./note-card";

const note = readingNote({ id: "arxiv:example", title: "A paper on neural dynamics", authors: [], venue: "arXiv" }, "2026-10-29T12:00:00Z");
note.blocks.push(highlightBlock({ paperId: "arxiv:example", paragraphId: "paper-section-0-p0", quote: "A distinctive finding", start: 0, end: 21, colour: "yellow" }));

describe("paper notes in the notes list", () => {
  it("shows the paper, marked passage and count in its note card", () => {
    const html = renderToStaticMarkup(<NoteCard note={note} />);
    expect(html).toContain("A paper on neural dynamics");
    expect(html).toContain("A distinctive finding");
    expect(html).toContain("1 mark");
    expect(html).toContain(`/notes/${note.id}`);
  });

  it("finds a reading note by the passage even with no typed note text", () => {
    expect(markedPassages(note)).toEqual(["A distinctive finding"]);
    expect(noteSearchText(note)).toContain("distinctive finding");
  });
});
