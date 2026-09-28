/**
 * JEV-DIRECT (§1aa point 6) — the opt-in live Jev smoke runner. Mirrors
 * `evaluation/live-channels/*` in shape, but simpler: a single provider with
 * its own internal retry/pacing already built in (`jev-client.ts`'s bounded
 * 429/529 backoff), so the S2/OpenAlex ledger's multi-provider pacing
 * machinery (`call-budget.ts`'s `CallBudget`) has no Jev equivalent to
 * copy — a plain call counter is enough here.
 *
 * Calls `callJevDirect` DIRECTLY (not the transport switch — the whole
 * point of this runner is confirming the direct path specifically), using a
 * throwaway in-memory `CounterStore` created fresh for the run and
 * discarded after. This is required by the smoke config's own exact-name
 * allow-list (`JEV_API_KEY` only — no Supabase credentials are available to
 * this process at all), so a real reservation is structurally impossible
 * here and must not be attempted. A synthetic fixed owner id and generous
 * caps on the in-memory store mean reservation always succeeds and this run
 * never touches, or is bounded by, any real user's or the real global daily
 * cap.
 *
 * Contract-mismatch reporting is the actual point of this runner:
 * `callJevDirect`'s status IS the signal — `"ok"` means the response passed
 * every one of `validateJevResponse`'s 6 rules; any fault status is a
 * contract mismatch (or a mundane network/auth fault), safe to print
 * verbatim — `jev-contract.ts`'s `fail()` `detail` strings only ever embed
 * question ids and Peer's own fixed rubric text, never paper/user data.
 *
 * NOBODY RUNS THIS LIVE IN THIS PASS. Built and unit-tested with injected
 * fakes only (`runner.test.ts`); `npm run test:jev-smoke` is never invoked —
 * see this item's checkpoint's "HOW THE USER RUNS THE JEV SMOKE TEST LATER"
 * section for the one command and what it costs.
 */

import fs from "node:fs";
import path from "node:path";
import { callJevDirect, type JevDirectClientOptions } from "@/lib/decisions/jev-direct-client";
import type { BrokerCallResult } from "@/lib/decisions/broker-client";
import { InMemoryCounterStore } from "@/lib/usage/counters";
import { credentialPresence, type JevSmokeCredentialPresence } from "./gate";
import { JEV_SMOKE_INPUTS, type JevSmokeInput } from "./inputs";

/** The spec's own suggested number — bounds accidental repeat-run/loop accumulation, not a single run's realistic cost (see the checkpoint's cost estimate). */
export const DEFAULT_JEV_SMOKE_CEILING = 10;

/** Fixed, synthetic — never a real user id. This run's reservation is against a throwaway in-memory store, never the real Supabase-backed one. */
const SMOKE_OWNER_ID = "jev-smoke";
/** Generous on purpose: this in-memory store exists only so a reservation always succeeds; it is discarded after the run. */
const SMOKE_PER_USER_CAP = 1_000;
const SMOKE_GLOBAL_CAP = 1_000;

export interface JevSmokeInputResult {
  id: string;
  label: string;
  status: BrokerCallResult["status"];
  latencyMs: number;
  /** Present only when `status === "ok"` — a silent model-alias upgrade is exactly what pinning + reporting this catches. */
  modelId?: string;
  /** Present only for `"invalid_response"` — `jev-contract.ts`'s own fixed rubric text/question ids, never paper/user data. */
  detail?: string;
  /** Present only for `"reservation_refused"` (structurally unreachable given this run's generous in-memory caps, but reported if it ever somehow fires). */
  reason?: string;
}

export interface JevSmokeSummary {
  startedAt: string;
  finishedAt: string;
  ceiling: number;
  attempted: number;
  ceilingReached: boolean;
  credentialPresence: JevSmokeCredentialPresence;
  results: JevSmokeInputResult[];
  outputDir: string;
}

