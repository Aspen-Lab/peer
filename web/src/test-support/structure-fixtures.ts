// Invented papers and a truth-reading test double for the structure review's tests (P12-53; B P12-42 §6).
//
// Nothing here is a real paper or a real model. `inventedPaper` builds a document whose paragraphs name their
// own role in their first words and carry the counts of that role (a method paragraph says "were heated at
// 120 °C for 2 h", an evidence paragraph "Fig. 2 shows a rise of 14 %"). `modelDouble` stands in for the
// provider: it reads ONLY the prompt it is given — the skeleton's heads and counts, the draft's lines, a look's
// paragraphs — infers each paragraph's role from its head, and returns the minimal corrections that turn the
// draft into what it read. The stub of the e2e harness is the same idea one level down: it answers from the
// prompt, never from the world.
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { readableSections, readingMapOf, type ReadingMap } from "@/lib/papers/reading-map";
import { REVIEW_ROLES, structureInputOf, type ReviewRole, type StructureInput } from "@/lib/papers/structure-review";

const TOPICS = ["tide pools", "kelp beds", "gull colonies", "sand ripples", "salt marsh", "mussel banks"];

/** One invented paragraph of a role. Its second word is the role, so a head names it. */
export function inventedParagraph(role: ReviewRole, g: number): string {
  const topic = TOPICS[g % TOPICS.length];
  const lead = `Invented ${role} paragraph ${g} about ${topic}.`;
  switch (role) {
    case "setup":
      return `${lead} Earlier surveys of the ${topic} were reported in the literature [${(g % 9) + 1}] and again later (Marsh et al., 2018). Nothing here is quoted from a paper.`;
    case "method":
      return `${lead} The samples were heated at 120 °C for 2 h, and the probes were then placed in 5 mL of water. Nothing here is quoted from a paper.`;
    case "evidence":
      return `${lead} Fig. 2 shows a rise of 14 % in the counts, and Table 1 lists 12 mm of growth. Nothing here is quoted from a paper.`;
    case "interpretation":
      return `${lead} We suggest that this work points to slower growth, as noted before (Marsh, 2020). Nothing here is quoted from a paper.`;
    case "apparatus":
      return `${lead} [${g}] A. Author, Journal of Invented Results 3, 45 (2019). Nothing here is quoted from a paper.`;
  }
}

export interface InventedRow {
  heading: string;
  /** The bucket the extractor would give the heading (`introduction`, `methods`, …, or `body`). */
  canonical: string;
  /** The TRUE roles of the row's paragraphs, as runs: `[["method", 2], ["evidence", 5]]`. */
  truth: Array<[ReviewRole, number]>;
}

export interface InventedPaper {
  doc: ExtractedDocument;
  input: StructureInput;
  map: ReadingMap;
  /** The reading's body as the page and the route hold it: `{ id, canonical, paragraphs }` per section. */
  body: Array<{ id: string; canonical: string; paragraphs: string[] }>;
  /** The true role of every paragraph, by ordinal. */
  roles: ReviewRole[];
  /** The true parts: neighbours of one role are one part. */
  truthParts: Array<{ from: number; to: number; role: ReviewRole }>;
  /** The whole parsed text, in characters: every heading and every paragraph. */
  wholeChars: number;
}

export function partsOfRoles(roles: readonly ReviewRole[]): Array<{ from: number; to: number; role: ReviewRole }> {
  const parts: Array<{ from: number; to: number; role: ReviewRole }> = [];
  roles.forEach((role, i) => {
    const last = parts[parts.length - 1];
    if (last && last.role === role) last.to = i;
    else parts.push({ from: i, to: i, role });
  });
  return parts;
}

