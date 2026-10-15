import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionBlock } from "./decision-block";

// P10-41 (BACKLOG-39): the line under the progress bar says what the page is doing — the stage
// it is given — and is drawn only while a stage stands.

const NOOP = () => {};

function render(stage: { label: string; pct: number | null } | null) {
  return renderToStaticMarkup(
    createElement(DecisionBlock, {
      sentences: ["Read from the abstract."],
      stage,
      source: null,
      isSaved: false,
      showAddKey: false,
      onSave: NOOP,
      onCopy: NOOP,
      onOpen: NOOP,
    }),
  );
}

describe("DecisionBlock — the status line (P10-41)", () => {
  it("names the stage plainly under the bar, and not as a fixed 'loading report...'", () => {
    const html = render({ label: "Reading your questions", pct: 35 });
    const status = html.match(/<p aria-live="polite"[^>]*>([^<]*)<\/p>/);

    expect(status?.[1]).toBe("Reading your questions…");
    expect(html.toLowerCase()).not.toContain("loading report");
  });

  it("draws no status line and no bar when no stage stands", () => {
    const html = render(null);

    expect(html).not.toContain('aria-live="polite"');
    expect(html).not.toContain('role="progressbar"');
  });
});

// P10-45 (BACKLOG-93): the stage is named once, and the bar is drawn only once it has a progress to show.
// `pct: null` is "no progress yet" (a request has started and the server has not said a stage).

describe("DecisionBlock — one stage word, and a bar only with a progress (P10-45)", () => {
  it("names the stage once in the text the reader sees: under the bar, not again in the sentence", () => {
    const html = render({ label: "Writing the report", pct: 75 });
    const visible = html.replace(/<[^>]*>/g, "");

    expect(visible.split("Writing the report").length - 1).toBe(1);
    expect(visible).toContain("Read from the abstract.");
  });

  it("a stage with no progress yet draws its words and no bar (a queued request starts from nothing, not from 0)", () => {
    const html = render({ label: "Starting the report", pct: null });
    const status = html.match(/<p aria-live="polite"[^>]*>([^<]*)<\/p>/);

    expect(status?.[1]).toBe("Starting the report…");
    expect(html).not.toContain('role="progressbar"');
  });

  it("a stage with a progress still draws the bar at that progress", () => {
    const html = render({ label: "Reading the paper", pct: 35 });

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="35"');
  });
});

// P10-47 (round 5's reader 3): the report's status is drawn once on the page at any moment — one line
// under the bar, one bar at most — in every state, in every layout the page is drawn in.

import { ReaderLayout } from "./reader-layout";

const STATES: Array<[string, { label: string; pct: number | null } | null]> = [
  ["no stage", null],
  ["a request just started (no progress yet)", { label: "Starting the report", pct: null }],
  ["a stage with a progress", { label: "Adding figures", pct: 92 }],
  ["the move to a queued question", { label: "Your new question — reading it", pct: null }],
];

/** The report's status as the reader meets it: the live line, the bars, and how often its words are said. */
function statusIn(html: string, stage: { label: string; pct: number | null } | null) {
  const visible = html.replace(/<[^>]*>/g, "");
  return {
    lines: (html.match(/aria-live="polite"/g) ?? []).length,
    bars: (html.match(/role="progressbar"/g) ?? []).length,
    said: stage ? visible.split(stage.label).length - 1 : 0,
  };
}

describe("the report's status line is drawn once (P10-47)", () => {
  for (const [name, stage] of STATES) {
    it(`${name}: one line, at most one bar, the words said once`, () => {
      const seen = statusIn(render(stage), stage);

      expect(seen.lines).toBe(stage ? 1 : 0);
      expect(seen.bars).toBe(stage && stage.pct !== null ? 1 : 0);
      expect(seen.said).toBe(stage ? 1 : 0);
    });
  }

  // The page hands the decision block to the layout, which mounts it in one of three places by
  // layout; none of them may draw it twice.
  const layouts: Array<[string, Record<string, unknown>]> = [
    ["one column", { spread: false }],
    ["the spread's panel, with the strip and the map", { spread: true, tabs: createElement("i", null, "TABS"), map: createElement("i", null, "MAP"), tab: "digestion" }],
    ["the spread's panel, no strip and no map", { spread: true }],
  ];
  for (const [layout, over] of layouts) {
    for (const [name, stage] of STATES) {
      it(`${layout}, ${name}: the page carries one status line`, () => {
        const html = renderToStaticMarkup(
          createElement(ReaderLayout, {
            plate: createElement("i", null, "PLATE"),
            title: createElement("i", null, "TITLE"),
            decision: createElement(DecisionBlock, {
              sentences: ["Read from the abstract."],
              stage,
              source: null,
              isSaved: false,
              showAddKey: false,
              onSave: NOOP,
              onCopy: NOOP,
              onOpen: NOOP,
            }),
            words: createElement("i", null, "WORDS"),
            additions: createElement("i", null, "ADDITIONS"),
            next: createElement("i", null, "NEXT"),
            ...over,
          } as never),
        );
        const seen = statusIn(html, stage);

        expect(seen.lines).toBe(stage ? 1 : 0);
        expect(seen.said).toBe(stage ? 1 : 0);
      });
    }
  }
});

// P10-47 (the manager's ruling): while a stage shows, the sentence is the availability sentence and
// nothing more: the page's wait is said once, in the status line under the bar, never also at the
// sentence's end ("— your model is at work…" is gone with `progressSuffix`).

describe("the sentence carries no status words while a stage shows (P10-47)", () => {
  for (const [name, stage] of STATES) {
    it(`${name}: the sentence paragraph is exactly the sentence`, () => {
      const html = render(stage);
      const sentence = html.match(/<p class="[^"]*(?:measure-lede|border-l)[^"]*">([\s\S]*?)<\/p>/);

      expect(sentence?.[1]).toBe("Read from the abstract.");
      expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/at work/i);
    });
  }
});
