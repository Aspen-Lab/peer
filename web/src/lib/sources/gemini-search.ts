import { GoogleGenAI } from "@google/genai";
import { PROVIDER_MODELS } from "@/lib/llm/provider-models";
import {
  fetchPagesConcurrently,
  UNFETCHABLE_HOSTS,
} from "@/lib/opportunities/page-fetch";
import { cleanDisplayText } from "@/lib/text/clean";
import type { WebSearchProvider } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// RULING 75 — THE `gemini` WEB-SEARCH PROVIDER.
//
// The user suspended every quota-capped search API (Tavily, Adzuna, USAJobs,
// JSearch). Vertex Gemini with Google Search grounding replaces the search seam
// and this module is the whole of it: one grounded call per query, then the two
// recovery stages that turn grounding metadata into the `{title, url, snippet}`
// contract the three surfaces already consume.
//
// **Every design choice below is a MEASUREMENT, not a preference.** Round 28 B
// probed the live endpoint and round 28 C reproduced the four that matter before
// writing a line (2026-08-15, `gemini-2.5-flash`, one grounded query):
//
//   1. `groundingChunks[].web` carries `{uri, title, domain}` and NOTHING else.
//   2. Every `uri` is a `vertexaisearch.cloud.google.com/grounding-api-redirect/…`
//      token. HEAD with `redirect:"manual"` returned 302 + `Location` on 5 of 5
//      (B: 64 of 64) in ~400 ms; a corrupted token returned 404 with NO
//      `Location`. So "drop what will not resolve" is a decidable rule.
//   3. **`web.title` IS THE REGISTRABLE DOMAIN — 5 of 5 here, 64 of 64 for B.**
//      Not a page title. `byu.edu`, `grc.org`, `programmaster.org`.
//   4. One grounded call measured 10012 ms here (B: 3364–12087 ms), against a
//      shipped 8000 ms per-source budget. See RULING 76a.
//
// Fact 3 is the one that shapes everything. Passing the chunk title through as
// a result title is the cheap implementation and B measured what it costs:
// replayed through the SHIPPED, unmodified job admission it admits **31 of 40
// rows with a bare hostname as the role title** — manufacturing A22-01 /
// 62d(b) / 63a / A26-01 at scale. Recovering the page's OWN title after the
// redirect admits 16 and keeps the round-27 LANL must-keep `Nuclear Materials
// and Molten Salt Technologist 1`. **The title comes from the page or the row
// does not exist.**
//
// And the model's prose is NEVER a snippet. B asked for a strict
// `TITLE ||| SNIPPET` format and got five paragraphs; `groundingSupports`
// segments are the model's own sentences, not the page's. A generated sentence
// fed to `extractEventDate` / `cleanJobDescription` would let a GENERATED date
// become a RENDERED date — the exact invention round 27 item 4 exists to stop.
// Page-derived text is what Tavily's `content` and Brave's `description`
// already are, and it is the only honest analogue.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The result contract shared by all three surfaces. `sources/web-search.ts`
 * maps it to `RawItem`, `events/sources/eventweb.ts` to `RawEventItem` via
 * `webResultToRawEventItem`, and `jobs/sources/jobweb.ts` to `RawJobItem` via
 * `webResultToRawJobItem`. Those three mappers stay exactly where they are —
 * jobweb's search functions return already-mapped rows and eventweb's return
 * unmapped ones, so this shape is the only return type that fits both.
 */
export interface WebResult {
  title?: string;
  url?: string;
  snippet?: string;
  /**
   * ROUND 29 C, ITEM 1 — **THE CONTRACT CHANGE, AND IT IS THE WHOLE POINT OF
   * CHANNEL L.** Round 29 B's item 7 §7.2 established the placement problem
   * exactly: `webResultToRawEventItem`'s entire input is `{title, url,
   * snippet}`, so every guard in that chain is title-and-URL only *by
   * construction* and a page-declared signal **cannot be tested there at all**
   * — there is nothing to test. Meanwhile `searchGemini` already holds the raw
   * HTML (`fetchPages` below) and throws it away after reading two fields.
   *
   * This optional field is B's **option B**: the adapter passes the page's own
   * declaration along and **each surface keeps its own policy** — the event
   * mapper admits on it, the job mapper ignores it, the paper surface may one
   * day welcome it. The adapter itself still makes **no kind decision**; B's
   * option A (refusing in the adapter) was rejected for exactly that reason and
   * is not implemented.
   *
   * **It carries only what the publisher put in the markup.** It is never
   * inferred from the host, the title, the URL or model prose, so it cannot be
   * invented: the `@type` either is in the page's JSON-LD or it is not.
   */
  pageKind?: "event";
}

