// Client-only, pure projection. Never runtime-import the server range matcher (node:crypto).
import type { ExplainRange, ExplainRangeSegment } from "@/lib/papers/explain-range";
import type { SelectionTarget } from "@/components/reader/paper-body";
import { parseAnchorId } from "@/lib/notes/anchor-blocks";

export interface ExplainIdentity { source: "paper" | "summary" | "answer"; segments: ExplainRangeSegment[] }
export const EXPLAIN_SOURCE_BOUNDARY = "Explain one source at a time. Select text within the paper, Summary, or one answer.";
const invalid = "This Explain selection changed. Select the text again.";
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
export function boundedExplainPassage(passage: string): string {
  const text = collapse(passage);
  if (text.length <= 1200) return text;
  const space = text.lastIndexOf(" ", 1200);
  return (space > 0 ? text.slice(0, space) : text.slice(0, 1200)).trimEnd();
}
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Clone only protocol fields, with independent metadata limits. */
export function clientExplainRange(value: unknown): ExplainRange | null {
  if (!record(value) || Object.keys(value).length !== 1 || !Array.isArray(value.segments) || !value.segments.length || value.segments.length > 600) return null;
  const segments: ExplainRangeSegment[] = [];
  for (const item of value.segments) {
    if (!record(item) || Object.keys(item).length !== 4) return null;
    const { sectionId, paragraphIndex, start, end } = item;
    if (typeof sectionId !== "string" || !sectionId.trim() || sectionId.length > 128 || !integer(paragraphIndex) || !integer(start) || !integer(end) || end <= start) return null;
    segments.push({ sectionId, paragraphIndex, start, end });
  }
  return { segments };
}

/** Only actual multi-block groups take this path. Legacy single-block keys/payloads stay unchanged. */
export function prepareExplainSelection<T extends SelectionTarget>(selection: T, body: readonly { id: string }[]): T {
  const parts = selection.segments;
  if (!parts || parts.length < 2) return selection;
  const source = parts[0].source ?? "paper";
  if (parts.some((part) => (part.source ?? "paper") !== source)) return { ...selection, explainUnavailableReason: EXPLAIN_SOURCE_BOUNDARY };
  const canonical = selection.explainSegments;
  if (!canonical || canonical.length !== parts.length) return { ...selection, explainUnavailableReason: invalid };
  const passage = boundedExplainPassage(selection.passage);
  if (!passage || collapse(parts.map((part) => part.quote).join(" ")) !== collapse(selection.passage)) return { ...selection, explainUnavailableReason: invalid };
  const segments: ExplainRangeSegment[] = [];
  let consumed = 0;
  for (let i = 0; i < parts.length && consumed < passage.length; i++) {
    const part = parts[i], at = canonical[i];
    if (at.paragraphId !== part.paragraphId || (at.source ?? "paper") !== source || !integer(at.start) || !integer(at.end) || at.end - at.start !== part.quote.length || !part.quote || part.quote.includes("\u0000") || collapse(part.quote) !== part.quote) return { ...selection, explainUnavailableReason: invalid };
    if (i) consumed++;
    const length = Math.min(part.quote.length, passage.length - consumed);
    if (length <= 0) break;
    const anchor = parseAnchorId(part.paragraphId);
    const sectionId = source === "paper" ? (anchor ? body[anchor.section]?.id : undefined) : part.paragraphId;
    if (!sectionId) return { ...selection, explainUnavailableReason: invalid };
    segments.push({ sectionId, paragraphIndex: source === "paper" ? anchor!.index : 0, start: at.start, end: at.start + length });
    consumed += length;
  }
  const range = clientExplainRange({ segments });
  if (!range || consumed !== passage.length) return { ...selection, explainUnavailableReason: invalid };
  return { ...selection, source, ...(source === "paper" ? { range } : {}), explainIdentity: { source, segments: range.segments } };
}

/** Shared first/reply/Say-more guard; no full selection or DOM metadata on the wire. */
export function explainRequestRange(selection: SelectionTarget): { passage: string; range?: ExplainRange } | null {
  if (selection.explainUnavailableReason || (selection.selectionStillHolds && !selection.selectionStillHolds())) return null;
  if (selection.segments?.some((part) => (part.source ?? "paper") !== (selection.source ?? "paper"))) return null;
  if (selection.range === undefined) return { passage: selection.passage };
  const range = clientExplainRange(selection.range);
  if (!range || (selection.source ?? "paper") !== "paper") return null;
  return { passage: boundedExplainPassage(selection.passage), range };
}

/** Project all callback paths without captured paragraphs or DOM nodes. The guard stays ephemeral. */
export function explainTarget(selection: SelectionTarget): SelectionTarget {
  const { sectionIndex, paragraphIndex, passage, source, paragraphId, range, explainIdentity, explainUnavailableReason, selectionStillHolds } = selection;
  return { sectionIndex, paragraphIndex, passage, ...(source !== undefined ? { source } : {}), ...(paragraphId !== undefined ? { paragraphId } : {}),
    ...(range ? { range } : {}), ...(explainIdentity ? { explainIdentity } : {}), ...(explainUnavailableReason ? { explainUnavailableReason } : {}), ...(selectionStillHolds ? { selectionStillHolds } : {}) };
}

export function sameExplainTarget(a: SelectionTarget, b: SelectionTarget): boolean {
  return a.passage === b.passage && (a.source ?? "paper") === (b.source ?? "paper") && JSON.stringify(a.explainIdentity ?? a.range ?? null) === JSON.stringify(b.explainIdentity ?? b.range ?? null);
}
