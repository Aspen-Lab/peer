// Build (or re-check) the Vertex AI Search app Peer's `vertex` web-search
// provider queries. Idempotent: every step skips itself if the resource is
// already there, so re-running after adding patterns is safe.
//
//   node --env-file=.env.local scripts/setup-vertex-search.mjs
//   node --env-file=.env.local scripts/setup-vertex-search.mjs --dry-run
//
// Needs `roles/discoveryengine.admin` on the service account in
// GOOGLE_APPLICATION_CREDENTIALS. Runtime only ever needs viewer.

import { GoogleAuth } from "google-auth-library";

// ── The search project ─────────────────────────────────────────────────────
// ABC-freemium 9-01 · Ruling 21 point 2, Ruling 26 point 4.
//
// **Reads `GOOGLE_VERTEX_SEARCH_PROJECT` and nothing else — the same single
// expression `vertexSearchProject()` uses in `src/lib/sources/vertex-search.ts`.**
//
// It used to fall back to `GOOGLE_VERTEX_PROJECT`, and that fallback was a
// SILENT configuration lie. `GOOGLE_VERTEX_PROJECT` is the **models** project;
// 8-01(a) separated the two capabilities on purpose. So an operator who
// followed this repo's own Step 3 to the letter got: a script that succeeded,
// a real index built in the grounding project, and an app that queried nothing
// — `isVertexSearchAvailable()` false — with no error printed anywhere.
//
// **The old name is now a loud failure instead of a silent success**, and
// recovering costs one line. A Discovery Engine index is addressed by
// project + collection + engine id: it does not move and it is not re-crawled.
// Setting `GOOGLE_VERTEX_SEARCH_PROJECT` to the SAME project id makes the
// identical index reachable under the name the app actually reads. No rebuild,
// no re-crawl, no second $-cost.
const PROJECT = process.env.GOOGLE_VERTEX_SEARCH_PROJECT?.trim();
const LEGACY_MODELS_PROJECT = process.env.GOOGLE_VERTEX_PROJECT?.trim();
const LOCATION = "global";
const DATA_STORE_ID = process.env.GOOGLE_VERTEX_SEARCH_DATA_STORE_ID || "peer-web";
// MEASURED 2026-08-26, AND IT CLOSES THE "JUST ADD A SECOND STORE" ESCAPE:
//   * attaching a store to an existing single-store engine returns
//     `400 Engines with a single data store cannot add or remove data stores`;
//   * creating a fresh multi-store engine over two website stores returns
//     `400 BasicSiteSearch data stores are not currently supported`.
// **So 50 patterns is a HARD CEILING for one search app**, not a per-store
// detail with a workaround. Going wider needs a second ENGINE and two search
// calls per query — twice the per-query cost, still ~4x under grounding — and
// that is a design decision, not a config tweak. `peer-web-2` exists from that
// experiment, holds 39 patterns, is attached to nothing, and costs nothing.
const ENGINE_ID = process.env.GOOGLE_VERTEX_SEARCH_ENGINE_ID || "peer-web";
const DRY_RUN = process.argv.includes("--dry-run");

