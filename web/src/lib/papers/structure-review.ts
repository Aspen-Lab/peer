// Tier 1 — the model's review of the rules' structure (P12-53; B P12-42; ruling §1h.424 (b), §1h.428).
//
// With a key, the structure of a paper must be right, and the rules (Tier 0) are there to save tokens:
// the rules divide the paper into PARTS and give each a role; the model is shown a compact SKELETON of
// the paper — not the paper — with the rules' DRAFT beside it, and returns only CORRECTIONS. Everything
// here is pure (no I/O, no model, no `node:` import), so the server that builds the prompt and the
// browser that applies the answer compute alike:
//
//   - `paragraphFeatures`: the counts the skeleton shows (figure and table references, citations, numbers
//     with units, procedural verbs, first-person signposting) — one function, so the model sees the very
//     counts the Tier-0 rules can use.
//   - `structureInputOf` / `draftOf`: the paper as the map and the body already hold it (paragraph k of
//     the whole paper is ORDINAL k, over `readableSections` in order), and the rules' draft from the map's
//     top-level rows: a role, a confidence (high when the heading names the role, medium when it is
//     inherited, low when nothing places it) and evidence tags that are rule names and counts, never words
//     of the paper.
//   - `buildSkeleton` / `buildReviewPrompt`: mode A (every paragraph's first 16 words and counts) by
//     default; mode B (heads only where the rules are unsure and at the ends of a part) above 24,000
//     characters; a still smaller B, then none ("too_large": the draft stands).
//   - `sanitizeReview` / `applyCorrections` / `reviewStructure`: the answer is made whole by code, none
//     of it is hoped for — `move_start`, `set_role`, `split` and `unsure` only; at most 40; every index in
//     range and in order; five roles only (`body` is refused). A correction that fails a check is dropped,
//     never mended; an answer that is not an answer leaves the draft exactly (Tier 0 never breaks).
//   - `secondLookTargets` / `lookParagraphs` / `buildLookPrompt` / `resolveLooks`: a correction against a
//     high- or medium-confidence part, or a part the model could not judge, gets one more look at that
//     part's own text (at most three looks, 6,000 characters each).
//   - `createStructureReviewCache`: the server's memory, keyed `docHash | rules | skeleton | prompt`; an
//     entry holds indices, role names and the model's id — no word of the paper.
//   - `applyStructureReview`: lays the reviewed roles over the map's rows for display. No row is added or
//     removed and no id changes (the scroll position cannot move), and a corrected role is shown exactly
//     like a named one (§1h.424 (a)): no mark.
//
// Role names are the reading map's (`setup`, `method`, `evidence`, `interpretation`, `apparatus`), not the
// partition's (`introduction`, `results`, …).

import type { ReadingMap, ReadingMapSection, ReadingRole } from "./reading-map";

// ── Versions and limits ─────────────────────────────────────────────────

/** Bump when the draft's rules change what they say (a different draft for the same paper). */
export const STRUCTURE_RULES_VERSION = "rows-1";
/** Bump when the skeleton's grammar or its heads change. */
export const SKELETON_VERSION = "s1";
/** Bump when the review prompt's text changes (a test pins the fixed part by hash). */
export const REVIEW_PROMPT_VERSION = "p1";

export const REVIEW_ROLES = ["setup", "method", "evidence", "interpretation", "apparatus"] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];
export type Confidence = "high" | "medium" | "low";

export const REVIEW_CAPS = {
  /** The skeleton's budget in characters (about 6,000 tokens at four characters a token). */
  skeletonChars: 24_000,
  headWords: 16,
  /** The smallest head, for the last try before giving up. */
  shortHeadWords: 8,
  headingChars: 60,
  captionWords: 8,
  /** `fig` lines in a skeleton: a paper with more is cut to this many. */
  figureLines: 40,
  corrections: 40,
  splitsPerPart: 3,
  /** The answer's allowance: 40 corrections at about 14 tokens each. */
  answerTokens: 600,
  secondLooks: 3,
  lookChars: 6_000,
  lookParagraphChars: 600,
  lookTokens: 60,
  /** The server's memory: finished reviews, for an hour. */
  cacheEntries: 32,
  cacheTtlMs: 60 * 60 * 1000,
} as const;

// ── The paragraph's counts ─────────────────────────────────────────────

const UNITS =
  "nm|µm|μm|mm|cm|Å|K|°C|V|mV|kV|mA|mAh|Ah|mg|kg|g|wt\\.?%|at\\.?%|vol\\.?%|%|GPa|MPa|kPa|Pa|eV|keV|Hz|kHz|MHz|mol|mM|M|ppm|mL|L|W|Wh|h|min|s|bar|rpm|C";
const RE_NUM = new RegExp(`(?<![\\w.])\\d+(?:[.,]\\d+)?\\s?(?:${UNITS})(?![A-Za-z])`, "g");
const RE_FIG = /\b(?:Figs?\.?|Figures?)\s*(?:S?\d+[a-z]?)/gi;
const RE_TAB = /\bTables?\s*S?\d+/gi;
const RE_CITE =
  /\[\d+(?:[\s,–-]+\d+)*\]|\((?:[A-Z][A-Za-z-]+(?: et al\.?)?,? (?:19|20)\d{2}[a-z]?;? ?)+\)|(?<=[a-z.)])\d{1,3}(?:[,–-]\d{1,3})*(?=[\s,.;]|$)/g;
const RE_PROC =
  /\b(?:was|were)\s+(?:then\s+|subsequently\s+|first\s+)?(?:prepared|synthesi[sz]ed|heated|annealed|mixed|dissolved|measured|collected|performed|carried out|cycled|washed|dried|stirred|deposited|loaded|operated|acquired|fabricated|placed|sealed|ground|milled|centrifuged|filtered|etched|polished|mounted|recorded|obtained|purchased|calibrated|immersed|transferred|applied|cut|cooled|charged|discharged|assembled|pressed|sintered|sputtered|coated|rinsed|evaporated|analy[sz]ed|reconstructed|processed|used|set|held|kept|added|conducted|employed|taken|run|stored|extracted|aligned)\b/gi;
