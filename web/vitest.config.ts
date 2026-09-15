import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { VITEST_INJECTED_ENV_NAMES } from "./vitest.env-allowlist";

// RULING 75 / RULING 76d — the live benchmark runs on the Vertex Gemini search
// provider, so the test process needs the same Vertex credentials the dev server
// reads from `.env.local`. **Measured, not assumed: Vitest does NOT copy env
// files into `process.env`** (probed 2026-08-15 — `GOOGLE_VERTEX_PROJECT` read
// back `false` inside a test while the same file was loaded fine by
// `node --env-file`). Without this the live benchmark can only ever SKIP, and a
// skipped benchmark is the "green by absence" round 28 A refused to bank.
//
// ABC-freemium 1-00 (Ruling 3 point 3) — **AN EXPLICIT ALLOW-LIST, NEVER A
// PREFIX.** This used to be `loadEnv("test", cwd, "GOOGLE_")`, whose own comment
// claimed it carried "exactly what a Vertex grounding call needs … and nothing
// else". That was untrue: the `GOOGLE_` prefix also matches `GOOGLE_API_KEY`,
// the operator's AI Studio key. It was inert only because `resolveProvider()`
// refused a server provider under `NODE_ENV=test`; the moment R-KEY-1 makes the
// system provider resolve in every environment, an unmocked `resolveProvider()`
// inside any of the ~101 suites would return a live provider on the owner's real
// key and a single test could make a real, billed model call.
//
// So `VITEST_INJECTED_ENV_NAMES` (in `./vitest.env-allowlist.ts`, kept there so
// this config keeps a single default export) is the whole of what may ever reach
// the test process, listed one name at a time.
//
// The names are passed to `loadEnv` as prefixes as well as filtered afterwards,
// so a forbidden variable is never even read out of `.env.local` — and a
// near-miss like `GOOGLE_VERTEX_PROJECT_ID`, which the prefix match alone would
// accept, is still dropped by the exact-name filter.
const localEnv = loadEnv("test", process.cwd(), [...VITEST_INJECTED_ENV_NAMES]);
const vertexEnv: Record<string, string> = {};
for (const name of VITEST_INJECTED_ENV_NAMES) {
  const value = localEnv[name];
  if (value) vertexEnv[name] = value;
}

// Minimal config: resolve the `@/` path alias (same as tsconfig) so unit tests
// can import modules that use it, and run in a Node environment.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    env: vertexEnv,
    // ABC-freemium 1-00 — the second, independent layer. The allow-list above
    // stops `.env.local` from reaching the suites; this deletes the two
    // spendable keys from `process.env` itself, so a shell that exported one
    // cannot arm a test either. `src/test-support/env-isolation.test.ts` asserts
    // the result inside the test process.
    setupFiles: ["./vitest.setup.ts"],
  },
});
