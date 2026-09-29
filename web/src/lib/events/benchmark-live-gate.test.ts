import { afterEach, describe, expect, it, vi } from "vitest";
import { canRunLiveEventsBenchmark } from "./benchmark-live-gate";

afterEach(() => vi.unstubAllEnvs());

describe("events live benchmark gate", () => {
  it("skips when a dummy configured provider exists without the explicit marker", () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "dummy-project");
    vi.stubEnv("PEER_RUN_LIVE_EVENTS_BENCHMARK", "");

    expect(canRunLiveEventsBenchmark()).toBe(false);
  });
});
