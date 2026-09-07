import type { RawItem } from "@/lib/sources/types";
import {
  canonicalize,
  termMatches,
  termOccurrences,
  termSpecificity,
} from "./term-expand";

export interface KeywordResult {
  score: number;
  matched: string[];
}

type KeywordScope = "all" | "titleAndSummary";
type GateMetadata = RawItem["metadata"] & { gateText?: string };

function itemText(item: RawItem, scope: KeywordScope): string {
  const gateText = (item.metadata as GateMetadata).gateText ?? "";
  return canonicalize(
    [
      item.title,
      scope === "titleAndSummary" ? gateText : item.abstract ?? "",
      (item.tags ?? []).join(" "),
    ].join(" "),
  );
}

/**
 * How much a match is worth, by where the paper put the term.
 *
 * A paper that names a topic in its title is about it. A paper that names it
 * once, halfway through an abstract, is usually citing it as context — two of
 * today's candidates matched "protein structure prediction" on exactly this
 * sentence shape: "generative modeling, which has transformed prediction in
 * fields as diverse as weather forecasting and protein structure prediction,
 * holds the potential to forecast earthquake aftershocks". Both were ranked
 * as squarely on topic as the day's actual protein papers, because a match
 * was a match wherever it fell.
 *
 * A passing mention still counts — it is evidence, and the gate above stays
 * open — but it is not the same evidence as a title.
 */
function groundingWeight(item: RawItem, canonicalTopic: string): number {
  if (termMatches(canonicalize(item.title), canonicalTopic)) return 1;
  const tags = canonicalize((item.tags ?? []).join(" "));
  if (tags && termMatches(tags, canonicalTopic)) return 0.85;
  const body = canonicalize(item.abstract ?? "");
  const mentions = body ? termOccurrences(body, canonicalTopic) : 0;
  if (mentions >= 3) return 0.9;
  if (mentions === 2) return 0.7;
  return 0.4;
}

export function scoreKeyword(
  item: RawItem,
  topics: string[],
  opts: { scope?: KeywordScope; grounded?: boolean } = {},
): KeywordResult {
  if (topics.length === 0) return { score: 0, matched: [] };
  const haystack = itemText(item, opts.scope ?? "all");
  const matched: string[] = [];
  const seen = new Set<string>();
  let raw = 0;
  for (const topic of topics) {
    const canonicalTopic = canonicalize(topic);
    if (!canonicalTopic || seen.has(canonicalTopic)) continue;
    seen.add(canonicalTopic);
    if (termMatches(haystack, canonicalTopic)) {
      matched.push(topic);
      const grounding = opts.grounded ? groundingWeight(item, canonicalTopic) : 1;
      raw += termSpecificity(canonicalTopic) * grounding;
    }
  }
  return {
    score: Math.min(1, raw / 1.5),
    matched,
  };
}
