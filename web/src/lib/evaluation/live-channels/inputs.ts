// LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u/§1w, guide Finding C3) — loading
// and validating the runner's own input file: 6 warm-pool starter topics +
// one synthetic battery-materials profile (3 DOI-named seeds), never the
// user's real stored profile (§1w P2).
//
// Resolution order (never mutated by a run — resolved topic/seed ids go to a
// separate cache file under output/, see topic-resolution.ts/
// seed-resolution.ts and runner.ts):
//   1. PEER_LIVE_CHANNELS_INPUTS_PATH, if set.
//   2. web/.local-data/live-channels-eval-inputs.json, if it exists (already
//      gitignored — web/.gitignore:46 covers /.local-data).
//   3. The checked-in example, web/src/lib/evaluation/__fixtures__/
//      live-channels-eval-inputs.example.json (public DOIs are not secrets).

import fs from "node:fs";
import path from "node:path";
import { normalizeDoi } from "@/lib/utils/canonical-identity";
import exampleInputs from "../__fixtures__/live-channels-eval-inputs.example.json";

export interface LiveChannelsInput {
  id: string;
  topics: string[];
  /** Already DOI-shape-validated and normalized (lowercase, no doi.org prefix) — see parseLiveChannelsInputs. */
  seedDois: string[];
  topicIds: string[];
}

export interface DroppedSeedDoi {
  inputId: string;
  /** The original, unnormalized string from the file — kept so a user can find and fix it. */
  doi: string;
  reason: string;
}

export interface ParsedLiveChannelsInputs {
  inputs: LiveChannelsInput[];
  droppedSeedDois: DroppedSeedDoi[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Validate + normalize one already-JSON-parsed inputs file. Never throws on
 * malformed input (mirrors metrics.ts's own "never throws" discipline): an
 * unusable top-level shape (not an object, no `inputs` array) resolves to
 * zero inputs rather than crashing the runner; an input entry missing a
 * non-empty `id` is skipped entirely (there is nothing safe to key its
 * results under); a malformed/missing-shape seed DOI on an otherwise-valid
 * input is dropped and reported by input id + the original string, never
 * silently kept, invented, or substituted.
 */
export function parseLiveChannelsInputs(
  raw: unknown,
): ParsedLiveChannelsInputs {
  const droppedSeedDois: DroppedSeedDoi[] = [];

  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as { inputs?: unknown }).inputs)
  ) {
    return { inputs: [], droppedSeedDois };
  }

  const rawInputs = (raw as { inputs: unknown[] }).inputs;
  const inputs: LiveChannelsInput[] = [];

  for (const entry of rawInputs) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    if (!id) continue;

    const topics = isStringArray(e.topics) ? e.topics.filter(Boolean) : [];
    const topicIds = isStringArray(e.topicIds) ? e.topicIds.filter(Boolean) : [];
    const rawSeedDois = isStringArray(e.seedDois) ? e.seedDois : [];

    const seedDois: string[] = [];
    for (const rawDoi of rawSeedDois) {
      const normalized = normalizeDoi(rawDoi);
      if (!normalized) {
        droppedSeedDois.push({ inputId: id, doi: rawDoi, reason: "malformed DOI shape" });
        continue;
      }
      seedDois.push(normalized);
    }

    inputs.push({ id, topics, topicIds, seedDois });
  }

  return { inputs, droppedSeedDois };
}

export type InputsSourceLabel = "env override" | "local override" | "checked-in example";

export interface ResolvedInputsSource {
  path: string;
  label: InputsSourceLabel;
}

/**
 * Pure resolution-order decision — takes an injected `exists` check so it is
 * testable without a real filesystem. Never itself reads or writes a file.
 */
export function resolveInputsSource(
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean,
  cwd: string,
): ResolvedInputsSource {
  const envPath = env.PEER_LIVE_CHANNELS_INPUTS_PATH?.trim();
  if (envPath) return { path: envPath, label: "env override" };

  const localPath = path.join(
    cwd,
    ".local-data",
    "live-channels-eval-inputs.json",
  );
  if (exists(localPath)) return { path: localPath, label: "local override" };

  return {
    path: path.join(
      cwd,
      "src",
      "lib",
      "evaluation",
      "__fixtures__",
      "live-channels-eval-inputs.example.json",
    ),
    label: "checked-in example",
  };
}

export interface LoadedLiveChannelsInputs extends ParsedLiveChannelsInputs {
  source: ResolvedInputsSource;
}

/**
 * Real-filesystem loader for actual runner use. When the resolved source IS
 * the checked-in example, reads the bundled JSON import directly rather than
 * re-reading the file from disk by path, so this still works from contexts
 * where only the compiled module graph survives. Never writes back into
 * whichever file it read.
 */
export function loadLiveChannelsInputs(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): LoadedLiveChannelsInputs {
  const source = resolveInputsSource(env, (p) => fs.existsSync(p), cwd);
  const raw: unknown =
    source.label === "checked-in example"
      ? exampleInputs
      : (JSON.parse(fs.readFileSync(source.path, "utf8")) as unknown);
  const parsed = parseLiveChannelsInputs(raw);
  return { ...parsed, source };
}
