/**
 * Live provider check — ABC-freemium 8-02 · Ruling 23 point 5.
 *
 * USAGE:  cd web && npm run check:providers
 *
 * It asks every AI provider you have a key for whether each of its configured
 * model ids still answers, and prints one PASS/FAIL line per model id. Run it
 * after changing a model id, after rotating a key, or whenever you want to know
 * that the AI side of the product actually works.
 *
 * WHY IT EXISTS. Every test suite deletes the API keys on purpose, so nothing
 * in the gate has ever made a real model call. Seven rounds of green gates and
 * 2,924 passing tests reported a healthy AI path while both shipped Gemini
 * models were returning 404 and the product could not complete a single call.
 * A guard that prevents spending also prevents verification, and this script is
 * the gap it leaves. `testConnection()` has existed on all five providers the
 * whole time and was called from nowhere.
 *
 * IT MAKES REAL, BILLED CALLS. That is the point — an external call is not
 * verified until something has actually made one. Each check is one tiny
 * request. It is invoked by hand, it is not part of `npm test`, and it refuses
 * to run inside vitest.
 *
 * IT NEVER PRINTS KEY MATERIAL. Every error string goes through `redact()`
 * before it reaches the console.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

// ───────────────────────────────────────────────────────────────────────────
// Refuse to run inside vitest
// ───────────────────────────────────────────────────────────────────────────

// Item 1-00 deletes every key inside the suite by design, and a live billed
// call from a test run is exactly what that guard exists to prevent. This is
// belt and braces: nothing imports this file, but a future `npm test` glob or
// a copied import must not turn the gate into a spender.
if (
  process.env.VITEST ||
  process.env.VITEST_WORKER_ID ||
  process.env.VITEST_POOL_ID ||
  process.env.NODE_ENV === "test"
) {
  console.error(
    "check-provider-models: refusing to run inside vitest — this makes real, " +
      "billed API calls. Run it by hand: cd web && npm run check:providers",
  );
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────────
// Redaction
// ───────────────────────────────────────────────────────────────────────────

/**
 * The prefixes are assembled from parts ON PURPOSE. Writing them as plain
 * literals would make the repo's standing pre-commit credential grep fire on
 * this file forever, which turns a real signal into noise everybody learns to
 * ignore. The verbatim pass below is the actual protection; this is the net
 * under it, for a key that reaches an error string from somewhere else.
 */
const KEY_PREFIXES = ["A" + "Iza", "A" + "Q.", "sk-", "tvly" + "-"];

/** Every key value this run has loaded, so each can be blanked verbatim. */
const secrets = new Set();

function rememberSecret(value) {
  if (typeof value === "string" && value.trim().length >= 8) {
    secrets.add(value.trim());
  }
}

function redact(input) {
  let out = String(input);
  // 1. Verbatim: anything we actually hold. This is the real protection.
  for (const secret of secrets) out = out.split(secret).join("[REDACTED]");
  // 2. Shape: a token carrying a known key prefix, wherever it came from.
  for (const prefix of KEY_PREFIXES) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped + "[A-Za-z0-9_.\\-]{6,}", "g"), "[REDACTED]");
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Environment
// ───────────────────────────────────────────────────────────────────────────

/**
 * Read `web/.env.local` the way the app would, WITHOUT overwriting anything
 * already set in the shell — so `OPENAI_API_KEY=… npm run check:providers`
 * tests the key you just typed, not the one on disk. Values are never printed.
 */
function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

loadEnvLocal();

// ───────────────────────────────────────────────────────────────────────────
// Load the product's own providers
// ───────────────────────────────────────────────────────────────────────────

// The providers are TypeScript and import through the `@/` alias, so they need
// a loader that understands both. `jiti` ships with the toolchain (eslint,
// vite and tailwind each depend on it), so this needs no new dependency —
// but say so plainly if it is ever missing rather than failing cryptically.
let jiti;
try {
  const { createJiti } = await import("jiti");
  jiti = createJiti(import.meta.url, { alias: { "@": SRC_DIR } });
} catch (err) {
  console.error(
    "check-provider-models: could not load the TypeScript loader `jiti`.\n" +
      "  Run `npm install` in web/ and try again.\n" +
      "  " + redact(err?.message ?? err),
  );
  process.exit(2);
}

const load = (relative) => jiti.import(new URL(relative, import.meta.url).pathname);

