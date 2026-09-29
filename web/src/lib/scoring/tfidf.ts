import type { RawItem } from "@/lib/sources/types";
import { tokenize } from "./tokenize";

type TermVector = Map<string, number>;

function termFrequency(tokens: string[]): TermVector {
  const tf: TermVector = new Map();
  if (tokens.length === 0) return tf;
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, c] of tf) tf.set(t, c / tokens.length);
  return tf;
}

function buildIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  const N = Math.max(docs.length, 1);
  for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 1)) + 1);
  return idf;
}

function toTfidf(tf: TermVector, idf: Map<string, number>): TermVector {
  const out: TermVector = new Map();
  for (const [t, f] of tf) {
    const w = idf.get(t);
    if (w !== undefined) out.set(t, f * w);
  }
  return out;
}

function cosine(a: TermVector, b: TermVector): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  const smaller = a.size < b.size ? a : b;
  const larger = a.size < b.size ? b : a;
  for (const [t, v] of smaller) {
    const u = larger.get(t);
    if (u !== undefined) dot += v * u;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function itemDocText(item: RawItem): string {
  return [item.title, item.abstract ?? "", (item.tags ?? []).join(" ")].join(
    " ",
  );
}

export interface TfidfIndex {
  idf: Map<string, number>;
  itemVectors: Map<string, TermVector>;
}

/**
 * `tokenizeFn` defaults to the real, plural-blind `tokenize` so every
 * existing caller (this file's own pool-wide topicality index, jobs/events
 * scoring) is byte-for-byte unaffected. TOKENIZE-PLURALS (ABC-JEV-INTEGRATION.md
 * §1be point 5, Option B split) passes `tokenizeFolded` here ONLY to build
 * combine.ts's second, parallel T4 index — never the shared one every
 * scored item's topicality comes from.
 */
export function buildIndex(items: RawItem[], tokenizeFn: (text: string) => string[] = tokenize): TfidfIndex {
  const docs = items.map((i) => tokenizeFn(itemDocText(i)));
  const idf = buildIdf(docs);
  const itemVectors = new Map<string, TermVector>();
  items.forEach((item, i) => {
    const tf = termFrequency(docs[i]);
    itemVectors.set(item.id, toTfidf(tf, idf));
  });
  return { idf, itemVectors };
}

export function scoreTfidf(
  itemId: string,
  profileText: string,
  index: TfidfIndex,
  tokenizeFn: (text: string) => string[] = tokenize,
): number {
  const itemVec = index.itemVectors.get(itemId);
  if (!itemVec) return 0;
  const profileTf = termFrequency(tokenizeFn(profileText));
  const profileVec = toTfidf(profileTf, index.idf);
  return cosine(itemVec, profileVec);
}
