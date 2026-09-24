// Fire a measured batch of Vertex AI Search queries so the spend becomes large
// enough to see on the Credits page.
//
//   node --env-file=.env.local scripts/probe-vertex-search-billing.mjs [count]
//
// WHY THIS EXISTS. "Percent remaining: 100%" cannot distinguish "the credit does
// not cover Vertex AI Search" from "the bill has not landed yet", because a few
// hundred test searches are ~$1 against $1,000 and Google's credit application
// lags a day or two. A thousand searches is ~$4, which moves `Remaining value`
// to a number you can read at a glance — and if it does NOT move, the same $4
// shows up on the card instead. Either outcome is an answer.
//
// It only SEARCHES. It creates, changes and deletes nothing.

import { GoogleAuth } from "google-auth-library";

// ── The search project ─────────────────────────────────────────────────────
// ABC-freemium 9-01 · Ruling 21 point 2, Ruling 26 point 4.
//
// **Reads `GOOGLE_VERTEX_SEARCH_PROJECT` and nothing else — the same single
// expression `vertexSearchProject()` uses in `src/lib/sources/vertex-search.ts`.**
//
// The old `GOOGLE_VERTEX_PROJECT` fallback mattered more here than anywhere
// else: this script spends about $4 of real money per run, and the fallback
// pointed that spend at the **models** project — measuring a bill for a project
// the app never queries. An answer about the wrong project is worse than no
// answer, because it is believed.
const PROJECT = process.env.GOOGLE_VERTEX_SEARCH_PROJECT?.trim();
const LEGACY_MODELS_PROJECT = process.env.GOOGLE_VERTEX_PROJECT?.trim();
const ENGINE_ID = process.env.GOOGLE_VERTEX_SEARCH_ENGINE_ID?.trim() || "peer-web";
const COUNT = Number(process.argv[2] ?? 1000);
const CONCURRENCY = 8;
// MEASURED 2026-08-26: `discoveryengine.googleapis.com/search_requests_regional`
// cuts in at roughly 300 requests and the window rolls in about 16 s, i.e. a
// per-minute quota. Peer's own load is nowhere near it — a full three-surface
// run is 32 searches — but a batch like this one walks straight into it, so the
// batch is paced instead of hammered.
const BATCH_SIZE = 250;
const BATCH_PAUSE_MS = 62_000;
const PRICE_PER_1000 = 4; // Enterprise-tier search request, list price.

if (!PROJECT) {
  console.error("GOOGLE_VERTEX_SEARCH_PROJECT is not set.");
  if (LEGACY_MODELS_PROJECT) {
    // The loud half. Never print the VALUE.
    console.error("");
    console.error(
      "GOOGLE_VERTEX_PROJECT is set, and it is deliberately NOT read here.",
    );
    console.error(
      "That name is the MODELS project. Vertex AI Search is configured",
    );
    console.error("separately, and the app reads GOOGLE_VERTEX_SEARCH_PROJECT.");
    console.error("");
    console.error("Add this line to web/.env.local with the SAME project id:");
    console.error("  GOOGLE_VERTEX_SEARCH_PROJECT=<the same project id>");
    console.error("");
    console.error(
      "An index already built under the old name does NOT move and is NOT",
    );
    console.error("rebuilt — the same index is reachable under the new name.");
  }
  process.exit(1);
}

