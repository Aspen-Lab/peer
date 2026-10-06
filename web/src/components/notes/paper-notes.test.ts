// P2-05 (§1g.6, §3d 12): the page hands the reader's settled questions (never
// the gist) and the report's answers to the two places that make a document
// out of the reading — the `c` copy and "Take notes".
//
// The page cannot mount in this runtime (`app/papers/[id]/page.test.tsx` says
// why: router, stores, IntersectionObserver), so, as that file does for its
// other call sites, these read the source of the call sites; the behaviour
// behind them (`readingToMarkdown`, `readingNote`) is tested where it lives.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/app/papers/[id]/page.tsx");
const paperNotes = read("src/components/notes/paper-notes.tsx");

describe("page.tsx source — the copy action passes the settled questions (P2-05)", () => {
  const start = page.indexOf("const markdown = readingToMarkdown(");
  const call = page.slice(start, page.indexOf("clip", start));

  it("calls readingToMarkdown with the report and settledQuestions(asked)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(call).toContain("report,");
    expect(call).toContain("sentences,");
    expect(call).toContain("settledQuestions(asked)");
  });

  it("never passes the gist or the live, unsettled items", () => {
    // The code of the call, not the comment that explains it.
    const code = call.replace(/\/\/.*$/gm, "");
    expect(code).toContain("settledQuestions(asked)");
    expect(code).not.toContain("gist");
    expect(code).not.toContain(".items");
  });
});

describe("PaperNotes — the questions go into the first note (P2-05)", () => {
  it("takes the two optional props and hands them to readingNote", () => {
    expect(paperNotes).toContain("questions?: readonly string[]");
    expect(paperNotes).toContain("forYourQuestions?: readonly QuestionAnswers[]");
    expect(paperNotes).toContain("readingNote(citableFromPaper(paper), { questions, forYourQuestions })");
  });

  it("is mounted with the settled questions and the report's answers on the page that has a report", () => {
    const additions = page.indexOf("additions={");
    const mount = page.indexOf("<PaperNotes", additions);
    const element = page.slice(mount, page.indexOf("/>", mount) + 2);

    expect(additions).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(additions);
    expect(element).toContain("paper={paper}");
    expect(element).toContain("questions={settledQuestions(asked)}");
    expect(element).toContain("forYourQuestions={report?.forYourQuestions}");
  });

  it("is left as it was where the upload is unavailable: no questions field, no report there", () => {
    const fallback = page.indexOf("export function UploadFallbackReading");
    const mount = page.indexOf("<PaperNotes", fallback);
    const element = page.slice(mount, page.indexOf("/>", mount) + 2);

    expect(fallback).toBeGreaterThan(-1);
    expect(mount).toBeLessThan(page.indexOf("additions={", fallback));
    expect(element).toBe("<PaperNotes paper={paper} />");
  });

  it("is the only caller of readingNote on the paper page; the saved page's call is untouched", () => {
    expect(page).not.toContain("readingNote(");
    expect(read("src/app/saved/page.tsx")).toContain("open(readingNote(citableFromPaper(paper)))");
  });
});
