import { fetchPagesConcurrently } from "@/lib/opportunities/page-fetch";
import { cleanDisplayText } from "@/lib/text/clean";
import {
  isGeminiSearchAvailable,
  isPreScreenedOut,
  pageDeclaresEventFromHtml,
  searchGemini,
  type WebResult,
} from "./gemini-search";
import type { WebSearchProvider } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// THE `vertex` WEB-SEARCH PROVIDER — VERTEX AI SEARCH (Discovery Engine).
//
// WHY IT EXISTS. Ruling 75's `gemini` provider bills every query as *Grounding
// with Google Search*, the single most expensive line on this project's Vertex
// bill (~$35 / 1000 queries), and that SKU is NOT covered by the project's
// "Trial credit for GenAI App Builder". Vertex AI Search — the product family
// the credit actually names — serves a site-scoped index at roughly
// $1.5–4 / 1000 queries AND draws the credit down. Moving the census fan-out
// onto it is the whole point of this module.
//
// WHAT IT IS NOT. Vertex AI Search only searches the sites seeded into its data
// store; it is not the open web. Discovery of genuinely NEW hosts therefore
// still needs grounding, so this module keeps a BOUNDED gemini backfill (see
// `fallbackMinResults`) rather than deleting that capability. Expected steady
// state: the great majority of queries served by the credit, a small tail of
// under-filled queries still paying for grounding.
//
// THE CONTRACT IS UNCHANGED. `searchVertex` returns the same `{title, url,
// snippet}` `WebResult[]` all three surfaces already consume from
// `searchGemini`, so no mapper, no admission rule and no guard chain moves.
//
// WHAT THIS PROVIDER DOES *NOT* HAVE TO DO, AND WHY THAT MATTERS.
// `searchGemini` pays for two recovery stages because grounding hands back an
// opaque redirect token and a HOSTNAME where a page title should be. Discovery
// Engine hands back the real `link` and the crawler's own `title` directly, so
// those stages collapse to nothing: no redirect resolution, no page fetch to
// recover a title, and — the operational consequence — no row is ever DROPPED
// for having no recoverable title. The one page fetch that survives here is
// optional and serves a different purpose entirely (`detectPageKind`, below).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wall-clock budget for one `searchVertex` call when the caller passes no
 * shared deadline. Deliberately under `GEMINI_SOURCE_TIMEOUT_MS` (25 s): the
 * search itself is a single sub-second REST call, and everything else here
 * (page-kind detection, gemini backfill) is optional work that must stop rather
 * than push the surface past its wall.
 */
const VERTEX_SEARCH_BUDGET_MS = 21_000;

/** The Discovery Engine `:search` call itself. It is one indexed lookup. */
const SEARCH_TIMEOUT_MS = 8_000;

/**
 * **NARROWER THAN `gemini-search.ts`'s 16, on purpose.** That module's width is
 * sized for title recovery, which is mandatory — a row without a title is
 * dropped, so it is worth saturating the link. Page-kind detection is optional,
 * and the fan-out multiplies this number: sixteen concurrent queries each
 * opening this many sockets is what actually saturates the machine, and a
 * saturated machine makes every individual fetch slower, which is the loop that
 * ends in a source timeout.
 */
const PAGE_KIND_CONCURRENCY = 4;

/**
 * **PAGE-KIND DETECTION IS STRICTLY BEST-EFFORT, AND THESE TWO NUMBERS ARE WHY
 * THE EVENTS SURFACE STILL RETURNS ROWS.**
 *
 * MEASURED 2026-08-26, three consecutive full-suite runs: with page-kind
 * detection unbounded, the events fan-out (16 queries x up to 10 rows = up to
 * 160 external page fetches, each with its own multi-second timeout) exceeded
 * `withSourceTimeout`'s 25 s wall in **2 of 3 runs**, and that wall REJECTS the
 * whole source — `eventwebFetched: 0`, a census turned into an outage.
 *
 * The search itself is not the cost; it answers in well under a second. The
 * cost is entirely these page fetches, and unlike `searchGemini`'s title
 * recovery they are OPTIONAL: a row with no `pageKind` is a complete row, so
 * truncating this stage costs an admission channel on some rows and costs the
 * rows themselves nothing. Bounding it is therefore free of the usual
 * "degrade quietly" objection — there is no partial row to invent.
 */
