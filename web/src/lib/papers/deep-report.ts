// Two-pass deep report generator.
//
// Pass 1 (the selected provider's economical model):
//   COMPRESS — read the long paper body, return tightly-relevant sentences
//   (novelty claims, key results, method highlights, comparisons to prior
//   work). This trims a 30k-token paper into ~1.5k tokens of signal.
//
// Pass 2 (the selected provider's stronger model):
//   EXTRACT — using the compressed signal + abstract + metadata, produce
//   the structured PaperReport: every claim with one sentence copied
//   character-for-character from the supplied text.
//
// Then verification: every claim's evidence sentence is looked up in the
// abstract and the extracted sections; a claim whose sentence is not there
// is dropped and counted (`evidence.ts`). Nothing unverified leaves here.
//
// For short papers (< ~10k chars body), Pass 1 is skipped and the raw text
// is sent directly to Pass 2 to save the extra round-trip.

import type { Paper } from "@/types";
import type { DigestProvider } from "@/lib/llm/providers/types";
import {
  emptyReport,
  sanitizePaperReport,
  type PaperReport,
  type PaperReportDepth,
} from "./report";
import { verifyReportEvidence } from "./evidence";
import type { ExtractedDocument } from "./html-text";

const PASS1_TRIGGER_CHARS = 10_000;
const PASS1_MAX_INPUT_CHARS = 60_000;
const PASS2_MAX_INPUT_CHARS = 24_000;

interface CompressedSignal {
  noveltyClaims: string[];
  keyResults: string[];
  methodHighlights: string[];
  priorWorkComparisons: string[];
}

interface BuildDeepReportArgs {
  paper: Paper;
  contextHint?: string;
  /**
   * The reader's current project and challenges, joined. Only when this is
   * non-empty does Pass 2 ask for `relationToYourWork`; the page has nothing
   * to relate the paper to otherwise, and a relation invented against an
   * empty profile is exactly the fabrication the old prompt produced.
   */
  project?: string;
  doc: ExtractedDocument;
  provider: DigestProvider;
}

function totalBodyChars(doc: ExtractedDocument): number {
  return doc.sections.reduce((sum, section) => sum + section.text.length, 0);
}

function sectionsByCanonical(doc: ExtractedDocument): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of doc.sections) {
    out[section.canonical] = (out[section.canonical] ?? "") + " " + section.text;
  }
  return out;
}

/** The whole abstract as the mapper split it — the corpus a Tier-1 claim must quote. */
function fullAbstract(paper: Paper): string {
  return [paper.summaryIntro, paper.summaryResultDiscussion].filter(Boolean).join(" ");
}

function safeJson(text: string): Record<string, unknown> | null {
  const candidates = [
    text.trim(),
    text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "").trim(),
  ];
  const blockMatch = text.match(/\{[\s\S]*\}/);
  if (blockMatch) candidates.push(blockMatch[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

function clampStringArray(value: unknown, max = 8, maxLen = 360): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length >= 12)
    .slice(0, max)
    .map((v) => (v.length > maxLen ? v.slice(0, maxLen) : v));
}

function parseCompressedSignal(text: string): CompressedSignal {
  const json = safeJson(text);
  if (!json) {
    return {
      noveltyClaims: [],
      keyResults: [],
      methodHighlights: [],
      priorWorkComparisons: [],
    };
  }
  return {
    noveltyClaims: clampStringArray(json.noveltyClaims, 6),
    keyResults: clampStringArray(json.keyResults, 6),
    methodHighlights: clampStringArray(json.methodHighlights, 6),
    priorWorkComparisons: clampStringArray(json.priorWorkComparisons, 6),
  };
}

function buildPass1Prompt(paper: Paper, doc: ExtractedDocument): string {
  const buckets = sectionsByCanonical(doc);
  const intro = buckets.introduction ?? buckets.abstract ?? "";
  const methods = buckets.methods ?? "";
  const results = buckets.results ?? "";
  const discussion = buckets.discussion ?? "";

  const clip = (text: string, n: number) =>
    text.length > n ? text.slice(0, n) : text;

  return JSON.stringify({
    task:
      "Extract sentences from this paper's body that carry SIGNAL — what is novel, what was found, what was used, and what differs from prior work. Use only sentences that appear in the supplied text; do not paraphrase. Quote each sentence exactly as written.",
    paper: {
      title: paper.title,
      venue: paper.venue,
    },
    sections: {
      introduction: clip(intro, 12_000),
      methods: clip(methods, 14_000),
      results: clip(results, 14_000),
      discussion: clip(discussion, 14_000),
    },
    outputSchema: {
      noveltyClaims: ["sentences from the paper that state what is new about this work — typically appear in intro and discussion (max 6)"],
      keyResults: ["sentences stating concrete results, numbers, or measurements — typically in results/discussion (max 6)"],
      methodHighlights: ["sentences naming the specific experiments, instruments, datasets, controls, ablations, measurements, simulations, or evaluation protocols used (max 6)"],
      priorWorkComparisons: ["sentences that explicitly contrast this work with prior approaches (max 6)"],
    },
    rules: [
      "Return ONLY valid JSON.",
      "Each item must be a verbatim sentence from the supplied text.",
      "Skip generic background sentences; only include sentences that show contribution, finding, method, or comparison.",
    ],
  });
}