/** An invented paper of the rows given. Sub-rows are rows whose heading starts "2.1" under "2." and so on. */
export function inventedPaper(
  rows: readonly InventedRow[],
  opts: {
    pageCount?: number;
    figures?: number;
    /** The abstract the closing split reads (the record's, joined as the browser or the server joins it). */
    abstract?: string;
    /** Paragraph texts to put in place of the generated ones, by ordinal (the role they carry is the row's `truth`). */
    paragraphs?: Record<number, string>;
  } = {},
): InventedPaper {
  let g = 0;
  const roles: ReviewRole[] = [];
  const sections = rows.map((row, k) => {
    const paragraphs: string[] = [];
    for (const [role, n] of row.truth) {
      for (let i = 0; i < n; i += 1) {
        paragraphs.push(opts.paragraphs?.[g] ?? inventedParagraph(role, g));
        roles.push(role);
        g += 1;
      }
    }
    return { id: `s${k + 1}`, heading: row.heading, canonical: row.canonical, page: 1 + Math.floor(k / 2), text: paragraphs.join("\n\n") };
  });
  const doc: ExtractedDocument = {
    source: "pdf",
    pageCount: opts.pageCount ?? 1 + Math.ceil(rows.length / 2),
    figureCaptions: Array.from({ length: opts.figures ?? 0 }, (_, i) => ({
      ordinal: i + 1,
      label: `Figure ${i + 1}`,
      caption: `Invented caption ${i + 1} about the ${TOPICS[i % TOPICS.length]} and nothing else at all in this fixture.`,
      page: 2,
    })),
    sections,
  };
  const rendered = readableSections(doc);
  const map = readingMapOf(rendered);
  const input = structureInputOf(map, rendered.map((r) => ({ id: r.id, canonical: r.section.canonical, paragraphs: r.paragraphs })), {
    abstract: opts.abstract,
    figures: doc.figureCaptions.map((f) => ({ label: f.label, caption: f.caption, ...(f.page ? { page: f.page } : {}) })),
    pages: doc.pageCount,
  });
  if (!input) throw new Error("invented paper has no input");
  const wholeChars = rendered.reduce((sum, r) => sum + r.section.heading.length + r.paragraphs.reduce((n, p) => n + p.length, 0), 0);
  const body = rendered.map((r) => ({ id: r.id, canonical: r.section.canonical, paragraphs: r.paragraphs }));
  return { doc, input, map, body, roles, truthParts: partsOfRoles(roles), wholeChars };
}

/** The canonical case: five true parts across seven rows. */
export const FIVE_PARTS: readonly InventedRow[] = [
  { heading: "1 Introduction", canonical: "introduction", truth: [["setup", 6]] },
  { heading: "2 Methods", canonical: "methods", truth: [["method", 3]] },
  // The Results row begins with two method paragraphs: the draft's evidence part starts two early.
  { heading: "3 Results", canonical: "results", truth: [["method", 2], ["evidence", 7]] },
  // Heading-bucketed as methods, but it is more evidence: the draft's role here is wrong.
  { heading: "4 Further analysis", canonical: "methods", truth: [["evidence", 4]] },
  { heading: "5 Conclusions", canonical: "conclusion", truth: [["interpretation", 4]] },
  { heading: "References", canonical: "references", truth: [["apparatus", 3]] },
];

// ── The double ─────────────────────────────────────────────────────────

const ROLE_SET: ReadonlySet<string> = new Set(REVIEW_ROLES);

/** The skeleton's paragraph lines: ordinal and head (the head is absent in mode B for an interior paragraph). */
function readHeads(skeleton: readonly string[]): Map<number, string> {
  const heads = new Map<number, string>();
  for (const line of skeleton) {
    const m = /^(\d+)(?: [FTCNVW]\d+)*(?: \| (.*))?$/.exec(line);
    if (m && m[2] !== undefined) heads.set(Number(m[1]), m[2]);
  }
  return heads;
}

/** The role a head names ("Invented setup paragraph …"), or null for a head that names none. */
export function roleNamedBy(text: string): ReviewRole | null {
  const word = /^Invented (\w+) paragraph/.exec(text)?.[1] ?? "";
  return ROLE_SET.has(word) ? (word as ReviewRole) : null;
}

interface DraftLine {
  k: number;
  from: number;
  to: number;
  role: ReviewRole;
}
function readDraft(lines: readonly string[]): DraftLine[] {
  return lines.map((line) => {
    const [k, range, role] = line.split(" ");
    const [from, to] = range.split("-").map(Number);
    return { k: Number(k), from, to, role: role as ReviewRole };
  });
}

