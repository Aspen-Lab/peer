import { NextRequest, NextResponse } from "next/server";
import {
  hasUsableProviderOverride,
  resolveProvider,
} from "@/lib/llm/providers/registry";
import type {
  PaperLite,
  ProviderOverrideConfig,
} from "@/lib/llm/providers/types";
import { requireEntitledAiRequest } from "@/lib/security/ai-request";
import { entitledContext } from "@/lib/security/entitled-context";

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

  // ABC-freemium 1-06 · R-SEC-2 — **the guard moved ABOVE `resolveProvider`.**
  // It used to sit below the early `emptyResponse(true)` return, so this route
  // answered a stranger 200 and never authenticated. That was harmless only
  // while no provider ever resolved; R-KEY-1 makes one always resolve. This
  // route now answers a signed-out caller 401 — Ruling 3 point 7 predicts it,
  // and it is the fix working, not a regression.
  const gate = await requireEntitledAiRequest("digest", 60);
  if (gate instanceof NextResponse) return gate;
  const { entitlement } = gate;

  // ABC-freemium 3-02 — minted from the entitlement the gate above resolved,
  // so the acquisition carries compile-checked proof a check ran, not a
  // hand-built object that merely looks like one.
  const provider = resolveProvider(
    body.llmOverride ?? null,
    entitledContext(
      entitlement,
      "digest",
      hasUsableProviderOverride(body.llmOverride ?? null),
    ),
  );
  if (!provider) {
    // No provider configured — graceful Tier 0 fallback.
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
    console.error(`[digest] ${provider.id} error:`, err);
    // Degrade gracefully to Tier 0 on any LLM error.
    return NextResponse.json(emptyResponse());
  }
}
