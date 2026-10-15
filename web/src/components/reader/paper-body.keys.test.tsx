// P7-18 (F5, §1h.39 d): the body's sections were keyed `canonical:heading`, so two sections of one
// bucket and one heading ("Notes", the author-affiliation fragments of an uploaded paper) shared a key
// and React logged "Encountered two children with the same key" on every load — and, in the dev
// terminal, the heading with it. The key is the section's id now (`withSectionIds` makes the ids
// unique), falling back to its place in the list for a reading that has none.
//
// This project's Vitest has no DOM, and `react-dom/server` never checks keys (only the client
// reconciler does), so what React would compare is read off the element tree the component returns,
// run on `test-support/hook-runtime` like the hooks' effect tests.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { buildReading, type PaperReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { Paper } from "@/types";
import { PaperBody } from "./paper-body";

const paper: Paper = {
  id: "upload:0123456789abcdef", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
// Two sections that share a bucket and a heading, as the owner's paper's affiliation blocks did.
const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 2,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "Not in the body." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life of hot parts.", page: 1 },
    { id: "s2", heading: "Notes", canonical: "body", text: "The first note says one thing.", page: 2 },
    { id: "s3", heading: "Notes", canonical: "body", text: "The second note says another.", page: 2 },
  ],
};
const fullText: FullTextResult = {
  status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 },
};
const reading = buildReading(paper, fullText, new Date("2026-10-11T00:00:00.000Z"));

/** Every element in the tree that is one of the body's sections (the ones given a `section`). */
function sectionElements(node: ReactNode, found: ReactElement<{ section: { id?: string } }>[] = []): ReactElement<{ section: { id?: string } }>[] {
  if (Array.isArray(node)) {
    node.forEach((child) => sectionElements(child, found));
  } else if (isValidElement<{ section?: { id?: string }; children?: ReactNode }>(node)) {
    if (node.props.section) found.push(node as ReactElement<{ section: { id?: string } }>);
    sectionElements(node.props.children, found);
  }
  return found;
}

async function keysOf(r: PaperReading): Promise<(string | null)[]> {
  const mounted = await hookRuntime.mount(() => PaperBody({ reading: r }));
  return sectionElements(mounted.value).map((element) => element.key);
}

describe("PaperBody — the sections' keys (P7-18, F5)", () => {
  it("has two sections with one bucket and one heading to key", () => {
    const notes = reading.body.filter((section) => section.heading === "Notes");
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((section) => section.canonical)).size).toBe(1);
    expect(notes[0].id).not.toBe(notes[1].id);
  });

  it("keys each section by its id, so two sections with the same canonical and heading do not collide", async () => {
    const keys = await keysOf(reading);

    expect(keys).toEqual(reading.body.map((section) => section.id));
    // What React compares: no key stands twice among the siblings.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("falls back to the place in the list for a section with no id", async () => {
    const withoutIds = {
      ...reading,
      body: reading.body.map((section) => ({ ...section, id: undefined })),
    } as unknown as PaperReading;

    expect(await keysOf(withoutIds)).toEqual(reading.body.map((_, i) => `${i}`));
  });

  it("renders the two sections without a duplicate-key (or any other) console error", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const html = renderToStaticMarkup(createElement(PaperBody, { reading }));

      expect(html.match(/>Notes<\/h3>/g)).toHaveLength(2);
      expect(errors.mock.calls.map((call) => String(call[0])).filter((message) => /same key|unique "key"/.test(message))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});
