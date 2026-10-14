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

  // P7-14 (R9, the owner's review): the notes entry is no longer a Band at the top of the column but a
  // button — a small tab fixed at the viewport's right edge, and on a phone a row in the command stack.
  // `open()` was extracted into `openPaperNotes` (the call above, unchanged), and the page mounts the
  // button twice with the same two props: the settled questions and the report's answers (P2-05).
  it("is mounted as the notes button, with the settled questions and the report's answers: at the right edge, and in the command stack for a phone", () => {
    const flat = page.replace(/\s+/g, " ");
    const mounts = [...flat.matchAll(/<NotesButton [^>]*\/>/g)].map((m) => m[0]);

    expect(mounts).toHaveLength(2);
    expect(mounts.map((m) => /variant="(edge|row)"/.exec(m)?.[1]).sort()).toEqual(["edge", "row"]);
    for (const element of mounts) {
      expect(element).toContain("paper={paper}");
      expect(element).toContain("questions={settledQuestions(asked)}");
      expect(element).toContain("forYourQuestions={report?.forYourQuestions}");
    }
  });

  it("is no longer a band in the column: the page's additions mount no PaperNotes", () => {
    const additions = page.indexOf("additions={");
    const next = page.indexOf(" next={", additions);

    expect(additions).toBeGreaterThan(-1);
    expect(page.slice(additions, next)).not.toContain("<PaperNotes");
    expect(page.slice(page.indexOf("export default function PaperReadingPage"))).not.toContain("<PaperNotes");
  });

  it("the edge tab stands beside the explain box, outside the zoomed container", () => {
    const flat = page.replace(/\s+/g, " ");
    const closed = flat.lastIndexOf("</PageContainer>");
    const edge = flat.indexOf('<NotesButton variant="edge"');
    const explain = flat.indexOf("<ExplainBox");

    expect(closed).toBeGreaterThan(-1);
    expect(explain).toBeGreaterThan(closed);
    // Right after the explain box's own section links, and the last thing the page draws.
    expect(edge).toBeGreaterThan(flat.indexOf("</SectionLinks>", explain));
    expect(flat.slice(edge).replace(/<NotesButton [^>]*\/>/, "").trim().startsWith("</> );")).toBe(true);
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
