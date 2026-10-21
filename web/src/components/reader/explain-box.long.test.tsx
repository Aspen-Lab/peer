import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPLAIN_CAPS, buildExplainPrompt, clipPassage, explainMapLines, locatePassage } from "@/lib/papers/explain";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { Paper } from "@/types";
import * as box from "./explain-box";
import { ExplainCard, previewOf, requestExplanation } from "./explain-box";
import { MAX_SELECTION_CHARS } from "./paper-body";

// P11-47 (round 3, Theme B walk, weighed (f); ruling §1h.148 rule 2, option (a)): Explain this is offered for a selection over the route's passage cap (1,200
// characters) and explains its first 1,200: the request carries the passage clipped at the cap on a word boundary (`explainPassage`, the browser's copy of the
// route's own `clipPassage`: the two are pinned equal here), and the card's quote shows the passage's opening words with an ellipsis, as it does for any passage
// over 80 characters. The route's cap is unchanged. The paragraph still rides in the prompt as the passage's context, so the first 1,200 characters of a 3,000-
// character paragraph are explained with the whole paragraph (to its own 2,000-character cap) around them. Up to 1,200 characters nothing changes (rule 3).
// Every text is invented.

// `explainPassage` and `EXPLAIN_PASSAGE_CHARS` are the fix's own exports: read through the namespace, this file compiles on the base, where its tests are red because they are not there.
const explainPassage = (passage: string): string => (box as unknown as { explainPassage: (passage: string) => string }).explainPassage(passage);
const passageChars = (): unknown => (box as unknown as { EXPLAIN_PASSAGE_CHARS?: number }).EXPLAIN_PASSAGE_CHARS;

function sentences(n: number, seed = 0): string {
  let out = "";
  for (let k = seed; out.length < n; k += 1) out += `${out ? " " : ""}In plot ${k} the crew counted the invented tide pools twice.`;
  return out;
}

describe("explainPassage — the passage as the request carries it", () => {
  it("is the cap the route has, the selection's old cap, and nothing else: 1,200", () => {
    expect(passageChars()).toBe(1200);
    expect(EXPLAIN_CAPS.passageChars).toBe(1200);
    expect(MAX_SELECTION_CHARS).toBe(1200);
  });

  it("leaves a passage within the cap as it is: trimmed, white space collapsed, nothing cut (rule 3)", () => {
    expect(explainPassage("  The   rafting\n\tratio  rose.  ")).toBe("The rafting ratio rose.");
    for (const n of [1, 80, 800, 1199, 1200]) {
      const passage = "x".repeat(n);
      expect(explainPassage(passage)).toBe(passage);
    }
    const nearly = sentences(1150);
    expect(nearly.length).toBeLessThanOrEqual(1200);
    expect(explainPassage(nearly)).toBe(nearly);
  });

  it("cuts a longer one at a word boundary, within 1,200 characters, and keeps the start", () => {
    for (const n of [1201, 1500, 3000, 20000]) {
      const passage = sentences(n);
      const clipped = explainPassage(passage);
      expect(clipped.length, String(n)).toBeLessThanOrEqual(1200);
      expect(clipped.length, String(n)).toBeGreaterThan(1100);
      expect(passage.startsWith(clipped)).toBe(true);
      // The next character in the source is a space: no word was cut in half.
      expect(passage[clipped.length]).toBe(" ");
    }
  });

  it("hard-cuts an unbroken run at 1,200", () => {
    expect(explainPassage("x".repeat(3000))).toHaveLength(1200);
  });

  it("is exactly what the route makes of it, for every kind of passage — so the two cannot drift", () => {
    const cases = [
      "",
      " \n\t ",
      "x".repeat(3000),
      sentences(1200),
      sentences(1201),
      sentences(2999),
      `${"w ".repeat(599)}${"y".repeat(5)} tail words here`,
      `${"word ".repeat(240)}\n\n\n${"more   ".repeat(80)}`,
      `${"a".repeat(1199)} b`,
      `${"a".repeat(1200)} b`,
      `${"a".repeat(1201)} b`,
    ];
    for (const passage of cases) expect(explainPassage(passage), passage.slice(0, 20)).toBe(clipPassage(passage));
  });
});

