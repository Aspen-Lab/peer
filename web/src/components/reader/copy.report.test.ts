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
    });
  });

  it("the hook no longer defines them (it imports them)", () => {
    expect(hook).not.toHaveProperty("REPORT_STATUS");
  });

  it("the unused fixed label is gone", () => {
    expect(copy).not.toHaveProperty("PROGRESS_LABEL");
  });

  it("the sentence's own suffix names no stage (the status line under the bar names it once)", () => {
    // Whatever stage word it is handed (the head took one), the suffix does not repeat it.
    const suffix = (copy.progressSuffix as unknown as (stageLabel?: string) => string)("Writing the report");
    for (const word of Object.values(words ?? {})) expect(suffix).not.toContain(word);
    expect(suffix).not.toContain("Writing the report");
    expect(suffix.length).toBeGreaterThan(0);
  });
});
