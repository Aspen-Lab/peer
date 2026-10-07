/**
 * What a log line may say about an error that came back from a model provider
 * (P5-06, §1h.19 (a)): its kind, and an HTTP status when it carries one. Never
 * its message, and never the error object itself.
 *
 * Why. A provider's SDK builds an error's message from the response body, and a
 * body can quote the request it answered; the request holds the reader's words
 * (the task text, an upload's title, a question, their own search brief). A
 * console line is a server log, shared with whoever runs the deployment, and
 * `AGENTS.md` keeps anything per-user out of it. `console.warn(..., err)` prints
 * the message and the stack, so a log of the error whole is a log of the prompt
 * whenever a provider echoes. The kind (`Error`, `ApiError`, `TypeError`) says
 * what went wrong in the owner's terms, and the status (400, 429, 503) says who
 * to blame; neither can carry the reader's text.
 *
 * The status is read from `status`, then `code`, and only when it is an integer
 * from 100 to 599. A string there could hold anything (an SDK may copy a
 * response field into it), and a number outside the range is not an HTTP status,
 * so neither is repeated.
 *
 * `deep-report.ts` and `figure-binding.ts` keep their own `err instanceof Error
 * ? err.name : typeof err`: they hold the same rule, pinned by their own tests.
 */
export function errorKind(err: unknown): string {
  const kind = err instanceof Error ? (typeof err.name === "string" && err.name ? err.name : "Error") : typeof err;
  if (typeof err !== "object" || err === null) return kind;
  const carried = err as { status?: unknown; code?: unknown };
  const status = httpStatus(carried.status);
  if (status !== undefined) return `${kind} status ${status}`;
  const code = httpStatus(carried.code);
  if (code !== undefined) return `${kind} code ${code}`;
  return kind;
}

function httpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}
