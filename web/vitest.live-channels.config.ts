import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { selectLiveChannelsEnv } from "./vitest.env-allowlist";
import { sharedVitestConfig } from "./vitest.shared";

// LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u/§1w) — the only configuration that
// may load local Semantic Scholar / OpenAlex credentials. Sibling to
// vitest.live-events.config.ts: same shape, own allow-list, own opt-in
// literal, own single test file. Vite accepts prefixes rather than exact
// names, so select the narrow allow-list afterward.
const liveChannelsEnv = selectLiveChannelsEnv(
  loadEnv("test", process.cwd(), ""),
);

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    environment: "node",
    // One explicit file, never a glob — a credential-bearing config must
    // only ever collect the one file it was built for, even invoked with no
    // path argument (env-isolation.test.ts asserts this exactly).
    include: ["src/lib/evaluation/live-channels/live-channels.test.ts"],
    env: { ...liveChannelsEnv, PEER_RUN_LIVE_CHANNELS_EVAL: "1" },
  },
});