const PAGE_KIND_MIN_HEADROOM_MS = 8_000;
const PAGE_KIND_MAX_ROWS = 4;

/**
 * **A GROUNDING BACKFILL IS ONLY STARTED WITH THIS MUCH TIME LEFT ON THE SHARED
 * DEADLINE, AND THE NUMBER IS A MEASUREMENT.** One grounded query measured
 * 7.45 s live on 2026-08-26 (the module's own history records 3.4–12.1 s), so a
 * backfill begun with less headroom than this reliably lands past the caller's
 * wall rather than before it.
 *
 * **WHY IT MATTERS MORE THAN IT LOOKS.** Without this guard the backfill
 * reintroduces exactly the failure Vertex AI Search was adopted to remove:
 * measured in the full suite, an events fan-out where several queries each took
 * a 7–12 s grounding top-up blew through `withSourceTimeout`'s 25 s wall, and
 * `withSourceTimeout` REJECTS the whole source — turning a 79-row census into
 * `eventwebFetched: 0, source-timeout`. Fewer rows is a degradation; zero rows
 * is an outage. This trades the former for the latter on purpose.
 */
const GROUNDING_BACKFILL_MIN_HEADROOM_MS = 12_000;

/** Discovery Engine's own ceiling is 100; a census never needs that many. */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 10;

/**
 * Below this many Vertex rows, a query counts as under-served by the
 * site-scoped index and the grounding backfill runs for it. Raising it buys
 * coverage with grounding spend; lowering it does the reverse. Override with
 * `GOOGLE_VERTEX_SEARCH_MIN_RESULTS`.
 *
 * **This is the tuning knob, not the on/off switch** (ABC-freemium 8-01(b)).
 * `fallbackEnabled()` below decides whether the backfill runs at all, and it
 * is off unless turned on; this number only decides *how thin is thin* once it
 * has been.
 */
const DEFAULT_FALLBACK_MIN_RESULTS = 3;

/**
 * The placeholder Discovery Engine puts in the snippet slot when it has nothing
 * to show. It must never reach a surface as if it were page text — the event
 * mapper reads an ABSENT snippet as "judge on the title alone", and this string
 * would silently switch that branch off.
 */
const NO_SNIPPET_PLACEHOLDER = /^no snippet is available/i;

export interface VertexSearchOptions {
  /** Hosts the calling surface denies outright, title-independent. */
  denyHosts?: readonly string[];
  /** Domain exclusions the surface already passes to its other providers. */
  excludeDomains?: readonly string[];
  /** Upper bound on returned rows. The surface's own per-source limit. */
  maxResults?: number;
  /** Shared wall-clock deadline for a whole fan-out. */
  deadlineAt?: number;
  /**
   * Fetch each result page and read its `schema.org` `@type` (channel L).
   *
   * ONLY the events surface should set this, and it must. `searchGemini` gets
   * `pageKind` for free because it already holds the HTML; this provider does
   * not fetch pages at all, so without this flag every Vertex-sourced event row
   * would arrive with `pageKind` undefined and `webResultToRawEventItem`'s
   * publisher-declaration admission channel would be silently dead.
   */
  detectPageKind?: boolean;
  /**
   * Run the grounding backfill when Vertex returns fewer than this many rows.
   * `0` disables the backfill for this call.
   */
  fallbackMinResults?: number;
  /** Test seam: replaces the live Discovery Engine call. */
  search?: (query: string, pageSize: number) => Promise<DiscoveryResult[]>;
  /** Test seam: replaces page fetching for `detectPageKind`. */
  fetchPages?: (urls: string[]) => Promise<Array<string | null>>;
  /** Test seam: replaces the grounding backfill. */
  groundFallback?: (query: string, limit: number) => Promise<WebResult[]>;
}