const PASS1_SYSTEM = [
  "You are Peer, a careful research assistant.",
  "Your job: read a paper's body sections and extract verbatim signal sentences.",
  "Do not paraphrase. Do not invent. Return only valid JSON.",
].join(" ");

async function runPass1(
  paper: Paper,
  doc: ExtractedDocument,
  provider: DigestProvider,
): Promise<CompressedSignal> {
  if (!provider.generateJsonText) {
    return {
      noveltyClaims: [],
      keyResults: [],
      methodHighlights: [],
      priorWorkComparisons: [],
    };
  }
  const prompt = buildPass1Prompt(paper, doc);
  const clipped = prompt.length > PASS1_MAX_INPUT_CHARS
    ? prompt.slice(0, PASS1_MAX_INPUT_CHARS)
    : prompt;
  const raw = await provider.generateJsonText({
    systemPrompt: PASS1_SYSTEM,
    userPrompt: clipped,
    maxTokens: 1800,
    tier: "small",
  });
  return parseCompressedSignal(raw);
}

/**
 * The Pass-2 schema. `limitations` and `nextStep` exist only here — they need
 * the full text. `relationToYourWork` is in the schema only when the reader
 * has a project; otherwise the key is absent so the model is never invited
 * to invent one. Every claim carries `evidence`, one sentence copied from the
 * supplied text, and `verifyReportEvidence` holds it to that.
 */
function buildPass2Prompt(args: {
  paper: Paper;
  contextHint?: string;
  project?: string;
  doc: ExtractedDocument;
  signal: CompressedSignal | null;
}): string {
  const { paper, contextHint, project, doc, signal } = args;
  const buckets = sectionsByCanonical(doc);

  // Decide what body context to feed: compressed signal when available, else
  // trimmed raw sections.
  const bodyPayload: Record<string, unknown> = signal
    ? {
        noveltyClaims: signal.noveltyClaims,
        keyResults: signal.keyResults,
        methodHighlights: signal.methodHighlights,
        priorWorkComparisons: signal.priorWorkComparisons,
      }
    : {
        introduction: (buckets.introduction ?? buckets.abstract ?? "").slice(0, 6000),
        methods: (buckets.methods ?? "").slice(0, 6000),
        results: (buckets.results ?? "").slice(0, 6000),
        discussion: (buckets.discussion ?? "").slice(0, 6000),
      };

  const figureCaptions = doc.figureCaptions.slice(0, 8).map((cap) => ({
    label: cap.label,
    caption: cap.caption.slice(0, 300),
  }));

  const evidenceRule =
    "one sentence copied character-for-character from the supplied text (or the abstract) that supports `text`";

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
      "Create a structured Peer DEEP paper report from the supplied paper body (or compressed signal) and abstract. Every item carries an `evidence` sentence copied character-for-character from the supplied text; omit any item you cannot support that way. Do not fabricate numbers; if a number is not in the supplied text, omit it.",
    userContext: contextHint || "",
    ...(project ? { readerProject: project } : {}),
    paper: {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue,
      abstract: fullAbstract(paper),
    },
    body: bodyPayload,
    figureCaptions,
    outputSchema: {
      skim: [
        {
          text: "one plain sentence a reader uses to decide whether to open the paper — the finding, not the topic (max 3 items)",
          evidence: evidenceRule,
        },
      ],
      whatItProposes: {
        summary: "2-3 sentences describing the proposal/scope in plain English. Do not include the method list here.",
        methods: [
          {
            text: "one concrete method sentence naming the actual experiment, instrument, dataset, control, ablation, measurement, simulation, or evaluation protocol used (max 4 items)",
            evidence: evidenceRule,
          },
        ],
      },
      resultsAndSignificance: {
        summary: "2-3 sentences explaining the headline result and why it matters.",
        keyResults: [
          {
            title: "short label",
            detail: "one concrete result sentence grounded in the supplied text",
            evidence: evidenceRule,
          },
        ],
      },
      limitations: [
        {
          text: "one limitation the authors themselves state — only what the authors state, nothing inferred (max 3 items; omit the key if the authors state none)",
          evidence: evidenceRule,
        },
      ],
      nextStep: {
        text: "one concrete experiment or check the reader could run next, tied to a sentence of the paper; omit the key if none",
        evidence: evidenceRule,
      },
      ...relationSchema,
    },
    rules: [
      "Return ONLY valid JSON.",
      "`evidence` is one sentence copied character-for-character from the supplied text (or the abstract). Do not paraphrase it, shorten it, or merge sentences.",
      "Omit any item you cannot support with such a sentence. An empty array is correct when nothing qualifies.",
      "`limitations` holds only what the authors state; do not infer weaknesses.",
      ...(project
        ? ["`relationToYourWork.basedOn` is the reader's project text copied back."]
        : []),
    ],
  });
}

