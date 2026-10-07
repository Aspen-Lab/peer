import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { ExplainTurn } from "@/store/explain-threads";
import type { Paper } from "@/types";
import { EXPLAIN } from "./copy";
import { SectionLinks } from "./evidence-quote";
import { ExplainCard, requestExplanation, type ExplainStatus, type ThreadView } from "./explain-box";
import { pressKind, replyPair, requestReply, toggleStep, type PressKind } from "./explain-thread";

// P3-02c (ruling §1h.4 amendment; user decision §1a.11): the web-search toggle in
// the box's control row — off on every open, with its warning on hover and on
// focus and a two-step on a touch screen — the mark a searched message carries,
// the note when the provider cannot search. (The two lines for an allowance that is
// spent or cannot be checked went with the allowance: P4-00.) No DOM in this project's Vitest: the
// markup is rendered with react-dom/server, the pure rules stand on their own,
// and the handlers are called on the element tree `ExplainCard` returns (it has
// no hook). What the box does over time is in `explain-box.search.flow.test.tsx`.
// Every text is invented.

const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const PASSAGE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
const READER_ONE = "Why does a bigger ratio matter for the blade?";
const READER_TWO = "Does anyone else measure it this way?";
const PEER_ONE = "A bigger share of plates changes how the metal carries load.";
const PEER_TWO = "The plates form more slowly, so the ratio stays small.";

const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", SENTENCE] },
  ],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;

const answer: ExplainAnswer = {
  meaning: "A rafting ratio says how much of a sample has turned into plates.",
  here: { text: "The authors use it to compare alloys on one scale.", evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 },
};

type SearchView = NonNullable<ThreadView["search"]>;
const searchView = (over: Partial<SearchView> = {}): SearchView => ({ on: false, tip: false, onPointerDown: () => {}, onPress: () => {}, onBlur: () => {}, ...over });
const view = (over: Partial<ThreadView> = {}): ThreadView => ({
  turns: [],
  draft: "",
  pending: false,
  failed: false,
  onDraft: () => {},
  onSend: () => {},
  search: searchView(),
  ...over,
});

const card = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SectionLinks, { headings: reading.body.map((s) => s.heading) },
      createElement(ExplainCard, {
        passage: PASSAGE,
        heading: "2 Methods",
        term: null,
        termWhere: null,
        canAsk: true,
        status: { kind: "answer", answer } as ExplainStatus,
        onClose: () => {},
        thread: view(),
        ...over,
      })),
  );

/** The toggle button's own opening tag. */
const toggleTag = (html: string) => /<button[^>]*data-explain-search-toggle=""[^>]*>/.exec(html)?.[0] ?? "";
const tooltipTag = (html: string) => /<span[^>]*role="tooltip"[^>]*>/.exec(html)?.[0] ?? "";
const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1] ?? "";

