import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { explainWindowAvailable } from "@/lib/feed/ai-tier";
import { defaultProfile } from "@/types";

// P10-08 (the owner's review of 2026-10-13, items 8.4-8.5; ruling §1h.78): entering a paper shows NO explain window — with a key or without,
// at every width — and no floating pill beside a selection; the window exists only while a passage is open, and its Close is a large
// highlighted X at its top-left. (P8-06's always-present empty window and P9-03b's header control are gone: their tests, in
// `explain-box.empty.test.tsx` and `explain-box.empty.flow.test.tsx`, are replaced by this file and `explain-box.entry.flow.test.tsx`.)
// The markup is rendered with react-dom/server (no DOM in this project's Vitest); when the window opens and closes is in
// `explain-box.entry.flow.test.tsx`. Every text is invented.

const PASSAGE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
const answer: ExplainAnswer = { meaning: "A rafting ratio says how much of a sample has turned into plates.", here: { text: "The authors use it to compare alloys on one scale.", peer: true } };
const turns: ExplainTurn[] = [{ role: "reader", text: "Why does a bigger ratio matter?" }, { role: "peer", text: "It changes how the metal carries load.", peer: true }];
const view: ThreadView = { turns, draft: "", pending: false, failed: false, onDraft: () => {}, onSend: () => {}, search: { on: false, tip: false, onPointerDown: () => {}, onPress: () => {}, onBlur: () => {} } };

const markup = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: ["1 Introduction", "2 Methods"] },
      createElement(ExplainCard, { passage: PASSAGE, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer } as ExplainStatus, onClose: () => {}, dock: true, thread: view, ...over }),
    ),
  );

describe("the copy (P10-08)", () => {
  it("has no empty-state line: the window has no empty state", () => {
    expect((EXPLAIN as Record<string, unknown>).empty).toBeUndefined();
  });

  it("names the window's title, beside its Close X", () => {
    expect(EXPLAIN.title).toBe("Explain this");
    expect(EXPLAIN.close).toBe("Close");
  });
});

describe("ExplainCard — Close is a large highlighted X at the window's top-left (P10-08, review 8.4, 8.5)", () => {
  /** The header's first button: Close. */
  const closeButton = (html: string) => /<button[^>]*data-explain-close=""[^>]*>/.exec(html)?.[0] ?? "";

  it("is the first control of the window, before the title and the passage: at the top-left", () => {
    for (const place of [{ dock: true }, {}, { sheet: true }]) {
      const html = markup(place);

      expect(html.indexOf("data-explain-close"), JSON.stringify(place)).toBeGreaterThan(-1);
      expect(html.indexOf("data-explain-close")).toBeLessThan(html.indexOf(EXPLAIN.title));
      expect(html.indexOf(EXPLAIN.title)).toBeLessThan(html.indexOf("The rafting ratio rose"));
      // Nothing before it in the window but the header's frame: no other button, no link.
      const before = html.slice(0, html.indexOf('<button type="button" data-explain-close'));
      expect(before).not.toContain("<button");
      expect(before).not.toContain("<a ");
    }
  });

  it("is named Close for a screen reader, and a button the keyboard reaches", () => {
    const button = closeButton(markup());

    expect(button).toContain('aria-label="Close"');
    expect(button).toContain('type="button"');
    expect(button).not.toContain("tabindex");
    expect(button).not.toContain("disabled");
  });

  it("is at least 32 by 32 px (36 where there is a hover, 44 where there is none) and square", () => {
    const button = closeButton(markup());
    const classes = /class="([^"]*)"/.exec(button)![1].split(/\s+/);

    // Tailwind's spacing unit is 4 px: h-9 / w-9 = 36 px; the touch size is h-11 / w-11 = 44.
    expect(classes).toEqual(expect.arrayContaining(["h-9", "w-9", "[@media(hover:none)]:h-11", "[@media(hover:none)]:w-11"]));
  });

  it("is in the accent colour — filled, with the page's own contrasting text — and draws an X, not a word", () => {
    const html = markup();
    const button = closeButton(html);
    const classes = /class="([^"]*)"/.exec(button)![1].split(/\s+/);

    expect(classes).toEqual(expect.arrayContaining(["bg-accent", "text-bg"]));
    // The X is an icon (two strokes), with no visible "Close" text of its own; the old text button is gone.
    expect(html).toMatch(/<button[^>]*data-explain-close=""[^>]*><svg[^>]*aria-hidden="true"[^>]*><path d="M6 6l12 12M18 6L6 18"><\/path><\/svg><\/button>/);
    expect(html).not.toContain(`>${EXPLAIN.close}</button>`);
    expect(html).not.toContain("annotation shrink-0 text-text-faint");
  });

  it("the title stands beside it, in the label face, and the passage's quote under both", () => {
    const html = markup();

    expect(html).toMatch(/<p class="[^"]*font-mono[^"]*">Explain this<\/p>/);
    expect(html.indexOf(EXPLAIN.title)).toBeLessThan(html.indexOf("The rafting ratio rose"));
    expect(html).toContain("data-explain-close");
  });

  it("has no \"Explain this?\" control in its header any more, and no empty state", () => {
    for (const html of [markup(), markup({ dock: false }), markup({ sheet: true })]) {
      expect(html).not.toContain("data-explain-ask");
      expect(html).not.toContain("data-explain-empty");
      expect(html).not.toContain(">Explain this?<");
    }
  });
});