const RE_SIGN =
  /\b(?:we|our)\s+(?:show|find|found|demonstrate|report|observe|propose|present|reveal|conclude|discuss|investigate|study|develop|introduce|identify|analy[sz]e|measure|prepare|synthesi[sz]e|perform|use|apply|believe|suggest|note|expect|hypothesi[sz]e|argue|attribute)\w*|\bthis (?:work|study|paper|article|review|perspective)\b/gi;

/** What a paragraph holds, as counts: F figure references, T table references, C citations, N numbers with a
 *  unit, V procedural verbs ("was/were" and a lab verb), W first-person signposting ("we show", "this work"). */
export interface ParagraphCounts {
  F: number;
  T: number;
  C: number;
  N: number;
  V: number;
  W: number;
}

const count = (re: RegExp, text: string): number => text.match(re)?.length ?? 0;

/** The counts of one paragraph. Shared with the Tier-0 rules so the model sees the very counts they used. */
export function paragraphFeatures(text: string): ParagraphCounts {
  return {
    F: count(RE_FIG, text),
    T: count(RE_TAB, text),
    C: count(RE_CITE, text),
    N: count(RE_NUM, text),
    V: count(RE_PROC, text),
    W: count(RE_SIGN, text),
  };
}

/** `F2 T1 C3 N4 V2 W1`, in that order, zeros left out; "" for a paragraph with none. */
export function countsText(counts: ParagraphCounts): string {
  return (["F", "T", "C", "N", "V", "W"] as const)
    .filter((key) => counts[key] > 0)
    .map((key) => `${key}${counts[key]}`)
    .join(" ");
}

// ── The paper as the review reads it ───────────────────────────────────

export interface StructureSection {
  id: string;
  heading: string;
  /** The bucket the extractor gave the heading ("methods", "body", …). */
  canonical: string;
  /** What the map says the bucket is for; `body` when nothing placed it. */
  role: ReadingRole;
  page?: number;
  level: number;
  parentId?: string;
  /** The ordinal of the section's first paragraph (or, with none, of the next paragraph). */
  first: number;
  count: number;
}

export interface StructureFigure {
  label: string;
  caption: string;
  page?: number;
}

export interface StructureInput {
  sections: StructureSection[];
  /** Every paragraph of the paper in reading order: paragraph k is ordinal k. */
  texts: string[];
  paragraphs: number;
  figures: StructureFigure[];
  pages?: number;
}

/**
 * The paper as the map and the body hold it. `map` and `body` are index-aligned (map row k is body section k,
 * `PaperReading.map` / `PaperReading.body`; on the server `readingMapOf(readableSections(doc))` and the same
 * sections), so the browser and the server number paragraphs alike. Null when they are not the same list.
 */
export function structureInputOf(
  map: ReadingMap | undefined,
  body: ReadonlyArray<{ id: string; paragraphs: readonly string[] }> | undefined,
  extra: { figures?: StructureFigure[]; pages?: number } = {},
): StructureInput | null {
  if (!map || !body || body.length === 0 || map.sections.length !== body.length) return null;
  const sections: StructureSection[] = [];
  const texts: string[] = [];
  for (let k = 0; k < body.length; k += 1) {
    const row = map.sections[k];
    const section = body[k];
    if (row.id !== section.id || row.paragraphs.length !== section.paragraphs.length) return null;
    sections.push({
      id: row.id,
      heading: row.heading,
      canonical: row.canonical,
      role: row.role,
      ...(typeof row.page === "number" ? { page: row.page } : {}),
      level: row.level ?? 1,
      ...(row.parentId !== undefined ? { parentId: row.parentId } : {}),
      first: texts.length,
      count: section.paragraphs.length,
    });
    for (const paragraph of section.paragraphs) texts.push(paragraph);
  }
  return { sections, texts, paragraphs: texts.length, figures: extra.figures ?? [], ...(extra.pages ? { pages: extra.pages } : {}) };
}

// ── The rules' draft ───────────────────────────────────────────────────

export interface DraftPart {
  /** Inclusive, in ordinals. */
  from: number;
  to: number;
  role: ReviewRole;
  conf: Confidence;
  /** Rule names and counts (`heading:methods`, `inherited`, `default`, `rows:2`, `paras:14`), never words of the paper. */
  tags: string[];
}

export interface StructureDraft {
  parts: DraftPart[];
  paragraphs: number;
  /** Where each section's paragraphs stand, so a displayed row can be put back on the ordinals. */
  sections: Array<{ id: string; first: number; count: number }>;
  /** One line per part: `<k> <from>-<to> <role> <conf> <tags>`. */
  lines: string[];
  /** A short digest of the draft, so a review made against another draft is never laid over this one. */
  digest: string;
}

/** cyrb53: a small, fast, non-cryptographic hash of a string, as hex — enough to tell two drafts apart. */
function digestOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

const CONF_RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };
const isReviewRole = (value: unknown): value is ReviewRole => typeof value === "string" && (REVIEW_ROLES as readonly string[]).includes(value);

/**
 * The rules' draft, from the map's TOP-LEVEL rows (a row with no `parentId`): each row, with the sub-rows under
 * it, is one run of paragraphs; its role is the row's own, with confidence `high` (the heading names the role);
 * a row nothing placed (`body`) takes the role of the part before it, `medium` (tag `inherited`); one at the
 * very start with nothing before it is `setup`, `low` (tag `default`). A row with no paragraphs under it is no
 * part. Neighbours of one role are one part, at the lowest confidence of the rows in it.
 * Null for a paper with no paragraph.
 */