/** One `results[]` entry of a Discovery Engine `:search` response. */
export interface DiscoveryResult {
  id?: string;
  document?: {
    id?: string;
    name?: string;
    /** Website data stores put the crawled fields here. */
    derivedStructData?: Record<string, unknown>;
    /** Structured data stores put the operator's own fields here. */
    structData?: Record<string, unknown>;
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Availability
// ───────────────────────────────────────────────────────────────────────────

/**
 * ABC-freemium 8-01(a) · Ruling 21 point 2 · Ruling 23 point 4.
 *
 * **`GOOGLE_VERTEX_SEARCH_PROJECT` is the SOLE signal for Vertex AI Search.**
 * This used to fall back to `GOOGLE_VERTEX_PROJECT`, which is the same name
 * `isGeminiSearchAvailable()` reads — so switching Vertex AI Search on switched
 * Gemini grounding on with it, and there was no configuration in which you
 * could have one without the other. Grounding is the most expensive path in
 * the product and it was reachable by fallback, which is the shape the owner
 * asked to be removed.
 *
 * With the fallback gone the two are genuinely independent: set
 * `GOOGLE_VERTEX_SEARCH_PROJECT` plus an app id and Vertex AI Search comes up
 * while `isGeminiSearchAvailable()` stays false. **No new variable was
 * invented** — this name already existed, was already read first, is already
 * in the build guard's explicit list, and both operational scripts already
 * prefer it. The guard needs no edit either: its ban is on the whole
 * `GOOGLE_VERTEX_` prefix, so this name is refused on Vercel exactly as the
 * old one was.
 */
function vertexSearchProject(): string | undefined {
  return process.env.GOOGLE_VERTEX_SEARCH_PROJECT?.trim() || undefined;
}

function vertexSearchApp(): { kind: "engines" | "dataStores"; id: string } | null {
  const engine = process.env.GOOGLE_VERTEX_SEARCH_ENGINE_ID?.trim();
  if (engine) return { kind: "engines", id: engine };
  const dataStore = process.env.GOOGLE_VERTEX_SEARCH_DATA_STORE_ID?.trim();
  if (dataStore) return { kind: "dataStores", id: dataStore };
  return null;
}

/**
 * A Vertex project AND a search app to query, and nothing else.
 *
 * **With no app id this returns false and NOTHING changes** — no resolution
 * order shifts, no surface switches provider, every census keeps the behaviour
 * it has today. That is deliberate: this code can ship before the Search App
 * exists in the console and turns itself on the moment
 * `GOOGLE_VERTEX_SEARCH_ENGINE_ID` is set.
 */
export function isVertexSearchAvailable(): boolean {
  return Boolean(vertexSearchProject() && vertexSearchApp());
}

/**
 * The `webSearch` block a pipeline builds when Tavily is not enabled — the
 * vertex-aware replacement for `geminiWebSearchOptions`.
 *
 * The opt-out is READ OFF THE EXISTING `gemini` CONNECTOR ON PURPOSE. That flag
 * means "do not spend the server's own Vertex credentials on search", and
 * Vertex AI Search is spent from the same project, so honouring it here keeps
 * one switch instead of inventing a second one a caller could half-set.
 */
export function webSearchOptions(
  connectors: { gemini?: { enabled?: boolean } } | undefined,
): { provider: WebSearchProvider } | undefined {
  if (connectors?.gemini?.enabled === false) return undefined;
  if (isVertexSearchAvailable()) return { provider: "vertex" };
  return isGeminiSearchAvailable() ? { provider: "gemini" } : undefined;
}

/**
 * True for the two providers that run on the server's own Vertex project and
 * therefore need Ruling 76a's 25 s per-source override rather than the default
 * 8 s wall. Stated once so the three pipelines cannot drift apart.
 */
export function needsVertexSourceTimeout(
  provider: WebSearchProvider | undefined,
): boolean {
  return provider === "gemini" || provider === "vertex";
}

// ───────────────────────────────────────────────────────────────────────────
// The live call
// ───────────────────────────────────────────────────────────────────────────

/**
 * **WHY THE AUTH LIBRARY IS LOADED THROUGH A VARIABLE, NOT AN `import`
 * STATEMENT.** `google-auth-library` is Node-only — it `require`s
 * `child_process` and `fs` at module scope. `eventweb.ts` imports this module,
 * and `opportunities/event-details.ts` imports one pure predicate FROM
 * `eventweb.ts`, so this file is transitively reachable from a client
 * component. A static import therefore fails the browser build outright
 * (`Module not found: Can't resolve 'child_process'`), measured on
 * `next build` before this indirection went in.
 *
 * A NON-LITERAL specifier keeps the package out of the bundler's module graph
 * entirely, so nothing Node-only is ever asked of the browser. The call below
 * runs only inside `searchDiscoveryEngine`, which only ever runs on the server.
 * The package itself is still traced and installed either way — `@google/genai`
 * depends on it, and imports it statically from server code.
 *
 * `@google/genai` gets away with a static import because it ships a browser
 * build behind an `exports` condition. This package does not.
 */
type GoogleAuthModule = typeof import("google-auth-library");
type GoogleAuthClient = InstanceType<GoogleAuthModule["GoogleAuth"]>;

let auth: GoogleAuthClient | null = null;

async function getAuth(): Promise<GoogleAuthClient> {
  if (auth) return auth;
  const specifier = "google-auth-library";
  const mod = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ specifier
  )) as GoogleAuthModule;
  // The same credential chain `@google/genai` uses for Vertex: the
  // service-account JSON at GOOGLE_APPLICATION_CREDENTIALS locally, the
  // attached identity in a deployed environment. This module introduces no new
  // secret and reads no new credential file.
  auth = new mod.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return auth;
}

