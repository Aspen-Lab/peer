// POST /api/ai/check-key — "Check key": does the provider accept the key the reader pasted?
//
// A reader who pastes a wrong key used to find out only when a report failed. This asks the
// provider once, with the smallest request each provider has (`testConnection`), and answers
// one word: "ok", "rejected" (the provider refused the key), "busy" (the provider is turning
// requests away for now) or "unreachable" (anything else, a timeout included).
//
// The request carries `{ provider, apiKey }` and nothing else is read from it. The key is used
// for this one request and kept by nothing: it is handed to the registry, which builds the
// provider around it, and the provider object is dropped when the handler returns.
//
// What a check must never do (/privacy, "Your own model key", pins each of these to this file):
//  - run before the shared sign-in and hourly-limit check. `requireAiRequest` comes first, so a
//    signed-out caller gets the shared 401 before any provider is built;
//  - answer with the provider's words. `testConnection` reports a failure as the provider's raw
//    error text, which can quote the request (OpenAI's 401 names part of the key it refused).
//    `checkProviderKey` reads it once to choose the word and the response carries only the word;
//  - write a log line. There is no console call in this file.
//
// The hourly limit is 10 checks per account (scope `key-check`): a check is a request on the
// reader's own key, and the limit is what keeps a loop from running it up.

import { NextRequest, NextResponse } from "next/server";
import { hasUsableProviderOverride, resolveProvider } from "@/lib/llm/providers/registry";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import { checkProviderKey, type KeyCheckResult } from "@/lib/llm/key-check";
import { requireAiRequest } from "@/lib/security/ai-request";

export const dynamic = "force-dynamic";
// One short request, cut off at 15 seconds by `checkProviderKey`.
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function invalidRequest(): NextResponse {
  return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
}

/** The two fields a check reads, and nothing else from the body. */
function overrideFrom(body: unknown): ProviderOverrideConfig | null {
  if (typeof body !== "object" || body === null) return null;
  const { provider, apiKey } = body as { provider?: unknown; apiKey?: unknown };
  if (typeof provider !== "string" || typeof apiKey !== "string") return null;
  const override = { provider, apiKey } as ProviderOverrideConfig;
  return hasUsableProviderOverride(override) ? override : null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const gate = await requireAiRequest("key-check", 10);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidRequest();
  }
  const override = overrideFrom(body);
  if (!override) return invalidRequest();

  const provider = resolveProvider(override);
  if (!provider) return invalidRequest();

  const result: KeyCheckResult = await checkProviderKey(provider);
  return NextResponse.json({ result }, { headers: NO_STORE });
}