describe("the copy (P3-02c)", () => {
  it("names the new strings exactly", () => {
    expect(EXPLAIN.searchToggle).toBe("Search the web");
    expect(EXPLAIN.searchWarning).toBe("Web search costs many times more than a normal reply. On for this message only.");
    expect(EXPLAIN.searchedMark).toBe("searched the web");
    expect(EXPLAIN.searchUnavailable).toBe("Web search is not available with this provider.");
  });

  it("holds no word the page never says to a reader: skip, don't read, ignore, not worth", () => {
    const strings = Object.values(EXPLAIN).flatMap((value) => (typeof value === "function" ? [value("a term")] : [value]));

    for (const text of strings) expect(text).not.toMatch(/\bskip\b|don't read|do not read|ignore|not worth/i);
  });

  it("names no web address and no source: the warning, the mark and the note say nothing a link could", () => {
    for (const text of [EXPLAIN.searchToggle, EXPLAIN.searchWarning, EXPLAIN.searchedMark, EXPLAIN.searchUnavailable]) {
      expect(text).not.toMatch(/https?:|www\.|\.com|\.org|google/i);
    }
  });
});

describe("ExplainCard — the search toggle (§1a.11)", () => {
  it("is a small button at the start of the control row, in the label face, named 'Search the web'", () => {
    const html = card();
    const controls = html.slice(html.indexOf("data-explain-controls"));

    expect(toggleTag(html)).toContain('type="button"');
    expect(controls.indexOf("data-explain-search-toggle")).toBeGreaterThan(-1);
    expect(controls.indexOf("data-explain-search-toggle")).toBeLessThan(controls.indexOf("<textarea"));
    expect(controls.indexOf("data-explain-search-toggle")).toBeLessThan(controls.indexOf(`>${EXPLAIN.send}<`));
    expect(html).toMatch(new RegExp(`<button[^>]*data-explain-search-toggle=""[^>]*>${EXPLAIN.searchToggle}</button>`));
    expect(classOf(toggleTag(html))).toMatch(/\bannotation\b/);
    expect(classOf(toggleTag(html))).toMatch(/\brounded-full\b/);
    expect(classOf(toggleTag(html))).toMatch(/\bborder\b/);
  });

  it("is off when it is not pressed: aria-pressed false, and the quiet border", () => {
    const tag = toggleTag(card());

    expect(tag).toContain('aria-pressed="false"');
    expect(classOf(tag)).toMatch(/text-text-muted/);
    expect(classOf(tag)).toMatch(/border-border-strong/);
    expect(classOf(tag)).not.toMatch(/border-heading/);
  });

  it("is on when pressed: aria-pressed true, and the border and the words of a selected chip", () => {
    const tag = toggleTag(card({ thread: view({ search: searchView({ on: true }) }) }));

    expect(tag).toContain('aria-pressed="true"');
    expect(classOf(tag)).toMatch(/border-heading/);
    expect(classOf(tag)).toMatch(/text-heading/);
  });

  it("is the one control that is not there without the box's search view: a card with no view of it has none", () => {
    expect(toggleTag(card({ thread: view({ search: undefined }) }))).toBe("");
    // The rest of the row is as it was.
    expect(card({ thread: view({ search: undefined }) })).toContain("<textarea");
  });

  it("is absent where the input is absent: with no key, no first answer, or no thread", () => {
    expect(toggleTag(card({ canAsk: false }))).toBe("");
    expect(toggleTag(card({ thread: undefined }))).toBe("");
    for (const status of [{ kind: "loading" }, { kind: "unavailable" }, { kind: "not_in_paper" }] as ExplainStatus[]) {
      expect(toggleTag(card({ status }))).toBe("");
    }
  });
});

describe("ExplainCard — the warning (§1a.11)", () => {
  it("is a tooltip the button is described by, with the ruled words", () => {
    const html = card();
    const tip = tooltipTag(html);
    const id = /id="([^"]+)"/.exec(tip)?.[1];

    expect(id).toBeTruthy();
    expect(toggleTag(html)).toContain(`aria-describedby="${id}"`);
    expect(html).toContain(`>${EXPLAIN.searchWarning}</span>`);
    expect(html.indexOf(EXPLAIN.searchWarning)).toBeGreaterThan(html.indexOf("data-explain-search-toggle"));
  });

  it("is hidden until the button is hovered or has the keyboard's focus — and the tooltip is the button's next sibling, so CSS can tell", () => {
    const html = card();
    const button = classOf(toggleTag(html));
    const tip = classOf(tooltipTag(html));

    expect(button).toMatch(/\bpeer\b/);
    expect(tip).toMatch(/\binvisible\b/);
    expect(tip).toMatch(/peer-hover:visible/);
    expect(tip).toMatch(/peer-focus-visible:visible/);
    expect(html).toMatch(/<\/button><span[^>]*role="tooltip"/);
  });

  it("is not shown for a toggle that cannot be pressed: there is nothing to warn about", () => {
    expect(classOf(tooltipTag(card()))).toMatch(/peer-disabled:hidden/);
  });

  it("opens by its attribute for a touch screen, and only then", () => {
    const closed = tooltipTag(card());
    const open = tooltipTag(card({ thread: view({ search: searchView({ tip: true }) }) }));

    expect(closed).not.toContain("data-tooltip-open");
    expect(open).toContain("data-tooltip-open");
    expect(classOf(open)).toMatch(/data-\[tooltip-open\]:visible/);
  });

  it("is in the label face, never a link, and clicks through to nothing", () => {
    const tip = tooltipTag(card());

    expect(classOf(tip)).toMatch(/\bannotation\b/);
    expect(classOf(tip)).toMatch(/pointer-events-none/);
    expect(card()).not.toMatch(/<a [^>]*>Web search/);
  });
});

