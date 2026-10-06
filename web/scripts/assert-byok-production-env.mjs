// ABC-freemium 1-10 · R-GUARD-1, R-GUARD-2.
//
// This script is wired as `prebuild`, so it is the last thing standing between a
// misconfigured Vercel project and a silently wrong deployment.
//
// **Peer holds no model key of its own.** A reader's AI runs on the key they
// paste into the app, so a model key on the deployment is a company credential
// that nothing may use: it used to be EXPECTED here (the system default model),
// and it is now FORBIDDEN, the same as every other server-side provider key.
//
// Two lists, both checked on a Vercel build: the Supabase names that are
// REQUIRED, and the operator-funded names that are FORBIDDEN.
//
// **R-GUARD-2 — the message may name variables and must NEVER print a value.**
// The obvious way to write the "missing" half is `Missing: NAME=${env[NAME]}`,
// which prints an empty string today and a live key the day someone sets a
// wrong-cased variant. Nothing below indexes `env` for output; `problems` and
// `missing` hold names filtered from literal arrays. `src/scripts/…test.ts`
// asserts it with a sentinel.

/**
 * What a deployment cannot do without: the server must be able to tell who a
 * request is for (sign-in, the synced profile, the per-account rate limit).
 *
 * **ABC-freemium 5-03 · D2a (Ruling 12): `TAVILY_API_KEY` was once required
 * here** and moved to the banned list below, next to `BRAVE_SEARCH_API_KEY`: a
 * server search key on a deployment is money nobody meant to spend.
 */
const REQUIRED_ON_VERCEL = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

/**
 * Operator-funded settings that must never reach a deployment.
 *
 * **`GOOGLE_API_KEY` IS FORBIDDEN HERE — owner, 2026-10-06 ("I want to cut the
 * company API path").** It was the system default model for every signed-in
 * reader and was EXPECTED on a deployment; nothing reads it now, and a
 * deployment that still carries it is a company credential sitting where no
 * code uses it. **A Vercel project that still has the variable set will FAIL the
 * build** — by design, the same as `TAVILY_API_KEY` before it; remove it from
 * the project's environment variables (every environment) before deploying.
 * `BRAVE_SEARCH_API_KEY` is the same kind of risk: D2a keeps Brave env-only and
 * local.
 *
 * **5-03 · D2a — `TAVILY_API_KEY` joined them, coming the other way off the
 * required list.** The operator funds no search for anyone on any plan, so the
 * server never reads it and a deployment that carries it can only be a mistake
 * or a leak. **A Vercel project that still has the variable set will now FAIL
 * the build** — by design; the variable must be removed before deploying.
 *
 * **Owner, 2026-10-06 — `JEV_API_KEY` and `PEER_JEV_BROKER_SECRET` JOIN THEM.**
 * Jev is no longer a company key. It was ALLOWED and SILENT here (JEV-DIRECT
 * §1aa, manager ruling §1ab P1: the company's Jev key lived in Vercel on
 * purpose, and Peer called Jev with it for readers). The owner cut every
 * company-API path; Jev is now a bring-your-own-key option, like a model key:
 * the reader applies for a Jev key, pastes it into their profile, and the
 * browser sends it with the paper request. Nothing reads `JEV_API_KEY` any more
 * (`src/lib/security/spend-scans.test.ts` scan 7 asserts it), and the broker
 * whose secret `PEER_JEV_BROKER_SECRET` was is deleted. **A Vercel project that
 * still has either variable set will FAIL the build** — by design, the same as
 * `GOOGLE_API_KEY` and `TAVILY_API_KEY` before them; remove them (every
 * environment) before deploying. The other `PEER_JEV_*` names are inert (nothing
 * reads them), so they do not fail a build.
 */
const FORBIDDEN_ON_VERCEL = [
  // The company's own model key. Peer has none; readers bring theirs.
  "GOOGLE_API_KEY",
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
  // Owner, 2026-10-06 — Jev is the reader's own key now. See the paragraph
  // above: a Jev key or a broker secret on the deployment is a company
  // credential nothing may use.
  "JEV_API_KEY",
  "PEER_JEV_BROKER_SECRET",
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

/** Names only, never a value — R-GUARD-2 applies to this message too. */
export function formatAuditMessage({ missing, forbidden }) {
  const lines = ["Peer deployment blocked: the Vercel environment is wrong."];
  if (missing.length > 0) {
    lines.push(
      `Missing required settings: ${missing.join(", ")}.`,
      "Peer needs Supabase to know who a request is for.",
    );
  }
  if (forbidden.length > 0) {
    lines.push(
      `Remove these operator-funded AI settings from Vercel: ${forbidden.join(", ")}.`,
      "Peer holds no model key of its own: readers add theirs in the app, and a key on the deployment is a company credential nothing may use.",
    );
    if (forbidden.some((name) => name.startsWith("JEV_") || name.startsWith("PEER_JEV_"))) {
      lines.push(
        "A Jev key is the reader's too: they paste it into their profile, and Peer passes it to Jev only while it screens their papers.",
      );
    }
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
