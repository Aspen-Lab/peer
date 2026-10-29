import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionBlock } from "./decision-block";
import { ReaderCommands } from "./reader-commands";

// S21 (round 7, item 7-03): B recommended (not mandated) a
// renderToStaticMarkup smoke test of the icon row, the same shape
// app/profile/page.test.tsx's ColorThemePicker test already established
// (6-11) for an aria-pressed/label-swap assertion. Tried that shape here
// first and it does not work for this component, for a reason worth
// recording rather than silently working around: ColorThemePicker takes
// its value as a PROP, but DecisionBlock reads `fit` directly off
// `useReadingPrefsStore`. Confirmed by execution: zustand v5's default
// React hook (node_modules/zustand/esm/react.mjs) passes
// `() => selector(api.getInitialState())` as `useSyncExternalStore`'s
// SERVER snapshot — under `renderToStaticMarkup` this always reads the
// store's state as captured at module load, ignoring any `setState` call
// made before rendering (by design, so a real SSR pass can't mismatch a
// fresh client's first paint). A `useReadingPrefsStore.setState({fit:
// true})` immediately before rendering was confirmed (via
// `.getState().fit`) to update the live store, yet the rendered button
// still showed the store's original default — proving the store, not the
// component's own aria wiring, is what a test would need to control, and
// this framework path cannot control it. So this file only exercises the
// one state `renderToStaticMarkup` can reliably reach: the store's actual
// default (fit off) and `useSpread()`'s own hardcoded server snapshot
// (always `false` — reader-layout.tsx's own SSR-safe default, unrelated to
// viewport). The "fit on" / "spread on, enabled" paths need a real DOM —
// the manager's own Browser-pane check.

const NOOP = () => {};

function renderDecisionBlock({ skip = true, doi }: { skip?: boolean; doi?: string } = {}) {
  return renderToStaticMarkup(
    createElement(DecisionBlock, {
      sentences: ["Read from the abstract."],
      stage: null,
      source: null,
      ...(doi === undefined ? {} : { doi }),
      isSaved: false,
      showAddKey: false,
      onSave: NOOP,
      ...(skip ? { onSkip: NOOP } : {}),
      onCopy: NOOP,
      onOpen: NOOP,
    }),
  );
}

function fitButton(html: string): string {
  const match = html.match(/<button[^>]*aria-label="(?:Fit to screen|Book layout)"[^>]*>/);
  if (!match) throw new Error(`Fit button not found in: ${html}`);
  return match[0];
}

describe("DecisionBlock — Fit button, default (server-snapshot) render", () => {
  it("shows 'Fit to screen', unpressed", () => {
    const button = fitButton(renderDecisionBlock());
    expect(button).toContain('aria-label="Fit to screen"');
    expect(button).toContain('aria-pressed="false"');
  });

  it("is disabled with an explanatory title — useSpread()'s server snapshot is always false", () => {
    const button = fitButton(renderDecisionBlock());
    expect(button).toContain('disabled=""');
    expect(button).toContain('title="Fit needs the two-column layout"');
  });
});