async function accessToken(): Promise<string | null> {
  try {
    const client = await (await getAuth()).getClient();
    const token = await client.getAccessToken();
    return token?.token ?? null;
  } catch (err) {
    console.error("[sources/vertex-search] credential error:", err);
    return null;
  }
}

/**
 * Discovery Engine is region-scoped like every other Google API, but a WEBSITE
 * data store lives in `global`, and `global` is the one location whose hostname
 * carries no region prefix. Getting this wrong returns 404, not a redirect.
 */
export function searchEndpoint(): string | null {
  const project = vertexSearchProject();
  const app = vertexSearchApp();
  if (!project || !app) return null;
  const location =
    process.env.GOOGLE_VERTEX_SEARCH_LOCATION?.trim().toLowerCase() || "global";
  const host =
    location === "global"
      ? "discoveryengine.googleapis.com"
      : `${location}-discoveryengine.googleapis.com`;
  const collection =
    process.env.GOOGLE_VERTEX_SEARCH_COLLECTION?.trim() || "default_collection";
  const servingConfig =
    process.env.GOOGLE_VERTEX_SEARCH_SERVING_CONFIG?.trim() || "default_search";
  return (
    `https://${host}/v1/projects/${project}/locations/${location}` +
    `/collections/${collection}/${app.kind}/${app.id}` +
    `/servingConfigs/${servingConfig}:search`
  );
}

async function searchDiscoveryEngine(
  query: string,
  pageSize: number,
): Promise<DiscoveryResult[]> {
  const endpoint = searchEndpoint();
  if (!endpoint) return [];
  const token = await accessToken();
  if (!token) return [];
  const project = vertexSearchProject();

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // Attributes the quota AND THE BILLING — which is the whole reason this
      // module exists. Without it a user-ADC credential can bill the caller's
      // default project and the credit is never drawn down.
      ...(project ? { "x-goog-user-project": project } : {}),
    },
    body: JSON.stringify({
      query,
      pageSize,
      queryExpansionSpec: { condition: "AUTO" },
      spellCorrectionSpec: { mode: "AUTO" },
      contentSearchSpec: { snippetSpec: { returnSnippet: true } },
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      "[sources/vertex-search] non-ok response:",
      res.status,
      body.slice(0, 400),
    );
    return [];
  }
  const data = (await res.json()) as { results?: unknown };
  return Array.isArray(data.results) ? (data.results as DiscoveryResult[]) : [];
}

// ───────────────────────────────────────────────────────────────────────────
// Mapping
// ───────────────────────────────────────────────────────────────────────────

const TAG_RE = /<[^>]*>/g;

/** Snippets arrive with `<b>` highlight markup around the matched terms. */
function stripMarkup(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return cleanDisplayText(value.replace(TAG_RE, " ")) || undefined;
}

