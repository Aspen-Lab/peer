import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { useWindows } from "@/lib/reader/windows";
import { PaperBody, paragraphAnchor } from "@/components/reader/paper-body";
import type { Paper } from "@/types";
import { AnchorSquare, FLASH_MS, NoteTag, SQUARE_PX, goToPassage, registerPassageHost } from "./note-tags";

// P10-09a (review 7.1c; rubric B11): the passage a sticky was taken on carries a small reference tag, like a
// citation mark ([N], superscript, the label face) that opens that sticky; the sticky and the note's heading show a
// small blue square at the left of the text that scrolls the paper back to the passage — from the reading page —
// or, on the notes page, goes to the paper's page at the paragraph. Every text is invented.

const ANCHOR = { paperId: "p1", paragraphId: "paper-section-1-p0", quote: "q", n: 2 };

describe("NoteTag", () => {
  beforeEach(() => useWindows.setState({ windows: [], clock: 0 }));

  it("is a superscript [N] button in the label face that says what it opens", () => {
    const html = renderToStaticMarkup(createElement(NoteTag, { n: 2, id: "h2" }));
    expect(html).toContain("<sup");
    expect(html).toContain(">[2]<");
    expect(html).toContain('aria-label="Open note 2"');
    expect(html).toContain('type="button"');
    expect(html).toContain("select-none");
  });

  it("opens its sticky in the stack when pressed", () => {
    const tree = NoteTag({ n: 2, id: "h2" }) as unknown as { props: { children: { props: { onClick: () => void } } } };
    tree.props.children.props.onClick();
    expect(useWindows.getState().windows).toMatchObject([{ id: "h2", kind: "sticky", title: "Note 2" }]);
  });
});

describe("AnchorSquare — the blue square", () => {
  it("is a button labelled Go to the passage, at least 12 px square, blue", () => {
    expect(SQUARE_PX).toBeGreaterThanOrEqual(12);
    const html = renderToStaticMarkup(createElement(AnchorSquare, { onClick: () => {} }));
    expect(html).toContain('aria-label="Go to the passage"');
    expect(html).toContain('type="button"');
    expect(html).toContain(`width:${SQUARE_PX}px`);
    expect(html).toContain(`height:${SQUARE_PX}px`);
    expect(html).toMatch(/background(-color)?:#?[0-9a-z(),. %-]*(3b82f6|2563eb|blue)/i);
  });
});

describe("goToPassage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeDoc(present: boolean) {
    const classes = new Set<string>();
    const el = {
      scrollIntoView: vi.fn(),
      classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
    };
    return { el, classes, doc: { getElementById: (id: string) => (present && id === ANCHOR.paragraphId ? el : null) } as unknown as Document };
  }

  it("scrolls the paragraph to the top of the window and marks it for a moment", () => {
    vi.useFakeTimers();
    const { el, classes, doc } = fakeDoc(true);
    const navigate = vi.fn();
    goToPassage(ANCHOR, { doc, navigate });
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(classes.size).toBeGreaterThan(0);
    vi.advanceTimersByTime(FLASH_MS + 1);
    expect(classes.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("goes to the paper's page at the paragraph when it is not on this page (the notes page)", () => {
    const { doc } = fakeDoc(false);
    const navigate = vi.fn();
    goToPassage(ANCHOR, { doc, navigate });
    expect(navigate).toHaveBeenCalledWith("/papers/p1#paper-section-1-p0");
  });

  it("asks the reading page to show the paper's text first when the page has registered", () => {
    const { el, doc } = fakeDoc(true);
    const reveal = vi.fn((run: () => void) => run());
    const off = registerPassageHost({ paperId: "p1", reveal });
    const navigate = vi.fn();
    goToPassage(ANCHOR, { doc, navigate });
    off();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    goToPassage(ANCHOR, { doc, navigate });
    expect(reveal).toHaveBeenCalledTimes(1);
  });
});

describe("PaperBody — the tags after a passage", () => {
  const paper: Paper = {
    id: "p1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const doc: ExtractedDocument = {
    source: "pdf", pageCount: 2, figureCaptions: [], equations: [],
    sections: [{ id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life.\n\nGrain boundaries carry the strain.", page: 1 }],
  };
  const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } };
  const reading = buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));

  it("draws one [N] per sticky on a paragraph, in order, and none elsewhere", () => {
    const noteAnchors = { [paragraphAnchor(0, 1)]: [{ id: "a", n: 1 }, { id: "b", n: 3 }] };
    const html = renderToStaticMarkup(createElement(PaperBody, { reading, noteAnchors }));
    expect(html.match(/aria-label="Open note \d+"/g)).toEqual(['aria-label="Open note 1"', 'aria-label="Open note 3"']);
    const second = html.slice(html.indexOf(`id="${paragraphAnchor(0, 1)}"`));
    expect(second).toContain(">[1]<");
    expect(html.slice(0, html.indexOf(`id="${paragraphAnchor(0, 1)}"`))).not.toContain("[1]");
  });

  it("changes nothing without anchors", () => {
    const plain = renderToStaticMarkup(createElement(PaperBody, { reading }));
    expect(renderToStaticMarkup(createElement(PaperBody, { reading, noteAnchors: {} }))).toBe(plain);
  });
});