describe("ExplainCard — a passage selected in the Summary or an answer (P10-08, review 8.4)", () => {
  it("is shown as Peer's own words under a label naming where it is from — not as the paper's quote with a section", () => {
    for (const [source, label] of [["summary", EXPLAIN.fromSummary], ["answer", EXPLAIN.fromAnswer]] as const) {
      const html = markup({ source, passage: "Peer's own claim about the alloy.", heading: "" });

      expect(html, source).toContain(label);
      expect(html, source).toContain("Peer&#x27;s own claim about the alloy.");
      // No section link and no quote styling: the paper did not say it.
      expect(html, source).not.toContain("<a ");
      expect(html, source).not.toContain("§");
      expect(html.indexOf(label), source).toBeLessThan(html.indexOf("Peer&#x27;s own claim"));
      // The title and the X are as for the paper's passage.
      expect(html, source).toContain("data-explain-close");
      expect(html, source).toContain(EXPLAIN.title);
    }
  });

  it("is the paper's quote with its section when the passage is the paper's, or says nothing of where it is from", () => {
    for (const html of [markup({ source: "paper" }), markup()]) {
      expect(html).toContain("§2 Methods");
      expect(html).not.toContain(EXPLAIN.fromSummary);
      expect(html).not.toContain(EXPLAIN.fromAnswer);
    }
  });
});

// ── The first paint: what the box renders before anything has run ───────────────────────────────────

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
  passage: PASSAGE,
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

describe("ExplainBox — nothing stands on entering a paper (P10-08, review 8.5)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("draws nothing at any width, with a key or without, on a paper with a body or without: no window, no panel, no pill", () => {
    for (const width of [390, 640, 767, 768, 1023, 1024, 1280, 1440, 1920]) {
      for (const canAsk of [true, false]) {
        for (const body of [reading, noBody]) expect(firstPaint(width, { canAsk, reading: body }), `${width} px, canAsk ${canAsk}`).toBe("");
      }
    }
  });

  it("draws nothing for a reader's own key while the sign-in check has not answered (`unknown`) either, and for no key at all", () => {
    const local = { ...defaultProfile, feedAiProvider: "openai" as const, feedAiApiKey: "not-a-real-key" };
    const none = { ...defaultProfile, feedAiProvider: "default" as const, feedAiApiKey: "" };

    expect(firstPaint(1280, { canAsk: explainWindowAvailable(local, "unknown") })).toBe("");
    expect(firstPaint(1280, { canAsk: explainWindowAvailable(none, "unknown") })).toBe("");
  });

  it("draws nothing beside a selection either: no floating pill in the gutter or on the legend, at any width, with a key or a defined term", () => {
    for (const width of [390, 767, 768, 800, 1023, 1024, 1280, 1920]) {
      expect(firstPaint(width, { target: picked }), `${width} px, a key`).toBe("");
      expect(firstPaint(width, { canAsk: false, terms: [rafting], target: { ...picked, passage: "The rafting ratio rose." } }), `${width} px, a defined term`).toBe("");
    }
  });

  it("the page's width is not reserved on entering: the source writes `--explain-dock` only where a passage is open", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/explain-box.tsx"), "utf8");

    expect(source).toContain("const docked = open !== null && viewport.width >= DOCK_MIN_VIEWPORT_PX;");
    expect(source).not.toMatch(/emptyDockStands|standing|waiting/);
    expect(source).not.toContain("data-explain-ask");
    expect(source).not.toContain("placeButton");
  });
});

// ── A region, not a dialog (P9-20, BACKLOG-44; A P8-05 §11.8; the owner: "改") ───────────────────────────────────────

describe("the explain window is a non-modal region, never a dialog (P9-20, BACKLOG-44)", () => {
  it("no role=\"dialog\" and no aria-modal is on the window, in any of the places it takes: the dock, the card at the selection, the phone's sheet", () => {
    for (const [name, place] of [["dock", { dock: true }], ["card", { dock: false }], ["sheet", { dock: false, sheet: true }]] as const) {
      const html = markup(place);

      expect(html, name).toContain("data-explain-card");
      expect(html, name).not.toContain('role="dialog"');
      expect(html, name).not.toContain("aria-modal");
      expect(html.match(/role="region"/g), name).toHaveLength(1);
    }
  });

  it("is a landmark that has a name: the explanation of the selected passage", () => {
    for (const html of [markup({ dock: true }), markup({ dock: false, sheet: true }), markup({ dock: false })]) {
      expect(html).toMatch(new RegExp(`role="region"[^>]*aria-label="${EXPLAIN.card}"`));
    }
  });

  it("traps no focus and is modal nowhere: the component says neither `aria-modal` nor a dialog role", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/explain-box.tsx"), "utf8");

    expect(source).not.toMatch(/aria-modal\s*=/);
    expect(source).not.toMatch(/role=["']dialog["']/);
    expect(source).toMatch(/role="region"/);
  });
});
