import type { PaperReport } from "@/lib/papers/report";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";

export type StageId = "source" | "reading" | "writing" | "figures" | "done";

export type ReportStreamEvent =
  | { type: "mode"; aiMode: "tier0" | "tier1" | "tier2" }
  | { type: "stage"; stage: StageId; label: string; pct: number }
  | { type: "report"; report: PaperReport }
  /**
   * ABC-freemium 3-03 · R-QUOTA-1 · Ruling 9 points 1-2 — **the refusal the
   * stream had no way to say.**
   *
   * Deep papers reports were never counted, because the streaming branch
   * returned above the route's only counter and the client always streams. The
   * counter now runs above the transport branch, which means a refusal has to
   * survive the streamed transport too. It arrives **before** the `mode` event,
   * because the degraded stream that follows is an ordinary tier-1 or tier-0
   * stream and must stay readable exactly as it is.
   *
   * The reader still gets their complete deterministic report; this is the
   * notice beside it, not instead of it.
   */
  | { type: "quota"; quota: QuotaSignal }
  | { type: "error"; message: string };

const NDJSON_CONTENT_TYPE = "application/x-ndjson";

export async function* streamPaperReport(
  requestBody: unknown,
  signal: AbortSignal,
): AsyncGenerator<ReportStreamEvent> {
  const response = await fetch("/api/papers/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: NDJSON_CONTENT_TYPE,
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`report stream HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes(NDJSON_CONTENT_TYPE)) {
    throw new Error(
      `report stream unsupported content type: ${contentType || "missing"}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullyRead = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        fullyRead = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          yield JSON.parse(line) as ReportStreamEvent;
        }
      }
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      yield JSON.parse(tail) as ReportStreamEvent;
    }
  } finally {
    if (!fullyRead) {
      try {
        await reader.cancel();
      } catch {
        // Abort/cancellation may already have closed the response body.
      }
    }
    reader.releaseLock();
  }
}
