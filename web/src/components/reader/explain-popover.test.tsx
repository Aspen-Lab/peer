import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import { defaultProfile, type Paper } from "@/types";
import { EXPLAIN, PEERS_READING } from "./copy";
import { SectionLinks } from "./evidence-quote";
import {
  ExplainCard,
  ExplainPopover,
  definingTerm,
  explainLlmOverride,
  placeButton,
  placeCard,
  previewOf,
  requestExplanation,
  termInPassage,
  termSource,
  type ExplainStatus,
} from "./explain-popover";
import type { ExplainSelection } from "./paper-body";

// P3-02 (ruling §1h.2; §3d 14): the button beside a selected passage and the
// card it opens. No DOM in this project's Vitest: the markup is rendered with
// react-dom/server, the pure rules (which term is in the passage, where the
// button and the card stand, what is sent) are tested on their own, and the
// click, Escape and a new selection are in `explain-popover.flow.test.tsx`.
// Everything is invented text.

const PEERS_HTML = PEERS_READING.replace(/'/g, "&#x27;");
const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const rafting: PaperTerm = { term: "rafting ratio", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const peerOnly: PaperTerm = { term: "creep", definition: "Slow deformation under load.", peer: true };

const selection: ExplainSelection = {
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};

const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", SENTENCE] },
  ],
  map: {
    totalMinutes: 1,
    sections: [
      { id: "s1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 1, words: 3, minutes: 1, paragraphs: [] },
      { id: "s2", heading: "2 Methods", canonical: "methods", role: "method", page: 2, words: 20, minutes: 1, paragraphs: [] },
    ],
  },
} as unknown as Pick<PaperReading, "body" | "map">;

const answer: ExplainAnswer = {
  meaning: "A rafting ratio says how much of a sample has turned into plates.",
  here: { text: "The authors use it to compare alloys on one scale.", evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 },
};
const peerAnswer: ExplainAnswer = { meaning: answer.meaning, here: { text: "The authors use it to compare alloys.", peer: true } };

type PopoverProps = Parameters<typeof ExplainPopover>[0];
const render = (props: Partial<PopoverProps> = {}) =>
  renderToStaticMarkup(
    createElement(SectionLinks, { headings: reading.body.map((s) => s.heading) },
      createElement(ExplainPopover, { target: selection, terms: [], canAsk: true, onAsk: async () => answer, reading, ...props })),
  );

describe("ExplainPopover — when the button shows (§1h.2)", () => {
  it("shows nothing without a selection", () => {
    expect(render({ target: null })).toBe("");
    expect(render({ target: null, terms: [rafting], canAsk: true })).toBe("");
  });

  it("shows the button for a reader who can ask", () => {
    const html = render({ canAsk: true });

    expect(html).toContain(">Explain this?<");
    expect(html).toMatch(/<button[^>]*type="button"/);
  });

  it("shows it with no key when the paper itself defines a term inside the passage", () => {
    expect(render({ canAsk: false, terms: [rafting] })).toContain(">Explain this?<");
    // Case does not matter.
    expect(render({ canAsk: false, terms: [{ ...rafting, term: "RAFTING RATIO" }] })).toContain(">Explain this?<");
  });

  it("shows nothing with no key and no paper definition: a locked block is not shown", () => {
    expect(render({ canAsk: false, terms: [] })).toBe("");
    expect(render({ canAsk: false, terms: [{ ...rafting, term: "tungsten" }] })).toBe("");
    // A definition that is Peer's, not the paper's, is no paper definition.
    expect(render({ canAsk: false, terms: [{ ...peerOnly, term: "rafting ratio" }] })).toBe("");
  });

  it("sets the button in the label face, fixed beside the selection, inside the viewport", () => {
    const html = render();
    const style = /style="([^"]*)"/.exec(html)?.[1] ?? "";
    const left = Number(/left:\s*(\d+(?:\.\d+)?)px/.exec(style)?.[1]);
    const top = Number(/top:\s*(\d+(?:\.\d+)?)px/.exec(style)?.[1]);

    expect(html).toMatch(/class="[^"]*\bfixed\b/);
    expect(html).toMatch(/class="[^"]*\bfont-mono\b/);
    expect(top).toBe(selection.rect.bottom + 6);
    expect(left).toBe(selection.rect.right - 60);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(1024 - 8);
  });

  it("sends nothing and shows no card until it is clicked: the closed popover is the button alone", () => {
    const html = render();

    expect(html).not.toContain("role=\"dialog\"");
    expect(html).not.toContain(EXPLAIN.loading);
    expect(html).not.toContain(EXPLAIN.meaning);
  });
});

