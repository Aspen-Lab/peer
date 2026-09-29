import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { selectLiveEventsEnv } from "./vitest.env-allowlist";
import { sharedVitestConfig } from "./vitest.shared";

// The only configuration that may load local Vertex variables. Vite accepts
// prefixes rather than exact names, so select the narrow allow-list afterward.
const liveEventsEnv = selectLiveEventsEnv(loadEnv("test", process.cwd(), ""));

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    environment: "node",
    include: ["src/lib/events/benchmark.test.ts"],
    env: { ...liveEventsEnv, PEER_RUN_LIVE_EVENTS_BENCHMARK: "1" },
  },
});
