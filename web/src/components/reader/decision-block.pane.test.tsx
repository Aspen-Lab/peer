import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// P11-16 (B P11-01 §2.3): in the three-pane page the reading controls stand in the left pane's header, so the details — in the pane's scroll
// zone — do not draw them a second time. The details part asks `useSpread()` (the window is 1024 css px or wider); the other tests of the
// block run on its server snapshot, one column, where the controls follow the private-PDF line as they always did.
vi.mock("./reader-layout", () => ({ useSpread: () => true }));

import { DecisionBlock } from "./decision-block";

const NOOP = () => {};
const base = { sentences: ["SENTENCE-MARK."], stage: null, source: null, doi: "10.1021/jacs.5c15436", isSaved: false, showAddKey: false, onSave: NOOP, onCopy: NOOP, onOpen: NOOP };
const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(DecisionBlock, { ...base, ...props } as never));

describe("DecisionBlock, in the three panes (P11-16)", () => {
  it("the details draw no reading controls: the pane's header has them", () => {
    const details = html({ part: "details" });

    expect(details).not.toContain('aria-label="Reading controls"');
    expect(details).not.toContain("Larger text");
    expect(details).toContain("SENTENCE-MARK.");
    expect(details).toContain("doi:10.1021/jacs.5c15436");
  });

  it("the sentence is the pane's note, with a rule beside it; the DOI wraps anywhere in the narrow pane", () => {
    const details = html({ part: "details" });
    const sentence = /<p class="([^"]*)">SENTENCE-MARK\./.exec(details)?.[1] ?? "";

    expect(sentence).toContain("border-l");
    expect(sentence).toContain("border-border-strong");
    expect(details).toMatch(/<a\b[^>]*class="[^"]*\bwrap-anywhere\b/);
  });

  it("the commands part is the commands alone, as in one column", () => {
    const commands = html({ part: "commands" });

    expect(commands).toContain(">Save<");
    expect(commands).not.toContain("SENTENCE-MARK");
  });
});
