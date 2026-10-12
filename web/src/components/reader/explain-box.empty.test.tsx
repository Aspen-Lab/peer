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
    // Re-aimed, P9-20 (BACKLOG-44): a region, not a dialog.
    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="dialog"');
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

// ── The control in the window's header (P9-03b, ruling §1h.49) ─────────────────────────────────────────

describe("ExplainCard — the \"Explain this?\" control in the window's header (P9-03b)", () => {
  const control = (html: string) => html.match(/<button[^>]*data-explain-ask=""[^>]*>[^<]*<\/button>/g) ?? [];

  it("is not there unless a selection is on offer: the empty state and the card with a passage are as they were", () => {
    expect(markup()).not.toContain("data-explain-ask");
    expect(markup({ empty: undefined, passage: PASSAGE, heading: "2 Methods", status: { kind: "answer", answer }, thread: view })).not.toContain("data-explain-ask");
  });

  it("in the empty state it is the header's one button besides Close, beside the title, and the hint line stays (re-aimed, P9-17 ruling §1h.57: was \"in the title's place\", the title said once; the owner rejected departure d)", () => {
    const html = markup({ onExplain: () => {} });

    expect(control(html)).toHaveLength(1);
    expect(control(html)[0]).toContain('type="button"');
    expect(control(html)[0]).toContain(`>${EXPLAIN.ask}</button>`);
    // Two buttons — the control and Close — and two paragraphs, the title and the hint line: "Explain this?" is the window's
    // title AND the control's words, as the owner wants it ("together with the window's title").
    expect(html.split("<button")).toHaveLength(3);
    expect(html.split("<p")).toHaveLength(3);
    expect(html.split(`>${EXPLAIN.ask}<`)).toHaveLength(3);
    expect(html).toContain(`>${EXPLAIN.ask}</p>`);
    expect(html).toContain(`>${EXPLAIN.empty}</p>`);
    // The title, then the control, then Close, then the line; the window is still named for what it is.
    expect(html.indexOf(`>${EXPLAIN.ask}</p>`)).toBeLessThan(html.indexOf("data-explain-ask"));
    expect(html.indexOf("data-explain-ask")).toBeLessThan(html.indexOf(`>${EXPLAIN.close}<`));
    expect(html.indexOf(`>${EXPLAIN.close}<`)).toBeLessThan(html.indexOf(`>${EXPLAIN.empty}<`));
    expect(html).toContain(`aria-label="${EXPLAIN.ask}"`);
    expect(html).toContain("data-explain-empty");
  });

  // P9-17 (ruling §1h.57; the owner: "应该是和浮动ai窗口一起放入" — it goes in together with the window's title): the empty window shows
  // both, in one row, the control wrapping under the title only where the 360 px window cannot hold the two on one line.
  it("the empty window shows both the title and the control when a selection is offered: one row that wraps, the title first", () => {
    const html = markup({ onExplain: () => {} });

    expect(html).toMatch(new RegExp(`<p class="[^"]*font-mono[^"]*">${EXPLAIN.ask.replace("?", "\\?")}</p>`));
    expect(control(html)).toHaveLength(1);
    const row = /<div class="([^"]*)"><p [^>]*>Explain this\?<\/p><button[^>]*data-explain-ask=""/.exec(html);
    expect(row, "the title and the control are siblings in one container").not.toBeNull();
    expect(row![1].split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-wrap", "items-center"]));
    // Without a selection on offer the title stands alone, as it did.
    expect(markup()).not.toContain("data-explain-ask");
    expect(markup()).toContain(`>${EXPLAIN.ask}</p>`);
  });

  it("with a passage it stands in the header under the quote, above the answer, and the quote and Close stay", () => {
    const html = markup({ empty: undefined, passage: PASSAGE, heading: "2 Methods", status: { kind: "answer", answer }, thread: view, onExplain: () => {} });

    expect(control(html)).toHaveLength(1);
    expect(html.indexOf("The rafting ratio rose from 0.2 to 0.7")).toBeLessThan(html.indexOf("data-explain-ask"));
    expect(html.indexOf("data-explain-ask")).toBeLessThan(html.indexOf(`>${EXPLAIN.close}<`));
    expect(html.indexOf(`>${EXPLAIN.close}<`)).toBeLessThan(html.indexOf(answer.meaning));
    expect(html).toContain("<textarea");
  });

  it("is a pill in the label face that does not take the selection (it is not a floating box: no fixed position, no place of its own)", () => {
    for (const html of [markup({ onExplain: () => {} }), markup({ empty: undefined, passage: PASSAGE, heading: "2 Methods", status: { kind: "answer", answer }, onExplain: () => {} })]) {
      const [button] = control(html);
      expect(button).toMatch(/class="[^"]*font-mono[^"]*"/);
      expect(button).toMatch(/class="[^"]*rounded-full[^"]*"/);
      expect(button).not.toMatch(/\bfixed\b/);
      expect(button).not.toContain("style=");
    }
  });

  // P9-17 (A P9-R2 F5): the control is the only way in on a tablet of 1024 px or more with a key; the floating button it replaced
  // was 34 px tall, this one 26. The shell gives its touch controls `[@media(hover:none)]:min-h-11` (`notes-button.tsx`, the
  // masthead's links): 44 px where there is no hover, nothing where there is.
  it("is a touch target where there is no hover: `[@media(hover:none)]:min-h-11`, in the empty state and with a passage (P9-17)", () => {
    for (const html of [markup({ onExplain: () => {} }), markup({ empty: undefined, passage: PASSAGE, heading: "2 Methods", status: { kind: "answer", answer }, thread: view, onExplain: () => {} })]) {
      const [button] = control(html);
      expect(button).toMatch(/class="[^"]*\[@media\(hover:none\)\]:min-h-11[^"]*"/);
    }
  });

  it("presses through `onExplain` and holds the selection by cancelling the mouse-down", () => {
    const element = createElement(ExplainCard, { passage: "", heading: "", term: null, termWhere: null, canAsk: true, status: { kind: "none" } as ExplainStatus, onClose: () => {}, dock: true, empty: true, onExplain: () => {} });
    const found: Array<{ onClick?: () => void; onMouseDown?: (event: { preventDefault: () => void }) => void }> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const props = (node as { props: Record<string, unknown> }).props;
      if (props["data-explain-ask"] !== undefined) found.push(props as never);
      walk(props.children);
    };
    walk((element.type as unknown as (props: unknown) => unknown)(element.props));

    expect(found).toHaveLength(1);
    const prevented = { preventDefault: vi.fn() };
    found[0].onMouseDown?.(prevented);
    expect(prevented.preventDefault).toHaveBeenCalledTimes(1);
    expect(found[0].onClick).toBeTypeOf("function");
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

  it("is there for a reader's own key while the sign-in check has not answered (`unknown`), and for no key at all it is not", () => {
    const local = { ...defaultProfile, feedAiProvider: "openai" as const, feedAiApiKey: "not-a-real-key" };
    const none = { ...defaultProfile, feedAiProvider: "default" as const, feedAiApiKey: "" };

    expect(firstPaint(1280, { canAsk: explainWindowAvailable(local, "unknown") })).toContain("data-explain-empty");
    expect(firstPaint(1280, { canAsk: explainWindowAvailable(none, "unknown") })).toBe("");
  });

  it("stands beside the button of a selection that is already there — the window is not the button", () => {
    const html = firstPaint(1280, { target: picked });

    expect(html).toContain("data-explain-empty");
    expect(html).toContain("data-explain-ask");
    // The button is the one with the press: the card's title is not a second one.
    expect(html.split("<button")).toHaveLength(3);
  });

  it("P9-03b: the window carries the control of a selection that is already there; no floating button is rendered beside it", () => {
    for (const width of [1024, 1280, 1920]) {
      const html = firstPaint(width, { target: picked });

      expect(html.split("data-explain-ask"), `${width} px`).toHaveLength(2);
      // In the window's header: after the window opens, with no place of its own.
      expect(html.indexOf("data-explain-ask"), `${width} px`).toBeGreaterThan(html.indexOf("data-explain-card"));
      expect(html, `${width} px`).not.toMatch(/data-explain-ask=""[^>]*style=/);
      expect(html, `${width} px`).not.toContain("fixed z-[70] rounded-full");
    }
  });

  it("P9-03b: where no window stands the floating button does — no key and a defined term, from 1024 px as well as below it (re-aimed, P9-41: down to 768 px; under it the thumb bar's cell is the control and the box draws no button)", () => {
    const html = firstPaint(1280, { canAsk: false, terms: [rafting], target: { ...picked, passage: "The rafting ratio rose." } });

    expect(html.split("data-explain-ask")).toHaveLength(2);
    expect(html).toMatch(/data-explain-ask=""[^>]*style=/);
    for (const width of [1023, 800, 768]) expect(firstPaint(width, { target: picked }), `${width} px`).toMatch(/data-explain-ask=""[^>]*style=/);
    for (const width of [767, 390]) expect(firstPaint(width, { target: picked }), `${width} px`).not.toContain("data-explain-ask");
  });

  it("does not have the Tier 0 window in it: no key, a defined term selected — only the button, until it is pressed", () => {
    const html = firstPaint(1280, { canAsk: false, terms: [rafting], target: { ...picked, passage: "The rafting ratio rose." } });

    expect(html).toContain("data-explain-ask");
    expect(html).not.toContain("data-explain-card");
    expect(html).not.toContain(EXPLAIN.empty);
  });
});

