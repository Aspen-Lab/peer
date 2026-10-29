import { NextRequest, NextResponse } from "next/server";
import { GET as searchOpenAlex } from "../route";
import { requireAiRequest } from "@/lib/security/ai-request";
import { isLocalDevRuntime } from "@/lib/env/local-dev";
import { normalizeFeedIntent } from "@/lib/feed/intent";
import { parseJevApiKey } from "@/lib/decisions/jev-key";
import { InMemoryDecisionCache } from "@/lib/decisions/decision-cache";
import { PrivateDecisionCache } from "@/lib/decisions/private-decision-cache";
import { screenWithJev } from "@/lib/decisions/screen";
import { screenShortlist } from "@/lib/decisions/apply";

const NO_STORE = { "Cache-Control": "private, no-store" };
const localCache = new InMemoryDecisionCache();
const ALLOWED_FILTERS = ["from", "to", "oa", "cites", "src", "venue"] as const;
const MAX_RESULTS = 12;
export const maxDuration = 60;

interface Candidate {
  id: string;
  title: string;
  abstract: string;
  venue: string;
  [field: string]: unknown;
}

/** Search remains OpenAlex; Jev only ranks the returned candidates for this query. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const key = parseJevApiKey(body.jevApiKey);
  if (query.length < 2 || query.length > 250 || !key || typeof body.filters !== "string" || body.filters.length > 1024) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  const incoming = new URLSearchParams(body.filters);
  if (incoming.get("sort") && incoming.get("sort") !== "relevance") {
    return NextResponse.json({ error: "Jev ranking requires relevance sort" }, { status: 400, headers: NO_STORE });
  }
  const gate = await requireAiRequest("paper-search-jev", 30);
  if (gate instanceof NextResponse) return gate;
  if (!gate.user && !isLocalDevRuntime()) {
    return NextResponse.json({ error: "Sign in to use Jev" }, { status: 401, headers: NO_STORE });
  }

  const params = new URLSearchParams({ q: query, per_page: String(MAX_RESULTS), sort: "relevance" });
  for (const name of ALLOWED_FILTERS) {
    const value = incoming.get(name);
    if (value !== null) params.set(name, value);
  }
  const upstream = await searchOpenAlex(new NextRequest(new URL(`/api/papers/search?${params}`, req.url)));
  if (!upstream.ok) return NextResponse.json({ error: "Search unavailable" }, { status: 502, headers: NO_STORE });
  const data = await upstream.json() as { results?: Candidate[]; total?: number };
  const candidates = Array.isArray(data.results) ? data.results.slice(0, MAX_RESULTS) : [];
  const intent = normalizeFeedIntent({ project: query, topics: [query] });
  if (!intent.ok || candidates.length === 0) return NextResponse.json({ results: candidates, jev: null }, { headers: NO_STORE });

  const ownerId = gate.user?.id ?? "local-dev";
  const cache = gate.user ? new PrivateDecisionCache(ownerId) : localCache;
  const plan = await screenShortlist(candidates, (shortlist) => screenWithJev({
    ownerId, apiKey: key, intent: intent.intent, senseConcepts: [], candidates: shortlist, cache,
  }));
  if (!plan?.orderedIds) return NextResponse.json({ results: candidates, jev: plan?.meta ?? null }, { headers: NO_STORE });
  const rank = new Map(plan.orderedIds.map((id, index) => [id, index]));
  const results = candidates.map((paper, index) => ({ paper, index }))
    .sort((a, b) => (rank.get(a.paper.id) ?? MAX_RESULTS + a.index) - (rank.get(b.paper.id) ?? MAX_RESULTS + b.index))
    .map(({ paper }) => paper);
  return NextResponse.json({ results, jev: plan.meta }, { headers: NO_STORE });
}