// P1-08 (§1a.6, §1f.19): an uploaded PDF's page passes no `onSkip`, and the
// block then has no Skip button; every other page keeps it.
describe("DecisionBlock — the Skip button (P1-08)", () => {
  const skipButton = (html: string) => /<button[^>]*>(?:(?!<\/button>).)*Skip<\/button>/.test(html);

  it("renders Skip when the page gives onSkip", () => {
    expect(skipButton(renderDecisionBlock())).toBe(true);
  });

  it("renders no Skip button without onSkip; Save and Copy stay", () => {
    const html = renderDecisionBlock({ skip: false });
    expect(skipButton(html)).toBe(false);
    expect(html).not.toContain(">Skip<");
    expect(html).not.toContain("<kbd");
    expect(html).toContain("Save</button>");
    expect(html).toContain("Copy</button>");
  });

  // The merge of main (PR #34) moved the commands into `ReaderCommands`, which
  // is where the Skip button now lives, so the commands carry the rule
  // themselves: no `onSkip`, no Skip button and no `x` key; with it, both.
  it("ReaderCommands shows icons and labels without keyboard hints", () => {
    const commands = (onSkip?: () => void) =>
      renderToStaticMarkup(
        createElement(ReaderCommands, {
          source: null,
          isSaved: false,
          onSave: NOOP,
          ...(onSkip ? { onSkip } : {}),
          onCopy: NOOP,
          onOpen: NOOP,
        }),
      );

    const without = commands();
    expect(without).not.toContain(">Skip<");
    expect(without).not.toContain("<kbd");
    expect(without).toContain("<svg");
    expect(without).toContain("Save</button>");
    expect(without).toContain("Copy</button>");

    const withSkip = commands(NOOP);
    expect(withSkip).toContain("Skip</button>");
    expect(withSkip).not.toContain("<kbd");
  });

  // P6-01b (§1h.23): the verdict row has as many tracks as it has commands, so
  // an uploaded PDF's page (no Skip) is not left with an empty third track.
  it("ReaderCommands keeps the available actions together", () => {
    const verdictRow = (onSkip?: () => void) => {
      const html = renderToStaticMarkup(
        createElement(ReaderCommands, {
          source: null,
          isSaved: false,
          onSave: NOOP,
          ...(onSkip ? { onSkip } : {}),
          onCopy: NOOP,
          onOpen: NOOP,
        }),
      );
      // With no source, no read command and no upload row, the verdict row is
      // the only element whose class list names a grid track count.
      const row = html.match(/<div class="([^"]*reader-quick-actions[^"]*)"[^>]*>((?:(?!<\/div>).)*)<\/div>/);
      if (!row) throw new Error(`Verdict row not found in: ${html}`);
      const buttons = [...row[2].matchAll(/<button\b[^>]*>((?:(?!<\/button>).)*)<\/button>/g)].map((m) =>
        m[1].replace(/<svg\b[^>]*>(?:(?!<\/svg>).)*<\/svg>/g, ""),
      );
      return { classes: row[1].split(/\s+/), buttons };
    };

    const without = verdictRow();
    expect(without.classes).toContain("reader-quick-actions");
    expect(without.buttons).toEqual(["Save", "Copy"]);

    const withSkip = verdictRow(NOOP);
    expect(withSkip.classes).toContain("reader-quick-actions");
    expect(withSkip.buttons).toEqual(["Save", "Skip", "Copy"]);
  });
});

