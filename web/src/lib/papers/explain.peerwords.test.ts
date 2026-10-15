import { describe, expect, it } from "vitest";
import {
  buildExplainPrompt,
  buildExplainReplyPrompt,
  explainCacheKey,
  peerWordsSource,
  sanitizeExplainAnswer,
  sanitizeExplainReply,
} from "./explain";

// P10-08b (review 8.4; rulings §1h.78 (i), §1h.85): the pure half of explaining Peer's own words — which `source`
// marks them, how the two prompts carry them, what the memory's key adds, and that no table is read for them.
// Everything below is invented text.

const paper = { title: "Rafting under creep in a nickel alloy", abstract: "This paper studies rafting in a nickel superalloy under creep." };
const map = [
  { heading: "1 Introduction", opening: "Hot turbine blades creep slowly under load." },
  { heading: "3 Results", opening: null },
];
const located = { paragraph: "The rafting ratio rose from 0.2 to 0.7.", before: "Specimens were machined.", after: null };
const PASSAGE = "Tungsten slowed plate formation.";

describe("peerWordsSource", () => {
  it("is a literal summary or answer and nothing else", () => {
    expect(peerWordsSource("summary")).toBe("summary");
    expect(peerWordsSource("answer")).toBe("answer");
    for (const other of ["paper", "Summary", "", "elsewhere", undefined, null, 5, {}, ["summary"]]) expect(peerWordsSource(other)).toBeNull();
  });
});

