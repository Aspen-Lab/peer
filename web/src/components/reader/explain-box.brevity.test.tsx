import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { EXPLAIN_CAPS, type ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import { MAX_EXPLAIN_ITEMS, MAX_EXPLAIN_TURNS, type ExplainTurn } from "@/store/explain-threads";
import type { Paper } from "@/types";
import { EXPLAIN } from "./copy";
import { SectionLinks } from "./evidence-quote";
import { ExplainCard, type ExplainStatus, type ThreadView } from "./explain-box";
import { firstAnswerMessage, moreReply, requestReply, sayMoreOf, threadAsSent } from "./explain-thread";

// P3-07 (ruling §1h.9 (3), (4); user decision §1a.14): the box answers short and
// exact. This file holds what the card draws for it — the term table (cells in the
// reading face, headers in the label face, from `copy.ts`), the one "Say more"
// button under Peer's latest reply (never under the first answer), and that
// nothing else in the card moved — and the pure rules the box and the page share:
// which reply "Say more" is for, what it sends (the reader's last message once,
// never a duplicate), what joins the thread, and what a request carries. No DOM
// in this project's Vitest: the markup is rendered with react-dom/server and the
// handlers are called on the element tree `ExplainCard` returns. What the box does
// over time is in `explain-box.brevity.flow.test.tsx`. Every text is invented.

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

const READER_ONE = "What do the two numbers on this page mean?";
const PROSE_ONE = "The authors report two values for the first sample.";
const READER_TWO = "And at a lower temperature?";
const PROSE_TWO = "The plates form more slowly, so the ratio stays small.";
const ITEMS = [
  { term: "grain ratio", here: "width over length of the sample", read: "0.4 means about two in five" },
  { term: "f_cell", here: "share of the cells covered by plates", read: "0.57 means most of it" },
];
const withTable: ExplainTurn = { role: "peer", text: PROSE_ONE, peer: true, items: ITEMS };
const plain: ExplainTurn = { role: "peer", text: PROSE_TWO, peer: true };
const twoPairs: ExplainTurn[] = [{ role: "reader", text: READER_ONE }, withTable, { role: "reader", text: READER_TWO }, plain];

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

const SAY_MORE = /<button[^>]*data-explain-say-more=""[^>]*>Say more<\/button>/g;
const sayMoreButtons = (html: string): string[] => html.match(SAY_MORE) ?? [];
const isDisabled = (html: string): boolean => /\sdisabled=""/.test(sayMoreButtons(html)[0] ?? "");

describe("the copy (P3-07)", () => {
  it("names the table's headers and the button exactly", () => {
    expect(EXPLAIN.tableTerm).toBe("Term");
    expect(EXPLAIN.tableHere).toBe("Here it means");
    expect(EXPLAIN.tableRead).toBe("How to read it");
    expect(EXPLAIN.sayMore).toBe("Say more");
  });

  it("holds no word the page never says to a reader: skip, don't read, ignore, not worth", () => {
    for (const text of [EXPLAIN.tableTerm, EXPLAIN.tableHere, EXPLAIN.tableRead, EXPLAIN.sayMore]) expect(text).not.toMatch(/\bskip\b|don't read|do not read|ignore|not worth/i);
  });

  it("keeps the browser's row cap the server's: four", () => {
    expect(MAX_EXPLAIN_ITEMS).toBe(EXPLAIN_CAPS.itemRows);
  });
});

describe("ExplainCard — the term table (P3-07)", () => {
  it("draws a reply's items as a table: three headed columns, a row for each, the term, what it means here, how to read it", () => {
    const html = card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, withTable] }) });
    const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";

    expect(html.match(/<table/g)).toHaveLength(1);
    expect(table).toContain("<thead>");
    const headers = [...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual([EXPLAIN.tableTerm, EXPLAIN.tableHere, EXPLAIN.tableRead]);
    const body = table.slice(table.indexOf("<tbody>"));
    expect(body.match(/<tr/g)).toHaveLength(2);
    for (const item of ITEMS) {
      expect(body).toContain(item.term);
      expect(body).toContain(item.here);
      expect(body).toContain(item.read);
    }
    // Each row reads term, then here, then read.
    expect(body.indexOf(ITEMS[0].term)).toBeLessThan(body.indexOf(ITEMS[0].here));
    expect(body.indexOf(ITEMS[0].here)).toBeLessThan(body.indexOf(ITEMS[0].read));
    expect(body.indexOf(ITEMS[0].read)).toBeLessThan(body.indexOf(ITEMS[1].term));
  });

  it("sets the headers in the label face and every cell in the reading face", () => {
    const html = card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, withTable] }) });
    const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";

    for (const header of [EXPLAIN.tableTerm, EXPLAIN.tableHere, EXPLAIN.tableRead]) {
      expect(table).toMatch(new RegExp(`<th[^>]*class="[^"]*\\bfont-mono\\b[^"]*"[^>]*>${header}</th>`));
    }
    const cells = [...table.matchAll(/<td([^>]*)>/g)].map((m) => m[1]);
    expect(cells).toHaveLength(6);
    for (const attrs of cells) {
      expect(attrs).toMatch(/\bfont-reading\b/);
      expect(attrs).not.toMatch(/\bitalic\b|font-mono/);
    }
  });

  it("scopes its headers to their columns, for a screen reader", () => {
    const table = /<table[\s\S]*?<\/table>/.exec(card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, withTable] }) }))?.[0] ?? "";

    expect(table.match(/<th[^>]*scope="col"/g)).toHaveLength(3);
  });

  it("puts the table under the reply's prose and above its quote, inside Peer's one turn", () => {
    const quoted: ExplainTurn = { role: "peer", text: PROSE_ONE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2, items: ITEMS };
    const html = card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, quoted] }) });
    const after = html.slice(html.indexOf(READER_ONE));

    expect(after.indexOf(PROSE_ONE)).toBeGreaterThan(-1);
    expect(after.indexOf("<table")).toBeGreaterThan(after.indexOf(PROSE_ONE));
    expect(after.indexOf(`>${SENTENCE}<span`)).toBeGreaterThan(after.indexOf("</table>"));
    expect(html.split(`>${EXPLAIN.peer}<`)).toHaveLength(2);
  });

  it("keeps the reply's prose in the reading face and not quote-styled, with a table under it", () => {
    const html = card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, withTable] }) });

    expect(html).toMatch(new RegExp(`<p class="font-reading(?![^"]*italic)[^"]*">${PROSE_ONE}</p>`));
  });

  it("draws no table for a reply without items, nor for an empty list, and no table on the first answer", () => {
    expect(card({ thread: view({ turns: twoPairs.slice(2) }) })).not.toContain("<table");
    expect(card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, { ...plain, items: [] }] }) })).not.toContain("<table");
    expect(card({ thread: undefined })).not.toContain("<table");
  });

  it("draws one table to each reply that has one", () => {
    const html = card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, withTable, { role: "reader", text: READER_TWO }, { ...withTable, text: PROSE_TWO }] }) });

    expect(html.match(/<table/g)).toHaveLength(2);
  });

  it("puts nothing of the table in the quote's styling: no italic, no section attribution on a cell", () => {
    const table = /<table[\s\S]*?<\/table>/.exec(card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, withTable] }) }))?.[0] ?? "";

    expect(table).not.toContain("— §");
    expect(table).not.toMatch(/italic/);
    expect(table).not.toContain("<a ");
  });
});