export function draftOf(input: StructureInput): StructureDraft | null {
  if (input.paragraphs < 1) return null;
  interface Run {
    role: ReadingRole;
    canonical: string;
    from: number;
    to: number;
  }
  const runs: Run[] = [];
  for (const section of input.sections) {
    if (section.parentId === undefined || runs.length === 0) {
      runs.push({ role: section.role, canonical: section.canonical, from: section.first, to: section.first - 1 });
    }
    runs[runs.length - 1].to = section.first + section.count - 1;
  }

  const parts: Array<DraftPart & { rows: number }> = [];
  let before: ReviewRole | null = null;
  for (const run of runs) {
    if (run.to < run.from) continue;
    let role: ReviewRole;
    let conf: Confidence;
    let tag: string;
    if (isReviewRole(run.role)) {
      role = run.role;
      conf = "high";
      tag = /^[a-z_]{1,24}$/.test(run.canonical) ? `heading:${run.canonical}` : "heading:named";
    } else if (before) {
      role = before;
      conf = "medium";
      tag = "inherited";
    } else {
      role = "setup";
      conf = "low";
      tag = "default";
    }
    before = role;
    const last = parts[parts.length - 1];
    if (last && last.role === role) {
      last.to = run.to;
      if (CONF_RANK[conf] < CONF_RANK[last.conf]) last.conf = conf;
      if (!last.tags.includes(tag)) last.tags.push(tag);
      last.rows += 1;
    } else {
      parts.push({ from: run.from, to: run.to, role, conf, tags: [tag], rows: 1 });
    }
  }

  const finished: DraftPart[] = parts.map(({ rows, ...part }) => ({
    ...part,
    tags: [...part.tags.slice(0, 3), `rows:${rows}`, `paras:${part.to - part.from + 1}`],
  }));
  const lines = finished.map((part, k) => `${k} ${part.from}-${part.to} ${part.role} ${part.conf} ${part.tags.join(",")}`);
  return {
    parts: finished,
    paragraphs: input.paragraphs,
    sections: input.sections.map(({ id, first, count: n }) => ({ id, first, count: n })),
    lines,
    digest: digestOf(`${STRUCTURE_RULES_VERSION}|${input.paragraphs}|${lines.join("\n")}`),
  };
}

/** The draft of a reading's map and body — the browser's way in. Null for a reading with none. */
export function structureDraftOf(
  map: ReadingMap | undefined,
  body: ReadonlyArray<{ id: string; paragraphs: readonly string[] }> | undefined,
): StructureDraft | null {
  const input = structureInputOf(map, body);
  return input ? draftOf(input) : null;
}

