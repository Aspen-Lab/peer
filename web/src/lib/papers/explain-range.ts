// P12-11: exact bounded provenance for new paper-range requests. No I/O or
// reader state. Dynamic rewrite/control gaps are validated by the DOM caller.
import { createHash } from "node:crypto";
import { captionBlock, captionText, headingBlock } from "@/lib/notes/anchor-blocks";
import { splitMath } from "@/lib/text/math";
import type { LocatedPassage } from "./explain";
import type { ExtractedDocument } from "./html-text";
import { placeFigures, type ReadingSection } from "./reading";
import { readableSections } from "./reading-map";

export interface ExplainRangeSegment {
  sectionId: string;
  paragraphIndex: number;
  /** Offsets in readBlockText's canonical rendered text, not raw DOM text. */
  start: number;
  end: number;
}
export interface ExplainRange { segments: ExplainRangeSegment[] }
export const EXPLAIN_RANGE_CAPS = { segments: 600, sectionId: 128 } as const;
const whitespace = (text: string) => text.replace(/\s+/g, " ").trim();
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Reads metadata independently of passage length. No raw prose is accepted. */
export function readExplainRange(value: unknown): ExplainRange | null {
  if (!record(value) || Object.keys(value).length !== 1 || !Array.isArray(value.segments)) return null;
  if (value.segments.length < 1 || value.segments.length > EXPLAIN_RANGE_CAPS.segments) return null;
  const segments: ExplainRangeSegment[] = [];
  for (const part of value.segments) {
    if (!record(part) || Object.keys(part).length !== 4) return null;
    const { sectionId, paragraphIndex, start, end } = part;
    if (typeof sectionId !== "string" || !sectionId.trim() || sectionId.length > EXPLAIN_RANGE_CAPS.sectionId ||
      !integer(paragraphIndex) || !integer(start) || !integer(end) || end <= start) return null;
    segments.push({ sectionId, paragraphIndex, start, end });
  }
  return { segments };
}

/** MathText draws each inline formula as one non-prose node. Keep its barrier
 * at the same character offset as readBlockText; never drop it for matching. */
function proseText(text: string): string {
  return whitespace(splitMath(text).map((run) => run.kind === "math" ? "\u0000" : run.value).join(""));
}

interface RenderedBlock {
  section: ReadingSection;
  sectionIndex: number;
  index: number;
  variants: string[];
  paragraph: string;
  before: string | null;
  after: string | null;
}

/** One linear stream, not a product of caption variants. Null is a formula
 * barrier. Numeric anchor indices are deliberately not used as render order. */
function renderedBlocks(doc: ExtractedDocument): Array<RenderedBlock | null> {
  const sections = readableSections(doc).map(({ id, section, paragraphs, equations }) => ({ id, heading: section.heading, canonical: section.canonical, paragraphs, equations }));
  const body = placeFigures(sections, doc.figureCaptions, doc.source === "pdf" ? { paperId: "range" } : null);
  const blocks: Array<RenderedBlock | null> = [];
  body.forEach((section, sectionIndex) => {
    const { paragraphs } = section;
    const add = (index: number, variants: string[], paragraph: string, before: string | null, after: string | null) => {
      blocks.push({ section, sectionIndex, index, variants, paragraph, before, after });
    };
    add(headingBlock(section), [proseText(section.heading)], section.heading, null, paragraphs[0] ?? null);
    const following = (i: number) => {
      for (const equation of section.equations ?? []) if (equation.after === i) blocks.push(null);
      (section.figures ?? []).forEach((figure, k) => {
        if (figure.after !== i) return;
        const normal = whitespace(captionText(figure));
        const failed = figure.imageUrl && typeof figure.page === "number" ? whitespace(`${normal} · p.${figure.page} of the PDF`) : normal;
        add(captionBlock(section, k), normal === failed ? [normal] : [normal, failed], figure.caption || figure.label, paragraphs[i] ?? null, paragraphs[i + 1] ?? null);
      });
    };
    following(-1);
    paragraphs.forEach((paragraph, i) => {
      add(i, [proseText(paragraph)], paragraph, paragraphs[i - 1] ?? null, paragraphs[i + 1] ?? null);
      following(i);
    });
  });
  return blocks;
}

export interface LocatedExplainRange {
  located: LocatedPassage;
  /** Only this one-way occurrence/source hash joins the server cache key. */
  identity: string;
}

/** Entire bounded passage, exact slices, canonical adjacency, or nothing.
 * Each caption has at most two prefix-related variants; offsets and boundary
 * requirements pick its text locally, without Cartesian expansion. */
export function locateExplainRange(doc: ExtractedDocument, passage: string, value: unknown): LocatedExplainRange | null {
  const range = readExplainRange(value);
  const wanted = whitespace(passage);
  if (!range || !wanted || wanted.length > 1200) return null;
  const blocks = renderedBlocks(doc);
  const bySection = new Map<string, Map<number, number>>();
  blocks.forEach((block, i) => {
    if (!block) return;
    let section = bySection.get(block.section.id);
    if (!section) { section = new Map(); bySection.set(block.section.id, section); }
    // Ambiguous extraction identities are not valid provenance.
    if (section.has(block.index)) section.set(block.index, -1);
    else section.set(block.index, i);
  });
  const slices: string[] = [];
  let previous = -1;
  let first: RenderedBlock | undefined;
  let characters = 0;
  for (let i = 0; i < range.segments.length; i++) {
    const part = range.segments[i];
    const at = bySection.get(part.sectionId)?.get(part.paragraphIndex);
    if (at === undefined || at < 0 || (i > 0 && at !== previous + 1)) return null;
    const block = blocks[at];
    if (!block) return null;
    const text = block.variants.find((candidate) => part.end <= candidate.length &&
      (i === 0 || part.start === 0) && (i === range.segments.length - 1 || part.end === candidate.length));
    if (text === undefined) return null;
    const slice = text.slice(part.start, part.end);
    if (!slice.trim() || slice.includes("\u0000")) return null;
    characters += slice.length + (i > 0 ? 1 : 0);
    // Canonical block text has collapsed whitespace. This also prevents a
    // caller using short passage text to authorize unbounded slice work.
    if (characters > 1200) return null;
    slices.push(slice);
    first ??= block;
    previous = at;
  }
  if (!first || whitespace(slices.join(" ")) !== wanted) return null;
  const identity = createHash("sha256").update(JSON.stringify({ source: "paper", segments: range.segments })).digest("hex");
  return {
    identity,
    located: { sectionId: first.section.id, sectionIndex: first.sectionIndex, paragraphIndex: first.index,
      paragraph: first.paragraph, before: first.before, after: first.after, range: true },
  };
}