describe("requestExplanation — a long selection (rule 2 (a))", () => {
  const paper: Paper = {
    id: "upload:0123456789abcdef", title: "A paper", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const answer = { meaning: "A share.", here: { text: "It compares.", peer: true } };
  function stubFetch() {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answer, cached: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const bodyOf = (fetchMock: ReturnType<typeof stubFetch>, call = 0) => JSON.parse(String((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;

  afterEach(() => vi.unstubAllGlobals());

  it("posts a 3,000-character selection's first 1,200 characters, cut at a word, with the section and paragraph as for any selection", async () => {
    const fetchMock = stubFetch();
    const passage = sentences(3000);
    expect(await requestExplanation({ paper, selection: { sectionIndex: 1, paragraphIndex: 2, passage }, sectionId: "s2" })).toEqual(answer);
    const body = bodyOf(fetchMock);
    expect(body).toEqual({ paper, passage: clipPassage(passage), sectionId: "s2", paragraphIndex: 2, thread: [] });
    expect((body.passage as string).length).toBeLessThanOrEqual(1200);
    expect(passage.startsWith(body.passage as string)).toBe(true);
  });

  it("posts a Summary block's or an answer's long selection clipped too, with its source", async () => {
    const fetchMock = stubFetch();
    const passage = sentences(2000);
    await requestExplanation({ paper, selection: { sectionIndex: -1, paragraphIndex: -1, passage, source: "summary", paragraphId: "summary-method" }, sectionId: "" });
    await requestExplanation({ paper, selection: { sectionIndex: -1, paragraphIndex: -1, passage, source: "answer", paragraphId: "answers-block" }, sectionId: "" });
    expect(bodyOf(fetchMock, 0)).toMatchObject({ passage: clipPassage(passage), source: "summary", sectionId: "" });
    expect(bodyOf(fetchMock, 1)).toMatchObject({ passage: clipPassage(passage), source: "answer" });
  });

  it("posts a selection of up to 1,200 characters byte for byte as it did (rule 3)", async () => {
    const fetchMock = stubFetch();
    const passage = "x".repeat(1200);
    const short = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
    await requestExplanation({ paper, selection: { sectionIndex: 1, paragraphIndex: 1, passage }, sectionId: "s2" });
    await requestExplanation({ paper, selection: { sectionIndex: 1, paragraphIndex: 1, passage: short }, sectionId: "s2" });
    expect(bodyOf(fetchMock, 0)).toEqual({ paper, passage, sectionId: "s2", paragraphIndex: 1, thread: [] });
    expect(bodyOf(fetchMock, 1)).toEqual({ paper, passage: short, sectionId: "s2", paragraphIndex: 1, thread: [] });
  });
});

describe("the card's quote for a long passage", () => {
  const render = (passage: string) =>
    renderToStaticMarkup(createElement(ExplainCard, { passage, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "loading" }, onClose: () => {} }));

  it("shows the passage's opening words and an ellipsis, not the 3,000 characters", () => {
    const passage = sentences(3000);
    const quote = previewOf(passage);
    expect(quote.endsWith("…")).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(81);
    const html = render(passage);
    expect(html).toContain(quote);
    expect(html).not.toContain(passage.slice(0, 200));
  });

  it("shows the same opening words for the clipped passage the request carries: the clip changes nothing the reader sees of the quote", () => {
    for (const n of [1201, 3000]) {
      const passage = sentences(n);
      expect(previewOf(explainPassage(passage))).toBe(previewOf(passage));
    }
  });
});

describe("what the route builds for a long selection: the clipped passage, the paragraph around it", () => {
  const paragraph = (seed: number, n: number) => sentences(n, seed);
  const TRIPLE = paragraph(0, 3000);
  const MID = paragraph(100, 1500);
  const doc: ExtractedDocument = {
    source: "pdf",
    pageCount: 3,
    figureCaptions: [],
    sections: [
      { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: [paragraph(200, 900), MID].join("\n\n") },
      { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: [paragraph(300, 800), TRIPLE, paragraph(400, 700)].join("\n\n") },
    ],
  };
  // The route clips the request's passage with `clipPassage` before it locates and prompts (`explain/route.ts`); `explainPassage` above is pinned equal to it.
  const prompt = (selected: string, hint: { sectionId: string; paragraphIndex: number }) => {
    const passage = clipPassage(selected);
    const located = locatePassage(doc, passage, hint, { blocks: true });
    expect(located, "the clipped passage is found in its paragraph").not.toBeNull();
    const built = buildExplainPrompt({ paper: { title: "A paper", abstract: "An abstract." }, map: explainMapLines(doc), located: located!, passage });
    return { located: located!, user: JSON.parse(built.userPrompt) as { passage: string; context: { paragraph: string; before?: string; after?: string }; rules: string[]; outputSchema: unknown }, system: built.systemPrompt };
  };
  const shortOne = () => prompt("In plot 300 the crew counted the invented tide pools twice.", { sectionId: "s2", paragraphIndex: 1 });

  it("a triple click on a 3,000-character paragraph: the passage is its first 1,200, the context is the paragraph to its 2,000-character cap, which holds the passage whole", () => {
    const { located, user } = prompt(TRIPLE, { sectionId: "s2", paragraphIndex: 1 });
    expect(located).toMatchObject({ sectionId: "s2", paragraphIndex: 1 });
    expect(user.passage.length).toBeLessThanOrEqual(1200);
    expect(TRIPLE.startsWith(user.passage)).toBe(true);
    expect(user.context.paragraph.length).toBeLessThanOrEqual(EXPLAIN_CAPS.paragraphChars);
    expect(user.context.paragraph.length).toBeGreaterThan(1900);
    expect(user.context.paragraph.startsWith(user.passage)).toBe(true);
    expect(user.context.before).toBeDefined();
    expect(user.context.after).toBeDefined();
  });

  it("a triple click on a 1,500-character paragraph: the passage is its first 1,200 and the context is the whole paragraph, so the 300 left out are read as context", () => {
    const { user } = prompt(MID, { sectionId: "s1", paragraphIndex: 1 });
    expect(user.passage.length).toBeLessThanOrEqual(1200);
    expect(user.context.paragraph).toBe(MID);
  });

  it("the instructions are the ones a short passage gets: same parts, same schema, same rules, same system prompt", () => {
    const short = shortOne();
    for (const [selected, hint] of [[TRIPLE, { sectionId: "s2", paragraphIndex: 1 }], [MID, { sectionId: "s1", paragraphIndex: 1 }]] as const) {
      const long = prompt(selected, hint);
      expect(Object.keys(long.user)).toEqual(Object.keys(short.user));
      expect(long.user.rules).toEqual(short.user.rules);
      expect(long.user.outputSchema).toEqual(short.user.outputSchema);
      expect(long.system).toBe(short.system);
    }
  });
});