describe("ExplainCard — when the toggle can be pressed", () => {
  const disabled = (html: string) => / disabled=""/.test(toggleTag(html));

  it("is enabled when idle", () => {
    expect(disabled(card())).toBe(false);
    expect(disabled(card({ thread: view({ search: searchView({ on: true }) }) }))).toBe(false);
  });

  it("is disabled while a reply is pending, and keeps showing whether it is on", () => {
    const html = card({ thread: view({ pending: true, search: searchView({ on: true }) }) });

    expect(disabled(html)).toBe(true);
    expect(toggleTag(html)).toContain('aria-pressed="true"');
  });

  it("is disabled when the thread is full", () => {
    const eight: ExplainTurn[] = Array.from({ length: 8 }, (_, i) => [{ role: "reader", text: `question ${i}` }, { role: "peer", text: `reply ${i}`, peer: true }] as ExplainTurn[]).flat();

    expect(disabled(card({ thread: view({ turns: eight }) }))).toBe(true);
    expect(disabled(card({ thread: view({ turns: eight.slice(0, 14) }) }))).toBe(false);
  });

  it("hands its three events to the box: the pointer's kind, the press and the blur", () => {
    const onPointerDown = vi.fn();
    const onPress = vi.fn();
    const onBlur = vi.fn();
    const tree = ExplainCard({ passage: PASSAGE, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer }, onClose: () => {}, thread: view({ search: searchView({ onPointerDown, onPress, onBlur }) }) });
    const props = findProps(tree, (p) => "data-explain-search-toggle" in p);
    expect(props).toBeDefined();

    (props!.onPointerDown as (event: unknown) => void)({ pointerType: "touch" });
    (props!.onClick as () => void)();
    (props!.onBlur as () => void)();

    expect(onPointerDown).toHaveBeenCalledWith("touch");
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

// The element tree the card returns, searched for one element by its props.
type Props = Record<string, unknown> & { children?: unknown };
function findProps(node: unknown, test: (props: Props) => boolean): Props | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, test);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as { type: unknown; props: Props };
  if (test(element.props)) return element.props;
  return findProps(element.props.children, test);
}

describe("ExplainCard — the mark and the note (§1a.11)", () => {
  const searchedTurns: ExplainTurn[] = [
    { role: "reader", text: READER_ONE },
    { role: "peer", text: PEER_ONE, peer: true },
    { role: "reader", text: READER_TWO, searched: true },
    { role: "peer", text: PEER_TWO, peer: true, searched: true },
  ];

  it("puts the label-face mark 'searched the web' beside 'You' on a message that searched — and on no other", () => {
    const html = card({ thread: view({ turns: searchedTurns }) });

    expect(html.split(`>${EXPLAIN.searchedMark}<`)).toHaveLength(2);
    const second = html.slice(html.indexOf(READER_TWO) - 400, html.indexOf(READER_TWO));
    expect(second).toContain(`>${EXPLAIN.you}<`);
    expect(second).toContain(`>${EXPLAIN.searchedMark}<`);
    const first = html.slice(html.indexOf(`>${EXPLAIN.you}<`), html.indexOf(READER_ONE));
    expect(first).not.toContain(EXPLAIN.searchedMark);
  });

  it("sets the mark in the label face, beside the label and not in the prose, never as a link", () => {
    const html = card({ thread: view({ turns: searchedTurns }) });
    const mark = new RegExp(`<span class="([^"]*)">${EXPLAIN.searchedMark}</span>`).exec(html)?.[1] ?? "";

    expect(mark).toMatch(/\bannotation\b/);
    expect(mark).toMatch(/text-text-faint/);
    expect(html).not.toMatch(new RegExp(`<a [^>]*>[^<]*${EXPLAIN.searchedMark}`));
    expect(html).toMatch(/font-mono[^"]*"[^>]*>You</);
  });

  it("leaves a message that did not search exactly as it was: the label alone", () => {
    const html = card({ thread: view({ turns: searchedTurns.slice(0, 2) }) });

    expect(html).not.toContain(EXPLAIN.searchedMark);
    expect(html).toMatch(new RegExp(`<div><p class="[^"]*font-mono[^"]*">${EXPLAIN.you}</p><p class="font-reading[^"]*">${READER_ONE.replace("?", "\\?")}</p></div>`));
  });

  it("shows the one-line note under a reply when the reader asked to search and the provider could not", () => {
    const turns: ExplainTurn[] = [{ role: "reader", text: READER_ONE }, { role: "peer", text: PEER_ONE, peer: true, searchUnavailable: true }];
    const html = card({ thread: view({ turns }) });

    expect(html).toContain(EXPLAIN.searchUnavailable);
    expect(html.indexOf(EXPLAIN.searchUnavailable)).toBeGreaterThan(html.indexOf(PEER_ONE));
    expect(html).not.toContain(EXPLAIN.searchedMark);
    const note = new RegExp(`<p class="([^"]*)">${EXPLAIN.searchUnavailable}</p>`).exec(html)?.[1] ?? "";
    expect(note).toMatch(/\bannotation\b/);
    expect(note).toMatch(/text-text-faint/);
  });

  it("shows the note after a verified quote too, still under the reply", () => {
    const turns: ExplainTurn[] = [
      { role: "reader", text: READER_ONE },
      { role: "peer", text: PEER_ONE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2, searchUnavailable: true },
    ];
    const html = card({ thread: view({ turns }) });

    expect(html.indexOf(EXPLAIN.searchUnavailable)).toBeGreaterThan(html.indexOf(`>${SENTENCE}<span`));
  });

  it("shows no note and no mark on a thread that never searched", () => {
    const html = card({ thread: view({ turns: searchedTurns.slice(0, 2) }) });

    expect(html).not.toContain(EXPLAIN.searchUnavailable);
    expect(html).not.toContain(EXPLAIN.searchedMark);
  });

  it("shows no link to a web source anywhere in the box, searched thread or not: every anchor is the page's own section link", () => {
    const html = card({
      thread: view({
        turns: [
          { role: "reader", text: READER_ONE, searched: true },
          { role: "peer", text: PEER_ONE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2, searched: true },
          { role: "reader", text: READER_TWO },
          { role: "peer", text: PEER_TWO, peer: true, searchUnavailable: true },
        ],
        search: searchView({ on: true, tip: true }),
      }),
    });
    const anchors = html.match(/<a [^>]*>/g) ?? [];

    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) expect(anchor).toMatch(/href="#paper-section-\d+"/);
    expect(html).not.toMatch(/href="https?:|href="\/\/|target="_blank"|<iframe|<img/i);
    expect(html).not.toMatch(/https?:\/\//);
  });
});

// ── The pure rules ──────────────────────────────────────────────────────

describe("pressKind (§1a.11)", () => {
  it("reads a touch as touch, a mouse or a pen as a pointer, and no pointer at all as the keyboard", () => {
    expect(pressKind("touch")).toBe("touch");
    expect(pressKind("mouse")).toBe("pointer");
    expect(pressKind("pen")).toBe("pointer");
    expect(pressKind(null)).toBe("keyboard");
    expect(pressKind(undefined)).toBe("keyboard");
    expect(pressKind("")).toBe("keyboard");
  });
});

describe("toggleStep — the touch two-step (§1a.11)", () => {
  const off = { on: false, tip: false };

  it("a mouse, a pen or the keyboard turns search on at once: the warning already showed on hover or focus", () => {
    for (const press of ["pointer", "keyboard"] as PressKind[]) expect(toggleStep(off, press)).toEqual({ on: true, tip: false });
  });

  it("a touch's first tap shows the warning and leaves search off", () => {
    expect(toggleStep(off, "touch")).toEqual({ on: false, tip: true });
  });

  it("a touch's second tap turns search on, and the warning is put away", () => {
    expect(toggleStep({ on: false, tip: true }, "touch")).toEqual({ on: true, tip: false });
  });

  it("a mouse or the keyboard with the warning open (a touch screen with a keyboard) turns it on as well", () => {
    for (const press of ["pointer", "keyboard"] as PressKind[]) expect(toggleStep({ on: false, tip: true }, press)).toEqual({ on: true, tip: false });
  });

  it("any press when it is on turns it off, whatever the pointer", () => {
    for (const press of ["touch", "pointer", "keyboard"] as PressKind[]) {
      expect(toggleStep({ on: true, tip: false }, press)).toEqual({ on: false, tip: false });
    }
  });

  it("is a pure function: it does not change the state it was given", () => {
    const state = Object.freeze({ on: false, tip: true });

    expect(() => toggleStep(state, "touch")).not.toThrow();
    expect(state).toEqual({ on: false, tip: true });
  });
});

describe("replyPair — what joins the thread when a reply arrives (§1a.11)", () => {
  const plain: ExplainTurn = { role: "peer", text: PEER_ONE, peer: true };
  const verified: ExplainTurn = { role: "peer", text: PEER_ONE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };

  it("for a message sent without search it is exactly the pair it always was: the reader's words, then Peer's reply", () => {
    expect(replyPair(READER_ONE, false, plain)).toEqual([{ role: "reader", text: READER_ONE }, plain]);
    expect(Object.keys(replyPair(READER_ONE, false, plain)[0])).toEqual(["role", "text"]);
  });

  it("marks the reader's message when the server says the reply searched", () => {
    const [reader, peer] = replyPair(READER_ONE, true, { ...verified, searched: true });

    expect(reader).toEqual({ role: "reader", text: READER_ONE, searched: true });
    expect(peer).toEqual({ ...verified, searched: true });
    expect(peer).not.toHaveProperty("searchUnavailable");
  });

  it("marks nothing and adds the note when the reader asked to search and the reply did not", () => {
    const [reader, peer] = replyPair(READER_ONE, true, verified);

    expect(reader).toEqual({ role: "reader", text: READER_ONE });
    expect(peer).toEqual({ ...verified, searchUnavailable: true });
  });

  it("keeps every other field of the reply and does not change the one it was given", () => {
    const given = Object.freeze({ ...verified });

    expect(replyPair(READER_ONE, true, given)[1]).toMatchObject(verified);
    expect(given).toEqual(verified);
  });
});

// ── The requests ────────────────────────────────────────────────────────

describe("the requests carry the reader's wish to search, and read the refusals (P3-02c)", () => {
  const paper: Paper = {
    id: "upload:0123456789abcdef", title: "A paper", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const selection = { sectionIndex: 1, paragraphIndex: 1, passage: PASSAGE };
  const thread: ExplainTurn[] = [{ role: "peer", text: "First answer." }];
  const args = { paper, selection, sectionId: "s2", thread, message: READER_ONE };
  const replied = (extra: Record<string, unknown> = {}) => ({ turn: { role: "peer", text: PEER_TWO, ...extra }, cached: false });

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const sentBody = (fetchMock: ReturnType<typeof stubFetch>) => JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
  afterEach(() => vi.unstubAllGlobals());

  it("a reply asks to search only when search is on: `search: true`, and no key at all otherwise", async () => {
    const on = stubFetch(200, replied());
    await requestReply({ ...args, search: true });
    expect(sentBody(on).search).toBe(true);

    for (const search of [false, undefined]) {
      const off = stubFetch(200, replied());
      await requestReply({ ...args, search });
      expect(sentBody(off)).not.toHaveProperty("search");
    }
  });

  it("the first message never asks to search", async () => {
    const fetchMock = stubFetch(200, { answer, cached: false });
    await requestExplanation({ paper, selection, sectionId: "s2" });

    expect(sentBody(fetchMock)).not.toHaveProperty("search");
  });

  it("returns a reply that searched with its flag, and one that did not with none", async () => {
    stubFetch(200, replied({ searched: true }));
    expect(await requestReply({ ...args, search: true })).toEqual({ role: "peer", text: PEER_TWO, searched: true });
    stubFetch(200, replied({ searched: false }));
    expect(await requestReply({ ...args, search: true })).toEqual({ role: "peer", text: PEER_TWO });
    stubFetch(200, replied());
    expect(await requestReply(args)).toEqual({ role: "peer", text: PEER_TWO });
  });

  it("every refusal is the plain 'unavailable': a 429 of the sign-in gate's, other statuses, a body that is not JSON", async () => {
    stubFetch(429, { error: "Too many requests" });
    expect(await requestReply(args)).toBe("unavailable");
    expect(await requestExplanation({ paper, selection, sectionId: "s2" })).toBe("unavailable");
    stubFetch(429, "not json");
    expect(await requestReply(args)).toBe("unavailable");
    for (const status of [400, 401, 404, 410, 422, 500, 503]) {
      stubFetch(status, { error: "x" });
      expect(await requestReply(args)).toBe("unavailable");
    }
  });
});