// Distinct queries, so nothing can be served from a repeat-query cache and the
// billed request count is unambiguous.
const TOPICS = [
  "solid-state battery electrolytes", "computational neuroscience",
  "machine learning interpretability", "protein structure prediction",
  "molten salt reactor", "quantum error correction", "CRISPR gene editing",
  "perovskite solar cells", "atmospheric river forecasting", "graph neural networks",
  "single-cell transcriptomics", "topological insulators", "catalysis for ammonia",
  "soft robotics actuators", "cryo-electron microscopy", "federated learning privacy",
  "carbon capture sorbents", "exoplanet atmospheres", "gut microbiome metabolism",
  "high-entropy alloys", "neuromorphic computing", "gravitational wave detection",
  "synthetic biology circuits", "hydrogen fuel cells", "materials informatics",
  "photonic integrated circuits", "immunotherapy resistance", "urban heat islands",
  "reinforcement learning robotics", "battery thermal runaway", "spintronics devices",
  "wastewater epidemiology", "additive manufacturing metals", "coral reef restoration",
  "large language model evaluation", "nuclear fusion confinement", "bioinformatics pipelines",
  "seismic hazard modelling", "drug delivery nanoparticles", "precision agriculture sensing",
];
const QUALIFIERS = [
  "conference 2026", "workshop 2026", "call for papers", "postdoc position",
  "summer school", "symposium registration", "seminar series", "PhD studentship",
  "faculty opening", "abstract deadline", "keynote speakers", "programme schedule",
  "research group", "annual meeting", "student travel grant", "poster session",
  "tutorial day", "industry track", "special issue", "review article",
  "lab opening", "visiting scholar", "training course", "grand challenge",
  "open positions",
];

function queries(n) {
  const out = [];
  for (let i = 0; out.length < n; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const qual = QUALIFIERS[Math.floor(i / TOPICS.length) % QUALIFIERS.length];
    // The round number keeps every string distinct once the grid wraps.
    const round = Math.floor(i / (TOPICS.length * QUALIFIERS.length));
    out.push(round === 0 ? `${topic} ${qual}` : `${topic} ${qual} ${round + 1}`);
  }
  return out;
}

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const url =
  `https://discoveryengine.googleapis.com/v1/projects/${PROJECT}` +
  `/locations/global/collections/default_collection/engines/${ENGINE_ID}` +
  `/servingConfigs/default_search:search`;

let token = (await (await auth.getClient()).getAccessToken())?.token;
let ok = 0;
let failed = 0;
let rows = 0;
const errors = new Map();
const all = queries(COUNT);
let next = 0;
const startedAt = Date.now();

async function workerStep() {
  {
    const index = next++;
    // Access tokens last an hour; refresh well inside that.
    if (index % 500 === 0 && index > 0) {
      token = (await (await auth.getClient()).getAccessToken())?.token;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-goog-user-project": PROJECT,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: all[index],
          pageSize: 10,
          contentSearchSpec: { snippetSpec: { returnSnippet: true } },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = await res.json();
        ok += 1;
        rows += (data.results ?? []).length;
      } else {
        failed += 1;
        const msg = String((await res.json()).error?.message ?? res.status).slice(0, 90);
        errors.set(msg, (errors.get(msg) ?? 0) + 1);
      }
    } catch (err) {
      failed += 1;
      const msg = String(err).slice(0, 90);
      errors.set(msg, (errors.get(msg) ?? 0) + 1);
    }
    if ((ok + failed) % 100 === 0) {
      console.log(`  ${ok + failed}/${all.length}  ok=${ok} failed=${failed}`);
    }
  }
}

console.log(`project ${PROJECT}, app ${ENGINE_ID}, firing ${COUNT} distinct searches...`);
while (next < all.length) {
  const stopAt = Math.min(next + BATCH_SIZE, all.length);
  const limit = stopAt;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < limit) await workerStep();
    }),
  );
  if (next < all.length) {
    console.log(`  paused for quota (${ok} billed so far)`);
    await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
  }
}

const seconds = Math.round((Date.now() - startedAt) / 1000);
console.log("\n=== billing probe complete ===");
console.log(`billed searches (HTTP 200): ${ok}`);
console.log(`failed (not billed):        ${failed}`);
console.log(`result rows returned:       ${rows}`);
console.log(`elapsed:                    ${seconds}s`);
console.log(
  `expected charge:            ~$${((ok / 1000) * PRICE_PER_1000).toFixed(2)} ` +
    `(at $${PRICE_PER_1000}/1000, Enterprise tier list price)`,
);
for (const [msg, n] of errors) console.log(`  ERROR x${n}: ${msg}`);
console.log(
  "\nTomorrow: Billing -> Credits. If the credit covers this, Remaining value " +
    `drops to about $${(1000 - (ok / 1000) * PRICE_PER_1000).toFixed(2)}. ` +
    "If it stays $1,000.00, the same amount is on the card instead.",
);