describe("ExplainCard — Say more (P3-07)", () => {
  const onSayMore = () => {};
  const turns: ExplainTurn[] = [{ role: "reader", text: READER_ONE }, plain];

  it("is one label-face button under Peer's latest reply", () => {
    const html = card({ thread: view({ turns, onSayMore }) });

    expect(sayMoreButtons(html)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*data-explain-say-more=""[^>]*class="[^"]*\bfont-mono\b[^"]*"/);
    expect(html.indexOf(`>${EXPLAIN.sayMore}<`)).toBeGreaterThan(html.indexOf(PROSE_TWO));
    expect(html.indexOf(`>${EXPLAIN.sayMore}<`)).toBeLessThan(html.indexOf("data-explain-controls"));
    expect(html).toMatch(/<button type="button"[^>]*data-explain-say-more/);
  });

  it("is under the latest reply only, whatever came before it: one button for two pairs, after the second reply", () => {
    const html = card({ thread: view({ turns: twoPairs, onSayMore }) });

    expect(sayMoreButtons(html)).toHaveLength(1);
    expect(html.indexOf(`>${EXPLAIN.sayMore}<`)).toBeGreaterThan(html.indexOf(PROSE_TWO));
  });

  it("is never under the first answer: no turn yet, no button", () => {
    expect(sayMoreButtons(card({ thread: view({ turns: [], onSayMore }) }))).toHaveLength(0);
  });

  it("is not there when the last turn is the reader's, or when the thread holds no reader message", () => {
    expect(sayMoreButtons(card({ thread: view({ turns: [...turns, { role: "reader", text: READER_TWO }], onSayMore }) }))).toHaveLength(0);
    expect(sayMoreButtons(card({ thread: view({ turns: [plain], onSayMore }) }))).toHaveLength(0);
  });

  it("is not there under a reply that is already the long form: it would ask the same question again", () => {
    expect(sayMoreButtons(card({ thread: view({ turns: [turns[0], { ...plain, detail: true }], onSayMore }) }))).toHaveLength(0);
    // …and is back under the next short reply.
    expect(sayMoreButtons(card({ thread: view({ turns: [turns[0], { ...plain, detail: true }, { role: "reader", text: READER_TWO }, plain], onSayMore }) }))).toHaveLength(1);
  });

  it("is not there without the handler: a box that cannot send has no such button, and a Tier 0 box has no thread", () => {
    expect(sayMoreButtons(card({ thread: view({ turns }) }))).toHaveLength(0);
    expect(sayMoreButtons(card({ thread: view({ turns, onSayMore }), canAsk: false, status: { kind: "none" } }))).toHaveLength(0);
    expect(sayMoreButtons(card({ thread: view({ turns, onSayMore }), status: { kind: "loading" } }))).toHaveLength(0);
  });

  it("is enabled when idle", () => {
    const html = card({ thread: view({ turns, onSayMore }) });

    expect(sayMoreButtons(html)).toHaveLength(1);
    expect(isDisabled(html)).toBe(false);
  });

  it("is disabled while a request is in flight", () => {
    const html = card({ thread: view({ turns, onSayMore, pending: true }) });

    expect(sayMoreButtons(html)).toHaveLength(1);
    expect(isDisabled(html)).toBe(true);
  });

  it("is disabled at the full thread: eight reader messages", () => {
    const eight: ExplainTurn[] = Array.from({ length: MAX_EXPLAIN_TURNS }, (_, i) => [{ role: "reader", text: `question ${i}` }, { role: "peer", text: `reply ${i}`, peer: true }] as ExplainTurn[]).flat();
    const html = card({ thread: view({ turns: eight, onSayMore }) });

    expect(sayMoreButtons(html)).toHaveLength(1);
    expect(isDisabled(html)).toBe(true);
    // Seven are not full.
    const seven = card({ thread: view({ turns: eight.slice(0, 14), onSayMore }) });
    expect(sayMoreButtons(seven)).toHaveLength(1);
    expect(isDisabled(seven)).toBe(false);
  });

  it("is disabled when the day's explanations are used up", () => {
    const html = card({ thread: view({ turns, onSayMore, quota: "exhausted" }) });

    expect(sayMoreButtons(html)).toHaveLength(1);
    expect(isDisabled(html)).toBe(true);
  });

  it("calls the handler when pressed", () => {
    const calls: string[] = [];
    const tree = ExplainCard({ passage: PASSAGE, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer }, onClose: () => {}, thread: view({ turns, onSayMore: () => calls.push("more") }) });
    const found = findButton(tree);

    expect(found).toBeDefined();
    (found!.onClick as () => void)();
    expect(calls).toEqual(["more"]);
  });

  it("changes nothing else: the same thread with the button taken out is the thread without it", () => {
    const without = card({ thread: view({ turns: twoPairs }) });
    const withButton = card({ thread: view({ turns: twoPairs, onSayMore }) });

    expect(withButton.replace(SAY_MORE, "")).toBe(without);
  });

  it("changes nothing about a thread with no reply table and no long form: the markup is the old markup", () => {
    const html = card({ thread: view({ turns: [{ role: "reader", text: READER_ONE }, plain] }) });

    expect(html).not.toContain("<table");
    expect(html).not.toContain("data-explain-say-more");
    expect(html).toContain(`>${EXPLAIN.send}<`);
    expect(html).toContain("<textarea");
  });
});