// ── The skeleton ───────────────────────────────────────────────────────

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();
const wordsOf = (text: string): string[] => clean(text).split(" ").filter(Boolean);
const headOf = (text: string, words: number): string => {
  const all = wordsOf(text);
  return all.slice(0, words).join(" ") + (all.length > words ? "…" : "");
};
const headingOf = (heading: string): string => {
  const text = clean(heading).replace(/"/g, "'");
  return text.length > REVIEW_CAPS.headingChars ? `${text.slice(0, REVIEW_CAPS.headingChars - 1).trimEnd()}…` : text;
};

export type SkeletonMode = "A" | "B" | "B8";

export interface Skeleton {
  lines: string[];
  mode: SkeletonMode;
  chars: number;
  /** At four characters a token. */
  tokens: number;
}

function skeletonAt(
  input: StructureInput,
  draft: StructureDraft,
  counts: readonly string[],
  how: { headWords: number; selective: boolean; figures: boolean },
): string[] {
  // Mode B: a head only for the first two and the last paragraph of each part, every paragraph of a part the
  // rules are unsure of, and the first paragraph of each section. Counts stand everywhere.
  const headed = new Set<number>();
  if (how.selective) {
    for (const part of draft.parts) {
      headed.add(part.from);
      headed.add(part.from + 1);
      headed.add(part.to);
      if (part.conf === "low") for (let i = part.from; i <= part.to; i += 1) headed.add(i);
    }
    for (const section of input.sections) if (section.count > 0) headed.add(section.first);
  }
  const lines: string[] = [];
  for (const section of input.sections) {
    const range = section.count > 0 ? `${section.first}-${section.first + section.count - 1}` : "-";
    lines.push(`## ${section.id} L${section.level} p${section.page ?? "-"} ${section.canonical} "${headingOf(section.heading)}" ${range}`);
    for (let i = section.first; i < section.first + section.count; i += 1) {
      const head = !how.selective || headed.has(i) ? headOf(input.texts[i], how.headWords) : "";
      lines.push(`${i}${counts[i] ? ` ${counts[i]}` : ""}${head ? ` | ${head}` : ""}`);
    }
  }
  if (how.figures) {
    for (const figure of input.figures.slice(0, REVIEW_CAPS.figureLines)) {
      lines.push(`fig ${clean(figure.label).slice(0, 24)} p${figure.page ?? "-"} | ${headOf(figure.caption, REVIEW_CAPS.captionWords)}`);
    }
  }
  return lines;
}

/**
 * The skeleton of the paper, one string per line (grammar: B P12-42 §2.2):
 *
 *   ## <sectionId> L<level> p<page|-> <bucket> "<heading, 60 characters at most>" <from>-<to>
 *   <i>[ <counts>] | <the paragraph's first 16 words, "…" when cut>
 *   fig <label> p<page> | <the caption's first 8 words>
 *
 * Mode A (heads for every paragraph) while it fits the budget; then mode B; then mode B with 8-word heads and
 * no `fig` lines; then null — the draft stands, and the caller counts a `too_large`.
 */
export function buildSkeleton(
  input: StructureInput,
  draft: StructureDraft,
  budget: number = REVIEW_CAPS.skeletonChars,
): Skeleton | null {
  const tries: Array<{ mode: SkeletonMode; how: { headWords: number; selective: boolean; figures: boolean } }> = [
    { mode: "A", how: { headWords: REVIEW_CAPS.headWords, selective: false, figures: true } },
    { mode: "B", how: { headWords: REVIEW_CAPS.headWords, selective: true, figures: true } },
    { mode: "B8", how: { headWords: REVIEW_CAPS.shortHeadWords, selective: true, figures: false } },
  ];
  // The counts are the same in every mode: made once.
  const counts = input.texts.map((text) => countsText(paragraphFeatures(text)));
  for (const { mode, how } of tries) {
    const lines = skeletonAt(input, draft, counts, how);
    const chars = lines.join("\n").length;
    if (chars <= budget) return { lines, mode, chars, tokens: Math.ceil(chars / 4) };
  }
  return null;
}

// ── The prompt ─────────────────────────────────────────────────────────

const REVIEW_SYSTEM = [
  "You are Peer's structure checker.",
  "A rule-based reader split a paper into parts and gave each part a role.",
  "You see a skeleton of the paper, not the paper: every paragraph's number, its first words and counts of what it holds.",
  "Correct the draft only where it is wrong; return only corrections, or none. Do not quote the paper. Return only valid JSON.",
].join(" ");

const ROLES_TEXT: Readonly<Record<ReviewRole, string>> = {
  setup: "background, motivation, prior work and the question asked",
  method: "materials, samples, instruments, procedures, data processing and statistics, wherever they stand",
  evidence: "what was observed or measured, with the figures and tables that show it",
  interpretation: "what the evidence is taken to mean: discussion, comparison with other work, limits, conclusion, outlook",
  apparatus: "everything that is not the paper's argument: references, acknowledgements, notes, running heads",
};

const ROLE_CHOICE = REVIEW_ROLES.join(" | ");

const REVIEW_TASK = {
  task: "Check the draft's parts against the skeleton. Return only corrections; an empty list means the draft is right.",
  roles: ROLES_TEXT,
  countsKey: "F figure refs, T table refs, C citations, N numbers with units, V procedural verbs, W 'we show' or 'this work' signposts; a count of 0 is left out",
  outputSchema: {
    corrections: [
      { op: "move_start", part: "the part's number, 1 or more", toParagraph: "the paragraph number the part should start at" },
      { op: "set_role", part: "the part's number", role: ROLE_CHOICE },
      { op: "split", part: "the part's number", atParagraph: "a paragraph number inside that part, after its first", role: ROLE_CHOICE },
    ],
    unsure: ["the number of a part you cannot judge from the skeleton"],
  },
  rules: [
    "Return ONLY valid JSON of the shape in `outputSchema`. `corrections` is always present, empty when the draft is right.",
    "Every number refers to the draft as given; do not renumber after a correction.",
    "A part starts at the first paragraph of its role's content and runs until the next part starts; the first part starts at paragraph 0 and never moves.",
    "To remove a part that does not belong, give it the role of its neighbour. To add one, split.",
    "Judge by the heads and counts: a Methods run holds V and N, an evidence run holds F, T and N, a setup run holds C and few N. Use a heading only as one clue.",
    "List a part in `unsure` rather than guess.",
  ],
} as const;

/** The prompt's fixed text (system and the parts of the user JSON that do not depend on the paper): pinned by a test. */
export function reviewPromptFixedText(): string {
  return `${REVIEW_SYSTEM}\n${JSON.stringify(REVIEW_TASK)}`;
}

export interface ReviewPrompt {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

/** The review prompt: the skeleton and the draft beside the fixed text. No title, nothing about the reader. */
export function buildReviewPrompt(args: { skeleton: Skeleton; draft: StructureDraft; pages?: number }): ReviewPrompt {
  const userPrompt = JSON.stringify({
    task: REVIEW_TASK.task,
    paper: { ...(args.pages ? { pages: args.pages } : {}) },
    roles: REVIEW_TASK.roles,
    countsKey: REVIEW_TASK.countsKey,
    skeleton: args.skeleton.lines,
    draft: { columns: "part from-to role confidence evidence", parts: args.draft.lines },
    outputSchema: REVIEW_TASK.outputSchema,
    rules: REVIEW_TASK.rules,
  });
  return { systemPrompt: REVIEW_SYSTEM, userPrompt, maxTokens: REVIEW_CAPS.answerTokens };
}

// ── The answer, made whole ─────────────────────────────────────────────

export type Correction =
  | { op: "move_start"; part: number; toParagraph: number }
  | { op: "set_role"; part: number; role: ReviewRole }
  | { op: "split"; part: number; atParagraph: number; role: ReviewRole };

export interface Answer {
  corrections: Correction[];
  unsure: number[];
}

export interface Part {
  from: number;
  to: number;
  role: ReviewRole;
}

const isRec = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A whole number from a number or a digit string; a float, a negative or anything else is null. */
const whole = (value: unknown): number | null =>
  typeof value === "number"
    ? Number.isSafeInteger(value) && value >= 0
      ? value
      : null
    : typeof value === "string" && /^\d{1,9}$/.test(value)
      ? Number(value)
      : null;

/** One of the five roles after trim and lower-case. No aliases, and `body` is refused. */
const roleFrom = (value: unknown): ReviewRole | null => {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isReviewRole(role) ? role : null;
};

/**
 * 1. The answer, correction by correction, against the DRAFT as given. Null is "not an answer at all" (not an
 * object, no `corrections` array): the draft stands and nothing is kept. `rejected` counts what was dropped,
 * `read` how many corrections were in the answer.
 */
export function sanitizeReview(
  raw: unknown,
  draft: readonly DraftPart[],
  paragraphs: number,
): { answer: Answer; rejected: number; read: number } | null {
  if (!isRec(raw) || !Array.isArray(raw.corrections)) return null;
  const out: Correction[] = [];
  let rejected = 0;
  const moved = new Set<number>();
  const roled = new Set<number>();
  const splits = new Map<number, Set<number>>();
  for (const c of raw.corrections as unknown[]) {
    if (out.length >= REVIEW_CAPS.corrections) {
      rejected += 1;
      continue;
    }
    if (!isRec(c)) {
      rejected += 1;
      continue;
    }
    const k = whole(c.part);
    if (k === null || k >= draft.length) {
      rejected += 1;
      continue;
    }
    if (c.op === "move_start") {
      const i = whole(c.toParagraph);
      // Part 0 never moves; the start stays in the draft's own room: after the previous part's first paragraph, up
      // to this part's last, somewhere new, and once only.
      if (i === null || k === 0 || i >= paragraphs || i <= draft[k - 1].from || i > draft[k].to || i === draft[k].from || moved.has(k)) {
        rejected += 1;
        continue;
      }
      moved.add(k);
      out.push({ op: "move_start", part: k, toParagraph: i });
    } else if (c.op === "set_role") {
      const role = roleFrom(c.role);
      if (role === null || role === draft[k].role || roled.has(k)) {
        rejected += 1;
        continue;
      }
      roled.add(k);
      out.push({ op: "set_role", part: k, role });
    } else if (c.op === "split") {
      const at = whole(c.atParagraph);
      const role = roleFrom(c.role);
      const seen = splits.get(k) ?? new Set<number>();
      if (at === null || role === null || at <= draft[k].from || at > draft[k].to || seen.has(at) || seen.size >= REVIEW_CAPS.splitsPerPart) {
        rejected += 1;
        continue;
      }
      seen.add(at);
      splits.set(k, seen);
      out.push({ op: "split", part: k, atParagraph: at, role });
    } else {
      rejected += 1;
    }
  }
  const unsure = Array.isArray(raw.unsure)
    ? [...new Set((raw.unsure as unknown[]).map(whole).filter((n): n is number => n !== null && n < draft.length))]
    : [];
  return { answer: { corrections: out, unsure }, rejected, read: raw.corrections.length };
}

/** 2. Starts first, roles next, splits last; any correction that breaks the order is dropped, never repaired. */
export function applyCorrections(
  draft: readonly DraftPart[],
  paragraphs: number,
  answer: Answer,
): { parts: Part[]; applied: number; dropped: number } {
  const starts = draft.map((part) => part.from);
  const roles: ReviewRole[] = draft.map((part) => part.role);
  let applied = 0;
  let dropped = 0;
  for (const c of answer.corrections) {
    if (c.op !== "move_start") continue;
    const k = c.part;
    if (starts[k - 1] < c.toParagraph && c.toParagraph < (starts[k + 1] ?? paragraphs)) {
      starts[k] = c.toParagraph;
      applied += 1;
    } else {
      dropped += 1;
    }
  }
  for (const c of answer.corrections) {
    if (c.op === "set_role") {
      roles[c.part] = c.role;
      applied += 1;
    }
  }
  const list = draft.map((_, k) => ({ start: starts[k], role: roles[k] }));
  const extra: Array<{ start: number; role: ReviewRole }> = [];
  for (const c of answer.corrections) {
    if (c.op !== "split") continue;
    const lo = starts[c.part];
    const hi = starts[c.part + 1] ?? paragraphs;
    if (c.atParagraph > lo && c.atParagraph < hi && !extra.some((e) => e.start === c.atParagraph)) {
      extra.push({ start: c.atParagraph, role: c.role });
      applied += 1;
    } else {
      dropped += 1;
    }
  }
  const all = [...list, ...extra].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; role: ReviewRole }> = [];
  // Neighbours of one role are one part.
  for (const part of all) if (merged.length === 0 || merged[merged.length - 1].role !== part.role) merged.push(part);
  merged[0] = { ...merged[0], start: 0 };
  return {
    parts: merged.map((part, i) => ({ from: part.start, to: i + 1 < merged.length ? merged[i + 1].start - 1 : paragraphs - 1, role: part.role })),
    applied,
    dropped,
  };
}

/** 3. The whole structure's invariants: starts at 0, contiguous, ends at the last paragraph, roles from the five. */
export function sound(parts: readonly Part[], paragraphs: number): boolean {
  if (parts.length === 0 || parts[0].from !== 0) return false;
  let next = 0;
  for (const part of parts) {
    if (part.from !== next || part.to < part.from || !isReviewRole(part.role)) return false;
    next = part.to + 1;
  }
  return next === paragraphs;
}

export type FellBack = "unusable" | "timeout" | "provider_error" | "too_large";

export interface Reviewed {
  parts: Part[];
  answer: Answer | null;
  rejected: number;
  fellBack: boolean;
}

/** The draft as plain parts. */
export const partsOf = (draft: readonly DraftPart[]): Part[] => draft.map(({ from, to, role }) => ({ from, to, role }));

/**
 * The whole step: never throws, never returns an unsound structure. An answer that is not one — or one whose
 * corrections were all refused, which is a model that did not understand — leaves the draft exactly.
 */
export function reviewStructure(raw: unknown, draft: readonly DraftPart[], paragraphs: number): Reviewed {
  const base = partsOf(draft);
  try {
    const sanitized = sanitizeReview(raw, draft, paragraphs);
    if (!sanitized || (sanitized.read > 0 && sanitized.answer.corrections.length === 0)) {
      return { parts: base, answer: null, rejected: sanitized?.rejected ?? 0, fellBack: true };
    }
    const result = applyCorrections(draft, paragraphs, sanitized.answer);
    return sound(result.parts, paragraphs)
      ? { parts: result.parts, answer: sanitized.answer, rejected: sanitized.rejected + result.dropped, fellBack: false }
      : { parts: base, answer: null, rejected: sanitized.rejected, fellBack: true };
  } catch {
    return { parts: base, answer: null, rejected: 0, fellBack: true };
  }
}

// ── The second, targeted look ──────────────────────────────────────────

export type LookWhy = "contradicts-high" | "contradicts-medium" | "unsure";
export interface LookTarget {
  part: number;
  why: LookWhy;
}

/**
 * Which parts get a second look: a part the answer corrects that the rules were `high` or `medium` about, and a
 * part listed `unsure`. A correction against a `low` part draws none (the rules already said they were unsure).
 * Strongest contradiction first, then the unsure, then the part's number; at most three.
 */
export function secondLookTargets(draft: readonly DraftPart[], answer: Answer): LookTarget[] {
  const rank = { "contradicts-high": 0, "contradicts-medium": 1, unsure: 2 } as const;
  const seen = new Map<number, LookWhy>();
  for (const c of answer.corrections) {
    const conf = draft[c.part].conf;
    if (conf === "low") continue;
    const why: LookWhy = conf === "high" ? "contradicts-high" : "contradicts-medium";
    const had = seen.get(c.part);
    if (had === undefined || rank[why] < rank[had]) seen.set(c.part, why);
  }
  for (const k of answer.unsure) if (!seen.has(k)) seen.set(k, "unsure");
  return [...seen]
    .map(([part, why]) => ({ part, why }))
    .sort((a, b) => rank[a.why] - rank[b.why] || a.part - b.part)
    .slice(0, REVIEW_CAPS.secondLooks);
}

/** A part thinned: its first 3, its last 2 and every fourth between. */
function thinned(part: Pick<DraftPart, "from" | "to">): number[] {
  const out: number[] = [];
  for (let i = part.from; i <= part.to; i += 1) if (i - part.from < 3 || part.to - i < 2 || (i - part.from) % 4 === 0) out.push(i);
  return out;
}

/**
 * The paragraphs a second look reads, as ordinals in order — only the disputed span:
 *   - `move_start`: 3 either side of the old start and of the new one, not leaving the two parts it lies between;
 *   - `split`: 4 either side of the point;
 *   - `set_role`, and a part listed `unsure`: the part, thinned.
 * Each paragraph is clipped to 600 characters and the whole to 6,000 when the prompt is built (`lookWindow`).
 */
export function lookParagraphs(draft: readonly DraftPart[], answer: Answer, target: LookTarget): number[] {
  const part = draft[target.part];
  const set = new Set<number>();
  const lo = target.part > 0 ? draft[target.part - 1].from : part.from;
  const add = (from: number, to: number, floor: number, ceil: number) => {
    for (let i = Math.max(from, floor); i <= Math.min(to, ceil); i += 1) set.add(i);
  };
  const mine = target.why === "unsure" ? [] : answer.corrections.filter((c) => c.part === target.part);
  for (const c of mine) {
    if (c.op === "move_start") {
      add(part.from - 3, part.from + 2, lo, part.to);
      add(c.toParagraph - 3, c.toParagraph + 2, lo, part.to);
    } else if (c.op === "split") {
      add(c.atParagraph - 4, c.atParagraph + 3, part.from, part.to);
    } else {
      for (const i of thinned(part)) set.add(i);
    }
  }
  if (set.size === 0) for (const i of thinned(part)) set.add(i);
  return [...set].sort((a, b) => a - b);
}

/** The window as `{ n, text }`: each paragraph clipped to 600 characters, then the outermost dropped (first, then
 *  last, alternately) until the whole is at most 6,000 characters. */
export function lookWindow(texts: readonly string[], ordinals: readonly number[]): Array<{ n: number; text: string }> {
  const items = ordinals.map((n) => ({ n, text: clean(texts[n] ?? "").slice(0, REVIEW_CAPS.lookParagraphChars) }));
  let total = items.reduce((sum, item) => sum + item.text.length, 0);
  let fromFront = true;
  while (total > REVIEW_CAPS.lookChars && items.length > 1) {
    const dropped = fromFront ? items.shift()! : items.pop()!;
    total -= dropped.text.length;
    fromFront = !fromFront;
  }
  return items;
}

const LOOK_SYSTEM = [
  "You are Peer's structure checker.",
  "Two readings of a few paragraphs of a paper disagree about what part of the paper they belong to.",
  "Say which reading is right, from the paragraphs alone. Do not quote the paper. Return only valid JSON.",
].join(" ");

/** "paragraphs 12–14 are setup; 15–18 are method" over the window's own numbers. */
function readingText(window: ReadonlyArray<{ n: number }>, roleAt: (n: number) => ReviewRole): string {
  const runs: string[] = [];
  let i = 0;
  while (i < window.length) {
    let j = i;
    while (j + 1 < window.length && roleAt(window[j + 1].n) === roleAt(window[i].n)) j += 1;
    runs.push(`${window[i].n === window[j].n ? `paragraph ${window[i].n}` : `paragraphs ${window[i].n}–${window[j].n}`} ${j === i ? "is" : "are"} ${roleAt(window[i].n)}`);
    i = j + 1;
  }
  return runs.join("; ");
}

const roleAtIn = (parts: readonly Part[]) => (n: number): ReviewRole => (parts.find((part) => n >= part.from && n <= part.to) ?? parts[0]).role;

export interface LookPrompt extends ReviewPrompt {
  /** How many paragraphs and characters of the paper the look carries. */
  paragraphs: number;
  textChars: number;
}

/** The look's prompt for one target. The title and the reader are not in it; the paper's words are, a span of them. */
export function buildLookPrompt(args: {
  draft: StructureDraft;
  answer: Answer;
  target: LookTarget;
  texts: readonly string[];
}): LookPrompt {
  const { draft, answer, target } = args;
  const window = lookWindow(args.texts, lookParagraphs(draft.parts, answer, target));
  const draftAt = roleAtIn(partsOf(draft.parts));
  const mine = target.why === "unsure" ? [] : answer.corrections.filter((c) => c.part === target.part);
  const reviewAt = mine.length > 0 ? roleAtIn(applyCorrections(draft.parts, draft.paragraphs, { corrections: mine, unsure: [] }).parts) : null;
  const userPrompt = JSON.stringify({
    task: "Which reading of these paragraphs is right?",
    roles: ROLES_TEXT,
    paragraphs: window,
    readings: {
      draft: readingText(window, draftAt),
      review: reviewAt ? readingText(window, reviewAt) : `these paragraphs are not ${draft.parts[target.part].role} (name the role they are)`,
    },
    outputSchema: { verdict: "draft | review", role: `only when the review does not say which role: ${ROLE_CHOICE}` },
    rules: ["Return ONLY valid JSON of the shape in `outputSchema`.", "Judge from the paragraphs, not from which reading came first."],
  });
  return {
    systemPrompt: LOOK_SYSTEM,
    userPrompt,
    maxTokens: REVIEW_CAPS.lookTokens,
    paragraphs: window.length,
    textChars: window.reduce((sum, item) => sum + item.text.length, 0),
  };
}

export type LookVerdict = { verdict: "draft" } | { verdict: "review"; role?: ReviewRole };

/** The look's answer, or null for anything that is not one. */
export function parseLookVerdict(raw: unknown): LookVerdict | null {
  if (!isRec(raw) || typeof raw.verdict !== "string") return null;
  const verdict = raw.verdict.trim().toLowerCase();
  if (verdict === "draft") return { verdict: "draft" };
  if (verdict !== "review") return null;
  const role = roleFrom(raw.role);
  return role ? { verdict: "review", role } : { verdict: "review" };
}

export interface LookRecord {
  part: number;
  why: LookWhy;
  /** `failed`: the look did not answer, or not in a way that could be read. */
  verdict: "draft" | "review" | "failed";
}

/**
 * The corrections after the looks. For a part the model corrected against the rules' high or medium confidence:
 * the correction stands on `review`, and on `draft` — or on a look that failed or could not be read — the rules
 * stand and the part's corrections go. For a part the model could not judge (`unsure`): it stays as the draft,
 * unless the look says `review` and names a different role, which becomes a `set_role` of that part.
 * A part with no look keeps what it had (corrections against a `low` part are never looked at).
 */
export function resolveLooks(
  draft: readonly DraftPart[],
  answer: Answer,
  looks: ReadonlyArray<{ target: LookTarget; verdict: LookVerdict | null }>,
): { answer: Answer; records: LookRecord[] } {
  let corrections = [...answer.corrections];
  const records: LookRecord[] = [];
  for (const { target, verdict } of looks) {
    records.push({ part: target.part, why: target.why, verdict: verdict ? verdict.verdict : "failed" });
    if (target.why === "unsure") {
      if (verdict?.verdict === "review" && verdict.role && verdict.role !== draft[target.part].role && !corrections.some((c) => c.part === target.part && c.op === "set_role")) {
        corrections.push({ op: "set_role", part: target.part, role: verdict.role });
      }
    } else if (verdict?.verdict !== "review") {
      corrections = corrections.filter((c) => c.part !== target.part);
    }
  }
  return { answer: { corrections, unsure: answer.unsure }, records };
}

// ── What is kept ───────────────────────────────────────────────────────

/** A finished review as the server remembers it and sends it: indices, role names and the model's id — no word of the paper. */
export interface StructureReviewEntry {
  v: 1;
  docHash: string;
  rulesVersion: string;
  skeletonVersion: string;
  promptVersion: string;
  /** The draft the corrections are numbered against. */
  draftDigest: string;
  corrections: Correction[];
  unsure: number[];
  secondLooks: LookRecord[];
  /** `<provider>/<tier or model>`; recorded, not keyed (D5). */
  model: string;
  reviewedAt: number;
}

/** What the route says. */
export type StructureResult =
  | { review: StructureReviewEntry; cached: boolean }
  | { unavailable: true }
  | { fellBack: FellBack };

/** `docHash | rules | skeleton | prompt`: the paper version and the three things that decide what is asked and what the rules say. */
export function structureReviewKey(docHash: string): string {
  return `${docHash}|rules:${STRUCTURE_RULES_VERSION}|skel:${SKELETON_VERSION}|prompt:${REVIEW_PROMPT_VERSION}`;
}

export interface StructureReviewCache {
  get(key: string): StructureReviewEntry | undefined;
  set(key: string, entry: StructureReviewEntry): void;
  size(): number;
  clear(): void;
}

/** In this process only: at most `max` finished reviews for at most `ttlMs`, the oldest forgotten first. */
export function createStructureReviewCache(options: { max?: number; ttlMs?: number; now?: () => number } = {}): StructureReviewCache {
  const max = options.max ?? REVIEW_CAPS.cacheEntries;
  const ttlMs = options.ttlMs ?? REVIEW_CAPS.cacheTtlMs;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; entry: StructureReviewEntry }>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return hit.entry;
    },
    set(key, entry) {
      entries.delete(key);
      entries.set(key, { at: now(), entry });
      while (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    size: () => entries.size,
    clear: () => entries.clear(),
  };
}

