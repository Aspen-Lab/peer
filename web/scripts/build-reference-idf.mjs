#!/usr/bin/env node
/**
 * Builds web/src/lib/scoring/reference-idf.json — the pool-independent reference IDF
 * (inverse document frequency) table SENSE-CONTEXT's context-agreement gate uses
 * (ABC-JEV-INTEGRATION.md §1ap AMENDMENT 4, ruling 2). Off the request path: never
 * imported by product code, never run automatically, no schedule of any kind. Run it
 * BY HAND when web/src/lib/scoring/tokenize.ts's tokenizer changes, or about once a
 * year otherwise (this kind of vocabulary drift is slow — a new abbreviation or
 * subfield emerging takes far longer than a year to matter).
 *
 * TO REBUILD BY HAND:
 *   node scripts/build-reference-idf.mjs
 * then commit the regenerated web/src/lib/scoring/reference-idf.json.
 *
 * SOURCE: OpenAlex only (https://openalex.org) — a CC0-licensed (public domain)
 * dataset Peer already calls at runtime for retrieval, so this reuses an existing,
 * already-cleared source rather than adding a new one. Every call is keyless: no
 * `api_key` and no `email`/`mailto` parameter (never reads web/.env/.env.local or any
 * API key). Samples a fixed-seed, stratified set of real works WITH English abstracts
 * across EVERY one of OpenAlex's own top-level fields (discovered fresh each run via
 * `works?group_by=primary_topic.field.id`, rather than a hardcoded list, so a future
 * change to OpenAlex's own taxonomy is picked up automatically) — one
 * `sample=&seed=&per_page=` call per field. `language:en` is in the filter because an
 * early trial run (no language filter) returned Chinese-language results on its very
 * first page for a field named "Engineering"; the runtime context text this table is
 * compared against is always English academic prose, so a multilingual sample would
 * spend real vocabulary budget on tokens that could never be matched, without
 * meaningfully improving IDF quality (most non-English "tokens" are also unique per
 * document and would mostly be dropped by the <2-documents rule below anyway).
 *
 * WHAT IT SHIPS: ONLY the derived {token: weight} table — no titles, abstracts, ids,
 * or other source text (fetched text is discarded immediately after tokenizing each
 * document; nothing textual is written to disk by this script). Tokens are produced
 * by a verbatim copy of `tokenize.ts`'s own tokenizer (see the "TOKENIZER PORT"
 * section below) so build-time and request-time tokenization agree; a vitest test
 * (web/src/lib/scoring/reference-idf-build.test.ts) imports BOTH this script's
 * tokenizer and the real shipped one and asserts they produce identical tokens on a
 * fixed sample — a drift tripwire that fails the test suite the moment the two ever
 * diverge, rather than relying on this comment alone. (This project's other
 * `scripts/*.mjs` files are plain Node ESM with no TypeScript runner configured — no
 * tsx/ts-node dependency, no npm script that runs a .ts file directly — so this
 * script keeps that same plain-Node convention and leans on the drift tripwire
 * instead of importing the .ts source directly.) The IDF formula
 * (`log((N+1)/(d+1))+1`) is copied from `tfidf.ts`'s own private `buildIdf` the same
 * way. Tokens seen in fewer than 2 sampled documents are dropped; a token the shipped
 * table has never seen falls back, at the call site, to the table's own maximum
 * weight (computed from the table itself at load time — nothing extra is stored for
 * this).
 *
 * SIZE: target <=300KB (keeps the table a small, fast-to-parse server-side asset).
 * Fetches a generous per-field sample once (network calls are the scarce, budgeted
 * resource — see MAX_CALLS below), keeps only TOKENIZED per-document arrays in
 * memory, then — with ZERO further network calls — rebuilds the table at a shrinking
 * per-field document cap until the JSON fits, reporting every step tried. Prints
 * COUNTS ONLY (fields, documents, tokens, bytes) — never any fetched text.
 *
 * LICENCE: OpenAlex's metadata (including `abstract_inverted_index`, the reconstructed
 * abstract text) is CC0. Only a derived, aggregate, non-reconstructable numeric
 * statistic (token -> float) is shipped; no source title/abstract text is retained
 * past this build. Whether a written legal sign-off is wanted before shipping this
 * static snapshot (vs. the product's existing per-request, non-persisted OpenAlex
 * use) is a product/legal call, not resolved by running this script.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "src", "lib", "scoring", "reference-idf.json");

// ── TOKENIZER PORT (verbatim copy of web/src/lib/scoring/tokenize.ts's `tokenize`,
// same STOPWORDS set, same regex, same length/stopword filter) — exported so the
// vitest drift tripwire (reference-idf-build.test.ts) can import and compare it
// directly against the real shipped tokenizer. ──
const STOPWORDS = new Set([
  "the", "a", "an", "of", "is", "are", "was", "were", "be", "been", "being",
  "and", "or", "but", "for", "nor", "so", "yet", "to", "from", "in", "on",
  "at", "by", "with", "as", "into", "onto", "upon", "over", "under",
  "this", "that", "these", "those", "it", "its", "their", "there",
  "we", "our", "you", "your", "they", "them", "he", "she", "him", "her",
  "have", "has", "had", "do", "does", "did", "can", "could", "may", "might",
  "shall", "should", "will", "would", "must", "not", "no",
  "paper", "study", "work", "propose", "show", "present", "using", "based",
]);
export function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// ── IDF FORMULA PORT (verbatim copy of tfidf.ts's private `buildIdf` formula) —
// split into df-collection and idf-derivation so the size-control ladder below can
// recompute idf for a smaller effective N without re-tokenizing anything. ──
function collectDf(tokenizedDocs) {
  const df = new Map();
  for (const doc of tokenizedDocs) {
    const seen = new Set(doc);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}
function idfFromDf(df, N) {
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 1)) + 1);
  return idf;
}

function reconstructAbstract(index) {
  if (!index) return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words.push([pos, word]);
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, w]) => w).join(" ");
}

const SEED = 20260928; // fixed -- any constant works; dated to the build that shipped
// the current table for traceability. Change this only if you deliberately want a
// DIFFERENT sample the next time this script runs (rebuild, not incremental update).
const PER_FIELD_TARGET = 150;
const MAX_CALLS = 40; // ABC-JEV-INTEGRATION.md §1ap AMENDMENT 4 ruling 2's ceiling.

let calls = 0;
const callLog = [];

async function budgetedFetch(url, label) {
  if (calls >= MAX_CALLS) {
    throw new Error(`STOP: call budget (${MAX_CALLS}) exhausted before "${label}".`);
  }
  calls++;
  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": "PeerReferenceIdfBuild/1.0 (+SENSE-CONTEXT, offline reference-corpus build, no key/email)" } });
  } catch (err) {
    callLog.push({ n: calls, label, status: "network-error" });
    throw new Error(`STOP: network error on call ${calls} (${label}): ${err}`);
  }
  callLog.push({ n: calls, label, status: res.status, ms: Date.now() - startedAt });
  if (!res.ok) {
    throw new Error(`STOP: HTTP ${res.status} ${res.statusText} on call ${calls}/${MAX_CALLS} (${label}).`);
  }
  return res.json();
}

async function main() {
  console.log(`SENSE-CONTEXT reference-IDF build. seed=${SEED} perFieldTarget=${PER_FIELD_TARGET} maxCalls=${MAX_CALLS}`);

  // 1. Discover OpenAlex's current field taxonomy fresh (id + display name), no
  // key/email -- avoids a hardcoded field list going stale if OpenAlex's own
  // taxonomy ever changes.
  const discovery = await budgetedFetch("https://api.openalex.org/works?group_by=primary_topic.field.id", "field-discovery");
  const fields = (discovery.group_by ?? [])
    .filter((g) => g.key && g.key_display_name && g.count > 0)
    .map((g) => ({ id: g.key, name: g.key_display_name }));
  console.log(`Discovered ${fields.length} fields.`);
  if (fields.length === 0) throw new Error("STOP: field discovery returned zero usable fields.");
  if (fields.length + 1 > MAX_CALLS) throw new Error(`STOP: ${fields.length} fields would exceed the ${MAX_CALLS}-call budget with the discovery call.`);

  // 2. One sample call per field.
  const perFieldDocs = [];
  for (const field of fields) {
    const params = new URLSearchParams({
      filter: `primary_topic.field.id:${field.id},has_abstract:true,language:en`,
      sample: String(PER_FIELD_TARGET),
      seed: String(SEED),
      per_page: String(PER_FIELD_TARGET),
      select: "title,abstract_inverted_index",
    });
    const data = await budgetedFetch(`https://api.openalex.org/works?${params}`, `field:${field.name}`);
    const results = data.results ?? [];
    const tokenSets = [];
    for (const w of results) {
      const abstract = reconstructAbstract(w.abstract_inverted_index);
      if (!w.title || !abstract) continue; // "works WITH abstracts" only
      const toks = tokenize([w.title, abstract].join(" "));
      if (toks.length > 0) tokenSets.push(toks);
      // w.title / abstract text intentionally never written anywhere from here on.
    }
    perFieldDocs.push({ field: field.name, tokenSets });
    console.log(`  [${calls}/${MAX_CALLS}] ${field.name.padEnd(46)} got=${results.length} usable=${tokenSets.length}`);
  }

  const totalUsableDocs = perFieldDocs.reduce((s, f) => s + f.tokenSets.length, 0);
  console.log(`\nAll ${fields.length} fields fetched. Calls used: ${calls}/${MAX_CALLS}. Total usable sampled docs: ${totalUsableDocs}.`);

  // 3. Size control: rebuild the table at a shrinking per-field cap, ZERO extra
  // network calls, until the JSON fits <=300KB.
  const CAP_LADDER = [PER_FIELD_TARGET, 120, 100, 80, 65, 50, 40, 32, 25, 18, 12];
  let finalResult = null;
  for (const cap of CAP_LADDER) {
    const docs = perFieldDocs.flatMap((f) => f.tokenSets.slice(0, cap));
    const N = docs.length;
    const df = collectDf(docs);
    const idf = idfFromDf(df, N);
    const kept = new Map();
    for (const [t, d] of df) if (d >= 2) kept.set(t, idf.get(t));
    const weights = Array.from(kept.values());
    const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
    const table = {};
    for (const [t, w] of kept) table[t] = Math.round(w * 1000) / 1000;
    const json = JSON.stringify(table);
    const bytes = Buffer.byteLength(json, "utf8");
    console.log(`  cap=${String(cap).padStart(3)}/field -> N=${String(N).padStart(5)} docs, vocab(d>=2)=${kept.size}, ${(bytes / 1024).toFixed(1)} KB`);
    finalResult = { cap, N, json, bytes, tokenCount: kept.size, maxWeight };
    if (bytes <= 300 * 1024) break;
  }

  writeFileSync(OUTPUT_PATH, finalResult.json);
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`FINAL: ${finalResult.tokenCount} tokens, ${(finalResult.bytes / 1024).toFixed(1)} KB, built from ${finalResult.N} effective docs (cap=${finalResult.cap}/field of ${totalUsableDocs} fetched), maxWeight=${finalResult.maxWeight.toFixed(3)}.`);
  console.log(`Within 300KB target: ${finalResult.bytes <= 300 * 1024}.`);
  console.log(`Total external calls: ${calls}/${MAX_CALLS}.`);
}

// Only run when invoked directly (`node scripts/build-reference-idf.mjs`), not when
// imported (the vitest drift tripwire imports `tokenize` from this file without
// wanting a live network build to run). Compares native filesystem paths (not raw
// `import.meta.url` strings) so this works on Windows too, where a `file://` URL and
// `process.argv[1]` are not literally the same string even for the same file.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((e) => {
    console.error("BUILD STOPPED:", e.message);
    process.exitCode = 1;
  });
}
