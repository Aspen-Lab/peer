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
import { DOCK_MIN_VISIBLE_PX, DOCK_THREAD_FLOOR_PX } from "./explain-dock";
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

// ── The dock (P7-15, R7) ────────────────────────────────────────────────

describe("ExplainCard — as the dock (P7-15, R7)", () => {
  const cardClass = (html: string) => /data-explain-card=""[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
  const controlsClass = (html: string) => /<div[^>]*data-explain-controls=""[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";

  // P8-02: the dock is level with its paragraph and as tall as its content, so it no longer spans the masthead's
  // foot to the legend's top; it carries its own top and bottom lines (it was "a line on its left only").
  it("is marked as the dock, a column against the right edge: a line on its left, top and bottom, none on the right", () => {
    const html = card({ dock: true, thread: view({ turns }) });
    const cls = cardClass(html);

    expect(html).toContain('data-explain-dock=""');
    expect(html).not.toContain("data-explain-sheet");
    expect(cls).toMatch(/\bfixed\b/);
    expect(cls).toMatch(/\bz-\[70\]/);
    expect(cls).toMatch(/\boverflow-y-auto\b/);
    expect(cls).toMatch(/\bflex\b/);
    expect(cls).toMatch(/\bflex-col\b/);
    // Level with its paragraph it stands free of the masthead and the legend: its own line on top and at the foot,
    // and none on the right, where it meets the screen's edge.
    expect(cls).not.toMatch(/\bborder-(y|t|b)-0\b/);
    expect(cls).toMatch(/\bborder-r-0\b/);
  });

  it("keeps the input at the dock's foot when the thread is short: the controls row takes the free space above it", () => {
    const row = controlsClass(card({ dock: true, thread: view({ turns }) }));

    expect(row).toMatch(/\bmt-auto\b/);
    expect(row).toMatch(/\bsticky\b/);
    expect(row).toMatch(/-bottom-4/);
    expect(row).not.toMatch(/\bmt-4\b/);
  });

  it("is not marked as the dock when it is the card or the sheet, and those keep their classes", () => {
    const plain = card({ thread: view({ turns }) });
    const sheet = card({ sheet: true, thread: view({ turns }) });

    expect(plain).not.toContain("data-explain-dock");
    expect(sheet).not.toContain("data-explain-dock");
    expect(cardClass(plain)).toMatch(/\brounded-lg\b/);
    expect(cardClass(plain)).toMatch(/\bshadow-card-hover\b/);
    expect(cardClass(plain)).not.toMatch(/\bflex-col\b/);
    expect(cardClass(sheet)).toMatch(/\brounded-t-lg\b/);
    expect(controlsClass(plain)).toMatch(/\bmt-4\b/);
    expect(controlsClass(plain)).not.toMatch(/\bmt-auto\b/);
  });
});

// ── Where it stands ─────────────────────────────────────────────────────

describe("placePanel (P3-02b; P7-15, R7)", () => {
  const bounds = { left: 120, top: 300, right: 520, bottom: 330 };
  const spread = { width: 1440, height: 900 };

  // P7-15 (R7, Q4): from 1024 px the conversation is a dock fixed at the window's right edge, not a
  // panel at the selection: flush right, 360 wide, scrolling inside, the page keeping its width clear.
  // P8-02 (BACKLOG-31): its top is level with the first line of the explained passage's PARAGRAPH,
  // clamped to the band between the 48 px masthead's foot and the 28 px foot legend less 160 px; its
  // height is its content, at most what is left below the top. The selection's own words do not enter it.
  it("is a dock at the window's right edge from 1024 px: 360 wide, its top the paragraph's, no bottom of its own", () => {
    for (const [width, height] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]]) {
      const place = placePanel(bounds, { width, height }, 300);

      expect(place.kind).toBe("dock");
      expect(place).toEqual({ kind: "dock", right: 0, width: 360, top: 300, maxHeight: height - 300 - 28 });
      expect(place.left).toBeUndefined();
      expect(place.bottom).toBeUndefined();
    }
  });

  it("does not depend on where the selection's words are once the paragraph is known: the same rectangle for a selection high, low or at the right edge", () => {
    const wanted = placePanel(bounds, spread, 410);

    for (const other of [{ left: 20, top: -400, right: 90, bottom: -370 }, { left: 900, top: 880, right: 1400, bottom: 900 }, { left: 1000, top: 10, right: 1430, bottom: 40 }]) {
      expect(placePanel(other, spread, 410)).toEqual(wanted);
    }
  });

  it("stands at the paragraph's top when it lies inside the band: from 48 to the window's height less 28 and less 160", () => {
    const viewport = { width: 1440, height: 900 };

    expect(placePanel(bounds, viewport, 48)).toMatchObject({ top: 48, maxHeight: 900 - 48 - 28 });
    expect(placePanel(bounds, viewport, 49.5)).toMatchObject({ top: 49.5, maxHeight: 900 - 49.5 - 28 });
    expect(placePanel(bounds, viewport, 400)).toMatchObject({ top: 400, maxHeight: 472 });
    expect(placePanel(bounds, viewport, 900 - 28 - 160)).toMatchObject({ top: 712, maxHeight: 160 });
  });

  it("stays under the masthead while the paragraph is scrolled above it", () => {
    const viewport = { width: 1440, height: 900 };

    expect(placePanel(bounds, viewport, 47)).toMatchObject({ top: 48, maxHeight: 900 - 48 - 28 });
    expect(placePanel(bounds, viewport, -1200)).toMatchObject({ top: 48, maxHeight: 824 });
  });

  it("stands no lower than leaves 160 px of it above the legend while the paragraph is further down — the floor of a window with nothing in it (re-aimed, P9-17: the default floor, the empty window's)", () => {
    const viewport = { width: 1440, height: 900 };

    expect(DOCK_MIN_VISIBLE_PX).toBe(160);
    expect(placePanel(bounds, viewport, 713)).toMatchObject({ top: 712, maxHeight: 160 });
    expect(placePanel(bounds, viewport, 5000)).toMatchObject({ top: 900 - 28 - 160, maxHeight: 160 });
    // A shorter window moves the limit with it.
    expect(placePanel(bounds, { width: 1280, height: 600 }, 5000)).toMatchObject({ top: 600 - 28 - 160, maxHeight: 160 });
    // The floor is the fourth parameter, and 160 when it is not given.
    expect(placePanel(bounds, viewport, 5000, DOCK_MIN_VISIBLE_PX)).toEqual(placePanel(bounds, viewport, 5000));
  });

  // P9-17 (ruling §1h.56; A P9-R2 F1): a window that holds a passage keeps its sticky header (140 px with a two-line
  // quote and the "Explain this?" control), its sticky controls row (101 px) and two lines of the answer between them.
  it("stands no lower than leaves 360 px of it above the legend when it holds a passage (the thread's floor)", () => {
    const viewport = { width: 1440, height: 900 };

    expect(DOCK_THREAD_FLOOR_PX).toBe(360);
    expect(placePanel(bounds, viewport, 713, DOCK_THREAD_FLOOR_PX)).toMatchObject({ top: 900 - 28 - 360, maxHeight: 360 });
    expect(placePanel(bounds, viewport, 5000, DOCK_THREAD_FLOOR_PX)).toEqual({ kind: "dock", right: 0, width: 360, top: 512, maxHeight: 360 });
    // A shorter window moves the limit with it.
    expect(placePanel(bounds, { width: 1280, height: 600 }, 5000, DOCK_THREAD_FLOOR_PX)).toMatchObject({ top: 600 - 28 - 360, maxHeight: 360 });
    expect(placePanel(bounds, { width: 1920, height: 1080 }, 5000, DOCK_THREAD_FLOOR_PX)).toMatchObject({ top: 1080 - 28 - 360, maxHeight: 360 });
  });

  it("holds its level inside the band whatever the floor: a paragraph above the thread's limit, or under the masthead, stands where it did", () => {
    const viewport = { width: 1440, height: 900 };

    for (const paragraphTop of [48, 49.5, 400, 512]) {
      expect(placePanel(bounds, viewport, paragraphTop, DOCK_THREAD_FLOOR_PX)).toEqual(placePanel(bounds, viewport, paragraphTop));
    }
    expect(placePanel(bounds, viewport, 400, DOCK_THREAD_FLOOR_PX)).toMatchObject({ top: 400, maxHeight: 472 });
    expect(placePanel(bounds, viewport, -1200, DOCK_THREAD_FLOOR_PX)).toMatchObject({ top: 48, maxHeight: 824 });
    // Between the two limits the floors differ: 700 stands at 700 for an empty window and at 512 for a thread.
    expect(placePanel(bounds, viewport, 700).top).toBe(700);
    expect(placePanel(bounds, viewport, 700, DOCK_THREAD_FLOOR_PX).top).toBe(512);
  });

  // P9-17 (ruling §1h.57; the owner: "如果选中段落在屏幕最下方，那么窗口的最底部就直接贴着整个屏幕的最底部。总之，始终让窗口存在于屏幕里"): the
  // window's top is level with the paragraph's first line whenever the whole window it needs fits below that line; else it is
  // lifted until its bottom edge stands on the screen's bottom (above the 28 px foot legend), never lower; and it is never above
  // the masthead's foot nor below the legend, at any window height. The fourth parameter is what the window needs.
  it("stands level with the paragraph when the whole window fits below it, else on the screen's bottom — never lower, never off the screen, at any window height", () => {
    let level = 0;
    let lifted = 0;
    for (const height of [600, 660, 720, 780, 840, 900, 960, 1020, 1080]) {
      for (const needed of [125, 160, DOCK_THREAD_FLOOR_PX, 520, 700, 2000]) {
        for (const paragraphTop of [-500, 0, 48, 100, 300, 500, 700, 900, 1200, 5000]) {
          const place = placePanel(bounds, { width: 1440, height }, paragraphTop, needed);
          const own = Math.min(needed, height - 28 - 48); // no window is taller than the room between the masthead and the legend
          const why = `${height} high, needs ${needed}, paragraph at ${paragraphTop}`;

          expect(place.top, why).toBeGreaterThanOrEqual(48);
          expect(place.top! + own, why).toBeLessThanOrEqual(height - 28);
          expect(place.top! + place.maxHeight, why).toBe(height - 28);
          if (paragraphTop >= 48) expect(place.top, why).toBeLessThanOrEqual(paragraphTop);
          if (paragraphTop >= 48 && paragraphTop + own <= height - 28) {
            level += 1;
            expect(place.top, why).toBe(paragraphTop);
          }
          if (paragraphTop >= 48 && paragraphTop + own > height - 28) {
            lifted += 1;
            expect(place.top! + own, why).toBe(height - 28);
          }
        }
      }
    }
    expect(level).toBeGreaterThan(100);
    expect(lifted).toBeGreaterThan(100);
  });

  it("is a dock's floor only: the card and the sheet do not read it", () => {
    for (const viewport of [{ width: 800, height: 900 }, { width: 390, height: 844 }]) {
      expect(placePanel(bounds, viewport, 5000, DOCK_THREAD_FLOOR_PX)).toEqual(placePanel(bounds, viewport, 5000));
    }
  });

  it("is the window's height less the masthead and the legend when the paragraph is above, and never negative", () => {
    expect(placePanel(bounds, { width: 1280, height: 800 }, 0).maxHeight).toBe(800 - 48 - 28);
    expect(placePanel(bounds, { width: 1280, height: 60 }, 0).maxHeight).toBe(0);
    // A window too short for the band: the top is the masthead's foot, whatever the paragraph does.
    expect(placePanel(bounds, { width: 1280, height: 200 }, 150)).toMatchObject({ top: 48, maxHeight: 200 - 48 - 28 });
    expect(placePanel(bounds, { width: 1280, height: 100 }, 5000)).toMatchObject({ top: 48, maxHeight: 24 });
  });

  it("has no paragraph to be level with only where the body reported none: the selection's own first line then", () => {
    const place = placePanel({ left: 120, top: 333, right: 520, bottom: 363 }, spread);

    expect(place).toMatchObject({ kind: "dock", top: 333, right: 0, width: 360, maxHeight: 900 - 333 - 28 });
  });

  it("leaves the card and the sheet alone: the paragraph enters neither", () => {
    for (const paragraphTop of [undefined, 0, 400, 5000]) {
      expect(placePanel(bounds, { width: 800, height: 900 }, paragraphTop)).toMatchObject({ kind: "card", ...placeCard(bounds, { width: 800, height: 900 }) });
      expect(placePanel(bounds, { width: 390, height: 844 }, paragraphTop)).toEqual(placePanel(bounds, { width: 390, height: 844 }));
    }
  });

  it("starts at 1024 exactly: at 1023 it is P3-02's card, at 1024 the dock", () => {
    expect(placePanel(bounds, { width: 1023, height: 800 }).kind).toBe("card");
    expect(placePanel(bounds, { width: 1024, height: 800 }).kind).toBe("dock");
  });

  it("is P3-02's place between 640 and 1024", () => {
    for (const width of [640, 800, 1023]) {
      const viewport = { width, height: 800 };

      expect(placePanel(bounds, viewport)).toMatchObject({ kind: "card", ...placeCard(bounds, viewport) });
    }
  });

  it("is a bottom sheet below 640: full width, on the bottom edge, at most 60% of the height", () => {
    const phone = { width: 390, height: 844 };
    const place = placePanel({ left: 20, top: 200, right: 360, bottom: 240 }, phone);

    expect(place.kind).toBe("sheet");
    expect(place).toMatchObject({ left: 0, width: 390, bottom: 0 });
    expect(place.top).toBeUndefined();
    expect(place.right).toBeUndefined();
    expect(place.maxHeight).toBeLessThanOrEqual(0.6 * 844);
    expect(place.maxHeight).toBeGreaterThan(0.55 * 844);
    expect(placePanel(bounds, { width: 639, height: 700 }).kind).toBe("sheet");
    expect(placePanel(bounds, { width: 640, height: 700 }).kind).toBe("card");
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