type Props = Record<string, unknown>;
function findButton(node: unknown): Props | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as { props: Props };
  if ("data-explain-say-more" in element.props) return element.props;
  return findButton(element.props.children);
}

describe("sayMoreOf (P3-07)", () => {
  it("is the reader's last message and the thread before it — the reply to be lengthened is left out, and no reader message is added", () => {
    const more = sayMoreOf(twoPairs);

    expect(more?.message).toBe(READER_TWO);
    expect(more?.before).toEqual(twoPairs.slice(0, 2));
    expect(more?.before.filter((turn) => turn.role === "reader")).toHaveLength(1);
    // Sent with the message last, the thread has the readers it had.
    expect(more!.before.filter((turn) => turn.role === "reader").length + 1).toBe(twoPairs.filter((turn) => turn.role === "reader").length);
  });

  it("works for the first pair: nothing before the reader's message", () => {
    expect(sayMoreOf([{ role: "reader", text: READER_ONE }, plain])).toEqual({ before: [], message: READER_ONE });
  });

  it("is null for no turns, a last turn that is the reader's, a thread with no reader message, and a reply that is already long", () => {
    expect(sayMoreOf([])).toBeNull();
    expect(sayMoreOf([{ role: "reader", text: READER_ONE }])).toBeNull();
    expect(sayMoreOf([plain])).toBeNull();
    expect(sayMoreOf([{ role: "reader", text: READER_ONE }, { ...plain, detail: true }])).toBeNull();
  });

  it("when a long reply was kept after a short one, goes on from the reader's message before both", () => {
    const kept: ExplainTurn[] = [{ role: "reader", text: READER_ONE }, plain, { ...plain, detail: true }, { role: "reader", text: READER_TWO }, plain];

    expect(sayMoreOf(kept)).toEqual({ before: kept.slice(0, 3), message: READER_TWO });
  });
});