// ── The seed list ──────────────────────────────────────────────────────────
// PATTERNS, NOT HOSTS. The local pool cache holds 106 real hosts but they all
// come from one battery/energy profile, so seeding them would build an index
// that serves battery researchers and nobody else. Peer runs arbitrary research
// profiles, so the seed set describes KINDS of site. The observed hosts are the
// cross-check: every one of them should fall inside one of these.
//
// MEASURED 2026-08-26: **A BASIC WEBSITE DATA STORE HOLDS AT MOST 50 PATTERNS.**
// The 51st and beyond are refused. So this list is a BUDGET, not a wish list,
// and the ordering below decides what wins when it overflows. Aggregators earn
// their slot on almost every query regardless of topic; a single university
// earns its slot only when that university happens to have something. Order
// accordingly.
//
// MEASURED 2026-08-26: **wildcard TLD patterns are REFUSED.** `*.edu/*`,
// `*.gov/*`, `*.ac.uk/*` all came back `INVALID_ARGUMENT` — a pattern must name
// a concrete registrable domain. So "all of academia" cannot be one line; the
// academic half of this list is a curated set of institutions, and whatever it
// misses falls through to the grounding backfill by design.
const PATTERNS = [
  // Institutions — the bulk of conference, seminar and faculty-posting pages.
  "*.mit.edu/*",
  "*.stanford.edu/*",
  "*.berkeley.edu/*",
  "*.caltech.edu/*",
  "*.harvard.edu/*",
  "*.cmu.edu/*",
  "*.princeton.edu/*",
  "*.cornell.edu/*",
  "*.umich.edu/*",
  "*.gatech.edu/*",
  "*.illinois.edu/*",
  "*.utexas.edu/*",
  "*.wisc.edu/*",
  "*.washington.edu/*",
  "*.ucla.edu/*",
  "*.ucsd.edu/*",
  "*.columbia.edu/*",
  "*.yale.edu/*",
  "*.upenn.edu/*",
  "*.northwestern.edu/*",
  "*.jhu.edu/*",
  "*.purdue.edu/*",
  "*.psu.edu/*",
  "*.ncsu.edu/*",
  "*.osu.edu/*",
  "*.umd.edu/*",
  "*.tamu.edu/*",
  "*.duke.edu/*",
  "*.rice.edu/*",
  "*.nyu.edu/*",
  "*.uchicago.edu/*",
  "*.byu.edu/*",
  "*.ox.ac.uk/*",
  "*.cam.ac.uk/*",
  "*.imperial.ac.uk/*",
  "*.ucl.ac.uk/*",
  "*.ed.ac.uk/*",
  "*.manchester.ac.uk/*",
  "*.ethz.ch/*",
  "*.epfl.ch/*",
  "*.tudelft.nl/*",
  "*.kth.se/*",
  "*.dtu.dk/*",
  "*.tum.de/*",
  "*.mpg.de/*",
  "*.cnrs.fr/*",
  "*.u-tokyo.ac.jp/*",
  "*.kyoto-u.ac.jp/*",
  "*.nus.edu.sg/*",
  "*.ntu.edu.sg/*",
  "*.tsinghua.edu.cn/*",
  "*.pku.edu.cn/*",
  "*.kaist.ac.kr/*",
  "*.unimelb.edu.au/*",
  "*.sydney.edu.au/*",
  // National labs and funders — ORNL, LBL, NIH, NSF and their event pages.
  "*.ornl.gov/*",
  "*.lbl.gov/*",
  "*.anl.gov/*",
  "*.nrel.gov/*",
  "*.pnnl.gov/*",
  "*.sandia.gov/*",
  "*.nist.gov/*",
  "*.nih.gov/*",
  "*.nsf.gov/*",
  "*.energy.gov/*",
  "*.cern.ch/*",
  "*.iaea.org/*",
  "*.europa.eu/*",
  // Publishers, societies and preprint hosts.
  "link.springer.com/*",
  "*.elsevier.com/*",
  "pubs.acs.org/*",
  "pubs.rsc.org/*",
  "journals.aps.org/*",
  "*.ieee.org/*",
  "*.mrs.org/*",
  "*.aip.org/*",
  "*.wiley.com/*",
  "*.nature.com/*",
  "*.sciencedirect.com/*",
  // Conference and event hubs seen in the censuses.
  "*.grc.org/*",
  "conferenceindex.org/*",
  "10times.com/*",
  "easychair.org/*",
  "telluridescience.org/*",
  // Job boards already in the census.
  "himalayas.app/*",
  "postdocjobs.com/*",
  "climatebase.org/*",
  "academicjobsonline.org/*",
  "*.academictransfer.com/*",
  "*.higheredjobs.com/*",
];

/**
 * THE RECORDED OVERFLOW SET — everything that did not fit in the 50.
 *
 * It is NOT attached to anything. The data store `peer-web-2` holds these 39
 * patterns from the experiment that established the ceiling (see ENGINE_ID
 * above); a basic-site-search engine cannot carry two stores, so using them
 * needs a second ENGINE and a second search call per query. Kept here, and
 * exported so it is not dead weight, because it is the ready-made input for
 * that decision.
 */
