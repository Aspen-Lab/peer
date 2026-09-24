import { describe, expect, it } from "vitest";
import defaultConfig from "../../vitest.config";
import liveEventsConfig from "../../vitest.live-events.config";
import {
  liveEventsEnvAllowlist,
  selectLiveEventsEnv,
} from "../../vitest.env-allowlist";

describe("Vitest provider environment isolation", () => {
  it("removes ambient spendable provider keys from the default suite", () => {
    expect(process.env.GOOGLE_API_KEY).toBeUndefined();
    expect(process.env.TAVILY_API_KEY).toBeUndefined();
    expect(defaultConfig.test?.env).toBeUndefined();
  });

  it("allows only exact live benchmark credential names", () => {
    expect(liveEventsEnvAllowlist).toEqual([
      "GOOGLE_VERTEX_PROJECT",
      "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]);
    expect(
      selectLiveEventsEnv({
        GOOGLE_VERTEX_PROJECT: "dummy-project",
        GOOGLE_VERTEX_PROJECT_EXTRA: "must-not-pass",
        GOOGLE_VERTEX_LOCATION: "dummy-location",
        GOOGLE_APPLICATION_CREDENTIALS: "dummy-credentials-path",
        GOOGLE_API_KEY: "must-not-pass",
        TAVILY_API_KEY: "must-not-pass",
      }),
    ).toEqual({
      GOOGLE_VERTEX_PROJECT: "dummy-project",
      GOOGLE_VERTEX_LOCATION: "dummy-location",
      GOOGLE_APPLICATION_CREDENTIALS: "dummy-credentials-path",
    });
    expect(liveEventsConfig.test?.env).toMatchObject({
      PEER_RUN_LIVE_EVENTS_BENCHMARK: "1",
    });
    expect(
      Object.keys(liveEventsConfig.test?.env ?? []).every(
        (name) =>
          name === "PEER_RUN_LIVE_EVENTS_BENCHMARK" ||
          liveEventsEnvAllowlist.includes(name as (typeof liveEventsEnvAllowlist)[number]),
      ),
    ).toBe(true);
  });
});