describe("buildExplainPrompt for Peer's own words", () => {
  const prompt = (peerWords: "summary" | "answer") => buildExplainPrompt({ paper, map, passage: PASSAGE, peerWords });
  const user = (peerWords: "summary" | "answer") => JSON.parse(prompt(peerWords).userPrompt) as Record<string, unknown>;

  it("carries the passage as Peer's own words with the abstract and one line per section, and no paragraph of the body", () => {
    const body = user("summary");
    expect(body.passage).toBe(PASSAGE);
    expect(body.passageFrom).toContain("Peer's own words about this paper");
    expect(body.paper).toEqual({ title: paper.title, abstract: paper.abstract });
    expect(body.sections).toEqual([{ heading: "1 Introduction", opening: "Hot turbine blades creep slowly under load." }, { heading: "3 Results" }]);
    expect(body).not.toHaveProperty("context");
  });

  it("names a line of the summary and an answer apart, and says neither is the author's", () => {
    expect(user("summary").passageFrom).toMatch(/summary/);
    expect(user("answer").passageFrom).toMatch(/answer/);
    expect(user("answer").passageFrom).not.toMatch(/summary/);
    expect(user("summary").passageFrom).toMatch(/not the author's/);
  });

  it("keeps the first answer's two parts, the brevity rules and the verbatim-quote rule", () => {
    const { systemPrompt } = prompt("summary");
    const schema = user("summary").outputSchema as { meaning: string; here: { text: string; evidence: string } };
    expect(schema.meaning).toBeTruthy();
    expect(schema.here.text).toMatch(/why Peer's words say it/);
    expect(schema.here.evidence).toMatch(/opening/);
    expect(systemPrompt).toContain("Answer in the fewest words that are still exact.");
    expect(systemPrompt).toContain("Never quote the paper except with words copied character-for-character from the text supplied.");
    expect(systemPrompt).toContain("Peer's own words");
  });

  it("offers no table", () => {
    expect(user("summary").outputSchema).not.toHaveProperty("items");
    expect(prompt("summary").systemPrompt).not.toContain("`items`");
    expect(prompt("summary").userPrompt).not.toContain("items");
  });

  it("clips the passage to 1,200 characters and bounds the title, the abstract and the map as a paper passage does", () => {
    const long = buildExplainPrompt({
      paper: { title: "T".repeat(900), abstract: "word ".repeat(1000) },
      map: Array.from({ length: 120 }, (_, i) => ({ heading: `Heading ${i}`, opening: "o".repeat(500) })),
      passage: "word ".repeat(500),
      peerWords: "answer",
    });
    const body = JSON.parse(long.userPrompt) as { passage: string; paper: { title: string; abstract: string }; sections: Array<{ opening: string }> };
    expect(body.passage.length).toBeLessThanOrEqual(1200);
    expect(body.paper.title.length).toBeLessThanOrEqual(300);
    expect(body.paper.abstract.length).toBeLessThanOrEqual(2500);
    expect(body.sections).toHaveLength(80);
    expect(body.sections[0].opening.length).toBeLessThanOrEqual(160);
  });

  it("leaves a paper passage's prompt with its paragraph and its table, as it was", () => {
    const body = JSON.parse(buildExplainPrompt({ paper, map, located, passage: "the rafting ratio" }).userPrompt) as Record<string, unknown>;
    expect(body).toHaveProperty("context");
    expect(body).not.toHaveProperty("passageFrom");
    expect(body.outputSchema).toHaveProperty("items");
  });
});

describe("buildExplainReplyPrompt for Peer's own words", () => {
  const thread = [
    { role: "peer" as const, text: "Plates are flat layers. The summary says it for the headline result." },
    { role: "reader" as const, text: "What is a plate here?" },
  ];
  const prompt = (over: { search?: boolean; detail?: boolean } = {}) => buildExplainReplyPrompt({ paper, map, passage: PASSAGE, peerWords: "summary", thread, ...over });
  const user = (over: { search?: boolean; detail?: boolean } = {}) => JSON.parse(prompt(over).userPrompt) as Record<string, unknown>;

  it("carries the thread in order, the reader's last message, the passage as Peer's words and no paragraph", () => {
    const body = user();
    expect(body.thread).toEqual(thread);
    expect(body.lastReaderMessage).toBe("What is a plate here?");
    expect(body.passageFrom).toContain("Peer's own words about this paper");
    expect(body).not.toHaveProperty("context");
    expect(body.outputSchema).not.toHaveProperty("items");
  });

  it("keeps the reply's caps, the long form and the web-search rule as for a paper passage", () => {
    expect(JSON.stringify(user().rules)).toContain("560 characters");
    expect(JSON.stringify(user({ detail: true }).rules)).toContain("1,400 characters");
    expect(JSON.stringify(user().rules)).toContain("Do not search the web");
    expect(JSON.stringify(user({ search: true }).rules)).toContain("You may use web search");
  });

  it("applies the thread's message caps as a paper passage's reply does", () => {
    const long = [{ role: "peer" as const, text: "a ".repeat(600) }, { role: "reader" as const, text: "b ".repeat(300) }];
    const body = JSON.parse(buildExplainReplyPrompt({ paper, map, passage: PASSAGE, peerWords: "answer", thread: long }).userPrompt) as { thread: Array<{ text: string }> };
    expect(body.thread[0].text.length).toBeLessThanOrEqual(841);
    expect(body.thread[1].text.length).toBeLessThanOrEqual(400);
  });
});

describe("explainCacheKey carries where Peer's words are from", () => {
  const key = (peerWords?: "summary" | "answer") => explainCacheKey("doc", PASSAGE, [], false, false, peerWords);

  it("keeps the same words in the paper, in the Summary and in an answer as three entries", () => {
    expect(new Set([key(), key("summary"), key("answer")]).size).toBe(3);
  });

  it("is unchanged for a paper passage", () => {
    expect(key()).toBe(explainCacheKey("doc", PASSAGE, []));
    expect(key()).toBe(explainCacheKey("doc", PASSAGE, [], false, false, undefined));
  });

  it("still tells a thread, a search and the long form apart", () => {
    expect(explainCacheKey("doc", PASSAGE, ["a"], false, false, "summary")).not.toBe(key("summary"));
    expect(explainCacheKey("doc", PASSAGE, ["a"], true, false, "summary")).not.toBe(explainCacheKey("doc", PASSAGE, ["a"], false, false, "summary"));
    expect(explainCacheKey("doc", PASSAGE, ["a"], false, true, "summary")).not.toBe(explainCacheKey("doc", PASSAGE, ["a"], false, false, "summary"));
  });
});

describe("the sanitizers read no table for Peer's own words", () => {
  const row = { term: "plate", here: "a flat layer", read: "as a share of the length" };
  const answer = { meaning: "First sentence. Second sentence.", here: { text: "Third sentence. Fourth sentence." }, items: [row] };

  it("keeps the first answer's two sentences a part and drops the table, with items off", () => {
    expect(sanitizeExplainAnswer(answer, { items: false })).toEqual({ meaning: "First sentence. Second sentence.", here: { text: "Third sentence. Fourth sentence." } });
  });

  it("is as it was when items are not turned off", () => {
    const kept = sanitizeExplainAnswer(answer);
    expect(kept?.items).toEqual([row]);
    expect(kept?.meaning).toBe("First sentence.");
    expect(sanitizeExplainAnswer(answer, {})?.items).toEqual([row]);
  });

  it("drops a reply's table with items off and keeps its three sentences", () => {
    const reply = { reply: "One. Two. Three. Four.", items: [row] };
    expect(sanitizeExplainReply(reply, { items: false })).toEqual({ reply: "One. Two. Three." });
    expect(sanitizeExplainReply(reply)?.items).toEqual([row]);
  });
});