/** The route's own memory. */
export const structureReviewCache: StructureReviewCache = createStructureReviewCache();

/**
 * A stored or fetched review, read: the entry it holds, or null for anything else (a corrupt store, another
 * version of the rules, the skeleton or the prompt). The corrections are shape-checked here; the ranges are
 * checked against the draft when they are applied.
 */
export function restoreReview(value: unknown): StructureReviewEntry | null {
  if (!isRec(value) || value.v !== 1) return null;
  if (value.rulesVersion !== STRUCTURE_RULES_VERSION || value.skeletonVersion !== SKELETON_VERSION || value.promptVersion !== REVIEW_PROMPT_VERSION) return null;
  if (typeof value.draftDigest !== "string" || value.draftDigest === "" || !Array.isArray(value.corrections)) return null;
  const corrections: Correction[] = [];
  for (const c of value.corrections.slice(0, REVIEW_CAPS.corrections) as unknown[]) {
    if (!isRec(c)) continue;
    const part = whole(c.part);
    if (part === null) continue;
    if (c.op === "move_start") {
      const to = whole(c.toParagraph);
      if (to !== null) corrections.push({ op: "move_start", part, toParagraph: to });
    } else if (c.op === "set_role") {
      const role = roleFrom(c.role);
      if (role) corrections.push({ op: "set_role", part, role });
    } else if (c.op === "split") {
      const at = whole(c.atParagraph);
      const role = roleFrom(c.role);
      if (at !== null && role) corrections.push({ op: "split", part, atParagraph: at, role });
    }
  }
  const unsure = Array.isArray(value.unsure) ? (value.unsure as unknown[]).map(whole).filter((n): n is number => n !== null) : [];
  const looks: LookRecord[] = [];
  if (Array.isArray(value.secondLooks)) {
    for (const look of value.secondLooks as unknown[]) {
      if (!isRec(look)) continue;
      const part = whole(look.part);
      const why = look.why;
      const verdict = look.verdict;
      if (part !== null && (why === "contradicts-high" || why === "contradicts-medium" || why === "unsure") && (verdict === "draft" || verdict === "review" || verdict === "failed")) {
        looks.push({ part, why, verdict });
      }
    }
  }
  return {
    v: 1,
    docHash: typeof value.docHash === "string" ? value.docHash : "",
    rulesVersion: STRUCTURE_RULES_VERSION,
    skeletonVersion: SKELETON_VERSION,
    promptVersion: REVIEW_PROMPT_VERSION,
    draftDigest: value.draftDigest,
    corrections,
    unsure,
    secondLooks: looks,
    model: typeof value.model === "string" ? value.model.slice(0, 80) : "",
    reviewedAt: typeof value.reviewedAt === "number" ? value.reviewedAt : 0,
  };
}

