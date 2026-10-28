import type { DigestProvider } from "./providers/types";

/**
 * "Check key": does the provider accept the key a reader pasted?
 *
 * The route (`app/api/ai/check-key/route.ts`) asks the provider built from the
 * request's own key for one short request (`testConnection`) and answers with
 * one of these six words, and nothing else:
 *
 *  - `ok`: the provider accepted the request (an empty answer included);
 *  - `rejected`: it refused the key;
 *  - `no-credit`: it accepted the key but says the account cannot pay;
 *  - `busy`: its own rate limit turned the request away for now;
 *  - `unreachable`: no answer came back (a timeout, a network failure, a thrown
 *    error) or the provider failed on its side (5xx), so trying later may help;
 *  - `error`: any other answer from the provider (a model this key cannot use, a
 *    region the provider does not serve), which trying again will not change.
 *
 * Every provider's `testConnection`
 * reports a failure as `String(err)`, the raw error text of the provider's SDK or
 * HTTP body, which can quote the request it answered (OpenAI's 401 names the
 * first and last characters of the key it refused). That text is read here, once,
 * to choose a word, and goes no further: no response carries it and nothing logs
 * it.
 *
 * Kept out of the route file because a route module may export only its
 * handlers.
 */
export type KeyCheckResult = "ok" | "rejected" | "no-credit" | "busy" | "unreachable" | "error";

/** Every word the route can answer, for a client that checks what it got. */
export const KEY_CHECK_RESULTS: readonly KeyCheckResult[] = [
  "ok",
  "rejected",
  "no-credit",
  "busy",
  "unreachable",
  "error",
];

/** How long a check may take before it is answered "unreachable". */
export const KEY_CHECK_TIMEOUT_MS = 15_000;

/**
 * Where each provider puts the HTTP status in the text `testConnection` returns.
 *
 *  - OpenAI, Qwen and DeepSeek (plain `fetch`): `Error: OpenAI API error 401: {…}`.
 *  - Anthropic (`@anthropic-ai/sdk`, whose errors keep the name `Error`):
 *    `Error: 401 {"type":"error","error":{"type":"authentication_error",…}}`.
 *  - Gemini (`@google/genai` `ApiError`, whose message is the JSON body):
 *    `ApiError: {"error":{"code":400,"message":"API key not valid. …",…}}`.
 */
const STATUS_PATTERNS: readonly RegExp[] = [
  /\bAPI error (\d{3})\b/,
  /^(?:[A-Za-z]*Error:\s*)?(\d{3})\b/,
  /"code"\s*:\s*(\d{3})\b/,
];

/**
 * Words that mean the provider refused the key itself, whatever the status. Gemini
 * answers a key it does not know with 400 INVALID_ARGUMENT, not 401, so the
 * reason (`API_KEY_INVALID`) and the message ("API key not valid") are what say so.
 */
const REJECTED_PATTERNS: readonly RegExp[] = [
  /\bunauthori[sz]ed\b/i,
  /\bUNAUTHENTICATED\b/,
  /\bpermission[ _-]?denied\b/i,
  /\bpermission_error\b/,
  /\bauthentication[ _-]?(?:error|fails?|failed)\b/i,
  /\b(?:invalid|incorrect)[ _-](?:x-)?api[ _-]?key\b/i,
  /\bapi[ _-]?key (?:not valid|is invalid|expired)\b/i,
  /\bAPI_KEY_INVALID\b/,
];

/**
 * Words that mean the key is good but the account cannot pay. Read before any
 * status, because OpenAI and Qwen send this as a 429, which would otherwise read
 * as a rate limit, and Anthropic and Qwen send it as a 400:
 *
 *  - OpenAI and Qwen: the error code `insufficient_…` (429);
 *  - DeepSeek: "Insufficient Balance" (402, caught by the status);
 *  - Anthropic: "Your credit balance is too low to access the Anthropic API." (400);
 *  - Qwen (DashScope): the code `Arrearage`, an overdue account (400).
 */
const NO_CREDIT_PATTERNS: readonly RegExp[] = [
  /insufficient_\w+/i,
  /credit balance is too low/i,
  /\bArrearage\b/,
];

/** Words that mean the provider's own rate limit is turning requests away for now. */
const BUSY_PATTERNS: readonly RegExp[] = [
  /\brate[ _-]?limit/i,
  /\bRESOURCE_EXHAUSTED\b/,
  /\btoo many requests\b/i,
];

function statusIn(text: string): number | undefined {
  for (const pattern of STATUS_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/**
 * The word for a failed check, from the provider's error text. Pure, and total,
 * in this order: no credit first (whatever the status), then a refused key
 * (401, 403, or the words), then the provider's rate limit (429, or the words),
 * then "unreachable" for no status at all (a timeout, a network failure, no text)
 * or a failure on the provider's side (5xx, or 408), and "error" for any other
 * answer the provider gave.
 */
export function classifyKeyCheckError(errorText: unknown): Exclude<KeyCheckResult, "ok"> {
  if (typeof errorText !== "string" || errorText === "") return "unreachable";
  const status = statusIn(errorText);
  if (status === 402 || NO_CREDIT_PATTERNS.some((pattern) => pattern.test(errorText))) return "no-credit";
  if (status === 401 || status === 403) return "rejected";
  if (status === 429) return "busy";
  if (REJECTED_PATTERNS.some((pattern) => pattern.test(errorText))) return "rejected";
  if (BUSY_PATTERNS.some((pattern) => pattern.test(errorText))) return "busy";
  if (status === undefined || status >= 500 || status === 408) return "unreachable";
  return "error";
}

/**
 * Run one `testConnection` under a time limit and answer with a word. Never
 * throws and never returns the provider's text: a throw, a timeout or an answer
 * of an unexpected shape is "unreachable". A request still running when the time
 * is up is left to finish on its own; its answer is ignored.
 */
export async function checkProviderKey(
  provider: Pick<DigestProvider, "testConnection">,
  timeoutMs: number = KEY_CHECK_TIMEOUT_MS,
): Promise<KeyCheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  try {
    const outcome = await Promise.race([provider.testConnection(), timedOut]);
    if (outcome === "timed-out" || typeof outcome !== "object" || outcome === null) return "unreachable";
    return outcome.ok === true ? "ok" : classifyKeyCheckError(outcome.error);
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