/**
 * RULING 76a. The per-source budget for a gemini web search, applied at the two
 * opportunity-pipeline call sites ONLY — never as a global default.
 * `withSourceTimeout` defaults to 8000 ms and a single grounding call measured
 * 10012 ms, so on the shipped budget this provider provably returns NOTHING.
 * The slower census is a priced, accepted consequence of Ruling 75.
 */
export const GEMINI_SOURCE_TIMEOUT_MS = 25_000;

/**
 * The soft internal deadline, deliberately under `GEMINI_SOURCE_TIMEOUT_MS`.
 *
 * **Why a soft deadline exists at all** (a traced deviation from B's design,
 * logged in §4): `withSourceTimeout` REJECTS the whole source when it fires, so
 * one slow page fetch past 25 s turns a 60-row census into ZERO rows. B's own
 * arithmetic reaches the cliff — a 16-query event fan-out is ~6 s ground +
 * 1.2 s resolve + up to ~27 s of page titles. Stopping title recovery at the
 * deadline returns the rows that DID resolve instead of returning nothing, and
 * it does not weaken any rule: a row past the deadline has no page title, and a
 * row with no page title is DROPPED like any other.
 */
const GEMINI_SEARCH_BUDGET_MS = 21_000;

/** Redirect resolution is a header read; the target page is never fetched. */
const REDIRECT_TIMEOUT_MS = 7_000;
const REDIRECT_CONCURRENCY = 8;

/**
 * Title recovery runs wider than `fetchPagesConcurrently`'s default 8. B's
 * adversarial pass priced a full event fan-out at ~112 page fetches; at 8 that
 * is ~27 s of the 25 s budget spent on titles alone.
 */
const TITLE_CONCURRENCY = 16;

/**
 * **A DOCUMENTED, TESTED CHOICE, NOT AN IMPLEMENTATION DETAIL** (B's adversarial
 * item 8 names it as such). Grounding returned 4–13 chunks per query against a
 * requested 10, so `RESULTS_PER_SEARCH` is ADVISORY on this provider in both
 * directions — it cannot be asserted on. This cap bounds the page fetches a
 * single query can commission, in grounding order, which is the model's own
 * relevance order. Capping BEFORE stage 3 changes which rows exist, so it is
 * stated here and covered by its own test.
 */
const MAX_CHUNKS_PER_QUERY = 10;

const GROUNDING_REDIRECT_PREFIX =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";

/** The model B probed and C reproduced. Kept on the shared constant. */
const GEMINI_SEARCH_MODEL = PROVIDER_MODELS.gemini.large;

/**
 * A grounding chunk's web member, exactly as measured. `title` is named here
 * only so the type is honest about what the API returns — **it is a hostname
 * and this module never reads it.**
 */
export interface GroundingWebChunk {
  uri?: string;
  title?: string;
  domain?: string;
}

export interface GeminiSearchOptions {
  /**
   * Hosts the calling surface denies outright, title-independent. Stage 2b
   * skips them before paying for a page fetch. **Only outright denies belong
   * here.** `eventweb`'s `DENY_HOSTS` qualifies (verified title-independent);
   * `jobweb`'s `AGGREGATOR_HOSTS` does NOT — that list requires a posting id
   * rather than denying, so pre-screening on it would change admissions.
   */
  denyHosts?: readonly string[];
  /** Domain exclusions the surface already passes to Tavily, mirrored here. */
  excludeDomains?: readonly string[];
  /** Upper bound on rows entering stage 3. The surface's own per-source limit. */
  maxResults?: number;
  /** Shared wall-clock deadline for a whole fan-out. */
  deadlineAt?: number;
  /** Test seam: replaces the live grounded call. Production leaves it unset. */
  ground?: (query: string) => Promise<GroundingWebChunk[]>;
  /** Test seam: replaces redirect resolution. Production leaves it unset. */
  resolveRedirect?: (uri: string) => Promise<string | null>;
  /** Test seam: replaces page fetching. Production leaves it unset. */
  fetchPages?: (urls: string[]) => Promise<Array<string | null>>;
}

