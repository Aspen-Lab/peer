import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobsQuery } from "../types";
import { usajobs } from "./usajobs";

// SF-5 (the branch review): USAJOBS used to read `request key || USAJOBS_API_KEY`
// and `request agent || USAJOBS_USER_AGENT` from the environment. The reader's own
// key and registered email travel in the request; Peer holds neither, so with
// either missing the adapter does nothing and never throws.

// Invented strings. None of them is, or ever was, a credential or an address.
const ENV_KEY = "usajobs-env-COMPANY-NOT-A-KEY";
const ENV_AGENT = "company-agent-NOT-AN-ADDRESS";
const OWN_KEY = "usajobs-reader-NOT-A-KEY";
const OWN_AGENT = "reader-agent-NOT-AN-ADDRESS";

const query = (apiKeys?: JobsQuery["apiKeys"]): JobsQuery => ({
  topics: ["batteries"],
  queries: ["battery scientist"],
  locations: ["United States"],
  limit: 5,
  apiKeys,
});

const stubNetwork = () => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ SearchResult: { SearchResultItems: [] } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("usajobs adapter: the reader's own key and agent, or nothing", () => {
  it("with nothing in the request it is disabled, makes no call and returns nothing, even with the company names set", async () => {
    vi.stubEnv("USAJOBS_API_KEY", ENV_KEY);
    vi.stubEnv("USAJOBS_USER_AGENT", ENV_AGENT);
    const fetchMock = stubNetwork();

    for (const apiKeys of [undefined, {}, { usajobsApiKey: "  ", usajobsUserAgent: "  " }]) {
      expect(usajobs.enabled(query(apiKeys))).toBe(false);
      await expect(usajobs.fetch(query(apiKeys))).resolves.toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs both from the request: a key without an agent, or an agent without a key, does nothing whatever the environment holds", async () => {
    vi.stubEnv("USAJOBS_API_KEY", ENV_KEY);
    vi.stubEnv("USAJOBS_USER_AGENT", ENV_AGENT);
    const fetchMock = stubNetwork();

    for (const apiKeys of [{ usajobsApiKey: OWN_KEY }, { usajobsUserAgent: OWN_AGENT }]) {
      expect(usajobs.enabled(query(apiKeys))).toBe(false);
      await expect(usajobs.fetch(query(apiKeys))).resolves.toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with the reader's own key and agent it calls USAJOBS with those, and never with the environment's", async () => {
    vi.stubEnv("USAJOBS_API_KEY", ENV_KEY);
    vi.stubEnv("USAJOBS_USER_AGENT", ENV_AGENT);
    const fetchMock = stubNetwork();
    const own = query({ usajobsApiKey: ` ${OWN_KEY} `, usajobsUserAgent: ` ${OWN_AGENT} ` });

    expect(usajobs.enabled(own)).toBe(true);
    await usajobs.fetch(own);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization-Key"]).toBe(OWN_KEY);
    expect(headers["User-Agent"]).toBe(OWN_AGENT);
    expect(JSON.stringify(init)).not.toContain(ENV_KEY);
    expect(JSON.stringify(init)).not.toContain(ENV_AGENT);
  });
});
