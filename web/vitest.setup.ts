import { beforeEach } from "vitest";

/**
 * ABC-freemium 1-00 (Ruling 3 point 3) — **NO TEST MAY HOLD A SPENDABLE KEY.**
 *
 * Two names can cost the operator real money the moment they exist in the test
 * process:
 *
 *   - `GOOGLE_API_KEY` — the system AI Studio key. After R-KEY-1 (item 1-11)
 *     `resolveProvider()` returns a live Gemini provider whenever this is set,
 *     in *every* environment including `NODE_ENV=test`. A suite that reaches
 *     `resolveProvider()` without mocking the registry would then make a real,
 *     billed model call.
 *   - `TAVILY_API_KEY` — the system search key. `resolveSearchProvider` picks
 *     Tavily purely on `Boolean(key)`, so a suite that runs a pipeline would
 *     spend real search credits.
 *
 * `vitest.config.ts` already refuses to inject either out of `.env.local` (the
 * allow-list there). This file is the independent second layer: it also covers a
 * developer shell that exported one, a CI runner with it in the environment, and
 * any future config change that widens the allow-list back to a prefix.
 *
 * Deleted once per suite file at import time, and again before every test, so a
 * test that leaks one into `process.env` cannot arm the next one.
 *
 * **A test that genuinely needs one of these names has no business existing.**
 * Tests that want to prove the key is *ignored* stub a sentinel with
 * `vi.stubEnv` inside the test body — `registry.test.ts` is the pattern — which
 * is unaffected by this file. If you think you have found a real exception,
 * stop and record it rather than editing this list.
 */
const SPENDABLE_KEYS_FORBIDDEN_IN_TESTS = [
  "GOOGLE_API_KEY",
  "TAVILY_API_KEY",
] as const;

function deleteSpendableKeys(): void {
  for (const name of SPENDABLE_KEYS_FORBIDDEN_IN_TESTS) {
    delete process.env[name];
  }
}

deleteSpendableKeys();
beforeEach(deleteSpendableKeys);