function firstString(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/**
 * A website data store fills `derivedStructData`; a structured one fills
 * `structData` with whatever schema the operator uploaded. Both are read so a
 * later change of store type does not silently return zero rows.
 */
function documentFields(result: DiscoveryResult): Record<string, unknown> {
  return {
    ...(result.document?.structData ?? {}),
    ...(result.document?.derivedStructData ?? {}),
  };
}

export function discoveryResultToWebResult(
  result: DiscoveryResult,
): WebResult | null {
  const fields = documentFields(result);
  const url = cleanDisplayText(firstString(fields, ["link", "url", "uri"]) ?? "");
  if (!url) return null;
  // `htmlTitle` is the same text with highlight markup, so `title` comes first.
  const title = stripMarkup(
    firstString(fields, ["title", "htmlTitle", "pagetitle"]),
  );
  if (!title) return null;
  return { title, url, snippet: snippetOf(fields) };
}

function snippetOf(fields: Record<string, unknown>): string {
  const snippets = fields.snippets;
  if (Array.isArray(snippets)) {
    for (const entry of snippets) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const status = row.snippet_status ?? row.snippetStatus;
      if (typeof status === "string" && status.toUpperCase() !== "SUCCESS") {
        continue;
      }
      const text = stripMarkup(row.snippet);
      if (text && !NO_SNIPPET_PLACEHOLDER.test(text)) return text;
    }
  }
  // Extractive answers exist only when the app is configured for them, so they
  // are read as a second choice rather than required.
  const answers = fields.extractive_answers ?? fields.extractiveAnswers;
  if (Array.isArray(answers)) {
    for (const entry of answers) {
      if (!entry || typeof entry !== "object") continue;
      const text = stripMarkup((entry as Record<string, unknown>).content);
      if (text) return text;
    }
  }
  // **EMPTY STRING, NEVER A PLACEHOLDER.** Both shipped mappers read
  // `snippet ?? ""`, and the event mapper treats an empty snippet as a
  // deliberate "judge on the title alone" branch.
  return "";
}

// ───────────────────────────────────────────────────────────────────────────
// The provider
// ───────────────────────────────────────────────────────────────────────────

function fallbackMinResults(explicit: number | undefined): number {
  if (typeof explicit === "number") return Math.max(0, explicit);
  const raw = Number(process.env.GOOGLE_VERTEX_SEARCH_MIN_RESULTS);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return DEFAULT_FALLBACK_MIN_RESULTS;
}

/**
 * ABC-freemium 8-01(b) · Ruling 23 point 3. **THE GROUNDING BACKFILL IS OFF
 * UNLESS SOMEBODY TURNS IT ON, and the reason is the credit, not a taste.**
 *
 * This used to be OPT-OUT and it used to return `isGeminiSearchAvailable()`,
 * which is the other half of the coupling 8-01(a) removes: turning Vertex AI
 * Search on turned open-web grounding on with it, as a backfill *inside* the
 * very call the credit was paying for. Nobody chose that; it was a fallback.
 *
 * The credit that funds this path is restricted to Vertex AI Search and
 * Conversation and **cannot** be applied to Gemini API endpoints, which is
 * what grounding bills as. So left on by default it would spend real dollars
 * outside the credit, by default, on exactly the queries the credit exists to
 * cover.
 *
 * **Nothing is deleted and nothing is renamed.** The capability, its docblock,
 * its threshold and its headroom guard all stay exactly where they are; the
 * same variable that used to switch it off now switches it on, so anyone who
 * later wants coverage-over-cost turns it back on deliberately — one switch,
 * not two, so there is no half-set state. It also no longer reads the Gemini
 * signal, so a Vertex Search App can never enable it as a side effect.
 */
function fallbackEnabled(): boolean {
  const flag = process.env.GOOGLE_VERTEX_SEARCH_FALLBACK?.trim().toLowerCase();
  return flag === "on" || flag === "true" || flag === "1";
}

/**
 * One Vertex AI Search query, mapped to the shared `{title, url, snippet}`
 * contract, optionally page-kind-annotated, optionally backfilled.
 *
 * Every failure degrades to fewer rows or an empty array — never a partial row,
 * never a placeholder, never a host used as a title.
 */
