import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";
import { openPaperNotes } from "./paper-notes";

// P11-06 (the owner's item 3, rule 1): pressing "Open your notes" records where the reader was on the paper,
// so the notes page can offer "Back to paper". The press is `openPaperNotes` (its router, store and now the
// recording are handed in, so it runs without a page). Only a press that LEAVES the paper records: the reading
// page's edge tab opens the notes as a window and navigates nowhere (P10-09b), so there is nothing to come back
// from — and a record left by it would call a note opened later from Saved "Back to paper".

const paper: Paper = {
  id: "openalex:W9", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw.",
  summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

describe("the press that navigates (a phone's row, the upload page's band)", () => {
  it("records the place before it navigates, for the note it opens", () => {
    const order: string[] = [];

    openPaperNotes({
      own: { id: "n1" },
      paper,
      ensure: vi.fn(() => "never"),
      push: (href) => order.push(`push:${href}`),
      remember: (noteId) => order.push(`remember:${noteId}`),
    });

    expect(order).toEqual(["remember:n1", "push:/notes/n1"]);
  });

  it("records for the note it has just made, too", () => {
    const order: string[] = [];

    openPaperNotes({
      own: undefined,
      paper,
      ensure: () => "n-new",
      push: (href) => order.push(`push:${href}`),
      remember: (noteId) => order.push(`remember:${noteId}`),
    });

    expect(order).toEqual(["remember:n-new", "push:/notes/n-new"]);
  });
});

describe("the press that opens the window", () => {
  it("records nothing and navigates nowhere", () => {
    const remember = vi.fn();
    const push = vi.fn();
    const openWindow = vi.fn();

    openPaperNotes({ own: { id: "n1" }, paper, ensure: vi.fn(), push, remember, openWindow });
    openPaperNotes({ own: undefined, paper, ensure: () => "n2", push, remember, openWindow });

    expect(openWindow).toHaveBeenCalledTimes(2);
    expect(remember).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("still works for a caller that hands in no recording (the press as it was)", () => {
    const push = vi.fn();

    openPaperNotes({ own: { id: "n1" }, paper, ensure: vi.fn(), push });

    expect(push).toHaveBeenCalledWith("/notes/n1");
  });
});

describe("the hook's wiring (read from the source: the hook needs the router and the stores)", () => {
  const source = readFileSync(resolve(__dirname, "paper-notes.tsx"), "utf8");

  it("hands the recording to the press only when the press leaves the paper, and records this paper", () => {
    expect(source).toMatch(/import \{[^}]*\brememberPlace\b[^}]*\} from "@\/lib\/notes\/return-to-paper"/);
    expect(source.match(/rememberPlace\(/g)).toHaveLength(1);
    expect(source).toMatch(/remember:\s*openWindow\s*\?\s*undefined\s*:\s*\(noteId\)\s*=>\s*\{?\s*rememberPlace\(\{\s*paperId:\s*paper\.id,\s*noteId\s*\}\)/);
  });
});
