import { NextRequest, NextResponse } from "next/server";
import { resolveProvider } from "@/lib/llm/providers/registry";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import {
  emptyReport,
  sanitizePaperReport,
  withoutFigures,
  type PaperReport,
  type PaperReportRequest,
} from "@/lib/papers/report";
import { verifyReportEvidence } from "@/lib/papers/evidence";
import { generateDeepReport, buildPaywalledFallback } from "@/lib/papers/deep-report";
import { bindFiguresToReport } from "@/lib/papers/figure-binding";
import { getFullText } from "@/lib/papers/full-text";
import { getFigurePool } from "@/lib/figures/extract";
import type { ReportStreamEvent } from "@/lib/papers/report-stream";
import { protectAiRequest } from "@/lib/security/ai-request";

export const dynamic = "force-dynamic";
// Deep reports (full-text fetch + two model passes + figure binding) have been
// observed to run ~85-100s; the old 90s ceiling silently killed the slowest
// ones and downgraded them to an abstract-only report. Give real headroom.
export const maxDuration = 180;

// ── Request shape ────────────────────────────────────────────────────

interface ExtendedRequest extends PaperReportRequest {
  /** When true, attempt full-text deep reading. Requires `llmOverride` with key. */
  deepReport?: boolean;
  llmOverride?: ProviderOverrideConfig;
  /** Opt into the NDJSON response when setting an Accept header is impractical. */
  stream?: boolean;
  /**
   * The reader's current project and challenges, joined by the client
   * (`[currentProject, currentChallenges].filter(Boolean).join("\n")`). Only
   * when non-empty is `relationToYourWork` asked for; with nothing to relate
   * the paper to, the key is left out of the schema rather than invited.
   */
  project?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseJsonObject(text: string): unknown {
  const candidates = [
    text.trim(),
    text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "").trim(),
  ];
  const match = text.match(/\{[\s\S]*\}/);
  if (match) candidates.push(match[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** The whole abstract as the mapper split it — the only text a Tier-1 claim may quote. */
function fullAbstract(paper: PaperReportRequest["paper"]): string {
  return [paper.summaryIntro, paper.summaryResultDiscussion].filter(Boolean).join(" ");
}

function projectText(body: ExtendedRequest): string {
  return typeof body.project === "string" ? body.project.trim() : "";
}

/**
 * The abstract-tier schema. No limitations and no next step — those need the
 * full text and are Pass-2 fields. `relationToYourWork` only when the reader
 * has a project. Every claim's `evidence` is one sentence of the abstract,
 * and `verifyReportEvidence` drops what is not.
 */
function buildShallowPrompt(body: ExtendedRequest): string {
  const { paper, contextHint } = body;
  const project = projectText(body);
  const evidenceRule =
    "one sentence copied character-for-character from the abstract that supports `text`";

  const relationSchema = project
    ? {
        relationToYourWork: {
          basedOn: "the reader's project text, copied back",
          items: [
            {
              text: "one sentence relating a specific finding or method of this paper to the reader's project (max 3 items)",
              evidence: evidenceRule,
            },
          ],
        },
      }
    : {};

  return JSON.stringify({
    task:
      "Create a structured Peer paper report from the paper's title and abstract. Every item carries an `evidence` sentence copied character-for-character from the abstract; omit any item you cannot support that way. Do not invent numbers.",
    userContext: contextHint || "",
    ...(project ? { readerProject: project } : {}),
    paper: {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue,
      abstract: fullAbstract(paper),
      keywords: paper.summaryExperimentKeywords,
    },
    outputSchema: {
      skim: [
        {
          text: "one plain sentence a reader uses to decide whether to open the paper — the finding, not the topic (max 3 items)",
          evidence: evidenceRule,
        },
      ],
      whatItProposes: {
        summary: "2-3 plain-English sentences describing the paper's proposal or scope. Do not include the method list here.",
        methods: [
          {
            text: "one concrete method or experiment sentence naming the actual experiment, dataset, instrument, measurement, simulation, or evaluation the abstract states (max 4 items; empty when the abstract names none)",
            evidence: evidenceRule,
          },
        ],
      },
      resultsAndSignificance: {
        summary: "2-3 sentences explaining the key result and why it matters.",
        keyResults: [
          {
            title: "short result label",
            detail: "one concrete result sentence grounded in the abstract",
            evidence: evidenceRule,
          },
        ],
      },
      ...relationSchema,
    },
    rules: [
      "Return ONLY valid JSON.",
      "`evidence` is one sentence copied character-for-character from the abstract. Do not paraphrase it, shorten it, or merge sentences.",
      "Omit any item you cannot support with such a sentence. An empty array is correct when nothing qualifies.",
      "Produce no limitations and no next step.",
      ...(project
        ? ["`relationToYourWork.basedOn` is the reader's project text copied back."]
        : []),
    ],
  });
}

const SHALLOW_SYSTEM = [
  "You are Peer, a careful research assistant.",
  "Write concise paper reports for researchers from the title and abstract alone.",
  "Every claim carries an `evidence` sentence copied character-for-character from the abstract; a claim without one is omitted.",
  "Keep proposal and method separate: proposal says what the paper tries to do; methods say what experiments or evaluations the abstract states were used.",
  "Do not fabricate experimental values, claims, or figures.",
  "Return only valid JSON.",
].join(" ");

/**
 * The abstract-tier report: one model call, sanitized, then every claim held
 * to a sentence of the abstract. Without a provider, on a model error or on
 * unparseable output the result is `emptyReport` — no report is written in
 * the model's place.
 */
async function generateShallowReport(
  body: ExtendedRequest,
  override?: ProviderOverrideConfig,
): Promise<PaperReport> {
  const provider = resolveProvider(override ?? null);
  if (!provider?.generateJsonText) return emptyReport("fallback");
  try {
    const raw = await provider.generateJsonText({
      systemPrompt: SHALLOW_SYSTEM,
      userPrompt: buildShallowPrompt(body),
      maxTokens: 1800,
    });
    const parsed = parseJsonObject(raw);
    if (!parsed) return emptyReport("fallback");

    // Abstract-tier fields only: limitations and a next step need the full
    // text, and the prompt says so; anything volunteered is not kept. No
    // figure either — binding never runs here, so any figure field is a URL
    // the model typed, not the paper's. The relation is kept only against a
    // real project, and `basedOn` is the project text the server holds, not
    // the model's echo of it.
    const report = withoutFigures(sanitizePaperReport(parsed));
    delete report.limitations;
    delete report.nextStep;
    const project = projectText(body);
    if (!project) {
      delete report.relationToYourWork;
    } else if (report.relationToYourWork) {
      report.relationToYourWork.basedOn = project.slice(0, 200);
    }

    const verified = verifyReportEvidence(report, { abstract: fullAbstract(body.paper) });
    if (verified.dropped > 0) {
      console.warn(
        `[papers/report] ${body.paper.id}: dropped ${verified.dropped} claim(s) without verbatim support`,
      );
    }
    return {
      ...verified.report,
      depth: "abstract",
      provenance: { ...verified.report.provenance, basis: "model-abstract" },
    };
  } catch (err) {
    console.error("[papers/report] shallow generation failed:", err);
    return emptyReport("fallback");
  }
}

// ── Identifier extraction ────────────────────────────────────────────

function arxivIdFromPaper(paper: PaperReportRequest["paper"]): string | null {
  if (paper.id?.startsWith("arxiv:")) return paper.id.slice("arxiv:".length);
  return null;
}

function openAlexIdFromPaper(paper: PaperReportRequest["paper"]): string | null {
  if (paper.id?.startsWith("openalex:")) return paper.id.slice("openalex:".length);
  return null;
}

function bestPaperUrl(paper: PaperReportRequest["paper"]): string | null {
  return paper.linkPaper ?? paper.linkArxiv ?? null;
}

function streamReport(body: ExtendedRequest): Response {
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: ReportStreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The reader may have disconnected while report generation ran.
        }
      };
      const finish = (report: PaperReport) => {
        send({ type: "report", report });
        send({ type: "stage", stage: "done", label: "Report ready", pct: 100 });
        close();
      };

      try {
        const provider = resolveProvider(body.llmOverride ?? null);
        if (!provider?.generateJsonText) {
          send({ type: "mode", aiMode: "tier0" });
          send({
            type: "stage",
            stage: "done",
            label: "Basic report ready",
            pct: 100,
          });
          close();
          return;
        }

        const aiMode = body.deepReport ? "tier2" : "tier1";
        send({ type: "mode", aiMode });

        if (aiMode === "tier1") {
          // The shallow path has exactly one real step (the model call), so
          // emit one honest low-anchor stage. Firing a second stage at 75%
          // immediately would slam the bar most of the way across before any
          // work happened, then strand it there. The client eases it forward
          // from here while the call is in flight.
          send({
            type: "stage",
            stage: "writing",
            label: "Writing the report",
            pct: 20,
          });
          finish(await generateShallowReport(body, body.llmOverride));
          return;
        }

        send({
          type: "stage",
          stage: "source",
          label: "Finding the paper",
          pct: 10,
        });
        const fullText = await getFullText({
          paperId: body.paper.id,
          url: bestPaperUrl(body.paper),
          doi: body.paper.doi ?? null,
          arxivId: arxivIdFromPaper(body.paper),
          openAlexId: openAlexIdFromPaper(body.paper),
        });

        if (fullText.status === "paywalled" && fullText.reason) {
          send({
            type: "stage",
            stage: "writing",
            label: "Writing the report",
            pct: 75,
          });
          const shallow = await generateShallowReport(body, body.llmOverride);
          finish(
            shallow.noLlm
              ? buildPaywalledFallback(fullText.reason)
              : { ...shallow, paywallNotice: fullText.reason },
          );
          return;
        }

        if (fullText.status !== "ok" || !fullText.doc) {
          send({
            type: "stage",
            stage: "writing",
            label: "Writing the report",
            pct: 75,
          });
          const shallow = await generateShallowReport(body, body.llmOverride);
          finish({
            ...shallow,
            paywallNotice:
              fullText.reason ??
              "Peer could not find a legal full-text source for this paper. Showing an abstract-only report instead.",
          });
          return;
        }

        send({
          type: "stage",
          stage: "reading",
          label: "Reading it",
          pct: 35,
        });
        const figurePoolPromise = getFigurePool({
          itemId: body.paper.id,
          url: bestPaperUrl(body.paper) ?? undefined,
          doi: body.paper.doi ?? undefined,
          paperTitle: body.paper.title,
        }).catch((err) => {
          console.warn("[papers/report] figure pool fetch failed:", err);
          return null;
        });

        send({
          type: "stage",
          stage: "writing",
          label: "Writing the report",
          pct: 75,
        });
        const deep = await generateDeepReport({
          paper: body.paper,
          contextHint: body.contextHint,
          project: projectText(body) || undefined,
          doc: fullText.doc,
          provider,
        });

        if (!deep) {
          const shallow = await generateShallowReport(body, body.llmOverride);
          finish({
            ...shallow,
            paywallNotice:
              "Peer downloaded the paper but the deep-read step failed. Showing an abstract-only report instead.",
          });
          return;
        }

        send({
          type: "stage",
          stage: "figures",
          label: "Adding figures",
          pct: 92,
        });
        const figurePool = await figurePoolPromise;
        const bound = await bindFiguresToReport({
          paper: { title: body.paper.title },
          report: deep,
          captions: fullText.doc.figureCaptions,
          provider,
          figurePool,
        });

        finish(bound);
      } catch (err) {
        console.error("[papers/report] streaming flow failed:", err);
        try {
          send({
            type: "error",
            message: "Peer could not finish the report stream.",
          });
        } catch {
          // The reader may have disconnected; there is nothing left to send.
        }
        close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}

// ── POST handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: ExtendedRequest;
  try {
    body = (await req.json()) as ExtendedRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.paper?.id || !body.paper.title) {
    return NextResponse.json({ error: "paper is required" }, { status: 400 });
  }

  const provider = resolveProvider(body.llmOverride ?? null);
  if (provider?.generateJsonText) {
    const denied = await protectAiRequest("paper-report", 20);
    if (denied) return denied;
  }

  const wantsStream =
    req.headers.get("accept")?.includes("application/x-ndjson") === true ||
    body.stream === true;
  if (wantsStream) {
    return streamReport(body);
  }

  // ── Deep path ────────────────────────────────────────────────────
  // Runs when the client asks for deep reading and a provider is available:
  // user BYOK in deployments, or the explicit developer provider in local dev.
  // Without a provider, fall through to the shallow path (which returns the
  // empty report).
  if (body.deepReport) {
    const provider = resolveProvider(body.llmOverride ?? null);
    if (!provider?.generateJsonText) {
      return NextResponse.json(await generateShallowReport(body, body.llmOverride));
    }

    try {
      const fullText = await getFullText({
        paperId: body.paper.id,
        url: bestPaperUrl(body.paper),
        doi: body.paper.doi ?? null,
        arxivId: arxivIdFromPaper(body.paper),
        openAlexId: openAlexIdFromPaper(body.paper),
      });

      if (fullText.status === "paywalled" && fullText.reason) {
        // Try the LLM-backed shallow path first; when the model produced
        // nothing, the empty report carries the paywall notice.
        const shallow = await generateShallowReport(body, body.llmOverride);
        return NextResponse.json(
          shallow.noLlm
            ? buildPaywalledFallback(fullText.reason)
            : { ...shallow, paywallNotice: fullText.reason },
        );
      }

      if (fullText.status !== "ok" || !fullText.doc) {
        const shallow = await generateShallowReport(body, body.llmOverride);
        return NextResponse.json({
          ...shallow,
          paywallNotice:
            fullText.reason ??
            "Peer could not find a legal full-text source for this paper. Showing an abstract-only report instead.",
        });
      }

      // The deep report and the figure pool are independent — both derive from
      // the already-fetched full-text doc / paper metadata — so fetch the
      // figure pool concurrently with report generation instead of after it.
      // (captions come from the same fetched doc; the pool supplies the actual
      // high-quality image URLs — PDF-rendered when available, HTML otherwise.)
      const [deep, figurePool] = await Promise.all([
        generateDeepReport({
          paper: body.paper,
          contextHint: body.contextHint,
          project: projectText(body) || undefined,
          doc: fullText.doc,
          provider,
        }),
        getFigurePool({
          itemId: body.paper.id,
          url: bestPaperUrl(body.paper) ?? undefined,
          doi: body.paper.doi ?? undefined,
          paperTitle: body.paper.title,
        }).catch((err) => {
          console.warn("[papers/report] figure pool fetch failed:", err);
          return null;
        }),
      ]);

      if (!deep) {
        const shallow = await generateShallowReport(body, body.llmOverride);
        return NextResponse.json({
          ...shallow,
          paywallNotice:
            "Peer downloaded the paper but the deep-read step failed. Showing an abstract-only report instead.",
        });
      }

      const bound = await bindFiguresToReport({
        paper: { title: body.paper.title },
        report: deep,
        captions: fullText.doc.figureCaptions,
        provider,
        figurePool,
      });

      return NextResponse.json(bound);
    } catch (err) {
      console.error("[papers/report] deep flow failed:", err);
      return NextResponse.json(await generateShallowReport(body, body.llmOverride));
    }
  }

  // ── Shallow path (default) ──────────────────────────────────────
  return NextResponse.json(await generateShallowReport(body, body.llmOverride));
}
