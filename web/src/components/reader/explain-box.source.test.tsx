import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExplainAnswer } from "@/lib/papers/explain";
import { EXPLAIN } from "./copy";
import { SectionLinks } from "./evidence-quote";
import { ExplainCard, type ExplainStatus } from "./explain-box";

// P10-38 (BACKLOG-75; ruling §1h.102, rule 2): the card names its source. For a selection in Peer's own words (the Summary, an answer)
// the second part is titled "Why Peer says it" and quotes the paragraph the quote was verified against, with its section; for a
// selection in the paper it stays "Why it is here". Rendered with react-dom/server (no DOM in this project's Vitest). Invented text.

const PASSAGE = "Tungsten slowed plate formation, so the rafting ratio stays low for longer.";
const QUOTE = "Tungsten additions delayed plate formation, and the rafting ratio stayed below 0.3 for 200 hours.";
const verified: ExplainAnswer = {
  meaning: "Plate formation is the alloy's grains lining up into flat layers.",
  here: { text: "The results report the same delay.", evidence: QUOTE, evidenceWhere: "3 Results", sectionId: "s3", page: 3 },
};
const peersReading: ExplainAnswer = { meaning: verified.meaning, here: { text: "Peer reads the delay into the results.", peer: true } };

const markup = (answer: ExplainAnswer, over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: ["1 Introduction", "3 Results"] },
      createElement(ExplainCard, { passage: PASSAGE, heading: "", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer } as ExplainStatus, onClose: () => {}, dock: true, ...over }),
    ),
  );

describe("ExplainCard — the second part names its source (P10-38, rule 2)", () => {
  it("is titled \"Why Peer says it\" for a selection in the Summary, with the verified paragraph quoted under it with its section", () => {
    const html = markup(verified, { source: "summary" });

    expect(html).toContain("Why Peer says it");
    expect(html).not.toContain(EXPLAIN.here);
    expect(html.indexOf("Why Peer says it")).toBeLessThan(html.indexOf("Tungsten additions delayed plate formation"));
    expect(html).toContain("3 Results");
  });

  it("is titled the same for a selection in an answer", () => {
    const html = markup(verified, { source: "answer" });

    expect(html).toContain("Why Peer says it");
    expect(html).not.toContain(EXPLAIN.here);
  });

  it("is titled so with no paragraph behind it too — the prose stays labelled Peer's reading, as today", () => {
    const html = markup(peersReading, { source: "summary" });

    expect(html).toContain("Why Peer says it");
    expect(html).toContain("Peer reads the delay into the results.");
    expect(html).not.toContain("Tungsten additions delayed plate formation, and");
  });

  it("stays \"Why it is here\" for a selection in the paper, marked or not", () => {
    for (const html of [markup(verified), markup(verified, { source: "paper" })]) {
      expect(html).toContain(EXPLAIN.here);
      expect(html).not.toContain("Why Peer says it");
    }
  });

  it("leaves the first part's title as it is whatever the source", () => {
    for (const source of [undefined, "paper", "summary", "answer"] as const) expect(markup(verified, { source })).toContain(EXPLAIN.meaning);
  });
});
