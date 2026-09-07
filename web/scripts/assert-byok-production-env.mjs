// ABC-freemium 1-10 · R-GUARD-1, R-GUARD-2.
//
// This script is wired as `prebuild`, so it is the last thing standing between a
// misconfigured Vercel project and a silently wrong deployment. It used to be
// ban-only, and it banned `GOOGLE_API_KEY` — the very key D1 now makes the
// product's default LLM. It also required nothing at all, so a deployment with
// none of the necessary variables built and shipped happily as BYOK-only.
//
// Two lists now, both checked on a Vercel build.
//
// **R-GUARD-2 — the message may name variables and must NEVER print a value.**
// The obvious way to write the "missing" half is `Missing: NAME=${env[NAME]}`,
// which prints an empty string today and a live key the day someone sets a
// wrong-cased variant. Nothing below indexes `env` for output; `problems` and
// `missing` hold names filtered from literal arrays. `src/scripts/…test.ts`
// asserts it with a sentinel.

/**
 * Verbatim from R-GUARD-1. **Three names, no more** — without any one of them
 * the deployment cannot do what D1 says it does.
 *
 * **ABC-freemium 5-03 · D2a (Ruling 12): it was four.** `TAVILY_API_KEY` was
 * required here until the owner removed operator-funded search entirely. It has
 * moved to the banned list below, next to `BRAVE_SEARCH_API_KEY`, because under
 * D2a the two are the same kind of risk for the same reason: a server search key
 * on a deployment is money nobody meant to spend.
 */
