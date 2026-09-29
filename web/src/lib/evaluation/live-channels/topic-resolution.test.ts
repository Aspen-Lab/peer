import { describe, expect, it } from "vitest";
import { resolveTopicId } from "./topic-resolution";

describe("resolveTopicId", () => {
  it("resolves the bare T-id of the top hit", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ results: [{ id: "https://openalex.org/T10736" }] }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await resolveTopicId("battery materials", { fetchImpl });
    expect(result).toEqual({ topicId: "T10736" });
  });

  it("sends the topic as the search param and caps the page at 1", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: string) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await resolveTopicId("solid-state electrolytes", { fetchImpl });
    expect(capturedUrl).toContain("api.openalex.org/topics?");
    expect(capturedUrl).toContain("search=solid-state+electrolytes");
    expect(capturedUrl).toContain("per_page=1");
  });

  it("resolves topicId: undefined on a genuine zero-result response, without throwing", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
      })) as unknown as typeof fetch;

    const result = await resolveTopicId("an extremely obscure made-up topic", {
      fetchImpl,
    });
    expect(result).toEqual({ topicId: undefined });
  });

  it("throws on a non-2xx response, carrying the status in the message so 429s are classifiable", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;

    await expect(
      resolveTopicId("battery materials", { fetchImpl }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it("throws on a network error (fetch rejects)", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      resolveTopicId("battery materials", { fetchImpl }),
    ).rejects.toThrow(/network down/);
  });
});
