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

describe("SavedPageView", () => {
  it("renders the shelf with its count", () => {
    // The page used to carry Papers / Events / Jobs segments and a To-do /
    // Done rail for applications and registrations. Events and jobs are no
    // longer product surfaces; papers had no completion state to begin with.
    const html = renderToStaticMarkup(
      createElement(SavedPageView, { savedPapers: [paper] }),
    );

    expect(html).toContain("A saved paper");
    expect(html).toContain("1 paper on your shelf");
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
});
