// P10-45 (BACKLOG-93): the report's stage words live with the rest of the reader's copy, and the
// fixed "loading report..." label (S19, reversed by P10-41) is gone with nothing left to use it.
import { describe, expect, it } from "vitest";
import * as copy from "./copy";
import * as hook from "./use-model-report";

const words = (copy as unknown as Record<string, Record<string, string> | undefined>).REPORT_STATUS;

describe("the report's stage words (P10-45, BACKLOG-93)", () => {
  it("copy.ts holds them: one word for each thing the page can be waiting on", () => {
    expect(words).toEqual({
      starting: "Starting the report",
      source: "Finding the paper",
      reading: "Reading the paper",
      readingQuestions: "Reading your questions",
      writing: "Writing the report",
      figures: "Adding figures",
      again: "Trying the report once more",
      // P10-47: re-aimed (the table gained one word) — the hand-over to a reader's queued question.
      newQuestion: "Your new question — reading it",
    });
  });

  it("the hook no longer defines them (it imports them)", () => {
    expect(hook).not.toHaveProperty("REPORT_STATUS");
  });

  it("the unused fixed label is gone", () => {
    expect(copy).not.toHaveProperty("PROGRESS_LABEL");
  });
});
