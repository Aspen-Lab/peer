import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";
import type { SelectionTarget } from "./paper-body";
import { requestExplanation } from "./explain-box";
import { requestReply } from "./explain-thread";

const paper = { id: "upload:0123456789abcdef", title: "Invented range", authors: [], source: "other" } as unknown as Paper;
const range = { segments: [{ sectionId: "s1", paragraphIndex: 0, start: 5, end: 10 }, { sectionId: "s1", paragraphIndex: 1, start: 0, end: 4 }] };
const target = () => ({ sectionIndex: 0, paragraphIndex: 0, passage: "pools\n\nrise", range }) as SelectionTarget;
afterEach(() => vi.unstubAllGlobals());

describe("P12-12 bounded grouped request provenance", () => {
  it.each(["first", "reply", "more"])("carries the exact normalized range through %s", async (mode) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ answer: { meaning: "A rise.", here: { text: "It rose.", peer: true } }, turn: { role: "peer", text: "It rose.", peer: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    if (mode === "first") await requestExplanation({ paper, selection: target(), sectionId: "s1" });
    else await requestReply({ paper, selection: target(), sectionId: "s1", thread: [{ role: "peer", text: "First answer." }], message: "Why?", ...(mode === "more" ? { detail: true } : {}) });
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.range).toEqual(range);
    expect(body.passage).toBe("pools rise");
    expect(JSON.stringify(body.range)).not.toMatch(/quote|paragraphText|source/);
    expect(body.search).toBeUndefined();
    expect(body.detail).toBe(mode === "more" ? true : undefined);
  });

  it("rejects stale provenance before any request in all modes", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const selection = { ...target(), selectionStillHolds: () => false };
    await requestExplanation({ paper, selection, sectionId: "s1" });
    await requestReply({ paper, selection, sectionId: "s1", thread: [], message: "Why?" });
    await requestReply({ paper, selection, sectionId: "s1", thread: [], message: "Why?", detail: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
