import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobsQuery } from "../types";
import { adzuna, adzunaJobToRawItem } from "./adzuna";

// B8-03 (round 8): before this round, no test file existed for this adapter
// at all (confirmed by directory listing). The empty-company branch
// hardcoded a fabricated "Unknown company" placeholder - Ruling 26's own
// anti-pattern, unaudited since B5-03 introduced the rule in jobweb.ts. This
// is the hardest case for this adapter: the one path nobody had exercised.
describe("adzunaJobToRawItem", () => {
  it("leaves company undefined when the source record has no display_name", () => {
    const item = adzunaJobToRawItem(
      {
        id: 123,
        title: "Battery R&D Scientist",
        company: {},
        redirect_url: "https://acme.test/jobs/123",
      },
      "us",
    );
    expect(item?.company).toBeUndefined();
  });

  it("still keeps a real company name when the source record has one", () => {
    const item = adzunaJobToRawItem(
      {
        id: 124,
        title: "Battery R&D Scientist",
        company: { display_name: "Acme Materials" },
        redirect_url: "https://acme.test/jobs/124",
      },
      "us",
    );
    expect(item?.company).toBe("Acme Materials");
  });
});

// SF-5 (the branch review): Adzuna used to read `request key || ADZUNA_APP_ID /
// ADZUNA_APP_KEY` from the environment. The reader's own credentials travel in the
// request; Peer holds none of its own, so with none in the request the adapter
// does nothing, and a company value in the environment buys nothing.
describe("adzuna adapter: the reader's own credentials, or nothing", () => {
  // Invented strings. None of them is, or ever was, a credential.
  const ENV_APP_ID = "adzuna-env-app-id-COMPANY-NOT-A-KEY";
  const ENV_APP_KEY = "adzuna-env-app-key-COMPANY-NOT-A-KEY";
  const OWN_APP_ID = "adzuna-reader-app-id-NOT-A-KEY";
  const OWN_APP_KEY = "adzuna-reader-app-key-NOT-A-KEY";

  const query = (apiKeys?: JobsQuery["apiKeys"]): JobsQuery => ({
    topics: ["batteries"],
    queries: ["battery scientist"],
    locations: ["United States"],
    limit: 5,
    apiKeys,
  });

  const stubNetwork = () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("with no credentials in the request it is disabled, makes no call and returns nothing, even with the company names set", async () => {
    vi.stubEnv("ADZUNA_APP_ID", ENV_APP_ID);
    vi.stubEnv("ADZUNA_APP_KEY", ENV_APP_KEY);
    const fetchMock = stubNetwork();

    expect(adzuna.enabled(query())).toBe(false);
    expect(adzuna.enabled(query({}))).toBe(false);
    await expect(adzuna.fetch(query())).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs both halves from the request: an id alone, a key alone or blanks do nothing, whatever the environment holds", async () => {
    vi.stubEnv("ADZUNA_APP_ID", ENV_APP_ID);
    vi.stubEnv("ADZUNA_APP_KEY", ENV_APP_KEY);
    const fetchMock = stubNetwork();

    for (const apiKeys of [
      { adzunaAppId: OWN_APP_ID },
      { adzunaAppKey: OWN_APP_KEY },
      { adzunaAppId: "  ", adzunaAppKey: "  " },
    ]) {
      expect(adzuna.enabled(query(apiKeys))).toBe(false);
      await expect(adzuna.fetch(query(apiKeys))).resolves.toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with the reader's own id and key it calls Adzuna with those, and never with the environment's", async () => {
    vi.stubEnv("ADZUNA_APP_ID", ENV_APP_ID);
    vi.stubEnv("ADZUNA_APP_KEY", ENV_APP_KEY);
    const fetchMock = stubNetwork();
    const own = query({ adzunaAppId: ` ${OWN_APP_ID} `, adzunaAppKey: ` ${OWN_APP_KEY} ` });

    expect(adzuna.enabled(own)).toBe(true);
    await adzuna.fetch(own);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String((fetchMock.mock.calls as unknown as Array<[string]>)[0][0]);
    expect(url).toContain(`app_id=${OWN_APP_ID}`);
    expect(url).toContain(`app_key=${OWN_APP_KEY}`);
    expect(url).not.toContain(ENV_APP_ID);
    expect(url).not.toContain(ENV_APP_KEY);
  });
});