/**
 * Vertex presence, and **nothing else**.
 *
 * `canUseLocalServerProvider()` is NOT called, copied or touched. Its
 * deployed-user safety comment governs MODEL SPEND and is a recorded decision
 * this design leaves exactly where it is (B flags, does not reverse). If
 * `registry.test.ts` ever moves, that boundary was crossed.
 */
export function isGeminiSearchAvailable(): boolean {
  return Boolean(process.env.GOOGLE_VERTEX_PROJECT);
}

/**
 * RULING 75 requirement 2, in one place so all three surfaces agree:
 * explicit preference → `gemini` when Vertex credentials are present AND Tavily
 * is not enabled → `brave` → `tavily`.
 *
 * When Vertex is absent this returns exactly what the shipped `resolveProvider`
 * returned, branch for branch — the gemini clause is additive.
 */
export function resolveWebSearchProvider(
  preferred: WebSearchProvider | undefined,
  availability: {
    geminiAvailable: boolean;
    /**
     * Vertex AI Search availability — OPTIONAL so every caller written before
     * the credit migration still type-checks and still resolves exactly as it
     * did. Absent is treated as absent, never as available.
     */
    vertexAvailable?: boolean;
    braveKeyPresent: boolean;
    tavilyKeyPresent: boolean;
    /** A Tavily key the CALLER supplied — the signal that Tavily is enabled. */
    requestTavilyKeyPresent: boolean;
  },
): Exclude<WebSearchProvider, "auto"> | null {
  if (preferred === "vertex") {
    return availability.vertexAvailable ? "vertex" : null;
  }
  if (preferred === "gemini") {
    return availability.geminiAvailable ? "gemini" : null;
  }
  if (preferred === "brave") {
    return availability.braveKeyPresent ? "brave" : null;
  }
  if (preferred === "tavily") {
    return availability.tavilyKeyPresent ? "tavily" : null;
  }
  // Auto — REWRITTEN by ABC-freemium 2-04 (Ruling 5 point 2, R-KEY-3 as amended
  // 2026-09-05). The two clauses that used to jump Vertex and grounding ahead
  // of everything are gone.
  //
  // The old order let an **uncounted, unmetered** provider outrank the gated,
  // metered one: Vertex and grounding were chosen first whenever the server had
  // a Vertex project, and neither charged the breaker nor wrote a usage row. The
  // spend order is now the arrow chain R-KEY-3 states, cheapest-to-the-owner
  // first:
  //
  //   1. the reader's OWN Tavily key — costs the operator nothing;
  //   2. the system Tavily key — gated AND metered, so a spend is visible;
  //   3. Brave / Vertex / grounding — local-only (all three are banned on
  //      Vercel by the build guard), in the order Ruling 5 point 2 writes them;
  //   4. nothing, and the surface serves its free structured sources.
  //
  // Every one of these is now charged and metered by `isOperatorFundedSearch`
  // at the adapters, so the principle "an uncounted provider never outranks the
  // gated, metered one" holds under any order within group 3.
  //
  // Note there is no longer a `!requestTavilyKeyPresent` condition anywhere: a
  // reader with their own key now simply wins outright, which is what clause 1
  // says and is simpler than the three-way interaction it replaces.
  if (availability.requestTavilyKeyPresent) return "tavily";
  if (availability.tavilyKeyPresent) return "tavily";
  if (availability.braveKeyPresent) return "brave";
  if (availability.vertexAvailable) return "vertex";
  if (availability.geminiAvailable) return "gemini";
  return null;
}

/**
 * The `webSearch` block a pipeline builds when Tavily is not enabled.
 *
 * **This is the change that turns the web surfaces back on.** Both opportunity
 * pipelines built `webSearch` ONLY under `searchConnectors.tavily.enabled`, so
 * with `tavilyEnabled:false` the query carried no `webSearch` at all, both
 * adapters' `enabled()` returned false, and the paper surface returned `[]`.
 * The Tavily branch at each call site is left exactly as it shipped.
 *
 * **THE THREE PIPELINES NO LONGER CALL THIS DIRECTLY.** They call
 * `sources/vertex-search.ts`'s `webSearchOptions`, which prefers Vertex AI
 * Search when a Search App is configured and otherwise delegates here byte for
 * byte. This function stays exported, unchanged, as the gemini-only path and
 * for its own tests.
 */
