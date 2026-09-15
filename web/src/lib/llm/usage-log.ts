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

import { recordUsageEvent } from "@/lib/usage/events";
import { currentUsageContext } from "@/lib/usage/context";

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

  // ABC-freemium 1-03 · R-METER-1 — the same facts, persisted. The console line
  // above is unchanged byte for byte: it is the API-efficiency measurement layer
  // this file's header describes and removing it would delete an unrelated
  // capability.
  //
  // This is where the row is written rather than in the wrapper, because this is
  // where the token counts are. The wrapper supplies the half this function
  // cannot know — which user, and whose key — through an async-local scope, and
  // is told a row exists so it does not write a second one.
  const ctx = currentUsageContext();
  if (ctx) ctx.recorded = true;
  recordUsageEvent({
    user_id: ctx?.userId ?? null,
    kind: "llm",
    path: u.path ?? ctx?.path ?? null,
    provider: u.provider,
    model: u.model,
    input_tokens: u.inputTokens ?? null,
    output_tokens: u.outputTokens ?? null,
    thinking_tokens: u.thinkingTokens ?? null,
    latency_ms: Math.round(u.latencyMs),
    ok: u.ok,
    // Null, not false, when there is no scope: "not known" is honest and a
    // wrong `false` would read as "the operator paid for this".
    byok: ctx ? ctx.byok : null,
  });
}

/** Milliseconds since an epoch marker; wrapper so call sites read cleanly. */
export function now(): number {
  return Date.now();
}