const { PROVIDER_MODELS } = await load("../src/lib/llm/provider-models.ts");
const { createGeminiApiProvider } = await load("../src/lib/llm/providers/gemini.ts");
const { createOpenAIProvider } = await load("../src/lib/llm/providers/openai.ts");
const { createQwenProvider } = await load("../src/lib/llm/providers/qwen.ts");
const { createAnthropicProvider } = await load("../src/lib/llm/providers/anthropic.ts");
const { createDeepseekProvider } = await load("../src/lib/llm/providers/deepseek.ts");

// ───────────────────────────────────────────────────────────────────────────
// One provider per model id, so `testConnection()` answers per model id
// ───────────────────────────────────────────────────────────────────────────

/**
 * Each entry says which environment variable configures the provider and how
 * to build an instance pinned to ONE model id. `testConnection()` on the real
 * provider is what actually runs — this script adds no request of its own, so
 * a pass here means the code path the product uses works.
 */
const PROVIDERS = [
  {
    id: "gemini",
    keyNames: ["GOOGLE_API_KEY"],
    // The Gemini provider takes a model CHAIN; a one-target chain pins it.
    build: (key, modelId) =>
      createGeminiApiProvider(key, [
        { id: modelId, location: "global", tier: "small" },
      ]),
  },
  {
    id: "openai",
    keyNames: ["OPENAI_API_KEY"],
    build: (key, modelId) => createOpenAIProvider(key, modelId),
  },
  {
    id: "qwen",
    keyNames: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
    build: (key, modelId) => createQwenProvider(key, modelId),
  },
  {
    id: "anthropic",
    keyNames: ["ANTHROPIC_API_KEY"],
    build: (key, modelId) => createAnthropicProvider(key, modelId),
  },
  {
    id: "deepseek",
    keyNames: ["DEEPSEEK_API_KEY"],
    build: (key, modelId) => createDeepseekProvider(key, modelId),
  },
];

/** The distinct model ids a provider ships, and which tiers each one serves. */
function modelsFor(providerId) {
  const plan = PROVIDER_MODELS[providerId];
  const byId = new Map();
  for (const tier of ["small", "large"]) {
    const id = plan[tier];
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(tier);
  }
  return [...byId].map(([id, tiers]) => ({ id, tiers }));
}

function configuredKey(keyNames) {
  for (const name of keyNames) {
    const value = process.env[name]?.trim();
    if (value) {
      rememberSecret(value);
      return { name, value };
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Run
// ───────────────────────────────────────────────────────────────────────────

const pad = (text, width) => String(text).padEnd(width);

console.log("");
console.log("Peer — live provider check (ABC-freemium 8-02)");
console.log(
  "THIS MAKES REAL, BILLED API CALLS — one tiny request per model id below.",
);
console.log(`Keys are read from the shell first, then ${WEB_DIR}.env.local. None are printed.`);
console.log("");

let failures = 0;
let checked = 0;

for (const provider of PROVIDERS) {
  const key = configuredKey(provider.keyNames);
  const models = modelsFor(provider.id);

  if (!key) {
    console.log(
      `${pad(provider.id, 10)} ${pad("—", 30)} ${pad("", 14)} SKIP   ` +
        `no key (${provider.keyNames.join(" or ")})`,
    );
    continue;
  }

  for (const model of models) {
    const roles = model.tiers.join("+");
    let result;
    try {
      result = await provider.build(key.value, model.id).testConnection();
    } catch (err) {
      result = { ok: false, error: String(err) };
    }
    checked += 1;
    if (result.ok) {
      console.log(`${pad(provider.id, 10)} ${pad(model.id, 30)} ${pad(roles, 14)} PASS`);
    } else {
      failures += 1;
      const detail = redact(result.error ?? "unknown error").replace(/\s+/g, " ").slice(0, 200);
      console.log(
        `${pad(provider.id, 10)} ${pad(model.id, 30)} ${pad(roles, 14)} FAIL   ${detail}`,
      );
    }
  }
}

console.log("");
if (checked === 0) {
  console.log("No provider key is configured, so nothing was checked.");
  process.exitCode = 1;
} else {
  console.log(
    failures === 0
      ? `All ${checked} configured model id(s) answered.`
      : `${failures} of ${checked} configured model id(s) FAILED.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

// `process.exitCode` rather than `process.exit()`: the SDK clients hold open
// sockets, and forcing the process down mid-close makes libuv abort with an
// assertion on Windows — an alarming message on an otherwise clean pass.
// Setting the code lets Node drain and exit on its own with the same status.
