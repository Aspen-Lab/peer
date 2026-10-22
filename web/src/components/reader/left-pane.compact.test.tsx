import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";

// P11-20 follow-up (rulings §1h.119, §1h.120, item 2b; BACKLOG-100): after the bibliographic lines left the fixed zone (item 2a) a briefing paper's zone
// was still 391 px against a cap of 379 at 1280 x 720 (a four-line title, four command rows, the strip) and 352 against 305 at 1024 x 600. Two means, in
// this order, both for the three panes only: (1) "Upload full article PDF" — an occasional act, not a reading control — leaves the commands and heads the
// details beside the bibliographic lines; (2) on a window under 800 css px high the briefing paper's command rows are compact: 32 px high (the hit area
// stays at least 32 px), 4 px apart, and under 700 the zone's own gaps 4 px, not 8. Every command stays, the strip and the progress stay, the cap is not
// raised. The heights are measured in a browser (the P11-20 checkpoint); this file pins the SHAPE. Invented text.

let spread = true;
vi.mock("./reader-layout", async (importOriginal) => ({ ...(await importOriginal<typeof import("./reader-layout")>()), useSpread: () => spread }));

import { DecisionBlock } from "./decision-block";
import { ReaderLayout } from "./reader-layout";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
/** The text between the braces of the at-rule that begins with `head`. */
const atRule = (head: string): string => {
  const start = CSS.indexOf(head);
  expect(start, `${head} is in globals.css`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let at = CSS.indexOf("{", start); at < CSS.length; at++) {
    if (CSS[at] === "{") depth++;
    if (CSS[at] === "}" && --depth === 0) return CSS.slice(CSS.indexOf("{", start) + 1, at);
  }
  throw new Error(`${head} is not closed`);
};
/** The rules of a block: [selector list, declarations]. */
const rulesOf = (block: string): [string, string][] => [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].replace(/\s+/g, " ").trim(), m[2].trim()]);
const px = (value: string): number => (value.endsWith("rem") ? parseFloat(value) * 16 : parseFloat(value));

const UPLOAD = createElement("i", { "data-upload-row": "" }, "UPLOAD-ROW");
const base = { sentences: ["SENTENCE-MARK."], stage: null, source: { url: "https://example.org/p.pdf", label: "Open the PDF" }, doi: undefined, isSaved: false, showAddKey: false, onSave: () => {}, onSkip: () => {}, onCopy: () => {}, onOpen: () => {}, onRead: () => {}, uploadAction: UPLOAD };
const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(DecisionBlock, { ...base, ...props } as never));
const paper = { venue: "Nature Communications", publishedDate: "2026-10-01T00:00:00Z", authors: ["A. Writer", "B. Reader"], leadAffiliation: "University of Invented Studies" } as unknown as Paper;

describe("the upload row is the details' in the three panes (decision-block.tsx)", () => {
  it("the commands do not hold it: the fixed zone keeps only what must stay in view while reading", () => {
    spread = true;
    const commands = html({ part: "commands" });

    expect(commands).not.toContain("UPLOAD-ROW");
    for (const command of ["Read it here", "Open the PDF", ">Save<", ">Skip<", ">Copy<"]) expect(commands, command).toContain(command);
  });

  it("the details open with the bibliography and then the upload row, before the sentence, in the same words (the element is the page's, handed over whole)", () => {
    spread = true;
    const details = html({ part: "details", paper, now: Date.UTC(2026, 9, 3) });

    expect(details).toContain('data-pane-upload=""');
    expect(details).toContain("UPLOAD-ROW");
    expect(details.indexOf("data-pane-bibliography")).toBeLessThan(details.indexOf("data-pane-upload"));
    expect(details.indexOf("data-pane-upload")).toBeLessThan(details.indexOf("SENTENCE-MARK."));
  });

  it("a paper with no upload row (an upload's own page, a server with no uploads) has nothing there", () => {
    spread = true;

    expect(html({ part: "details", paper, uploadAction: undefined })).not.toContain("data-pane-upload");
    expect(html({ part: "commands", uploadAction: undefined })).not.toContain("UPLOAD-ROW");
  });

  it("in one column it is where it was: the commands' last row, and not in the details", () => {
    spread = false;
    const commands = html({ part: "commands" });
    const details = html({ part: "details", paper });

    expect(commands).toContain("UPLOAD-ROW");
    expect(commands.indexOf("UPLOAD-ROW")).toBeGreaterThan(commands.indexOf(">Copy<"));
    expect(details).not.toContain("UPLOAD-ROW");
    expect(details).not.toContain("data-pane-upload");
    spread = true;
  });

  it("the whole block, in the panes, says it once", () => {
    spread = true;
    const whole = html({ paper, stage: null });

    expect(whole.match(/UPLOAD-ROW/g)).toHaveLength(1);
    expect(whole.indexOf("UPLOAD-ROW")).toBeGreaterThan(whole.indexOf("data-pane-bibliography"));
  });

  it("the page makes the element once and hands it to the commands and to the details", () => {
    const page = read("src/app/papers/[id]/page.tsx");
    const made = page.match(/const uploadAction = [^;]*<UploadButton targetPaper=\{paper\} onUploaded=\{setUpload\} \/>[^;]*;/g) ?? [];

    expect(made).toHaveLength(1);
    expect(made[0]).toContain('!paper.id.startsWith("upload:") && uploadsAvailable');
    expect(page.match(/\buploadAction=\{uploadAction\}/g)).toHaveLength(2);
    expect(page).not.toMatch(/uploadAction=\{!paper\.id/);
  });
});

describe("the commands' wrapper carries the hook the compact rules read (reader-layout.tsx)", () => {
  const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);
  const page = (spreadProp: boolean) =>
    renderToStaticMarkup(
      createElement(ReaderLayout, {
        spread: spreadProp, plate: mark("PLATE"), title: mark("TITLE"), decision: mark("DECISION"), details: mark("DETAILS"), progress: mark("PROGRESS"),
        tabs: mark("TABS"), tab: "digestion", map: mark("MAP"), common: mark("COMMON"), words: mark("WORDS"), additions: mark("ADDITIONS"), next: mark("NEXT"),
      }),
    );

  it("in the panes the fixed zone holds the title, the commands (inside the hook), the progress and the strip, in that order, and nothing of the details", () => {
    const html = page(true);
    const zone = html.slice(html.indexOf("data-reader-left-fixed"), html.indexOf("data-reader-left-scroll"));
    const at = (needle: string) => zone.indexOf(needle);

    expect(zone.match(/data-pane-commands/g)).toHaveLength(1);
    expect(/data-pane-commands=""[^>]*><i data-mark="DECISION">/.test(zone)).toBe(true);
    expect([at("TITLE"), at("data-pane-commands"), at("PROGRESS"), at("TABS")].every((n) => n >= 0)).toBe(true);
    expect(at("TITLE")).toBeLessThan(at("data-pane-commands"));
    expect(at("data-pane-commands")).toBeLessThan(at("PROGRESS"));
    expect(at("PROGRESS")).toBeLessThan(at("TABS"));
    expect(zone).not.toContain("DETAILS");
  });

  it("in one column nothing carries it", () => {
    expect(page(false)).not.toContain("data-pane-commands");
  });
});

