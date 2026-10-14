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
