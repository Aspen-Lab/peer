import { resolveProvider } from "@/lib/llm/providers/registry";
import type { FigureMatchContext } from "./match-context";
import { entitledContext } from "@/lib/security/entitled-context";
import { cleanDisplayText } from "@/lib/text/clean";

interface MatchCandidate {
  ordinal: number;
  caption: string;
}

export interface SemanticFigureMatch {
  ordinal: number | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

function parseMatch(text: string): SemanticFigureMatch | null {
  const candidates = [
    text.trim(),
    text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "").trim(),
  ];
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<SemanticFigureMatch>;
      const confidence =
        parsed.confidence === "high" ||
        parsed.confidence === "medium" ||
        parsed.confidence === "low"
          ? parsed.confidence
          : "low";
      return {
        ordinal:
          typeof parsed.ordinal === "number" && Number.isFinite(parsed.ordinal)
            ? parsed.ordinal
            : null,
        confidence,
        reason: cleanDisplayText(parsed.reason),
      };
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

/**
 * ABC-freemium 1-07 · R-SEC-1 — **`ctx` is REQUIRED, not optional.**
 *
 * R-SEC-1's second sentence is the load-bearing half: these matchers must
 * "never resolve a server provider without an authenticated request context
 * passed in explicitly". This used to call `resolveProvider()` with no
 * arguments at all, from a route with no authentication of any kind. Making the
 * argument required is what keeps A's scan-4 count at zero permanently rather
 * than zero-until-someone-adds-a-caller: a new caller cannot compile without
 * deciding whose request this is.
 */
export async function matchFigureSemantically(args: {
  paperTitle?: string;
  query: string;
  candidates: MatchCandidate[];
  ctx: FigureMatchContext;
}): Promise<SemanticFigureMatch | null> {
  // ABC-freemium 3-02 — minted from the entitlement `api/figure` resolved, so
  // this acquisition carries compile-checked proof rather than a hand-made
  // `{ userId, byok }` that anyone could have written.
  const provider = resolveProvider(
    args.ctx.override ?? null,
    entitledContext(args.ctx.entitlement, "figure:semantic", args.ctx.byok),
  );
  if (!provider?.generateJsonText) return null;
  if (!args.query.trim() || args.candidates.length === 0) return null;

  const systemPrompt = [
    "You are Peer, a careful research assistant.",
    "Match a paper report section to the most relevant figure caption by meaning, not by exact word overlap.",
    "Choose a figure only when the caption clearly supports the section goal.",
    "If none of the captions are a defensible match, return ordinal null.",
    "Return only valid JSON.",
  ].join(" ");

  const userPrompt = JSON.stringify({
    task: "Select the best figure caption for a report section.",
    paperTitle: cleanDisplayText(args.paperTitle),
    reportSection: cleanDisplayText(args.query),
    candidates: args.candidates.map((candidate) => ({
      ordinal: candidate.ordinal,
      caption: cleanDisplayText(candidate.caption),
    })),
    outputSchema: {
      ordinal:
        "integer ordinal from the candidate list, or null when no caption meaningfully matches the report section",
      confidence: '"high" | "medium" | "low"',
      reason: "one short sentence explaining the choice",
    },
  });

  try {
    const text = await provider.generateJsonText({
      systemPrompt,
      userPrompt,
      maxTokens: 400,
      // Caption matching is a cheap classification — pin the small model so a
      // flash miss can't escalate to an expensive large-model call.
      tier: "small",
    });
    return parseMatch(text);
  } catch (err) {
    console.warn("[figures/semantic-match] provider failed:", err);
    return null;
  }
}
