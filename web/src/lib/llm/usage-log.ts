// Tier-0 observability: one place to record what every LLM call actually cost.
//
// Providers call `logLlmUsage` after each request so we can see, per call, the
// model used, token counts (including hidden thinking/reasoning tokens where the
// API reports them), and wall-clock latency. This is the measurement layer the
// API-efficiency work is built on — you cannot claim a speed/token win you can't
// see.
//
// SAFETY: never log API keys, prompt/response text, private profile context, or
// image bytes. Only numeric counts + model ids.

export interface LlmUsage {
  provider: string;
  model: string;
  /** Logical call site, e.g. "digest", "rerank", "report:pass2", "figure:vision". */
  path?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Gemini "thoughts" / OpenAI "reasoning" tokens, when the API reports them. */
  thinkingTokens?: number;
  latencyMs: number;
  ok: boolean;
}

/** Emit a single compact line per LLM call. Safe to call in any runtime. */
export function logLlmUsage(u: LlmUsage): void {
  const parts = [
    `[llm] ${u.provider}/${u.model}`,
    u.path ? `path=${u.path}` : null,
    u.inputTokens != null ? `in=${u.inputTokens}` : null,
    u.outputTokens != null ? `out=${u.outputTokens}` : null,
    u.thinkingTokens ? `think=${u.thinkingTokens}` : null,
    `${Math.round(u.latencyMs)}ms`,
    u.ok ? "ok" : "ERR",
  ].filter(Boolean);
  console.log(parts.join(" "));
}

/** Milliseconds since an epoch marker; wrapper so call sites read cleanly. */
export function now(): number {
  return Date.now();
}

// P3-S5 — the Jev shadow's cost log (ABC-JEV-INTEGRATION.md §4 Round 3
// "P3-S5 DESIGN RULING"; docs/jev-abc/P3-B-20260924T0525Z.md §6). Additive,
// beside `logLlmUsage` above, and follows its EXACT contract: never log API
// keys, prompt/response text, or private profile context. Concretely: this
// type carries no per-user identity, no per-candidate identity or its text
// content, no user-declared free text, and no credential — only counts, a
// status code, and the ACTUAL echoed model id (empty string when the call
// degraded before any model id was ever echoed). `usage-log.test.ts` greps
// this file's own source for every one of those forbidden field names, the
// same structural guard the decision layer's other modules already use for
// their own leak tests.

/** One shadow-mode decision-call attempt's cost/outcome, safe to log verbatim. */
export interface DecisionUsageLog {
  /** Always `"typesafe"` today (`decisions/decision-cache.ts`'s `DECISION_CACHE_PROVIDER`) — kept as a field, not a hardcoded string, for shape parity with `LlmUsage`. */
  provider: string;
  /** The ACTUAL echoed Jev model id. Empty string when degraded (cache hit, or any non-"ok" broker/call status) — never a placeholder, never guessed. */
  model: string;
  /** Whether this attempt was answered from the decision cache without ever reaching the broker. */
  cacheHit: boolean;
  /** `"cache_hit"`, `"ok"`, or any `BrokerCallResult`/`JevCallResult` fault-kind status string (`decisions/broker-client.ts`/`decisions/jev-client.ts`). */
  status: string;
  inputTokens: number;
  /** Always 0 — Jev's output is free/uncosted; the field stays for shape parity with `LlmUsage`. */
  outputTokens: number;
  latencyMs: number;
}

/** Emit a single compact line per Jev shadow decision-call attempt. Safe to call in any runtime. */
export function logDecisionUsage(u: DecisionUsageLog): void {
  const parts = [
    `[decision] ${u.provider}${u.model ? `/${u.model}` : ""}`,
    `cache=${u.cacheHit ? "hit" : "miss"}`,
    `status=${u.status}`,
    `in=${u.inputTokens}`,
    `out=${u.outputTokens}`,
    `${Math.round(u.latencyMs)}ms`,
  ];
  console.log(parts.join(" "));
}
