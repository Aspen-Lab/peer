import { describe, expect, it } from "vitest";
import { block } from "./blocks";
import { authorYear, externalLink, sourceOf } from "./cite";
import { reference, toMarkdown, toWordHtml } from "./export";
import type { Note, Source } from "./types";

// P10-09e (rule 4; three blind readers): a paper with no author on record never gets one made up from its title, and
// no unknown year is written "n.d."; and no export links the app's own /api/ path as if it were the paper's address.

const TITLE = "Electrochemically Tuned Crystal Growth in Thin Films";
const own = (extra: Partial<Source> = {}): Source => ({ key: "k", paperId: "u1", title: TITLE, authors: [], ...extra });

describe("authorYear with no author on record (rule 4)", () => {
  it("is the title's first four words, with the year when it is known", () => {
    expect(authorYear(own({ year: 2025 }))).toBe("Electrochemically Tuned Crystal Growth, 2025");
  });
  it("is the title's first four words alone when the year is unknown — no 'n.d.', no comma", () => {
    expect(authorYear(own())).toBe("Electrochemically Tuned Crystal Growth");
    expect(authorYear(own())).not.toMatch(/n\.d\./);
  });
  it("names a known author with no year as the author alone", () => {
    expect(authorYear(own({ authors: ["Anna Müller"] }))).toBe("Müller");
    expect(authorYear(own({ authors: ["Anna Müller"], year: 2021 }))).toBe("Müller, 2021");
  });
});

describe("the reference line (rule 4)", () => {
  it("has no '(n.d.)' when the year is unknown", () => {
    expect(reference(own())).toBe(`${TITLE}.`);
    expect(reference(own({ authors: ["Ann Lee"] }))).toBe(`Ann Lee. ${TITLE}.`);
    expect(reference(own({ authors: ["Ann Lee"], year: 2024 }))).toBe(`Ann Lee (2024). ${TITLE}.`);
  });
  it("writes a link for a DOI or an http(s) address", () => {
    expect(reference(own({ doi: "10.1000/x1" }))).toBe(`${TITLE}. https://doi.org/10.1000/x1`);
    expect(reference(own({ url: "https://example.org/p" }))).toBe(`${TITLE}. https://example.org/p`);
  });
  it("writes no link for the app's own /api/ path, and falls back to the DOI when there is one", () => {
    const path = "/api/papers/upload/abc123/file";
    expect(reference(own({ url: path }))).toBe(`${TITLE}.`);
    expect(reference(own({ url: `http://localhost:4024${path}` }))).toBe(`${TITLE}.`);
    expect(reference(own({ url: path, doi: "10.1000/x1" }))).toBe(`${TITLE}. https://doi.org/10.1000/x1`);
    expect(externalLink(path)).toBeUndefined();
    expect(externalLink("ftp://example.org/p")).toBeUndefined();
    expect(externalLink("https://example.org/api/v2/paper")).toBe("https://example.org/api/v2/paper");
  });
  it("is the same in a paper card's Markdown and in the Word file", () => {
    const source = sourceOf({ id: "u1", title: TITLE, authors: [] }, "k");
    const withPath: Source = { ...source, url: "/api/papers/upload/abc123/file" };
    const note: Note = {
      id: "n", title: "T", blocks: [block("paper", "", { cite: "k" })], sources: { k: withPath },
      createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
    };
    for (const out of [toMarkdown(note), toWordHtml(note)]) {
      expect(out).not.toContain("/api/");
      expect(out).not.toContain("n.d.");
    }
  });
});
