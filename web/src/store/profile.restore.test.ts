import { describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { MAX_QUESTION_CHARS, MAX_QUESTIONS } from "@/store/reading-questions";
import { PROFILE_EXPORT_FORMAT, exportProfileDocument, parseExportedProfile } from "./profile";

// P5-04 (N6, §1h.15 (f)): a backup file is the reader's own, but also a file anyone can edit, so a
// restore cleans the standing questions the way the setter does: trimmed, no empty line, no
// duplicate, at most five, each at most 200 characters. A measured that taking the cleaning out of
// `parseExportedProfile` left the whole suite green (the editor and the chip group clean what they
// read, so no bound was lost on screen). The questions are invented.

const Q = (n: number) => `Standing question number ${n} about the cohort?`;
const LONG = "x".repeat(MAX_QUESTION_CHARS + 1);

describe("restoring a backup cleans the standing questions", () => {
  const six = [Q(1), Q(2), LONG, Q(3), Q(2).toUpperCase(), Q(4)];
  const restored = () =>
    parseExportedProfile({ format: PROFILE_EXPORT_FORMAT, profile: { ...exportProfileDocument(defaultProfile).profile, standingQuestions: six } })
      ?.standingQuestions;

  it("six lines, one of 201 characters and one a duplicate, load as five cleaned", () => {
    expect(six).toHaveLength(MAX_QUESTIONS + 1);
    expect(six[2]).toHaveLength(201);
    const cleaned = restored();
    expect(cleaned).toHaveLength(MAX_QUESTIONS);
    expect(cleaned).toEqual([Q(1), Q(2), "x".repeat(MAX_QUESTION_CHARS), Q(3), Q(4)]);
    expect(new Set(cleaned?.map((q) => q.toLocaleLowerCase())).size).toBe(cleaned?.length);
  });

  it("a line of 201 characters is cut to 200, not dropped", () => {
    expect(restored()?.some((q) => q.length === MAX_QUESTION_CHARS)).toBe(true);
    expect(restored()?.every((q) => q.length <= MAX_QUESTION_CHARS)).toBe(true);
  });

  it("a list holding anything but text is read as text only", () => {
    const messy = parseExportedProfile({ format: PROFILE_EXPORT_FORMAT, profile: { standingQuestions: [Q(1), 7, null, "  ", Q(2)] } });
    expect(messy?.standingQuestions).toEqual([Q(1), Q(2)]);
  });
});
