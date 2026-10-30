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

// P10-21 rule 5 (BACKLOG-80, BACKLOG-81): two sentences that said what the code no longer does.
describe("the two stale sentences (P10-21)", () => {
  it("the band's caption says what the reading note holds now: the paper's title and the reader's sticky notes (BACKLOG-81)", () => {
    expect(paperNotes).toContain("The note holds the paper&apos;s title and your sticky notes.");
    expect(paperNotes).not.toContain("four questions to answer");
    expect(paperNotes).not.toContain("the opening of its abstract");
  });

  it("the paper page's comment on the defined terms' scope says the whole body (BACKLOG-80)", () => {
    expect(page).toContain("(the whole body when there is no such route)");
    expect(page).not.toContain("the methods and results when there is no such route");
  });
});

describe("PaperNotes — the questions go into the first note (P2-05)", () => {
  // P10-09c (rule 1, re-aimed, §1c): the same two props reach the template through the store's `ensureReadingNote`
  // (it calls `readingNote`) instead of this file's own `readingNote(...)` call.
  it("takes the two optional props and hands them to the store's ensureReadingNote", () => {
    expect(paperNotes).toContain("questions?: readonly string[]");
    expect(paperNotes).toContain("forYourQuestions?: readonly QuestionAnswers[]");
    expect(paperNotes).toContain("ensure(citableFromPaper(paper), { questions, forYourQuestions })");
    expect(paperNotes).not.toMatch(/\breadingNote\(/);
  });

  it("offers the paper's independent notes through the command row", () => {
    const flat = page.replace(/\s+/g, " ");
    const mounts = [...flat.matchAll(/<NotesButton [^>]*\/>/g)].map((m) => m[0]);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toContain('variant="row"');
    expect(mounts[0]).toContain("paper={paper}");
    expect(mounts[0]).toContain("questions={settledQuestions(asked)}");
    expect(mounts[0]).toContain("forYourQuestions={report?.forYourQuestions}");
  });

  it("is no longer a band in the column: the page's additions mount no PaperNotes", () => {
    const additions = page.indexOf("additions={");
    const next = page.indexOf(" next={", additions);

    expect(additions).toBeGreaterThan(-1);
    expect(page.slice(additions, next)).not.toContain("<PaperNotes");
    expect(page.slice(page.indexOf("export default function PaperReadingPage"))).not.toContain("<PaperNotes");
  });

  it("keeps selection actions outside the page container without a permanent notes edge", () => {
    const flat = page.replace(/\s+/g, " ");
    const closed = flat.lastIndexOf("</PageContainer>");
    expect(closed).toBeGreaterThan(-1);
    expect(flat.indexOf("<SelectionToolbar", closed)).toBeGreaterThan(closed);
    expect(flat).not.toContain('<NotesButton variant="edge"');
  });

  it("is left as it was where the upload is unavailable: no questions field, no report there", () => {
    const fallback = page.indexOf("export function UploadFallbackReading");
    const mount = page.indexOf("<PaperNotes", fallback);
    const element = page.slice(mount, page.indexOf("/>", mount) + 2);

    expect(fallback).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(fallback);
    expect(mount).toBeLessThan(page.indexOf("export default function PaperReadingPage"));
    expect(element).toBe("<PaperNotes paper={paper} />");
  });

  it("is the only caller of readingNote on the paper page; the saved page's call is untouched", () => {
    expect(page).not.toContain("readingNote(");
    expect(read("src/app/saved/page.tsx")).toContain("open(readingNote(citableFromPaper(paper)))");
  });
});

// P10-23 rule 2 (C P10-21's unsettled 3, BACKLOG-86): the two doc comments at the top of the file described the old note.
describe("the doc comments say what the note is now (P10-23)", () => {
  const prose = paperNotes.replace(/^\s*(\/\/|\/?\*+\/?) ?/gm, " ").replace(/\s+/g, " ");

  it("the header and openPaperNotes' comment name the paper's title and the sticky notes, not the card / abstract / questions", () => {
    expect(prose).not.toMatch(/from its record and abstract/);
    expect(prose).not.toMatch(/from its card, the opening of its abstract/);
    expect(prose).toMatch(/made the first time, with the paper's title/);
    expect(prose).toMatch(/Open the paper's own notes — made the first time, with the paper's title/);
    expect(prose.match(/title and your sticky notes/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