// ── The review laid over the map ───────────────────────────────────────

/** The parts a review makes of a draft, or null when the review does not belong to this draft or is unsound. */
export function reviewedParts(draft: StructureDraft, review: Pick<StructureReviewEntry, "corrections" | "unsure" | "draftDigest">): Part[] | null {
  if (review.draftDigest !== draft.digest) return null;
  const result = reviewStructure({ corrections: review.corrections, unsure: review.unsure }, draft.parts, draft.paragraphs);
  return result.fellBack ? null : result.parts;
}

type MapRow = ReadingMapSection & { part?: { sectionId?: string } };

/** The role of every ordinal under a list of parts. */
function roleByOrdinal(parts: readonly Part[], paragraphs: number): ReviewRole[] {
  const roles: ReviewRole[] = new Array<ReviewRole>(paragraphs);
  for (const part of parts) for (let i = part.from; i <= part.to && i < paragraphs; i += 1) roles[i] = part.role;
  return roles;
}

/** The role most of these ordinals have; on a tie, the one met first. */
function majority(roles: readonly ReviewRole[], ordinals: readonly number[]): ReviewRole | undefined {
  const tally = new Map<ReviewRole, number>();
  for (const n of ordinals) if (roles[n]) tally.set(roles[n], (tally.get(roles[n]) ?? 0) + 1);
  let best: ReviewRole | undefined;
  let most = 0;
  for (const [role, n] of tally) {
    if (n > most) {
      best = role;
      most = n;
    }
  }
  return best;
}

