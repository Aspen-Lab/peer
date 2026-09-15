import { NextRequest, NextResponse } from "next/server";
import { runFeedPipeline } from "@/lib/feed/pipeline";
import type { FeedRequest, SearchConnectors } from "@/lib/feed/types";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { SourceId } from "@/lib/sources/types";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import {
  entitledAiTier,
  requireEntitledAiRequest,
} from "@/lib/security/ai-request";

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
};

function cleanStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0);
}

function parseSources(input: unknown): SourceId[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const valid: SourceId[] = [
    "openalex",
    "semantic_scholar",
    "arxiv",
    "dblp",
    "pubmed",
    "web",
    "hn",
  ];
  const out = input.filter((s): s is SourceId =>
    valid.includes(s as SourceId),
  );
  return out.length > 0 ? out : undefined;
}

function parseAiTier(input: unknown): 0 | 1 | 2 | undefined {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return undefined;
  if (n >= 2) return 2;
  if (n <= 0) return 0;
  return 1;
}

function cleanOptionalString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0
    ? input.trim()
    : undefined;
}

function parseSearchConnectors(input: unknown): SearchConnectors | undefined {
  if (!input || typeof input !== "object") return undefined;
  const maybeObject = input as Record<string, unknown>;
  const tavilyRaw =
    maybeObject.tavily && typeof maybeObject.tavily === "object"
      ? (maybeObject.tavily as Record<string, unknown>)
      : null;
  if (!tavilyRaw) return undefined;

  const enabled =
    typeof tavilyRaw.enabled === "boolean" ? tavilyRaw.enabled : undefined;
  const apiKey = cleanOptionalString(tavilyRaw.apiKey);
  const tavily =
    enabled === undefined && apiKey === undefined
      ? undefined
      : { enabled, apiKey };

  // RULING 75 — the gemini connector carries no key (the credential is the
  // server's own Vertex project) and only ever expresses an OPT-OUT. An absent
  // connector means "use it when Vertex is present and Tavily is not enabled".
  const gemini = parseGeminiConnector(maybeObject.gemini);

  if (!tavily && !gemini) return undefined;
  return { ...(tavily ? { tavily } : {}), ...(gemini ? { gemini } : {}) };
}

function parseGeminiConnector(
  input: unknown,
): { enabled: boolean } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const enabled = (input as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? { enabled } : undefined;
}

function parseLlmOverride(input: unknown): ProviderOverrideConfig | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const provider = cleanOptionalString(value.provider);
  const apiKey = cleanOptionalString(value.apiKey);
  const model = cleanOptionalString(value.model);

  if (!provider || !apiKey) return undefined;
  if (!["openai", "gemini", "anthropic", "qwen", "deepseek"].includes(provider)) return undefined;

  return {
    provider: provider as ProviderOverrideConfig["provider"],
    apiKey,
    model,
  };
}

function parseAffiliation(
  input: unknown,
): { authorId: string; seedWorkIds?: string[] } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const authorId = typeof value.authorId === "string" ? value.authorId.trim() : "";
  if (!/^A\d+/.test(authorId)) return undefined;
  const seedWorkIds = Array.isArray(value.seedWorkIds)
    ? value.seedWorkIds.filter((x): x is string => typeof x === "string")
    : undefined;
  return { authorId, seedWorkIds };
}

function parseExcludeIds(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out = input
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  // Cap to a reasonable size so a runaway client can't ship a huge payload.
  // 800 covers ~14 days of daily 10-paper digests with a wide margin.
  return out.length > 0 ? out.slice(0, 800) : undefined;
}

export async function POST(req: NextRequest) {
  let body: Partial<FeedRequest>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topics = cleanStringArray(body.topics);
  if (topics.length === 0) {
    return NextResponse.json(
      { error: "topics array is required and must contain at least one string" },
      { status: 400 },
    );
  }

  const softTopics = cleanStringArray(body.softTopics);
  const methods = cleanStringArray(body.methods);
  const venues = cleanStringArray(body.venues);
  const seedTexts = cleanStringArray(body.seedTexts);
  const negativeTopics = cleanStringArray(body.negativeTopics);
  const preferenceLedger = cleanPreferenceLedger(body.preferenceLedger);
  const requestedAiTier = parseAiTier(body.aiTier) ?? 0;
  const llmOverride = parseLlmOverride(body.llmOverride);
  // ABC-freemium 1-06 · R-SEC-2, R-SEC-3 — **the entitlement is resolved BEFORE
  // the provider, and it is what caps the tier.** The old line here downgraded
  // because *no provider resolved*, which stops being a defence the moment
  // R-KEY-1 makes one always resolve; this downgrades because the caller is
  // *not entitled*, which no request body can change.
  //
  // `allowAnonymous` keeps R-ENT-4's "signed-out users get tier-0 behaviour
  // everywhere ... unchanged": a stranger still gets a feed built from free
  // structured sources, and `entitledAiTier` caps them at 0 so they reach
  // neither a provider nor the system search key.
  const gate = await requireEntitledAiRequest("paper-feed", 60, {
    allowAnonymous: true,
  });
  if (gate instanceof NextResponse) return gate;
  const { entitlement } = gate;
  const aiTier = entitledAiTier(requestedAiTier, entitlement);
  //
  // **The route no longer resolves a provider itself.** It only ever did so to
  // decide the downgrade, and R-SEC-3 replaces that predicate with the
  // entitlement above; the value was never passed on, because the pipeline
  // resolves its own provider where it needs one. Deleting the call removes a
  // redundant provider construction per feed request and leaves exactly one
  // reason a tier can drop. The pipeline's own degrade paths are unchanged —
  // `query-gen.ts` returns template queries and `tier2-rerank.ts` returns the
  // input order when no provider resolves.

  const result = await runFeedPipeline({
    topics,
    softTopics: softTopics.length > 0 ? softTopics : undefined,
    methods: methods.length > 0 ? methods : undefined,
    venues: venues.length > 0 ? venues : undefined,
    seedTexts: seedTexts.length > 0 ? seedTexts : undefined,
    preferenceLedger:
      Object.keys(preferenceLedger).length > 0 ? preferenceLedger : undefined,
    negativeTopics: negativeTopics.length > 0 ? negativeTopics : undefined,
    sources: parseSources(body.sources),
    perSourceLimit: body.perSourceLimit,
    topN: body.topN,
    weights: body.weights,
    sourceWeights: body.sourceWeights,
    controls: body.controls,
    aiTier,
    searchConnectors: parseSearchConnectors(body.searchConnectors),
    llmOverride,
    affiliation: parseAffiliation(body.affiliation),
    excludeIds: parseExcludeIds(body.excludeIds),
  });

  return NextResponse.json(result, { headers: CACHE_HEADERS });
}

export async function GET(req: NextRequest) {
  const topics = (req.nextUrl.searchParams.get("topics") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (topics.length === 0) {
    return NextResponse.json(
      { error: "topics query param required (comma-separated)" },
      { status: 400 },
    );
  }

  const methods = (req.nextUrl.searchParams.get("methods") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const sources = parseSources(
    (req.nextUrl.searchParams.get("sources") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const topN = parseInt(req.nextUrl.searchParams.get("topN") || "30", 10);

  const result = await runFeedPipeline({
    topics,
    methods: methods.length > 0 ? methods : undefined,
    sources,
    topN: Number.isFinite(topN) ? topN : 30,
  });

  return NextResponse.json(result, { headers: CACHE_HEADERS });
}
