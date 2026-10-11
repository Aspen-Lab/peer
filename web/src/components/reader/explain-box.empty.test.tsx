import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import type { ExplainTurn } from "@/store/explain-threads";
import { EXPLAIN } from "./copy";
import { SectionLinks } from "./evidence-quote";
import { ExplainBox, ExplainCard, type ExplainStatus, type ThreadView } from "./explain-box";
import type { ExplainSelection } from "./paper-body";

// P8-06 (the owner's "yes" of 16:4xZ 2026-10-11; ruling §1h.45): the explain window is there before the first
// selection, as an empty panel — the card's header (the "Explain this?" title and Close) and one line of copy in the
// label face. Nothing else: no input, no quote, no "You" / "Peer", no word about a key, a plan or a price (§1b: a locked
// block is never shown, and this window is shown to a reader who has a key). The markup is rendered with
// react-dom/server (no DOM in this project's Vitest); when it appears and goes is in `explain-box.empty.flow.test.tsx`.
// Every text is invented.

const PASSAGE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
const answer: ExplainAnswer = { meaning: "A rafting ratio says how much of a sample has turned into plates.", here: { text: "The authors use it to compare alloys on one scale.", peer: true } };
const turns: ExplainTurn[] = [{ role: "reader", text: "Why does a bigger ratio matter?" }, { role: "peer", text: "It changes how the metal carries load.", peer: true }];
const view: ThreadView = { turns, draft: "", pending: false, failed: false, onDraft: () => {}, onSend: () => {}, search: { on: false, tip: false, onPointerDown: () => {}, onPress: () => {}, onBlur: () => {} } };

const markup = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: ["1 Introduction", "2 Methods"] },
      createElement(ExplainCard, { passage: "", heading: "", term: null, termWhere: null, canAsk: true, status: { kind: "none" } as ExplainStatus, onClose: () => {}, dock: true, empty: true, ...over }),
    ),
  );

describe("the copy (P8-06)", () => {
  it("names the empty state's one line exactly", () => {
    expect(EXPLAIN.empty).toBe("Select a passage in the paper, then press Explain this? or e.");
  });

  it("is one line of plain words: no line break, and nothing about a key, a plan, a price or what is locked (§1b)", () => {
    expect(EXPLAIN.empty).not.toMatch(/\n/);
    expect(EXPLAIN.empty).not.toMatch(/\b(key|keys|plan|plans|price|prices|pricing|paid|pay|free|upgrade|locked|unlock|subscribe|subscription|tier|premium|credit|credits|quota|model|api|account|sign)\b/i);
  });
});

describe("ExplainCard — the empty state (P8-06)", () => {
  it("is the card's header — the title and Close — and one line, and nothing else", () => {
    const html = markup();

    // The same window as the card with a passage: a dock at the right edge.
    expect(html).toContain("data-explain-card");
    expect(html).toContain("data-explain-dock");
    expect(html).toContain('role="dialog"');
    // The title and the one line are the only two paragraphs; Close is the only button.
    expect(html.split("<p")).toHaveLength(3);
    expect(html.split("<button")).toHaveLength(2);
    expect(html).toContain(`>${EXPLAIN.ask}</p>`);
    expect(html).toContain(`>${EXPLAIN.empty}</p>`);
    expect(html).toContain(`>${EXPLAIN.close}</button>`);
    // In that order: the header (title, Close), then the line.
    expect(html.indexOf(EXPLAIN.ask)).toBeLessThan(html.indexOf(`>${EXPLAIN.close}<`));
    expect(html.indexOf(`>${EXPLAIN.close}<`)).toBeLessThan(html.indexOf(`>${EXPLAIN.empty}<`));
  });

  it("sets the title and the line in the label face (`font-mono`), not the reading face", () => {
    const html = markup();

    expect(html).toMatch(new RegExp(`<p class="[^"]*font-mono[^"]*">${EXPLAIN.ask.replace("?", "\\?")}</p>`));
    expect(html).toMatch(new RegExp(`<p [^>]*class="[^"]*font-mono[^"]*">${EXPLAIN.empty.replace(/\?/g, "\\?")}</p>`));
    expect(html).not.toContain("font-reading");
  });

  it("has no input, no Send, no search toggle, no quote, no \"You\" or \"Peer\", and no part of an answer", () => {
    const html = markup();

    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(EXPLAIN.placeholder);
    expect(html).not.toContain(EXPLAIN.send);
    expect(html).not.toContain(EXPLAIN.searchToggle);
    expect(html).not.toContain("data-explain-controls");
    expect(html).not.toContain(`>${EXPLAIN.you}<`);
    expect(html).not.toContain(`>${EXPLAIN.peer}<`);
    expect(html).not.toContain(EXPLAIN.meaning);
    expect(html).not.toContain(EXPLAIN.here);
    expect(html).not.toContain("<a ");
  });

  it("is named for what it is — the title, not the selected passage that there is none of", () => {
    const html = markup();

    expect(html).toContain(`aria-label="${EXPLAIN.ask}"`);
    expect(html).not.toContain(EXPLAIN.card);
    expect(html).toContain("data-explain-empty");
  });

  it("is the empty state whatever else it is handed: the flag wins over a passage, an answer and a thread", () => {
    const html = markup({ passage: PASSAGE, heading: "2 Methods", status: { kind: "answer", answer }, thread: view });

    expect(html).toContain(EXPLAIN.empty);
    expect(html).not.toContain(PASSAGE.slice(0, 20));
    expect(html).not.toContain(answer.meaning);
    expect(html).not.toContain("Why does a bigger ratio matter?");
    expect(html).not.toContain("<textarea");
    expect(html.split("<p")).toHaveLength(3);
  });

  it("is not on the card with a passage: that is as it was, with its quote, its answer and its input", () => {
    const html = markup({ empty: undefined, passage: PASSAGE, heading: "2 Methods", status: { kind: "answer", answer }, thread: view });

    expect(html).not.toContain(EXPLAIN.empty);
    expect(html).not.toContain("data-explain-empty");
    expect(html).toContain(`aria-label="${EXPLAIN.card}"`);
    expect(html).toContain("The rafting ratio rose from 0.2 to 0.7");
    expect(html).toContain(answer.meaning);
    expect(html).toContain("<textarea");
  });
});

