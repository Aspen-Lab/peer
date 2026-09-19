import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";

const storeState = vi.hoisted(() => ({
  savePaper: vi.fn(),
  moreLikePaper: vi.fn(),
  notInterestedPaper: vi.fn(),
  readItems: {} as Record<string, boolean>,
  paperSummaries: {} as Record<string, string>,
}));

vi.mock("@/store/feed", () => ({
  useFeedStore: (
    selector?: (state: typeof storeState) => unknown,
  ) => (selector ? selector(storeState) : storeState),
}));

import { SavedPageView } from "./page";
import { citableFromPaper } from "@/lib/notes/cite";
import { readingNote, relatedWorkDraft } from "@/lib/notes/templates";

const paper: Paper = {
  id: "paper:saved",
  title: "A saved paper",
  authors: ["A. Researcher"],
  relevanceReason: "Matches your research.",
  venue: "Example Journal",
  source: "other",
  summaryIntro: "A concise abstract.",
  summaryExperimentKeywords: ["battery"],
  summaryResultDiscussion: "A useful result.",
  isSaved: true,
};

const other: Paper = {
  ...paper,
  id: "paper:other",
  title: "Another saved paper",
  authors: ["B. Writer"],
  publishedDate: "2025-01-02",
};

describe("SavedPageView", () => {
  it("renders the shelf with its count", () => {
    // The page used to carry Papers / Events / Jobs segments and a To-do /
    // Done rail for applications and registrations. Events and jobs are no
    // longer product surfaces; papers had no completion state to begin with.
    const html = renderToStaticMarkup(
      createElement(SavedPageView, { savedPapers: [paper] }),
    );

    expect(html).toContain("A saved paper");
    expect(html).toContain("1 paper");
    for (const gone of [">Events<", ">Jobs<", ">To-do<", ">Done<"]) {
      expect(html).not.toContain(gone);
    }
  });

  it("shows the empty shelf when nothing is saved", () => {
    const html = renderToStaticMarkup(
      createElement(SavedPageView, { savedPapers: [] }),
    );

    expect(html).toContain("Nothing saved yet.");
  });

  it("holds the reader's notes above the papers they came from", () => {
    const own = readingNote(citableFromPaper(paper), "2026-09-18T09:00:00.000Z");
    const draft = { ...relatedWorkDraft([citableFromPaper(other)]), title: "Related work on batteries" };
    const html = renderToStaticMarkup(
      createElement(SavedPageView, {
        savedPapers: [paper, other],
        notes: { [own.id]: own, [draft.id]: draft },
      }),
    );

    expect(html).toContain("2 papers · 2 notes");
    expect(html.indexOf(">Notes<")).toBeLessThan(html.indexOf(">Papers<"));
    expect(html).toContain("Related work on batteries");
    // The paper with its own reading notes opens them; the other offers to start some.
    expect(html).toContain("Your notes →");
    expect(html).toContain("Take notes");
    // The draft cites the other paper, and the shelf says so.
    expect(html).toContain("cited in 1 note");
  });

  it("does not call the notes empty before this browser's notes are read", () => {
    const html = renderToStaticMarkup(
      createElement(SavedPageView, { savedPapers: [paper], notesReady: false }),
    );

    expect(html).not.toContain("Reading notes and drafts land here");
    expect(html).toContain("+ New note");
  });
});
