import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache } from "@/lib/papers/explain";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import { clipPassage } from "@/lib/papers/explain";
import { blockMarker, inlineMath } from "@/lib/text/math";

// Constructed actual-handler tests. Ordinary test-runtime auth is untouched;
// data/provider stubs prove no UI, deployed-auth or live-provider behavior.
const mocks = vi.hoisted(() => ({ ownedUpload: vi.fn(), resolveProvider: vi.fn(), getFullText: vi.fn() }));
vi.mock("@/lib/llm/providers/registry", async (original) => ({ ...(await original<typeof import("@/lib/llm/providers/registry")>()), resolveProvider: mocks.resolveProvider }));
vi.mock("@/lib/papers/upload-access", async (original) => ({ ...(await original<typeof import("@/lib/papers/upload-access")>()), ownedUpload: mocks.ownedUpload }));
vi.mock("@/lib/papers/full-text", () => ({ getFullText: mocks.getFullText }));
import { POST } from "./route";

const first = "Amber coils store heat during every measured cycle.";
const second = "Copper fins release heat slowly after the cycle ends.";
const paper = { id: "arxiv:2610.00011", title: "Invented coils", authors: [], source: "arxiv", isSaved: false };
const doc: ExtractedDocument = { source: "ar5iv", figureCaptions: [], sections: [{ id: "s1", heading: "1 Setup", canonical: "body", text: `${first}\n\n${second}\n\n${first}\n\n${second}` }] };
const seg = (paragraphIndex: number, text: string, sectionId = "s1") => ({ sectionId, paragraphIndex, start: 0, end: text.length });
const valid = { segments: [seg(0, first), seg(1, second)] };
const generate = vi.fn<(args: { userPrompt: string; systemPrompt: string }) => Promise<string>>(async () => JSON.stringify({ meaning: "Heat accumulates.", here: { text: "It describes the cycle.", evidence: "An invented sentence that is absent from the paper entirely." }, reply: "The cycle transfers heat.", evidence: "An invented sentence that is absent from the paper entirely." }));
const modes = [
  { label: "first", body: {} },
  { label: "followup", body: { thread: [{ role: "peer", text: "Heat accumulates." }, { role: "reader", text: "Why?" }] } },
  { label: "Say more", body: { thread: [{ role: "peer", text: "Heat accumulates." }, { role: "reader", text: "Why?" }], detail: true } },
];
function call(over: Record<string, unknown> = {}) {
  return POST(new NextRequest(`http://localhost/api/papers/${encodeURIComponent(paper.id)}/explain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paper, passage: `${first} ${second}`, range: valid, ...over }) }), { params: Promise.resolve({ id: encodeURIComponent(paper.id) }) });
}
beforeEach(() => {
  resetCounterStoreForTests(); explainCache.clear(); vi.clearAllMocks();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue({ generateJsonText: generate });
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
  vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each(modes)("P12-11 $label validates before cache and generation", ({ body }) => {
  it("accepts canonical range, neutral bounded context and removes unsupported evidence", async () => {
    const response = await call(body);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.cached).toBe(false);
    expect(body.thread ? json.turn : json.answer.here).toMatchObject({ peer: true });
    expect(JSON.stringify(json)).not.toContain("An invented sentence");
    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = JSON.parse(generate.mock.calls[0][0].userPrompt);
    expect(prompt.passage).toBe(`${first} ${second}`);
    expect(prompt.context).toEqual({ range: true, paragraph: first, after: second });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects malformed, reverse, skipped, duplicate, forged and mixed source even when legacy text exists", async () => {
    const requests = [
      { range: null }, { range: {} }, { range: { segments: [] } },
      { range: { segments: [seg(1, second), seg(0, first)] }, passage: `${second} ${first}` },
      { range: { segments: [seg(0, first), seg(3, second)] } },
      { range: { segments: [seg(0, first), seg(0, first)] }, passage: `${first} ${first}` },
      { range: { segments: [{ ...seg(0, first), end: first.length + 1 }] }, passage: first },
      { range: { segments: [seg(99, first)] }, passage: first },
      { range: { segments: [seg(0, first, "nope")] }, passage: first },
      { range: { segments: [{ ...seg(0, first), quote: first }] }, passage: first },
      { range: valid, passage: `${first} Submit ${second}` },
      ...["summary", "answer", "mixed", "unknown", null, 1, ["paper", "summary"]].map((source) => ({ source })),
    ];
    for (const over of requests) {
      const response = await call({ ...body, ...over });
      expect(response.status, JSON.stringify(over)).toBe(422);
      expect(await response.json()).toEqual({ error: "not_in_paper" });
    }
    expect(generate).not.toHaveBeenCalled();
    expect(explainCache.size()).toBe(0);
  });

  it("revalidates before an existing cache hit and separates repeated canonical occurrences", async () => {
    await call(body);
    expect((await (await call(body)).json()).cached).toBe(true);
    await call({ ...body, range: { segments: [seg(2, first), seg(3, second)] } });
    expect(generate).toHaveBeenCalledTimes(2);
    const invalid = await call({ ...body, range: { segments: [seg(0, first), seg(3, second)] } });
    expect(invalid.status).toBe(422);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("preserves no-provider behavior: unavailable, no document read and no generation", async () => {
    mocks.resolveProvider.mockReturnValue(null);
    const response = await call(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unavailable: true });
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps upload ownership/revision gates and private headers for a new range", async () => {
    const attached = { ...paper, fullTextUploadId: "upload:0123456789abcdef" };
    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [paper.id] }).mockResolvedValueOnce({ revision: 4, paperIds: [paper.id] });
    const changed = await call({ ...body, paper: attached });
    expect(changed.status).toBe(410);
    expect(changed.headers.get("Cache-Control")).toContain("private");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(explainCache.size()).toBe(0);
    mocks.ownedUpload.mockResolvedValue(null); generate.mockClear(); mocks.getFullText.mockClear();
    const absent = await call({ ...body, paper: attached });
    expect(absent.status).toBe(404);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("covers rendered heading/caption/section boundaries, formulas and bounded long prefixes", async () => {
    const cap = "Figure 1 · Coils during the cycle.";
    const start = "See Figure 1 for the coils.";
    const heading = "2 Results";
    const after = "The second measured cycle ends.";
    const p = (i: number, text: string, sectionId = "s1") => seg(i, text, sectionId);
    const figDoc: ExtractedDocument = { ...doc, source: "pdf", figureCaptions: [{ ordinal: 0, label: "Figure 1", caption: "Coils during the cycle.", page: 2 }],
      sections: [{ ...doc.sections[0], text: `${start}\n\n${second}` }, { id: "s2", heading, canonical: "body", text: after }] };
    const cases = [
      { passage: `1 Setup ${start}`, segments: [p(2, "1 Setup"), p(0, start)], status: 200 },
      { passage: `${start} ${cap} ${second}`, segments: [p(0, start), p(3, cap), p(1, second)], status: 200 },
      { passage: `${cap} · p.2 of the PDF ${second}`, segments: [p(3, `${cap} · p.2 of the PDF`), p(1, second)], status: 200 },
      { passage: `coils. ${cap.slice(0, 8)}`, segments: [{ ...p(0, start), start: start.indexOf("coils") }, { ...p(3, cap), end: 8 }], status: 200 },
      { passage: `${second} ${heading} ${after}`, segments: [p(1, second), p(1, heading, "s2"), p(0, after, "s2")], status: 200 },
      { passage: `${start} ${second}`, segments: [p(0, start), p(1, second)], status: 422 },
      { passage: `${second} ${after}`, segments: [p(1, second), p(0, after, "s2")], status: 422 },
      { passage: `${second} ${start}`, segments: [p(1, second), p(0, start)], status: 422 },
      { passage: `${start} ${cap} · p.3 of the PDF`, segments: [p(0, start), p(3, `${cap} · p.3 of the PDF`)], status: 422 },
      { passage: `${start} ${cap} Unknown ${second}`, segments: [p(0, start), p(3, cap), p(1, second)], status: 422 },
    ];
    for (const test of cases) {
      explainCache.clear(); generate.mockClear();
      mocks.getFullText.mockResolvedValue({ status: "ok", doc: figDoc, attempts: [] });
      const crossSection = test.status === 200 && test.segments.some((part) => part.sectionId === "s2");
      if (crossSection) generate.mockResolvedValueOnce(JSON.stringify({ meaning: "Heat accumulates.", here: { text: "It describes the cycle.", evidence: `${second} ${after}` }, reply: "The cycle transfers heat.", evidence: `${second} ${after}` }));
      const response = await call({ ...body, passage: test.passage, range: { segments: test.segments } });
      expect(response.status, test.passage).toBe(test.status);
      expect(generate).toHaveBeenCalledTimes(test.status === 200 ? 1 : 0);
      if (crossSection) {
        const answer = await response.json();
        expect(body.thread ? answer.turn : answer.answer.here).toMatchObject({ peer: true });
        expect(JSON.stringify(answer)).not.toContain("evidence");
      }
    }
    for (const equation of [false, true]) {
      const formulaDoc = { ...doc, equations: [{ latex: "x=y" }], sections: [{ ...doc.sections[0], text: equation ? `${first}\n\n${blockMarker(0)}\n\n${second}` : `Amber ${inlineMath("x=y")} coils store heat.` }] };
      mocks.getFullText.mockResolvedValue({ status: "ok", doc: formulaDoc, attempts: [] });
      generate.mockClear();
      const response = await call({ ...body, passage: equation ? `${first} ${second}` : "Amber coils store heat.", range: equation ? valid : { segments: [p(0, "Amber \u0000 coils store heat.")] } });
      expect(response.status).toBe(422); expect(generate).not.toHaveBeenCalled();
    }
    for (const words of [270, 235]) {
      const head = "amber ".repeat(words).trim(); const tail = "copper ".repeat(70).trim();
      const bounded = clipPassage(`${head} ${tail}`);
      const segments = bounded.length <= head.length ? [{ ...p(0, head), end: bounded.length }] : [p(0, head), { ...p(1, tail), end: bounded.length - head.length - 1 }];
      mocks.getFullText.mockResolvedValue({ status: "ok", doc: { ...doc, sections: [{ ...doc.sections[0], text: `${head}\n\n${tail}` }] }, attempts: [] });
      expect((await call({ ...body, passage: `${head} ${tail}`, range: { segments } })).status).toBe(200);
      generate.mockClear();
      expect((await call({ ...body, passage: `${head} ${tail}`, range: { segments: [p(0, head), p(1, tail)] } })).status).toBe(422);
      expect(generate).not.toHaveBeenCalled();
    }
  });
});

it("P12-11 explicit single prefix uses a new cache identity; absent range retains legacy source behavior", async () => {
  await call({ passage: first, range: { segments: [seg(0, first)] }, source: "paper" });
  await call({ passage: first, range: undefined });
  await call({ passage: first, range: undefined, source: "summary" });
  expect(generate).toHaveBeenCalledTimes(3);
  expect((await (await call({ passage: first, range: { segments: [seg(0, first)] } })).json()).cached).toBe(true);
  expect((await (await call({ passage: first, range: undefined })).json()).cached).toBe(true);
  expect((await (await call({ passage: first, range: undefined, source: "summary" })).json()).cached).toBe(true);
  expect(generate).toHaveBeenCalledTimes(3);
});