// ── The first paint: what the box renders before anything has run (P8-06) ───────────────────────

const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const rafting: PaperTerm = { term: "rafting ratio", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", SENTENCE] },
  ],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;
const noBody = { body: [], map: { totalMinutes: 0, sections: [] } } as unknown as Pick<PaperReading, "body" | "map">;
const picked: ExplainSelection = {
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};

/** The box as the server (or the first client render) draws it, in a window `width` wide. */
function firstPaint(width: number, props: Partial<Parameters<typeof ExplainBox>[0]> = {}) {
  vi.stubGlobal("window", { innerWidth: width, innerHeight: 900 });
  return renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: reading.body.map((section) => section.heading) },
      createElement(ExplainBox, { target: null, terms: [], canAsk: true, onAsk: async () => answer, reading, ...props }),
    ),
  );
}

describe("ExplainBox — the first paint (P8-06, ruling §1h.45)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the empty window, with no selection and nothing run, for a reader with a key on a paper with a body, from 1024 px", () => {
    for (const width of [1024, 1280, 1920]) {
      const html = firstPaint(width);

      expect(html, `${width} px`).toContain("data-explain-empty");
      expect(html, `${width} px`).toContain(`>${EXPLAIN.empty}<`);
      expect(html, `${width} px`).toContain("data-explain-dock");
      // At the right edge, 360 wide, under the masthead: the dock's own place, with its top at 48.
      expect(html, `${width} px`).toMatch(/style="[^"]*right:\s*0(px)?;[^"]*width:\s*360px;[^"]*top:\s*48px/);
      expect(html, `${width} px`).not.toContain("data-explain-ask");
    }
  });

  it("is nothing without a key (a locked block is never shown), on a paper with no body, or below 1024 px", () => {
    expect(firstPaint(1280, { canAsk: false })).toBe("");
    expect(firstPaint(1280, { canAsk: false, terms: [rafting] })).toBe("");
    expect(firstPaint(1280, { reading: noBody })).toBe("");
    for (const width of [1023, 800, 640, 390]) expect(firstPaint(width), `${width} px`).toBe("");
  });

  it("stands beside the button of a selection that is already there — the window is not the button", () => {
    const html = firstPaint(1280, { target: picked });

    expect(html).toContain("data-explain-empty");
    expect(html).toContain("data-explain-ask");
    // The button is the one with the press: the card's title is not a second one.
    expect(html.split("<button")).toHaveLength(3);
  });

  it("does not have the Tier 0 window in it: no key, a defined term selected — only the button, until it is pressed", () => {
    const html = firstPaint(1280, { canAsk: false, terms: [rafting], target: { ...picked, passage: "The rafting ratio rose." } });

    expect(html).toContain("data-explain-ask");
    expect(html).not.toContain("data-explain-card");
    expect(html).not.toContain(EXPLAIN.empty);
  });
});