export const PATTERNS_OVERFLOW = [
  // **THE FOUR ADJUDICATED BENCHMARK HOSTS.** `events/benchmark.test.ts` locks
  // rendered `place.city` on rows from these hosts. They are commercial
  // conference sites, so no academic or publisher pattern reaches them, and
  // without them the benchmark's regression lock exercises ZERO rows and
  // correctly fails its own "the lock is alive" floor. They are seeded here
  // because they are genuinely sites Peer searches — not to make a test green.
  "*.flogen.org/*",
  "storageusa.solarenergyevents.com/*",
  "*.nanoge.org/*",
  "*.sdle.co.il/*",
  // The non-US institutions that the first store's 50-slot budget cut off.
  "*.ox.ac.uk/*",
  "*.cam.ac.uk/*",
  "*.imperial.ac.uk/*",
  "*.ucl.ac.uk/*",
  "*.ed.ac.uk/*",
  "*.manchester.ac.uk/*",
  "*.ethz.ch/*",
  "*.epfl.ch/*",
  "*.tudelft.nl/*",
  "*.kth.se/*",
  "*.dtu.dk/*",
  "*.tum.de/*",
  "*.mpg.de/*",
  "*.cnrs.fr/*",
  "*.u-tokyo.ac.jp/*",
  "*.kyoto-u.ac.jp/*",
  "*.nus.edu.sg/*",
  "*.ntu.edu.sg/*",
  "*.tsinghua.edu.cn/*",
  "*.kaist.ac.kr/*",
  "*.unimelb.edu.au/*",
  "*.sydney.edu.au/*",
  // National labs and funders — also cut by the first store's budget.
  "*.ornl.gov/*",
  "*.lbl.gov/*",
  "*.anl.gov/*",
  "*.nrel.gov/*",
  "*.pnnl.gov/*",
  "*.nist.gov/*",
  "*.nih.gov/*",
  "*.nsf.gov/*",
  "*.energy.gov/*",
  "*.cern.ch/*",
  "*.europa.eu/*",
  // Further aggregators — each earns its slot on almost any topic.
  "euraxess.ec.europa.eu/*",
  "www.euagenda.eu/*",
  "*.nanoge.org/*",
];

/**
 * Patterns to REMOVE from the primary store before adding new ones.
 *
 * With a hard ceiling of 50, adding anything means evicting something, so the
 * eviction is written down rather than left to whoever notices the cap next.
 *
 * **The judgment, stated so it can be argued with:** an aggregator or a
 * conference site earns its slot on nearly every query; one more US university
 * earns its slot only when that university happens to be hosting. These four
 * are the ones that did not appear in any live probe of this index, and they
 * are being traded for four conference hosts Peer's own census already
 * adjudicated. Change the trade by editing these two lists — nothing else
 * depends on it.
 */
const EVICT_FROM_PRIMARY = [
  "*.yale.edu/*",
  "*.columbia.edu/*",
  "*.jhu.edu/*",
  "*.osu.edu/*",
];

/** The four adjudicated conference hosts, moved into the primary store. */
const PROMOTE_TO_PRIMARY = [
  "*.flogen.org/*",
  "storageusa.solarenergyevents.com/*",
  "*.nanoge.org/*",
  "*.sdle.co.il/*",
];

const STORES = [
  {
    id: DATA_STORE_ID,
    patterns: [...PROMOTE_TO_PRIMARY, ...PATTERNS],
    evict: EVICT_FROM_PRIMARY,
  },
];

// ── Plumbing ───────────────────────────────────────────────────────────────

