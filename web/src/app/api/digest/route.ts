import { NextRequest, NextResponse } from "next/server";
import { errorKind } from "@/lib/llm/providers/error-kind";
import { resolveProvider } from "@/lib/llm/providers/registry";
import type {
  PaperLite,
  ProviderOverrideConfig,
} from "@/lib/llm/providers/types";
import { requireAiRequest } from "@/lib/security/ai-request";

interface DigestRequest {
  papers: PaperLite[];
  contextHint?: string;
  llmOverride?: ProviderOverrideConfig;
}

interface DigestResponse {
  bullets: { paperId: string; text: string }[];
  noLlm?: boolean;
}

function emptyResponse(noLlm = false): DigestResponse {
  return { bullets: [], noLlm };
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanPapers(input: unknown): PaperLite[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 20)
    .map((paper): PaperLite | null => {
      if (!paper || typeof paper !== "object") return null;
      const value = paper as Record<string, unknown>;
      const id = cleanText(value.id, 240);
      const title = cleanText(value.title, 800);
      if (!id || !title) return null;
      return {
        id,
        title,
        authors: Array.isArray(value.authors)
          ? value.authors
              .map((author) => cleanText(author, 200))
              .filter(Boolean)
              .slice(0, 20)
          : undefined,
        venue: cleanText(value.venue, 300) || undefined,
        abstract: cleanText(value.abstract, 12_000) || undefined,
      };
    })
    .filter((paper): paper is PaperLite => paper !== null);
}

export async function POST(req: NextRequest) {
  let body: DigestRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const papers = cleanPapers(body.papers);
  if (papers.length === 0) {
    return NextResponse.json(emptyResponse());
  }

  // ABC-freemium 1-06 · R-SEC-2 — **the guard sits ABOVE `resolveProvider`.**
  // It once sat below the early `emptyResponse(true)` return, so this route
  // answered a stranger 200 and never authenticated. A signed-out caller gets
  // 401; a signed-in one with no key of their own gets the reading without a
  // model.
  const gate = await requireAiRequest("digest", 60);
  if (gate instanceof NextResponse) return gate;

  const provider = resolveProvider(body.llmOverride ?? null);
  if (!provider) {
    // No key of the reader's own — the reading without a model.
    return NextResponse.json(emptyResponse(true));
  }

  try {
    const result = await provider.generateDigest({
      papers,
      contextHint: cleanText(body.contextHint, 4_000) || undefined,
    });
    console.log(`[digest] ${provider.id} OK — bullets: ${result.bullets.length}`);
    return NextResponse.json({
      bullets: result.bullets,
    } satisfies DigestResponse);
  } catch (err) {
    // The kind and the status only, never the error (P5-06b, §1h.20 (a)): the
    // prompt holds the papers' abstracts and the reader's own profile text, and
    // a provider's thrown message carries a slice of the response body, which
    // can quote the request. A server log is shared; AGENTS.md keeps per-user
    // text out of it.
    console.error(`[digest] ${provider.id} error: ${errorKind(err)}`);
    // Degrade gracefully to Tier 0 on any LLM error.
    return NextResponse.json(emptyResponse());
  }
}
