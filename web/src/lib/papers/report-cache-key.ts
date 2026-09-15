import type { AiMode } from "@/lib/feed/ai-tier";

/**
 * The browser-side cache key for a paper report.
 *
 * ABC-freemium 1-11 · R-UI-4. Ships in the same commit as R-KEY-1 (Ruling 1
 * point 7) because otherwise the poisoning below goes live silently.
 *
 * **The harm this closes, traced rather than assumed.** `finishWithReport`
 * writes the report **unconditionally** — the `reveal` argument controls the
 * animation, not the write — so a `noLlm: true` report **is** cached, under the
 * fallback TTL of six hours. Every component of the old key
 * (`id|context|deep=…|p=…|byok=…`) is constant across the deploy that turns the
 * system key on for a non-BYOK reader. So a report computed with **no model**
 * would have been served as **the AI report** for six hours after Peer's own AI
 * went live.
 *
 * The fix is one more segment carrying which model, if any, produced the answer.
 *
 * **The storage version is bumped in the same commit, and that is not
 * belt-and-braces.** A key change alone leaves every *existing* entry readable
 * under its own old key, so the poisoned reports would survive the fix. `-v3` to
 * `-v4` orphans them; the `-v3` suffix is this codebase's own precedent for
 * exactly this move.
 */
export const PAPER_REPORT_CACHE_STORAGE_KEY = "peer-paper-report-cache-v4";

export function paperReportCacheKey(input: {
  paperId: string;
  contextHint: string;
  deepReportRequested: boolean;
  feedAiProvider: string;
  userProviderConfigured: boolean;
  aiMode: AiMode;
}): string {
  return [
    input.paperId,
    input.contextHint,
    `deep=${input.deepReportRequested}`,
    `p=${input.feedAiProvider}`,
    `byok=${input.userProviderConfigured}`,
    `ai=${input.aiMode}`,
  ].join("|");
}