export async function searchVertex(
  query: string,
  options: VertexSearchOptions = {},
): Promise<WebResult[]> {
  const deadlineAt = options.deadlineAt ?? Date.now() + VERTEX_SEARCH_BUDGET_MS;
  const limit =
    options.maxResults && options.maxResults > 0
      ? Math.min(options.maxResults, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const search = options.search ?? searchDiscoveryEngine;

  let rows: WebResult[] = [];
  try {
    const raw = await search(query, limit);
    const seen = new Set<string>();
    for (const result of raw) {
      const mapped = discoveryResultToWebResult(result);
      if (!mapped?.url) continue;
      if (isPreScreenedOut(mapped.url, options)) continue;
      if (seen.has(mapped.url)) continue;
      seen.add(mapped.url);
      rows.push(mapped);
      if (rows.length >= limit) break;
    }
  } catch (err) {
    console.error("[sources/vertex-search] search error:", err);
    rows = [];
  }

  if (
    options.detectPageKind &&
    rows.length > 0 &&
    deadlineAt - Date.now() > PAGE_KIND_MIN_HEADROOM_MS
  ) {
    rows = await annotatePageKind(rows, options);
  }

  if (
    rows.length < fallbackMinResults(options.fallbackMinResults) &&
    deadlineAt - Date.now() > GROUNDING_BACKFILL_MIN_HEADROOM_MS
  ) {
    rows = await backfillWithGrounding(query, rows, limit, deadlineAt, options);
  }

  return rows.slice(0, limit);
}

/**
 * Channel L for Vertex-sourced rows. **A failed fetch costs the row nothing** —
 * the title and snippet are already in hand, so an unreachable page just leaves
 * `pageKind` undefined, exactly as a reachable page with no JSON-LD would.
 */
async function annotatePageKind(
  rows: WebResult[],
  options: VertexSearchOptions,
): Promise<WebResult[]> {
  const fetchPages =
    options.fetchPages ??
    ((urls: string[]) => fetchPagesConcurrently(urls, PAGE_KIND_CONCURRENCY));
  // Only the leading rows are probed — they are in the index's own relevance
  // order, so this spends the budget where a declaration is worth most.
  const probed = rows.slice(0, PAGE_KIND_MAX_ROWS);
  let pages: Array<string | null>;
  try {
    pages = await fetchPages(probed.map((row) => row.url as string));
  } catch (err) {
    console.error("[sources/vertex-search] page-kind fetch error:", err);
    return rows;
  }
  return rows.map((row, index) =>
    index < probed.length && pageDeclaresEventFromHtml(pages[index] ?? null)
      ? { ...row, pageKind: "event" as const }
      : row,
  );
}

/**
 * THE BOUNDED GROUNDING BACKFILL — the deliberate, priced exception to "all
 * search runs on the credit".
 *
 * A site-scoped index cannot return a host it has never crawled, so a query
 * that comes back near-empty is precisely the case where open-web discovery is
 * still worth its price. Bounding it on a MINIMUM ROW COUNT, rather than
 * running it every time, is what keeps grounding a tail instead of the bill.
 */
async function backfillWithGrounding(
  query: string,
  rows: WebResult[],
  limit: number,
  deadlineAt: number,
  options: VertexSearchOptions,
): Promise<WebResult[]> {
  const ground =
    options.groundFallback ??
    (fallbackEnabled()
      ? (q: string, remaining: number) =>
          searchGemini(q, {
            denyHosts: options.denyHosts,
            excludeDomains: options.excludeDomains,
            maxResults: remaining,
            deadlineAt,
          })
      : null);
  if (!ground) return rows;

  const remaining = Math.max(1, limit - rows.length);
  let extra: WebResult[] = [];
  try {
    extra = await ground(query, remaining);
  } catch (err) {
    console.error("[sources/vertex-search] grounding backfill error:", err);
    return rows;
  }

  // Vertex rows keep their position: the index the credit pays for is the
  // preferred corpus, and grounding only tops it up.
  const seen = new Set(rows.map((row) => row.url));
  const merged = [...rows];
  for (const row of extra) {
    if (!row.url || seen.has(row.url)) continue;
    seen.add(row.url);
    merged.push(row);
  }
  return merged;
}