export function geminiWebSearchOptions(
  connectors: { gemini?: { enabled?: boolean } } | undefined,
): { provider: WebSearchProvider } | undefined {
  if (connectors?.gemini?.enabled === false) return undefined;
  return isGeminiSearchAvailable() ? { provider: "gemini" } : undefined;
}

const clients = new Map<string, GoogleGenAI>();

function getSearchClient(): GoogleGenAI | null {
  const project = process.env.GOOGLE_VERTEX_PROJECT;
  if (!project) return null;
  const location = process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1";
  const key = `${project}:${location}`;
  const cached = clients.get(key);
  if (cached) return cached;
  // Built the way `llm/providers/gemini.ts:getClient` builds it. The CONFIG is
  // what cannot be shared: `genConfig` sets `responseMimeType:"application/json"`
  // unconditionally and Vertex returns **400 INVALID_ARGUMENT — controlled
  // generation is not supported with Search tool**. Hence a separate path.
  const client = new GoogleGenAI({ vertexai: true, project, location });
  clients.set(key, client);
  return client;
}

/**
 * STAGE 1 — GROUND. One `generateContent` per query.
 *
 * No `responseMimeType` (refused with the Search tool) and no `maxOutputTokens`
 * (measured to throttle CHUNK COUNT, not latency: none → 13 chunks, 256 → 3,
 * 64 → 0). Zero chunks is a normal answer, not an error — a nonsense query and
 * a non-web question both returned `groundingMetadata` present with
 * `groundingChunks` an EMPTY ARRAY.
 */
async function groundQuery(query: string): Promise<GroundingWebChunk[]> {
  const client = getSearchClient();
  if (!client) return [];
  try {
    const response = await client.models.generateContent({
      model: GEMINI_SEARCH_MODEL,
      contents: query,
      config: { tools: [{ googleSearch: {} }] },
    });
    return groundingWebChunks(response);
  } catch (err) {
    console.error("[sources/gemini-search] grounding error:", err);
    return [];
  }
}

/**
 * Pull the `web` chunks out of a grounding response.
 *
 * **Filters on `chunk.web` presence rather than assuming.** The SDK's
 * `GroundingChunk` union also carries `maps`, `retrievedContext` and `image`
 * kinds. Those were 0 of 64 in B's windows and 0 of 5 in C's — **UNWITNESSED,
 * not cleared** — so the filter is written for them anyway.
 */
export function groundingWebChunks(response: unknown): GroundingWebChunk[] {
  if (!response || typeof response !== "object") return [];
  const candidates = (response as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const first = candidates[0];
  if (!first || typeof first !== "object") return [];
  const metadata = (first as { groundingMetadata?: unknown }).groundingMetadata;
  if (!metadata || typeof metadata !== "object") return [];
  const chunks = (metadata as { groundingChunks?: unknown }).groundingChunks;
  if (!Array.isArray(chunks)) return [];

  const web: GroundingWebChunk[] = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const member = (chunk as { web?: unknown }).web;
    if (!member || typeof member !== "object") continue;
    const uri = (member as { uri?: unknown }).uri;
    if (typeof uri !== "string" || !uri) continue;
    web.push({
      uri,
      title: typeof (member as { title?: unknown }).title === "string"
        ? (member as { title: string }).title
        : undefined,
      domain: typeof (member as { domain?: unknown }).domain === "string"
        ? (member as { domain: string }).domain
        : undefined,
    });
  }
  return web;
}

/**
 * STAGE 2 — RESOLVE (mandatory, Ruling 75 requirement 1).
 *
 * The loop's guards read URL SHAPES — `JOB_PATH_RE`, the aggregator posting-id
 * rule, the host allow/deny lists all parse the path. An opaque redirect token
 * carries none of that, so every row must be resolved to its real target before
 * anything downstream sees it.
 *
 * HEAD is as good as GET (both 302, both ~300–480 ms) and **the target page is
 * never fetched here**. `status !== 302 || !location` → `null` → the row is
 * DROPPED. There is nothing to build a fake URL out of, which is the point.
 */