// ── A region, not a dialog (P9-20, BACKLOG-44; A P8-05 §11.8; the owner: "改") ───────────────────────────────────────

describe("the explain window is a non-modal region, never a dialog (P9-20, BACKLOG-44)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const asCard = (place: { dock?: boolean; sheet?: boolean }) => markup({ empty: undefined, passage: PASSAGE, heading: "2 Methods", status: { kind: "answer", answer }, thread: view, ...place });

  it("no role=\"dialog\" and no aria-modal is on the page while the window stands: empty, with a control on offer, from 1024 px", () => {
    for (const width of [1024, 1280, 1920]) {
      for (const target of [null, picked]) {
        const html = firstPaint(width, { target });

        expect(html, `${width} px`).toContain("data-explain-card");
        expect(html, `${width} px`).not.toContain('role="dialog"');
        expect(html, `${width} px`).not.toContain("aria-modal");
        expect(html.match(/role="region"/g), `${width} px`).toHaveLength(1);
      }
    }
  });

  it("nor does the window that holds a thread, in any of the places it takes: the dock, the card at the selection, the phone's sheet", () => {
    for (const [name, place] of [["dock", { dock: true }], ["card", {}], ["sheet", { sheet: true }]] as const) {
      const html = asCard(place);

      expect(html, name).toContain("data-explain-card");
      expect(html, name).not.toContain('role="dialog"');
      expect(html, name).not.toContain("aria-modal");
      expect(html.match(/role="region"/g), name).toHaveLength(1);
    }
    // The empty window, as the dock.
    expect(markup()).not.toContain('role="dialog"');
    expect(markup().match(/role="region"/g)).toHaveLength(1);
  });

  it("is a landmark that has a name — the title while it is empty, the explanation of the selected passage once it holds one", () => {
    expect(markup()).toMatch(new RegExp(`role="region"[^>]*aria-label="${EXPLAIN.ask.replace("?", "\\?")}"`));
    expect(asCard({ dock: true })).toMatch(new RegExp(`role="region"[^>]*aria-label="${EXPLAIN.card}"`));
    for (const html of [markup(), asCard({ dock: true }), asCard({ sheet: true }), asCard({})]) {
      expect(/role="region"[^>]*aria-label="[^"]+"/.test(html)).toBe(true);
    }
  });

  it("traps no focus and is modal nowhere: the component says neither `aria-modal` nor a dialog role", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/explain-box.tsx"), "utf8");

    expect(source).not.toMatch(/aria-modal\s*=/);
    expect(source).not.toMatch(/role=["']dialog["']/);
    expect(source).toMatch(/role="region"/);
  });
});
