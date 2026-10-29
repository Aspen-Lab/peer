/**
 * The provider accepted the request (HTTP 200) and sent back no text.
 *
 * The OpenAI, Qwen and DeepSeek call functions throw this where they used to throw a
 * plain `Error` with the same message. Its `name` stays "Error" (it sets none of its
 * own), so every caller, log line and `String(err)` sees exactly what it always did.
 * Only `testConnection` reads the class: for "Check key" an empty answer still means
 * the provider took the key, so the check is `{ ok: true }`.
 */
export class EmptyAnswerError extends Error {}