const REQUIRED_ON_VERCEL = [
  "GOOGLE_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

/**
 * Operator-funded settings that must never reach a deployment.
 *
 * `GOOGLE_API_KEY` has moved to the required list — that is the whole of D1.
 * `BRAVE_SEARCH_API_KEY` and `PEER_DEV_ENTITLEMENT` are new: D2a keeps Brave
 * env-only and local, and R-ENT-5's plan override must not be settable on a
 * deployment (belt and braces — `resolveEntitlement` also refuses it at runtime,
 * which is what holds if someone adds the variable to an already-running
 * deployment).
 *
 * **5-03 · D2a — `TAVILY_API_KEY` joined them, coming the other way off the
 * required list.** The operator funds no search for anyone on any plan, so the
 * server never reads it and a deployment that carries it can only be a mistake
 * or a leak. **A Vercel project that still has the variable set will now FAIL
 * the build** — by design; the variable must be removed before deploying.
 */
const FORBIDDEN_ON_VERCEL = [
  "PEER_DIGEST_PROVIDER",
  "GOOGLE_VERTEX_PROJECT",
  // The Vertex AI Search app is operator-funded search, spent from the
  // server's own project exactly as grounding is, so it belongs on this list
  // for the same reason `GOOGLE_VERTEX_PROJECT` does.
  "GOOGLE_VERTEX_SEARCH_PROJECT",
  "GOOGLE_VERTEX_SEARCH_ENGINE_ID",
  "GOOGLE_VERTEX_SEARCH_DATA_STORE_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "QWEN_API_KEY",
  "DASHSCOPE_API_KEY",
  "DEEPSEEK_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  // 5-03 · D2a — the same kind of risk as Brave, for the same reason, so it
  // lives next to it.
  "TAVILY_API_KEY",
  "PEER_DEV_ENTITLEMENT",
];

function isVercelBuild(env) {
  return Boolean(env.VERCEL || env.VERCEL_ENV);
}

function isSet(env, name) {
  return Boolean(env[name]?.trim());
}

function missingRequiredNames(env) {
  return REQUIRED_ON_VERCEL.filter((name) => !isSet(env, name));
}

/**
 * Every operator-funded name that must not be set on a deployment, whether it
 * is on the explicit list or merely starts with a banned prefix.
 *
 * ── WHY A PREFIX, ADDED BY ABC-freemium 2-04 (Ruling 5 point 2) ──────────────
 *
 * The explicit list named **4** `GOOGLE_VERTEX_` variables. The tree reads
 * **11**, so seven — including `GOOGLE_VERTEX_LOCATION`,
 * `GOOGLE_VERTEX_SEARCH_LOCATION` and `GOOGLE_VERTEX_SEARCH_FALLBACK` — could
 * be set on a deployment without the guard saying a word. They all configure
 * the same operator-funded project, so the ban is on the family, not on a
 * hand-maintained subset that drifts every time a variable is added.
 *
 * **The explicit names stay.** They are what makes the failure message name a
 * variable the reader recognises, and keeping them means the message is
 * identical for the four cases anyone has actually hit.
 *
 * **This is NOT the prefix Ruling 3 point 3 forbids.** That rule is about
 * `vitest.config.ts` *injecting* environment names INTO the test process, which
 * must stay an explicit allow-list. Banning on a Vercel build and injecting
 * into vitest are opposite directions through different files —
 * `vitest.config.ts` even reasons about the near-miss `GOOGLE_VERTEX_PROJECT_ID`
 * that "the prefix match alone would" catch, and catching it is exactly what
 * should happen here.
 *
 * R-GUARD-2 is unaffected: only NAMES are collected, never values.
 */
const FORBIDDEN_PREFIXES_ON_VERCEL = ["GOOGLE_VERTEX_"];

function configuredForbiddenNames(env) {
  const explicit = FORBIDDEN_ON_VERCEL.filter((name) => isSet(env, name));
  const byPrefix = Object.keys(env).filter(
    (name) =>
      FORBIDDEN_PREFIXES_ON_VERCEL.some((prefix) => name.startsWith(prefix)) &&
      isSet(env, name),
  );
  // De-duplicated, and the explicit ones stay first so the message reads the
  // same way it always has for the four names that were already on the list.
  return Array.from(new Set([...explicit, ...byPrefix]));
}

/**
 * Build the whole report before failing. R-GUARD-1 says the message names
 * **every** missing and **every** forbidden variable, so this must not stop at
 * the first problem — a build that fails four times in a row, each naming one
 * more variable, is four wasted deploys.
 */
export function auditVercelEnv(env) {
  const missing = missingRequiredNames(env);
  const forbidden = configuredForbiddenNames(env);
  const forcedAiTier = Number(env.PEER_FEED_AI_TIER ?? "0");
  const tierForced = Number.isFinite(forcedAiTier) && forcedAiTier > 0;
  return {
    missing,
    forbidden: tierForced ? [...forbidden, "PEER_FEED_AI_TIER"] : forbidden,
    ok: missing.length === 0 && forbidden.length === 0 && !tierForced,
  };
}

export function formatAuditMessage({ missing, forbidden }) {
  const lines = ["Peer deployment blocked: the Vercel environment is wrong."];
  if (missing.length > 0) {
    lines.push(
      `Missing required settings: ${missing.join(", ")}.`,
      // 5-03 · D2a — this sentence used to say "an operator-funded model and
      // search key". The search half became false the day the owner removed
      // operator-funded search, and this is the only one of the file's four
      // stale sentences that a deployer actually reads.
      "Peer runs on an operator-funded model, and needs Supabase to know who a request is for.",
    );
  }
  if (forbidden.length > 0) {
    lines.push(
      `Remove these operator-funded AI settings from Vercel: ${forbidden.join(", ")}.`,
    );
  }
  lines.push(
    "Local .env.local credentials remain supported by `next dev`; this check only runs on a Vercel build.",
  );
  return lines.join("\n");
}

// The side effect. `src/scripts/assert-byok-production-env.test.ts` spawns this
// file as a child process with a controlled environment rather than importing
// it, so it exercises the real exit code and the real stderr — which is the only
// way to test a script whose contract *is* `process.exit(1)`.
if (isVercelBuild(process.env)) {
  const audit = auditVercelEnv(process.env);
  if (!audit.ok) {
    console.error(formatAuditMessage(audit));
    process.exit(1);
  }
}