if (!PROJECT) {
  console.error("GOOGLE_VERTEX_SEARCH_PROJECT is not set. Nothing to do.");
  if (LEGACY_MODELS_PROJECT) {
    // The loud half. Silence here is what shipped the defect: the script would
    // have run happily on the models project. Never print the VALUE.
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

const BASE = `https://discoveryengine.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/collections/default_collection`;
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function call(method, url, body) {
  const token = (await (await auth.getClient()).getAccessToken())?.token;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": PROJECT,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

async function waitForOperation(name, label, timeoutMs = 300_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { json } = await call(
      "GET",
      `https://discoveryengine.googleapis.com/v1/${name}`,
    );
    if (json.done) {
      if (json.error) throw new Error(`${label} failed: ${JSON.stringify(json.error)}`);
      return json.response ?? {};
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`${label} did not finish within ${timeoutMs / 1000}s`);
}

// ── Step 1 — the website data store ────────────────────────────────────────

async function ensureDataStore(storeId) {
  const existing = await call("GET", `${BASE}/dataStores/${storeId}`);
  if (existing.ok) {
    console.log(`[1/3] data store "${storeId}" already exists`);
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`unexpected ${existing.status}: ${JSON.stringify(existing.json)}`);
  }
  if (DRY_RUN) {
    console.log(`[1/3] would create data store "${storeId}"`);
    return;
  }
  const created = await call(
    "POST",
    `${BASE}/dataStores?dataStoreId=${storeId}`,
    {
      displayName: `Peer web discovery (${storeId})`,
      industryVertical: "GENERIC",
      solutionTypes: ["SOLUTION_TYPE_SEARCH"],
      // Basic website search: Google's own index, restricted to the patterns
      // below. No crawl budget, no domain verification.
      contentConfig: "PUBLIC_WEBSITE",
    },
  );
  if (!created.ok) {
    throw new Error(`create data store ${created.status}: ${JSON.stringify(created.json)}`);
  }
  if (created.json.name && !created.json.done) {
    await waitForOperation(created.json.name, "data store creation");
  }
  console.log(`[1/3] created data store "${storeId}"`);
}

// ── Step 2 — the site patterns ─────────────────────────────────────────────

async function ensureTargetSites(storeId, patterns, evict = []) {
  const parent = `${BASE}/dataStores/${storeId}/siteSearchEngine`;
  let listed = await call("GET", `${parent}/targetSites?pageSize=100`);

  // Evict first — at the 50 ceiling there is no room for an add otherwise.
  for (const pattern of evict) {
    const hit = (listed.json.targetSites ?? []).find(
      (site) =>
        site.generatedUriPattern === pattern || site.providedUriPattern === pattern,
    );
    if (!hit) continue;
    if (DRY_RUN) {
      console.log(`[2/3] would evict ${pattern}`);
      continue;
    }
    const gone = await call("DELETE", `https://discoveryengine.googleapis.com/v1/${hit.name}`);
    console.log(`[2/3] evicted ${pattern} -> ${gone.status}`);
    if (gone.json?.name && !gone.json.done) {
      await waitForOperation(gone.json.name, "target site delete").catch(() => {});
    }
  }
  if (evict.length > 0 && !DRY_RUN) {
    listed = await call("GET", `${parent}/targetSites?pageSize=100`);
  }
  // MEASURED 2026-08-26: the LIST response returns `generatedUriPattern` and
  // omits `providedUriPattern`, so a dedupe on the provided field alone sees an
  // empty set and re-POSTs everything (which then fails "already exists").
  // Read both.
  const already = new Set(
    (listed.json.targetSites ?? []).flatMap((s) =>
      [s.providedUriPattern, s.generatedUriPattern].filter(Boolean),
    ),
  );
  const missing = patterns.filter((p) => !already.has(p));
  console.log(
    `[2/3] ${storeId}: ${already.size} seeded, ${missing.length} to add`,
  );
  if (missing.length === 0 || DRY_RUN) {
    if (DRY_RUN) console.log(`[2/3] would add: ${missing.join(", ")}`);
    return { added: [], rejected: [] };
  }

  const added = [];
  const rejected = [];
  // batchCreate caps at 20 requests; keep well under it.
  for (let i = 0; i < missing.length; i += 10) {
    const chunk = missing.slice(i, i + 10);
    const res = await call("POST", `${parent}/targetSites:batchCreate`, {
      requests: chunk.map((pattern) => ({
        parent,
        targetSite: {
          providedUriPattern: pattern,
          type: "INCLUDE",
          exactMatch: false,
        },
      })),
    });
    if (!res.ok) {
      // A whole-batch rejection usually means one bad pattern; retry singly so
      // the good ones still land and the bad one is named.
      for (const pattern of chunk) {
        const one = await call("POST", `${parent}/targetSites`, {
          providedUriPattern: pattern,
          type: "INCLUDE",
          exactMatch: false,
        });
        if (one.ok) added.push(pattern);
        else rejected.push({ pattern, status: one.status, error: one.json.error?.message });
      }
      continue;
    }
    if (res.json.name) await waitForOperation(res.json.name, "target sites").catch(() => {});
    added.push(...chunk);
  }
  console.log(`[2/3] added ${added.length}, rejected ${rejected.length}`);
  for (const r of rejected) console.log(`      REJECTED ${r.pattern} — ${r.error}`);
  return { added, rejected };
}

// ── Step 3 — the search app ────────────────────────────────────────────────

async function ensureEngine(storeIds) {
  const existing = await call("GET", `${BASE}/engines/${ENGINE_ID}`);
  if (existing.ok) {
    const attached = existing.json.dataStoreIds ?? [];
    const missing = storeIds.filter((id) => !attached.includes(id));
    if (missing.length > 0) {
      const patched = await call(
        "PATCH",
        `${BASE}/engines/${ENGINE_ID}?updateMask=dataStoreIds`,
        { dataStoreIds: storeIds },
      );
      console.log(
        `[3/3] attached ${missing.join(", ")} -> ${patched.status}` +
          (patched.ok ? "" : ` ${JSON.stringify(patched.json.error?.message ?? patched.json).slice(0, 200)}`),
      );
    } else {
      console.log(`[3/3] search app "${ENGINE_ID}" already carries ${attached.join(", ")}`);
    }
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`unexpected ${existing.status}: ${JSON.stringify(existing.json)}`);
  }
  if (DRY_RUN) {
    console.log(`[3/3] would create search app "${ENGINE_ID}"`);
    return;
  }
  const created = await call("POST", `${BASE}/engines?engineId=${ENGINE_ID}`, {
    displayName: "Peer web discovery",
    solutionType: "SOLUTION_TYPE_SEARCH",
    industryVertical: "GENERIC",
    dataStoreIds: storeIds,
    // MEASURED 2026-08-26: **website search is an ENTERPRISE-tier feature.** A
    // STANDARD engine accepts creation and then refuses every query with
    // `400 Cannot use enterprise edition features (website search ...)`. It
    // prices at ~$4/1000 queries instead of ~$1.5, still ~9x under grounding.
    searchEngineConfig: { searchTier: "SEARCH_TIER_ENTERPRISE" },
  });
  if (!created.ok) {
    throw new Error(`create engine ${created.status}: ${JSON.stringify(created.json)}`);
  }
  if (created.json.name && !created.json.done) {
    await waitForOperation(created.json.name, "search app creation");
  }
  console.log(`[3/3] created search app "${ENGINE_ID}"`);
}

// ── Run ────────────────────────────────────────────────────────────────────

console.log(`project: ${PROJECT}${DRY_RUN ? "  (dry run)" : ""}`);
const sites = { added: [], rejected: [] };
for (const store of STORES) {
  await ensureDataStore(store.id);
  const r = await ensureTargetSites(store.id, store.patterns, store.evict);
  sites.added.push(...(r.added ?? []));
  sites.rejected.push(...(r.rejected ?? []));
}
await ensureEngine(STORES.map((s) => s.id));

// ABC-freemium 9-01 — TWO lines, not one. This is the success path, and it was
// the sharpest instance of the defect: a script that succeeds while handing the
// operator instructions that no longer work.
// `isVertexSearchAvailable()` (`src/lib/sources/vertex-search.ts`) is
// `Boolean(vertexSearchProject() && vertexSearchApp())` — BOTH signals are
// required, and the script already holds both values. It was printing one.
console.log(
  "\nDone. Add BOTH of these lines to web/.env.local and restart the dev server:",
);
console.log(`GOOGLE_VERTEX_SEARCH_PROJECT=${PROJECT}`);
console.log(`GOOGLE_VERTEX_SEARCH_ENGINE_ID=${ENGINE_ID}`);
console.log(
  "\nBoth are required: the provider stays off if either one is missing.",
);
if (sites.rejected?.length) {
  console.log(
    `\n${sites.rejected.length} pattern(s) were refused — see REJECTED lines above.`,
  );
}