/**
 * What the double does with a prompt: a review prompt (its `outputSchema` has `corrections`) gets the minimal
 * corrections from what the heads say; a look prompt (`verdict`) gets the reading that agrees with the
 * paragraphs. Anything else gets `{}`. A paragraph whose head is not shown (mode B) is taken to continue the
 * role before it.
 */
export function modelDouble(userPrompt: string): string {
  const user = JSON.parse(userPrompt) as Record<string, unknown>;
  const schema = (user.outputSchema ?? {}) as Record<string, unknown>;
  if (schema.corrections) return JSON.stringify(reviewAnswer(user));
  if (schema.verdict) return JSON.stringify(lookAnswer(user));
  return "{}";
}

function reviewAnswer(user: Record<string, unknown>) {
  const heads = readHeads(user.skeleton as string[]);
  const draft = readDraft((user.draft as { parts: string[] }).parts);
  const total = draft[draft.length - 1].to + 1;
  // What the heads say, paragraph by paragraph.
  const said: ReviewRole[] = [];
  let carried: ReviewRole = draft[0].role;
  for (let i = 0; i < total; i += 1) {
    const named = heads.has(i) ? roleNamedBy(heads.get(i)!) : null;
    if (named) carried = named;
    said.push(carried);
  }
  const truth: Array<{ start: number; role: ReviewRole }> = [];
  said.forEach((role, i) => {
    if (i === 0 || said[i - 1] !== role) truth.push({ start: i, role });
  });
  const truthStarts = new Set(truth.map((t) => t.start));
  const corrections: Array<Record<string, unknown>> = [];
  const draftStarts = new Set(draft.map((d) => d.from));
  const moved = new Map<number, number>();
  const usedTruth = new Set<number>();
  for (const part of draft) {
    if (part.k === 0 || truthStarts.has(part.from)) {
      if (truthStarts.has(part.from)) usedTruth.add(part.from);
      continue;
    }
    // A truth start within 3 paragraphs that no draft part starts at, and whose role is this part's.
    const near = truth.find((t) => !draftStarts.has(t.start) && !usedTruth.has(t.start) && Math.abs(t.start - part.from) <= 3 && t.role === part.role);
    if (near) {
      usedTruth.add(near.start);
      moved.set(part.k, near.start);
      corrections.push({ op: "move_start", part: part.k, toParagraph: near.start });
    }
  }
  // A truth start nobody starts at, inside a draft part: split there.
  for (const t of truth) {
    if (t.start === 0 || draftStarts.has(t.start) || usedTruth.has(t.start)) continue;
    const inside = draft.find((d) => t.start > d.from && t.start <= d.to);
    if (inside && said[t.start - 1] !== t.role) corrections.push({ op: "split", part: inside.k, atParagraph: t.start, role: t.role });
  }
  // A part whose role is not what its first paragraph says.
  for (const part of draft) {
    const start = moved.get(part.k) ?? part.from;
    if (said[start] !== part.role) corrections.push({ op: "set_role", part: part.k, role: said[start] });
  }
  return { corrections, unsure: [] as number[] };
}

function lookAnswer(user: Record<string, unknown>) {
  const window = user.paragraphs as Array<{ n: number; text: string }>;
  const readings = user.readings as { draft: string; review: string };
  const said = new Map(window.map((p) => [p.n, roleNamedBy(p.text)]));
  const score = (reading: string): number => {
    let hits = 0;
    for (const m of reading.matchAll(/paragraphs? (\d+)(?:–(\d+))? (?:is|are) (\w+)/g)) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      for (const p of window) if (p.n >= from && p.n <= to && said.get(p.n) === m[3]) hits += 1;
    }
    return hits;
  };
  const draft = score(readings.draft);
  // A look with only the draft's reading and "not R": the paragraphs' own majority role, when it is not the draft's.
  if (/name the role they are/.test(readings.review)) {
    const tally = new Map<string, number>();
    for (const role of said.values()) if (role) tally.set(role, (tally.get(role) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1])[0];
    return top && draft < window.length / 2 ? { verdict: "review", role: top[0] } : { verdict: "draft" };
  }
  return score(readings.review) > draft ? { verdict: "review" } : { verdict: "draft" };
}