/**
 * The map with the review's roles laid over its rows, right after the partition overlay. A row is one run of
 * paragraphs and shows one role: the role most of its paragraphs have, and it changes only where the review
 * changed that (a boundary inside a row, between two paragraphs, is not a row the map can draw; the rows the
 * Tier-0 partition makes for such a boundary carry it). No row is added, removed or reordered and no id
 * changes, so the scroll position cannot move, and a changed row carries no mark (§1h.424 (a)). A sub-row whose
 * own heading names a role keeps it. A row the review leaves as it was is the very object it was; the map is
 * returned as it came (the same object) for no review, a review of another draft, an unsound one, or one that
 * changes no row.
 */
export function applyStructureReview(
  map: ReadingMap,
  draft: StructureDraft,
  review: Pick<StructureReviewEntry, "corrections" | "unsure" | "draftDigest"> | null | undefined,
): ReadingMap {
  if (!review) return map;
  const parts = reviewedParts(draft, review);
  if (!parts) return map;
  const was = roleByOrdinal(partsOf(draft.parts), draft.paragraphs);
  const now = roleByOrdinal(parts, draft.paragraphs);
  const where = new Map(draft.sections.map((section) => [section.id, section]));
  let changed = false;
  const sections = map.sections.map((row) => {
    const section = where.get((row as MapRow).part?.sectionId ?? row.id);
    if (!section) return row;
    if (row.paragraphs.some((line) => !Number.isInteger(line.index) || line.index < 0 || line.index >= section.count)) return row;
    // A row with no paragraph of its own (a group heading) stands where the next paragraph does.
    const ordinals = row.paragraphs.length > 0 ? row.paragraphs.map((line) => section.first + line.index) : [Math.min(section.first, draft.paragraphs - 1)];
    const role = majority(now, ordinals);
    if (!role || role === majority(was, ordinals) || role === row.role) return row;
    const subRow = row.parentId !== undefined || (row.level ?? 1) > 1;
    if (subRow && row.role !== "body") return row;
    changed = true;
    return { ...row, role };
  });
  return changed ? { ...map, sections } : map;
}