// P7-12 (R6, the owner's review): the DOI is a link to the journal's page, not a button
// that copies. `https://doi.org/<doi>` resolves to the publisher with no model and no
// request from Peer; the same URL is built for a public paper in reading.ts. The link is
// drawn only for a string that looks like a DOI, so an over-captured match from a PDF's
// first page (the upload route's regex stops only at whitespace or a quote) never makes a
// broken link.
describe("DecisionBlock — the DOI (P7-12, R6)", () => {
  const DOI_VALUE = "10.1021/jacs.5c15436";
  const anchors = (html: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  const doiAnchors = (html: string) => anchors(html).filter((tag) => tag.includes("doi.org"));

  it("is an <a> to https://doi.org/<doi> in a new tab, with rel noopener noreferrer", () => {
    const html = renderDecisionBlock({ doi: DOI_VALUE });
    const links = doiAnchors(html);
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="https://doi.org/${DOI_VALUE}"`);
    expect(links[0]).toContain('target="_blank"');
    expect(links[0]).toContain('rel="noopener noreferrer"');
  });

  it("keeps the icon, the mono face, the touch line and the wrap rule, and the text doi:<doi>", () => {
    const html = renderDecisionBlock({ doi: DOI_VALUE });
    const link = html.match(/<a\b[^>]*href="https:\/\/doi\.org\/[^"]*"[^>]*>((?:(?!<\/a>).)*)<\/a>/);
    expect(link).not.toBeNull();
    const [tag, inner] = [link![0], link![1]];
    expect(tag).toContain("font-mono");
    // P11-16, RE-AIMED: the wrap rule is the left pane's (from 1024 css px, `lg:`), not the old spread panel's (`xl:`).
    expect(tag).toContain("lg:wrap-anywhere");
    expect(tag).toContain("[@media(hover:none)]:min-h-11");
    expect(inner).toContain("<svg");
    expect(inner.replace(/<svg\b.*?<\/svg>/g, "")).toBe(`doi:${DOI_VALUE}`);
  });

  it("has no copy control any more: no button names the DOI, nothing says Copy DOI", () => {
    const html = renderDecisionBlock({ doi: DOI_VALUE });
    const buttons = [...html.matchAll(/<button\b[^>]*>((?:(?!<\/button>).)*)<\/button>/g)].map((m) => m[0]);
    expect(buttons.filter((button) => button.includes("doi") || button.includes(DOI_VALUE))).toEqual([]);
    expect(html).not.toContain("Copy DOI");
  });

  it("draws nothing for a paper with no DOI", () => {
    const html = renderDecisionBlock();
    expect(doiAnchors(html)).toEqual([]);
    expect(html).not.toContain("doi:");
  });

  it.each([
    ["words, not a DOI", "not a doi"],
    ["a registrant code too short", "10.12/short"],
    ["no suffix", "10.1021"],
    ["an empty suffix", "10.1021/"],
    ["a space inside the suffix", "10.1021/jacs. 5c15436"],
    ["a URL, not the bare DOI", "https://doi.org/10.1021/jacs.5c15436"],
    ["a prefix before the 10.", "doi:10.1021/jacs.5c15436"],
  ])("renders no link for a malformed DOI: %s", (_why, doi) => {
    const html = renderDecisionBlock({ doi });
    expect(doiAnchors(html)).toEqual([]);
    expect(html).not.toContain("doi.org");
    expect(html).not.toContain("doi:");
  });
});

// P7-14 (R2, the owner's review): the commands come first. The block used to open with the
// availability sentence, then the command rows, then the private-PDF line, the reading controls
// and the DOI. The owner wanted "Read it here", Save and Copy directly under the title; the
// sentence that says what Peer has and has not read follows them, then the rest in the order it
// had. The panel's pin is by its top now, so the commands are what stays in view.
describe("DecisionBlock — the command rows first (P7-14, R2)", () => {
  const DOI_VALUE = "10.1021/jacs.5c15436";
  const html = renderToStaticMarkup(
    createElement(DecisionBlock, {
      sentences: ["SENTENCE-MARK says what Peer has read."],
      stage: null,
      onRead: NOOP,
      readLabel: "Read it here",
      source: { label: "Open on arXiv", url: "https://arxiv.org/abs/2601.00001" },
      doi: DOI_VALUE,
      isSaved: false,
      showAddKey: false,
      onSave: NOOP,
      onSkip: NOOP,
      onCopy: NOOP,
      onOpen: NOOP,
      uploadAction: createElement("p", null, "UPLOAD-ROW"),
      uploadStatus: createElement("p", null, "PRIVATE-PDF-LINE"),
    }),
  );
  const at = (needle: string) => html.indexOf(needle);

  it("lists the command rows — read, the source, save · skip · copy, the upload row — before the availability sentence", () => {
    const rows = ["Read it here", "Open on arXiv", ">Save<", ">Skip<", ">Copy<", "UPLOAD-ROW"].map(at);

    expect(rows.every((index) => index >= 0)).toBe(true);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    expect(at("SENTENCE-MARK")).toBeGreaterThan(rows[rows.length - 1]);
  });

  it("then the sentence, the private-PDF line, the reading controls and the DOI, in that order", () => {
    const after = [at("SENTENCE-MARK"), at("PRIVATE-PDF-LINE"), at('aria-label="Fit to screen"'), at(`doi:${DOI_VALUE}`)];

    expect(after.every((index) => index >= 0)).toBe(true);
    expect([...after].sort((a, b) => a - b)).toEqual(after);
  });

  it("keeps the progress bar last while the model works", () => {
    const working = renderToStaticMarkup(
      createElement(DecisionBlock, {
        sentences: ["SENTENCE-MARK."],
        stage: { label: "Reading", pct: 40 },
        source: null,
        doi: DOI_VALUE,
        isSaved: false,
        showAddKey: false,
        onSave: NOOP,
        onCopy: NOOP,
        onOpen: NOOP,
      }),
    );

    expect(working.indexOf('role="progressbar"')).toBeGreaterThan(working.indexOf(`doi:${DOI_VALUE}`));
    expect(working.indexOf(">Save<")).toBeLessThan(working.indexOf("SENTENCE-MARK"));
  });

  it("the page's own block has no command after the sentence: nothing between the sentence and the private-PDF line but Peer's words", () => {
    const between = html.slice(at("SENTENCE-MARK"), at("PRIVATE-PDF-LINE"));

    expect(between).not.toContain("<button");
  });
});

// P7-14 (R9): on a phone the notes are a row in the command stack (no fixed tab there): after the
// verdict row, before the upload row, like the other commands — and before the sentence.
describe("DecisionBlock — the notes row (P7-14, R9)", () => {
  const html = renderToStaticMarkup(
    createElement(DecisionBlock, {
      sentences: ["SENTENCE-MARK."],
      stage: null,
      source: null,
      isSaved: false,
      showAddKey: false,
      onSave: NOOP,
      onSkip: NOOP,
      onCopy: NOOP,
      onOpen: NOOP,
      notesAction: createElement("p", null, "NOTES-ROW"),
      uploadAction: createElement("p", null, "UPLOAD-ROW"),
    }),
  );

  it("stands among the actions, before the upload row and the sentence", () => {
    const at = (needle: string) => html.indexOf(needle);

    expect(at(">Copy<")).toBeGreaterThan(-1);
    expect(at("NOTES-ROW")).toBeGreaterThan(at(">Save<"));
    expect(at(">Copy<")).toBeGreaterThan(at("NOTES-ROW"));
    expect(at("UPLOAD-ROW")).toBeGreaterThan(at("NOTES-ROW"));
    expect(at("SENTENCE-MARK")).toBeGreaterThan(at("UPLOAD-ROW"));
  });

  it("draws nothing for it when the page gives none", () => {
    const without = renderToStaticMarkup(
      createElement(DecisionBlock, { sentences: ["S."], stage: null, source: null, isSaved: false, showAddKey: false, onSave: NOOP, onCopy: NOOP, onOpen: NOOP }),
    );

    expect(without).not.toContain("NOTES-ROW");
  });
});

// P11-16 (B P11-01 §2.3, §3.2; ruling §1h.113 (a)): the block splits into the commands and the details. The three-pane page puts the commands
// in the left pane's fixed zone, under the title, and the details — the sentence, the private-PDF line, the DOI — in its scroll zone, after
// the map; one column puts them one after the other, as the block always was. P11-16 follow-up (ruling §1h.115 item 3): the report's progress
// is a third part, which the panes put in the fixed zone, directly after the commands, so it stays on screen while a report generates. All
// three are the one component, `part=` picks the view; with none it is the whole block, in the order every test above reads.
describe("DecisionBlock — the commands, the details and the progress apart (P11-16)", () => {
  const DOI_VALUE = "10.1021/jacs.5c15436";
  const base = {
    sentences: ["SENTENCE-MARK says what Peer has read."],
    stage: { label: "Reading", pct: 40 },
    onRead: NOOP,
    readLabel: "Read it here",
    source: { label: "Open on arXiv", url: "https://arxiv.org/abs/2601.00001" },
    doi: DOI_VALUE,
    isSaved: false,
    showAddKey: false,
    onSave: NOOP,
    onSkip: NOOP,
    onCopy: NOOP,
    onOpen: NOOP,
    notesAction: createElement("p", null, "NOTES-ROW"),
    uploadAction: createElement("p", null, "UPLOAD-ROW"),
    uploadStatus: createElement("p", null, "PRIVATE-PDF-LINE"),
  };
  const part = (which: "commands" | "details" | "progress" | undefined) =>
    renderToStaticMarkup(createElement(DecisionBlock, (which ? { ...base, part: which } : base) as never));
  const PROGRESS = ['role="progressbar"', "Reading…", 'aria-live="polite"'];
  const COMMANDS = [">Save<", ">Skip<", ">Copy<", "Read it here", "Open on arXiv", "NOTES-ROW", "UPLOAD-ROW"];
  const DETAILS = ["SENTENCE-MARK", "PRIVATE-PDF-LINE", `doi:${DOI_VALUE}`];

  it("the commands: the read command, the source, Save · Skip · Copy, the notes and the upload rows — and none of the rest", () => {
    const html = part("commands");
    const rows = ["Read it here", "Open on arXiv", ">Save<", "NOTES-ROW", ">Skip<", ">Copy<", "UPLOAD-ROW"].map((needle) => html.indexOf(needle));

    expect(rows.every((index) => index >= 0)).toBe(true);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    for (const gone of [...DETAILS, ...PROGRESS, 'aria-label="Reading controls"']) expect(html).not.toContain(gone);
  });

  it("the details: the sentence, the private-PDF line, the reading controls (one column), the DOI — and no command, no progress", () => {
    const html = part("details");
    const after = ["SENTENCE-MARK", "PRIVATE-PDF-LINE", 'aria-label="Fit to screen"', `doi:${DOI_VALUE}`].map((needle) => html.indexOf(needle));

    expect(after.every((index) => index >= 0)).toBe(true);
    expect([...after].sort((a, b) => a - b)).toEqual(after);
    for (const gone of [...COMMANDS, ...PROGRESS]) expect(html).not.toContain(gone);
  });

  it("the progress: the bar and the status line, and nothing else", () => {
    const html = part("progress");

    for (const kept of PROGRESS) expect(html).toContain(kept);
    expect(html).toContain('aria-valuenow="40"');
    for (const gone of [...COMMANDS, ...DETAILS, 'aria-label="Reading controls"']) expect(html).not.toContain(gone);
  });

  it("the progress part is empty while no stage stands", () => {
    expect(renderToStaticMarkup(createElement(DecisionBlock, { ...base, stage: null, part: "progress" } as never))).toBe("");
  });

  it("the three parts say, between them, everything the whole block says — once, in the whole block's order", () => {
    const whole = part(undefined).replace(/<[^>]*>/g, "");
    const apart = (part("commands") + part("details") + part("progress")).replace(/<[^>]*>/g, "");

    expect(apart).toBe(whole);
    expect(whole.split("SENTENCE-MARK").length - 1).toBe(1);
    expect(whole.split("Reading…").length - 1).toBe(1);
  });

  it("the commands part is the observer's element: it is a block of its own, as the page's decided-read ref needs", () => {
    expect(part("commands").startsWith("<div")).toBe(true);
  });
});