describe("moreReply (P3-07)", () => {
  it("is Peer's turn alone: no reader message joins the thread", () => {
    const result: ExplainTurn = { role: "peer", text: PROSE_TWO, peer: true, detail: true };

    expect(moreReply(result)).toEqual([result]);
  });

  it("leaves out the note that the search was not available: Say more never asks to search", () => {
    expect(moreReply({ role: "peer", text: PROSE_TWO, peer: true, searchUnavailable: true })).toEqual([{ role: "peer", text: PROSE_TWO, peer: true }]);
  });
});

describe("threadAsSent (P3-07)", () => {
  const first = firstAnswerMessage(answer);

  it("is the thread as it was when no reply follows a reply", () => {
    const thread = [first, ...twoPairs];

    expect(threadAsSent(thread)).toEqual(thread.map(({ role, text }) => ({ role, text })));
  });

  it("keeps one Peer message for each reader message: the long reply stands for the short one before it", () => {
    const sent = threadAsSent([first, { role: "reader", text: READER_ONE }, plain, { ...plain, text: "A longer reply to it, in full.", detail: true }, { role: "reader", text: READER_TWO }]);

    expect(sent).toEqual([
      { role: "peer", text: first.text },
      { role: "reader", text: READER_ONE },
      { role: "peer", text: "A longer reply to it, in full." },
      { role: "reader", text: READER_TWO },
    ]);
  });

  it("holds a full thread of eight readers, each with a short and a long reply, to the server's seventeen messages", () => {
    const turns: ExplainTurn[] = Array.from({ length: 7 }, (_, i) => [{ role: "reader", text: `question ${i}` }, { role: "peer", text: `short ${i}`, peer: true }, { role: "peer", text: `long ${i}`, peer: true, detail: true }] as ExplainTurn[]).flat();
    const sent = threadAsSent([first, ...turns]);

    expect(sent).toHaveLength(1 + 7 * 2);
    expect(sent.filter((message) => message.role === "reader")).toHaveLength(7);
    expect(sent.some((message) => message.text.startsWith("short"))).toBe(false);
    expect(sent.length + 1).toBeLessThanOrEqual(17);
  });
});