export async function resolveGroundingRedirect(
  uri: string,
): Promise<string | null> {
  if (!uri.startsWith(GROUNDING_REDIRECT_PREFIX)) {
    // Not a redirect token. Measured 64/64 and 5/5 that every grounding uri IS
    // one, so this branch is defensive: a direct URL is passed through rather
    // than dropped, because it needs no resolution to be readable downstream.
    return isHttpUrl(uri) ? uri : null;
  }
  try {
    const response = await fetch(uri, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
    });
    if (response.status !== 302) return null;
    const location = response.headers.get("location");
    if (!location || !isHttpUrl(location)) return null;
    return location;
  } catch {
    return null;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostMatches(host: string, list: readonly string[]): boolean {
  return list.some((entry) => {
    const needle = entry.toLowerCase().replace(/^www\./, "");
    return host === needle || host.endsWith(`.${needle}`);
  });
}

/**
 * STAGE 2b — HOST PRE-SCREEN, and its boundary.
 *
 * Only OUTRIGHT, TITLE-INDEPENDENT denies belong here, because skipping a row
 * before stage 3 must not be able to change an admission. `UNFETCHABLE_HOSTS`
 * qualifies (the page fetch would return null anyway) and so does the event
 * surface's `DENY_HOSTS`. **`AGGREGATOR_HOSTS` deliberately does NOT** — jobweb
 * does not deny those hosts, it REQUIRES a posting id on them, so pre-screening
 * there would drop rows the shipped rule admits. Admission-neutrality is proved
 * by test, not by this comment.
 */
export function isPreScreenedOut(
  url: string,
  options: { denyHosts?: readonly string[]; excludeDomains?: readonly string[] },
): boolean {
  const host = hostOf(url);
  if (!host) return true;
  if (hostMatches(host, UNFETCHABLE_HOSTS)) return true;
  if (options.denyHosts && hostMatches(host, options.denyHosts)) return true;
  if (options.excludeDomains && hostMatches(host, options.excludeDomains)) {
    return true;
  }
  return false;
}

const TITLE_TAG_RE = /<title\b[^>]*>([\s\S]{0,600}?)<\/title\s*>/i;
const META_TAG_RE = /<meta\b([^>]*)>/gi;

function attributeValue(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  );
  const match = attributes.match(pattern);
  if (!match) return undefined;
  return match[2] ?? match[3] ?? match[4];
}

function metaContent(html: string, keys: readonly string[]): string | undefined {
  for (const match of html.matchAll(META_TAG_RE)) {
    const attributes = match[1] ?? "";
    const key = (
      attributeValue(attributes, "property") ?? attributeValue(attributes, "name")
    )?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const content = attributeValue(attributes, "content");
    const cleaned = cleanDisplayText(content);
    if (cleaned) return cleaned;
  }
  return undefined;
}

/**
 * STAGE 3, TITLE HALF — `og:title`, else the `<title>` element.
 *
 * This is the page's OWN name for itself, which is exactly what Tavily's and
 * Brave's `title` fields are. It is NOT the grounding chunk's title, which is a
 * hostname (fact 3), and it is NOT anything the model wrote.
 */
/**
 * A29-06 (round 29 C, item 5). **ONE SEAM, ONE EXTRA PASS, MEASURED IDEMPOTENT
 * ON EVERY ADVERSARIAL SHAPE ROUND 29 B COULD BUILD.**
 *
 * A page that escaped its own title TWICE (`R&amp;amp;D Intern`) reaches a card
 * reading `R&amp;D Intern`: `cleanDisplayText` decodes one entity layer and one
 * layer is left. **The decoder is not broken — it runs once against a page that
 * escaped twice.**
 *
 * **REPEAT-UNTIL-STABLE WITH A HARD CAP OF 2, and each half of that is
 * deliberate.** Not unbounded: an unbounded loop over attacker-shaped input is a
 * cost with no measured benefit, and 2 passes covers every sighting. Not
 * "always decode twice" either: repeat-until-stable is the same result on every
 * measured case **and is self-documenting about why it stops.**
 *
 * **B's ADVERSARIAL SET — the titles whose LITERAL text contains an entity —
 * are all idempotent, 4 of 4:** `Writing &amp; in HTML: a guide`,
 * `Ampersand (&amp;) escaping workshop`, `R&amp;D Intern`,
 * `AT&amp;T Labs Intern`. Once an entity is decoded to a bare `&`, a second
 * pass has nothing left to match.
 *
 * **THE ONE COST, NAMED HONESTLY RATHER THAN PRESENTED AS A CLEAN FIX:** a page
 * whose title is *meant* to display the seven characters `&amp;` — a document
 * about HTML escaping that escaped itself correctly as `&amp;amp;` — **is
 * byte-identical to this defect by construction. There is no signal that
 * separates them and none is invented here.** The trade is one
 * literal-`&amp;`-displaying title lost against every double-escaped real title
 * recovered. **1 of 716 offered rows, 0.14% — the loop's smallest ranked item,
 * not inflated.**
 *
 * **WHY HERE AND NOT IN `cleanDisplayText`:** that function is shared by the
 * whole rendering surface, and changing it would move behaviour on rows this
 * item never measured. **The defect is in what the adapter reads out of raw
 * HTML, so the repair belongs where the raw HTML is read.** `text/clean.ts` and
 * its tests are untouched — if `clean.test.ts` ever moves for this item, the
 * repair was made in the shared function instead of at the seam.
 */
