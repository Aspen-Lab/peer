// LIVE-EVAL-4 (guide Finding C3) — one-time OpenAlex topic-id resolution for
// the live-channels runner. As of this slice, no production code path
// resolves a real OpenAlex topic id at all (`sources/openalex-topic.ts`'s own
// header comment) — this file is the first real caller, so it must supply an
// id itself rather than reuse a production helper that doesn't exist yet.
//
// Injectable fetch function so the offline test never makes a real network
// call — real callers omit `fetchImpl` and get the global `fetch`.

import { searchHttpFailure } from "@/lib/sources/search-failure";

export interface TopicResolution {
  /** Bare "T12345"-style id of the top hit, or undefined on a genuine zero-result response. */
  topicId?: string;
}

const OPENALEX_TOPICS_API = "https://api.openalex.org/topics";

/** Bare a "T12345" or full "https://openalex.org/T12345" id down to "T12345". */
function bareTopicId(id: string): string {
  const trimmed = id.trim();
  return trimmed.split("/").pop() ?? trimmed;
}

export interface ResolveTopicIdOptions {
  fetchImpl?: typeof fetch;
  mailto?: string;
  authHeaders?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * One OpenAlex topics search call for `topic` (an input's primary topic
 * string) — cost class **search**, $1/1k calls, the one paid call in the
 * whole resolution phase (guide §1t.3b). Throws on a real HTTP failure
 * (network error or non-2xx) — the same "throw on failure, resolve only for
 * a genuine empty result" contract every adapter in this codebase already
 * follows (`search-failure.ts`), so `call-budget.ts`'s `trackedCall` can
 * classify a 429 from the thrown message. A genuine 200-with-zero-results
 * resolves `{ topicId: undefined }`, never a thrown error — the caller (the
 * runner) reports the topic role as "not_run" for that input either way, but
 * only a real failure should ever look like one to the budget/stop-rule
 * layer. The caller decides whether `topic` is even worth calling for; a
 * blank string is never passed to this function.
 */
export async function resolveTopicId(
  topic: string,
  opts: ResolveTopicIdOptions = {},
): Promise<TopicResolution> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    search: topic,
    per_page: "1",
    mailto: opts.mailto ?? "peer@example.com",
  });

  const res = await fetchImpl(`${OPENALEX_TOPICS_API}?${params}`, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 7000),
    ...(opts.authHeaders ? { headers: opts.authHeaders } : {}),
  });
  if (!res.ok) {
    throw await searchHttpFailure("openalex-topic-resolution", res);
  }
  const data = (await res.json()) as { results?: { id?: string }[] };
  const top = data.results?.[0];
  return top?.id ? { topicId: bareTopicId(top.id) } : { topicId: undefined };
}
