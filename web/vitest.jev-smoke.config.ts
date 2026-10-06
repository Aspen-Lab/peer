import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { selectJevSmokeEnv } from "./vitest.env-allowlist";
import { sharedVitestConfig } from "./vitest.shared";

// JEV-DIRECT (§1aa point 6) — the only configuration that may load a local
// JEV_SMOKE_API_KEY credential (the smoke runner's own name; Peer holds no Jev
// key and nothing reads the old company name). Sibling to vitest.live-channels.config.ts: same
// shape, own allow-list, own opt-in literal, own single test file. Vite
// accepts prefixes rather than exact names, so select the narrow allow-list
// afterward. Nobody runs `npm run test:jev-smoke` as part of this pass — it
// is built and its isolation proven, never executed with a real key.
const jevSmokeEnv = selectJevSmokeEnv(loadEnv("test", process.cwd(), ""));

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    environment: "node",
    // One explicit file, never a glob — a credential-bearing config must
    // only ever collect the one file it was built for, even invoked with no
    // path argument (env-isolation.test.ts asserts this exactly).
    include: ["src/lib/evaluation/jev-smoke/jev-smoke.test.ts"],
    env: { ...jevSmokeEnv, PEER_RUN_JEV_SMOKE: "1" },
  },
});