export interface RunJevSmokeOptions {
  /** Defaults to `JEV_SMOKE_INPUTS`. Injectable so a test (or a user's own copy, per the checkpoint) can run a different set. */
  inputs?: readonly JevSmokeInput[];
  /** Checked BEFORE each attempt, same "check before, never after" discipline as `CallBudget.blockReason`. Defaults to `DEFAULT_JEV_SMOKE_CEILING`. */
  ceiling?: number;
  /** Defaults to the real clock. Tests inject a fixed one for determinism. */
  now?: () => Date;
  /** Defaults to the global `fetch` inside `callJevDirect`. Tests always inject their own — never real network. */
  fetchImpl?: JevDirectClientOptions["fetchImpl"];
  /** Defaults to actually writing under `<cwd>/output/jev-smoke/<timestamp>/`. Tests inject their own so nothing touches the real filesystem. */
  writeOutput?: (outputDir: string, summary: JevSmokeSummary, perInput: ReadonlyMap<string, JevSmokeInputResult>) => void;
  cwd?: string;
}

/** Mirrors `evaluation/live-channels/runner.ts`'s own `formatTimestamp` exactly. */
function formatTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Mirrors `evaluation/live-channels/runner.ts`'s own `output/live-eval/<ts>/summary.json` + one-file-per-input convention exactly. Already gitignored — root `.gitignore` covers both `/output/` and `/web/output/`. */
function defaultWriteOutput(
  outputDir: string,
  summary: JevSmokeSummary,
  perInput: ReadonlyMap<string, JevSmokeInputResult>,
): void {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  for (const [id, result] of perInput) {
    fs.writeFileSync(path.join(outputDir, `${id}.json`), JSON.stringify(result, null, 2), "utf8");
  }
}

function toInputResult(input: JevSmokeInput, call: BrokerCallResult, latencyMs: number): JevSmokeInputResult {
  const base = { id: input.id, label: input.label, status: call.status, latencyMs };
  if (call.status === "ok") return { ...base, modelId: call.modelId };
  if (call.status === "invalid_response") return { ...base, detail: call.detail };
  if (call.status === "reservation_refused") return { ...base, reason: call.reason };
  return base;
}

/**
 * Runs up to `ceiling` of the fixed synthetic inputs against the REAL Jev
 * endpoint via `callJevDirect` (never the transport switch), reports a
 * status per input, and writes the results to `output/jev-smoke/<ts>/`.
 * Never throws — `callJevDirect` is already documented never-throwing; a
 * per-input try/catch here is the final safety net so a truly unanticipated
 * failure for one input can never abort the rest of the run.
 */
export async function runJevSmoke(options: RunJevSmokeOptions = {}): Promise<JevSmokeSummary> {
  const inputs = options.inputs ?? JEV_SMOKE_INPUTS;
  const ceiling = options.ceiling ?? DEFAULT_JEV_SMOKE_CEILING;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  // Throwaway, in-memory, discarded after this function returns — never the
  // real Supabase-backed store. See this module's own doc comment.
  const store = new InMemoryCounterStore();

  const results: JevSmokeInputResult[] = [];
  const perInput = new Map<string, JevSmokeInputResult>();
  let attempted = 0;
  let ceilingReached = false;

  for (const input of inputs) {
    if (attempted >= ceiling) {
      ceilingReached = true;
      break;
    }
    attempted += 1;

    let result: JevSmokeInputResult;
    try {
      const callStartedAt = Date.now();
      const call = await callJevDirect(input.request, {
        ownerId: SMOKE_OWNER_ID,
        entitled: true,
        perUserCap: SMOKE_PER_USER_CAP,
        globalCap: SMOKE_GLOBAL_CAP,
        store,
        now: startedAt,
        fetchImpl: options.fetchImpl,
      });
      result = toInputResult(input, call, Date.now() - callStartedAt);
    } catch (error) {
      // Final safety net — callJevDirect is documented never-throwing, but a
      // single input's failure must never abort the rest of the run.
      result = {
        id: input.id,
        label: input.label,
        status: "network_error",
        latencyMs: 0,
        detail: error instanceof Error ? error.message : "unknown error",
      };
    }
    results.push(result);
    perInput.set(input.id, result);
  }

  const finishedAt = now();
  const outputDir = path.join(options.cwd ?? process.cwd(), "output", "jev-smoke", formatTimestamp(startedAt));
  const summary: JevSmokeSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    ceiling,
    attempted,
    ceilingReached,
    credentialPresence: credentialPresence(),
    results,
    outputDir,
  };

  const writeOutput = options.writeOutput ?? defaultWriteOutput;
  writeOutput(outputDir, summary, perInput);

  return summary;
}
