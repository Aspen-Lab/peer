import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const record = { id: "https://openalex.org/I1", display_name: "Example University", image_thumbnail_url: "https://upload.wikimedia.org/wikipedia/commons/example.png" };
afterEach(() => vi.unstubAllGlobals());

describe("institution logo endpoint", () => {
  it("uses the given institution ID and checks its name", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request) => Response.json(record));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(new NextRequest("http://localhost/api/institutions/logo?id=I1&name=Example%20University"));
    expect(await response.json()).toEqual({ logoUrl: record.image_thumbnail_url });
    expect(String(fetcher.mock.calls[0][0])).toContain("/institutions/I1");
  });
  it("does not guess between same-named institutions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [record, { ...record, id: "https://openalex.org/I2" }] })));
    const response = await GET(new NextRequest("http://localhost/api/institutions/logo?name=Example%20University"));
    expect(await response.json()).toEqual({ logoUrl: null });
  });
  it("does not cache an upstream outage as a missing logo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
    const response = await GET(new NextRequest("http://localhost/api/institutions/logo?name=Example%20University"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects invalid IDs without calling the upstream", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await GET(new NextRequest("http://localhost/api/institutions/logo?id=wrong&name=Example"));
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
