import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionBlock } from "./decision-block";

// P10-41 (BACKLOG-39): the line under the progress bar says what the page is doing — the stage
// it is given — and is drawn only while a stage stands.

const NOOP = () => {};

function render(stage: { label: string; pct: number } | null) {
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
