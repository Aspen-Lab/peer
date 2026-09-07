import type { RawItem } from "@/lib/sources/types";
import { SCORING_FALLBACK_REASON } from "@/lib/reader/recommendation";
import type { ScoreBreakdown } from "./types";

function formatRelativeDate(publishedAt: string, now = Date.now()): string {
  if (!publishedAt) return "";
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return "";
  const days = Math.max(0, Math.floor((now - t) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? "" : "s"} ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)}y+ ago`;
}

function formatList(items: string[], max = 3): string {
  const picked = items.slice(0, max);
  if (picked.length === 0) return "";
  if (picked.length === 1) return picked[0];
  if (picked.length === 2) return `${picked[0]} and ${picked[1]}`;
  return `${picked.slice(0, -1).join(", ")}, and ${picked[picked.length - 1]}`;
}

export function generateReason(
  item: RawItem,
  matchedKeywords: string[],
  breakdown: ScoreBreakdown,
): string {
  const parts: string[] = [];

  if (matchedKeywords.length > 0) {
    parts.push(`Matches your interest in ${formatList(matchedKeywords)}.`);
  } else if (breakdown.tfidf > 0.2) {
    parts.push("Semantically close to your profile.");
  }

  const meta: string[] = [];
  if (item.metadata.citationCount && item.metadata.citationCount >= 5) {
    meta.push(`${item.metadata.citationCount.toLocaleString()} citations`);
  }
  if (item.metadata.hnScore && item.metadata.hnScore >= 50) {
    meta.push(`${item.metadata.hnScore} points on HN`);
  }
  const when = formatRelativeDate(item.publishedAt);
  if (when) meta.push(when);

  if (meta.length > 0) parts.push(`${meta.join(" · ")}.`);

  if (parts.length === 0) {
    parts.push(SCORING_FALLBACK_REASON);
  }

  return parts.join(" ");
}