describe("the compact command rows (globals.css)", () => {
  const COMPACT = "@media (max-height: 799px)";
  const STACK = ".reader-left [data-pane-commands] > * > .grid:has(> a)";

  it("is a rule of windows under 800 css px high, and says nothing about the width (the pane exists only from 1024)", () => {
    expect(CSS).toContain(COMPACT);
    expect(COMPACT).not.toMatch(/width/);
  });

  it("takes the rows of a paper with an Open row — a briefing paper's stack, `:has(> a)` — and no other: an upload's page, which fits, keeps its rows and its first map row", () => {
    const rules = rulesOf(atRule(COMPACT));

    expect(rules.length).toBeGreaterThan(0);
    for (const [selector] of rules) {
      expect(selector, selector).toContain(":has(> a)");
      expect(selector, selector).toContain(".reader-left [data-pane-commands]");
    }
  });

  it("makes each row 32 px high, 4 px from the next", () => {
    const rules = rulesOf(atRule(COMPACT));
    const rows = rules.find(([selector]) => selector.includes(":is(button, a)"));
    const gap = rules.find(([selector]) => selector === STACK);

    expect(rows?.[1]).toMatch(/height:\s*2rem;/);
    expect(gap?.[1]).toMatch(/row-gap:\s*0\.25rem;/);
  });

  it("keeps every hit area at least 32 px, and hides, empties and clips nothing", () => {
    const block = atRule(COMPACT);

    for (const [, value] of block.matchAll(/(?:^|[\s;{])(?:min-)?height:\s*([\d.]+(?:rem|px))/g)) expect(px(value)).toBeGreaterThanOrEqual(32);
    expect(block).not.toMatch(/display:\s*none|visibility|opacity|overflow|max-height|width:\s*0|height:\s*0|clip|scale|translate/);
  });

  it("under 700 css px high the briefing paper's zone gaps are 4 px, not 8 (the strip's and the progress's follow: they read --pane-gap)", () => {
    const rules = rulesOf(atRule("@media (max-height: 699px)"));
    const tight = rules.find(([selector]) => selector.includes(":has(") && selector.startsWith(".reader-left"));

    expect(tight?.[0]).toContain("[data-pane-commands] > * > .grid > a");
    expect(tight?.[1]).toMatch(/--pane-gap:\s*0\.25rem;/);
    // the pane's own 8 px stays for every paper (C P11-17c): an upload's gaps are what they were
    expect(rules.some(([selector, declarations]) => selector === ".reader-left" && /--pane-gap:\s*0\.5rem;/.test(declarations))).toBe(true);
  });

  it("does not touch the cap: the zone is made smaller, the cap is not raised", () => {
    // P11-37 re-aim (B P11-36 §3.5): the same cap, 62 % of the pane's body, with the legend taken as the zoomed length it is.
    expect(CSS).toMatch(/\.reader-left-fixed\s*\{[^}]*max-height:\s*calc\(0\.62\s*\*\s*\(\(100vh\s*-\s*4rem\)\s*\/\s*var\(--page-zoom,\s*1\)\s*-\s*var\(--legend-h\)\s*-\s*1rem\)\);/);
    expect(atRule(COMPACT)).not.toMatch(/reader-left-fixed|reader-left-scroll|progress|role=/);
  });
});
