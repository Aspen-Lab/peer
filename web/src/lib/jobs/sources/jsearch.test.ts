import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobsQuery } from "../types";
import { jsearch, jsearchJobToRawItem } from "./jsearch";

// B8-03 (round 8): before this round, no test file existed for this adapter
// at all (confirmed by directory listing). The empty-company branch
// hardcoded a fabricated "Unknown company" placeholder - the hardest case
// for this adapter, since it is the one path nobody had exercised.
describe("jsearchJobToRawItem", () => {
  it("leaves company undefined when the source record has no employer_name", () => {
    const item = jsearchJobToRawItem({
      job_id: "abc123",
      job_title: "Battery R&D Scientist",
      job_apply_link: "https://acme.test/jobs/abc123",
    });
    expect(item?.company).toBeUndefined();
  });

  it("still keeps a real company name when the source record has one", () => {
    const item = jsearchJobToRawItem({
      job_id: "abc124",
      job_title: "Battery R&D Scientist",
      employer_name: "Acme Materials",
      job_apply_link: "https://acme.test/jobs/abc124",
    });
    expect(item?.company).toBe("Acme Materials");
  });
});

// SF-5 (the branch review): JSearch bills per request past a small free tier, and
// used to read `request key || JSEARCH_API_KEY` from the environment. A company
// key in the environment would have been spent for any reader whose request
// reached the adapter. The reader's own key travels in the request; with none,
// the adapter does nothing.
describe("jsearch adapter: the reader's own key, or nothing", () => {
  // Invented strings. Neither is, or ever was, a key.
  const ENV_KEY = "jsearch-env-COMPANY-NOT-A-KEY";
  const OWN_KEY = "jsearch-reader-NOT-A-KEY";

  const query = (apiKeys?: JobsQuery["apiKeys"]): JobsQuery => ({
    topics: ["batteries"],
    queries: ["battery scientist"],
    locations: ["United States"],
    limit: 5,
    apiKeys,
  });

  const stubNetwork = () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("with no key in the request it is disabled, makes no call and returns nothing, even with the company name set", async () => {
    vi.stubEnv("JSEARCH_API_KEY", ENV_KEY);
    vi.stubEnv("RAPIDAPI_KEY", ENV_KEY);
    const fetchMock = stubNetwork();

    for (const apiKeys of [undefined, {}, { jsearchApiKey: "   " }]) {
      expect(jsearch.enabled(query(apiKeys))).toBe(false);
      await expect(jsearch.fetch(query(apiKeys))).resolves.toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with the reader's own key it calls JSearch with that key, and never with the environment's", async () => {
    vi.stubEnv("JSEARCH_API_KEY", ENV_KEY);
    const fetchMock = stubNetwork();
    const own = query({ jsearchApiKey: ` ${OWN_KEY} ` });

    expect(jsearch.enabled(own)).toBe(true);
    await jsearch.fetch(own);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-RapidAPI-Key"]).toBe(OWN_KEY);
    expect(JSON.stringify(init)).not.toContain(ENV_KEY);
  });
});