const TITLE_DECODE_MAX_PASSES = 2;

function decodeTitleUntilStable(once: string): string {
  // `once` has already had pass 1 applied by `metaContent` or by the `<title>`
  // branch below, so this loop spends the REMAINING passes.
  let current = once;
  for (let pass = 1; pass < TITLE_DECODE_MAX_PASSES; pass += 1) {
    const next = cleanDisplayText(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

export function pageTitleFromHtml(html: string | null): string | undefined {
  if (!html) return undefined;
  const og = metaContent(html, ["og:title"]);
  if (og) return decodeTitleUntilStable(og);
  const match = html.match(TITLE_TAG_RE);
  // **ABSENT TITLE ⇒ NOTHING TO DECODE.** The row still DROPS on no-title
  // exactly as it did; this adds no admission and invents nothing.
  const fromTag = cleanDisplayText(match?.[1]);
  return fromTag ? decodeTitleUntilStable(fromTag) : undefined;
}

/**
 * STAGE 3, SNIPPET HALF — `og:description`, else the plain meta description.
 *
 * **No description is the EMPTY STRING, never a drop and never model prose.**
 * Both shipped mappers already read `result.snippet ?? ""`; the event mapper's
 * dateless branch is explicitly unaffected by an empty snippet.
 */
export function pageSnippetFromHtml(html: string | null): string {
  if (!html) return "";
  return metaContent(html, ["og:description", "description"]) ?? "";
}

/**
 * ROUND 29 C, ITEM 1 — **CHANNEL L. THE PAGE'S OWN `schema.org` `@type`.**
 *
 * **Why this is here and not next to the guard that uses it:** round 29 B's
 * item 7 §7.2. The guard chain never sees the HTML; this function does, off the
 * SAME buffer `pageTitleFromHtml` and `pageSnippetFromHtml` already read, so it
 * costs **no extra fetch**.
 *
 * **Why a publisher declaration outranks a keyword:** "this page is an Event"
 * is the publisher stating the kind, and it cannot be manufactured — it is in
 * the markup or it is not. Round 29 B's §1.4 measured **zero** adversarial
 * cost: no non-event page in B's set declares `@type: Event`.
 *
 * **THE TYPE LIST IS CLOSED, AND ITS EXCLUSIONS ARE THE LOAD-BEARING HALF.**
 * `WebPage`, `Organization`, `BreadcrumbList`, `LocalBusiness` and `JobPosting`
 * are **not** kind evidence. `euchemsil2026.com` declares `LocalBusiness` and is
 * **deliberately** excluded — a page describing a venue is not a page
 * describing an event. Widening this list past B's measured set is a new
 * design, not a tidy-up.
 *
 * **Deliberately NOT a substring test on `…event`.** `structured-extract.ts`'s
 * `opportunityKind` matches `type.endsWith("event")`, which is right for a
 * page Peer has already decided to enrich and wrong for a KIND gate deciding
 * whether a row exists at all — `NonProfitEvent`, `PastEvent` and any vendor's
 * `FooEvent` would all become admissions on an unmeasured boundary.
 */
const SCHEMA_EVENT_TYPES: ReadonlySet<string> = new Set([
  "event",
  "businessevent",
  "educationevent",
  "exhibitionevent",
  "festival",
  "socialevent",
  "courseinstance",
]);

const LD_JSON_BLOCK_RE =
  /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]{0,200000}?)<\/script\s*>/gi;
const LD_TYPE_VALUE_RE = /"@type"\s*:\s*(?:"([^"]*)"|\[([^\]]*)\])/gi;