const card = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SectionLinks, { headings: reading.body.map((s) => s.heading) },
      createElement(ExplainCard, {
        passage: selection.passage,
        heading: "2 Methods",
        term: null,
        termWhere: null,
        canAsk: true,
        status: { kind: "loading" } as ExplainStatus,
        onClose: () => {},
        ...over,
      })),
  );

describe("ExplainCard — the two parts (§1h.2)", () => {
  it("is a named, non-modal dialog and says its passage as the paper's own words, with its section", () => {
    const html = card({ status: { kind: "answer", answer } });

    expect(html).toContain('role="dialog"');
    expect(html).toContain(`aria-label="${EXPLAIN.card}"`);
    expect(html).not.toContain("aria-modal");
    // The passage is the paper's: an attributed quote, never a bare label-face line.
    expect(html).toContain("font-reading italic");
    expect(html).toContain(selection.passage);
    expect(html).toMatch(/— (?:<a [^>]*>)?§2 Methods/);
  });

  it("cuts a long passage to a short preview with an ellipsis", () => {
    const long = `${"word ".repeat(60)}end`;
    const html = card({ passage: long });

    expect(html).toContain(previewOf(long));
    expect(html).not.toContain(long);
    expect(previewOf(long).endsWith("…")).toBe(true);
    expect(previewOf(long).length).toBeLessThanOrEqual(81);
    expect(previewOf("A short passage.")).toBe("A short passage.");
  });

  it("shows the loading line, in the label face, while Peer is working", () => {
    const html = card({ status: { kind: "loading" } });

    expect(html).toContain(EXPLAIN.loading);
    expect(html).toContain('role="status"');
    expect(html).not.toContain(EXPLAIN.meaning);
    expect(html).not.toContain(EXPLAIN.here);
  });

  it("shows the two parts: What it means, then Why it is here, the prose in the reading face", () => {
    const html = card({ status: { kind: "answer", answer } });

    expect(html.indexOf(EXPLAIN.meaning)).toBeGreaterThan(-1);
    expect(html.indexOf(EXPLAIN.meaning)).toBeLessThan(html.indexOf(EXPLAIN.here));
    expect(html).toMatch(/font-mono[^"]*"[^>]*>What it means</);
    expect(html).toMatch(/font-mono[^"]*"[^>]*>Why it is here</);
    expect(html).toMatch(/<p class="font-reading[^"]*">A rafting ratio says how much/);
    expect(html).toMatch(/<p class="font-reading[^"]*">The authors use it to compare alloys on one scale\./);
  });

  it("labels the meaning as Peer's reading, once, beside its heading", () => {
    const html = card({ status: { kind: "answer", answer } });

    expect(html.split(PEERS_HTML)).toHaveLength(2);
    expect(html.indexOf(PEERS_HTML)).toBeGreaterThan(html.indexOf(EXPLAIN.meaning));
    expect(html.indexOf(PEERS_HTML)).toBeLessThan(html.indexOf(EXPLAIN.here));
  });

  it("shows the paper's sentence as an attributed quote with its section link and page — not as Peer's prose", () => {
    const html = card({ status: { kind: "answer", answer } });
    const after = html.slice(html.indexOf(EXPLAIN.here));

    expect(after).toContain(`>${SENTENCE}<span`);
    expect(after).toContain('<a href="#paper-section-1"');
    expect(after).toContain("§2 Methods");
    expect(after).toContain("p.2");
    // The prose is not italic and is not quote-styled.
    expect(after).toMatch(/<p class="font-reading(?![^"]*italic)[^"]*">The authors use it/);
  });

  it("when the quote could not be verified, labels the second part's prose as Peer's own and shows no quote", () => {
    const html = card({ status: { kind: "answer", answer: peerAnswer } });
    const after = html.slice(html.indexOf(EXPLAIN.here));

    expect(html.split(PEERS_HTML)).toHaveLength(3);
    expect(after).toContain(PEERS_HTML);
    expect(after).not.toContain("— §");
    expect(after).not.toContain("font-reading italic");
  });

  it("says Peer could not explain it just now, or that the selection is not the paper's text", () => {
    const unavailable = card({ status: { kind: "unavailable" } });
    const notIn = card({ status: { kind: "not_in_paper" } });

    expect(unavailable).toContain("Peer could not explain this just now.");
    expect(notIn).toContain("Select text from the paper itself.");
    for (const html of [unavailable, notIn]) {
      expect(html).not.toContain(EXPLAIN.meaning);
      expect(html).not.toContain(EXPLAIN.loading);
    }
  });

  it("has a close control", () => {
    expect(card()).toMatch(/<button[^>]*type="button"[^>]*>Close</);
  });
});

describe("ExplainCard — Tier 0: the paper's own definition (§1h.2)", () => {
  const where = { where: "2 Methods", page: 2 };

  it("opens with the defining sentence as a quote, with its section and page", () => {
    const html = card({ term: rafting, termWhere: where, status: { kind: "loading" } });

    expect(html).toContain(EXPLAIN.defines("rafting ratio"));
    expect(html).toContain(`>${SENTENCE}<span`);
    expect(html).toContain("§2 Methods");
    expect(html).toContain("p.2");
  });

  it("is the whole card, with no key: no parts, no loading, no apology", () => {
    const html = card({ canAsk: false, term: rafting, termWhere: where, status: { kind: "none" } });

    expect(html).toContain(SENTENCE);
    for (const text of [EXPLAIN.meaning, EXPLAIN.here, EXPLAIN.loading, EXPLAIN.unavailable, EXPLAIN.notInPaper]) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toContain(PEERS_HTML);
  });

  it("stands above the model's two parts when there is a key", () => {
    const html = card({ term: rafting, termWhere: where, status: { kind: "answer", answer } });

    expect(html.indexOf(EXPLAIN.defines("rafting ratio"))).toBeLessThan(html.indexOf(EXPLAIN.meaning));
  });
});

describe("the pure rules", () => {
  it("termInPassage: whole words, any case, multi-word terms; never inside another word", () => {
    expect(termInPassage("rafting ratio", "The Rafting Ratio rose.")).toBe(true);
    expect(termInPassage("QPU", "Run on a qpu today")).toBe(true);
    expect(termInPassage("DM", "The admission was late")).toBe(false);
    expect(termInPassage("ratio", "The rafting ratios rose")).toBe(false);
    expect(termInPassage("C++", "We wrote it in C++ and Go")).toBe(true);
    expect(termInPassage("(a)", "see (a) above")).toBe(true);
    expect(termInPassage("", "anything")).toBe(false);
  });

  it("definingTerm: the first term with the paper's own sentence that lies in the passage", () => {
    const other: PaperTerm = { ...rafting, term: "plates" };

    expect(definingTerm([peerOnly, rafting, other], selection.passage)).toBe(rafting);
    expect(definingTerm([other, rafting], "The plates and the rafting ratio")).toBe(other);
    expect(definingTerm([peerOnly], "Slow creep")).toBeNull();
    expect(definingTerm([rafting], "Nothing relevant here")).toBeNull();
    expect(definingTerm([], selection.passage)).toBeNull();
  });

  it("termSource: the term's own place, else the map's heading and page for its section, else the abstract", () => {
    expect(termSource(rafting, reading)).toEqual({ where: "2 Methods", page: 2 });
    expect(termSource({ ...rafting, evidenceWhere: undefined, page: undefined }, reading)).toEqual({ where: "2 Methods", page: 2 });
    expect(termSource({ ...rafting, evidenceWhere: undefined, sectionId: undefined, page: undefined }, reading)).toEqual({ where: "abstract", page: undefined });
  });

  it("placeButton: just below the selection, flipped above at the foot of the window, always inside it", () => {
    const vp = { width: 1024, height: 768 };

    // Centred under where the selection ends.
    expect(placeButton({ left: 300, top: 400, right: 420, bottom: 420 }, vp)).toEqual({ left: 360, top: 426 });
    expect(placeButton({ left: 300, top: 740, right: 420, bottom: 760 }, vp).top).toBeLessThan(740);
    expect(placeButton({ left: 1000, top: 100, right: 1020, bottom: 120 }, vp).left).toBe(1024 - 8 - 120);
    expect(placeButton({ left: -50, top: 100, right: 10, bottom: 120 }, vp).left).toBe(8);
    for (const rect of [{ left: 5, top: 5, right: 9, bottom: 9 }, { left: 900, top: 760, right: 1020, bottom: 780 }]) {
      const at = placeButton(rect, vp);
      expect(at.top).toBeGreaterThanOrEqual(8);
      expect(at.top).toBeLessThanOrEqual(768);
    }
  });

  it("placeCard: 360 px under the selection on a spread; the whole width under it on a phone", () => {
    const spread = placeCard({ left: 300, top: 400, right: 420, bottom: 420 }, { width: 1440, height: 900 });
    const phone = placeCard({ left: 40, top: 300, right: 200, bottom: 320 }, { width: 390, height: 780 });

    expect(spread).toMatchObject({ left: 300, width: 360, top: 428 });
    expect(phone).toMatchObject({ left: 12, width: 366 });
    expect(phone.top).toBe(328);
  });

  it("placeCard: never wider than the window, never off its right edge, flipped above when there is no room below", () => {
    const edge = placeCard({ left: 1300, top: 400, right: 1400, bottom: 420 }, { width: 1440, height: 900 });
    expect(edge.left + edge.width).toBeLessThanOrEqual(1440 - 12);

    const low = placeCard({ left: 300, top: 760, right: 420, bottom: 780 }, { width: 1440, height: 800 });
    expect(low.top).toBeUndefined();
    expect(low.bottom).toBe(800 - 760 + 8);
    expect(low.maxHeight).toBeGreaterThanOrEqual(120);

    const tiny = placeCard({ left: 10, top: 10, right: 30, bottom: 30 }, { width: 300, height: 700 });
    expect(tiny.width).toBe(276);
    // Whatever the room, the card's tallest extent stays in the window.
    for (const rect of [{ left: 0, top: 0, right: 5, bottom: 5 }, { left: 100, top: 690, right: 120, bottom: 700 }, { left: 100, top: 350, right: 120, bottom: 360 }]) {
      const at = placeCard(rect, { width: 1024, height: 700 });
      if (at.top !== undefined) expect(at.top + at.maxHeight).toBeLessThanOrEqual(700 - 12 + 0.001);
      if (at.bottom !== undefined) expect(700 - at.bottom - at.maxHeight).toBeGreaterThanOrEqual(12 - 0.001);
    }
  });
});

describe("explainLlmOverride", () => {
  it("is the reader's own provider and key when they have one", () => {
    expect(explainLlmOverride({ ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: "  USER-NOT-A-KEY  " })).toEqual({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });
  });

  it("is nothing for Peer's own model, or a provider with no key", () => {
    expect(explainLlmOverride({ ...defaultProfile, feedAiProvider: "default", feedAiApiKey: "USER-NOT-A-KEY" })).toBeUndefined();
    expect(explainLlmOverride({ ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: "   " })).toBeUndefined();
    expect(explainLlmOverride({ ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: undefined })).toBeUndefined();
  });
});

describe("requestExplanation — what is sent, and what comes back", () => {
  const paper: Paper = {
    id: "upload:0123456789abcdef", title: "A paper", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const args = { paper, selection: { sectionIndex: 1, paragraphIndex: 1, passage: selection.passage }, sectionId: "s2" };

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("posts the paper, the passage and where it sits, with no thread, to the paper's own explain route", async () => {
    const fetchMock = stubFetch(200, { answer, cached: false });
    await requestExplanation(args);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/papers/upload%3A0123456789abcdef/explain");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ paper, passage: selection.passage, sectionId: "s2", paragraphIndex: 1, thread: [] });
  });

  it("carries the reader's own key only when there is one", async () => {
    const fetchMock = stubFetch(200, { answer, cached: false });
    await requestExplanation({ ...args, llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(JSON.parse(String(init.body)).llmOverride).toEqual({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });
  });

  it("returns the answer", async () => {
    stubFetch(200, { answer, cached: true });

    expect(await requestExplanation(args)).toEqual(answer);
  });

  it("is 'unavailable' for an unavailable answer, an outage, a gone upload, a refusal and a network failure", async () => {
    stubFetch(200, { unavailable: true });
    expect(await requestExplanation(args)).toBe("unavailable");
    stubFetch(200, { unavailable: true, quota: { kind: "company_budget", reason: "exhausted" } });
    expect(await requestExplanation(args)).toBe("unavailable");
    for (const status of [401, 404, 410, 429, 500, 503]) {
      stubFetch(status, { error: "x" });
      expect(await requestExplanation(args)).toBe("unavailable");
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await requestExplanation(args)).toBe("unavailable");
  });

  it("is 'unavailable' for an answer that is not the shape it was promised", async () => {
    stubFetch(200, "not json");
    expect(await requestExplanation(args)).toBe("unavailable");
    stubFetch(200, { answer: { meaning: 5 }, cached: false });
    expect(await requestExplanation(args)).toBe("unavailable");
    stubFetch(200, {});
    expect(await requestExplanation(args)).toBe("unavailable");
  });

  it("is 'not_in_paper' for a 422", async () => {
    stubFetch(422, { error: "not_in_paper" });

    expect(await requestExplanation(args)).toBe("not_in_paper");
  });
});
