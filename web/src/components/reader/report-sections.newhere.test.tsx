import { Fragment, createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import type { PaperReport } from "@/lib/papers/report";
import { buildReading } from "@/lib/papers/reading";
import { BLOCK_HEADING, PEERS_READING, REPORT_HEADING, WHATS_NEW } from "./copy";
import { PaperWords } from "./paper-words";
import { ReaderLayout } from "./reader-layout";
import { ReaderTabs } from "./reader-tabs";
import * as sections from "./report-sections";

const { FigureRegistry, ProposalBlock, ResultsBlock } = sections;
// The new block is looked up by name: on the head it does not exist, and these tests must fail on that
// (the block is not there), not on the type-check.
const NewHereBlock = (sections as Record<string, unknown>)["NewHereBlock"] as ComponentType<{
  report: PaperReport;
  stagger: number;
  scramble?: boolean;
}>;

// P9-27 (the owner's decision, §1a.18 (b), "这个放到summary那里" — put it on the Summary): the paper's
// "What is new here" — the proposal's `newHere` lines, Peer's reading with no sentence of the paper to show
// for it — stands on the Summary tab as a block of its own, headed "What is new here", under the footer that
// marks it as Peer's reading, directly after the words that open the Summary (the claim, over the closed
// abstract) and before "What it proposes". It stands once: it is no longer inside "What it proposes". Each
// key result's own novelty line stays with its result (it belongs to that result). With no `newHere`, or no
// report at all (Tier 0), there is no block — no empty heading, no placeholder.

const NEW_A = "It replaces the imported film with a mulch cut from local seaweed.";
const NEW_B = "Three layer depths are compared in one orchard, not one.";
const SUMMARY_LINE = "The paper lays seaweed on terrace soil and logs the soil water.";
const NOVELTY = "Earlier trials used only one layer depth.";
const DECK = "Deeper seaweed layers held more soil water.";

const paper: Paper = {
  id: "upload:bbbb000000000000",
  title: "Seaweed mulch slows water loss from terraced orchard soil",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro:
    "Seaweed mulch was laid on terrace soil in three depths. The water holding index rose with depth.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
  textStatus: "ok",
};
const reading = buildReading(paper, null);

function reportWith(newHere?: string[]): PaperReport {
  return {
    skim: [{ text: DECK, evidence: "The water holding index rose with depth.", evidenceWhere: "abstract" }],
    whatItProposes: {
      summary: SUMMARY_LINE,
      methods: [],
      ...(newHere ? { newHere } : {}),
    },
    resultsAndSignificance: {
      summary: "Soil water stayed higher under the thick layer.",
      keyResults: [
        {
          title: "Water kept",
          detail: "The index rose with depth.",
          evidence: "The water holding index rose with depth.",
          novelty: NOVELTY,
          figureImageUrl: "https://example.test/result.png",
        },
      ],
    },
    provenance: { basis: "model-abstract", droppedClaims: 0 },
  };
}

/**
 * The Summary tab as the page lays it out in one column: the real layout and tab strip, the words that
 * open it (the deck over the closed abstract, or the paper's own claim when there is no report), then the
 * report's blocks in the page's order. `report` null is Tier 0: no model report at all.
 */
function summaryTab(report: PaperReport | null, scramble = false): string {
  const registry = new FigureRegistry();
  const bound = new Set<string>();
  return renderToStaticMarkup(
    createElement(ReaderLayout, {
      spread: false,
      plate: null,
      title: null,
      decision: createElement("i", { "data-mark": "DECISION" }, "DECISION"),
      tabs: createElement(ReaderTabs, { tab: "summary", onSelect: () => {} }),
      tab: "summary",
      words: createElement(PaperWords, {
        reading,
        marks: [],
        skim: report?.skim ?? [],
        basis: report?.provenance.basis ?? null,
        quotedSkim: [],
        scramble,
      }),
      additions: createElement(
        Fragment,
        null,
        report && createElement(NewHereBlock, { report, stagger: 0, scramble }),
        report &&
          createElement(ProposalBlock, {
            report,
            paper,
            figure: { url: "https://example.test/proposal.png", caption: "The proposal" },
            registry,
            bound,
            stagger: 1,
            scramble,
          }),
        report &&
          createElement(ResultsBlock, {
            report,
            paper,
            abstractSentences: reading.abstract.sentences,
            figures: [null],
            registry,
            bound,
            stagger: 2,
            scramble,
          }),
      ),
      next: null,
    }),
  );
}

const times = (html: string, text: string) => html.split(text).length - 1;
const HEADING = (label: string) => new RegExp(`<h2[^>]*>(?:<span[^>]*></span>)?${label}</h2>`);
const at = (html: string, text: string) => html.indexOf(text);
const headingAt = (html: string, label: string) => html.search(HEADING(label));

describe("'What is new here' on the Summary tab (P9-27)", () => {
  // Rendered once, on first use, so a missing block fails the tests that need it and not the file.
  let rendered: string | null = null;
  const page = () => (rendered ??= summaryTab(reportWith([NEW_A, NEW_B])));

  it("stands in the Summary's tabpanel as a block of its own, headed 'What is new here'", () => {
    const html = page();
    const panel = at(html, 'role="tabpanel"');

    expect(at(html, 'aria-labelledby="reader-tab-summary"')).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(-1);
    expect(headingAt(html, "What is new here")).toBeGreaterThan(panel);
    expect(times(html, "What is new here</h2>")).toBe(1);
    expect(at(html, NEW_A)).toBeGreaterThan(headingAt(html, "What is new here"));
    expect(at(html, NEW_B)).toBeGreaterThan(at(html, NEW_A));
  });

  it("follows the claim that opens the Summary, and comes before 'What it proposes'", () => {
    const html = page();
    const deck = at(html, DECK);
    const abstractRow = at(html, "Abstract</span>");
    const here = headingAt(html, "What is new here");
    const proposes = headingAt(html, REPORT_HEADING.proposal);

    expect(deck).toBeGreaterThan(-1);
    expect(abstractRow).toBeGreaterThan(deck);
    expect(here).toBeGreaterThan(abstractRow);
    expect(proposes).toBeGreaterThan(here);
    expect(at(html, SUMMARY_LINE)).toBeGreaterThan(proposes);
    expect(headingAt(html, BLOCK_HEADING.findings)).toBeGreaterThan(at(html, SUMMARY_LINE));
  });

  it("keeps the footer that marks it as Peer's reading, not the paper's words, under its lines", () => {
    const html = page();
    const footer = at(html, PEERS_READING);

    expect(footer).toBeGreaterThan(at(html, NEW_B));
    expect(footer).toBeLessThan(headingAt(html, REPORT_HEADING.proposal));
    expect(times(html, PEERS_READING)).toBe(1);
  });

  it("shows each 'new here' line once on the page: it is no longer inside 'What it proposes'", () => {
    const html = page();
    expect(times(html, NEW_A)).toBe(1);
    expect(times(html, NEW_B)).toBe(1);
    expect(times(html, PEERS_READING)).toBe(1);
  });

  it("'What it proposes' holds the proposal and its figure, with neither the lines nor the footer", () => {
    const proposal = renderToStaticMarkup(
      createElement(ProposalBlock, {
        report: reportWith([NEW_A, NEW_B]),
        paper,
        figure: { url: "https://example.test/proposal.png", caption: "The proposal" },
        registry: new FigureRegistry(),
        bound: new Set<string>(),
        stagger: 0,
      }),
    );

    expect(proposal).toContain(SUMMARY_LINE);
    expect(proposal).toContain("The proposal");
    expect(proposal).not.toContain(NEW_A);
    expect(proposal).not.toContain(NEW_B);
    expect(proposal).not.toContain(PEERS_READING);
  });

  it("leaves each result's own novelty line with its result", () => {
    const html = page();
    const heading = headingAt(html, BLOCK_HEADING.findings);
    const result = at(html, "Water kept.");

    expect(times(html, `${WHATS_NEW}</span>`)).toBe(1);
    expect(times(html, NOVELTY)).toBe(1);
    expect(result).toBeGreaterThan(heading);
    expect(at(html, WHATS_NEW)).toBeGreaterThan(result);
    expect(at(html, NOVELTY)).toBeGreaterThan(at(html, WHATS_NEW));
    // The paper's block is the heading; the result's is the mono label with its colon.
    expect(headingAt(html, "What is new here")).toBeLessThan(heading);
  });

  it("is the same block while the report scrambles into place: heading and footer stand, once", () => {
    const fresh = summaryTab(reportWith([NEW_A, NEW_B]), true);

    expect(times(fresh, "What is new here</h2>")).toBe(1);
    expect(times(fresh, PEERS_READING)).toBe(1);
    expect(headingAt(fresh, "What is new here")).toBeLessThan(headingAt(fresh, REPORT_HEADING.proposal));
  });
});

describe("no 'What is new here' block without a 'new here' line (P9-27)", () => {
  it("a report without `newHere`: no block, no heading, no footer; the rest of the Summary is there", () => {
    const html = summaryTab(reportWith());

    expect(html).not.toContain("What is new here</h2>");
    expect(html).not.toContain(PEERS_READING);
    expect(html).toContain(SUMMARY_LINE);
    expect(html).toContain(NOVELTY);
  });

  it("a report with an empty `newHere`, or one of blank lines: no block", () => {
    for (const newHere of [[], ["", "   "]]) {
      const html = summaryTab(reportWith(newHere));

      expect(html).not.toContain("What is new here</h2>");
      expect(html).not.toContain(PEERS_READING);
    }
  });

  it("the block alone renders nothing for those reports", () => {
    for (const newHere of [undefined, [], ["", "  "]]) {
      expect(renderToStaticMarkup(createElement(NewHereBlock, { report: reportWith(newHere), stagger: 0 }))).toBe("");
    }
  });

  it("Tier 0 (no model report): the claim and the abstract, no block, no heading", () => {
    const html = summaryTab(null);

    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("Abstract</span>");
    expect(html).not.toContain("What is new here");
    expect(html).not.toContain(PEERS_READING);
    expect(html).not.toContain(REPORT_HEADING.proposal);
  });
});