/** `http://schema.org/Event` and `Event` are the same declaration. */
function schemaTypeToken(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("#"));
  return trimmed.slice(separator + 1).toLowerCase();
}

export function pageDeclaresEventFromHtml(html: string | null): boolean {
  if (!html) return false;
  for (const block of html.matchAll(LD_JSON_BLOCK_RE)) {
    const body = block[1] ?? "";
    for (const match of body.matchAll(LD_TYPE_VALUE_RE)) {
      // A scalar `"@type": "Event"`, or an array `"@type": ["Event", "Place"]`
      // — read by regex rather than `JSON.parse` on purpose: a malformed or
      // truncated JSON-LD block is common in the wild, and a parse failure
      // there would silently turn channel L off for the whole page.
      const raw = match[1] ?? match[2] ?? "";
      for (const candidate of raw.split(",")) {
        const token = schemaTypeToken(candidate.replace(/["']/g, ""));
        if (SCHEMA_EVENT_TYPES.has(token)) return true;
      }
    }
  }
  return false;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

/**
 * One grounded search, all three stages, drop-on-undecidable throughout.
 *
 * Returns the shared `{title, url, snippet}` contract. **Every returned row has
 * a real target URL and the page's own title.** Any failure at any stage
 * degrades to fewer rows or an empty array — the pipeline then reports zero
 * fetched, records the reason in `errors[sourceId]`, and the report renders that
 * surface honestly empty. No partial row, no placeholder, no host-as-title.
 */
export async function searchGemini(
  query: string,
  options: GeminiSearchOptions = {},
): Promise<WebResult[]> {
  const deadlineAt = options.deadlineAt ?? Date.now() + GEMINI_SEARCH_BUDGET_MS;
  const ground = options.ground ?? groundQuery;
  const resolve = options.resolveRedirect ?? resolveGroundingRedirect;
  const fetchPages =
    options.fetchPages ??
    ((urls: string[]) => fetchPagesConcurrently(urls, TITLE_CONCURRENCY));

  const chunks = (await ground(query)).slice(0, MAX_CHUNKS_PER_QUERY);
  if (chunks.length === 0) return [];

  const resolved = await mapWithConcurrency(
    chunks,
    REDIRECT_CONCURRENCY,
    (chunk) => (chunk.uri ? resolve(chunk.uri) : Promise.resolve(null)),
  );

  // Dedup runs HERE and can run nowhere earlier: the redirect tokens are opaque
  // and per-call (64 of 64 unique across queries in B's windows), so every
  // shipped dedup key — `web:<url>`, `eventweb:urlHashId(url)`, jobweb's id —
  // would see distinct rows for the same page. A collision on the RESOLVED url
  // was not sighted, only constructed; that is not proof it cannot happen.
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const url of resolved) {
    if (!url) continue;
    if (isPreScreenedOut(url, options)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    targets.push(url);
  }
  const capped =
    options.maxResults && options.maxResults > 0
      ? targets.slice(0, options.maxResults)
      : targets;
  if (capped.length === 0) return [];
  if (Date.now() >= deadlineAt) return [];

  const pages = await fetchPages(capped);
  const results: WebResult[] = [];
  capped.forEach((url, index) => {
    const title = pageTitleFromHtml(pages[index] ?? null);
    // **NO TITLE → DROP.** The alternative — the chunk's hostname — is measured
    // to admit 31 of 40 job rows under a bare host name. An honest gap beats a
    // manufactured row.
    if (!title) return;
    // ROUND 29 C, ITEM 1 — channel L rides the SAME buffer as the two fields
    // above. The adapter reads the declaration and passes it on; it does not
    // act on it (B item 7 §7.2, option B). `pageKind` is left undefined when
    // the page declares nothing, so a row from a page with no JSON-LD is
    // byte-identical to what this adapter returned before this item.
    const pageKind = pageDeclaresEventFromHtml(pages[index] ?? null)
      ? ("event" as const)
      : undefined;
    results.push({
      title,
      url,
      snippet: pageSnippetFromHtml(pages[index] ?? null),
      ...(pageKind ? { pageKind } : {}),
    });
  });
  return results;
}

/**
 * The shared wall-clock deadline for a whole fan-out, so sixteen concurrent
 * queries stop fetching titles at the same moment rather than each getting its
 * own fresh budget.
 */
export function geminiSearchDeadline(startedAt = Date.now()): number {
  return startedAt + GEMINI_SEARCH_BUDGET_MS;
}