const PASS2_SYSTEM = [
  "You are Peer, a careful research assistant.",
  "Write a structured deep paper report grounded in the supplied body text.",
  "Every claim carries an `evidence` sentence copied character-for-character from the supplied text; a claim without one is omitted.",
  "Be specific: name the actual technique, finding, or comparison rather than generic phrases.",
  "Keep proposal and method separate: proposal says what the paper tries to do; methods say what experiments or evaluations were actually used.",
  "Do not fabricate numbers, citations, or experimental details.",
  "Return only valid JSON.",
].join(" ");

async function runPass2(args: {
  paper: Paper;
  contextHint?: string;
  project?: string;
  doc: ExtractedDocument;
  signal: CompressedSignal | null;
  provider: DigestProvider;
}): Promise<PaperReport | null> {
  if (!args.provider.generateJsonText) return null;

  const prompt = buildPass2Prompt({
    paper: args.paper,
    contextHint: args.contextHint,
    project: args.project,
    doc: args.doc,
    signal: args.signal,
  });
  const clipped = prompt.length > PASS2_MAX_INPUT_CHARS
    ? prompt.slice(0, PASS2_MAX_INPUT_CHARS)
    : prompt;
  const raw = await args.provider.generateJsonText({
    systemPrompt: PASS2_SYSTEM,
    userPrompt: clipped,
    maxTokens: 2400,
    tier: "large",
  });
  const parsed = safeJson(raw);
  if (!parsed) return null;
  return sanitizePaperReport(parsed);
}

/**
 * Produce a deep, body-grounded, evidence-verified paper report. Returns null
 * on any LLM failure so the caller can fall back to the abstract-only path.
 */
export async function generateDeepReport(
  args: BuildDeepReportArgs,
): Promise<PaperReport | null> {
  const { paper, contextHint, doc, provider } = args;
  const project = args.project?.trim() || undefined;
  if (!provider.generateJsonText) return null;
  if (doc.sections.length === 0) return null;

  try {
    const bodyChars = totalBodyChars(doc);
    const signal =
      bodyChars > PASS1_TRIGGER_CHARS
        ? await runPass1(paper, doc, provider)
        : null;

    const report = await runPass2({
      paper,
      contextHint,
      project,
      doc,
      signal,
      provider,
    });
    if (!report) return null;

    // The model was never asked for a relation without a project; should it
    // volunteer one anyway, it is not kept. With a project, `basedOn` is the
    // project text the server holds, not the model's echo of it.
    if (!project) {
      delete report.relationToYourWork;
    } else if (report.relationToYourWork) {
      report.relationToYourWork.basedOn = project.slice(0, 200);
    }

    const verified = verifyReportEvidence(report, {
      abstract: fullAbstract(paper),
      doc,
    });
    if (verified.dropped > 0) {
      console.warn(
        `[papers/deep-report] ${paper.id}: dropped ${verified.dropped} claim(s) without verbatim support`,
      );
    }

    return {
      ...verified.report,
      depth: "deep" as PaperReportDepth,
      sourceKind: doc.source,
      provenance: {
        ...verified.report.provenance,
        basis: "model-fulltext",
        sourceKind: doc.source,
        ...(typeof doc.pageCount === "number" ? { pageCount: doc.pageCount } : {}),
      },
    };
  } catch (err) {
    console.error("[papers/deep-report] generation failed:", err);
    return null;
  }
}

/** Heuristic budget guard so callers can refuse to deep-read silly-long inputs. */
export function isWithinDeepReportBudget(doc: ExtractedDocument): boolean {
  return totalBodyChars(doc) > 800;
}

/**
 * The report for a paper whose full text the publisher blocked and whose
 * abstract-tier model call also produced nothing: empty, with the notice the
 * page turns into its availability sentence. Nothing is written in its place.
 */
export function buildPaywalledFallback(notice: string): PaperReport {
  return { ...emptyReport("fallback"), paywallNotice: notice };
}
