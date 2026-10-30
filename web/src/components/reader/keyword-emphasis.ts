import type { MathRun } from "@/lib/text/math";

const TITLE_BREAKS = /[,:;.!?()[\]{}]|\b(?:a|an|and|as|at|by|for|from|in|into|of|on|or|the|to|with|using|via)\b/giu;
const WORD = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;
const GENERIC = new Set(["research", "study", "analysis", "method", "methods", "approach", "model", "models", "data", "results", "based", "new", "novel"]);

/** Prefer the paper's supplied terms; title pairs are a fallback when sources provide only broad categories. */
export function paperKeywords(title: string, supplied: readonly string[]): string[] {
  const candidates = [...supplied];
  for (const part of title.split(TITLE_BREAKS)) {
    const words = part.match(WORD) ?? [];
    for (let i = 0; i + 1 < words.length; i++) {
      if (words[i].length < 3 || words[i + 1].length < 3) continue;
      if (GENERIC.has(words[i].toLowerCase()) || GENERIC.has(words[i + 1].toLowerCase())) continue;
      candidates.push(`${words[i]} ${words[i + 1]}`);
    }
  }
  const seen = new Set<string>();
  return candidates.map((word) => word.trim().replace(/\s+/g, " ")).filter((word) => {
    const key = word.toLocaleLowerCase();
    if (word.length < 4 || word.length > 60 || GENERIC.has(key) || seen.has(key) || !/[\p{L}]/u.test(word)) return false;
    seen.add(key);
    return true;
  }).slice(0, 16);
}

/** One whole-word match per paragraph, only in prose, never inside TeX. */
export function firstKeyword(runs: readonly MathRun[], keywords: readonly string[]): { run: number; start: number; end: number } | null {
  for (let run = 0; run < runs.length; run++) {
    if (runs[run].kind !== "text") continue;
    const text = runs[run].value;
    let best: { run: number; start: number; end: number } | null = null;
    for (const keyword of keywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      const match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").exec(text);
      if (!match) continue;
      const start = match.index, end = start + match[0].length;
      if (!best || start < best.start || (start === best.start && end > best.end)) best = { run, start, end };
    }
    if (best) return best;
  }
  return null;
}

/** Author–year citations in extracted prose, without interpreting numerical data as references. */
export function citationRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const parenthetical = /\([^()\n]{1,160}\)/gu;
  for (const match of text.matchAll(parenthetical)) {
    const value = match[0];
    if (!/\b(?:1[89]|20)\d{2}[a-z]?\b/i.test(value) || !/\b[A-Z][\p{L}'’-]{1,}/u.test(value) || /=/.test(value)) continue;
    if (/^\(\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s*\)$/i.test(value)) continue;
    ranges.push({ start: match.index, end: match.index + value.length });
  }
  // Bracketed positive reference numbers; exclude zero-based intervals.
  const numbered = /\[\s*[1-9]\d{0,3}(?:\s*[,–-]\s*[1-9]\d{0,3})*\s*\]/gu;
  for (const match of text.matchAll(numbered)) ranges.push({ start: match.index, end: match.index + match[0].length });
  const narrative = /\b[\p{Lu}][\p{L}'’.\-]+(?:\s+(?:et\s+al\.?|(?:and|&)\s+[\p{Lu}][\p{L}'’.\-]+))?\s*\(\s*(?:1[89]|20)\d{2}[a-z]?\s*\)/gu;
  for (const match of text.matchAll(narrative)) ranges.push({ start: match.index, end: match.index + match[0].length });
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end).filter((range, i, all) => i === 0 || range.start >= all[i - 1].end);
}
