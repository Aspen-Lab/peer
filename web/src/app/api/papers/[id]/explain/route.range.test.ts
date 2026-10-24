import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache } from "@/lib/papers/explain";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

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
const generate = vi.fn(async (_args: { userPrompt: string; systemPrompt: string }) => JSON.stringify({ meaning: "Heat accumulates.", here: { text: "It describes the cycle.", evidence: "An invented sentence that is absent from the paper entirely." }, reply: "The cycle transfers heat.", evidence: "An invented sentence that is absent from the paper entirely." }));
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
