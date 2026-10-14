import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { ExplainTurn } from "@/store/explain-threads";
import type { Paper } from "@/types";
import { EXPLAIN } from "./copy";
import { SectionLinks } from "./evidence-quote";
import { ExplainCard, type ExplainStatus, type ThreadView } from "./explain-box";
import * as thread from "./explain-thread";
import { replyPair, requestReply } from "./explain-thread";

// P10-08 (the owner's review of 2026-10-13, item 8.6: "把search the web删掉，目前的ai解释功能挺厉害的，够用了"; rule 6): the explain box has no web-search
// toggle, no tooltip, no "searched" mark and no "not available" note, anywhere; a reply request never sends `search`. The server's `search` option and the
// code behind it stay (ruling §1h.76 (e): kept for later); a request without it is a plain turn, as it always was. (Replaces P3-02c's
// `explain-box.search.test.tsx` and `explain-box.search.flow.test.tsx`, which pinned the toggle: deleted with the feature.) Every text is invented.

const PASSAGE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const answer: ExplainAnswer = {
  meaning: "A rafting ratio says how much of a sample has turned into plates.",
  here: { text: "The authors use it to compare alloys on one scale.", evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 },
};
const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", SENTENCE] },
  ],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;
const turns: ExplainTurn[] = [{ role: "reader", text: "Why does a bigger ratio matter?" }, { role: "peer", text: "It changes how the metal carries load.", peer: true }];
const view = (over: Partial<ThreadView> = {}): ThreadView => ({ turns, draft: "", pending: false, failed: false, onDraft: () => {}, onSend: () => {}, ...over });

const card = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: reading.body.map((s) => s.heading) },
      createElement(ExplainCard, { passage: PASSAGE, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer } as ExplainStatus, onClose: () => {}, thread: view(), dock: true, ...over }),
    ),
  );

describe("the explain box has no web search (P10-08, review 8.6)", () => {
  it("the copy names none: no toggle, warning, mark or note", () => {
    expect(Object.keys(EXPLAIN).filter((key) => /search/i.test(key))).toEqual([]);
    for (const text of Object.values(EXPLAIN)) if (typeof text === "string") expect(text).not.toMatch(/search/i);
  });

  it("the window's control row is the input and Send: no toggle, no tooltip, no mark, in the dock, the card and the sheet", () => {
    for (const place of [{ dock: true }, { dock: false }, { dock: false, sheet: true }]) {
      const html = card(place);

      expect(html).not.toMatch(/search/i);
      expect(html).not.toContain("role=\"tooltip\"");
      expect(html).not.toContain("aria-pressed");
      expect(html.split("<button").length - 1, JSON.stringify(place)).toBe(2 /* Close, Send */);
      expect(html).toContain("<textarea");
      expect(html).toContain("data-explain-send");
    }
  });

  it("a turn kept in this browser with an old search mark is shown plainly: no mark beside You, no note under Peer's reply", () => {
    const old: ExplainTurn[] = [
      { role: "reader", text: "Does anyone else measure it this way?", searched: true },
      { role: "peer", text: "Another group does.", peer: true, searched: true, searchUnavailable: true },
    ];
    const html = card({ thread: view({ turns: old }) });

    expect(html).toContain("Does anyone else measure it this way?");
    expect(html).toContain("Another group does.");
    expect(html).not.toMatch(/search/i);
  });

  it("the thread module has no toggle: no `toggleStep`, no `pressKind`", () => {
    expect(Object.keys(thread).filter((key) => /toggle|pressKind|SearchToggle/i.test(key))).toEqual([]);
  });

  it("the pair that joins the thread is the reader's message and Peer's reply, as the server sent it", () => {
    const reply: ExplainTurn = { role: "peer", text: "A reply.", peer: true };

    expect(replyPair("A question?", reply)).toEqual([{ role: "reader", text: "A question?" }, reply]);
  });
});

describe("a reply request never sends `search` (P10-08, review 8.6)", () => {
  const paper: Paper = {
    id: "upload:0123456789abcdef", title: "A paper", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const args = { paper, selection: { sectionIndex: 1, paragraphIndex: 1, passage: PASSAGE }, sectionId: "s2", thread: [thread.firstAnswerMessage(answer)], message: "Why does it matter?" };
  const replied = { turn: { role: "peer", text: "It changes how the metal carries load.", peer: true, searched: true }, cached: false };
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const posted = (fetchMock: ReturnType<typeof stubFetch>) => JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;

  it("posts no `search` key, even to a caller that still passes one", async () => {
    const fetchMock = stubFetch(replied);
    await requestReply({ ...args, ...({ search: true } as object) });

    expect(posted(fetchMock)).not.toHaveProperty("search");
    expect(posted(fetchMock).thread).toEqual([{ role: "peer", text: thread.firstAnswerMessage(answer).text }, { role: "reader", text: "Why does it matter?" }]);
  });

  it("keeps no `searched` mark from a reply the server says searched: the box shows no trace of one", async () => {
    stubFetch(replied);

    expect(await requestReply(args)).toEqual({ role: "peer", text: "It changes how the metal carries load.", peer: true });
  });
});

describe("nowhere in the product's source (P10-08, review 8.6; B6)", () => {
  const SRC = resolve(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk(SRC);

  // The words are assembled here so that this file is not its own match.
  const gone = [["Search", " the web"], ["EXPLAIN.", "search"], ["data-explain-", "search"], ["empty", "DockStands"]].map((parts) => parts.join(""));

  it("no file names the toggle's label, its copy keys, its attribute or the empty window's rule", () => {
    const hits: string[] = [];
    for (const path of files) {
      if (path.endsWith("explain-box.nosearch.test.tsx")) continue;
      const text = readFileSync(path, "utf8");
      for (const word of gone) if (text.includes(word)) hits.push(`${path.slice(SRC.length + 1)}: ${word}`);
    }
    expect(hits).toEqual([]);
  });
});