describe("requestReply with the long form (P3-07)", () => {
  const paper: Paper = {
    id: "upload:0123456789abcdef", title: "A paper", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const first = firstAnswerMessage(answer);
  const args = { paper, selection: { sectionIndex: 1, paragraphIndex: 1, passage: PASSAGE }, sectionId: "s2", thread: [first], message: READER_ONE };
  const replied = { turn: { role: "peer", text: PROSE_ONE, peer: true, searched: false, detail: true, items: ITEMS }, cached: false };

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const posted = (fetchMock: ReturnType<typeof stubFetch>) => JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
  afterEach(() => vi.unstubAllGlobals());

  it("posts `detail: true` when asked for the long form, with the reader's message last and no duplicate of it", async () => {
    const fetchMock = stubFetch(replied);
    await requestReply({ ...args, detail: true });
    const body = posted(fetchMock);

    expect(body.detail).toBe(true);
    expect(body.thread).toEqual([{ role: "peer", text: first.text }, { role: "reader", text: READER_ONE }]);
  });

  it("posts no `detail` key at all otherwise: the request is what it was", async () => {
    for (const detail of [undefined, false]) {
      const fetchMock = stubFetch(replied);
      await requestReply({ ...args, ...(detail === undefined ? {} : { detail }) });

      expect(posted(fetchMock)).not.toHaveProperty("detail");
    }
  });

  it("sends the thread with one Peer message for each reader message, whatever the box holds", async () => {
    const fetchMock = stubFetch(replied);
    await requestReply({ ...args, thread: [first, { role: "reader", text: READER_ONE }, plain, { ...plain, text: "A longer reply.", detail: true }], message: READER_TWO });

    expect(posted(fetchMock).thread).toEqual([
      { role: "peer", text: first.text },
      { role: "reader", text: READER_ONE },
      { role: "peer", text: "A longer reply." },
      { role: "reader", text: READER_TWO },
    ]);
  });

  it("returns the turn with its table and its long-form mark", async () => {
    stubFetch(replied);

    expect(await requestReply({ ...args, detail: true })).toEqual({ role: "peer", text: PROSE_ONE, peer: true, detail: true, items: ITEMS });
  });

  it("keeps only the rows that are three cells of words, at most four, and drops the key for none", async () => {
    stubFetch({ turn: { role: "peer", text: PROSE_ONE, peer: true, items: [...ITEMS, { term: "x", here: "y" }, { term: "", here: "y", read: "z" }, "row", null, { term: "a", here: "b", read: "c" }, { term: "d", here: "e", read: "f" }, { term: "g", here: "h", read: "i" }] } });
    const kept = await requestReply(args);

    expect(typeof kept === "string" ? [] : kept.items?.map((item) => item.term)).toEqual(["grain ratio", "f_cell", "a", "d"]);
    stubFetch({ turn: { role: "peer", text: PROSE_ONE, peer: true, items: [{ term: "x" }, 4] } });
    expect(await requestReply(args)).toEqual({ role: "peer", text: PROSE_ONE, peer: true });
    stubFetch({ turn: { role: "peer", text: PROSE_ONE, peer: true, items: "table" } });
    expect(await requestReply(args)).toEqual({ role: "peer", text: PROSE_ONE, peer: true });
  });

  it("keeps the long-form mark only when it is a literal true", async () => {
    stubFetch({ turn: { role: "peer", text: PROSE_ONE, peer: true, detail: "yes" } });
    expect(await requestReply(args)).toEqual({ role: "peer", text: PROSE_ONE, peer: true });
  });
});
