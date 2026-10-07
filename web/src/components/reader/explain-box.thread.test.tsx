import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPLAIN_CAPS, type ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import { MAX_EXPLAIN_MESSAGE_CHARS, MAX_EXPLAIN_TURNS, type ExplainTurn } from "@/store/explain-threads";
import type { Paper } from "@/types";
import { EXPLAIN, PEERS_READING } from "./copy";
import { SectionLinks } from "./evidence-quote";
import {
  ExplainCard,
  placeCard,
  placePanel,
  revealShift,
  type ExplainStatus,
  type ThreadView,
} from "./explain-box";
import { firstAnswerMessage, keyToSend, requestReply } from "./explain-thread";

// P3-02b (ruling §1h.3; §3d 14): the thread under the first answer, the input
// and its keys, where the box stands on the spread, between and on a phone, and
// the one request a send makes. No DOM in this project's Vitest: the markup is
// rendered with react-dom/server, the pure rules on their own, and the handlers
// are called on the element tree `ExplainCard` returns (it has no hook). What
// the box does over time is in `explain-box.thread.flow.test.tsx`. Every text is
// invented.

const PEERS_HTML = PEERS_READING.replace(/'/g, "&#x27;");
const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const PASSAGE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";

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

const READER_ONE = "Why does a bigger ratio matter for the blade?";
const PEER_ONE = "A bigger share of plates changes how the metal carries load.";
const READER_TWO = "And at a lower temperature?";
const PEER_TWO = "The plates form more slowly, so the ratio stays small.";
const verified: ExplainTurn = { role: "peer", text: PEER_ONE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const unverified: ExplainTurn = { role: "peer", text: PEER_TWO, peer: true };
const turns: ExplainTurn[] = [{ role: "reader", text: READER_ONE }, verified, { role: "reader", text: READER_TWO }, unverified];

const view = (over: Partial<ThreadView> = {}): ThreadView => ({ turns: [], draft: "", pending: false, failed: false, onDraft: () => {}, onSend: () => {}, ...over });

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

describe("ExplainCard — the thread (P3-02b)", () => {
  it("shows each message under its label, in order, under the first answer: You, then Peer", () => {
    const html = card({ thread: view({ turns }) });

    const youAt = html.indexOf(`>${EXPLAIN.you}<`);
    expect(youAt).toBeGreaterThan(html.indexOf(EXPLAIN.here));
    expect(html.indexOf(READER_ONE)).toBeGreaterThan(youAt);
    expect(html.indexOf(`>${EXPLAIN.peer}<`)).toBeGreaterThan(html.indexOf(READER_ONE));
    expect(html.indexOf(PEER_ONE)).toBeGreaterThan(html.indexOf(`>${EXPLAIN.peer}<`));
    expect(html.indexOf(READER_TWO)).toBeGreaterThan(html.indexOf(PEER_ONE));
    expect(html.indexOf(PEER_TWO)).toBeGreaterThan(html.indexOf(READER_TWO));
    expect(html.split(`>${EXPLAIN.you}<`)).toHaveLength(3);
    expect(html.split(`>${EXPLAIN.peer}<`)).toHaveLength(3);
  });

  it("sets the two labels in the label face and the prose in the reading face", () => {
    const html = card({ thread: view({ turns }) });

    expect(html).toMatch(/font-mono[^"]*"[^>]*>You</);
    expect(html).toMatch(/font-mono[^"]*"[^>]*>Peer</);
    expect(html).toMatch(new RegExp(`<p class="font-reading(?![^"]*italic)[^"]*">${READER_ONE.replace("?", "\\?")}`));
    expect(html).toMatch(new RegExp(`<p class="font-reading(?![^"]*italic)[^"]*">${PEER_ONE}`));
  });

  it("shows a verified reply's quote through the quote component, with its section link and page — and no label of Peer's reading", () => {
    const html = card({ thread: view({ turns: [turns[0], verified] }) });
    const after = html.slice(html.indexOf(PEER_ONE));

    expect(after).toContain(`>${SENTENCE}<span`);
    expect(after).toContain('<a href="#paper-section-1"');
    expect(after).toContain("§2 Methods");
    expect(after).toContain("p.2");
    // The first answer carries Peer's label once (its "What it means"); the verified reply adds none.
    expect(html.split(PEERS_HTML)).toHaveLength(2);
    // The reply's prose is not quote-styled.
    expect(after).toMatch(/^[^<]*<\/p>/);
  });

  it("labels an unverified reply as Peer's reading, beside its label, and shows no quote under it", () => {
    const html = card({ thread: view({ turns: [turns[2], unverified] }) });
    const after = html.slice(html.indexOf(`>${EXPLAIN.peer}<`));

    expect(after).toContain(PEERS_HTML);
    expect(html.split(PEERS_HTML)).toHaveLength(3);
    expect(after).not.toContain("— §");
    expect(after).not.toContain("font-reading italic");
  });

  it("never quote-styles the reader's own words", () => {
    const html = card({ thread: view({ turns: [turns[0]] }) });
    const mine = /<p class="([^"]*)">Why does a bigger ratio matter for the blade\?<\/p>/.exec(html)?.[1] ?? "";

    expect(mine).toContain("font-reading");
    expect(mine).not.toContain("italic");
  });

  it("says nothing of a thread before there is one, and has no label of its own", () => {
    const html = card({ thread: view() });

    expect(html).not.toContain(`>${EXPLAIN.you}<`);
    expect(html).not.toContain(`>${EXPLAIN.peer}<`);
    expect(html).not.toContain(EXPLAIN.thinking);
    expect(html).not.toContain(EXPLAIN.threadFull);
  });
});

describe("ExplainCard — the input (P3-02b)", () => {
  it("has a one-row textarea named by its placeholder, with a Send button beside it", () => {
    const html = card();

    expect(html).toMatch(/<textarea[^>]*rows="1"/);
    expect(html).toContain(`placeholder="${EXPLAIN.placeholder}"`);
    expect(html).toContain(`aria-label="${EXPLAIN.placeholder}"`);
    expect(html).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>${EXPLAIN.send}</button>`));
    expect(html).toContain(`maxLength="${MAX_EXPLAIN_MESSAGE_CHARS}"`);
  });

  it("limits a message to what the server reads of it: 400 characters", () => {
    expect(MAX_EXPLAIN_MESSAGE_CHARS).toBe(EXPLAIN_CAPS.messageChars);
    expect(MAX_EXPLAIN_TURNS).toBe(EXPLAIN_CAPS.threadReaderMessages);
  });

  it("shows what has been typed, and nothing is sent by showing it", () => {
    const html = card({ thread: view({ draft: "Why does it matter?" }) });

    expect(html).toContain(">Why does it matter?</textarea>");
  });

  it("is absent without a thread view or without a key: a Tier 0 box has no thread", () => {
    expect(card({ thread: undefined })).not.toContain("<textarea");
    expect(card({ thread: view(), canAsk: false, status: { kind: "none" } })).not.toContain("<textarea");
    expect(card({ thread: view(), canAsk: false })).not.toContain("<textarea");
    expect(card({ thread: view(), canAsk: false })).not.toContain(`>${EXPLAIN.send}<`);
  });

  it("is absent until there is a first answer to talk about", () => {
    for (const status of [{ kind: "loading" }, { kind: "unavailable" }, { kind: "not_in_paper" }] as ExplainStatus[]) {
      expect(card({ status })).not.toContain("<textarea");
    }
  });

  it("is pinned at the panel's foot: a sticky row after the thread, in the card that scrolls", () => {
    const html = card({ thread: view({ turns }) });
    const row = /<div[^>]*data-explain-controls=""[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";

    expect(row).toMatch(/\bsticky\b/);
    expect(row).toMatch(/-bottom-4/);
    expect(html.indexOf("data-explain-controls")).toBeGreaterThan(html.indexOf(PEER_TWO));
    expect(html.indexOf("<textarea")).toBeGreaterThan(html.indexOf("data-explain-controls"));
    // The card is the one thing that scrolls, up to the room it was given.
    expect(html).toMatch(/data-explain-card=""[^>]*class="[^"]*\boverflow-y-auto\b/);
  });

  it("keeps the passage and Close pinned at the top: a sticky header before everything that scrolls with the thread", () => {
    const html = card({ thread: view({ turns }) });
    const header = /<div class="([^"]*)"><div class="min-w-0 flex-1">/.exec(html)?.[1] ?? "";

    expect(header).toMatch(/\bsticky\b/);
    expect(header).toMatch(/-top-4/);
    expect(html.indexOf(PASSAGE)).toBeGreaterThan(-1);
    expect(html.indexOf(PASSAGE)).toBeLessThan(html.indexOf(EXPLAIN.meaning));
    expect(html.indexOf(">Close<")).toBeLessThan(html.indexOf(EXPLAIN.meaning));
  });

  it("is disabled while a reply is pending, with Peer's thinking line under the thread", () => {
    const html = card({ thread: view({ turns, draft: "next", pending: true }) });

    expect(html).toMatch(/<textarea[^>]* disabled=""/);
    expect(html).toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>${EXPLAIN.send}<`));
    expect(html).toContain(EXPLAIN.thinking);
    expect(html.indexOf(EXPLAIN.thinking)).toBeGreaterThan(html.indexOf(PEER_TWO));
    expect(html.indexOf(EXPLAIN.thinking)).toBeLessThan(html.indexOf("<textarea"));
    expect(card({ thread: view({ turns }) })).not.toContain(EXPLAIN.thinking);
  });

  it("is open and sendable when idle and the draft has words; Send waits for words", () => {
    const empty = card({ thread: view({ draft: "   " }) });
    const typed = card({ thread: view({ draft: "Why?" }) });

    expect(empty).not.toMatch(/<textarea[^>]* disabled=""/);
    expect(empty).toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>${EXPLAIN.send}<`));
    expect(typed).not.toMatch(/<textarea[^>]* disabled=""/);
    expect(typed).not.toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>${EXPLAIN.send}<`));
  });

  it("says Peer could not answer under the thread when a reply failed, and keeps the typed text in the input", () => {
    const html = card({ thread: view({ turns, draft: "Why does it matter?", failed: true }) });

    expect(html).toContain(EXPLAIN.unavailable);
    expect(html.indexOf(EXPLAIN.unavailable)).toBeGreaterThan(html.indexOf(PEER_TWO));
    expect(html).toContain(">Why does it matter?</textarea>");
    expect(html).not.toMatch(/<textarea[^>]* disabled=""/);
    expect(card({ thread: view({ turns }) })).not.toContain(EXPLAIN.unavailable);
  });

  it("at eight reader messages: the input is disabled under the full line, and Send with it", () => {
    const eight: ExplainTurn[] = Array.from({ length: MAX_EXPLAIN_TURNS }, (_, i) => [{ role: "reader", text: `question ${i}` }, { role: "peer", text: `reply ${i}`, peer: true }] as ExplainTurn[]).flat();
    const html = card({ thread: view({ turns: eight }) });

    expect(html).toContain(EXPLAIN.threadFull);
    expect(html.indexOf(EXPLAIN.threadFull)).toBeGreaterThan(html.indexOf("reply 7"));
    expect(html).toMatch(/<textarea[^>]* disabled=""/);
    expect(html).toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>${EXPLAIN.send}<`));
    // Seven are not a full thread.
    const seven = card({ thread: view({ turns: eight.slice(0, 14) }) });
    expect(seven).not.toContain(EXPLAIN.threadFull);
    expect(seven).not.toMatch(/<textarea[^>]* disabled=""/);
  });

  it("leaves the control row room for one more small control: a flex row of the input and Send", () => {
    const html = card();
    const row = /<div[^>]*data-explain-controls=""[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";

    expect(row).toMatch(/\bflex\b/);
    expect(row).toMatch(/\bgap-/);
    expect(html.indexOf("<textarea")).toBeLessThan(html.indexOf(`>${EXPLAIN.send}<`));
  });
});

// The handlers, called on the tree the card returns (it has no hook).
type Props = Record<string, unknown> & { children?: unknown };
function find(node: unknown, test: (props: Props, type: unknown) => boolean): Props | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, test);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as { type: unknown; props: Props };
  if (test(element.props, element.type)) return element.props;
  return find(element.props.children, test);
}
function textareaOf(thread: ThreadView): Props {
  const tree = ExplainCard({ passage: PASSAGE, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer }, onClose: () => {}, thread });
  const found = find(tree, (_props, type) => type === "textarea");
  if (!found) throw new Error("no textarea");
  return found;
}
function keyEvent(key: string, over: { shiftKey?: boolean; isComposing?: boolean; keyCode?: number } = {}) {
  return { key, shiftKey: over.shiftKey ?? false, keyCode: over.keyCode ?? 0, nativeEvent: { isComposing: over.isComposing ?? false }, preventDefault: vi.fn() };
}

describe("keyToSend (P3-02b)", () => {
  it("sends on Enter, and on nothing else", () => {
    expect(keyToSend({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
    for (const key of ["a", " ", "Tab", "Escape", "ArrowDown", "e", "q", "Backspace"]) {
      expect(keyToSend({ key, shiftKey: false, isComposing: false })).toBe(false);
    }
  });

  it("does not send on Shift+Enter: that is a newline", () => {
    expect(keyToSend({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
  });

  it("never sends during an IME composition, whatever key ends it", () => {
    expect(keyToSend({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(keyToSend({ key: "Enter", shiftKey: true, isComposing: true })).toBe(false);
  });
});

describe("the input's keys (P3-02b)", () => {
  it("Enter sends, once, and stops the newline", () => {
    const onSend = vi.fn();
    const onKeyDown = textareaOf(view({ draft: "Why?", onSend })).onKeyDown as (event: unknown) => void;
    const event = keyEvent("Enter");
    onKeyDown(event);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("Shift+Enter is a newline: nothing sent, the key left to the textarea", () => {
    const onSend = vi.fn();
    const onKeyDown = textareaOf(view({ draft: "Why?", onSend })).onKeyDown as (event: unknown) => void;
    const event = keyEvent("Enter", { shiftKey: true });
    onKeyDown(event);

    expect(onSend).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("an Enter that ends an IME composition sends nothing, however the browser reports it", () => {
    const onSend = vi.fn();
    const onKeyDown = textareaOf(view({ draft: "Why?", onSend })).onKeyDown as (event: unknown) => void;
    const composing = keyEvent("Enter", { isComposing: true });
    const legacy = keyEvent("Enter", { keyCode: 229 });
    onKeyDown(composing);
    onKeyDown(legacy);

    expect(onSend).not.toHaveBeenCalled();
    expect(composing.preventDefault).not.toHaveBeenCalled();
    expect(legacy.preventDefault).not.toHaveBeenCalled();
  });

  it("an e typed into the input is a letter: no handler of the box takes it", () => {
    const onSend = vi.fn();
    const onKeyDown = textareaOf(view({ draft: "", onSend })).onKeyDown as (event: unknown) => void;
    const event = keyEvent("e");
    onKeyDown(event);

    expect(onSend).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("typing hands the words to the box, which holds the draft", () => {
    const onDraft = vi.fn();
    const onChange = textareaOf(view({ onDraft })).onChange as (event: unknown) => void;
    onChange({ currentTarget: { value: "Why?", style: {}, scrollHeight: 20 }, target: { value: "Why?", style: {}, scrollHeight: 20 } });

    expect(onDraft).toHaveBeenCalledWith("Why?");
  });
});

describe("the Send button (P3-02b)", () => {
  it("sends on a press, for touch", () => {
    const onSend = vi.fn();
    const tree = ExplainCard({ passage: PASSAGE, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer }, onClose: () => {}, thread: view({ draft: "Why?", onSend }) });
    const send = find(tree, (props, type) => type === "button" && props.children === EXPLAIN.send);
    (send?.onClick as () => void)();

    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

// ── Where it stands ─────────────────────────────────────────────────────

describe("placePanel (P3-02b)", () => {
  const bounds = { left: 120, top: 300, right: 520, bottom: 330 };
  const spread = { width: 1440, height: 900 };

  it("stands beside the text on the spread: 360 wide, to the right of the column, its top at the selection's", () => {
    const place = placePanel(bounds, spread, { right: 1000 });

    expect(place.kind).toBe("side");
    expect(place).toMatchObject({ left: 1016, width: 360, top: 300 });
    expect(place.bottom).toBeUndefined();
    expect(place.maxHeight).toBe(900 - 300 - 12);
  });

  it("needs 376 px of room right of the column — and takes P3-02's place when it has less", () => {
    expect(placePanel(bounds, spread, { right: 1440 - 376 }).kind).toBe("side");
    const tight = placePanel(bounds, spread, { right: 1440 - 375 });

    expect(tight.kind).toBe("card");
    expect(tight).toMatchObject(placeCard(bounds, spread));
  });

  it("is P3-02's place with no column to measure", () => {
    expect(placePanel(bounds, spread, null)).toMatchObject({ kind: "card", ...placeCard(bounds, spread) });
  });

  it("keeps the panel inside the viewport: its top clamped to the margin above and to a usable height below", () => {
    const high = placePanel({ ...bounds, top: -400, bottom: -370 }, spread, { right: 1000 });
    const low = placePanel({ ...bounds, top: 880, bottom: 900 }, spread, { right: 1000 });

    expect(high.top).toBe(12);
    expect(high.maxHeight).toBe(900 - 12 - 12);
    expect(low.top).toBeLessThanOrEqual(900 - 12 - 280);
    expect(low.maxHeight).toBeGreaterThanOrEqual(280);
    for (const place of [high, low]) {
      expect((place.top ?? 0) + place.maxHeight).toBeLessThanOrEqual(900 - 12 + 0.001);
      expect((place.left ?? 0) + place.width).toBeLessThanOrEqual(1440);
    }
  });

  it("is P3-02's place between 640 and 1024, column or not", () => {
    for (const width of [640, 800, 1023]) {
      const viewport = { width, height: 800 };

      expect(placePanel(bounds, viewport, { right: 100 })).toMatchObject({ kind: "card", ...placeCard(bounds, viewport) });
    }
    expect(placePanel(bounds, { width: 1024, height: 800 }, { right: 600 }).kind).toBe("side");
  });

  it("is a bottom sheet below 640: full width, on the bottom edge, at most 60% of the height", () => {
    const phone = { width: 390, height: 844 };
    const place = placePanel({ left: 20, top: 200, right: 360, bottom: 240 }, phone, { right: 100 });

    expect(place.kind).toBe("sheet");
    expect(place).toMatchObject({ left: 0, width: 390, bottom: 0 });
    expect(place.top).toBeUndefined();
    expect(place.maxHeight).toBeLessThanOrEqual(0.6 * 844);
    expect(place.maxHeight).toBeGreaterThan(0.55 * 844);
    expect(placePanel(bounds, { width: 639, height: 700 }, null).kind).toBe("sheet");
    expect(placePanel(bounds, { width: 640, height: 700 }, null).kind).toBe("card");
  });

  it("changes placeCard not at all: P3-02's rule is still its own", () => {
    expect(placeCard({ left: 300, top: 400, right: 420, bottom: 420 }, { width: 1440, height: 900 })).toMatchObject({ left: 300, width: 360, top: 428 });
  });
});

describe("revealShift (P3-02b)", () => {
  const phone = { width: 390, height: 844 };

  it("is nothing when the selection already stands above the sheet", () => {
    expect(revealShift({ left: 20, top: 100, right: 300, bottom: 140 }, phone, 400)).toBe(0);
  });

  it("scrolls the page just far enough that the selection ends above the sheet, with a margin", () => {
    const shift = revealShift({ left: 20, top: 600, right: 300, bottom: 640 }, phone, 400);

    expect(shift).toBe(640 - (844 - 400 - 12));
    expect(shift).toBeGreaterThan(0);
  });

  it("never scrolls the selection's own top out of the window — where it cannot all fit it shows what it can", () => {
    const tall = revealShift({ left: 20, top: 100, right: 300, bottom: 820 }, phone, 400);

    expect(tall).toBe(100 - 12);
    expect(revealShift({ left: 20, top: 5, right: 300, bottom: 820 }, phone, 400)).toBe(0);
  });
});

// ── The request a send makes ────────────────────────────────────────────

describe("requestReply (P3-02b)", () => {
  const paper: Paper = {
    id: "upload:0123456789abcdef", title: "A paper", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const first = firstAnswerMessage(answer);
  const args = { paper, selection: { sectionIndex: 1, paragraphIndex: 1, passage: PASSAGE }, sectionId: "s2", thread: [first, ...turns.slice(0, 2)], message: "And then?" };
  const replied = { turn: { role: "peer", text: PEER_TWO, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 }, cached: false };

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("makes the first answer the thread's first peer message: both parts, in one", () => {
    expect(first).toEqual({ role: "peer", text: `${answer.meaning} ${answer.here.text}` });
  });

  // P4-00c (the 841 edge): the message the box builds for an answer whose two parts are at the
  // server's cap is exactly as long as the first message the server reads whole — no word of
  // "Why it is here" is left over the cap.
  it("makes a first message of both parts at their cap exactly as long as the server reads whole", () => {
    const part = (marker: string) => `${"alpha ".repeat(69)}${marker}`.slice(-EXPLAIN_CAPS.partChars);
    const atCap: ExplainAnswer = { meaning: part("ends-meaning."), here: { text: part("ends-here.") } };

    expect(firstAnswerMessage(atCap).text).toHaveLength(EXPLAIN_CAPS.firstAnswerChars);
    expect(firstAnswerMessage(atCap).text.endsWith("ends-here.")).toBe(true);
  });

  it("posts the paper, the passage and where it sits, and the thread with the reader's message last — roles and words only", async () => {
    const fetchMock = stubFetch(200, replied);
    await requestReply(args);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/papers/upload%3A0123456789abcdef/explain");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      paper,
      passage: PASSAGE,
      sectionId: "s2",
      paragraphIndex: 1,
      thread: [
        { role: "peer", text: first.text },
        { role: "reader", text: READER_ONE },
        { role: "peer", text: PEER_ONE },
        { role: "reader", text: "And then?" },
      ],
    });
  });

  it("carries the reader's own key only when there is one", async () => {
    const fetchMock = stubFetch(200, replied);
    await requestReply({ ...args, llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(JSON.parse(String(init.body)).llmOverride).toEqual({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });
  });

  it("returns the reply turn with its quote, its place and its page", async () => {
    stubFetch(200, replied);

    expect(await requestReply(args)).toEqual(replied.turn);
  });

  it("returns a Peer-labelled reply as such", async () => {
    stubFetch(200, { turn: { role: "peer", text: PEER_TWO, peer: true }, cached: true });

    expect(await requestReply(args)).toEqual({ role: "peer", text: PEER_TWO, peer: true });
  });

  it("is 'unavailable' for an unavailable answer, a refusal, a full thread, a gone upload, a network failure", async () => {
    stubFetch(200, { unavailable: true });
    expect(await requestReply(args)).toBe("unavailable");
    for (const status of [400, 401, 404, 410, 422, 429, 500, 503]) {
      stubFetch(status, { error: "thread_full" });
      expect(await requestReply(args)).toBe("unavailable");
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await requestReply(args)).toBe("unavailable");
  });

  it("is 'unavailable' for a turn that is not the shape it was promised — including a first answer", async () => {
    for (const body of ["not json", {}, { turn: { role: "reader", text: "x" } }, { turn: { role: "peer" } }, { turn: { role: "peer", text: "  " } }, { answer }, { turn: "text" }]) {
      stubFetch(200, body);

      expect(await requestReply(args)).toBe("unavailable");
    }
  });
});

describe("the copy (P3-02b)", () => {
  it("names the new strings exactly", () => {
    expect(EXPLAIN.you).toBe("You");
    expect(EXPLAIN.peer).toBe("Peer");
    expect(EXPLAIN.placeholder).toBe("Ask about this passage…");
    expect(EXPLAIN.send).toBe("Send");
    expect(EXPLAIN.thinking).toBe("Peer is thinking…");
    expect(EXPLAIN.threadFull).toBe("This thread is full. Select the passage again to start a new one.");
  });

  it("holds no word the page never says to a reader: skip, don't read, ignore, not worth", () => {
    const strings = Object.values(EXPLAIN).flatMap((value) => (typeof value === "function" ? [value("a term")] : [value]));

    for (const text of strings) expect(text).not.toMatch(/\bskip\b|don't read|do not read|ignore|not worth/i);
  });
});
